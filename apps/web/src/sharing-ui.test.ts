import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

describe('sharing UI security invariants', () => {
  it('loads official OpenStreetMap tiles only after an explicit map click', () => {
    expect(app).toContain('@click="loadLocationMap(message)"');
    expect(app).toContain("L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(app).not.toContain('{s}.tile.openstreetmap.org');
    expect(app).toContain("t('osmPrivacy')");
  });

  it('keeps attachments and map tiles out of service-worker runtime caches', () => {
    expect(serviceWorker).not.toMatch(/registerRoute|CacheFirst|NetworkFirst|StaleWhileRevalidate/);
    expect(serviceWorker).not.toContain('/api/attachments');
    expect(serviceWorker).not.toContain('tile.openstreetmap.org');
  });

  it('uses lazy images, click-only document links and never renders server HTML', () => {
    expect(app).toMatch(/class="message-image"[^>]+loading="lazy"/);
    expect(app).toMatch(/class="document-link"[^>]+:href="attachmentHref\(message\)"/);
    expect(app).not.toContain('v-html');
  });

  it('clears queued Blobs and revokes object URLs on logout', () => {
    expect(app).toContain('await outbox.clearUser(userId)');
    expect(app).toContain('revokeAllAttachmentUrls();');
    expect(app).toContain('URL.revokeObjectURL(url)');
  });

  it('keeps Leaflet panes below the share menu, dialogs and toast', () => {
    expect(styles).toMatch(/\.location-map\s*\{[^}]*isolation:\s*isolate/u);
    expect(styles).toMatch(/\.composer\s*\{[^}]*z-index:\s*1100/u);
    expect(styles).toMatch(/\.modal-backdrop\s*\{[^}]*z-index:\s*2000/u);
    expect(styles).toMatch(/\.toast\s*\{[^}]*z-index:\s*2100/u);
  });
});
