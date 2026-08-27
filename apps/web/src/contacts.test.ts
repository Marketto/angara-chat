import { describe, expect, it } from 'vitest';
import { contactEmails, gmailEmails } from './contacts';

describe('contactEmails', () => {
  it('extracts, normalizes and deduplicates only shared emails', () => {
    expect(contactEmails([
      { name: ['Mario'], email: [' Mario@Example.com '] },
      { name: ['Duplicate'], email: ['mario@example.com'] },
      { name: ['No email'], tel: ['+390000000'] },
    ])).toEqual(['mario@example.com']);
  });
});

describe('gmailEmails', () => {
  it('keeps only normalized Gmail addresses from Google contacts', () => {
    expect(gmailEmails([
      { emailAddresses: [{ value: ' Person@GMAIL.com ' }, { value: 'work@example.com' }] },
      { emailAddresses: [{ value: 'person@gmail.com' }] },
    ])).toEqual(['person@gmail.com']);
  });
});
