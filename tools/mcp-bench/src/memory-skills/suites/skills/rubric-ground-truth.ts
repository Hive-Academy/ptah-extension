/**
 * `gt-skill-rubric@v1` (benchmark-design.md 4.2): the committed rubric
 * labels, recomputed from the committed files every time a suite needs them.
 * U1 labels come from the model panel (`labelling/model-panel.ts`): pass
 * `panel` to record method `model-panel`, the panel string, and the
 * unresolved-share cap.
 * Both `skill.rubric.inter-rater` (`rubric-agreement.suite.ts`) and the judge
 * agreement suites (`judge-agreement.suite.ts`) load it here, so the trust bar
 * one of them reports is the trust bar the other one scores against.
 *
 * Committed files (Batch 25, `tools/mcp-bench/fixtures/memory-skills/`):
 *   - `skill-labels.v1.csv`: `opaqueId,raterId,c1..c8,total,pass,ratedAt`,
 *     one row per document per rater (`rubricScoreRowSchema`, no text column);
 *   - `skill-adjudication.v1.csv`:
 *     `opaqueId,adjudicatorId,c1..c8,total,pass,triggers,decidedAt`, one row
 *     per adjudicated document; `triggers` joins `pass-fail-differs` and
 *     `totals-differ` with `;` (`adjudicationRowSchema`);
 *   - `skill-docs.v1.json`: `{schemaVersion: 1, documents: [{opaqueId,
 *     sha256, stratum?, anchor471Total?}]}`. `stratum` is added only after
 *     adjudication closes (R2); `anchor471Total` is 471's committed total for
 *     an `anchor-471` document (`skill-quality-criteria.md:78-87`);
 *   - `MANIFEST.json`: the sha256 of every one of them.
 *
 * Outcomes, in order: a file whose bytes differ from the manifest (or that
 * the manifest does not pin, or that the manifest pins but is gone) is
 * `hash-mismatch`; a file that is absent and unpinned is `absent`; otherwise
 * the labels are parsed and the trust bar evaluated. A structurally broken
 * file (wrong header, a missing rater row, an adjudication that does not match
 * the disagreement it claims to settle) throws {@link RubricGroundTruthError}:
 * a broken label file is a defect to fix, never a measurement.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { compareCodeUnits } from '../../../utils/compare-code-units';
import {
  manifestSchema,
  type FixtureManifest,
} from '../../ground-truth/fixture-manifest';
import {
  adjudicationRowSchema,
  rubricScoreRowSchema,
  sha256HexSchema,
  type AdjudicationRow,
  type RubricScoreRow,
} from '../../ground-truth/label-schemas';
import {
  PANEL_UNRESOLVED_REASON,
  PANEL_UNRESOLVED_SHARE_CAP,
  evaluatePanelEligibility,
  unresolvedExclusion,
  type PanelManifest,
} from '../../labelling/model-panel';
import {
  RUBRIC_STRATA,
  type RubricStratum,
} from '../../labelling/select-rubric-sample';
import {
  evaluateTrustBar,
  summarizeAgreement,
  type AgreementSummary,
  type AnchorComparison,
  type RubricRating,
  type TrustBar,
} from '../../metrics/agreement-metrics';
import type { BootstrapOptions } from '../../metrics/bootstrap';

export const RUBRIC_GROUND_TRUTH_ID = 'gt-skill-rubric';
export const RUBRIC_GROUND_TRUTH_VERSION = 'v1';

export const SKILL_LABELS_FILE = 'skill-labels.v1.csv';
export const SKILL_ADJUDICATION_FILE = 'skill-adjudication.v1.csv';
export const SKILL_DOCS_FILE = 'skill-docs.v1.json';
export const FIXTURE_MANIFEST_FILE = 'MANIFEST.json';
export const RUBRIC_GROUND_TRUTH_FILES = [
  SKILL_LABELS_FILE,
  SKILL_ADJUDICATION_FILE,
  SKILL_DOCS_FILE,
] as const;

/** Strata left out of the candidates-only subset (design 4.2 blinding limit). */
export const AUTHORED_STRATA: readonly RubricStratum[] = [
  'authored',
  'promoted-synthesized',
];
export const ANCHOR_STRATUM: RubricStratum = 'anchor-471';
/** Totals differing by more than this go to the adjudicator (design 4.2). */
export const ADJUDICATION_TOTAL_GAP = 12;
/** Two rater families. The adjudicator is not a third rater. */
export const RUBRIC_GROUND_TRUTH_RATER_COUNT = 2 as const;

/** Seeded so a re-run of the same labels gives the same interval. */
export const RUBRIC_BOOTSTRAP: BootstrapOptions = {
  resamples: 2_000,
  seed: 'TASK_2026_620:gt-skill-rubric@v1',
  alpha: 0.05,
};

export const LABEL_COLUMNS = [
  'opaqueId',
  'raterId',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
  'pass',
  'ratedAt',
] as const;

export const ADJUDICATION_COLUMNS = [
  'opaqueId',
  'adjudicatorId',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
  'pass',
  'triggers',
  'decidedAt',
] as const;

const INTEGER_COLUMNS = new Set([
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
]);

/** A committed label file is structurally broken. */
export class RubricGroundTruthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RubricGroundTruthError';
  }
}

const skillDocSchema = z.strictObject({
  opaqueId: z.string().min(1),
  sha256: sha256HexSchema,
  stratum: z.enum(RUBRIC_STRATA).optional(),
  anchor471Total: z.number().int().min(0).max(80).optional(),
});
export type SkillDocEntry = z.infer<typeof skillDocSchema>;

export const skillDocsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    documents: z.array(skillDocSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.documents.forEach((doc, index) => {
      if (seen.has(doc.opaqueId)) {
        ctx.addIssue({
          code: 'custom',
          message: `document ${doc.opaqueId} is listed twice`,
          path: ['documents', index, 'opaqueId'],
        });
      }
      seen.add(doc.opaqueId);
      const isAnchor = doc.stratum === ANCHOR_STRATUM;
      if (isAnchor !== (doc.anchor471Total !== undefined)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'anchor471Total is required on an anchor-471 document and forbidden on any other',
          path: ['documents', index, 'anchor471Total'],
        });
      }
    });
  });

/** Reads one committed file by name; `null` when the file does not exist. */
export type GroundTruthFileReader = (name: string) => Buffer | null;

export type FileCheckStatus =
  'ok' | 'absent' | 'missing' | 'unrecorded' | 'hash-mismatch';

export interface FileCheck {
  readonly file: string;
  readonly status: FileCheckStatus;
  /** sha256 MANIFEST.json records; `null` when it records none. */
  readonly expected: string | null;
  /** sha256 of the bytes on disk; `null` when the file is absent. */
  readonly actual: string | null;
}

/** The consensus verdict of one document (model panel, or a legacy file). */
export interface HumanConsensus {
  readonly total: number;
  readonly pass: boolean;
  readonly adjudicated: boolean;
}

export interface LoadedRubricGroundTruth {
  readonly state: 'loaded';
  readonly files: readonly FileCheck[];
  readonly raters: readonly [string, string];
  /** `labelled` until `options.panel` supplies a model panel. */
  readonly method: 'labelled' | 'model-panel';
  /** Family spelling. Present only when `method` is `model-panel`. */
  readonly panel?: string;
  readonly raterCount: typeof RUBRIC_GROUND_TRUTH_RATER_COUNT;
  /** Frozen population, including unresolved documents. */
  readonly population: number;
  /** Documents with both rater rows. Agreement uses only these. */
  readonly acceptedCount: number;
  readonly unresolvedIds: readonly string[];
  /** Null until the private manifest supplies a frozen population. */
  readonly unresolvedShare: number | null;
  readonly documents: readonly SkillDocEntry[];
  /** Per document; absent while its adjudication is pending. */
  readonly consensus: ReadonlyMap<string, HumanConsensus>;
  readonly adjudicated: number;
  /** Documents that need an adjudication row and have none. */
  readonly pendingAdjudication: readonly string[];
  /** Documents without a recorded stratum. */
  readonly strataMissing: number;
  readonly full: AgreementSummary;
  /** `null` until every document has a stratum. */
  readonly candidates: AgreementSummary | null;
  readonly candidateItems: number;
  readonly anchors: readonly AnchorComparison[];
  /** `null` until every document has a stratum. */
  readonly trust: TrustBar | null;
  /** Why the labels cannot be trusted; `null` when the trust bar holds. */
  readonly untrustedReason: string | null;
}

export type RubricGroundTruth =
  | { readonly state: 'absent'; readonly files: readonly FileCheck[] }
  | { readonly state: 'hash-mismatch'; readonly files: readonly FileCheck[] }
  | LoadedRubricGroundTruth;

export interface RubricPanelProvenance {
  /** 619 method token. The family spelling is `panel`. */
  readonly method: 'model-panel';
  /** `modelPanelName(...)` for the verified families. */
  readonly panel: string;
  readonly population: number;
  readonly unresolvedCount: number;
}

export interface LoadRubricGroundTruthOptions {
  /** The two raters; the first is the agreement reference. */
  readonly raters: readonly [string, string];
  /** Model-panel method and the unresolved share of the frozen population. */
  readonly panel?: RubricPanelProvenance;
}

/**
 * Provenance a suite passes into {@link loadRubricGroundTruth}. The manifest
 * has already passed `panelManifestSchema` (eligibility included).
 */
export function panelProvenanceFromManifest(
  manifest: PanelManifest,
): RubricPanelProvenance {
  const eligibility = evaluatePanelEligibility(manifest);
  if (!eligibility.ok) {
    throw new RubricGroundTruthError(eligibility.reason);
  }
  return {
    method: eligibility.method,
    panel: eligibility.panel,
    population: manifest.population,
    unresolvedCount: manifest.unresolvedCount,
  };
}

/**
 * `id`, `version`, `method`, `panel` and `raterCount` for a suite
 * ground-truth block. `panel` is present only when `method` is `model-panel`.
 */
export function rubricGroundTruthMetadata(
  method: 'labelled' | 'model-panel',
  panel?: string,
): {
  readonly id: typeof RUBRIC_GROUND_TRUTH_ID;
  readonly version: typeof RUBRIC_GROUND_TRUTH_VERSION;
  readonly method: 'labelled' | 'model-panel';
  readonly panel?: string;
  readonly raterCount: typeof RUBRIC_GROUND_TRUTH_RATER_COUNT;
} {
  const identity = {
    id: RUBRIC_GROUND_TRUTH_ID,
    version: RUBRIC_GROUND_TRUTH_VERSION,
    raterCount: RUBRIC_GROUND_TRUTH_RATER_COUNT,
  } as const;
  if (method === 'model-panel') {
    if (panel === undefined || panel.length === 0) {
      throw new RubricGroundTruthError(
        'model-panel ground truth requires panel',
      );
    }
    return { ...identity, method, panel };
  }
  if (panel !== undefined) {
    throw new RubricGroundTruthError(
      'panel is only valid for model-panel ground truth',
    );
  }
  return { ...identity, method };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Each file's bytes against MANIFEST.json; never parses a label. */
export function checkGroundTruthFiles(read: GroundTruthFileReader): {
  files: FileCheck[];
  bytes: Map<string, Buffer>;
} {
  const manifestBytes = read(FIXTURE_MANIFEST_FILE);
  let manifest: FixtureManifest | null = null;
  if (manifestBytes !== null) {
    const parsed = manifestSchema.safeParse(parseJson(manifestBytes));
    if (!parsed.success) {
      throw new RubricGroundTruthError(
        `${FIXTURE_MANIFEST_FILE} is invalid: ${z.prettifyError(parsed.error)}`,
      );
    }
    manifest = parsed.data;
  }
  const files: FileCheck[] = [];
  const bytes = new Map<string, Buffer>();
  for (const file of RUBRIC_GROUND_TRUTH_FILES) {
    const content = read(file);
    const expected = manifest?.files[file] ?? null;
    const actual = content === null ? null : sha256(content);
    if (content !== null) bytes.set(file, content);
    const status: FileCheckStatus =
      content === null
        ? expected === null
          ? 'absent'
          : 'missing'
        : expected === null
          ? 'unrecorded'
          : expected === actual
            ? 'ok'
            : 'hash-mismatch';
    files.push({ file, status, expected, actual });
  }
  return { files, bytes };
}

/**
 * Load `gt-skill-rubric@v1` through `read`, check it against MANIFEST.json and
 * evaluate the trust bar. Throws {@link RubricGroundTruthError} on a broken file.
 */
export function loadRubricGroundTruth(
  read: GroundTruthFileReader,
  options: LoadRubricGroundTruthOptions,
): RubricGroundTruth {
  const [reference, comparison] = options.raters;
  if (reference === comparison) {
    throw new RubricGroundTruthError('the two raters must be different');
  }
  const panelExclusion =
    options.panel === undefined
      ? null
      : unresolvedExclusion(
          options.panel.population,
          options.panel.unresolvedCount,
        );
  const { files, bytes } = checkGroundTruthFiles(read);
  if (files.some((check) => check.status !== 'ok' && check.status !== 'absent'))
    return { state: 'hash-mismatch', files };
  if (files.some((check) => check.status === 'absent'))
    return { state: 'absent', files };

  const documents = parseSkillDocs(bytes.get(SKILL_DOCS_FILE));
  const docIds = new Set(documents.map((doc) => doc.opaqueId));
  const labels = parseLabels(bytes.get(SKILL_LABELS_FILE), docIds, [
    reference,
    comparison,
  ]);
  const adjudications = parseAdjudications(
    bytes.get(SKILL_ADJUDICATION_FILE),
    docIds,
  );

  const consensus = new Map<string, HumanConsensus>();
  const pendingAdjudication: string[] = [];
  const unresolvedIds: string[] = [];
  const left: Record<string, RubricRating> = {};
  const right: Record<string, RubricRating> = {};
  for (const doc of documents) {
    const a = labels.get(`${doc.opaqueId}\u0000${reference}`);
    const b = labels.get(`${doc.opaqueId}\u0000${comparison}`);
    if (a === undefined || b === undefined) {
      if (options.panel === undefined) {
        throw new RubricGroundTruthError(
          `${SKILL_LABELS_FILE} has no row for ${doc.opaqueId} by ${a === undefined ? reference : comparison}`,
        );
      }
      unresolvedIds.push(doc.opaqueId);
      continue;
    }
    left[doc.opaqueId] = ratingOf(a);
    right[doc.opaqueId] = ratingOf(b);
    const needed = triggersOf(a, b);
    const adjudication = adjudications.get(doc.opaqueId);
    if (adjudication !== undefined) {
      const recorded = [...adjudication.triggers].sort(compareCodeUnits);
      if (recorded.join(',') !== [...needed].sort(compareCodeUnits).join(',')) {
        throw new RubricGroundTruthError(
          `${SKILL_ADJUDICATION_FILE}: ${doc.opaqueId} records triggers [${recorded.join(', ')}] but the raters' disagreement is [${needed.join(', ')}]`,
        );
      }
      consensus.set(doc.opaqueId, {
        total: adjudication.total,
        pass: adjudication.pass,
        adjudicated: true,
      });
    } else if (needed.length > 0) {
      pendingAdjudication.push(doc.opaqueId);
    } else {
      // No adjudication needed: both raters gave the same pass/fail.
      consensus.set(doc.opaqueId, {
        total: (a.total + b.total) / 2,
        pass: a.pass,
        adjudicated: false,
      });
    }
  }

  if (options.panel !== undefined) {
    if (options.panel.population !== documents.length) {
      throw new RubricGroundTruthError(
        `panel population ${options.panel.population} does not match the frozen ${documents.length} documents`,
      );
    }
    if (options.panel.unresolvedCount !== unresolvedIds.length) {
      throw new RubricGroundTruthError(
        `panel unresolved count ${options.panel.unresolvedCount} does not match ${unresolvedIds.length} unlabelled documents`,
      );
    }
  }
  const acceptedIds = new Set(Object.keys(left));
  const acceptedDocuments = documents.filter((doc) =>
    acceptedIds.has(doc.opaqueId),
  );
  const full = summarizeAgreement(left, right, RUBRIC_BOOTSTRAP);
  const strataMissing = acceptedDocuments.filter(
    (doc) => doc.stratum === undefined,
  ).length;
  const candidateIds = acceptedDocuments
    .filter(
      (doc) =>
        doc.stratum !== undefined && !AUTHORED_STRATA.includes(doc.stratum),
    )
    .map((doc) => doc.opaqueId);
  const candidates =
    strataMissing > 0
      ? null
      : summarizeAgreement(
          pick(left, candidateIds),
          pick(right, candidateIds),
          RUBRIC_BOOTSTRAP,
        );
  const anchors: AnchorComparison[] = documents.flatMap((doc) => {
    const human = consensus.get(doc.opaqueId);
    return doc.stratum === ANCHOR_STRATUM &&
      doc.anchor471Total !== undefined &&
      human !== undefined
      ? [{ baselineTotal: doc.anchor471Total, rescoredTotal: human.total }]
      : [];
  });
  const trust =
    candidates === null ? null : evaluateTrustBar(full, candidates, anchors);

  return {
    state: 'loaded',
    files,
    raters: [reference, comparison],
    documents,
    consensus,
    adjudicated: [...consensus.values()].filter((item) => item.adjudicated)
      .length,
    pendingAdjudication,
    strataMissing,
    full,
    candidates,
    candidateItems: strataMissing > 0 ? 0 : candidateIds.length,
    anchors,
    trust,
    ...(options.panel === undefined
      ? { method: 'labelled' as const }
      : { method: 'model-panel' as const, panel: options.panel.panel }),
    raterCount: RUBRIC_GROUND_TRUTH_RATER_COUNT,
    population: options.panel?.population ?? documents.length,
    acceptedCount: acceptedDocuments.length,
    unresolvedIds,
    unresolvedShare: panelExclusion === null ? null : panelExclusion.share,
    untrustedReason: untrustedReasonOf(
      acceptedDocuments.length,
      strataMissing,
      pendingAdjudication,
      trust,
      options.panel === undefined
        ? null
        : {
            count: unresolvedIds.length,
            population: options.panel.population,
          },
    ),
  };
}

/**
 * The `naReason` a suite scoring against this ground truth emits, or `null`
 * when the labels are trusted. Every reason starts with
 * `ground-truth-untrusted` (design 4.2).
 */
export function groundTruthNaReason(truth: RubricGroundTruth): string | null {
  switch (truth.state) {
    case 'absent':
      return `ground-truth-untrusted: ${absentFiles(truth.files)} not committed (labels pending, U1)`;
    case 'hash-mismatch':
      return `ground-truth-untrusted: ${mismatchSummary(truth.files)}`;
    case 'loaded':
      return truth.untrustedReason === null
        ? null
        : `ground-truth-untrusted: ${truth.untrustedReason}`;
  }
}

export function absentFiles(files: readonly FileCheck[]): string {
  return files
    .filter((check) => check.status === 'absent')
    .map((check) => check.file)
    .join(', ');
}

export function mismatchSummary(files: readonly FileCheck[]): string {
  return files
    .filter((check) => check.status !== 'ok' && check.status !== 'absent')
    .map(
      (check) =>
        `${check.file} ${check.status} against ${FIXTURE_MANIFEST_FILE}`,
    )
    .join('; ');
}

function untrustedReasonOf(
  documents: number,
  strataMissing: number,
  pending: readonly string[],
  trust: TrustBar | null,
  unresolved: { count: number; population: number } | null,
): string | null {
  const reasons: string[] = [];
  if (unresolved !== null && unresolved.count * 10 > unresolved.population) {
    reasons.push(
      `${PANEL_UNRESOLVED_REASON} ${unresolved.count}/${unresolved.population} exceeds ${PANEL_UNRESOLVED_SHARE_CAP}`,
    );
  }
  if (strataMissing > 0) {
    reasons.push(
      `strata not recorded for ${strataMissing} of ${documents} documents`,
    );
  }
  if (pending.length > 0) {
    reasons.push(`adjudication pending for ${pending.length} documents`);
  }
  if (trust !== null && !trust.trusted) {
    if (!trust.fullKappa.passes)
      reasons.push(`full-set kappa ${formatStat(trust.fullKappa.value)} < 0.6`);
    if (!trust.fullSpearman.passes)
      reasons.push(
        `full-set spearman ${formatStat(trust.fullSpearman.value)} < 0.7`,
      );
    if (!trust.candidatesSpearman.passes)
      reasons.push(
        `candidates-only spearman ${formatStat(trust.candidatesSpearman.value)} < 0.6`,
      );
    if (!trust.anchorStability.passes)
      reasons.push(
        `anchor stability ${trust.anchorStability.num}/${trust.anchorStability.den} within 8/80 (needs >= 8 of 10)`,
      );
  }
  return reasons.length === 0 ? null : reasons.join('; ');
}

function formatStat(value: number | null): string {
  return value === null ? 'undefined' : value.toFixed(3);
}

function triggersOf(
  a: RubricScoreRow,
  b: RubricScoreRow,
): AdjudicationRow['triggers'] {
  const triggers: AdjudicationRow['triggers'] = [];
  if (a.pass !== b.pass) triggers.push('pass-fail-differs');
  if (Math.abs(a.total - b.total) > ADJUDICATION_TOTAL_GAP)
    triggers.push('totals-differ');
  return triggers;
}

function ratingOf(row: RubricScoreRow): RubricRating {
  return {
    pass: row.pass,
    total: row.total,
    criteria: [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6, row.c7, row.c8],
  };
}

function pick<T>(
  record: Readonly<Record<string, T>>,
  ids: readonly string[],
): Record<string, T> {
  return Object.fromEntries(ids.map((id) => [id, record[id]]));
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error: unknown) {
    throw new RubricGroundTruthError(
      `not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSkillDocs(bytes: Buffer | undefined): SkillDocEntry[] {
  const parsed = skillDocsSchema.safeParse(parseJson(bytes ?? Buffer.alloc(0)));
  if (!parsed.success) {
    throw new RubricGroundTruthError(
      `${SKILL_DOCS_FILE} is invalid: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data.documents;
}

const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/**
 * Rows of a committed CSV as column→cell records. The label files carry no
 * text column, so a quote or an extra comma is a broken file, not a value.
 */
export function parseCsv(
  bytes: Buffer,
  columns: readonly string[],
  file: string,
): Record<string, string>[] {
  const lines = bytes
    .toString('utf8')
    .replace(BYTE_ORDER_MARK, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const [header, ...rows] = lines;
  if (header === undefined || header !== columns.join(',')) {
    throw new RubricGroundTruthError(
      `${file}: the header must be "${columns.join(',')}"`,
    );
  }
  return rows.map((line, index) => {
    if (line.includes('"')) {
      throw new RubricGroundTruthError(
        `${file}:${index + 2}: quoted cells are not allowed (no text columns)`,
      );
    }
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new RubricGroundTruthError(
        `${file}:${index + 2}: ${cells.length} cells, expected ${columns.length}`,
      );
    }
    return Object.fromEntries(
      columns.map((column, at) => [column, cells[at].trim()]),
    );
  });
}

function typedCells(
  cells: Record<string, string>,
  file: string,
  line: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, cell] of Object.entries(cells)) {
    if (INTEGER_COLUMNS.has(column)) {
      if (!/^\d+$/.test(cell)) {
        throw new RubricGroundTruthError(
          `${file}:${line}: ${column} must be a non-negative integer, got "${cell}"`,
        );
      }
      out[column] = Number(cell);
    } else if (column === 'pass') {
      if (cell !== 'true' && cell !== 'false') {
        throw new RubricGroundTruthError(
          `${file}:${line}: pass must be "true" or "false", got "${cell}"`,
        );
      }
      out[column] = cell === 'true';
    } else if (column === 'triggers') {
      out[column] = cell.split(';').map((trigger) => trigger.trim());
    } else {
      out[column] = cell;
    }
  }
  return out;
}

function parseLabels(
  bytes: Buffer | undefined,
  docIds: ReadonlySet<string>,
  raters: readonly string[],
): Map<string, RubricScoreRow> {
  const rows = new Map<string, RubricScoreRow>();
  parseCsv(bytes ?? Buffer.alloc(0), LABEL_COLUMNS, SKILL_LABELS_FILE).forEach(
    (cells, index) => {
      const line = index + 2;
      const parsed = rubricScoreRowSchema.safeParse(
        typedCells(cells, SKILL_LABELS_FILE, line),
      );
      if (!parsed.success) {
        throw new RubricGroundTruthError(
          `${SKILL_LABELS_FILE}:${line}: ${z.prettifyError(parsed.error)}`,
        );
      }
      const row = parsed.data;
      if (!docIds.has(row.opaqueId)) {
        throw new RubricGroundTruthError(
          `${SKILL_LABELS_FILE}:${line}: ${row.opaqueId} is not in ${SKILL_DOCS_FILE}`,
        );
      }
      if (!raters.includes(row.raterId)) {
        throw new RubricGroundTruthError(
          `${SKILL_LABELS_FILE}:${line}: rater ${row.raterId} is not one of ${raters.join(', ')}`,
        );
      }
      const key = `${row.opaqueId}\u0000${row.raterId}`;
      if (rows.has(key)) {
        throw new RubricGroundTruthError(
          `${SKILL_LABELS_FILE}:${line}: ${row.opaqueId} is rated twice by ${row.raterId}`,
        );
      }
      rows.set(key, row);
    },
  );
  return rows;
}

function parseAdjudications(
  bytes: Buffer | undefined,
  docIds: ReadonlySet<string>,
): Map<string, AdjudicationRow> {
  const rows = new Map<string, AdjudicationRow>();
  parseCsv(
    bytes ?? Buffer.alloc(0),
    ADJUDICATION_COLUMNS,
    SKILL_ADJUDICATION_FILE,
  ).forEach((cells, index) => {
    const line = index + 2;
    const parsed = adjudicationRowSchema.safeParse(
      typedCells(cells, SKILL_ADJUDICATION_FILE, line),
    );
    if (!parsed.success) {
      throw new RubricGroundTruthError(
        `${SKILL_ADJUDICATION_FILE}:${line}: ${z.prettifyError(parsed.error)}`,
      );
    }
    const row = parsed.data;
    if (!docIds.has(row.opaqueId)) {
      throw new RubricGroundTruthError(
        `${SKILL_ADJUDICATION_FILE}:${line}: ${row.opaqueId} is not in ${SKILL_DOCS_FILE}`,
      );
    }
    if (rows.has(row.opaqueId)) {
      throw new RubricGroundTruthError(
        `${SKILL_ADJUDICATION_FILE}:${line}: ${row.opaqueId} is adjudicated twice`,
      );
    }
    rows.set(row.opaqueId, row);
  });
  return rows;
}
