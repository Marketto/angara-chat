export interface User { id: string; email?: string; name: string; avatarUrl: string | null }
export interface Message {
  id: string; clientId: string; conversationId?: string; senderId: string; body: string; createdAt: string;
}
export interface DecryptedMessage extends Message { body: string; decryptionFailed?: boolean }
export interface Conversation { id: string; peer: User | null; lastMessage: { createdAt: string } | null }
export interface PublicConfig { googleClientId: string; vapidPublicKey: string; buildVersion: string }
export interface ContactInfo { name?: string[]; email?: string[]; tel?: string[] }
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Navigator {
    contacts?: { select(properties: string[], options: { multiple: boolean }): Promise<ContactInfo[]> };
  }
  interface Window {
    onbeforeinstallprompt?: (event: InstallPromptEvent) => void;
    google?: { accounts: { id: {
      initialize(options: { client_id: string; callback?: (response: { credential: string }) => void; ux_mode?: 'popup' | 'redirect'; login_uri?: string }): void;
      renderButton(parent: HTMLElement, options: Record<string, string>): void;
    } } };
  }
}
