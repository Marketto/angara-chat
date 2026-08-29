import type { QueuedMessage } from './outbox';
import type { MessageSendAcknowledgement } from './types';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
] as const;

export type AttachmentKind = 'IMAGE' | 'DOCUMENT';
export type AttachmentError = 'TOO_LARGE' | 'UNSUPPORTED_TYPE';

export function attachmentError(file: File, kind: AttachmentKind): AttachmentError | null {
  if (file.size > MAX_ATTACHMENT_BYTES) return 'TOO_LARGE';
  const allowed: readonly string[] = kind === 'IMAGE' ? IMAGE_MIME_TYPES : DOCUMENT_MIME_TYPES;
  return allowed.includes(file.type.toLowerCase()) ? null : 'UNSUPPORTED_TYPE';
}

export async function validateAttachment(file: File, kind: AttachmentKind): Promise<AttachmentError | null> {
  const basicError = attachmentError(file, kind);
  if (basicError || kind !== 'DOCUMENT' || file.type.toLowerCase() !== 'text/plain') return basicError;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    return text.includes('\0') ? 'UNSUPPORTED_TYPE' : null;
  } catch {
    return 'UNSUPPORTED_TYPE';
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface DeliveryDependencies {
  upload(message: QueuedMessage): Promise<MessageSendAcknowledgement | null>;
  sendSocket(message: QueuedMessage): Promise<MessageSendAcknowledgement | null>;
}

export function deliverQueuedMessage(message: QueuedMessage, dependencies: DeliveryDependencies) {
  return message.attachmentUpload ? dependencies.upload(message) : dependencies.sendSocket(message);
}

export function attachmentUploadFailure(status: number, retryAfterMs?: number): MessageSendAcknowledgement | null {
  if (status === 403 || status === 404) return { ok: false, error: 'FORBIDDEN' };
  if ([400, 413, 415, 422].includes(status)) return { ok: false, error: 'INVALID_MESSAGE' };
  if (status === 409) return { ok: false, error: 'CLIENT_ID_CONFLICT' };
  if (status === 429) return { ok: false, error: 'RATE_LIMITED', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  return null;
}

export function openStreetMapUrl(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}
