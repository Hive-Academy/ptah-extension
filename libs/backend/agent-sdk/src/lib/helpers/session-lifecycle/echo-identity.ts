import type { QueuedUserTurn, SessionRecord } from './session-registry.service';

type EchoIdentityRecord = Pick<SessionRecord, 'awaitingEcho'> & Partial<
  Pick<SessionRecord,
    'currentTurnClientMessageId' | 'yieldSequence' | 'resultYieldSequence'>
>;

/** Match only the factory UUID; identical text is not evidence of identity. */
export function takeAwaitingEcho(
  rec: EchoIdentityRecord | null | undefined,
  echo: { readonly uuid?: string },
): QueuedUserTurn | null {
  const turn = rec?.awaitingEcho;
  if (
    !rec ||
    !turn ||
    typeof echo.uuid !== 'string' ||
    echo.uuid.length === 0 ||
    echo.uuid !== turn.message.uuid
  )
    return null;
  rec.awaitingEcho = null;
  if (rec.resultYieldSequence === (rec.yieldSequence ?? 0)) {
    const retiredBeforeEcho = rec.currentTurnClientMessageId === null;
    rec.currentTurnClientMessageId = null;
    // The echo itself acknowledges the id when a queue held the result.
    // If the idle-result fallback already emitted it, avoid a second signal.
    return retiredBeforeEcho ? { ...turn, clientMessageId: undefined } : turn;
  }
  return turn;
}

/** Read at echo time so humans enqueued since the yield are included. */
export function firstQueuedClientMessageId(
  rec: Pick<SessionRecord, 'messageQueue'> | null | undefined,
): string | undefined {
  return rec?.messageQueue.find(
    ({ message }) =>
      message.origin === undefined || message.origin.kind === 'human',
  )?.clientMessageId;
}
