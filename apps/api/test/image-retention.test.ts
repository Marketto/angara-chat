import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMany = vi.fn();
vi.mock('../src/db.js', () => ({ db: { messageAttachment: { updateMany } } }));

describe('ephemeral image retention', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('purges only expired image bytes while retaining their metadata rows', async () => {
    updateMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-08-31T12:00:00.000Z');
    const { purgeExpiredImages } = await import('../src/image-retention.js');

    await expect(purgeExpiredImages(now)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        data: { not: null },
        expiresAt: { lte: now },
        message: { kind: 'IMAGE' },
      },
      data: { data: null, purgedAt: now },
    });
  });

  it('sweeps immediately and every minute until shutdown', async () => {
    vi.useFakeTimers();
    updateMany.mockResolvedValue({ count: 0 });
    const { startImageRetention } = await import('../src/image-retention.js');

    const stop = startImageRetention();
    await Promise.resolve();
    expect(updateMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateMany).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
