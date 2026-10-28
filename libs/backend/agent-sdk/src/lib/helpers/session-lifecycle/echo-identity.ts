import type { QueuedUserTurn, SessionRecord } from './session-registry.service';

/** Match only the factory UUID; identical text is not evidence of identity. */
export function takeAwaitingEcho(
  rec: Pick<SessionRecord, 'awaitingEcho'> | null | undefined,
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
