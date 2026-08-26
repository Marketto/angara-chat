<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { contactEmails } from './contacts';
import { enablePush, hasPushSubscription } from './push';
import { locale, supportedLocales, t, type Locale } from './i18n';
import { updateWhenBackendChanges } from './pwa-update';
import type { Conversation, DecryptedMessage, InstallPromptEvent, Message, PublicConfig, User } from './types';

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
const pushEnabled = ref(false);
const messageList = ref<HTMLElement | null>(null);
const deferredInstallPrompt = ref<InstallPromptEvent | null>(null);
const canInstall = computed(() => Boolean(deferredInstallPrompt.value));
let socket: Socket | null = null;

const activeConversation = computed(() => conversations.value.find(({ id }) => id === activeId.value) ?? null);
const canPickContacts = computed(() => Boolean(navigator.contacts?.select));

watch(locale, (value) => { document.documentElement.lang = value; }, { immediate: true });
function setLocale(event: Event) { locale.value = (event.target as HTMLSelectElement).value as Locale; }

onMounted(async () => {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', clearInstallPrompt);
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
  socket?.disconnect();
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  window.removeEventListener('appinstalled', clearInstallPrompt);
});

function captureInstallPrompt(event: Event) {
  event.preventDefault();
  deferredInstallPrompt.value = event as InstallPromptEvent;
}

function clearInstallPrompt() { deferredInstallPrompt.value = null; }

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

async function enterApp() {
  try { pushEnabled.value = await hasPushSubscription(); }
  catch { pushEnabled.value = false; }
  conversations.value = await api.conversations();
  socket?.disconnect();
  socket = io({ withCredentials: true });
  socket.on('message:new', async (message: Message) => {
    if (message.conversationId === activeId.value && !messages.value.some(({ id }) => id === message.id)) {
      messages.value.push(message);
      await scrollToBottom();
    }
    void refreshConversations();
  });
  const fromUrl = new URL(location.href).searchParams.get('conversation');
  if (fromUrl && conversations.value.some(({ id }) => id === fromUrl)) await openConversation(fromUrl);
}

async function refreshConversations() { conversations.value = await api.conversations(); }

async function openConversation(id: string) {
  error.value = '';
  const conversation = conversations.value.find((item) => item.id === id);
  if (!conversation) return;
  activeId.value = id;
  messages.value = await api.messages(id);
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
  const body = draft.value.trim();
  if (!body || !activeId.value || !socket) return;
  const clientId = crypto.randomUUID();
  draft.value = '';
  socket.emit('message:send', { conversationId: activeId.value, clientId, body }, (result: { ok: boolean }) => {
    if (!result.ok) { error.value = t('messageFailed'); draft.value = body; }
  });
}


async function pickContacts() {
  if (!navigator.contacts) return;
  try {
    const contacts = await navigator.contacts.select(['name', 'email'], { multiple: true });
    await discover(contactEmails(contacts));
  } catch { /* The user may simply close the native picker. */ }
}

async function discover(emails: string[]) {
  const normalized = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return;
  discovered.value = await api.discover(normalized);
  if (!discovered.value.length) error.value = t('noUsers');
}

async function discoverManual() {
  await discover([manualEmail.value]);
  manualEmail.value = '';
}

async function openContacts() {
  try { showContacts.value = true; }
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
  if (!config.value) return;
  try { await enablePush(config.value.vapidPublicKey); pushEnabled.value = true; }
  catch { error.value = t('pushFailed'); }
}

async function logout() {
  await api.logout();
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
        <button v-if="!pushEnabled" class="quiet" @click="requestPush">{{ t('notifications') }}</button>
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

    <section class="chat" :class="{ hiddenMobile: !activeId }">
      <template v-if="activeConversation">
        <header class="chat-header">
          <button class="back" :aria-label="t('back')" @click="closeConversation">‹</button>
          <img :src="activeConversation.peer?.avatarUrl || '/icon.svg'" alt="" referrerpolicy="no-referrer">
          <strong>{{ activeConversation.peer?.name }}</strong>
        </header>
        <div ref="messageList" class="messages" aria-live="polite">
          <div v-for="message in messages" :key="message.id" class="message" :class="{ mine: message.senderId === me.id, failed: message.decryptionFailed }">
            <p>{{ message.body }}</p><time>{{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</time>
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
        <div class="manual"><label for="email">{{ t('orEmail') }}</label><div><input id="email" v-model="manualEmail" type="email" autocomplete="off" placeholder="name@example.com" @keydown.enter="discoverManual"><button @click="discoverManual">{{ t('search') }}</button></div></div>
        <button v-for="user in discovered" :key="user.id" class="found-user" @click="startConversation(user)"><img :src="user.avatarUrl || '/icon.svg'" alt=""><span><strong>{{ user.name }}</strong><small>{{ user.email }}</small></span><b>＋</b></button>
      </section>
    </div>
    <p v-if="error" class="toast" role="alert" @click="error = ''">{{ error }}</p>
  </main>
</template>
