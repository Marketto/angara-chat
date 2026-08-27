export interface DraftRef { value: string }

/** Claim the current text before any asynchronous outbox work can yield. */
export function claimDraft(draft: DraftRef): string | null {
  const body = draft.value.trim();
  if (!body) return null;
  draft.value = '';
  return body;
}

export function restoreDraft(draft: DraftRef, body: string) {
  if (!draft.value) draft.value = body;
}
