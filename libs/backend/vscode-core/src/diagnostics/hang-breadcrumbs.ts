/**
 * HangBreadcrumbs — what the main loop was doing when it froze.
 *
 * ## Why
 *
 * A `ptah-hang.log` line said only `lastLag`: a freeze was recorded, but not
 * whose. The RPC dispatcher, the MCP tool dispatcher and the SQLite timing
 * wrapper all know what they are running; this records it in a form the
 * watchdog worker can write while main is still frozen.
 *
 * ## Shape
 *
 * - `begin(kind, name)` returns a token; `end(token)` clears it. Both are O(1)
 *   map operations. The set is bounded at {@link MAX_IN_FLIGHT_OPS}; past it a
 *   begin is counted as dropped and returns {@link DROPPED_TOKEN}, which `end`
 *   ignores — so a leak in a caller can never grow memory.
 * - `noteSlowSql(label, durationMs)` keeps the label of the last slow SQL
 *   statement. The caller passes SQL text with `?` placeholders only, never
 *   bound parameters.
 *
 * ## Why changes are pushed, not sampled
 *
 * The watchdog heartbeat is 1 s. An RPC that begins and then blocks main
 * synchronously in the same tick would never ride a heartbeat: the next one
 * cannot fire until the block ends. So a change notifies the attached sink at
 * once, and the watchdog posts its breadcrumbs immediately. `postMessage`
 * enqueues synchronously, so the worker holds the begin even though main
 * freezes on the very next line. No sink attached (watchdog not armed, VS Code
 * tests) — begin/end are just two map operations.
 *
 * ## Why a process-wide instance
 *
 * The three producers live in three libraries, and the SQLite wrapper is not
 * built by the container. The instance is process-wide state in the same
 * sense as the watchdog it feeds: one main loop, one record of what it is
 * doing. Tests construct their own `HangBreadcrumbs`.
 */

/** Which dispatcher an in-flight operation came from. */
export type HangOpKind = 'rpc' | 'mcp';

/** Breadcrumb keys this class owns in the watchdog's breadcrumb map. */
export const HANG_BREADCRUMB_KEYS = {
  rpc: 'rpcInFlight',
  mcp: 'mcpInFlight',
  slowSql: 'lastSlowSql',
} as const;

/** Upper bound on tracked in-flight operations across both kinds. */
export const MAX_IN_FLIGHT_OPS = 64;

/** How many in-flight operations per kind a breadcrumb names. */
export const MAX_OPS_PER_BREADCRUMB = 6;

/** Characters of one operation or SQL name kept. */
export const MAX_OP_NAME_LENGTH = 80;

/** Returned by `begin` when the set is full; `end` ignores it. */
export const DROPPED_TOKEN = 0;

/** Receives the full breadcrumb set after every change. */
export type HangBreadcrumbSink = (breadcrumbs: Record<string, string>) => void;

interface InFlightOp {
  readonly kind: HangOpKind;
  readonly name: string;
  readonly startedAt: number;
}

export class HangBreadcrumbs {
  private readonly ops = new Map<number, InFlightOp>();
  private nextToken = 1;
  private dropped = 0;
  private lastSlowSql = '';
  private sink: HangBreadcrumbSink | undefined;

  /** @param now Epoch-ms clock. Test seam. */
  constructor(private readonly now: () => number = Date.now) {}

  /** Number of tracked in-flight operations. */
  get size(): number {
    return this.ops.size;
  }

  /**
   * Route every change to `sink`, replacing any previous one. When something
   * is already recorded the sink gets it at once, so a late attach does not
   * start blank; an empty recorder adds no keys until its first change.
   *
   * @returns A detach function that clears the sink only if it is still this one.
   */
  attach(sink: HangBreadcrumbSink): () => void {
    this.sink = sink;
    if (this.ops.size > 0 || this.lastSlowSql !== '') this.publish();
    return () => {
      if (this.sink === sink) this.sink = undefined;
    };
  }

  /** Record an operation entering a dispatcher. */
  begin(kind: HangOpKind, name: string): number {
    if (this.ops.size >= MAX_IN_FLIGHT_OPS) {
      this.dropped++;
      return DROPPED_TOKEN;
    }
    const token = this.nextToken++;
    this.ops.set(token, {
      kind,
      name: clip(name),
      startedAt: this.now(),
    });
    this.publish();
    return token;
  }

  /** Record an operation leaving its dispatcher. Unknown tokens are ignored. */
  end(token: number): void {
    if (token === DROPPED_TOKEN || !this.ops.delete(token)) return;
    this.publish();
  }

  /** Remember the label of the last slow SQL statement (no parameters). */
  noteSlowSql(label: string, durationMs: number): void {
    this.lastSlowSql = `${clip(label)} ${Math.round(durationMs)}ms at ${timeOfDay(this.now())}`;
    this.publish();
  }

  /**
   * The breadcrumbs as the watchdog carries them. In-flight operations are
   * listed oldest first — the oldest is the most likely culprit — each with
   * its start time of day (UTC, matching the hang line's ISO `time`).
   */
  snapshot(): Record<string, string> {
    const byKind: Record<HangOpKind, string[]> = { rpc: [], mcp: [] };
    const totals: Record<HangOpKind, number> = { rpc: 0, mcp: 0 };
    for (const op of this.ops.values()) {
      totals[op.kind]++;
      const list = byKind[op.kind];
      if (list.length < MAX_OPS_PER_BREADCRUMB) {
        list.push(`${op.name}@${timeOfDay(op.startedAt)}`);
      }
    }
    return {
      [HANG_BREADCRUMB_KEYS.rpc]: describe(
        byKind.rpc,
        totals.rpc,
        this.dropped,
      ),
      [HANG_BREADCRUMB_KEYS.mcp]: describe(byKind.mcp, totals.mcp, 0),
      [HANG_BREADCRUMB_KEYS.slowSql]: this.lastSlowSql,
    };
  }

  private publish(): void {
    const sink = this.sink;
    if (sink === undefined) return;
    sink(this.snapshot());
  }
}

function describe(names: string[], total: number, dropped: number): string {
  const hidden = total - names.length;
  let text = names.join(', ');
  if (hidden > 0) text += ` (+${hidden} more)`;
  if (dropped > 0) text += ` [dropped ${dropped}]`;
  return text;
}

function clip(text: string): string {
  return text.length > MAX_OP_NAME_LENGTH
    ? text.slice(0, MAX_OP_NAME_LENGTH)
    : text;
}

/** `14:03:11.482` (UTC). */
function timeOfDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 23);
}

/**
 * The process-wide recorder. Producers call `begin`/`end`/`noteSlowSql`; the
 * main-loop watchdog attaches to it when armed.
 */
export const hangBreadcrumbs = new HangBreadcrumbs();
