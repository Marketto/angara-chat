import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './single-flight';

describe('single-flight drain', () => {
  it('reruns after a request made while the first pass is pending', async () => {
    let releaseFirst!: () => void;
    const firstPass = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let passes = 0;
    const drain = createSingleFlight(async () => {
      passes += 1;
      if (passes === 1) await firstPass;
      return true;
    });

    const running = drain();
    await drain();
    releaseFirst();
    await running;

    expect(passes).toBe(2);
  });

  it('does not lose a concurrent wake-up when the active pass cannot finish', async () => {
    let releaseFirst!: () => void;
    const firstPass = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let passes = 0;
    const drain = createSingleFlight(async () => {
      passes += 1;
      if (passes === 1) await firstPass;
      return false;
    });

    const running = drain();
    await drain();
    releaseFirst();
    await running;

    expect(passes).toBe(2);
  });
});
