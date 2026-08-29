import { describe, expect, it } from 'vitest';
import {
  callAnswerSchema, callCandidateSchema, callHangupSchema, callOfferSchema,
  contactDiscoverySchema, logoutSchema, plaintextMessageSchema, pushEndpointSchema, pushSubscriptionSchema,
} from '../src/schemas.js';

describe('plaintext message schema', () => {
  it('accepts bounded text and rejects blank or oversized bodies', () => {
    expect(plaintextMessageSchema.safeParse({ conversationId: 'conversation-1', clientId: crypto.randomUUID(), body: 'ciao' }).success).toBe(true);
    expect(plaintextMessageSchema.safeParse({ conversationId: 'c', clientId: crypto.randomUUID(), body: ' '.repeat(4001) }).success).toBe(false);
  });

  const common = { conversationId: 'conversation-1', clientId: crypto.randomUUID() };

  it('keeps accepting legacy text messages and assigns the TEXT kind', () => {
    expect(plaintextMessageSchema.parse({ ...common, body: ' ciao ' })).toMatchObject({ kind: 'TEXT', body: 'ciao' });
  });

  it('accepts a location with finite coordinates in range', () => {
    expect(plaintextMessageSchema.parse({
      ...common, kind: 'LOCATION', body: '', locationLatitude: 61.0137,
      locationLongitude: 69.1962, locationAccuracy: 12.5,
    })).toMatchObject({ kind: 'LOCATION', locationAccuracy: 12.5 });
  });

  it.each([
    { locationLatitude: 91, locationLongitude: 10 },
    { locationLatitude: 10, locationLongitude: -181 },
    { locationLatitude: Number.NaN, locationLongitude: 10 },
    { locationLatitude: 10, locationLongitude: 10, locationAccuracy: -1 },
    { locationLatitude: 10, locationLongitude: 10, locationAccuracy: Number.POSITIVE_INFINITY },
  ])('rejects invalid location coordinates: %j', (location) => {
    expect(plaintextMessageSchema.safeParse({ ...common, kind: 'LOCATION', body: '', ...location }).success).toBe(false);
  });

  it('does not accept attachment message kinds over the socket', () => {
    expect(plaintextMessageSchema.safeParse({ ...common, kind: 'IMAGE', body: '' }).success).toBe(false);
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
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'key', auth: 'auth' } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'not-a-url', keys: { p256dh: '', auth: '' } }).success).toBe(false);
  });

  it('rejects non-HTTPS and non-push-service endpoints', () => {
    const keys = { p256dh: 'key', auth: 'auth' };
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'http://fcm.googleapis.com/send/1', keys }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://127.0.0.1/internal', keys }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/1', keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://web.push.apple.com/QH123', keys }).success).toBe(true);
  });
});

describe('logout schema', () => {
  it('accepts only the current device push endpoint', () => {
    expect(logoutSchema.parse({ pushEndpoint: 'https://push.example/device-a' })).toEqual({ pushEndpoint: 'https://push.example/device-a' });
    expect(logoutSchema.safeParse({ pushEndpoint: 'not-a-url' }).success).toBe(false);
  });
});

describe('push endpoint schema', () => {
  it('accepts a bounded HTTPS endpoint for device-specific removal', () => {
    expect(pushEndpointSchema.parse({ endpoint: 'https://fcm.googleapis.com/fcm/send/device' })).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/device' });
    expect(pushEndpointSchema.safeParse({ endpoint: 'not-a-url' }).success).toBe(false);
  });
});

describe('call signalling schemas', () => {
  const callId = crypto.randomUUID();

  it('accepts opaque, bounded SDP and ICE payloads without interpreting their contents', () => {
    expect(callOfferSchema.safeParse({ callId, conversationId: 'conversation-1', sdp: 'v=0\r\na=ice-ufrag:opaque' }).success).toBe(true);
    expect(callAnswerSchema.safeParse({ callId, sdp: 'v=0\r\na=setup:active' }).success).toBe(true);
    expect(callCandidateSchema.safeParse({ callId, candidate: 'candidate:1 1 UDP 1 192.0.2.1 9 typ host' }).success).toBe(true);
    expect(callHangupSchema.safeParse({ callId }).success).toBe(true);
  });

  it('rejects malformed and oversized signalling data', () => {
    expect(callOfferSchema.safeParse({ callId: 'not-a-uuid', conversationId: 'conversation-1', sdp: 'v=0' }).success).toBe(false);
    expect(callOfferSchema.safeParse({ callId, conversationId: 'conversation-1', sdp: 'x'.repeat(16_385) }).success).toBe(false);
    expect(callCandidateSchema.safeParse({ callId, candidate: 'x'.repeat(4_097) }).success).toBe(false);
    expect(callAnswerSchema.safeParse({ callId, sdp: '' }).success).toBe(false);
  });
});
