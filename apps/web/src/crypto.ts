import type { Message, PublicDevice } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface MessageContext {
  conversationId: string;
  clientId: string;
  senderId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
}

export async function generateDeviceKeys() {
  const generated = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const [publicKey, privateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', generated.publicKey),
    crypto.subtle.exportKey('jwk', generated.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { publicKey, privateKey, fingerprint: await fingerprint(publicKey) };
}

export async function fingerprint(publicKey: JsonWebKey) {
  if (publicKey.crv !== 'P-256' || !publicKey.x || !publicKey.y) throw new Error('INVALID_PUBLIC_KEY');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`P-256:${publicKey.x}:${publicKey.y}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatFingerprint(value: string) {
  return value.toUpperCase().match(/.{1,4}/g)?.join(' ') ?? value;
}

export async function encryptText(body: string, privateKey: CryptoKey, peer: PublicDevice, context: MessageContext) {
  const key = await messageKey(privateKey, peer.publicKey, context.conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context), tagLength: 128 }, key, encoder.encode(body));
  return { ciphertext: toBase64url(new Uint8Array(ciphertext)), iv: toBase64url(iv), version: 1 as const };
}

export async function decryptText(message: Message, conversationId: string, privateKey: CryptoKey, peer: PublicDevice) {
  const context: MessageContext = {
    conversationId,
    clientId: message.clientId,
    senderId: message.senderId,
    senderDeviceId: message.senderDeviceId,
    recipientDeviceId: message.recipientDeviceId,
  };
  const key = await messageKey(privateKey, peer.publicKey, conversationId);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: fromBase64url(message.iv), additionalData: aad(context), tagLength: 128,
  }, key, fromBase64url(message.ciphertext));
  return decoder.decode(plaintext);
}

async function messageKey(privateKey: CryptoKey, peerPublicKey: JsonWebKey, conversationId: string) {
  const peer = await crypto.subtle.importKey('jwk', peerPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', encoder.encode(`angara:conversation:${conversationId}`));
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('angara-message-v1'),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function aad(context: MessageContext) {
  return encoder.encode(JSON.stringify([
    1, context.conversationId, context.clientId, context.senderId, context.senderDeviceId, context.recipientDeviceId,
  ]));
}

function toBase64url(value: Uint8Array) {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
