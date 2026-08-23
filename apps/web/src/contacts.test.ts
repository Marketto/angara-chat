import { describe, expect, it } from 'vitest';
import { contactEmails } from './contacts';

describe('contactEmails', () => {
  it('extracts, normalizes and deduplicates only shared emails', () => {
    expect(contactEmails([
      { name: ['Mario'], email: [' Mario@Example.com '] },
      { name: ['Duplicate'], email: ['mario@example.com'] },
      { name: ['No email'], tel: ['+390000000'] },
    ])).toEqual(['mario@example.com']);
  });
});
