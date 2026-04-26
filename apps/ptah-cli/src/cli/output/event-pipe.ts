/**
 * Backend push events (`pushAdapter` EventEmitter) → JSON-RPC notifications
 * on stdout via the `Formatter`.
 *
 * TASK_2026_104 Batch 3.
 *
 * The `pushAdapter` is a generic `EventEmitter`. Backend services call
 * `sendMessage(viewType, type, payload)` which fires `emit(type, payload)`.
 * This pipe subscribes to a fixed mapping table from backend event types to
 * Ptah JSON-RPC notification methods, transforms the payload, and forwards.
 *
 * Cost and token usage are emitted as **deltas per turn**. The pipe tracks a
 * running total per session and computes `delta = current_total - previous`
 * before forwarding.
 *
 * No DI imports beyond the EventEmitter type — the pipe is fully decoupled
 * from tsyringe and from the actual `CliWebviewManagerAdapter` class. Tests
 * pass a vanilla `EventEmitter`.
 */

import type { EventEmitter } from 'node:events';

import type { PtahNotification } from '../jsonrpc/types.js';
import type { Formatter } from './formatter.js';

/** Mapping table from backend event type → Ptah notification method. */
export const EVENT_MAP: Readonly<Record<string, PtahNotification>> = {
  // Agent stream
  'chat:chunk': 'agent.message',
  'chat:thought': 'agent.thought',
  'chat:tool_use': 'agent.tool_use',
  'chat:tool_result': 'agent.tool_result',
  'tool:start': 'agent.tool_use',
  'tool:end': 'agent.tool_result',
  // Session metering — handled specially (delta computation below).
  'session:cost': 'session.cost',
  'session:cost-delta': 'session.cost',
  'session:tokens': 'session.token_usage',
  'session:token-delta': 'session.token_usage',
  // Task lifecycle
  'task:start': 'task.start',
  'task:complete': 'task.complete',
  'task:error': 'task.error',
  // Diagnostics — only forwarded when `globals.verbose === true`. The CLI
  // DI container emits `debug.di.phase` events at the start/end of each
  // numbered bootstrap phase (see `apps/ptah-cli/src/di/container.ts`).
  // TASK_2026_104 Batch 4 (task-description.md § 4.1.9).
  'debug.di.phase': 'debug.di.phase',
  // Resource Catalog — TASK_2026_104 Sub-batch B6b (task-description.md §4.1.5).
  // Forwarded only when backend services emit them. The CLI commands themselves
  // emit the same notifications synchronously via `formatter.writeNotification`,
  // so these mappings exist for parity with Electron push events (e.g. when
  // a remote install pipeline completes asynchronously).
  'skill:installed': 'skill.installed',
  'skill:removed': 'skill.removed',
  'mcp:installed': 'mcp.installed',
  'mcp:uninstalled': 'mcp.uninstalled',
};

/** Backend event types that must be transformed into per-turn deltas. */
const COST_EVENTS = new Set(['session:cost', 'session:cost-delta']);
const TOKEN_EVENTS = new Set(['session:tokens', 'session:token-delta']);
/** Backend event types gated behind `--verbose`. */
const VERBOSE_ONLY_EVENTS = new Set(['debug.di.phase']);

interface RunningCost {
  totalUsd: number;
}

interface RunningTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Subset of resolved global flags the pipe cares about. */
export interface EventPipeGlobals {
  /** When true, `debug.*` events are forwarded; otherwise dropped. */
  verbose?: boolean;
}

/** Subscribes to a `pushAdapter` and forwards events as JSON-RPC notifications. */
export class EventPipe {
  private adapter: EventEmitter | null = null;
  /** Per-event-name listener references kept so we can `off()` cleanly. */
  private readonly listeners = new Map<string, (payload: unknown) => void>();
  /** Running cost totals keyed by session_id (or `'_default'`). */
  private readonly costBySession = new Map<string, RunningCost>();
  /** Running token totals keyed by session_id. */
  private readonly tokensBySession = new Map<string, RunningTokens>();
  /** Resolved verbose flag — gates VERBOSE_ONLY_EVENTS. */
  private readonly verbose: boolean;

  constructor(
    private readonly formatter: Formatter,
    globals: EventPipeGlobals = {},
  ) {
    this.verbose = globals.verbose === true;
  }

  /** Subscribe to the adapter. Idempotent — second call rebinds to the new adapter. */
  attach(adapter: EventEmitter): void {
    if (this.adapter !== null) {
      this.detach();
    }
    this.adapter = adapter;
    for (const eventType of Object.keys(EVENT_MAP)) {
      const listener = (payload: unknown) => {
        // Fire-and-forget — formatter writes are queued and ordered.
        void this.handleEvent(eventType, payload);
      };
      this.listeners.set(eventType, listener);
      adapter.on(eventType, listener);
    }
  }

  /** Unsubscribe from the adapter. Resets per-session running totals. */
  detach(): void {
    if (this.adapter) {
      for (const [eventType, listener] of this.listeners) {
        this.adapter.off(eventType, listener);
      }
    }
    this.listeners.clear();
    this.adapter = null;
    this.costBySession.clear();
    this.tokensBySession.clear();
  }

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  private async handleEvent(
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    const method = EVENT_MAP[eventType];
    if (!method) return;

    // Verbose-only events are dropped silently when --verbose is off.
    if (VERBOSE_ONLY_EVENTS.has(eventType) && !this.verbose) {
      return;
    }

    if (COST_EVENTS.has(eventType)) {
      await this.handleCost(method, payload);
      return;
    }
    if (TOKEN_EVENTS.has(eventType)) {
      await this.handleTokens(method, payload);
      return;
    }
    await this.formatter.writeNotification(method, payload);
  }

  private async handleCost(
    method: PtahNotification,
    payload: unknown,
  ): Promise<void> {
    const obj = isObject(payload) ? payload : {};
    const sessionId = stringOr(obj['session_id'], '_default');
    const turnId = stringOr(obj['turn_id'], '');
    // Accept either a `delta_usd` (already computed) or a `total_usd` (compute
    // delta against running total).
    const explicitDelta = numberOr(obj['delta_usd'], null);
    const explicitTotal = numberOr(obj['total_usd'], null);

    const running = this.costBySession.get(sessionId) ?? { totalUsd: 0 };
    let delta: number;
    let total: number;
    if (explicitDelta !== null) {
      delta = explicitDelta;
      total = running.totalUsd + delta;
    } else if (explicitTotal !== null) {
      delta = explicitTotal - running.totalUsd;
      total = explicitTotal;
    } else {
      // No usable numeric — forward as-is, skip delta tracking.
      await this.formatter.writeNotification(method, payload);
      return;
    }
    this.costBySession.set(sessionId, { totalUsd: total });

    await this.formatter.writeNotification(method, {
      session_id: sessionId,
      turn_id: turnId,
      delta_usd: delta,
      total_usd: total,
    });
  }

  private async handleTokens(
    method: PtahNotification,
    payload: unknown,
  ): Promise<void> {
    const obj = isObject(payload) ? payload : {};
    const sessionId = stringOr(obj['session_id'], '_default');
    const turnId = stringOr(obj['turn_id'], '');
    // Two payload shapes accepted:
    //  (a) per-turn deltas already: { input_tokens, output_tokens, ... }
    //  (b) running totals: { total_input_tokens, total_output_tokens, ... }
    const inputTokens = numberOr(obj['input_tokens'], null);
    const outputTokens = numberOr(obj['output_tokens'], null);
    const cacheReadTokens = numberOr(obj['cache_read_tokens'], null);
    const cacheCreationTokens = numberOr(obj['cache_creation_tokens'], null);

    const totalInput = numberOr(obj['total_input_tokens'], null);
    const totalOutput = numberOr(obj['total_output_tokens'], null);

    const running =
      this.tokensBySession.get(sessionId) ??
      ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      } satisfies RunningTokens);

    let dInput: number;
    let dOutput: number;
    let dCacheRead = 0;
    let dCacheCreation = 0;

    if (inputTokens !== null || outputTokens !== null) {
      // Shape (a) — payload is already a delta.
      dInput = inputTokens ?? 0;
      dOutput = outputTokens ?? 0;
      dCacheRead = cacheReadTokens ?? 0;
      dCacheCreation = cacheCreationTokens ?? 0;
    } else if (totalInput !== null || totalOutput !== null) {
      // Shape (b) — compute delta against running totals.
      dInput = (totalInput ?? running.inputTokens) - running.inputTokens;
      dOutput = (totalOutput ?? running.outputTokens) - running.outputTokens;
    } else {
      // Nothing usable — forward as-is.
      await this.formatter.writeNotification(method, payload);
      return;
    }

    this.tokensBySession.set(sessionId, {
      inputTokens: running.inputTokens + dInput,
      outputTokens: running.outputTokens + dOutput,
      cacheReadTokens: running.cacheReadTokens + dCacheRead,
      cacheCreationTokens: running.cacheCreationTokens + dCacheCreation,
    });

    const params: Record<string, unknown> = {
      session_id: sessionId,
      turn_id: turnId,
      input_tokens: dInput,
      output_tokens: dOutput,
    };
    if (dCacheRead > 0) params['cache_read_tokens'] = dCacheRead;
    if (dCacheCreation > 0) params['cache_creation_tokens'] = dCacheCreation;
    await this.formatter.writeNotification(method, params);
  }
}

// ---------------------------------------------------------------------------
// Local helpers — kept module-private; tests rely only on observable behavior.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
