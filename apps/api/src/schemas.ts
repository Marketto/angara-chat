import { z } from 'zod';

export const googleCredentialSchema = z.object({ credential: z.string().min(100).max(10_000) });
export const localTestLoginSchema = z.object({ email: z.string().email().max(254).transform((email) => email.trim().toLowerCase()) });
export const contactDiscoverySchema = z.object({
  emails: z.array(z.string().email().transform((email) => email.trim().toLowerCase())).max(500),
});
export const createConversationSchema = z.object({ participantId: z.string().min(1).max(128) });
export const conversationIdSchema = z.string().min(1).max(128);
export const plaintextMessageSchema = z.object({ conversationId: z.string().min(1).max(128), clientId: z.string().uuid(), body: z.string().trim().min(1).max(4000) });
const pushServiceDomains = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
function trustedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && pushServiceDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine(trustedPushEndpoint, 'Unsupported push service'),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
export const logoutSchema = z.object({ pushEndpoint: z.string().url().max(4096).optional() });
export const clientLogSchema = z.object({ code: z.string().regex(/^[A-Z0-9_:-]{1,80}$/), context: z.string().max(120).optional() });
