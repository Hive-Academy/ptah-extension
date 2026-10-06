import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BENCH_DATA_DIR_ENV, resolveBenchDataDir } from '../../bench-data';
import {
  FROZEN_SNAPSHOT_FILE,
  FROZEN_SNAPSHOT_SHA256,
  withReadonlySnapshot,
  type ReadonlySqlite,
} from '../data/candidate-row-diff';
import {
  FROZEN_CANDIDATES_NAME,
  compareCodePoints,
  sha256,
  type BenchDataRules,
} from '../data/verify-candidate-manifest';

/** Strata of `gt-skill-rubric@v1` (benchmark-design.md §4.1). */
export const RUBRIC_STRATA = [
  'authored',
  'promoted-synthesized',
  'anchor-471',
  'suggestion',
  'judged-model',
  'fallback',
  'random',
] as const;
export type RubricStratum = (typeof RUBRIC_STRATA)[number];

export const STRATUM_TARGETS: Readonly<Record<RubricStratum, number>> = {
  authored: 23,
  'promoted-synthesized': 2,
  'anchor-471': 10,
  suggestion: 18,
  'judged-model': 20,
  fallback: 20,
  random: 12,
};
export const RUBRIC_SAMPLE_SIZE = 105;
export const DEFAULT_SAMPLE_SEED = 'TASK_2026_620';

/** The two pipeline-promoted synthesized skills (design K1). */
export const PROMOTED_SYNTHESIZED_SLUGS: readonly string[] = [
  'execute-phase-gated-task',
  'extract-and-relocate-angular-component-feature',
];

export interface Anchor471 {
  id: string;
  slug: string;
  /** Exemplar-rubric total 471 committed for this candidate (out of 80). */
  total471: number;
}

/** The 10 candidates 471 scored (`TASK_2026_471_b3d1/skill-quality-criteria.md:78-87`). */
export const ANCHOR_471: readonly Anchor471[] = [
  {
    id: '01KZPNBSG0R35W3A5XXKHMK2HS',
    slug: 'consolidate-duplicated-enum',
    total471: 14,
  },
  {
    id: '01M23N7WFMMPYWXJKRA7D3XRP1',
    slug: 'map-oauth-translation-proxy',
    total471: 19,
  },
  {
    id: '01KXVG4VV7P52ECZ39T0JW4RA9',
    slug: 'debug-multi-instance-context-mismatch',
    total471: 17,
  },
  {
    id: '01KZ1Z410CF53YVRG5VD8A1Y2B',
    slug: 'verify-existing-integrations',
    total471: 16,
  },
  {
    id: '01KZ967YH8W17XE1K47ACK9ZK3',
    slug: 'debug-empty-docker-logs',
    total471: 12,
  },
  {
    id: '01M135G83MAWAYHHWHD58F78G2',
    slug: 'pivot-harness-to-product-demo',
    total471: 11,
  },
  {
    id: '01KZDXK1J4QB2588WVKXQN0WPA',
    slug: 'reorganize-settings-routes-by-intent',
    total471: 16,
  },
  {
    id: '01KZTXRPDEB3EE1E94R2XNR81D',
    slug: 'compact-card-list-layout',
    total471: 10,
  },
  {
    id: '01KYYSM6XAB5HSDVQDKXTZFHGM',
    slug: 'break-computed-dependency-bloat',
    total471: 13,
  },
  {
    id: '01KZ3VDSFS9C148RYN3FRQRB4E',
    slug: 'audit-config-across-surfaces-2',
    total471: 15,
  },
];

/**
 * Lines the template fallback writes into every body
 * (`skill-synthesis/src/lib/skill-synthesizer.service.ts`, `synthesizeBody`).
 */
export const FALLBACK_BODY_MARKERS: readonly string[] = [
  'This skill was synthesized automatically from a successful session trajectory.',
  '## Trajectory (normalized)',
];

export type BodyShape = 'fallback' | 'model';

export function classifyBodyShape(body: string): BodyShape {
  return FALLBACK_BODY_MARKERS.every((marker) => body.includes(marker))
    ? 'fallback'
    : 'model';
}

export interface CandidateRowInfo {
  id: string;
  createdAt: number;
  judged: boolean;
  /** Largest `turn_count` queued for the source sessions; `null` when unknown. */
  transcriptTurns: number | null;
}

export interface CandidateEntry {
  /** Folder name in the frozen copy (also `skill_candidates.name`). */
  slug: string;
  bodyShape: BodyShape;
  row: CandidateRowInfo | null;
}

export interface SuggestionEntry {
  id: string;
  name: string;
}

export interface RubricSampleInputs {
  seed: string;
  /** Git-tracked `.claude/skills/<slug>/SKILL.md` slugs at the pinned commit. */
  trackedSkillSlugs: readonly string[];
  /** Candidate dirs of the frozen copy that hold a SKILL.md. */
  candidates: readonly CandidateEntry[];
  suggestions: readonly SuggestionEntry[];
}

export type DocumentSource =
  | { kind: 'repo-skill'; slug: string }
  | { kind: 'candidate'; slug: string; candidateId: string | null }
  | { kind: 'suggestion'; suggestionId: string; name: string };

export interface SampledDocument {
  stratum: RubricStratum;
  /** Unique source key: `repo:<slug>`, `candidate:<slug>` or `suggestion:<id>`. */
  key: string;
  slug: string;
  source: DocumentSource;
  /** `judged-model` cell (`w<band>-<above|below>`). */
  cell?: string;
  anchor471Total?: number;
}

export interface StratumShortfall {
  stratum: RubricStratum;
  target: number;
  selected: number;
}

export interface JudgedModelCell {
  cell: string;
  pool: number;
  selected: number;
}

export interface RubricSample {
  seed: string;
  documents: SampledDocument[];
  counts: Record<RubricStratum, number>;
  shortfalls: StratumShortfall[];
  /** False when no template-fallback body was found; `fallback` then merges into `random`. */
  fallbackIdentifiable: boolean;
  judgedModelCells: JudgedModelCell[];
  judgedModelMedianTurns: number | null;
  pools: Record<string, number>;
  notes: string[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deterministic stratified selection of the 105 rubric documents. Every
 * shortfall moves to `random`, so the sample size stays 105 whenever the
 * remainder is large enough.
 */
export function selectRubricSample(inputs: RubricSampleInputs): RubricSample {
  const { seed } = inputs;
  const notes: string[] = [];
  const shortfalls: StratumShortfall[] = [];
  const documents: SampledDocument[] = [];
  const taken = new Set<string>();
  const promoted = new Set(PROMOTED_SYNTHESIZED_SLUGS);
  const anchorSlugs = new Set(ANCHOR_471.map((a) => a.slug));
  const order = (value: string): string => sha256(seed + value);
  const byOrder = <T>(items: readonly T[], keyOf: (item: T) => string): T[] =>
    [...items].sort((a, b) =>
      compareCodePoints(order(keyOf(a)), order(keyOf(b))),
    );
  const add = (doc: SampledDocument): void => {
    if (taken.has(doc.key)) throw new Error(`Duplicate document ${doc.key}`);
    taken.add(doc.key);
    documents.push(doc);
  };
  const recordShortfall = (
    stratum: RubricStratum,
    selected: number,
  ): number => {
    const target = STRATUM_TARGETS[stratum];
    if (selected < target) {
      shortfalls.push({ stratum, target, selected });
      return target - selected;
    }
    return 0;
  };
  let carry = 0;

  // authored: every tracked skill except the promoted ones (positives are complete, never sampled).
  const tracked = new Set(inputs.trackedSkillSlugs);
  const authored = [...tracked]
    .filter((slug) => !promoted.has(slug))
    .sort(compareCodePoints);
  for (const slug of authored) {
    add({
      stratum: 'authored',
      key: `repo:${slug}`,
      slug,
      source: { kind: 'repo-skill', slug },
    });
  }
  if (authored.length > STRATUM_TARGETS.authored) {
    notes.push(
      `authored has ${authored.length} tracked skills (target ${STRATUM_TARGETS.authored}); all are kept as positives`,
    );
  }
  carry += recordShortfall('authored', authored.length);

  // promoted-synthesized: the repo copy of each promoted skill.
  let promotedCount = 0;
  for (const slug of PROMOTED_SYNTHESIZED_SLUGS) {
    if (!tracked.has(slug)) {
      notes.push(`promoted skill ${slug} is not tracked at the pinned commit`);
      continue;
    }
    add({
      stratum: 'promoted-synthesized',
      key: `repo:${slug}`,
      slug,
      source: { kind: 'repo-skill', slug },
    });
    promotedCount += 1;
  }
  carry += recordShortfall('promoted-synthesized', promotedCount);

  // anchor-471: by candidate id, falling back to the slug when the row is gone.
  const bySlug = new Map(inputs.candidates.map((c) => [c.slug, c]));
  const byId = new Map(
    inputs.candidates.flatMap((c) => (c.row ? [[c.row.id, c] as const] : [])),
  );
  let anchorCount = 0;
  for (const anchor of ANCHOR_471) {
    const entry = byId.get(anchor.id) ?? bySlug.get(anchor.slug);
    if (!entry) {
      notes.push(`anchor ${anchor.id} has no body in the frozen copy`);
      continue;
    }
    add({
      stratum: 'anchor-471',
      key: `candidate:${entry.slug}`,
      slug: entry.slug,
      source: {
        kind: 'candidate',
        slug: entry.slug,
        candidateId: entry.row?.id ?? null,
      },
      anchor471Total: anchor.total471,
    });
    anchorCount += 1;
  }
  carry += recordShortfall('anchor-471', anchorCount);

  // suggestion: all cluster suggestions (hash order if there are more than the target).
  const suggestions = byOrder(inputs.suggestions, (s) => s.id).slice(
    0,
    STRATUM_TARGETS.suggestion,
  );
  if (inputs.suggestions.length > STRATUM_TARGETS.suggestion) {
    notes.push(
      `${inputs.suggestions.length} suggestions on the snapshot; ${STRATUM_TARGETS.suggestion} taken in sha256(seed + id) order`,
    );
  }
  for (const s of suggestions) {
    add({
      stratum: 'suggestion',
      key: `suggestion:${s.id}`,
      slug: s.name,
      source: { kind: 'suggestion', suggestionId: s.id, name: s.name },
    });
  }
  carry += recordShortfall('suggestion', suggestions.length);

  const eligible = inputs.candidates.filter(
    (c) =>
      !promoted.has(c.slug) &&
      !anchorSlugs.has(c.slug) &&
      !taken.has(`candidate:${c.slug}`) &&
      !tracked.has(c.slug),
  );

  // judged-model: creation-week band (4) x transcript size (above/below median).
  const judgedPool = eligible.filter(
    (
      c,
    ): c is CandidateEntry & {
      row: CandidateRowInfo & { transcriptTurns: number };
    } =>
      c.bodyShape === 'model' &&
      c.row !== null &&
      c.row.judged &&
      c.row.transcriptTurns !== null,
  );
  const unknownSize = eligible.filter(
    (c) =>
      c.bodyShape === 'model' &&
      c.row?.judged &&
      c.row.transcriptTurns === null,
  ).length;
  if (unknownSize > 0) {
    notes.push(
      `${unknownSize} judged model candidate(s) without a transcript size were left out of judged-model`,
    );
  }
  const { cells, median } = buildJudgedModelCells(judgedPool);
  const cellPicks = allocate(
    cells.map((c) => c.members.length),
    STRATUM_TARGETS['judged-model'],
  );
  const judgedCells: JudgedModelCell[] = [];
  cells.forEach((cell, index) => {
    const picks = byOrder(cell.members, (c) => c.slug).slice(
      0,
      cellPicks[index] ?? 0,
    );
    for (const c of picks) {
      add({
        stratum: 'judged-model',
        key: `candidate:${c.slug}`,
        slug: c.slug,
        source: { kind: 'candidate', slug: c.slug, candidateId: c.row.id },
        cell: cell.name,
      });
    }
    judgedCells.push({
      cell: cell.name,
      pool: cell.members.length,
      selected: picks.length,
    });
  });
  carry += recordShortfall(
    'judged-model',
    judgedCells.reduce((sum, c) => sum + c.selected, 0),
  );

  // fallback: template-fallback bodies in hash order.
  const fallbackPool = eligible.filter(
    (c) => c.bodyShape === 'fallback' && !taken.has(`candidate:${c.slug}`),
  );
  const fallbackIdentifiable = fallbackPool.length > 0;
  if (!fallbackIdentifiable) {
    notes.push(
      'no template-fallback body found: fallback merges into random (n stays 105)',
    );
  }
  const fallbackPicks = byOrder(fallbackPool, (c) => c.slug).slice(
    0,
    STRATUM_TARGETS.fallback,
  );
  for (const c of fallbackPicks) {
    add({
      stratum: 'fallback',
      key: `candidate:${c.slug}`,
      slug: c.slug,
      source: {
        kind: 'candidate',
        slug: c.slug,
        candidateId: c.row?.id ?? null,
      },
    });
  }
  carry += recordShortfall('fallback', fallbackPicks.length);

  // random: uniform from the remainder, in hash order, plus every shortfall above.
  const remainder = eligible.filter((c) => !taken.has(`candidate:${c.slug}`));
  const randomWanted = STRATUM_TARGETS.random + carry;
  const randomPicks = byOrder(remainder, (c) => c.slug).slice(0, randomWanted);
  for (const c of randomPicks) {
    add({
      stratum: 'random',
      key: `candidate:${c.slug}`,
      slug: c.slug,
      source: {
        kind: 'candidate',
        slug: c.slug,
        candidateId: c.row?.id ?? null,
      },
    });
  }
  if (carry > 0) {
    notes.push(
      `random carries ${carry} document(s) from shortfalls in other strata`,
    );
  }
  if (randomPicks.length < randomWanted) {
    shortfalls.push({
      stratum: 'random',
      target: randomWanted,
      selected: randomPicks.length,
    });
  }

  const counts = Object.fromEntries(RUBRIC_STRATA.map((s) => [s, 0])) as Record<
    RubricStratum,
    number
  >;
  for (const doc of documents) counts[doc.stratum] += 1;
  if (documents.length !== RUBRIC_SAMPLE_SIZE) {
    notes.push(
      `sample has ${documents.length} documents, not ${RUBRIC_SAMPLE_SIZE}`,
    );
  }
  return {
    seed,
    documents,
    counts,
    shortfalls,
    fallbackIdentifiable,
    judgedModelCells: judgedCells,
    judgedModelMedianTurns: median,
    pools: {
      trackedSkills: tracked.size,
      candidates: inputs.candidates.length,
      eligibleCandidates: eligible.length,
      judgedModel: judgedPool.length,
      fallback: fallbackPool.length,
      suggestions: inputs.suggestions.length,
      randomRemainder: remainder.length,
    },
    notes,
  };
}

interface Cell<T> {
  name: string;
  members: T[];
}

function buildJudgedModelCells<
  T extends { row: { createdAt: number; transcriptTurns: number } },
>(pool: readonly T[]): { cells: Cell<T>[]; median: number | null } {
  const names: string[] = [];
  for (let band = 0; band < 4; band += 1) {
    names.push(`w${band}-above`, `w${band}-below`);
  }
  const cells = names.map((name) => ({ name, members: [] as T[] }));
  if (pool.length === 0) return { cells, median: null };
  const median = medianOf(pool.map((c) => c.row.transcriptTurns));
  const weekCounts = new Map<number, number>();
  for (const c of pool) {
    const week = Math.floor(c.row.createdAt / WEEK_MS);
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }
  const weeks = [...weekCounts.keys()].sort((a, b) => a - b);
  const bandOfWeek = weekBands(
    weeks.map((w) => weekCounts.get(w) ?? 0),
    4,
  );
  const weekBand = new Map(weeks.map((w, i) => [w, bandOfWeek[i] ?? 0]));
  for (const c of pool) {
    const band = weekBand.get(Math.floor(c.row.createdAt / WEEK_MS)) ?? 0;
    const size = c.row.transcriptTurns > median ? 'above' : 'below';
    const cell = cells.find((x) => x.name === `w${band}-${size}`);
    cell?.members.push(c);
  }
  return { cells, median };
}

/**
 * Splits consecutive weeks into at most `bands` contiguous, non-empty bands
 * whose member counts are as equal as possible (least squared deviation from
 * the mean; ties keep the earlier cut). Returns the band index of each week.
 */
export function weekBands(counts: readonly number[], bands: number): number[] {
  const k = Math.min(bands, counts.length);
  if (k === 0) return [];
  const prefix = [0];
  for (const c of counts) prefix.push((prefix[prefix.length - 1] ?? 0) + c);
  const total = prefix[counts.length] ?? 0;
  const mean = total / k;
  const cost = (from: number, to: number): number =>
    ((prefix[to] ?? 0) - (prefix[from] ?? 0) - mean) ** 2;
  // best[j][i]: least cost of splitting the first i weeks into j bands.
  const best: number[][] = [];
  const cut: number[][] = [];
  for (let j = 0; j <= k; j += 1) {
    best.push(counts.map(() => Infinity).concat(Infinity));
    cut.push(counts.map(() => 0).concat(0));
  }
  (best[0] as number[])[0] = 0;
  for (let j = 1; j <= k; j += 1) {
    for (let i = j; i <= counts.length; i += 1) {
      for (let p = j - 1; p < i; p += 1) {
        const value = (best[j - 1]?.[p] ?? Infinity) + cost(p, i);
        if (value < (best[j]?.[i] ?? Infinity)) {
          (best[j] as number[])[i] = value;
          (cut[j] as number[])[i] = p;
        }
      }
    }
  }
  const band = counts.map(() => 0);
  let end = counts.length;
  for (let j = k; j >= 1; j -= 1) {
    const start = cut[j]?.[end] ?? 0;
    for (let i = start; i < end; i += 1) band[i] = j - 1;
    end = start;
  }
  return band;
}

/**
 * Splits `total` picks across cells as evenly as possible; a cell that cannot
 * fill its share passes the deficit to the cells with the most spare members
 * (ties by cell order).
 */
export function allocate(
  capacities: readonly number[],
  total: number,
): number[] {
  const picks = capacities.map(() => 0);
  let remaining = Math.min(
    total,
    capacities.reduce((s, c) => s + c, 0),
  );
  while (remaining > 0) {
    const open = capacities
      .map((cap, index) => ({ index, spare: cap - (picks[index] ?? 0) }))
      .filter((c) => c.spare > 0);
    const share = Math.max(1, Math.floor(remaining / open.length));
    const ranked = [...open].sort(
      (a, b) =>
        (picks[a.index] ?? 0) - (picks[b.index] ?? 0) ||
        b.spare - a.spare ||
        a.index - b.index,
    );
    for (const cell of ranked) {
      if (remaining === 0) break;
      const give = Math.min(share, cell.spare, remaining);
      picks[cell.index] = (picks[cell.index] ?? 0) + give;
      remaining -= give;
    }
  }
  return picks;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// Inputs from the repository (pinned commit) and the bench data dir.

/** Read-only view of the repository at a commit. */
export interface GitTreeReader {
  resolveCommit(ref: string): Promise<string>;
  listFiles(commit: string, prefix: string): Promise<string[]>;
  readFile(commit: string, path: string): Promise<Buffer>;
}

/** `git` via argument arrays with a timeout; never writes to the repository. */
export function createGitTreeReader(
  repoRoot: string,
  timeoutMs = 30_000,
): GitTreeReader {
  const run = (args: string[]): Promise<Buffer> =>
    new Promise((resolvePromise, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: repoRoot,
          encoding: 'buffer',
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `git ${args.join(' ')} failed: ${stderr.toString('utf8').trim() || error.message}`,
              ),
            );
          } else resolvePromise(stdout);
        },
      );
    });
  return {
    resolveCommit: async (ref) => {
      const out = (await run(['rev-parse', '--verify', `${ref}^{commit}`]))
        .toString('utf8')
        .trim();
      if (!/^[0-9a-f]{40}$/.test(out))
        throw new Error(`Cannot resolve commit ${ref}`);
      return out;
    },
    listFiles: async (commit, prefix) =>
      (await run(['ls-tree', '-r', '--name-only', '-z', commit, '--', prefix]))
        .toString('utf8')
        .split('\0')
        .filter((p) => p !== ''),
    readFile: (commit, path) => run(['show', `${commit}:${path}`]),
  };
}

export interface SuggestionRow {
  id: string;
  name: string;
  description: string;
  body: string;
  referencesJson: string | null;
}

export interface LoadedRubricInputs {
  inputs: RubricSampleInputs;
  commit: string;
  snapshotSha256: string;
  copyDir: string;
  suggestionRows: SuggestionRow[];
}

export interface LoadRubricInputsOptions {
  benchDataDir: string;
  git: GitTreeReader;
  /** Commit the authored skills are read at (resolved to a full SHA). */
  commitRef: string;
  seed?: string;
  snapshotFile?: string;
  candidatesName?: string;
  expectedSnapshotSha256?: string | null;
  /** Overrides for 619's bench-data rules (specs only). */
  benchDataRules?: BenchDataRules;
}

export const SKILLS_PREFIX = '.claude/skills/';

export async function loadRubricSampleInputs(
  options: LoadRubricInputsOptions,
): Promise<LoadedRubricInputs> {
  const benchDataDir = resolveBenchDataDir({
    ...options.benchDataRules,
    env: { [BENCH_DATA_DIR_ENV]: options.benchDataDir },
  });
  const commit = await options.git.resolveCommit(options.commitRef);
  const trackedSkillSlugs = (await options.git.listFiles(commit, SKILLS_PREFIX))
    .map((p) => /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(p)?.[1])
    .filter((slug): slug is string => slug !== undefined)
    .sort(compareCodePoints);

  const copyDir = join(
    benchDataDir,
    'snapshots',
    options.candidatesName ?? FROZEN_CANDIDATES_NAME,
  );
  const shapes = new Map<string, BodyShape>();
  for (const entry of await readdir(copyDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(copyDir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    shapes.set(entry.name, classifyBodyShape(await readFile(file, 'utf8')));
  }

  const snapshotPath = join(
    benchDataDir,
    'snapshots',
    options.snapshotFile ?? FROZEN_SNAPSHOT_FILE,
  );
  const expected =
    options.expectedSnapshotSha256 === undefined
      ? FROZEN_SNAPSHOT_SHA256
      : options.expectedSnapshotSha256;
  const { result, sha256: snapshotSha256 } = await withReadonlySnapshot(
    snapshotPath,
    (db) => ({
      rows: readCandidateInfo(db),
      suggestions: readSuggestionRows(db),
    }),
    expected,
  );

  const candidates: CandidateEntry[] = [...shapes.entries()]
    .sort(([a], [b]) => compareCodePoints(a, b))
    .map(([slug, bodyShape]) => ({
      slug,
      bodyShape,
      row: result.rows.get(slug) ?? null,
    }));
  return {
    inputs: {
      seed: options.seed ?? DEFAULT_SAMPLE_SEED,
      trackedSkillSlugs,
      candidates,
      suggestions: result.suggestions.map((s) => ({ id: s.id, name: s.name })),
    },
    commit,
    snapshotSha256,
    copyDir,
    suggestionRows: result.suggestions,
  };
}

function readCandidateInfo(db: ReadonlySqlite): Map<string, CandidateRowInfo> {
  const turns = db.prepare(
    'SELECT MAX(turn_count) AS turns FROM skill_synthesis_queue WHERE session_id = ? AND turn_count > 0',
  );
  const rows = db
    .prepare(
      'SELECT id, name, created_at, judge_score, source_session_ids FROM skill_candidates',
    )
    .all() as Record<string, unknown>[];
  const out = new Map<string, CandidateRowInfo>();
  for (const row of rows) {
    let sessionIds: unknown;
    try {
      sessionIds = JSON.parse(String(row['source_session_ids']));
    } catch {
      sessionIds = [];
    }
    let transcriptTurns: number | null = null;
    for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
      const value = (
        turns.get(String(sessionId)) as { turns: number | null } | undefined
      )?.turns;
      if (
        typeof value === 'number' &&
        (transcriptTurns === null || value > transcriptTurns)
      ) {
        transcriptTurns = value;
      }
    }
    out.set(String(row['name']), {
      id: String(row['id']),
      createdAt: Number(row['created_at']),
      judged: row['judge_score'] !== null && row['judge_score'] !== undefined,
      transcriptTurns,
    });
  }
  return out;
}

function readSuggestionRows(db: ReadonlySqlite): SuggestionRow[] {
  return (
    db
      .prepare(
        'SELECT id, name, description, body, references_json FROM skill_suggestions ORDER BY id',
      )
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    id: String(row['id']),
    name: String(row['name']),
    description: String(row['description']),
    body: String(row['body']),
    referencesJson:
      row['references_json'] === null ? null : String(row['references_json']),
  }));
}
