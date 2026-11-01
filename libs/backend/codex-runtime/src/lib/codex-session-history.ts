import { CodexHomeMismatchError, CodexRequestRejectedError } from './codex-app-server-process';
import {
  CodexProtocolError,
  type CodexRequestParams,
  type CodexRequestResult,
} from './codex-protocol-validator';
import type { CodexHistoryThread, CodexHistoryTurn, CodexSessionHistory } from './codex-runtime.types';

type HistoryMethod = 'thread/read' | 'thread/list' | 'thread/turns/list' | 'thread/items/list';
export type CodexHistoryRequest = <M extends HistoryMethod>(
  method: M,
  params: CodexRequestParams<M>,
) => Promise<CodexRequestResult<M>>;

export type CodexSessionHistoryErrorCode =
  | 'threadNotFound'
  | 'malformedPage'
  | 'stalledCursor'
  | 'pageLimitExceeded'
  | 'homeMismatch'
  | 'requestRejected'
  | 'processFailure';

/** No protocol payload or stderr is included in public history errors. */
export class CodexSessionHistoryError extends Error {
  constructor(readonly code: CodexSessionHistoryErrorCode, options?: ErrorOptions) {
    super(`Codex history ${code}`, options);
    this.name = 'CodexSessionHistoryError';
  }

  static from(error: unknown): CodexSessionHistoryError {
    if (error instanceof CodexSessionHistoryError) return error;
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      if (cause instanceof CodexHomeMismatchError)
        return new CodexSessionHistoryError('homeMismatch', { cause: error });
      if (cause instanceof CodexProtocolError && cause.code === 'invalidResult')
        return new CodexSessionHistoryError('malformedPage', { cause: error });
      if (cause instanceof CodexRequestRejectedError)
        return new CodexSessionHistoryError(
          cause.threadNotFound && cause.method === 'thread/read'
            ? 'threadNotFound' : 'requestRejected',
          { cause: error },
        );
      cause = cause.cause;
    }
    return new CodexSessionHistoryError('processFailure', { cause: error });
  }
}

const MAX_PAGES = 100;
const SOURCE_KINDS = [
  'cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
  'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown',
] as const;

/** Pinned schema fixture only: the live paginated and child shapes are UNCONFIRMED. */
export async function readCodexSessionHistory(
  rootThreadId: string,
  request: CodexHistoryRequest,
  assertOpen: () => void,
): Promise<CodexSessionHistory> {
  async function call<M extends HistoryMethod>(method: M, params: CodexRequestParams<M>): Promise<CodexRequestResult<M>> {
    assertOpen();
    let result: CodexRequestResult<M>;
    try {
      result = await request(method, params);
    } catch (error) {
      throw CodexSessionHistoryError.from(error);
    }
    assertOpen();
    return result;
  }

  async function pages<T>(
    fetch: (cursor?: string) => Promise<{ data: T[]; nextCursor?: string | null }>,
  ): Promise<T[]> {
    const data: T[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetch(cursor);
      if (!Array.isArray(result.data)) throw new CodexSessionHistoryError('malformedPage');
      data.push(...result.data);
      if (result.nextCursor == null) return data;
      if (!result.nextCursor.trim() || cursors.has(result.nextCursor))
        throw new CodexSessionHistoryError('stalledCursor');
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new CodexSessionHistoryError('pageLimitExceeded');
  }

  const root = (await call('thread/read', { threadId: rootThreadId })).thread;
  if (root.id !== rootThreadId)
    throw new CodexSessionHistoryError('malformedPage');

  const listed: CodexRequestResult<'thread/list'>['data'] = [];
  for (const archived of [false, true]) {
    listed.push(...await pages((cursor) => call('thread/list', {
      archived,
      limit: 100,
      sourceKinds: [...SOURCE_KINDS],
      ...(cursor !== undefined ? { cursor } : {}),
    })));
  }
  const candidates = new Map(listed.map((thread) => [thread.id, thread]));
  const selected = new Map([[root.id, root]]);
  let found = true;
  while (found) {
    found = false;
    for (const candidate of candidates.values()) {
      if (selected.has(candidate.id)) continue;
      if (candidate.parentThreadId && selected.has(candidate.parentThreadId)) {
        selected.set(candidate.id, candidate);
        found = true;
      }
    }
  }

  const children = [...selected.values()].filter((thread) => thread.id !== root.id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const threads: CodexHistoryThread[] = [];
  for (const listedThread of [root, ...children]) {
    const metadata = listedThread.id === root.id
      ? root
      : (await call('thread/read', { threadId: listedThread.id })).thread;
    if (metadata.id !== listedThread.id ||
        metadata.sessionId !== listedThread.sessionId ||
        metadata.parentThreadId !== listedThread.parentThreadId)
      throw new CodexSessionHistoryError('malformedPage');
    const paginated = metadata.historyMode === 'paginated';
    const base = paginated
      ? metadata
      : (await call('thread/read', { threadId: metadata.id, includeTurns: true })).thread;
    if (base.id !== metadata.id) throw new CodexSessionHistoryError('malformedPage');
    const turns = paginated
      ? await pages((cursor) => call('thread/turns/list', {
          threadId: base.id, sortDirection: 'asc', itemsView: 'full', limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
        }))
      : base.turns;
    const hydrated: CodexHistoryTurn[] = [];
    const seenTurns = new Set<string>();
    for (const turn of turns) {
      if (seenTurns.has(turn.id)) throw new CodexSessionHistoryError('malformedPage');
      seenTurns.add(turn.id);
      if (turn.itemsView === 'full' || (turn.itemsView === undefined && turn.items.length > 0)) {
        hydrated.push(turn);
        continue;
      }
      const entries = await pages((cursor) => call('thread/items/list', {
        threadId: base.id, turnId: turn.id, sortDirection: 'asc', limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      }));
      if (entries.some((entry) => entry.turnId !== turn.id))
        throw new CodexSessionHistoryError('malformedPage');
      const itemIds = new Map<string, (typeof entries)[number]['item']>();
      for (const entry of entries) {
        if (itemIds.has(entry.item.id)) throw new CodexSessionHistoryError('malformedPage');
        itemIds.set(entry.item.id, entry.item);
      }
      const embeddedIds = new Set<string>();
      for (const item of turn.items) {
        if (embeddedIds.has(item.id)) throw new CodexSessionHistoryError('malformedPage');
        embeddedIds.add(item.id);
        const paged = itemIds.get(item.id);
        if (!paged || JSON.stringify(paged) !== JSON.stringify(item))
          throw new CodexSessionHistoryError('malformedPage');
      }
      hydrated.push({ ...turn, items: entries.map((entry) => entry.item), itemsView: 'full', itemEntries: entries });
    }
    threads.push({ ...base, turns: hydrated });
  }
  return { rootThreadId, threads };
}
