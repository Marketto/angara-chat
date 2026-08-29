import { describe, expect, it, vi } from 'vitest';
import { createOutboxWakeup } from './outbox-wakeup';

describe('outbox wake-up', () => {
  it('starts delivery without waiting for a slow history refresh', async () => {
    let releaseSynchronization!: () => void;
    const synchronization = new Promise<void>((resolve) => { releaseSynchronization = resolve; });
    const flushOutbox = vi.fn(async () => undefined);
    const synchronize = vi.fn(() => synchronization);
    const wakeup = createOutboxWakeup({
      isConnected: () => true,
      connect: vi.fn(),
      flushOutbox,
      synchronize,
    });

    const resuming = wakeup.deliveryReady();
    await Promise.resolve();

    expect(flushOutbox).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledTimes(1);
    releaseSynchronization();
    await resuming;
  });

  it('drains immediately whenever a socket connection becomes available', async () => {
    const flushOutbox = vi.fn(async () => undefined);
    const wakeup = createOutboxWakeup({
      isConnected: () => true,
      connect: vi.fn(),
      flushOutbox,
      synchronize: vi.fn(async () => undefined),
    });

    wakeup.socketConnected();
    await Promise.resolve();

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('connects on online or focus and drains directly if already connected', async () => {
    let connected = false;
    const connect = vi.fn(() => { connected = true; });
    const flushOutbox = vi.fn(async () => undefined);
    const wakeup = createOutboxWakeup({
      isConnected: () => connected,
      connect,
      flushOutbox,
      synchronize: vi.fn(async () => undefined),
    });

    wakeup.connectivityAvailable();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(flushOutbox).not.toHaveBeenCalled();

    wakeup.connectivityAvailable();
    await Promise.resolve();
    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });
});
