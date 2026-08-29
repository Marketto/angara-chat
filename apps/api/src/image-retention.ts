import { db } from './db.js';

export const RETENTION_SWEEP_MS = 60_000;
// Expire one sweep early so a healthy process removes bytes no later than 48h after upload.
export const IMAGE_RETENTION_MS = 48 * 60 * 60_000 - RETENTION_SWEEP_MS;

/** Remove only expired image bytes; message and attachment metadata remain in history. */
export async function purgeExpiredImages(now = new Date()) {
  const result = await db.messageAttachment.updateMany({
    where: {
      data: { not: null },
      expiresAt: { lte: now },
      message: { kind: 'IMAGE' },
    },
    data: { data: null, purgedAt: now },
  });
  return result.count;
}

/** Sweep at startup and every minute; callers receive an explicit shutdown hook. */
export function startImageRetention() {
  const sweep = () => void purgeExpiredImages().catch(() => console.error('Failed to purge expired image bytes'));
  sweep();
  const timer = setInterval(sweep, RETENTION_SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}
