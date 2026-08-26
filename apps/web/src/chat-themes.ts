export const chatThemes = ['siberian-border', 'irtysh', 'steppe', 'winter'] as const;

export type ChatTheme = typeof chatThemes[number];

export function pickChatTheme(random: () => number = Math.random): ChatTheme {
  return chatThemes[Math.floor(random() * chatThemes.length)] ?? chatThemes[0];
}
