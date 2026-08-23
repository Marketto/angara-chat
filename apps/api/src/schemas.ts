import { z } from 'zod';

export const googleCredentialSchema = z.object({ credential: z.string().min(100).max(10_000) });
export const contactDiscoverySchema = z.object({
  emails: z.array(z.string().email().transform((email) => email.trim().toLowerCase())).max(500),
});
export const createConversationSchema = z.object({ participantId: z.string().min(1).max(128) });
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const publicKeySchema = z.object({
  kty: z.literal('EC'), crv: z.literal('P-256'), x: base64url.min(40).max(50), y: base64url.min(40).max(50),
  ext: z.literal(true).optional(), key_ops: z.array(z.string()).optional(),
}).strict();
export const deviceRegistrationSchema = z.object({ id: z.string().uuid(), publicKey: publicKeySchema });
export const encryptedMessageSchema = z.object({
  conversationId: z.string().min(1).max(128),
  clientId: z.string().uuid(),
  senderDeviceId: z.string().uuid(),
  recipientDeviceId: z.string().uuid(),
  iv: base64url.min(16).max(24),
  ciphertext: base64url.min(24).max(24_000),
  version: z.literal(1),
});
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
