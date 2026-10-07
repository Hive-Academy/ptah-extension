/**
 * The curation pass the Batch 18 suites replay, and what they share
 * (benchmark-design.md 3.2, 3.3, 6.2).
 *
 * ## Why the suites drive the pass themselves
 *
 * `MemoryCuratorService.curate()` sends the resolve call the candidate rows'
 * ULIDs (`memory-curator.service.ts:788-794`), and the curator double keys
 * `resolve` on those ids (`recorded-curator-llm.ts:85-93`). A ULID is new on
 * every run, so a recorded resolve entry can never be replayed: every pass
 * with a merge candidate would be a cassette miss in CI. {@link commitDrafts}
 * therefore runs the same steps with the same product collaborators, and
 * hands the resolver each candidate under a content-derived id
 * ({@link stableCandidates}); the model sees the same subjects and contents,
 * ids are opaque handles to it, and the answer is mapped back to the real row.
 * The steps, in the curator's order:
 *   1. the curator's own collector (`memory-curator.service.ts:775-780`);
 *   2. resolve; with no candidate the product adapter returns every draft
 *      unmerged without a model call (`sdk-internal-query.curator-llm.ts:360-362`),
 *      and so does this pass;
 *   3. commit, a field-for-field mirror of the curator's private loop: each
 *      RESOLVED draft (subject, content, salience hint, kind, type, concepts,
 *      files, request/investigated/learned/completed/nextSteps as the resolver
 *      returned them) is appended when its target is one the resolver was
 *      shown and an active row of the scope (`:818-858`, `:945-967`), else
 *      inserted as new (`:860-890`); a failed write is skipped (`:891-897`).
 *
 * Imports no host-only module; the ports arrive from `merge-update-ports.ts`.
 */

import { isAbsolute, join, relative, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import type {
  CuratorExtraction,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';
import { z } from 'zod';

import { p50Latency, p95Latency } from '../../../metrics/cost-metrics';
import {
  CassetteMissError,
  canonicalJson,
  sha256Hex,
} from '../../doubles/cassette-store';
import type { Rate } from '../../metrics/curation-metrics';
import {
  runCaseWithSafetyCap,
  SAFETY_CAP_ERROR,
} from '../../runner/case-runner';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import type {
  MergeCandidateCollection,
  MergeCandidateView,
  MergeUpdatePorts,
} from './merge-update-ports';

/** Prefix of the content-derived candidate ids the resolver is shown. */
export const STABLE_CANDIDATE_PREFIX = 'cand-';

/** sha256 of a value's canonical JSON: the case `inputSha256`. */
export function sha256Of(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * The candidates under ids derived from their subject and content, so the
 * resolve cassette key is the same on every run and platform. Identical rows
 * get `-2`, `-3`, … in real-id order; they are interchangeable to the model.
 */
export function stableCandidates(candidates: readonly MergeCandidateView[]): {
  readonly related: readonly MergeCandidateView[];
  readonly realIdOf: ReadonlyMap<string, string>;
} {
  const byReal = [...candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const seen = new Map<string, number>();
  const stableIdOf = new Map<string, string>();
  for (const candidate of byReal) {
    const base = `${STABLE_CANDIDATE_PREFIX}${sha256Of({
      subject: candidate.subject,
      content: candidate.content,
    }).slice(0, 16)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    stableIdOf.set(candidate.id, count === 1 ? base : `${base}-${count}`);
  }
  const related = candidates.map((candidate) => ({
    id: stableIdOf.get(candidate.id) ?? candidate.id,
    subject: candidate.subject,
    content: candidate.content,
  }));
  const realIdOf = new Map(
    [...stableIdOf].map(([real, stable]) => [stable, real]),
  );
  return { related, realIdOf };
}

/** Model calls a suite dispatched to the curator double, with their runtimes. */
export class ModelCallLog {
  private readonly latencies: number[] = [];
  private failed = 0;

  constructor(private readonly now: () => number) {}

  /** Time one call; a throw counts as an errored call and is rethrown. */
  async time<T>(call: () => Promise<T>): Promise<T> {
    const started = this.now();
    try {
      return await call();
    } catch (error: unknown) {
      this.failed += 1;
      throw error;
    } finally {
      this.latencies.push(this.now() - started);
    }
  }

  get calls(): number {
    return this.latencies.length;
  }

  /** `cost` without `source` (the runner sets it from `modelCalls`). */
  cost(): SuiteResultInput['cost'] {
    return {
      calls: this.calls,
      latency_ms: {
        p50: p50Latency(this.latencies) ?? null,
        p95: p95Latency(this.latencies) ?? null,
      },
      error_rate: this.calls === 0 ? null : this.failed / this.calls,
      tokens: {},
    };
  }
}

export type SessionExtraction =
  | { readonly status: 'extracted'; readonly drafts: ExtractedMemoryDraft[] }
  | {
      readonly status: Exclude<CuratorExtraction['status'], 'extracted'>;
    };

/**
 * Extract one session the way the curator does: the trimmed transcript is
 * cut into the product's windows and each window is one `extract` call; a
 * window that does not extract ends the pass (`memory-curator.service.ts:736-766`).
 */
export async function extractSession(
  ports: MergeUpdatePorts,
  transcript: string,
  log: ModelCallLog,
  signal?: AbortSignal,
): Promise<SessionExtraction> {
  const drafts: ExtractedMemoryDraft[] = [];
  for (const window of ports.planWindows(transcript.trim())) {
    const extraction = await log.time(() =>
      ports.curator.extract(window, signal),
    );
    if (extraction.status !== 'extracted') {
      return { status: extraction.status };
    }
    drafts.push(...extraction.drafts);
  }
  return { status: 'extracted', drafts };
}

/**
 * What happened to one RESOLVED draft in {@link commitDrafts}. The product
 * iterates the resolver output, not its input, and persists each resolved
 * draft as returned (`memory-curator.service.ts:825-889`), so this does too.
 */
export interface DraftDecision {
  /** The resolved draft as persisted (`mergeTargetId` dropped). */
  readonly draft: ExtractedMemoryDraft;
  /**
   * `merged`: appended to an existing row; `created`: inserted as new;
   * `skipped`: the write threw and the product would skip it
   * (`memory-curator.service.ts:891-897`).
   */
  readonly outcome: 'merged' | 'created' | 'skipped';
  /** The row the draft now lives in; `null` when skipped. */
  readonly rowId: string | null;
}

export interface PassCommit {
  readonly collection: MergeCandidateCollection;
  readonly decisions: readonly DraftDecision[];
  /** 0 or 1: resolve is skipped when there is no candidate. */
  readonly resolveCalls: number;
}

/**
 * Collect, resolve and commit one pass's drafts into `workspaceRoot`.
 *
 * The commit loop mirrors `MemoryCuratorService.doCurate` field for field
 * (`memory-curator.service.ts:818-898`). The product has no public seam that
 * commits given resolved drafts (`doCurate` is private and always sends the
 * ULID-keyed resolve), so it cannot be called from the host container.
 */
export async function commitDrafts(
  ports: MergeUpdatePorts,
  input: {
    readonly drafts: readonly ExtractedMemoryDraft[];
    readonly workspaceRoot: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  },
  log: ModelCallLog,
): Promise<PassCommit> {
  const { drafts, workspaceRoot, sessionId, signal } = input;
  const collection = await ports.collectCandidates(
    drafts,
    workspaceRoot,
    signal,
  );
  let resolveCalls = 0;
  let resolved: readonly ResolvedMemoryDraft[];
  if (collection.candidates.length === 0) {
    // The product adapter's own short-circuit (`sdk-internal-query.curator-llm.ts:359-362`).
    resolved = drafts.map((draft) => ({ ...draft, mergeTargetId: null }));
  } else {
    const { related, realIdOf } = stableCandidates(collection.candidates);
    resolveCalls = 1;
    const answer = await log.time(() =>
      ports.curator.resolve(drafts, related, signal),
    );
    resolved = answer.map((draft) => ({
      ...draft,
      mergeTargetId:
        draft.mergeTargetId === null
          ? null
          : (realIdOf.get(draft.mergeTargetId) ?? draft.mergeTargetId),
    }));
  }

  const candidateIds = new Set(collection.candidates.map((c) => c.id));
  const decisions: DraftDecision[] = [];
  for (const { mergeTargetId, ...draft } of resolved) {
    try {
      if (mergeTargetId !== null && candidateIds.has(mergeTargetId)) {
        const target = ports.mergeTarget(mergeTargetId, workspaceRoot);
        if (
          target !== null &&
          (await ports.appendToRow(target, draft.content, workspaceRoot)) ===
            'appended'
        ) {
          decisions.push({ draft, outcome: 'merged', rowId: target });
          continue;
        }
      }
      const rowId = await ports.insertRow({ sessionId, workspaceRoot, draft });
      decisions.push({ draft, outcome: 'created', rowId });
    } catch {
      // The product counts a failed write as skipped and keeps going.
      decisions.push({ draft, outcome: 'skipped', rowId: null });
    }
  }
  return { collection, decisions, resolveCalls };
}

/** One scope (`workspace_root`) per case and attempt, inside the bench workspace. */
export function caseScope(
  workspaceRoot: string,
  suiteId: string,
  caseId: string,
  attempt: number,
): string {
  return join(workspaceRoot, '.bench-620', suiteId, `${caseId}.a${attempt}`);
}

/** Read a JSONL ground-truth file seeded into the isolated home. */
export function readGroundTruth<T extends { readonly id: string }>(
  home: string,
  relativePath: string,
  schema: z.ZodType<T>,
): T[] {
  if (isAbsolute(relativePath)) {
    throw new Error(`ground-truth path must be home-relative: ${relativePath}`);
  }
  const path = resolve(home, relativePath);
  const inside = relative(resolve(home), path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(
      `ground-truth path leaves the isolated home: ${relativePath}`,
    );
  }
  const records = readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      const parsed = schema.safeParse(JSON.parse(line) as unknown);
      if (!parsed.success) {
        throw new Error(
          `${relativePath}:${number}: invalid record\n${z.prettifyError(parsed.error)}`,
        );
      }
      return parsed.data;
    });
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new Error(`${relativePath} repeats id ${record.id}`);
    }
    ids.add(record.id);
  }
  return records;
}

/** A rate as metrics: the value and the integer `num` and `den` it came from. */
export function rateMetrics(
  name: string,
  value: Rate,
): Record<string, number | null> {
  return {
    [name]: value.value,
    [`${name}.num`]: value.num,
    [`${name}.den`]: value.den,
  };
}

/** Product minus baseline, per metric both report. */
export function deltaOf(
  product: Readonly<Record<string, number | null>>,
  baseline: Readonly<Record<string, number | null>>,
  names: readonly string[],
): Record<string, number | null> {
  return Object.fromEntries(
    names.map((name) => {
      const ours = product[name];
      const theirs = baseline[name];
      return [
        name,
        ours === null ||
        ours === undefined ||
        theirs === null ||
        theirs === undefined
          ? null
          : ours - theirs,
      ];
    }),
  );
}

/** How one case ended. */
export type CaseStatus = 'completed' | 'cassette-miss' | 'error' | 'safety-cap';

export interface CaseEvaluation {
  readonly expected: string;
  readonly observed: string;
  readonly outcome: 'pass' | 'fail';
  readonly baselineOutcomes?: Record<string, 'pass' | 'fail'>;
}

export interface RecordedCase<T> {
  readonly record: CaseRecord;
  readonly status: CaseStatus;
  /** Set only when `status` is `completed`. */
  readonly value: T | null;
}

/**
 * Run one case under the safety cap and turn it into its JSONL record. A
 * cassette miss, an error and a cap are recorded as `fail` with the reason,
 * never dropped, so the suite can report them and go `na`.
 */
export async function recordCase<T>(
  caseId: string,
  input: unknown,
  expected: string,
  run: (signal: AbortSignal, attempt: number) => Promise<T>,
  evaluate: (value: T) => CaseEvaluation,
  options: { readonly now: () => number; readonly capMs?: number },
): Promise<RecordedCase<T>> {
  const inputSha256 = sha256Of(input);
  let attempt = 0;
  const started = options.now();
  try {
    const result = await runCaseWithSafetyCap(
      (signal) => {
        attempt += 1;
        return run(signal, attempt);
      },
      { now: options.now, capMs: options.capMs },
    );
    if (result.outcome === SAFETY_CAP_ERROR) {
      return {
        status: 'safety-cap',
        value: null,
        record: {
          caseId,
          inputSha256,
          expected,
          observed: SAFETY_CAP_ERROR,
          outcome: 'fail',
          latencyMs: result.latencyMs,
          attempts: result.attempts,
          error: SAFETY_CAP_ERROR,
        },
      };
    }
    const evaluation = evaluate(result.value);
    return {
      status: 'completed',
      value: result.value,
      record: {
        caseId,
        inputSha256,
        ...evaluation,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
      },
    };
  } catch (error: unknown) {
    const latencyMs = Math.max(0, options.now() - started);
    if (error instanceof CassetteMissError) {
      return {
        status: 'cassette-miss',
        value: null,
        record: {
          caseId,
          inputSha256,
          expected,
          observed: 'cassette-miss',
          outcome: 'fail',
          cassetteKey: error.key,
          latencyMs,
          attempts: Math.max(1, attempt),
          error: `cassette-miss: ${error.method} ${error.key}`,
        },
      };
    }
    return {
      status: 'error',
      value: null,
      record: {
        caseId,
        inputSha256,
        expected,
        observed: 'error',
        outcome: 'fail',
        latencyMs,
        attempts: Math.max(1, attempt),
        error:
          error instanceof Error ? error.message || error.name : String(error),
      },
    };
  }
}

/**
 * The suite's `na` reason, or `undefined` when its metrics stand. A cassette
 * miss wins (R-M5: a suite with any miss cannot pass), then other case
 * failures, then a ground truth below the design's minimum size.
 */
export function naReasonOf(
  statuses: readonly CaseStatus[],
  groundTruthBelowMinimum: boolean,
): string | undefined {
  if (statuses.includes('cassette-miss')) return 'cassette-miss';
  if (statuses.some((s) => s === 'error' || s === 'safety-cap')) {
    return 'case-errors';
  }
  if (groundTruthBelowMinimum) return 'ground-truth-below-minimum';
  return undefined;
}

/**
 * The `na` reason of every suite that commits through {@link commitDrafts}
 * (`mem.dedup`, `mem.update`, `mem.temporal`). The commit step is a mirror of
 * the curator's private loop, so it is not the product path and no pass/fail
 * may come from it; a more specific reason from {@link naReasonOf} wins. Phase 4
 * seam needed: expose the commit step, or a public curate entry that accepts
 * pre-resolved drafts.
 */
export const MIRRORED_COMMIT_NA =
  'mirrored-commit-path: product commit step is private (memory-curator.service.ts doCurate)';
