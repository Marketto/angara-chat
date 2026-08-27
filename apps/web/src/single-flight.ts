/** Coalesce requests while a drain pass is running, then run one more pass. */
export function createSingleFlight(task: () => Promise<boolean>) {
  let running = false;
  let requested = false;

  return async function run(): Promise<void> {
    if (running) {
      requested = true;
      return;
    }
    running = true;
    try {
      do {
        requested = false;
        if (!(await task())) return;
      } while (requested);
    } finally {
      running = false;
    }
  };
}
