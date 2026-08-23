import type { ContactInfo } from './types';

export function contactEmails(contacts: ContactInfo[]): string[] {
  return [...new Set(contacts.flatMap(({ email }) => email ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
