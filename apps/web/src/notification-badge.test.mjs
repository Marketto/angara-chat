import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notificationBadgeStats, renderNotificationBadge } from '../scripts/generate-notification-badge.mjs';

describe('notification badge asset', () => {
  it('is reproducible and keeps most pixels transparent', () => {
    const mask = notificationBadgeStats();
    const painted = mask.reduce((total, pixel) => total + pixel, 0);

    expect(painted / mask.length).toBeLessThan(0.4);
    expect(renderNotificationBadge()).toEqual(readFileSync(new URL('../public/notification-badge.png', import.meta.url)));
  });
});
