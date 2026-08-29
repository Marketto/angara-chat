import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8');

describe('conversation scroll positioning', () => {
  it('opens a conversation at the bottom without animation and keeps it pinned while images load', () => {
    expect(app).toContain("await scrollToBottom('auto');");
    expect(app).toMatch(/function scrollToBottom\(behavior: ScrollBehavior = 'smooth'\)/u);
    expect(app).toContain('@scroll.passive="updateScrollPin"');
    expect(app).toContain('@load="maintainPinnedScroll"');
  });
});
