/**
 * SessionStatsReaderService — usage statistics without history replay.
 *
 * `session:stats-batch` used to call `SessionHistoryReaderService
 * .readSessionHistory()` per session: a full parse of the parent and every
 * subagent transcript into message arrays, a replay into stream events that
 * the handler then threw away, and a live-usage seed. For a 200-session
 * dashboard that was the dominant main-thread cost (TASK_2026_411).
 *
 * This service streams each transcript through
 * `JsonlReaderService.projectJsonlLines` into a usage ledger, caches ledgers
 * per file on an exact `(size, mtimeMs)` token, re-lists subagent membership on
 * every request, and prices tokens at serve time from the transcript's own
 * model id. It has no dependency on history replay, the model resolver or the
 * active auth environment.
 *
 * ## Work bounds per request
 *
 * - at most {@link SESSION_STATS_BATCH_MAX_IDS} session ids;
 * - at most {@link PARENT_FILE_CONCURRENCY} sessions (parent files) at once;
 * - at most {@link SUBAGENT_FILE_CONCURRENCY} subagent files at once, shared by
 *   the whole page;
 * - every read yields on the reader's line/byte budget and checks `signal`.
 *
 * An aborted session is reported `status: 'error'` and nothing it started is
 * cached.
 */

import { inject, injectable } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  findModelPricing,
  SESSION_STATS_BATCH_MAX_IDS,
  UUID_REGEX,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError } from '../errors';
import type { JsonlReaderService } from '../helpers/history/jsonl-reader.service';
import {
  SessionUsageLedgerBuilder,
  type SessionUsageLedger,
} from './session-usage-ledger';
import {
  SessionUsageLedgerCache,
  type TranscriptFileToken,
} from './session-usage-ledger-cache';
import {
  aggregateSessionUsage,
  emptySessionStats,
  failedSessionStats,
  type PricingLookup,
  type SessionStatsReadEntry,
  type SessionStatsScopeSelection,
} from './session-usage-aggregator';

/** Sessions (parent transcripts) processed at once. */
export const PARENT_FILE_CONCURRENCY = 2;

/** Subagent transcripts read at once, across the whole page. */
export const SUBAGENT_FILE_CONCURRENCY = 3;

export interface SessionStatsRequest {
  readonly sessionIds: readonly string[];
  readonly workspacePath: string;
  readonly scope: SessionStatsScopeSelection;
  readonly signal?: AbortSignal;
}

export interface DatedUsageRecord {
  readonly key: string;
  readonly timestampMs: number;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export type DatedUsageScanEntry =
  | { readonly kind: 'usage'; readonly record: DatedUsageRecord }
  | { readonly kind: 'unreadable' | 'untimestamped'; readonly count: number }
  | { readonly kind: 'limit' };

interface TranscriptFile {
  readonly filePath: string;
  readonly token: TranscriptFileToken;
}

/** Subagent files a session owns, plus member candidates that could not be read. */
interface SubagentMembership {
  readonly owned: readonly TranscriptFile[];
  readonly unreadable: number;
}

/** Per-request state shared by every session in one page. */
interface PageContext {
  readonly sessionsDir: string;
  readonly signal?: AbortSignal;
  readonly subagentSlots: Semaphore;
  /** Lazily listed flat `agent-*.jsonl` files (legacy layout), once per page. */
  legacyAgentFiles?: Promise<readonly TranscriptFile[]>;
}

@injectable()
export class SessionStatsReaderService {
  private readonly cache = new SessionUsageLedgerCache();

  /** The shared runtime rate card, read when each page is served. */
  private readonly lookupPricing: PricingLookup = findModelPricing;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonlReader: JsonlReaderService,
  ) {}

  /** Workspace scan with optional caller bounds. The caller authorizes workspacePath first. */
  async *scanDatedUsage(request: {
    readonly workspacePath: string;
    readonly since: number;
    readonly until: number;
    readonly signal?: AbortSignal;
    readonly maxFiles?: number;
    readonly maxRecords?: number;
  }): AsyncGenerator<DatedUsageScanEntry> {
    const { since, until, signal } = request;
    if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) {
      throw new SdkError('Invalid dated usage range');
    }
    const sessionsDir = await this.jsonlReader.findSessionsDirectory(request.workspacePath);
    if (!sessionsDir) return;
    const page: PageContext = {
      sessionsDir, signal, subagentSlots: new Semaphore(SUBAGENT_FILE_CONCURRENCY),
    };
    const names = (await fs.readdir(sessionsDir)).filter((name) =>
      UUID_REGEX.test(name.replace(/\.jsonl$/, '')) && name.endsWith('.jsonl'),
    ).sort((a, b) => a.localeCompare(b, 'en'));
    let scannedFiles = 0;
    let scannedRecords = 0;
    for (const name of names) {
      if (request.maxFiles !== undefined && scannedFiles >= request.maxFiles) { yield { kind: 'limit' }; return; }
      signal?.throwIfAborted();
      const sessionId = name.slice(0, -6);
      try {
        const parentPath = path.join(sessionsDir, name);
        const token = await statToken(parentPath);
        if (!token) continue;
        scannedFiles++;
        const parent = await this.ledgerFor({ filePath: parentPath, token }, signal);
        const members = await this.subagentMembers(sessionId, page);
        if (members.unreadable) yield { kind: 'unreadable', count: members.unreadable };
        const ledgers: Array<{ name: string; ledger: SessionUsageLedger }> = [
          { name: 'parent', ledger: parent },
        ];
        for (const member of members.owned) {
          if (request.maxFiles !== undefined && scannedFiles >= request.maxFiles) { yield { kind: 'limit' }; return; }
          try {
            ledgers.push({ name: path.basename(member.filePath), ledger: await this.ledgerFor(member, signal) });
            scannedFiles++;
          } catch {
            if (signal?.aborted) signal.throwIfAborted();
            yield { kind: 'unreadable', count: 1 };
          }
        }
        for (const { name: ledgerName, ledger } of ledgers) {
          for (let i = 0; i < ledger.records.length; i++) {
            if (request.maxRecords !== undefined && scannedRecords >= request.maxRecords) { yield { kind: 'limit' }; return; }
            scannedRecords++;
            const record = ledger.records[i];
            if (!record.hasUsage) continue;
            if (record.timestampMs === null) {
              yield { kind: 'untimestamped', count: 1 };
              continue;
            }
            if (record.timestampMs < since || record.timestampMs >= until) continue;
            yield { kind: 'usage', record: {
              key: record.messageId ? `${sessionId}:${record.messageId}` : `${sessionId}:${ledgerName}:${i}`,
              timestampMs: record.timestampMs,
              model: record.model ?? ledger.initModel ?? 'unknown',
              input: record.input, output: record.output,
              cacheRead: record.cacheRead, cacheCreation: record.cacheCreation,
            } };
          }
        }
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
        yield { kind: 'unreadable', count: 1 };
      }
    }
  }

  /**
   * Stats for each requested session, in request order. Never rejects for a
   * per-session failure; rejects only for an invalid request.
   */
  async readStats(
    request: SessionStatsRequest,
  ): Promise<SessionStatsReadEntry[]> {
    const { sessionIds, signal } = request;
    if (sessionIds.length > SESSION_STATS_BATCH_MAX_IDS) {
      throw new SdkError(
        `session stats request carries ${sessionIds.length} ids; max ${SESSION_STATS_BATCH_MAX_IDS}`,
      );
    }
    const invalid = sessionIds.find((id) => !UUID_REGEX.test(id));
    if (invalid !== undefined) {
      throw new SdkError('session stats request carries a non-UUID session id');
    }
    if (sessionIds.length === 0) return [];

    const sessionsDir = await this.jsonlReader.findSessionsDirectory(
      request.workspacePath,
    );
    if (!sessionsDir) return sessionIds.map(emptySessionStats);

    const page: PageContext = {
      sessionsDir,
      signal,
      subagentSlots: new Semaphore(SUBAGENT_FILE_CONCURRENCY),
    };
    const results: SessionStatsReadEntry[] = new Array(sessionIds.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < sessionIds.length) {
        const index = next++;
        results[index] = await this.readOne(
          sessionIds[index],
          request.scope,
          page,
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PARENT_FILE_CONCURRENCY, sessionIds.length) },
        worker,
      ),
    );
    return results;
  }

  private async readOne(
    sessionId: string,
    scope: SessionStatsScopeSelection,
    page: PageContext,
  ): Promise<SessionStatsReadEntry> {
    if (page.signal?.aborted) return failedSessionStats(sessionId);
    try {
      const parentPath = path.join(page.sessionsDir, `${sessionId}.jsonl`);
      const parentToken = await statToken(parentPath);
      if (!parentToken) return emptySessionStats(sessionId);

      const parent = await this.ledgerFor(
        { filePath: parentPath, token: parentToken },
        page.signal,
      );
      const membership = await this.subagentMembers(sessionId, page);
      const subagents: SessionUsageLedger[] = [];
      let unreadableSubagents = membership.unreadable;
      await Promise.all(
        membership.owned.map(async (file) => {
          try {
            const ledger = await page.subagentSlots.run(
              () => this.ledgerFor(file, page.signal),
              page.signal,
            );
            if (ledger) subagents.push(ledger);
          } catch (error: unknown) {
            if (page.signal?.aborted) throw error;
            unreadableSubagents++;
            this.logger.debug('[SessionStatsReader] Unreadable subagent file', {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );

      // Identity comes from the file NAME, so a member that could not be read
      // still counts as an agent; only coverage records that it was unread.
      const subagentIds = membership.owned.map((file) =>
        path.basename(file.filePath),
      );
      return aggregateSessionUsage(
        { sessionId, parent, subagents, unreadableSubagents, subagentIds, scope },
        this.lookupPricing,
      );
    } catch (error: unknown) {
      if (!page.signal?.aborted) {
        this.logger.warn('[SessionStatsReader] Could not read session stats', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return failedSessionStats(sessionId);
    }
  }

  /**
   * Subagent transcripts belonging to a session, listed and stat-ed fresh on
   * every request. Nested `{id}/subagents/agent-*.jsonl` wins; the flat legacy
   * layout is consulted only when no nested file exists, and a flat file
   * belongs to the session whose id is on its first record — the same rule as
   * `JsonlReaderService.loadAgentSessions`.
   *
   * A flat file that cannot be read has no provable owner, so it may be this
   * session's. It is reported in `unreadable` rather than dropped: dropping it
   * would let a session missing a subagent's tokens claim complete coverage.
   * Every legacy-layout session in the page therefore reports it — an honest
   * `partial` beats a confident `complete` that may be wrong.
   *
   * Ownership reads run concurrently through the page-wide subagent slots, so
   * the legacy scan is held to the same {@link SUBAGENT_FILE_CONCURRENCY} bound
   * as nested reads instead of reading one file at a time.
   */
  private async subagentMembers(
    sessionId: string,
    page: PageContext,
  ): Promise<SubagentMembership> {
    const nestedDir = path.join(page.sessionsDir, sessionId, 'subagents');
    const nested = await listAgentFiles(nestedDir);
    if (nested.length > 0) return { owned: nested, unreadable: 0 };

    page.legacyAgentFiles ??= listAgentFiles(page.sessionsDir);
    const flat = await page.legacyAgentFiles;
    const owners = await Promise.all(
      flat.map(async (file): Promise<string | null | undefined> => {
        try {
          const ledger = await page.subagentSlots.run(
            () => this.ledgerFor(file, page.signal),
            page.signal,
          );
          return ledger.firstSessionId;
        } catch (error: unknown) {
          if (page.signal?.aborted) throw error;
          this.logger.debug('[SessionStatsReader] Unreadable legacy subagent file', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        }
      }),
    );
    // `Promise.all` keeps input order, so `owned` stays in sorted file order.
    return {
      owned: flat.filter((_, i) => owners[i] === sessionId),
      unreadable: owners.filter((owner) => owner === undefined).length,
    };
  }

  private ledgerFor(
    file: TranscriptFile,
    signal: AbortSignal | undefined,
  ): Promise<SessionUsageLedger> {
    return this.cache.getOrProject(
      file.filePath,
      file.token,
      async () => {
        const builder = new SessionUsageLedgerBuilder();
        await this.jsonlReader.projectJsonlLines(
          file.filePath,
          (line) => builder.visit(line),
          { signal, byteLength: file.token.size },
        );
        return builder.build();
      },
      signal,
    );
  }
}

/** `(size, mtimeMs)` for a file, or `null` when it does not exist. */
async function statToken(filePath: string): Promise<TranscriptFileToken | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : null;
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Every `agent-*.jsonl` in `dir` with its token; `[]` when `dir` is absent. */
async function listAgentFiles(dir: string): Promise<readonly TranscriptFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // degradation-audit: optional-capability - a session with no subagents has
    // no subagents directory; an empty membership is the correct answer.
    return [];
  }
  const files: TranscriptFile[] = [];
  // An explicit comparator, and an explicit locale with it: the order is only
  // ever a determinism guarantee (`owned` is filtered in this order, and the
  // tallies below it are order-independent), so it must not vary with the
  // host's locale.
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
  for (const name of sorted) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
    const filePath = path.join(dir, name);
    const token = await statToken(filePath);
    if (token) files.push({ filePath, token });
  }
  return files;
}

/**
 * Shape check, not `instanceof Error`: fs errors can come from another realm
 * (a Jest sandbox, a worker), where `instanceof` is false for a real ENOENT.
 */
function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Minimal FIFO counting semaphore with abort while waiting. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      if (signal?.aborted) {
        // This waiter was handed the free slot; pass it on before leaving, or
        // the next waiter sleeps until some unrelated task finishes.
        this.waiters.shift()?.();
        signal.throwIfAborted();
      }
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
