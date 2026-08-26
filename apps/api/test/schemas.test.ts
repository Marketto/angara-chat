import { describe, expect, it } from 'vitest';
import { contactDiscoverySchema, plaintextMessageSchema, pushSubscriptionSchema } from '../src/schemas.js';

describe('plaintext message schema', () => {
  it('accepts bounded text and rejects blank or oversized bodies', () => {
    expect(plaintextMessageSchema.safeParse({ conversationId: 'conversation-1', clientId: crypto.randomUUID(), body: 'ciao' }).success).toBe(true);
    expect(plaintextMessageSchema.safeParse({ conversationId: 'c', clientId: crypto.randomUUID(), body: ' '.repeat(4001) }).success).toBe(false);
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
