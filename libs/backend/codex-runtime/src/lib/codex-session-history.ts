import { CodexHomeMismatchError, CodexRequestRejectedError } from './codex-app-server-process';
import {
  CodexProtocolError,
  type CodexRequestParams,
  type CodexRequestResult,
} from './codex-protocol-validator';
import type { CodexRuntimeLogger } from './codex-runtime-ports';
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

// Preserve the former 10,000-row ceiling after reducing 100-row history pages to 25.
const MAX_PAGES = 400;
const HISTORY_PAGE_LIMIT = 25;
const SOURCE_KINDS = [
  'cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
  'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown',
] as const;

/** Read the root and any native descendants from the pinned app-server. */
export async function readCodexSessionHistory(
  rootThreadId: string,
  request: CodexHistoryRequest,
  assertOpen: () => void,
  logger: Pick<CodexRuntimeLogger, 'warn'>,
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

  async function hydrateThread(listedThread: typeof root): Promise<CodexHistoryThread> {
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
           threadId: base.id, sortDirection: 'asc', itemsView: 'full', limit: HISTORY_PAGE_LIMIT,
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
        threadId: base.id, turnId: turn.id, sortDirection: 'asc', limit: HISTORY_PAGE_LIMIT,
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
    return { ...base, turns: hydrated };
  }

  const threads: CodexHistoryThread[] = [await hydrateThread(root)];

  const listed: CodexRequestResult<'thread/list'>['data'] = [];
  const failures: { archived?: boolean; threadId?: string; reason: string; issues: string; rpcCode?: number }[] = [];
  let completedLists = 0;
  let failedLists = 0;
  let processFailed = false;

  function errorCauses(error: unknown): Error[] {
    let cause: unknown = error;
    const seen = new Set<unknown>();
    const causes: Error[] = [];
    while (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      causes.push(cause);
      cause = cause.cause;
    }
    return causes;
  }

  function recordFailure(error: unknown, context: { archived?: boolean; threadId?: string }): void {
    const causes = errorCauses(error);
    const protocol = causes.find((cause): cause is CodexProtocolError => cause instanceof CodexProtocolError);
    const rejected = causes.find((cause): cause is CodexRequestRejectedError => cause instanceof CodexRequestRejectedError);
    failures.push({
      ...context,
      reason: error instanceof CodexSessionHistoryError ? error.code : 'unknown',
      issues: protocol ? JSON.stringify(protocol.issues) : '[]',
      ...(rejected ? { rpcCode: rejected.rpcCode } : {}),
    });
  }

  async function listPages(archived: boolean, targeted: boolean): Promise<typeof listed> {
    return pages((cursor) => call('thread/list', {
      // Experimental in Codex 0.165.0 (verified live); initialize enables experimentalApi.
      // The pinned stable schema omits this parameter, so invalid params retries below.
      ...(targeted ? { ancestorThreadId: rootThreadId } : {}),
      archived,
      limit: 20,
      sourceKinds: [...SOURCE_KINDS],
      ...(cursor !== undefined ? { cursor } : {}),
    }));
  }

  for (const archived of [false, true]) {
    try {
      try {
        listed.push(...await listPages(archived, true));
      } catch (error) {
        assertOpen();
        const rejected = errorCauses(error).find((cause): cause is CodexRequestRejectedError =>
          cause instanceof CodexRequestRejectedError);
        if (rejected?.rpcCode !== -32602) throw error;
        listed.push(...await listPages(archived, false));
      }
      completedLists++;
    } catch (error) {
      // Descendant discovery is auxiliary; preserve the readable root history.
      assertOpen();
      failedLists++;
      recordFailure(error, { archived });
      if (error instanceof CodexSessionHistoryError && error.code === 'processFailure') {
        processFailed = true;
        break;
      }
    }
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
  if (!processFailed) {
    for (const listedThread of children) {
      try {
        threads.push(await hydrateThread(listedThread));
      } catch (error) {
        assertOpen();
        recordFailure(error, { threadId: listedThread.id });
        if (error instanceof CodexSessionHistoryError && error.code === 'processFailure') break;
      }
    }
  }
  if (failures.length > 0)
    logger.warn('Codex descendant discovery incomplete; continuing available history', {
      failures: JSON.stringify(failures),
      partialListing: completedLists > 0 && failedLists > 0,
      completedLists,
      failedLists,
    });
  return { rootThreadId, threads };
}
