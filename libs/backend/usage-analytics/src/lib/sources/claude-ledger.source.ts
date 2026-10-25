import { inject, injectable } from 'tsyringe';
import { SessionStatsReaderService } from '@ptah-extension/agent-sdk';
import type { ClaudeAccountResolvedResourceContext } from '@ptah-extension/auth-providers-tokens';
import type { UsageSource, UsageSourceResult, UsageContribution } from '../usage-source.types';

/** Existing per-scan caps, applied to every root. */
const MAX_FILES_PER_ROOT = 10_000;
const MAX_RECORDS_PER_ROOT = 100_000;
/** Observed named routes kept for historical scans; the oldest observation leaves first. */
export const MAX_OBSERVED_CLAUDE_ROUTES = 32;

const AMBIENT_ROUTE_KEY = 'ambient';

/**
 * Physical route identity. A named route is its certified directory identity
 * (volume + file id), so two discoveries of one directory, a re-login (new auth
 * epoch) or a revision bump stay one route. Never the quota owner: two
 * directories signed in to one account remain two transcript routes.
 */
function physicalRouteKey(context: ClaudeAccountResolvedResourceContext): string {
  return context.kind === 'named'
    ? JSON.stringify(['named', context.filesystemIdentity.volumeId, context.filesystemIdentity.fileId])
    : AMBIENT_ROUTE_KEY;
}

/** The reader's named-key prefix (`claudeResourceKey` + ':'); ambient keys carry none. */
function readerKeyPrefix(context: ClaudeAccountResolvedResourceContext): string {
  return context.kind === 'named'
    ? `${JSON.stringify([context.route.routeFingerprint, context.route.routeRevision, context.route.authEpoch])}:`
    : '';
}

interface RootScan {
  readonly unreadable: number;
  readonly untimestamped: number;
  readonly limited: boolean;
  readonly failure: 'none' | 'interrupted' | 'unavailable';
}

/**
 * Claude transcript usage. Reads the ambient `~/.claude/projects` root and every
 * observed named route once per physical route. Each event key is
 * `[physical route, session/event]`: the same SDK message id in two roots is two
 * events, and a root discovered twice contributes once. Event keys never use
 * the current auth epoch or owner, so a later re-login or an unknown owner read
 * does not re-key, merge or drop history recorded under that route.
 */
@injectable()
export class ClaudeLedgerSource implements UsageSource {
  private readonly observed = new Map<string, ClaudeAccountResolvedResourceContext>();

  constructor(@inject(SessionStatsReaderService) private readonly reader: SessionStatsReaderService) {}

  /**
   * Records a certified named route whose transcripts belong in usage history.
   * A later observation of the same physical route replaces the read context
   * (newer epoch) without changing that route's event keys. Ambient is always
   * read and is never stored here.
   */
  observeRoute(context: ClaudeAccountResolvedResourceContext): void {
    if (context.kind !== 'named') return;
    const key = physicalRouteKey(context);
    this.observed.delete(key);
    this.observed.set(key, context);
    while (this.observed.size > MAX_OBSERVED_CLAUDE_ROUTES) {
      const oldest = this.observed.keys().next().value;
      if (oldest === undefined) break;
      this.observed.delete(oldest);
    }
  }

  /** Stops reading a route, e.g. after its account is removed. History already summarised is unaffected. */
  forgetRoute(context: ClaudeAccountResolvedResourceContext): void {
    if (context.kind === 'named') this.observed.delete(physicalRouteKey(context));
  }

  async read(workspacePath: string, since: number, until: number, signal?: AbortSignal): Promise<UsageSourceResult> {
    return this.readRoots(workspacePath, since, until, [...this.observed.values()], signal);
  }

  /**
   * Scans ambient plus `roots`, each physical route once (first context wins
   * within one call). An unavailable named root makes the result partial; it
   * never falls back to another root.
   */
  async readRoots(
    workspacePath: string,
    since: number,
    until: number,
    roots: readonly ClaudeAccountResolvedResourceContext[],
    signal?: AbortSignal,
  ): Promise<UsageSourceResult> {
    const routes = new Map<string, ClaudeAccountResolvedResourceContext | undefined>([[AMBIENT_ROUTE_KEY, undefined]]);
    for (const root of roots) {
      const key = physicalRouteKey(root);
      if (!routes.has(key)) routes.set(key, root);
    }
    const contributions: UsageContribution[] = [];
    let unreadable = 0;
    let untimestamped = 0;
    let limited = false;
    let interrupted = false;
    let unavailable = false;
    for (const [routeKey, context] of routes) {
      if (signal?.aborted) { interrupted = true; break; }
      const scan = await this.scanRoot(routeKey, context, workspacePath, since, until, contributions, signal);
      unreadable += scan.unreadable;
      untimestamped += scan.untimestamped;
      limited ||= scan.limited;
      if (scan.failure === 'unavailable') unavailable = true;
      if (scan.failure === 'interrupted') { interrupted = true; break; }
    }
    if (interrupted) {
      return { contributions, status: { sourceId: 'claude-ledger', status: 'partial', reason: signal?.aborted ? 'time-budget' : 'Transcript scan interrupted' } };
    }
    const partial = unreadable || untimestamped || limited || unavailable;
    return {
      contributions,
      status: {
        sourceId: 'claude-ledger', status: partial ? 'partial' : 'complete',
        ...(limited
          ? { reason: 'scan-limit' }
          : unreadable || untimestamped
            ? { reason: 'Some transcripts were unreadable or lacked timestamps' }
            : unavailable
              ? { reason: 'Some account transcripts were unavailable' }
              : {}),
        ...(unreadable ? { malformedRecords: unreadable } : {}),
      },
    };
  }

  private async scanRoot(
    routeKey: string,
    context: ClaudeAccountResolvedResourceContext | undefined,
    workspacePath: string,
    since: number,
    until: number,
    out: UsageContribution[],
    signal?: AbortSignal,
  ): Promise<RootScan> {
    let unreadable = 0;
    let untimestamped = 0;
    let limited = false;
    const prefix = context ? readerKeyPrefix(context) : '';
    try {
      for await (const entry of this.reader.scanDatedUsage(
        { workspacePath, since, until, signal, maxFiles: MAX_FILES_PER_ROOT, maxRecords: MAX_RECORDS_PER_ROOT },
        context,
      )) {
        if (entry.kind === 'limit') { limited = true; break; }
        if (entry.kind === 'unreadable') { unreadable += entry.count; continue; }
        if (entry.kind === 'untimestamped') { untimestamped += entry.count; continue; }
        if (entry.kind !== 'usage') continue;
        const r = entry.record;
        const event = prefix && r.key.startsWith(prefix) ? r.key.slice(prefix.length) : r.key;
        out.push({
          key: JSON.stringify([routeKey, event]), timestampMs: r.timestampMs, providerId: 'anthropic',
          modelId: r.model, inputUncachedTokens: r.input, outputTokens: r.output,
          cacheReadTokens: r.cacheRead, cacheWriteTokens: r.cacheCreation,
          sourceId: 'claude-ledger', sessionId: event.slice(0, 36),
          sessionTitle: `Session ${event.slice(0, 8)}`,
          ...(r.subagentId ? { subagentId: r.subagentId } : {}),
        });
      }
    } catch {
      // Reported, not swallowed: the caller marks the source partial. A named
      // root that cannot be resolved is 'unavailable' and the other roots still
      // count; an abort or ambient failure ends the scan as before.
      const failure = !signal?.aborted && context?.kind === 'named' ? 'unavailable' : 'interrupted';
      return { unreadable, untimestamped, limited, failure };
    }
    return { unreadable, untimestamped, limited, failure: 'none' };
  }
}
