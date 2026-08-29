<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import { ApiError, api } from './api';
import { contactEmails, gmailEmails } from './contacts';
import { claimDraft, isRapidDuplicateSubmission, restoreDraft, type MessageSubmission } from './message-submit';
import { createIncomingMessageSound } from './message-sound';
import { mergeMessages, reconcileMessage } from './messages';
import { outbox, type QueuedMessage } from './outbox';
import { localImageCache } from './attachment-cache';
import { deliverQueuedMessages } from './outbox-delivery';
import { createOutboxWakeup } from './outbox-wakeup';
import { currentPushEndpoint, enablePush, syncPushSubscription } from './push';
import { createSingleFlight } from './single-flight';
import { locale, supportedLocales, t, type Locale } from './i18n';
import { updateWhenBackendChanges } from './pwa-update';
import { pickChatTheme, type ChatTheme } from './chat-themes';
import { attachmentUploadFailure, deliverQueuedMessage, DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, openStreetMapUrl, sha256Hex, validateAttachment, type AttachmentKind } from './sharing';
import type { Conversation, DecryptedMessage, InstallPromptEvent, Message, MessageSendAcknowledgement, MessageKind, PermanentMessageSendError, PublicConfig, User } from './types';

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
const attachmentUrlRevision = ref(0);
const deferredInstallPrompt = ref<InstallPromptEvent | null>(null);
const chatTheme = ref<ChatTheme>(pickChatTheme());
const showShareMenu = ref(false);
const photoInput = ref<HTMLInputElement | null>(null);
const documentInput = ref<HTMLInputElement | null>(null);
const pendingAttachment = ref<{ conversationId: string; kind: AttachmentKind; file: File; sha256: string } | null>(null);
const pendingLocation = ref<{ conversationId: string; latitude: number; longitude: number; accuracy?: number } | null>(null);
const locating = ref(false);
const incomingCall = ref<{ callId: string; conversationId: string; sdp: string } | null>(null);
const callId = ref<string | null>(null);
const callStatus = ref<'calling' | 'connected' | 'incoming' | null>(null);
const remoteAudio = ref<HTMLAudioElement | null>(null);
const loadedLocationMapIds = ref<Set<string>>(new Set());
const canInstall = computed(() => Boolean(deferredInstallPrompt.value));
const imageAccept = IMAGE_MIME_TYPES.join(',');
const documentAccept = DOCUMENT_MIME_TYPES.join(',');
let socket: Socket | null = null;
let outboxRetryTimer: number | undefined;
let socketReconnectTimer: number | undefined;
let lastSubmission: MessageSubmission | null = null;
let incomingMessageAudio: HTMLAudioElement | null = null;
let peerConnection: RTCPeerConnection | null = null;
let localCallStream: MediaStream | null = null;
let pendingCallCandidates: RTCIceCandidateInit[] = [];
let scrollPinnedToBottom = true;
const localAttachmentUrls = new Map<string, string>();
const locationMaps = new Map<string, { remove(): void }>();
const flushOutbox = createSingleFlight(flushOutboxBatch);
const outboxWakeup = createOutboxWakeup({
  isConnected: () => Boolean(socket?.connected),
  connect: () => socket?.connect(),
  flushOutbox,
  synchronize: synchronizeAfterReconnect,
});
const incomingMessageSound = createIncomingMessageSound(playIncomingMessageSound);

const activeConversation = computed(() => conversations.value.find(({ id }) => id === activeId.value) ?? null);
const canPickContacts = computed(() => Boolean(navigator.contacts?.select));
const googleContactsScope = 'https://www.googleapis.com/auth/contacts.readonly';

watch(locale, (value) => { document.documentElement.lang = value; }, { immediate: true });
function setLocale(event: Event) { locale.value = (event.target as HTMLSelectElement).value as Locale; }

onMounted(async () => {
  window.addEventListener('pointerdown', prepareIncomingMessageSound, { once: true });
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', clearInstallPrompt);
  window.addEventListener('focus', refreshPushState);
  window.addEventListener('focus', retryOutbox);
  window.addEventListener('online', retryOutbox);
  window.addEventListener('online', refreshPushState);
  document.addEventListener('visibilitychange', retryVisibleOutbox);
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
  stopCall(false);
  clearOutboxRetry();
  clearSocketReconnect();
  socket?.disconnect();
  window.removeEventListener('pointerdown', prepareIncomingMessageSound);
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  window.removeEventListener('appinstalled', clearInstallPrompt);
  window.removeEventListener('focus', refreshPushState);
  window.removeEventListener('focus', retryOutbox);
  window.removeEventListener('online', retryOutbox);
  window.removeEventListener('online', refreshPushState);
  document.removeEventListener('visibilitychange', retryVisibleOutbox);
  revokeAllAttachmentUrls();
  clearLocationMaps();
});

function emitCall(event: string, payload: Record<string, string>) {
  return new Promise<{ ok: boolean }>((resolve) => socket?.timeout(10_000).emit(event, payload, (timeout: Error | null, result?: { ok: boolean }) => resolve(timeout ? { ok: false } : result ?? { ok: false })));
}

function closePeerConnection() {
  peerConnection?.close();
  peerConnection = null;
  localCallStream?.getTracks().forEach((track) => track.stop());
  localCallStream = null;
  pendingCallCandidates = [];
  if (remoteAudio.value) remoteAudio.value.srcObject = null;
}

function stopCall(notify = true) {
  const id = callId.value;
  if (notify && id) void emitCall('call:hangup', { callId: id });
  closePeerConnection();
  callId.value = null;
  callStatus.value = null;
  incomingCall.value = null;
}

async function createPeerConnection(id: string) {
  const { iceServers } = await api.callIce();
  const peer = new RTCPeerConnection({ iceServers });
  peerConnection = peer;
  peer.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    const value = candidate.toJSON();
    if (callStatus.value === 'connected') void emitCall('call:candidate', { callId: id, candidate: JSON.stringify(value) });
    else pendingCallCandidates.push(value);
  };
  peer.ontrack = ({ streams }) => {
    if (remoteAudio.value && streams[0]) {
      remoteAudio.value.srcObject = streams[0];
      void remoteAudio.value.play().catch(() => undefined);
    }
  };
  localCallStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localCallStream.getTracks().forEach((track) => peer.addTrack(track, localCallStream!));
  return peer;
}

async function flushCallCandidates() {
  const id = callId.value;
  if (!id) return;
  const candidates = pendingCallCandidates;
  pendingCallCandidates = [];
  for (const candidate of candidates) await emitCall('call:candidate', { callId: id, candidate: JSON.stringify(candidate) });
}

async function startCall() {
  if (!activeId.value || !socket?.connected || callId.value) return;
  try {
    const id = crypto.randomUUID();
    callId.value = id;
    callStatus.value = 'calling';
    const peer = await createPeerConnection(id);
    const offer = await peer.createOffer({ offerToReceiveAudio: true });
    await peer.setLocalDescription(offer);
    const sent = await emitCall('call:offer', { callId: id, conversationId: activeId.value, sdp: offer.sdp ?? '' });
    if (!sent.ok) throw new Error('CALL_UNAVAILABLE');
  } catch {
    stopCall(false);
    error.value = t('callFailed');
  }
}

async function acceptCall() {
  const incoming = incomingCall.value;
  if (!incoming || callId.value) return;
  try {
    callId.value = incoming.callId;
    callStatus.value = 'incoming';
    const peer = await createPeerConnection(incoming.callId);
    await peer.setRemoteDescription({ type: 'offer', sdp: incoming.sdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    const sent = await emitCall('call:answer', { callId: incoming.callId, sdp: answer.sdp ?? '' });
    if (!sent.ok) throw new Error('CALL_UNAVAILABLE');
    callStatus.value = 'connected';
    incomingCall.value = null;
    await flushCallCandidates();
  } catch {
    stopCall(false);
    error.value = t('callFailed');
  }
}

function audioForIncomingMessages() {
  if (!incomingMessageAudio) {
    incomingMessageAudio = new Audio('/sounds/eco-del-baikal.wav');
    incomingMessageAudio.preload = 'auto';
  }
  return incomingMessageAudio;
}

function playIncomingMessageSound() {
  const audio = audioForIncomingMessages();
  audio.volume = 1;
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

async function prepareIncomingMessageSound() {
  const audio = audioForIncomingMessages();
  audio.muted = true;
  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // Some browsers unlock audio only after a later media interaction.
  } finally {
    audio.muted = false;
  }
}

function captureInstallPrompt(event: Event) {
  event.preventDefault();
  deferredInstallPrompt.value = event as InstallPromptEvent;
}

function clearInstallPrompt() { deferredInstallPrompt.value = null; }
function retryOutbox() { outboxWakeup.connectivityAvailable(); }
function retryVisibleOutbox() {
  if (document.visibilityState === 'visible') retryOutbox();
}
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
    outboxWakeup.socketConnected();
  });
  socket.on('connect_error', (failure: Error) => {
    if (failure.message !== 'unauthorized') scheduleSocketReconnect();
  });
  socket.on('delivery:ready', () => { void outboxWakeup.deliveryReady(); });
  socket.on('message:new', async (message: Message) => {
    if (me.value) {
      incomingMessageSound.handle(
        message,
        me.value.id,
        document.visibilityState === 'visible' && document.hasFocus(),
      );
    }
    void cacheImage(message, undefined, message.conversationId === activeId.value);
    if (message.conversationId === activeId.value) {
      messages.value = reconcileMessage(messages.value, message);
      await scrollToBottom();
    }
    void refreshConversations();
  });
  socket.on('conversation:new', () => { void refreshConversations(); });
  socket.on('call:offer', (offer: { callId: string; conversationId: string; sdp: string }) => {
    if (!callId.value) {
      incomingCall.value = offer;
      callStatus.value = 'incoming';
    }
  });
  socket.on('call:answer', async (answer: { callId: string; sdp: string }) => {
    if (answer.callId !== callId.value || !peerConnection) return;
    try {
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      callStatus.value = 'connected';
      await flushCallCandidates();
    } catch { stopCall(false); error.value = t('callFailed'); }
  });
  socket.on('call:candidate', async (signal: { callId: string; candidate: string }) => {
    if (signal.callId !== callId.value || !peerConnection) return;
    try { await peerConnection.addIceCandidate(JSON.parse(signal.candidate) as RTCIceCandidateInit); }
    catch { stopCall(false); error.value = t('callFailed'); }
  });
  socket.on('call:ended', (event: { callId: string }) => {
    if (event.callId === callId.value || event.callId === incomingCall.value?.callId) stopCall(false);
  });
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
  await refreshConversations();
  const conversationId = activeId.value;
  if (conversationId) {
    const history = await api.messages(conversationId);
    if (activeId.value === conversationId) {
      messages.value = mergeMessages(messages.value, history);
      await showQueuedMessages(conversationId);
      void cacheImages(messages.value);
      await scrollToBottom();
    }
  }
}

async function openConversation(id: string) {
  error.value = '';
  const conversation = conversations.value.find((item) => item.id === id);
  if (!conversation) return;
  chatTheme.value = pickChatTheme();
  revokeAllAttachmentUrls();
  clearLocationMaps();
  activeId.value = id;
  messages.value = [];
  const historySnapshot = await api.messages(id);
  if (activeId.value !== id) return;
  messages.value = mergeMessages(messages.value, historySnapshot);
  await showQueuedMessages(id);
  void cacheImages(messages.value);
  socket?.emit('conversation:join', id);
  history.replaceState({}, '', `/?conversation=${encodeURIComponent(id)}`);
  await scrollToBottom('auto');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await scrollToBottom('auto');
}

function closeConversation() {
  clearLocationMaps();
  activeId.value = null;
  history.replaceState({}, '', '/');
}

function updateScrollPin() {
  const list = messageList.value;
  if (!list) return;
  scrollPinnedToBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 2;
}

function maintainPinnedScroll() {
  if (scrollPinnedToBottom) void scrollToBottom('auto');
}

async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  await nextTick();
  const list = messageList.value;
  if (!list) return;
  list.scrollTo({ top: list.scrollHeight, behavior });
  scrollPinnedToBottom = true;
}

async function sendMessage() {
  if (!activeId.value || !me.value) return;
  const body = claimDraft(draft);
  if (!body) return;
  const submission = { conversationId: activeId.value, body, submittedAt: Date.now() };
  if (isRapidDuplicateSubmission(lastSubmission, submission)) return;
  lastSubmission = submission;
  const queued = createQueuedMessage(activeId.value, body);
  try { await queueMessage(queued); }
  catch {
    if (lastSubmission === submission) lastSubmission = null;
    restoreDraft(draft, body);
    error.value = t('messageFailed');
    return;
  }
  void flushOutbox();
}

function createQueuedMessage(conversationId: string, body: string): QueuedMessage {
  return { clientId: crypto.randomUUID(), conversationId, userId: me.value!.id, kind: 'TEXT', body, createdAt: new Date().toISOString() };
}

function optimisticMessage(message: QueuedMessage): Message {
  const attachment = message.attachmentUpload ? {
    id: `queued:${message.clientId}`,
    fileName: message.attachmentUpload.fileName,
    mediaType: message.attachmentUpload.mediaType,
    byteSize: message.attachmentUpload.byteSize,
    sha256: message.attachmentUpload.sha256,
  } : undefined;
  if (message.attachmentUpload && !localAttachmentUrls.has(message.clientId)) {
    localAttachmentUrls.set(message.clientId, URL.createObjectURL(message.attachmentUpload.blob));
  }
  return { id: `queued:${message.clientId}`, ...message, senderId: me.value!.id, attachment };
}

async function queueMessage(message: QueuedMessage) {
  if ((await outbox.forUser(message.userId)).length >= 500) throw new Error('OUTBOX_FULL');
  await outbox.put(message);
  if (message.conversationId === activeId.value && !messages.value.some(({ clientId }) => clientId === message.clientId)) {
    messages.value = reconcileMessage(messages.value, { ...optimisticMessage(message), deliveryState: socket?.connected ? 'sending' : 'queued' });
    await scrollToBottom();
  }
}

async function showQueuedMessages(conversationId: string) {
  if (!me.value) return;
  const queued = await outbox.forUser(me.value.id);
  for (const message of queued.filter((item) => item.conversationId === conversationId)) {
    messages.value = reconcileMessage(messages.value, { ...optimisticMessage(message), deliveryState: message.failure ? 'failed' : socket?.connected ? 'sending' : 'queued' });
  }
}

async function flushOutboxBatch() {
  if (!socket?.connected || !me.value) return false;
  clearOutboxRetry();
  try {
    const { retryAfterMs } = await deliverQueuedMessages({
      messages: await outbox.forUser(me.value.id),
      send: (message) => deliverQueuedMessage(message, {
        upload: uploadQueuedAttachment,
        sendSocket: (queued) => new Promise<MessageSendAcknowledgement | null>((resolve) => {
          socket!.timeout(10_000).emit('message:send', queued, (timeout: Error | null, acknowledgement?: MessageSendAcknowledgement) => resolve(timeout ? null : acknowledgement ?? null));
        }),
      }),
      remove: (clientId) => outbox.remove(clientId),
      markFailed: (message, failure: PermanentMessageSendError) => outbox.put({ ...message, failure }),
      onState: (message, state) => {
        const pending = messages.value.find(({ clientId }) => clientId === message.clientId);
        if (pending) pending.deliveryState = state;
      },
    onDelivered: (message) => {
      revokeAttachmentUrl(message.clientId);
      if (message.conversationId === activeId.value) {
        messages.value = reconcileMessage(messages.value, message);
        void cacheImage(message);
      }
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

async function uploadQueuedAttachment(message: QueuedMessage): Promise<MessageSendAcknowledgement | null> {
  const upload = message.attachmentUpload;
  if (!upload || (message.kind !== 'IMAGE' && message.kind !== 'DOCUMENT')) return null;
  try {
    const persisted = await api.uploadAttachment(message.conversationId, {
      clientId: message.clientId,
      kind: message.kind,
      blob: upload.blob,
      fileName: upload.fileName,
      sha256: upload.sha256,
    });
    if (persisted.kind === 'IMAGE') void cacheImage(persisted, upload.blob);
    return { ok: true, message: persisted };
  } catch (failure) {
    if (failure instanceof ApiError) return attachmentUploadFailure(failure.status, failure.retryAfterMs);
    return null;
  }
}

function revokeAttachmentUrl(clientId: string) {
  const url = localAttachmentUrls.get(clientId);
  if (url) URL.revokeObjectURL(url);
  localAttachmentUrls.delete(clientId);
  attachmentUrlRevision.value += 1;
}

function revokeAllAttachmentUrls() {
  for (const url of localAttachmentUrls.values()) URL.revokeObjectURL(url);
  localAttachmentUrls.clear();
  attachmentUrlRevision.value += 1;
}

function setAttachmentUrl(clientId: string, blob: Blob) {
  revokeAttachmentUrl(clientId);
  localAttachmentUrls.set(clientId, URL.createObjectURL(blob));
  attachmentUrlRevision.value += 1;
}

async function cacheImage(message: Message, source?: Blob, retainUrl = true) {
  const attachment = message.attachment;
  if (!me.value || messageKind(message) !== 'IMAGE' || !attachment || attachment.id.startsWith('queued:') || (!source && localAttachmentUrls.has(message.clientId))) return;
  try {
    const blob = source ?? await localImageCache.get(me.value.id, attachment.id) ?? await api.downloadAttachment(attachment.id);
    await localImageCache.put(me.value.id, attachment.id, blob);
    if (retainUrl && !localAttachmentUrls.has(message.clientId)) setAttachmentUrl(message.clientId, blob);
  } catch {
    // The temporary server copy may already have expired; leave the normal URL as a fallback.
  }
}

async function cacheImages(items: Message[]) {
  await Promise.all(items.map((message) => cacheImage(message)));
}

function messageKind(message: Message): MessageKind { return message.kind ?? 'TEXT'; }
function attachmentHref(message: Message): string {
  void attachmentUrlRevision.value;
  return localAttachmentUrls.get(message.clientId) ?? (message.attachment ? api.attachmentUrl(message.attachment.id) : '#');
}
function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function selectAttachment(event: Event, kind: AttachmentKind) {
  showShareMenu.value = false;
  const conversationId = activeId.value;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !conversationId) return;
  const validation = await validateAttachment(file, kind);
  if (validation) {
    error.value = t(validation === 'TOO_LARGE' ? 'attachmentTooLarge' : 'attachmentTypeUnsupported');
    return;
  }
  try {
    pendingAttachment.value = { conversationId, kind, file, sha256: await sha256Hex(file) };
  } catch {
    error.value = t('attachmentFailed');
  }
}

async function confirmAttachment() {
  const pending = pendingAttachment.value;
  if (!pending || !me.value) return;
  const queued: QueuedMessage = {
    clientId: crypto.randomUUID(),
    conversationId: pending.conversationId,
    userId: me.value.id,
    kind: pending.kind,
    body: '',
    createdAt: new Date().toISOString(),
    attachmentUpload: {
      blob: pending.file,
      fileName: pending.file.name,
      mediaType: pending.file.type,
      byteSize: pending.file.size,
      sha256: pending.sha256,
    },
  };
  pendingAttachment.value = null;
  try { await queueMessage(queued); }
  catch {
    revokeAttachmentUrl(queued.clientId);
    error.value = t('attachmentFailed');
    return;
  }
  void flushOutbox();
}

function requestLocation() {
  showShareMenu.value = false;
  const conversationId = activeId.value;
  if (!conversationId || !navigator.geolocation || locating.value) {
    error.value = t('locationUnavailable');
    return;
  }
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      locating.value = false;
      pendingLocation.value = {
        conversationId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        ...(Number.isFinite(coords.accuracy) ? { accuracy: coords.accuracy } : {}),
      };
    },
    () => { locating.value = false; error.value = t('locationFailed'); },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
  );
}

async function confirmLocation() {
  const location = pendingLocation.value;
  if (!location || !me.value) return;
  const queued: QueuedMessage = {
    clientId: crypto.randomUUID(),
    conversationId: location.conversationId,
    userId: me.value.id,
    kind: 'LOCATION',
    body: '',
    createdAt: new Date().toISOString(),
    locationLatitude: location.latitude,
    locationLongitude: location.longitude,
    ...(location.accuracy !== undefined ? { locationAccuracy: location.accuracy } : {}),
  };
  pendingLocation.value = null;
  try { await queueMessage(queued); }
  catch { error.value = t('locationFailed'); return; }
  void flushOutbox();
}

function locationMapId(message: Message) { return `location-map-${message.clientId.replace(/[^a-zA-Z0-9_-]/g, '')}`; }
function hasLoadedLocationMap(message: Message) { return loadedLocationMapIds.value.has(message.clientId); }

async function loadLocationMap(message: Message) {
  const latitude = message.locationLatitude;
  const longitude = message.locationLongitude;
  if (latitude == null || longitude == null || locationMaps.has(message.clientId)) return;
  loadedLocationMapIds.value = new Set([...loadedLocationMapIds.value, message.clientId]);
  await nextTick();
  const container = document.getElementById(locationMapId(message));
  if (!container) return;
  let pendingMap: { remove(): void } | undefined;
  try {
    const L = await import('leaflet');
    const map = L.map(container, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
    pendingMap = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    L.circleMarker([latitude, longitude], { radius: 8, color: '#8c2338', fillColor: '#a8334a', fillOpacity: 0.9 }).addTo(map);
    locationMaps.set(message.clientId, map);
  } catch {
    pendingMap?.remove();
    const next = new Set(loadedLocationMapIds.value);
    next.delete(message.clientId);
    loadedLocationMapIds.value = next;
    error.value = t('mapFailed');
  }
}

function clearLocationMaps() {
  for (const map of locationMaps.values()) map.remove();
  locationMaps.clear();
  loadedLocationMapIds.value = new Set();
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
  const userId = me.value?.id;
  try { await api.logout(pushEndpoint); }
  catch { error.value = t('logoutFailed'); }
  finally {
    try {
      if (userId) await Promise.all([outbox.clearUser(userId), localImageCache.clearUser(userId)]);
    }
    finally {
      revokeAllAttachmentUrls();
      clearLocationMaps();
    }
  }
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
          <button class="call-button" :disabled="Boolean(callId)" :aria-label="t('startCall')" :title="t('startCall')" @click="startCall">☎</button>
        </header>
        <div ref="messageList" class="messages" aria-live="polite" @scroll.passive="updateScrollPin">
          <div v-for="message in messages" :key="message.id" class="message" :class="[{ mine: message.senderId === me.id, failed: message.decryptionFailed || message.deliveryState === 'failed' }, `message--${messageKind(message).toLowerCase()}`]">
            <p v-if="messageKind(message) === 'TEXT'">{{ message.body }}</p>
            <img v-else-if="messageKind(message) === 'IMAGE' && message.attachment" class="message-image" :src="attachmentHref(message)" :alt="message.attachment.fileName" loading="lazy" @load="maintainPinnedScroll">
            <a v-else-if="messageKind(message) === 'DOCUMENT' && message.attachment" class="document-link" :href="attachmentHref(message)" :download="message.attachment.fileName">
              <span aria-hidden="true">▤</span><span><strong>{{ message.attachment.fileName }}</strong><small>{{ formatBytes(message.attachment.byteSize) }}</small></span>
            </a>
            <div v-else-if="messageKind(message) === 'LOCATION' && message.locationLatitude != null && message.locationLongitude != null" class="location-card">
              <strong>{{ t('sharedLocation') }}</strong>
              <small>{{ message.locationLatitude.toFixed(5) }}, {{ message.locationLongitude.toFixed(5) }}<template v-if="message.locationAccuracy != null"> · ±{{ Math.round(message.locationAccuracy) }} m</template></small>
              <div v-if="hasLoadedLocationMap(message)" :id="locationMapId(message)" class="location-map" :aria-label="t('sharedLocation')"></div>
              <button v-else type="button" class="map-consent" @click="loadLocationMap(message)">{{ t('loadMap') }}<small>{{ t('osmPrivacy') }}</small></button>
              <a :href="openStreetMapUrl(message.locationLatitude, message.locationLongitude)" target="_blank" rel="noopener noreferrer">{{ t('openInOsm') }}</a>
            </div>
            <time>{{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}<span v-if="message.senderId === me.id" class="message-status" :class="message.deliveryState || 'sent'" :aria-label="message.deliveryState === 'failed' ? 'Invio non riuscito' : message.deliveryState === 'queued' ? 'In attesa della rete' : message.deliveryState === 'sending' ? 'Invio in corso' : 'Consegnato al server'" :title="message.deliveryState === 'failed' ? 'Invio non riuscito' : message.deliveryState === 'queued' ? 'In attesa della rete' : message.deliveryState === 'sending' ? 'Invio in corso' : 'Consegnato al server'">{{ message.deliveryState === 'failed' ? '!' : message.deliveryState === 'queued' ? '📡̸' : message.deliveryState === 'sending' ? '◷' : '✓✓' }}</span></time>
          </div>
        </div>
        <form class="composer" @submit.prevent="sendMessage">
          <button type="button" class="share-button" :aria-label="t('share')" :aria-expanded="showShareMenu" @click="showShareMenu = !showShareMenu">＋</button>
          <div v-if="showShareMenu" class="share-menu">
            <button type="button" @click="photoInput?.click()"><span aria-hidden="true">▧</span>{{ t('photo') }}</button>
            <button type="button" @click="documentInput?.click()"><span aria-hidden="true">▤</span>{{ t('document') }}</button>
            <button type="button" :disabled="locating" @click="requestLocation"><span aria-hidden="true">⌖</span>{{ locating ? t('locating') : t('location') }}</button>
          </div>
          <input ref="photoInput" class="visually-hidden" type="file" :accept="imageAccept" @change="selectAttachment($event, 'IMAGE')">
          <input ref="documentInput" class="visually-hidden" type="file" :accept="documentAccept" @change="selectAttachment($event, 'DOCUMENT')">
          <textarea v-model="draft" maxlength="4000" rows="1" :aria-label="t('message')" :placeholder="t('message')" @keydown.enter.exact.prevent="sendMessage"></textarea>
          <button class="send-button" :disabled="!draft.trim()" :aria-label="t('send')">➤</button>
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
    <div v-if="pendingAttachment" class="modal-backdrop" @click.self="pendingAttachment = null">
      <section class="dialog-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby="attachment-confirm-title">
        <button class="close" :aria-label="t('close')" @click="pendingAttachment = null">×</button>
        <p class="eyebrow">{{ t('share') }}</p><h2 id="attachment-confirm-title">{{ t('confirmAttachment') }}</h2>
        <p><strong>{{ pendingAttachment.file.name }}</strong><br>{{ formatBytes(pendingAttachment.file.size) }}</p>
        <p v-if="pendingAttachment.kind === 'IMAGE'" class="privacy-warning">{{ t('photoMetadataWarning') }}</p>
        <div class="confirmation-actions"><button class="quiet" @click="pendingAttachment = null">{{ t('cancel') }}</button><button class="primary" @click="confirmAttachment">{{ t('send') }}</button></div>
      </section>
    </div>
    <div v-if="pendingLocation" class="modal-backdrop" @click.self="pendingLocation = null">
      <section class="dialog-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby="location-confirm-title">
        <button class="close" :aria-label="t('close')" @click="pendingLocation = null">×</button>
        <p class="eyebrow">{{ t('location') }}</p><h2 id="location-confirm-title">{{ t('confirmLocation') }}</h2>
        <p class="coordinates">{{ pendingLocation.latitude.toFixed(6) }}, {{ pendingLocation.longitude.toFixed(6) }}<template v-if="pendingLocation.accuracy != null"><br>±{{ Math.round(pendingLocation.accuracy) }} m</template></p>
        <p class="privacy-warning">{{ t('locationPrivacy') }}</p>
        <div class="confirmation-actions"><button class="quiet" @click="pendingLocation = null">{{ t('cancel') }}</button><button class="primary" @click="confirmLocation">{{ t('sendLocation') }}</button></div>
      </section>
    </div>
    <div v-if="incomingCall" class="modal-backdrop" @click.self="stopCall(false)">
      <section class="dialog-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby="call-title">
        <p class="eyebrow">{{ t('audioCall') }}</p><h2 id="call-title">{{ t('incomingCall') }}</h2>
        <p>{{ t('callPrivacy') }}</p>
        <div class="confirmation-actions"><button class="quiet" @click="stopCall(false)">{{ t('cancel') }}</button><button class="primary" @click="acceptCall">{{ t('answerCall') }}</button></div>
      </section>
    </div>
    <div v-if="callId && !incomingCall" class="call-banner" role="status"><span>{{ callStatus === 'calling' ? t('calling') : t('callConnected') }}</span><button class="quiet" @click="stopCall()">{{ t('endCall') }}</button></div>
    <audio ref="remoteAudio" autoplay></audio>
    <p v-if="error" class="toast" role="alert" @click="error = ''">{{ error }}</p>
  </main>
</template>
