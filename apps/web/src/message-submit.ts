export interface DraftRef { value: string }
export interface MessageSubmission {
  conversationId: string;
  body: string;
  submittedAt: number;
}

const rapidSubmissionWindowMs = 1_000;

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

/** Ignore a mobile key/input double event without suppressing a later intentional repeat. */
export function isRapidDuplicateSubmission(previous: MessageSubmission | null, current: MessageSubmission) {
  return previous !== null
    && previous.conversationId === current.conversationId
    && previous.body === current.body
    && current.submittedAt >= previous.submittedAt
    && current.submittedAt - previous.submittedAt <= rapidSubmissionWindowMs;
}
