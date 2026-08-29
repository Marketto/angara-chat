interface OutboxWakeupOptions {
  isConnected(): boolean;
  connect(): void;
  flushOutbox(): void | Promise<void>;
  synchronize(): Promise<void>;
}

function safelyStart(task: () => void | Promise<void>) {
  try {
    return Promise.resolve(task()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/** Keep persistent delivery independent from slower REST history synchronization. */
export function createOutboxWakeup(options: OutboxWakeupOptions) {
  return {
    connectivityAvailable() {
      if (!options.isConnected()) {
        options.connect();
        return;
      }
      void safelyStart(options.flushOutbox);
    },
    socketConnected() {
      void safelyStart(options.flushOutbox);
    },
    async deliveryReady() {
      const delivery = safelyStart(options.flushOutbox);
      const synchronization = safelyStart(options.synchronize);
      await Promise.all([delivery, synchronization]);
    },
  };
}
