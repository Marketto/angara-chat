import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, generateDeviceKeys } from './crypto';
import type { Message } from './types';

describe('Angara E2EE envelope', () => {
  it('round-trips between two device keys without server plaintext', async () => {
    const [alice, bob] = await Promise.all([generateDeviceKeys(), generateDeviceKeys()]);
    const context = {
      conversationId: 'conversation-1', clientId: crypto.randomUUID(), senderId: 'alice',
      senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(),
    };
    const envelope = await encryptText('ciao dalla taiga', alice.privateKey, {
      id: context.recipientDeviceId, publicKey: bob.publicKey, fingerprint: bob.fingerprint,
    }, context);
    expect(JSON.stringify(envelope)).not.toContain('ciao');
    const message: Message = { id: 'message-1', createdAt: new Date().toISOString(), ...context, ...envelope };
    await expect(decryptText(message, context.conversationId, bob.privateKey, {
      id: context.senderDeviceId, publicKey: alice.publicKey, fingerprint: alice.fingerprint,
    })).resolves.toBe('ciao dalla taiga');
  });

  it('rejects modified ciphertext', async () => {
    const [alice, bob] = await Promise.all([generateDeviceKeys(), generateDeviceKeys()]);
    const context = {
      conversationId: 'conversation-1', clientId: crypto.randomUUID(), senderId: 'alice',
      senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(),
    };
    const envelope = await encryptText('segreto', alice.privateKey, { id: context.recipientDeviceId, publicKey: bob.publicKey, fingerprint: bob.fingerprint }, context);
    const changedFirstByte = envelope.ciphertext[0] === 'A' ? 'B' : 'A';
    const message: Message = { id: 'message-1', createdAt: new Date().toISOString(), ...context, ...envelope, ciphertext: `${changedFirstByte}${envelope.ciphertext.slice(1)}` };
    await expect(decryptText(message, context.conversationId, bob.privateKey, {
      id: context.senderDeviceId, publicKey: alice.publicKey, fingerprint: alice.fingerprint,
    })).rejects.toThrow();
  });
});
