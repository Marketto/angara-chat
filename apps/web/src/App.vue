<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { contactEmails, gmailEmails } from './contacts';
import { claimDraft, restoreDraft } from './message-submit';
import { mergeMessages, reconcileMessage } from './messages';
import { outbox, type QueuedMessage } from './outbox';
import { deliverQueuedMessages } from './outbox-delivery';
import { currentPushEndpoint, enablePush, syncPushSubscription } from './push';
import { createSingleFlight } from './single-flight';
import { locale, supportedLocales, t, type Locale } from './i18n';
import { updateWhenBackendChanges } from './pwa-update';
import { pickChatTheme, type ChatTheme } from './chat-themes';
import type { Conversation, DecryptedMessage, InstallPromptEvent, Message, MessageSendAcknowledgement, PermanentMessageSendError, PublicConfig, User } from './types';

const me = ref<User | null>(null);
const config = ref<PublicConfig | null>(null);
const conversations = ref<Conversation[]>([]);
const activeId = ref<string | null>(null);
const messages = ref<DecryptedMessage[]>([]);
const draft = ref('');
const loading = ref(true);
const error = ref('');
const showContacts = ref(false);
const discovered = ref<User[]>([]);
const manualEmail = ref('');
const localTestEmail = ref('');
const pushEnabled = ref(false);
const pushPending = ref(false);
const messageList = ref<HTMLElement | null>(null);
const deferredInstallPrompt = ref<InstallPromptEvent | null>(null);
const chatTheme = ref<ChatTheme>(pickChatTheme());
const canInstall = computed(() => Boolean(deferredInstallPrompt.value));
let socket: Socket | null = null;
let outboxRetryTimer: number | undefined;
let socketReconnectTimer: number | undefined;
const flushOutbox = createSingleFlight(flushOutboxBatch);

const activeConversation = computed(() => conversations.value.find(({ id }) => id === activeId.value) ?? null);
const canPickContacts = computed(() => Boolean(navigator.contacts?.select));
const googleContactsScope = 'https://www.googleapis.com/auth/contacts.readonly';

watch(locale, (value) => { document.documentElement.lang = value; }, { immediate: true });
function setLocale(event: Event) { locale.value = (event.target as HTMLSelectElement).value as Locale; }

onMounted(async () => {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', clearInstallPrompt);
  window.addEventListener('focus', refreshPushState);
  window.addEventListener('online', retryOutbox);
  window.addEventListener('online', refreshPushState);
  try {
    config.value = await api.config();
    updateWhenBackendChanges(config.value.buildVersion);
    me.value = await api.me();
    await enterApp();
  } catch { me.value = null; }
  finally {
    loading.value = false;
  }
  if (!me.value && new URL(location.href).searchParams.has('auth_error')) error.value = t('loginFailed');
});

onBeforeUnmount(() => {
  clearOutboxRetry();
  clearSocketReconnect();
  socket?.disconnect();
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  window.removeEventListener('appinstalled', clearInstallPrompt);
  window.removeEventListener('focus', refreshPushState);
  window.removeEventListener('online', retryOutbox);
  window.removeEventListener('online', refreshPushState);
});

function captureInstallPrompt(event: Event) {
  event.preventDefault();
  deferredInstallPrompt.value = event as InstallPromptEvent;
}

function clearInstallPrompt() { deferredInstallPrompt.value = null; }
function retryOutbox() { socket?.connect(); void flushOutbox(); }
function clearOutboxRetry() {
  if (outboxRetryTimer !== undefined) window.clearTimeout(outboxRetryTimer);
  outboxRetryTimer = undefined;
}
function scheduleOutboxRetry(delayMs: number) {
  clearOutboxRetry();
  outboxRetryTimer = window.setTimeout(() => {
    outboxRetryTimer = undefined;
    void flushOutbox();
  }, delayMs);
}
function clearSocketReconnect() {
  if (socketReconnectTimer !== undefined) window.clearTimeout(socketReconnectTimer);
  socketReconnectTimer = undefined;
}
function scheduleSocketReconnect() {
  if (socketReconnectTimer !== undefined) return;
  socketReconnectTimer = window.setTimeout(() => {
    socketReconnectTimer = undefined;
    socket?.connect();
  }, 3_000);
}

async function installApp() {
  const prompt = deferredInstallPrompt.value;
  if (!prompt) return;
  await prompt.prompt();
  await prompt.userChoice;
  clearInstallPrompt();
}

async function renderGoogleLogin() {
  if (!config.value) return;
  if (!window.google) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Identity non disponibile'));
      document.head.append(script);
    });
  }
  await nextTick();
  const target = document.querySelector<HTMLElement>('#google-sign-in');
  if (!target || !window.google) return;
  window.google.accounts.id.initialize({
    client_id: config.value.googleClientId,
    ux_mode: 'redirect',
    login_uri: `${window.location.origin}/api/auth/google/redirect`,
  });
  window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
}

async function localTestLogin() {
  if (!config.value?.localTestAuthEnabled || !localTestEmail.value.trim()) return;
  try {
    me.value = await api.localTestLogin(localTestEmail.value, import.meta.env.VITE_TEST_AUTH_TOKEN ?? '');
    await enterApp();
  } catch { error.value = t('loginFailed'); }
}

async function enterApp() {
  await refreshPushState();
  conversations.value = await api.conversations();
  socket?.disconnect();
  socket = io({ withCredentials: true });
  socket.on('connect', () => {
    clearSocketReconnect();
    void refreshConversations();
  });
  socket.on('connect_error', (failure: Error) => {
    if (failure.message !== 'unauthorized') scheduleSocketReconnect();
  });
  socket.on('delivery:ready', () => { void synchronizeAfterReconnect().catch(() => undefined); });
  socket.on('message:new', async (message: Message) => {
    if (message.conversationId === activeId.value) {
      messages.value = reconcileMessage(messages.value, message);
      await scrollToBottom();
    }
    void refreshConversations();
  });
  socket.on('conversation:new', () => { void refreshConversations(); });
  const fromUrl = new URL(location.href).searchParams.get('conversation');
  if (fromUrl && conversations.value.some(({ id }) => id === fromUrl)) await openConversation(fromUrl);
}

async function refreshPushState() {
  if (!me.value || pushPending.value) return;
  try { pushEnabled.value = await syncPushSubscription(); }
  catch { pushEnabled.value = false; }
}

async function refreshConversations() { conversations.value = await api.conversations(); }

async function synchronizeAfterReconnect() {
  try {
    await refreshConversations();
    const conversationId = activeId.value;
    if (conversationId) {
      const history = await api.messages(conversationId);
      if (activeId.value === conversationId) {
        messages.value = mergeMessages(messages.value, history);
        await showQueuedMessages(conversationId);
        await scrollToBottom();
      }
    }
  } finally {
    void flushOutbox();
  }
}

async function openConversation(id: string) {
  error.value = '';
  const conversation = conversations.value.find((item) => item.id === id);
  if (!conversation) return;
  chatTheme.value = pickChatTheme();
  activeId.value = id;
  messages.value = [];
  const historySnapshot = await api.messages(id);
  if (activeId.value !== id) return;
  messages.value = mergeMessages(messages.value, historySnapshot);
  await showQueuedMessages(id);
  socket?.emit('conversation:join', id);
  history.replaceState({}, '', `/?conversation=${encodeURIComponent(id)}`);
  await scrollToBottom();
}

function closeConversation() {
  activeId.value = null;
  history.replaceState({}, '', '/');
}

async function scrollToBottom() {
  await nextTick();
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
}

async function sendMessage() {
  if (!activeId.value || !me.value) return;
  const body = claimDraft(draft);
  if (!body) return;
  const queued = createQueuedMessage(activeId.value, body);
  try { await queueMessage(queued); }
  catch { restoreDraft(draft, body); error.value = t('messageFailed'); return; }
  void flushOutbox();
}

function createQueuedMessage(conversationId: string, body: string): QueuedMessage {
  return { clientId: crypto.randomUUID(), conversationId, userId: me.value!.id, body, createdAt: new Date().toISOString() };
}

async function queueMessage(message: QueuedMessage) {
  if ((await outbox.forUser(message.userId)).length >= 500) throw new Error('OUTBOX_FULL');
  await outbox.put(message);
  if (message.conversationId === activeId.value && !messages.value.some(({ clientId }) => clientId === message.clientId)) {
    messages.value = reconcileMessage(messages.value, { id: `queued:${message.clientId}`, ...message, senderId: me.value!.id, deliveryState: socket?.connected ? 'sending' : 'queued' });
    await scrollToBottom();
  }
}

async function showQueuedMessages(conversationId: string) {
  if (!me.value) return;
  const queued = await outbox.forUser(me.value.id);
  for (const message of queued.filter((item) => item.conversationId === conversationId)) {
    messages.value = reconcileMessage(messages.value, { id: `queued:${message.clientId}`, ...message, senderId: me.value.id, deliveryState: message.failure ? 'failed' : socket?.connected ? 'sending' : 'queued' });
  }
}

async function flushOutboxBatch() {
  if (!socket?.connected || !me.value) return false;
  clearOutboxRetry();
  try {
    const { retryAfterMs } = await deliverQueuedMessages({
      messages: await outbox.forUser(me.value.id),
      send: (message) => new Promise<MessageSendAcknowledgement | null>((resolve) => {
        socket!.timeout(10_000).emit('message:send', message, (timeout: Error | null, acknowledgement?: MessageSendAcknowledgement) => resolve(timeout ? null : acknowledgement ?? null));
      }),
      remove: (clientId) => outbox.remove(clientId),
      markFailed: (message, failure: PermanentMessageSendError) => outbox.put({ ...message, failure }),
      onState: (message, state) => {
        const pending = messages.value.find(({ clientId }) => clientId === message.clientId);
        if (pending) pending.deliveryState = state;
      },
      onDelivered: (message) => {
        if (message.conversationId === activeId.value) messages.value = reconcileMessage(messages.value, message);
      },
    });
    if (retryAfterMs !== undefined) {
      scheduleOutboxRetry(retryAfterMs);
      return false;
    }
    return true;
  } catch {
    scheduleOutboxRetry(3_000);
    return false;
  }
}


async function pickContacts() {
  if (!navigator.contacts) return;
  try {
    const contacts = await navigator.contacts.select(['name', 'email'], { multiple: true });
    await discover(contactEmails(contacts));
  } catch { /* The user may simply close the native picker. */ }
}

async function googleAccessToken(): Promise<string> {
  if (!config.value || !window.google?.accounts.oauth2) throw new Error('GOOGLE_CONTACTS_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const tokenClient = window.google!.accounts.oauth2!.initTokenClient({
      client_id: config.value!.googleClientId,
      scope: googleContactsScope,
      callback: ({ access_token, error }) => access_token ? resolve(access_token) : reject(new Error(error ?? 'GOOGLE_CONTACTS_DENIED')),
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function pickGoogleContacts() {
  try {
    const accessToken = await googleAccessToken();
    const contacts: Array<{ emailAddresses?: Array<{ value?: string }> }> = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ personFields: 'emailAddresses', pageSize: '1000', sources: 'READ_SOURCE_TYPE_CONTACT' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await fetch(`https://people.googleapis.com/v1/people/me/connections?${query}`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('GOOGLE_CONTACTS_FETCH_FAILED');
      const body = await response.json() as { connections?: Array<{ emailAddresses?: Array<{ value?: string }> }>; nextPageToken?: string };
      contacts.push(...(body.connections ?? []));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken && contacts.length < 5_000);
    await discover(gmailEmails(contacts));
  } catch {
    error.value = t('noUsers');
  }
}

async function discover(emails: string[]) {
  const normalized = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return;
  const batches = Array.from({ length: Math.ceil(normalized.length / 500) }, (_, index) => normalized.slice(index * 500, (index + 1) * 500));
  discovered.value = (await Promise.all(batches.map((batch) => api.discover(batch)))).flat();
  if (!discovered.value.length) error.value = t('noUsers');
}

async function discoverManual() {
  await discover([manualEmail.value]);
  manualEmail.value = '';
}

async function openContacts() {
  try {
    showContacts.value = true;
    discovered.value = [];
    error.value = '';
    if (canPickContacts.value) await pickContacts();
    else await pickGoogleContacts();
  }
  catch { void api.clientLog('CONTACTS_MODAL_OPEN_FAILED'); error.value = t('loginFailed'); }
}

async function startConversation(user: User) {
  const { id } = await api.createConversation(user.id);
  showContacts.value = false;
  discovered.value = [];
  await refreshConversations();
  socket?.emit('conversation:join', id);
  await openConversation(id);
}

async function requestPush() {
  if (!config.value || pushPending.value || pushEnabled.value) return;
  pushPending.value = true;
  try {
    await enablePush(config.value.vapidPublicKey);
    pushEnabled.value = true;
    error.value = '';
  }
  catch { error.value = t('pushFailed'); }
  finally { pushPending.value = false; }
}

async function logout() {
  clearOutboxRetry();
  clearSocketReconnect();
  let pushEndpoint: string | undefined;
  try { pushEndpoint = await currentPushEndpoint(); }
  catch { /* Logout still invalidates this session if browser push lookup fails. */ }
  await api.logout(pushEndpoint);
  if (me.value) await outbox.clearUser(me.value.id);
  socket?.disconnect();
  me.value = null;
  activeId.value = null;
  conversations.value = [];
  messages.value = [];
  await renderGoogleLogin();
}
</script>

<template>
  <main v-if="loading" class="splash"><img src="/icon.svg" alt=""><p>{{ t('loading') }}</p></main>
  <main v-else-if="!me" class="login-shell">
    <section class="login-card">
      <img class="logo" src="/icon.svg" :alt="t('brand')">
      <p class="eyebrow">{{ t('loginEyebrow') }}</p>
      <h1>{{ t('loginTitle') }}</h1>
      <p>{{ t('loginText') }}</p>
      <a class="google-button" href="/api/auth/google/start">Continua con Google</a>
      <form v-if="config?.localTestAuthEnabled" class="manual" @submit.prevent="localTestLogin"><label for="local-test-email">Local test email</label><div><input id="local-test-email" v-model="localTestEmail" type="email" autocomplete="off"><button>Accedi localmente</button></div></form>
      <button v-if="canInstall" class="install-cta" @click="installApp">{{ t('installPhone') }}</button>
      <select class="language-select" :value="locale" aria-label="Language" @change="setLocale"><option v-for="item in supportedLocales" :key="item" :value="item">{{ item.toUpperCase() }}</option></select>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </main>
  <main v-else class="app-shell">
    <aside class="sidebar" :class="{ hiddenMobile: activeId }">
      <header class="profile">
        <img :src="me.avatarUrl || '/icon.svg'" alt="" referrerpolicy="no-referrer">
        <div><strong>{{ me.name }}</strong><span>{{ t('available') }}</span></div>
        <select class="sidebar-language" :value="locale" aria-label="Language" @change="setLocale"><option v-for="item in supportedLocales" :key="item" :value="item">{{ item.toUpperCase() }}</option></select>
        <button class="icon-button" :title="t('logout')" @click="logout">↗</button>
      </header>
      <div class="sidebar-actions">
        <button class="primary" @click="openContacts">＋ {{ t('newChat') }}</button>
        <button
          v-if="!pushEnabled"
          class="quiet"
          :disabled="pushPending"
          @click="requestPush"
        >
          {{ t('notifications') }}
        </button>
        <button v-if="canInstall" class="quiet install-button" @click="installApp">⇩ {{ t('install') }}</button>
      </div>
      <nav :aria-label="t('conversations')">
        <button v-for="conversation in conversations" :key="conversation.id" class="conversation" :class="{ active: activeId === conversation.id }" @click="openConversation(conversation.id)">
          <img :src="conversation.peer?.avatarUrl || '/icon.svg'" alt="" referrerpolicy="no-referrer">
          <span><strong>{{ conversation.peer?.name || t('conversations') }}</strong><small>{{ conversation.lastMessage ? t('encryptedMessage') : t('startWriting') }}</small></span>
        </button>
        <p v-if="!conversations.length" class="empty">{{ t('empty') }}</p>
      </nav>
    </aside>

    <section class="chat" :class="[{ hiddenMobile: !activeId }, `chat--${chatTheme}`]">
      <template v-if="activeConversation">
        <header class="chat-header">
          <button class="back" :aria-label="t('back')" @click="closeConversation">‹</button>
          <img :src="activeConversation.peer?.avatarUrl || '/icon.svg'" alt="" referrerpolicy="no-referrer">
          <strong>{{ activeConversation.peer?.name }}</strong>
        </header>
        <div ref="messageList" class="messages" aria-live="polite">
          <div v-for="message in messages" :key="message.id" class="message" :class="{ mine: message.senderId === me.id, failed: message.decryptionFailed || message.deliveryState === 'failed' }">
            <p>{{ message.body }}</p><time>{{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}<span v-if="message.senderId === me.id" class="message-status" :class="message.deliveryState || 'sent'" :aria-label="message.deliveryState === 'failed' ? 'Invio non riuscito' : message.deliveryState === 'queued' ? 'In attesa della rete' : message.deliveryState === 'sending' ? 'Invio in corso' : 'Consegnato al server'" :title="message.deliveryState === 'failed' ? 'Invio non riuscito' : message.deliveryState === 'queued' ? 'In attesa della rete' : message.deliveryState === 'sending' ? 'Invio in corso' : 'Consegnato al server'">{{ message.deliveryState === 'failed' ? '!' : message.deliveryState === 'queued' ? '📡̸' : message.deliveryState === 'sending' ? '◷' : '✓✓' }}</span></time>
          </div>
        </div>
        <form class="composer" @submit.prevent="sendMessage">
          <textarea v-model="draft" maxlength="4000" rows="1" :aria-label="t('message')" :placeholder="t('message')" @keydown.enter.exact.prevent="sendMessage"></textarea>
          <button :disabled="!draft.trim()" :aria-label="t('send')">➤</button>
        </form>
      </template>
      <div v-else class="chat-placeholder"><img src="/icon.svg" alt=""><h2>{{ t('chooseChat') }}</h2><p>{{ t('serverCiphertext') }}</p></div>
    </section>

    <div v-if="showContacts" class="modal-backdrop" @click.self="showContacts = false">
      <section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="contacts-title">
        <button class="close" :aria-label="t('close')" @click="showContacts = false">×</button>
        <p class="eyebrow">{{ t('newConversation') }}</p><h2 id="contacts-title">{{ t('findPerson') }}</h2>
        <p v-if="canPickContacts">{{ t('contactPicker') }}</p>
        <button v-if="canPickContacts" class="primary wide" @click="pickContacts">{{ t('openContacts') }}</button>
        <button v-else class="primary wide" @click="pickGoogleContacts">{{ t('openContacts') }}</button>
        <div class="manual"><label for="email">{{ t('orEmail') }}</label><div><input id="email" v-model="manualEmail" type="email" autocomplete="off" placeholder="name@example.com" @keydown.enter="discoverManual"><button @click="discoverManual">{{ t('search') }}</button></div></div>
        <button v-for="user in discovered" :key="user.id" class="found-user" @click="startConversation(user)"><img :src="user.avatarUrl || '/icon.svg'" alt=""><span><strong>{{ user.name }}</strong><small>{{ user.email }}</small></span><b>＋</b></button>
      </section>
    </div>
    <p v-if="error" class="toast" role="alert" @click="error = ''">{{ error }}</p>
  </main>
</template>
