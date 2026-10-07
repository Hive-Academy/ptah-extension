/**
 * The harness of the liveness suites (`liveness.suite.ts`): a scripted
 * `ICuratorLLM`, access to the two private `MemoryTriggerService` methods the
 * invariants are about, and the suite-local trigger/curator wiring inside the
 * booted bench host. See the suite module header for why each exists.
 *
 * Host-only: value-imports the memory-curator barrel
 * (`../../host-only-imports.spec.ts`).
 */

import type {
  CuratorCallOptions,
  CuratorExtraction,
  ExtractedMemoryDraft,
  ICuratorLLM,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';
import {
  MEMORY_TOKENS,
  MemoryCuratorService,
  MemoryTriggerService,
  type CuratorRunStats,
  type MemoryCuratorEvent,
  type MemoryStore,
  type ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { join } from 'node:path';
import { z } from 'zod';

import { CassetteStore } from '../../doubles/cassette-store';
import {
  RecordedCuratorLlm,
  curatorExtractKey,
  type CuratorFaultMode,
} from '../../doubles/recorded-curator-llm';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { normalizeFactText } from '../../matching/fact-matcher';

export const LIVENESS_MODEL_ID = 'scripted:liveness.v1';
const MARKER_PATTERN = /\bLV-[a-z0-9]+\b/g;

// ---------------------------------------------------------------------------
// Scripted curator
// ---------------------------------------------------------------------------

/** Scripted `ICuratorLLM`: one draft per planted marker, or a forced fault. */
export class ScriptedLivenessCurator implements ICuratorLLM {
  private readonly faults = new Map<string, CuratorFaultMode>();
  private readonly counts = { extract: 0, resolve: 0 };

  setFault(marker: string, mode: CuratorFaultMode): void {
    this.faults.set(marker, mode);
  }

  clearFaults(): void {
    this.faults.clear();
  }

  calls(): number {
    return this.counts.extract + this.counts.resolve;
  }

  async extract(
    transcript: string,
    _signal?: AbortSignal,
    _options?: CuratorCallOptions,
  ): Promise<CuratorExtraction> {
    this.counts.extract += 1;
    const markers = [...new Set(transcript.match(MARKER_PATTERN) ?? [])].sort();
    const fault = markers
      .map((marker) => this.faults.get(marker))
      .find((mode) => mode !== undefined);
    if (fault !== undefined) {
      // The double's own fault arm, keyed on exactly this transcript.
      return new RecordedCuratorLlm({
        store: new CassetteStore({ path: 'no-cassette', mode: 'replay' }),
        model: LIVENESS_MODEL_ID,
        faults: { [curatorExtractKey(transcript)]: fault },
      }).extract(transcript);
    }
    return {
      status: 'extracted',
      drafts: markers.map((marker): ExtractedMemoryDraft => ({
        kind: 'fact',
        subject: `liveness fixture ${marker}`,
        content: `Liveness fixture ${marker} was curated from its session.`,
        salienceHint: 0.5,
      })),
    };
  }

  async resolve(
    drafts: readonly ExtractedMemoryDraft[],
  ): Promise<readonly ResolvedMemoryDraft[]> {
    this.counts.resolve += 1;
    return drafts.map((draft) => ({ ...draft, mergeTargetId: null }));
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** What one `curate` call returned, as the trigger saw it. */
export type CurateObservation =
  | {
      readonly outcome: CuratorRunStats['outcome'];
      readonly stats: CuratorRunStats;
    }
  | { readonly outcome: 'threw'; readonly error: string };

/** The curator the trigger holds, recording every `curate` result. */
export function recordCurateOutcomes(
  curator: MemoryCuratorService,
  sink: CurateObservation[],
): MemoryCuratorService {
  return new Proxy(curator, {
    get(target, property) {
      if (property === 'curate') {
        return async (input: Parameters<MemoryCuratorService['curate']>[0]) => {
          try {
            const stats = await target.curate(input);
            sink.push({ outcome: stats.outcome, stats });
            return stats;
          } catch (error: unknown) {
            sink.push({
              outcome: 'threw',
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

interface TriggerInternals {
  invokeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: 'idle',
  ): Promise<void>;
  runBootScan(signal: AbortSignal): Promise<void>;
}

/**
 * The two private trigger methods the invariants are about. Fails closed when
 * the product renames either, instead of measuring nothing.
 */
export function triggerInternals(
  trigger: MemoryTriggerService,
): TriggerInternals {
  const candidate = trigger as unknown as Partial<
    Record<keyof TriggerInternals, unknown>
  >;
  const { invokeCurate, runBootScan } = candidate;
  if (typeof invokeCurate !== 'function' || typeof runBootScan !== 'function') {
    throw new Error(
      'MemoryTriggerService no longer has invokeCurate/runBootScan; update the liveness suite',
    );
  }
  return {
    invokeCurate: (sessionId, workspaceRoot, source) =>
      (invokeCurate as TriggerInternals['invokeCurate']).call(
        trigger,
        sessionId,
        workspaceRoot,
        source,
      ),
    runBootScan: (signal) =>
      (runBootScan as TriggerInternals['runBootScan']).call(trigger, signal),
  };
}

/** The pieces the host (or a spec) assembles; see {@link hostLivenessParts}. */
export interface LivenessParts {
  readonly trigger: MemoryTriggerService;
  /** The suite-local curator the trigger holds (unproxied), for its events. */
  readonly curator: Pick<MemoryCuratorService, 'onEvent'>;
  readonly outcomes: CurateObservation[];
  readonly observations: Pick<
    ObservationQueueStore,
    'enqueue' | 'countUnprocessed'
  >;
  readonly readWatermark: () => number | null;
  /** Rows stored for `workspaceRoot`: content and chunk texts. */
  readonly rows: () => readonly { content: string; chunks: number }[];
  readonly sessionsDir: string;
  readonly workspaceRoot: string;
  readonly model: ScriptedLivenessCurator;
}

export interface BootScanStats {
  readonly scanned: number;
  readonly succeeded: number;
  readonly skipped: number;
  readonly stalled: number;
}

export interface RowSnapshot {
  readonly rows: number;
  readonly chunks: number;
  /** Distinct normalised contents held by more than one row. */
  readonly duplicateGroups: number;
}

export function snapshot(parts: LivenessParts): RowSnapshot {
  const rows = parts.rows();
  const byContent = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeFactText(row.content);
    byContent.set(key, (byContent.get(key) ?? 0) + 1);
  }
  return {
    rows: rows.length,
    chunks: rows.reduce((sum, row) => sum + row.chunks, 0),
    duplicateGroups: [...byContent.values()].filter((n) => n > 1).length,
  };
}

export async function invokeObservationPass(
  parts: LivenessParts,
  sessionId: string,
): Promise<CurateObservation> {
  const before = parts.outcomes.length;
  await triggerInternals(parts.trigger).invokeCurate(
    sessionId,
    parts.workspaceRoot,
    'idle',
  );
  const observed = parts.outcomes[before];
  if (observed === undefined) {
    throw new Error(`invokeCurate(${sessionId}) never reached the curator`);
  }
  return observed;
}

export async function runBootScan(
  parts: LivenessParts,
): Promise<BootScanStats> {
  const events: MemoryCuratorEvent[] = [];
  const subscription = parts.curator.onEvent((event) => {
    if (event.kind === 'boot-scan' || event.kind === 'error')
      events.push(event);
  });
  try {
    await triggerInternals(parts.trigger).runBootScan(
      new AbortController().signal,
    );
  } finally {
    subscription.dispose();
  }
  const last = events[events.length - 1];
  if (last === undefined) {
    throw new Error('the boot scan did not run (no workspace root)');
  }
  if (last.kind === 'error') {
    throw new Error(`the boot scan failed: ${last.error ?? 'unknown error'}`);
  }
  const stat = (name: keyof BootScanStats): number => {
    const value = last.stats?.[name];
    if (typeof value !== 'number') {
      throw new Error(`boot-scan event carries no ${name}`);
    }
    return value;
  };
  return {
    scanned: stat('scanned'),
    succeeded: stat('succeeded'),
    skipped: stat('skipped'),
    stalled: stat('stalled'),
  };
}

// ---------------------------------------------------------------------------
// Host wiring
// ---------------------------------------------------------------------------

/** `~/.claude/projects/<escaped workspace>` as `JsonlReaderService` resolves it. */
export function sessionsDirFor(home: string, workspaceRoot: string): string {
  return join(
    home,
    '.claude',
    'projects',
    workspaceRoot.replace(/[:\\/]/g, '-'),
  );
}

const watermarkRowsSchema = z.array(z.strictObject({ mtime: z.number() }));

/**
 * Suite-local trigger and curator in a child container of the booted host.
 * The shared singletons are resolved from the parent first, so the child can
 * never construct one of them with its `CURATOR_LLM` override.
 */
export function hostLivenessParts(
  context: MemorySkillsHostSuiteContext,
): LivenessParts {
  const parent = context.container;
  const observations = parent.resolve<ObservationQueueStore>(
    MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
  );
  const store = parent.resolve<MemoryStore>(MEMORY_TOKENS.MEMORY_STORE);
  const sqlite = parent.resolve<SqliteConnectionService>(
    PERSISTENCE_TOKENS.SQLITE_CONNECTION,
  );
  const model = new ScriptedLivenessCurator();
  const child = parent.createChildContainer();
  child.register(MEMORY_TOKENS.CURATOR_LLM, { useValue: model });
  const curator = child.resolve(MemoryCuratorService);
  const outcomes: CurateObservation[] = [];
  child.register(MEMORY_TOKENS.MEMORY_CURATOR, {
    useValue: recordCurateOutcomes(curator, outcomes),
  });
  const trigger = child.resolve(MemoryTriggerService);
  const workspaceRoot = context.workspaceRoot;
  return {
    trigger,
    curator,
    outcomes,
    observations,
    readWatermark: () => {
      const rows = watermarkRowsSchema.parse(
        sqlite.db
          .prepare(
            'SELECT last_scanned_session_mtime AS mtime FROM boot_scan_state WHERE pipeline = ?',
          )
          .all('memory'),
      );
      if (rows.length > 1) {
        throw new Error(
          'more than one memory boot-scan watermark in the isolated DB',
        );
      }
      return rows[0]?.mtime ?? null;
    },
    rows: () => {
      const out: { content: string; chunks: number }[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = store.list({ workspaceRoot, limit: 500, offset });
        for (const memory of page.memories) {
          out.push({
            content: memory.content,
            chunks: store.getChunks(memory.id).length,
          });
        }
        if (page.memories.length === 0 || out.length >= page.total) return out;
      }
    },
    sessionsDir: sessionsDirFor(context.isolation.home, workspaceRoot),
    workspaceRoot,
    model,
  };
}
