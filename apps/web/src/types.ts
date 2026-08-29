export interface User { id: string; email?: string; name: string; avatarUrl: string | null }
export type MessageKind = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'LOCATION';
export interface Attachment {
  id: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}
export interface Message {
  id: string; clientId: string; conversationId?: string; senderId: string; kind?: MessageKind; body: string; createdAt: string; deliveryState?: 'queued' | 'sending' | 'failed';
  attachment?: Attachment | null;
  locationLatitude?: number | null;
  locationLongitude?: number | null;
  locationAccuracy?: number | null;
}
export type MessageSendError = 'RATE_LIMITED' | 'INVALID_MESSAGE' | 'FORBIDDEN' | 'CLIENT_ID_CONFLICT' | 'INTERNAL_ERROR';
export type PermanentMessageSendError = Extract<MessageSendError, 'INVALID_MESSAGE' | 'FORBIDDEN' | 'CLIENT_ID_CONFLICT'>;
export type MessageSendAcknowledgement = { ok: true; message: Message } | { ok: false; error: MessageSendError; retryAfterMs?: number };
export interface DecryptedMessage extends Message { body: string; decryptionFailed?: boolean }
export interface Conversation { id: string; peer: User | null; lastMessage: { createdAt: string } | null }
export interface PublicConfig { googleClientId: string; vapidPublicKey: string; buildVersion: string; localTestAuthEnabled: boolean }
export interface IceServer { urls: string[]; username?: string; credential?: string }
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
    }; oauth2?: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
    } } };
  }
}
