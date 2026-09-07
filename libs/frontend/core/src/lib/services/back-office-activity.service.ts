/**
 * BackOfficeActivityService — ten push messages become one bounded, coalesced
 * list of human sentences (TASK_2026_380, component 14d).
 *
 * Ptah does a lot of work the user never sees. Each subsystem already
 * broadcasts its own message for its own panel; this service is the one place
 * those become a single ordered stream a passive ticker can render.
 *
 * ## Coalescing is required, not an optimisation
 *
 * `indexing:progress` is broadcast per file and a workspace index emits
 * thousands. Without coalescing a single index would evict every other
 * subsystem from the ring within a second. An arriving item whose
 * `` `${source}:${kind}` `` matches the newest item AND lands within
 * {@link ACTIVITY_COALESCE_WINDOW_MS} of the last arrival **replaces** it in
 * place, keeping its position and its id. A fast stream therefore occupies
 * exactly one slot and renders as one line whose text changes.
 *
 * ## Harmless under VS Code by construction, not by a guard
 *
 * The service is a pure sink. Some of these messages do reach the VS Code
 * webview, and an unread ring costs one bounded array. Its only consumer is
 * `ElectronShellComponent`, which VS Code never renders — so no host branch is
 * added, because a host check would be a second thing to keep true.
 */

import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MESSAGE_TYPES,
  isActivityEventPayload,
  isBackendReadiness,
  isBootPhase,
  type ActivityEventPayload,
  type ActivityLevel,
  type ActivitySource,
  type BootPhase,
  type BootReadinessChangedPayload,
  type EmbedderStatusChangedPayload,
  type IndexingCompleteEvent,
  type IndexingProgressEvent,
  type MemoryCorpusChangedPayload,
  type MemoryExtractedPayload,
  type MemoryObservationCapturedPayload,
  type SkillSynthesisEventPayload,
  type SkillSynthesisEventWire,
  type VecStatusChangedPayload,
} from '@ptah-extension/shared';

import type { MessageHandler } from './message-router.types';

/** One rendered line of back-office activity. */
export interface ActivityItem {
  /** Stable within a ring slot, so a coalesced update is not a new item. */
  readonly id: string;
  readonly source: ActivitySource;
  /** Subsystem-local discriminator, e.g. `'progress'`, `'curated'`. */
  readonly kind: string;
  /** One human sentence. May be empty — the renderer falls back to `source`. */
  readonly summary: string;
  readonly timestamp: number;
  readonly level: ActivityLevel;
}

/** Ring size, matching `SkillSynthesisService.RING_CAPACITY` at the other end. */
export const ACTIVITY_RING_CAPACITY = 50;

/** Latest-wins window for two items sharing a `source:kind` key. */
export const ACTIVITY_COALESCE_WINDOW_MS = 750;

/** Quiet period after which the ticker collapses to its idle dot. */
export const ACTIVITY_IDLE_AFTER_MS = 8000;

/** How often the idle clock is re-read. Coarse on purpose — one timer. */
const IDLE_TICK_MS = 1000;

/** Display labels for the boot phases, when the host sends no `detail`. */
const BOOT_PHASE_LABELS: Readonly<Record<BootPhase, string>> = {
  starting: 'Starting up',
  database: 'Opening the database',
  harness: 'Syncing the agent harness',
  sessions: 'Importing sessions',
  index: 'Indexing the workspace',
  settled: 'Ready',
};

let itemCounter = 0;
function nextItemId(): string {
  itemCounter = (itemCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `activity-${itemCounter}`;
}

@Injectable({ providedIn: 'root' })
export class BackOfficeActivityService implements MessageHandler {
  private readonly destroyRef = inject(DestroyRef);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.ACTIVITY_EVENT,
    MESSAGE_TYPES.BOOT_READINESS_CHANGED,
    MESSAGE_TYPES.MEMORY_EXTRACTED,
    MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED,
    MESSAGE_TYPES.MEMORY_CORPUS_CHANGED,
    MESSAGE_TYPES.INDEXING_PROGRESS,
    MESSAGE_TYPES.INDEXING_COMPLETE,
    MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
    MESSAGE_TYPES.VEC_STATUS_CHANGED,
    MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
  ] as const;

  private readonly _items = signal<readonly ActivityItem[]>([]);
  /** Wall clock, re-read on a single interval so `isIdle` can settle itself. */
  private readonly _now = signal<number>(Date.now());
  private readonly _lastArrivalAt = signal<number>(0);

  /** Newest first, bounded by {@link ACTIVITY_RING_CAPACITY}. */
  readonly recent = this._items.asReadonly();

  readonly latest = computed<ActivityItem | null>(
    () => this._items()[0] ?? null,
  );

  /** True when nothing has arrived for {@link ACTIVITY_IDLE_AFTER_MS}. */
  readonly isIdle = computed<boolean>(() => {
    const lastAt = this._lastArrivalAt();
    if (lastAt === 0) return true;
    return this._now() - lastAt >= ACTIVITY_IDLE_AFTER_MS;
  });

  /** `source:kind` of the newest item, for the coalescing check. */
  private headKey: string | null = null;
  /** Arrival time of the newest item — a sliding window, not a fixed one. */
  private headArrivalAt = 0;
  /** Last vec/embedder snapshot seen, so a re-broadcast is not news. */
  private lastStatusFingerprint = new Map<string, string>();

  constructor() {
    const handle = setInterval(() => {
      this._now.set(Date.now());
    }, IDLE_TICK_MS);
    this.destroyRef.onDestroy(() => clearInterval(handle));
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    const item = this.mapMessage(message.type, message.payload);
    if (item) this.push(item);
  }

  /** One pure mapper per handled type; `null` means "do not narrate this". */
  private mapMessage(type: string, payload: unknown): ActivityItem | null {
    switch (type) {
      case MESSAGE_TYPES.ACTIVITY_EVENT:
        return mapActivityEvent(payload);
      case MESSAGE_TYPES.BOOT_READINESS_CHANGED:
        return mapBootReadiness(payload);
      case MESSAGE_TYPES.MEMORY_EXTRACTED:
        return mapMemoryExtracted(payload);
      case MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED:
        return mapMemoryObservation(payload);
      case MESSAGE_TYPES.MEMORY_CORPUS_CHANGED:
        return mapMemoryCorpus(payload);
      case MESSAGE_TYPES.INDEXING_PROGRESS:
        return mapIndexingProgress(payload);
      case MESSAGE_TYPES.INDEXING_COMPLETE:
        return mapIndexingComplete(payload);
      case MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT:
        return mapSkillSynthesis(payload);
      case MESSAGE_TYPES.VEC_STATUS_CHANGED:
        return this.mapVecStatus(payload);
      case MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED:
        return this.mapEmbedderStatus(payload);
      default:
        return null;
    }
  }

  private push(item: ActivityItem): void {
    const now = Date.now();
    const key = `${item.source}:${item.kind}`;
    const coalesce =
      this.headKey === key &&
      now - this.headArrivalAt < ACTIVITY_COALESCE_WINDOW_MS;

    this._items.update((list) => {
      if (coalesce && list.length > 0) {
        const next = list.slice();
        next[0] = { ...item, id: list[0].id };
        return next;
      }
      const next = [item, ...list];
      return next.length > ACTIVITY_RING_CAPACITY
        ? next.slice(0, ACTIVITY_RING_CAPACITY)
        : next;
    });

    this.headKey = key;
    this.headArrivalAt = now;
    this._lastArrivalAt.set(now);
    this._now.set(now);
  }

  /**
   * A status re-broadcast carrying the same snapshot is not news. Returns
   * `true` the first time a fingerprint is seen and after every real change.
   */
  private isNewStatus(key: string, fingerprint: string): boolean {
    if (this.lastStatusFingerprint.get(key) === fingerprint) return false;
    this.lastStatusFingerprint.set(key, fingerprint);
    return true;
  }

  private mapVecStatus(payload: unknown): ActivityItem | null {
    const body = payload as VecStatusChangedPayload | undefined;
    if (!body || typeof body.ok !== 'boolean') return null;
    const rawReason = body.diagnostic?.reason;
    const reason = typeof rawReason === 'string' ? rawReason : 'unknown';
    if (!this.isNewStatus('vec', `${body.ok}:${reason}`)) return null;
    return makeItem({
      source: 'vec',
      kind: body.ok ? 'online' : 'offline',
      summary: body.ok
        ? 'sqlite-vec is online.'
        : `sqlite-vec went offline (${reason}).`,
      level: body.ok ? 'info' : 'warn',
    });
  }

  private mapEmbedderStatus(payload: unknown): ActivityItem | null {
    const status = (payload as EmbedderStatusChangedPayload | undefined)
      ?.status;
    if (!status || typeof status.ready !== 'boolean') return null;
    const rawMessage = status.error?.message;
    const errorMessage = typeof rawMessage === 'string' ? rawMessage : '';
    const fingerprint = `${status.ready}:${status.downloading}:${errorMessage}`;
    if (!this.isNewStatus('embedder', fingerprint)) return null;

    if (errorMessage) {
      return makeItem({
        source: 'embedder',
        kind: 'error',
        summary: `Embedder error: ${errorMessage}`,
        level: 'warn',
      });
    }
    if (status.downloading) {
      const percent =
        typeof status.progress === 'number'
          ? ` ${Math.round(status.progress * 100)}%`
          : '';
      return makeItem({
        source: 'embedder',
        kind: 'downloading',
        summary: `Downloading the embedding model${percent}…`,
      });
    }
    return makeItem({
      source: 'embedder',
      kind: status.ready ? 'ready' : 'offline',
      summary: status.ready ? 'Embedder ready.' : 'Embedder is not available.',
      level: status.ready ? 'info' : 'warn',
    });
  }
}

/**
 * A wire `timestamp` is only trusted when it is actually a finite number.
 *
 * `?? Date.now()` alone substituted a default for `null`/`undefined` only, so a
 * timestamp sent as a string or an object flowed straight into a field the
 * `ActivityItem` contract types as `number`. Nothing crashed — it would surface
 * later, in whatever first sorts or formats it.
 */
function finiteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Date.now();
}

/** A stat is usable only when it coerces to a finite number. */
function finiteStat(value: unknown): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : null;
}

function makeItem(fields: {
  source: ActivitySource;
  kind: string;
  summary: string;
  level?: ActivityLevel;
  timestamp?: unknown;
}): ActivityItem {
  return {
    id: nextItemId(),
    source: fields.source,
    kind: fields.kind,
    summary: fields.summary,
    timestamp: finiteTimestamp(fields.timestamp),
    level: fields.level ?? 'info',
  };
}

function mapActivityEvent(payload: unknown): ActivityItem | null {
  if (!isActivityEventPayload(payload)) return null;
  const event: ActivityEventPayload = payload;
  return makeItem({
    source: event.source,
    kind: event.kind,
    summary: event.summary,
    timestamp: event.timestamp,
    level: event.level ?? 'info',
  });
}

function mapBootReadiness(payload: unknown): ActivityItem | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Partial<BootReadinessChangedPayload>;
  if (!isBackendReadiness(body.readiness) || !isBootPhase(body.phase)) {
    return null;
  }
  // The boot ending is not news — the ticker is for work still happening.
  if (body.phase === 'settled') return null;
  return makeItem({
    source: 'boot',
    kind: body.phase,
    // A non-string `detail` is ignored rather than stringified: the phase label
    // is always a truthful sentence, whereas "[object Object]" is not.
    summary:
      typeof body.detail === 'string'
        ? body.detail
        : BOOT_PHASE_LABELS[body.phase],
    level:
      body.readiness === 'failed' || body.readiness === 'degraded'
        ? 'warn'
        : 'info',
  });
}

function mapMemoryExtracted(payload: unknown): ActivityItem | null {
  const body = payload as MemoryExtractedPayload | undefined;
  if (
    !body ||
    typeof body.created !== 'number' ||
    !Number.isFinite(body.created)
  ) {
    return null;
  }
  const merged =
    typeof body.merged === 'number' && Number.isFinite(body.merged)
      ? body.merged
      : 0;
  return makeItem({
    source: 'memory',
    kind: 'curated',
    summary:
      merged > 0
        ? `Curated ${body.created} memories (${merged} merged)`
        : `Curated ${body.created} memories`,
    timestamp: body.timestamp,
  });
}

function mapMemoryObservation(payload: unknown): ActivityItem | null {
  const body = payload as MemoryObservationCapturedPayload | undefined;
  if (!body || typeof body.kind !== 'string') return null;
  return makeItem({
    source: 'memory',
    kind: 'observed',
    summary: `Captured a ${body.kind} observation`,
    timestamp: body.timestamp,
  });
}

function mapMemoryCorpus(payload: unknown): ActivityItem | null {
  const body = payload as MemoryCorpusChangedPayload | undefined;
  if (
    !body ||
    typeof body.action !== 'string' ||
    typeof body.name !== 'string'
  ) {
    return null;
  }
  const count =
    typeof body.count === 'number' && Number.isFinite(body.count)
      ? body.count
      : 0;
  return makeItem({
    source: 'memory',
    kind: 'corpus',
    summary: `Corpus "${body.name}" ${body.action} (${count} entries)`,
    timestamp: body.timestamp,
  });
}

function mapIndexingProgress(payload: unknown): ActivityItem | null {
  const body = payload as IndexingProgressEvent | undefined;
  if (
    !body ||
    typeof body.percent !== 'number' ||
    !Number.isFinite(body.percent)
  ) {
    return null;
  }
  const label =
    typeof body.currentLabel === 'string' && body.currentLabel
      ? ` — ${body.currentLabel}`
      : '';
  return makeItem({
    source: 'indexing',
    kind: 'progress',
    summary: `Indexing ${Math.round(body.percent)}%${label}`,
  });
}

function mapIndexingComplete(payload: unknown): ActivityItem | null {
  const body = payload as IndexingCompleteEvent | undefined;
  if (
    !body ||
    typeof body.elapsedMs !== 'number' ||
    !Number.isFinite(body.elapsedMs)
  ) {
    return null;
  }
  return makeItem({
    source: 'indexing',
    kind: 'complete',
    summary: `Workspace index finished in ${Math.round(body.elapsedMs / 1000)}s`,
    timestamp: body.completedAt,
  });
}

/**
 * Skill-synthesis phrasing is DELIBERATELY the vocabulary already proven in
 * `skill-synthesis-live.service.ts:107-119`. Two labels for the same event
 * would read as two different things happening.
 */
function mapSkillSynthesis(payload: unknown): ActivityItem | null {
  const event = (payload as SkillSynthesisEventPayload | undefined)?.event;
  if (!event || typeof event.kind !== 'string') return null;
  return makeItem({
    source: 'skills',
    kind: event.kind,
    summary: skillSummary(event),
    level:
      event.kind === 'error' || event.kind === 'rate-limited' ? 'warn' : 'info',
    timestamp: event.timestamp,
  });
}

function skillSummary(event: SkillSynthesisEventWire): string {
  const stats = event.stats ?? {};
  const generic = `Skill synthesis: ${event.kind}`;
  switch (event.kind) {
    case 'curator-pass-start':
      return 'Curator analyzing candidates…';
    case 'curator-pass': {
      // A stat that does not coerce to a finite number degrades to the generic
      // line. "(NaN suggestions)" is worse than saying less.
      const created = finiteStat(stats['suggestionsCreated']);
      return created === null
        ? generic
        : `Curator pass finished (${created} suggestions)`;
    }
    case 'backfill-progress': {
      const done = finiteStat(stats['done']);
      const total = finiteStat(stats['total']);
      return done === null || total === null
        ? generic
        : `Embedding candidates ${done}/${total}…`;
    }
    case 'backfill-complete':
      return 'Embedding backfill complete';
    case 'analyze-run':
      return 'Analyzed a session for skill candidates';
    case 'error':
      return `Skill synthesis error: ${
        typeof event.error === 'string' ? event.error : 'unknown'
      }`;
    case 'rate-limited':
      return 'Skill synthesis paused by its rate limit';
    default:
      // A new backend kind degrades to a dull line rather than disappearing.
      return generic;
  }
}
