import { describe, expect, it } from 'vitest';
import { chatThemes, pickChatTheme } from './chat-themes';

describe('pickChatTheme', () => {
  it('selects the matching theme across the full random range', () => {
    expect(pickChatTheme(() => 0)).toBe('siberian-border');
    expect(pickChatTheme(() => 0.26)).toBe('irtysh');
    expect(pickChatTheme(() => 0.51)).toBe('steppe');
    expect(pickChatTheme(() => 0.99)).toBe('winter');
  });

  it('only returns supported themes', () => {
    expect(chatThemes).toContain(pickChatTheme(() => 0.74));
  });
});
