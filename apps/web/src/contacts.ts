import type { ContactInfo } from './types';

export function contactEmails(contacts: ContactInfo[]): string[] {
  return [...new Set(contacts.flatMap(({ email }) => email ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function gmailEmails(contacts: Array<{ emailAddresses?: Array<{ value?: string }> }>): string[] {
  return [...new Set(contacts.flatMap(({ emailAddresses }) => emailAddresses ?? [])
    .map(({ value }) => value?.trim().toLowerCase() ?? '')
    .filter((email) => email.endsWith('@gmail.com')))];
}
