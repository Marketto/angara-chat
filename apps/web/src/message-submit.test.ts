import { describe, expect, it } from 'vitest';
import { claimDraft, restoreDraft } from './message-submit';

describe('message submission', () => {
  it('claims the draft synchronously so a second submit cannot duplicate it', () => {
    const draft = { value: '  stesso messaggio  ' };

    expect(claimDraft(draft)).toBe('stesso messaggio');
    expect(claimDraft(draft)).toBeNull();
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
