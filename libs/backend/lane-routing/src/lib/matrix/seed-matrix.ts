import {
  SEED_LABEL_SCORE,
  STALENESS_AGE_MS,
  type SeedLabel,
} from '../routing-constants';
import {
  CAPABILITY_MATRIX_VERSION,
  type CapabilityMatrix,
  type MatrixCell,
  type MatrixProfile,
} from './matrix.types';

/**
 * Shipped seed of the capability matrix (part A §3, Requirements 6.2, 6.3).
 *
 * Evidence: `research-routing-landscape.md` (TASK_2026_646_136a) as of
 * 2026-10-14. Public data supports only the implement kind, from SWE-bench
 * Verified under mini-SWE-agent (source [1]). No other task kind is seeded
 * and no value is carried from implement to another kind.
 *
 * A labelled row is seeded only when the row names a Ptah lane family and its
 * model id appears exactly in that lane's shipped list. Rows left out:
 * - Claude Opus 4.5 high, Claude Opus 4.6 (in-process): the subagent lane
 *   lists the tiers `opus` / `sonnet`, not these ids.
 * - GPT-5.2 high, GPT-5.2-Codex, GPT-5.1-Codex medium (Codex CLI): absent
 *   from the Codex fallback list (`codex-app-server-lane-models.ts` `CODEX_LANE_FALLBACK_MODELS`).
 * - Claude Sonnet 4.5 high: its row cites Copilot CLI, whose shipped list
 *   (`copilot-sdk.adapter.ts`) has no Sonnet 4.5 id.
 * - Claude Haiku 4.5 high, GPT-5.1 medium, GPT-5 medium, GPT-5 mini medium,
 *   Gemini 3 Flash high, Gemini 3 Pro: the row names no lane.
 * Seeded: GLM-5 high (Z.ai) as provider `z-ai`, model `glm-5`, which is in
 * that provider's `staticModels` (`ANTHROPIC_PROVIDERS`, shared).
 *
 * The seed holds no family-level profile: the benchmark scores models, and a
 * family value would be inferred.
 */

/** Source [1]: the SWE-bench Verified board the seed rates were read from. */
export const SEED_SOURCE_REF =
  'https://www.benchleader.com/benchmarks/swe_bench_verified_any';

/** What a seed value measures (Requirement 6.2). */
export const SEED_NOTE = 'backend implementation only';

export interface SeedMatrixRow {
  /** Lane family as `laneFamilyOf` returns it. */
  readonly family: string;
  /** Model id exactly as the lane lists it. */
  readonly model: string;
  /** The model as the benchmark board names it. */
  readonly benchmarkModel: string;
  /** Research label for the implement kind. */
  readonly label: SeedLabel;
  /** Publication date of the benchmark result (`YYYY-MM-DD`). */
  readonly asOf: string;
}

export const SEED_MATRIX_ROWS: readonly SeedMatrixRow[] = [
  {
    family: 'z-ai',
    model: 'glm-5',
    benchmarkModel: 'GLM-5 high',
    label: 'strong',
    asOf: '2026-02-17',
  },
];

/**
 * `now - asOf > STALENESS_AGE_MS`. An `asOf` that does not parse has no
 * known age and counts as stale.
 */
export function isStale(asOf: string, nowMs: number): boolean {
  const asOfMs = Date.parse(asOf);
  return Number.isNaN(asOfMs) || nowMs - asOfMs > STALENESS_AGE_MS;
}

function unknownCell(): MatrixCell {
  return { kind: 'unknown' };
}

function seedProfile(row: SeedMatrixRow, nowMs: number): MatrixProfile {
  return {
    family: row.family,
    model: row.model,
    cells: {
      plan: unknownCell(),
      implement: {
        kind: 'value',
        score: SEED_LABEL_SCORE[row.label],
        source: 'seed',
        sourceRef: SEED_SOURCE_REF,
        asOf: row.asOf,
        stale: isStale(row.asOf, nowMs),
        note: SEED_NOTE,
      },
      review: unknownCell(),
      research: unknownCell(),
      tests: unknownCell(),
      docs: unknownCell(),
    },
  };
}

/**
 * The seed as a matrix, with `stale` computed at `nowMs`. One profile per
 * row; a repeated row is a duplicate profile that the schema rejects.
 * Returns fresh objects on every call.
 */
export function buildSeedMatrix(nowMs: number): CapabilityMatrix {
  return {
    version: CAPABILITY_MATRIX_VERSION,
    profiles: SEED_MATRIX_ROWS.map((row) => seedProfile(row, nowMs)),
  };
}
