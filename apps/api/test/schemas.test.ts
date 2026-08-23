import { describe, expect, it } from 'vitest';
import { contactDiscoverySchema, deviceRegistrationSchema, encryptedMessageSchema, pushSubscriptionSchema } from '../src/schemas.js';

describe('encrypted message schema', () => {
  it('accepts a versioned opaque envelope', () => {
    expect(encryptedMessageSchema.safeParse({
      conversationId: 'conversation-1', clientId: crypto.randomUUID(),
      senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(),
      iv: 'MTIzNDU2Nzg5MDEy', ciphertext: 'Y2lwaGVydGV4dC13aXRoLXRhZw', version: 1,
    }).success).toBe(true);
  });
  it('rejects plaintext-shaped and oversized payloads', () => {
    expect(encryptedMessageSchema.safeParse({ conversationId: 'c', clientId: crypto.randomUUID(), body: 'ciao' }).success).toBe(false);
    expect(encryptedMessageSchema.safeParse({
      conversationId: 'c', clientId: crypto.randomUUID(), senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(),
      iv: 'MTIzNDU2Nzg5MDEy', ciphertext: 'x'.repeat(24_001), version: 1,
    }).success).toBe(false);
  });
});

describe('device registration schema', () => {
  it('only accepts P-256 public keys and never a private component', () => {
    const base = { id: crypto.randomUUID(), publicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43), ext: true } };
    expect(deviceRegistrationSchema.safeParse(base).success).toBe(true);
    expect(deviceRegistrationSchema.safeParse({ ...base, publicKey: { ...base.publicKey, d: 'private' } }).success).toBe(false);
  });
});

describe('contact discovery schema', () => {
  it('normalizes email casing without accepting arbitrary contact data', () => {
    expect(contactDiscoverySchema.parse({ emails: ['Marco@Example.COM'] }).emails).toEqual(['marco@example.com']);
    expect(contactDiscoverySchema.safeParse({ emails: ['not-an-email'] }).success).toBe(false);
  });
  it('caps discovery batches', () => {
    expect(contactDiscoverySchema.safeParse({ emails: Array.from({ length: 501 }, (_, index) => `u${index}@example.com`) }).success).toBe(false);
  });
});

describe('push subscription schema', () => {
  it('requires a valid endpoint and both encryption keys', () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://push.example/1', keys: { p256dh: 'key', auth: 'auth' } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'not-a-url', keys: { p256dh: '', auth: '' } }).success).toBe(false);
  });
});
