/**
 * `skill.rubric.inter-rater` (benchmark-design.md 4.2, batches.md Task 21.1).
 * An OFFLINE suite: model-free, it runs in the runner parent and reads only the
 * committed fixtures through the read-path guard (`runner/read-path-guard.ts`),
 * so a number never comes from an uncommitted edit.
 *
 * It recomputes the agreement of the two human raters of `gt-skill-rubric@v1`
 * from the committed CSVs (`rubric-ground-truth.ts`), on the full set and on
 * the candidates-only subset (strata other than `authored` and
 * `promoted-synthesized`, the blinding limit of design 4.2), plus the anchor
 * stability of the ten `anchor-471` documents.
 *
 * Verdict:
 *   - `fail` when a label file's bytes differ from MANIFEST.json, the manifest
 *     pins a file that is gone, or a label file is present but unpinned;
 *   - `na: ground-truth-untrusted …` while the files are absent (labels are
 *     U1, pending today) or the trust bar is unmet (strata missing,
 *     adjudication pending, kappa/spearman/anchors below the bar). The
 *     measured figures stay in `details` and `metrics`;
 *   - `pass` only when all three trust-bar conditions hold, against the
 *     `chance` baseline (kappa = rho = 0) and the `trust-bar` thresholds.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { RubricDetails } from '../../memory-skills-suite-kinds';
import type {
  AgreementSummary,
  KappaStatistic,
} from '../../metrics/agreement-metrics';
import type {
  MemorySkillsOfflineSuite,
  OfflineSuiteContext,
  OfflineSuiteOutput,
} from '../../runner/offline-suites';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import {
  deltaOf,
  inputSha256,
  rateMetrics,
} from '../memory/memory-suite-support';
import { panelManifestSchema } from '../../labelling/model-panel';
import type { RubricPanelManifestLoadResult } from './rubric-panel-manifest';
import {
  FIXTURE_MANIFEST_FILE,
  groundTruthNaReason,
  loadRubricGroundTruth,
  panelProvenanceFromManifest,
  rubricGroundTruthMetadata,
  RUBRIC_GROUND_TRUTH_FILES,
  RUBRIC_GROUND_TRUTH_ID,
  RUBRIC_GROUND_TRUTH_RATER_COUNT,
  RUBRIC_GROUND_TRUTH_VERSION,
  type FileCheck,
  type GroundTruthFileReader,
  type LoadedRubricGroundTruth,
  type RubricGroundTruth,
} from './rubric-ground-truth';

export const RUBRIC_AGREEMENT_SUITE_ID = 'skill.rubric.inter-rater';

const raterId = z.string().regex(/^[a-z0-9-]{1,32}$/, 'rater id');

export const rubricAgreementOptionsSchema = z
  .strictObject({
    /** The two rater ids; the first is the reference. */
    raters: z.tuple([raterId, raterId]).default(['r1', 'r2']),
    /** Private model-panel manifest. Eligibility is part of the schema. */
    panel: panelManifestSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.panel === undefined) return;
    const [left, right] = value.panel.raters;
    if (left.raterId !== value.raters[0] || right.raterId !== value.raters[1]) {
      ctx.addIssue({
        code: 'custom',
        message: 'panel rater ids must match options.raters',
        path: ['panel'],
      });
    }
  });
export type RubricAgreementOptions = z.infer<
  typeof rubricAgreementOptionsSchema
>;

/** Trust-bar thresholds (design 4.2), also the suite's `trust-bar` baseline. */
const TRUST_BAR_BASELINE = {
  'full.kappaPass': 0.6,
  'full.spearmanTotal': 0.7,
  'candidates.spearmanTotal': 0.6,
  anchorStability: 0.8,
} as const;

const CHANCE_BASELINE = {
  'full.kappaPass': 0,
  'full.spearmanTotal': 0,
  'candidates.spearmanTotal': 0,
} as const;

function kappaMetrics(
  name: string,
  kappa: KappaStatistic,
): Record<string, number | null> {
  return {
    [name]: kappa.value,
    [`${name}.ci95.low`]: kappa.interval?.[0] ?? null,
    [`${name}.ci95.high`]: kappa.interval?.[1] ?? null,
  };
}

function summaryMetrics(
  prefix: string,
  summary: AgreementSummary,
): Record<string, number | null> {
  return {
    ...kappaMetrics(`${prefix}.kappaPass`, summary.passFailKappa),
    [`${prefix}.spearmanTotal`]: summary.totalsSpearman.value,
    ...rateMetrics(`${prefix}.rawAgreement`, summary.rawAgreement),
    ...Object.fromEntries(
      summary.criterionKappas.map((kappa, index) => [
        `${prefix}.criterion.c${index + 1}.qwk`,
        kappa.value,
      ]),
    ),
  };
}

/** Headline metrics; every rate is `value`, `.num`, `.den` with value == num/den. */
export function rubricAgreementMetrics(
  truth: LoadedRubricGroundTruth,
): Record<string, number | null> {
  const anchors = truth.trust?.anchorStability;
  return {
    items: truth.acceptedCount,
    population: truth.population,
    'unresolved.count': truth.unresolvedIds.length,
    'unresolved.share': truth.unresolvedShare,
    'candidates.items': truth.candidateItems,
    adjudicated: truth.adjudicated,
    'adjudication.pending': truth.pendingAdjudication.length,
    'strata.missing': truth.strataMissing,
    ...summaryMetrics('full', truth.full),
    ...(truth.candidates === null
      ? {
          'candidates.kappaPass': null,
          'candidates.spearmanTotal': null,
          'candidates.rawAgreement': null,
          'candidates.rawAgreement.num': 0,
          'candidates.rawAgreement.den': 0,
        }
      : summaryMetrics('candidates', truth.candidates)),
    ...(anchors === undefined
      ? {
          anchorStability: null,
          'anchorStability.num': truth.anchors.length === 0 ? 0 : null,
          'anchorStability.den': truth.anchors.length,
        }
      : rateMetrics('anchorStability', anchors)),
    trusted: truth.untrustedReason === null ? 1 : 0,
  };
}

function strataOf(truth: LoadedRubricGroundTruth): Record<string, number> {
  const strata: Record<string, number> = {};
  for (const doc of truth.documents) {
    const key = doc.stratum ?? 'unrecorded';
    strata[key] = (strata[key] ?? 0) + 1;
  }
  return strata;
}

function detailsOf(
  truth: RubricGroundTruth,
  raters: readonly [string, string],
): RubricDetails {
  if (truth.state !== 'loaded') {
    return {
      mode: 'inter-rater',
      rubricId: '471-exemplar-8',
      rubricVersion: RUBRIC_GROUND_TRUTH_VERSION,
      raters: [...raters],
      intraRater: false,
      items: 0,
      strata: {},
      kappaPassFull: null,
      spearmanTotalFull: null,
      spearmanTotalCandidates: null,
      rawAgreement: null,
      adjudicated: 0,
      anchorStability: { items: 0, withinTolerance: 0 },
      trusted: false,
    };
  }
  const anchors = truth.trust?.anchorStability;
  return {
    mode: 'inter-rater',
    rubricId: '471-exemplar-8',
    rubricVersion: RUBRIC_GROUND_TRUTH_VERSION,
    raters: [...truth.raters],
    intraRater: false,
    items: truth.acceptedCount,
    strata: strataOf(truth),
    kappaPassFull: truth.full.passFailKappa.value,
    spearmanTotalFull: truth.full.totalsSpearman.value,
    spearmanTotalCandidates: truth.candidates?.totalsSpearman.value ?? null,
    rawAgreement: truth.full.rawAgreement.value,
    adjudicated: truth.adjudicated,
    anchorStability: {
      items: anchors?.den ?? truth.anchors.length,
      withinTolerance: anchors?.num ?? 0,
    },
    trusted: truth.untrustedReason === null,
  };
}

function fileCase(check: FileCheck): CaseRecord {
  return {
    caseId: `file/${check.file}`,
    inputSha256: inputSha256({ file: check.file, expected: check.expected }),
    expected:
      check.expected === null
        ? `committed and pinned in ${FIXTURE_MANIFEST_FILE}`
        : `sha256 ${check.expected}`,
    observed:
      check.actual === null
        ? `${check.status}: no file`
        : `${check.status}: sha256 ${check.actual}`,
    outcome: check.status === 'ok' ? 'pass' : 'fail',
    cassetteKey: null,
    latencyMs: 0,
    error: null,
  };
}

function trustCases(truth: LoadedRubricGroundTruth): CaseRecord[] {
  const trust = truth.trust;
  const subject = {
    files: truth.files.map((check) => check.actual),
    raters: truth.raters,
  };
  const value = (stat: number | null): string =>
    stat === null ? 'undefined' : String(stat);
  const rows: [string, string, string, boolean][] =
    trust === null
      ? [
          [
            'trust/strata',
            'every document has a stratum',
            `${truth.strataMissing} of ${truth.documents.length} without a stratum`,
            false,
          ],
        ]
      : [
          [
            'trust/full-kappa',
            'full-set pass/fail kappa >= 0.6',
            `kappa ${value(trust.fullKappa.value)}`,
            trust.fullKappa.passes,
          ],
          [
            'trust/full-spearman',
            'full-set totals spearman >= 0.7',
            `rho ${value(trust.fullSpearman.value)}`,
            trust.fullSpearman.passes,
          ],
          [
            'trust/candidates-spearman',
            'candidates-only totals spearman >= 0.6',
            `rho ${value(trust.candidatesSpearman.value)} over ${truth.candidateItems} documents`,
            trust.candidatesSpearman.passes,
          ],
          [
            'trust/anchor-stability',
            '>= 8 of 10 anchor-471 documents within 8/80 of 471 totals',
            `${trust.anchorStability.num}/${trust.anchorStability.den} within tolerance`,
            trust.anchorStability.passes,
          ],
        ];
  rows.push([
    'trust/adjudication',
    'every disagreement (pass/fail differs or totals differ by > 12) adjudicated',
    `${truth.pendingAdjudication.length} pending, ${truth.adjudicated} adjudicated`,
    truth.pendingAdjudication.length === 0,
  ]);
  return rows.map(([caseId, expected, observed, pass]) => ({
    caseId,
    inputSha256: inputSha256({ ...subject, caseId }),
    expected,
    observed,
    outcome: pass ? 'pass' : 'fail',
    cassetteKey: null,
    latencyMs: 0,
    error: null,
  }));
}

/** Score `gt-skill-rubric@v1` read through `read` (pure apart from the reader). */
export function runRubricAgreement(
  read: GroundTruthFileReader,
  options: RubricAgreementOptions,
  panelManifest?: RubricPanelManifestLoadResult,
): OfflineSuiteOutput {
  const panel =
    panelManifest === undefined
      ? options.panel
      : panelManifest.ok
        ? panelManifest.panel
        : undefined;
  const truth = loadRubricGroundTruth(read, {
    raters: options.raters,
    ...(panel === undefined
      ? {}
      : { panel: panelProvenanceFromManifest(panel) }),
  });
  const cases = [
    ...truth.files.map(fileCase),
    ...(truth.state === 'loaded' ? trustCases(truth) : []),
  ];
  const metrics =
    truth.state === 'loaded'
      ? rubricAgreementMetrics(truth)
      : {
          items: 0,
          trusted: 0,
          'files.ok': truth.files.filter((check) => check.status === 'ok')
            .length,
          'files.total': truth.files.length,
        };
  const baselines: SuiteResultInput['baselines'] = [
    {
      id: 'chance',
      label: 'chance agreement (kappa = 0, rho = 0)',
      metrics: { ...CHANCE_BASELINE },
    },
    {
      id: 'trust-bar',
      label:
        'design 4.2 trust bar (kappa >= 0.6, rho >= 0.7 full; rho >= 0.6 candidates-only; >= 8/10 anchors)',
      metrics: { ...TRUST_BAR_BASELINE },
    },
  ];
  const naReason =
    panelManifest !== undefined && !panelManifest.ok
      ? `ground-truth-untrusted: ${panelManifest.reason}`
      : groundTruthNaReason(truth);
  const verdict: SuiteResultInput['verdict'] =
    truth.state === 'hash-mismatch'
      ? 'fail'
      : naReason === null
        ? 'pass'
        : 'na';
  return {
    cases,
    result: {
      suiteId: RUBRIC_AGREEMENT_SUITE_ID,
      kind: 'rubric',
      details: detailsOf(truth, options.raters),
      claim: {
        source: 'ledger',
        ref: 'benchmark-design.md 4.2 (trust bar of gt-skill-rubric@v1)',
        text:
          truth.state === 'loaded' && truth.panel !== undefined
            ? `Model-panel agreement on the 471 exemplar rubric (${truth.panel}; raterCount=${RUBRIC_GROUND_TRUTH_RATER_COUNT}).`
            : panelManifest !== undefined && !panelManifest.ok
              ? 'Model-panel provenance for the 471 exemplar rubric is unavailable, so gt-skill-rubric@v1 is untrusted.'
              : 'Two independent human raters agree on the 471 exemplar rubric well enough for gt-skill-rubric@v1 to be ground truth.',
      },
      groundTruth:
        panelManifest !== undefined && !panelManifest.ok
          ? {
              id: RUBRIC_GROUND_TRUTH_ID,
              version: RUBRIC_GROUND_TRUTH_VERSION,
              method: 'model-panel',
              panel: 'unverified',
              raterCount: RUBRIC_GROUND_TRUTH_RATER_COUNT,
            }
          : truth.state === 'loaded'
            ? rubricGroundTruthMetadata(truth.method, truth.panel)
            : {
                id: RUBRIC_GROUND_TRUTH_ID,
                version: RUBRIC_GROUND_TRUTH_VERSION,
                method: 'labelled',
              },
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(metrics, baseline.metrics),
        ]),
      ),
      cost: {
        calls: 0,
        latency_ms: { p50: null, p95: null },
        error_rate: null,
        tokens: {},
      },
      modelCalls: 0,
      verdict,
      ...(verdict === 'na' && naReason !== null ? { naReason } : {}),
      metrics,
      cassetteVersion: null,
    },
  };
}

export interface RubricAgreementSuiteDeps {
  /** Absolute `tools/mcp-bench/fixtures/memory-skills` of the checkout. */
  readonly fixturesDir: string;
  readonly panelManifest?: RubricPanelManifestLoadResult;
}

/**
 * The offline suite. Registered in `run-memory-skills.entry.ts`, where the
 * repository root is known; a missing file is `absent`, every present file is
 * read through the guard (committed and unchanged, or the run refuses it).
 */
export function createRubricAgreementSuite(
  deps: RubricAgreementSuiteDeps,
): MemorySkillsOfflineSuite {
  return {
    id: RUBRIC_AGREEMENT_SUITE_ID,
    run(context: OfflineSuiteContext): Promise<OfflineSuiteOutput> {
      const options = rubricAgreementOptionsSchema.parse(context.options ?? {});
      const read: GroundTruthFileReader = (name) => {
        const path = join(deps.fixturesDir, name);
        return existsSync(path) ? context.read.readBytes(path) : null;
      };
      return Promise.resolve(
        runRubricAgreement(read, options, deps.panelManifest),
      );
    },
  };
}

/** Files the plan's `groundTruth.paths` should list for this suite. */
export const RUBRIC_AGREEMENT_FILES: readonly string[] = [
  ...RUBRIC_GROUND_TRUTH_FILES,
  FIXTURE_MANIFEST_FILE,
];
