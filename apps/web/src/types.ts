export interface User { id: string; email?: string; name: string; avatarUrl: string | null }
export interface PublicDevice { id: string; publicKey: JsonWebKey; fingerprint: string }
export interface LocalDevice extends PublicDevice { privateKey: CryptoKey }
export interface Message {
  id: string; clientId: string; conversationId?: string; senderId: string; senderDeviceId: string;
  recipientDeviceId: string; ciphertext: string; iv: string; version: 1; createdAt: string;
}
export interface DecryptedMessage extends Message { body: string; decryptionFailed?: boolean }
export interface Conversation { id: string; peer: (User & { device: PublicDevice | null }) | null; lastMessage: { createdAt: string } | null }
export interface PublicConfig { googleClientId: string; vapidPublicKey: string }
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
      initialize(options: { client_id: string; callback(response: { credential: string }): void }): void;
      renderButton(parent: HTMLElement, options: Record<string, string>): void;
    } } };
  }
}
