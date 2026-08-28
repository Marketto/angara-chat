import { describe, expect, it } from 'vitest';
import { claimDraft, isRapidDuplicateSubmission, restoreDraft } from './message-submit';

describe('message submission', () => {
  it('claims the draft synchronously so a second submit cannot duplicate it', () => {
    const draft = { value: '  stesso messaggio  ' };

    expect(claimDraft(draft)).toBe('stesso messaggio');
    expect(claimDraft(draft)).toBeNull();
  });

  it('rejects the same rapid submission recreated by a mobile input event', () => {
    const previous = { conversationId: 'conversation-1', body: 'stesso messaggio', submittedAt: 1_000 };

    expect(isRapidDuplicateSubmission(previous, { ...previous, submittedAt: 1_130 })).toBe(true);
    expect(isRapidDuplicateSubmission(previous, { ...previous, submittedAt: 2_001 })).toBe(false);
    expect(isRapidDuplicateSubmission(previous, { ...previous, body: 'altro', submittedAt: 1_130 })).toBe(false);
  });

  it('does not overwrite text typed while a failed send was pending', () => {
    const draft = { value: 'nuovo testo' };

    restoreDraft(draft, 'messaggio fallito');

    expect(draft.value).toBe('nuovo testo');
  });

  it('restores a failed message when the draft is still empty', () => {
    const draft = { value: '' };

    restoreDraft(draft, 'messaggio fallito');

    expect(draft.value).toBe('messaggio fallito');
  });
});
