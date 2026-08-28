import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

describe('desktop chat layout', () => {
  it('keeps the composer visible while the message list scrolls', () => {
    expect(stylesheet).toMatch(/\.chat\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(stylesheet).toMatch(/\.messages\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
    expect(stylesheet).toMatch(/\.composer\s*\{[^}]*flex:\s*0 0 auto;/s);
  });
});
