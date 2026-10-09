/**
 * Batch 21.1 spec for `skill.rubric.inter-rater`. Every label here is
 * SYNTHETIC, written into the spec temp dir by `rubric-ground-truth.test-support.ts`;
 * the one real input read is the committed `fixtures/memory-skills` folder,
 * which proves the frozen U1 labels load and the trust bar is reported.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSuiteKindRegistry } from '../../../scorecard/suite-kinds';
import {
  registerMemorySkillsSuiteKinds,
  rubricDetailsSchema,
} from '../../memory-skills-suite-kinds';
import type { OfflineSuiteContext } from '../../runner/offline-suites';
import type { ReadPathGuard } from '../../runner/read-path-guard';
import { readSuiteResult, writeSuiteResult } from '../../runner/suite-result';
import {
  createRubricAgreementSuite,
  RUBRIC_AGREEMENT_SUITE_ID,
  runRubricAgreement,
} from './rubric-agreement.suite';
import {
  FIXTURE_MANIFEST_FILE,
  RubricGroundTruthError,
  SKILL_ADJUDICATION_FILE,
  SKILL_DOCS_FILE,
  SKILL_LABELS_FILE,
  type GroundTruthFileReader,
} from './rubric-ground-truth';
import {
  sha256Of,
  trustedDocs,
  writeSyntheticGroundTruth,
  type SyntheticDoc,
} from './rubric-ground-truth.test-support';

const COMMITTED_FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);
const OPTIONS = { raters: ['r1', 'r2'] as [string, string] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rubric-agreement-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readerOf(root: string): GroundTruthFileReader {
  return (name) => {
    const path = join(root, name);
    return existsSync(path) ? readFileSync(path) : null;
  };
}

function docs(): SyntheticDoc[] {
  return trustedDocs((id) => sha256Of(`document ${id}`));
}

/** Every rate metric triple satisfies value === num / den exactly. */
function expectExactRates(metrics: Record<string, number | null>): void {
  for (const key of Object.keys(metrics)) {
    if (!key.endsWith('.num')) continue;
    const name = key.slice(0, -'.num'.length);
    const num = metrics[key];
    const den = metrics[`${name}.den`];
    expect(den).not.toBeUndefined();
    if (num === null || den === null || den === undefined || den === 0) {
      expect(metrics[name]).toBeNull();
    } else {
      expect(metrics[name]).toBe(num / den);
    }
  }
}

describe('skill.rubric.inter-rater', () => {
  it('loads the committed U1 labels and reports the trust bar', () => {
    const lane = (
      raterId: string,
      family: string,
      provider: string,
      model: string,
    ) => ({
      raterId,
      family,
      provider,
      model,
      promptSha256: 'ab'.repeat(32),
      packetCount: 105,
      responseCount: 105,
      failureCount: 0,
      timestamp: '2026-10-07T00:00:00.000Z',
    });
    const { result, cases } = runRubricAgreement(readerOf(COMMITTED_FIXTURES), {
      ...OPTIONS,
      panel: {
        raters: [
          lane('r1', 'xAI', 'grok', 'grok-4.7'),
          lane('r2', 'Google', 'antigravity', 'gemini-3.1-pro'),
        ],
        adjudicator: lane(
          'adj-glm',
          'GLM',
          'ollama-cloud',
          'glm-5.3-flash:cloud',
        ),
        population: 105,
        unresolvedCount: 0,
        unresolvedShare: 0,
      },
    });
    const fileCases = cases.filter((record) =>
      record.caseId.startsWith('file/'),
    );
    expect(fileCases.map((record) => record.caseId)).toEqual([
      `file/${SKILL_LABELS_FILE}`,
      `file/${SKILL_ADJUDICATION_FILE}`,
      `file/${SKILL_DOCS_FILE}`,
    ]);
    expect(fileCases.every((record) => record.outcome === 'pass')).toBe(true);
    expect(cases.some((record) => record.caseId === 'trust/full-kappa')).toBe(
      true,
    );
    expect(result.groundTruth).toMatchObject({
      method: 'model-panel',
      panel: 'xAI+Google; adjudicator=GLM',
      raterCount: 2,
    });
    expect(result.metrics['items']).toBe(105);
    expect(result.metrics['population']).toBe(105);
    expect(result.metrics['unresolved.count']).toBe(0);
    expect(result.metrics['adjudicated']).toBe(37);
    expect(result.metrics['adjudication.pending']).toBe(0);
    expect(result.metrics['strata.missing']).toBe(0);
    expect(result.metrics['candidates.items']).toBe(80);
    expect(typeof result.metrics['full.kappaPass']).toBe('number');
    expect(typeof result.metrics['full.spearmanTotal']).toBe('number');
    expect(result.verdict === 'pass' || result.verdict === 'na').toBe(true);
    if (result.verdict === 'na') {
      expect(result.naReason).toMatch(/^ground-truth-untrusted: /);
      expect(result.naReason).not.toContain('not committed');
    }
    expect(rubricDetailsSchema.parse(result.details)).toMatchObject({
      mode: 'inter-rater',
      items: 105,
      adjudicated: 37,
      raters: ['r1', 'r2'],
      strata: {
        authored: 23,
        'promoted-synthesized': 2,
        'anchor-471': 10,
        suggestion: 18,
        'judged-model': 20,
        fallback: 20,
        random: 12,
      },
    });
    expect(result.modelCalls).toBe(0);
  });

  it('passes on trusted synthetic labels and reports full-set and candidates-only figures', () => {
    writeSyntheticGroundTruth(dir, docs());
    const { result, cases } = runRubricAgreement(readerOf(dir), OPTIONS);

    expect(result.verdict).toBe('pass');
    expect(result.naReason).toBeUndefined();
    const details = rubricDetailsSchema.parse(result.details);
    expect(details).toMatchObject({
      mode: 'inter-rater',
      items: 16,
      strata: { authored: 2, fallback: 2, random: 2, 'anchor-471': 10 },
      kappaPassFull: 1,
      rawAgreement: 1,
      adjudicated: 0,
      anchorStability: { items: 10, withinTolerance: 10 },
      trusted: true,
      intraRater: false,
    });
    expect(
      details.mode === 'inter-rater' && details.spearmanTotalFull,
    ).toBeGreaterThan(0.99);
    expect(result.metrics['candidates.items']).toBe(14);
    expect(result.metrics['full.rawAgreement.num']).toBe(16);
    expect(result.metrics['full.rawAgreement.den']).toBe(16);
    expect(result.metrics['candidates.rawAgreement.den']).toBe(14);
    expect(result.metrics['candidates.kappaPass']).toBe(1);
    expect(result.metrics['anchorStability.num']).toBe(10);
    expectExactRates(result.metrics);
    expect(result.deltas['chance']['full.kappaPass']).toBe(1);
    expect(result.deltas['trust-bar']['full.kappaPass']).toBeCloseTo(0.4, 10);
    expect(result.groundTruth).toEqual({
      id: 'gt-skill-rubric',
      version: 'v1',
      method: 'labelled',
      raterCount: 2,
    });
    expect(cases.every((record) => record.outcome === 'pass')).toBe(true);
  });

  it('computes kappa by hand on a disagreeing pair', () => {
    // r1/r2 pass: (P,P) (P,F) (F,F) (F,F) -> po = 3/4, pe = 1/2*1/4 + 1/2*3/4 = 1/2,
    // kappa = (3/4 - 1/2) / (1 - 1/2) = 1/2. The one split item is adjudicated.
    const base = docs();
    base[0] = { ...base[0], totals: [72, 72] };
    base[1] = { ...base[1], totals: [70, 60], adjudicatedTotal: 66 };
    for (const index of [2, 3, 4, 5]) {
      base[index] = { ...base[index], totals: [20, 20] };
    }
    const subset = base.slice(0, 4);
    writeSyntheticGroundTruth(dir, subset);
    const { result } = runRubricAgreement(readerOf(dir), OPTIONS);
    const details = rubricDetailsSchema.parse(result.details);
    expect(details.mode === 'inter-rater' && details.kappaPassFull).toBe(0.5);
    expect(result.metrics['full.rawAgreement']).toBe(3 / 4);
    expect(result.metrics['adjudicated']).toBe(1);
    // Four documents, no anchors: the trust bar cannot hold.
    expect(result.verdict).toBe('na');
    expect(result.naReason).toContain('anchor stability 0/0');
  });

  it('fails when a label file differs from MANIFEST.json', () => {
    writeSyntheticGroundTruth(dir, docs());
    const path = join(dir, SKILL_LABELS_FILE);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`, 'utf8');
    const { result, cases } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('fail');
    expect(result.naReason).toBeUndefined();
    expect(
      cases.find((record) => record.caseId === `file/${SKILL_LABELS_FILE}`),
    ).toMatchObject({ outcome: 'fail' });
  });

  it('fails when a label file is committed but not pinned in MANIFEST.json', () => {
    writeSyntheticGroundTruth(dir, docs(), { pin: false });
    const { result } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('fail');
  });

  it('fails when MANIFEST.json pins a label file that is gone', () => {
    writeSyntheticGroundTruth(dir, docs());
    rmSync(join(dir, SKILL_ADJUDICATION_FILE));
    const { result, cases } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('fail');
    expect(
      cases.find(
        (record) => record.caseId === `file/${SKILL_ADJUDICATION_FILE}`,
      )?.observed,
    ).toBe('missing: no file');
  });

  it('is na with the failing condition when the anchors drift past 8/80', () => {
    const drifted = docs().map((doc, index) =>
      doc.stratum === 'anchor-471' && index % 3 === 0
        ? { ...doc, anchor471Total: (doc.anchor471Total ?? 0) + 20 }
        : doc,
    );
    writeSyntheticGroundTruth(dir, drifted);
    const { result } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      'ground-truth-untrusted: anchor stability 6/10 within 8/80 (needs >= 8 of 10)',
    );
    // The measured figures stay reported.
    expect(result.metrics['full.kappaPass']).toBe(1);
    expect(result.metrics['anchorStability']).toBe(6 / 10);
  });

  it('is na while strata are not recorded (R2: strata land after adjudication)', () => {
    const unlabelled = docs().map((doc) => ({
      opaqueId: doc.opaqueId,
      sha256: doc.sha256,
      totals: doc.totals,
    }));
    writeSyntheticGroundTruth(dir, unlabelled);
    const { result } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      'ground-truth-untrusted: strata not recorded for 16 of 16 documents',
    );
    expect(result.metrics['candidates.spearmanTotal']).toBeNull();
    expectExactRates(result.metrics);
  });

  it('is na while a disagreement waits for adjudication', () => {
    const pending = docs();
    pending[0] = { ...pending[0], totals: [72, 40] };
    writeSyntheticGroundTruth(dir, pending);
    const { result } = runRubricAgreement(readerOf(dir), OPTIONS);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toContain('adjudication pending for 1 documents');
  });

  it('throws on a structurally broken label file', () => {
    writeSyntheticGroundTruth(dir, docs());
    const path = join(dir, SKILL_LABELS_FILE);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.splice(1, 1);
    writeFileSync(path, lines.join('\n'), 'utf8');
    // Re-pin so the hash check passes and the parser sees the missing row.
    const manifest = JSON.parse(
      readFileSync(join(dir, 'MANIFEST.json'), 'utf8'),
    ) as {
      files: Record<string, string>;
    };
    manifest.files[SKILL_LABELS_FILE] = sha256Of(readFileSync(path));
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest), 'utf8');
    expect(() => runRubricAgreement(readerOf(dir), OPTIONS)).toThrow(
      RubricGroundTruthError,
    );
  });

  it('runs as an offline suite through the read guard and writes a valid scorecard suite', async () => {
    writeSyntheticGroundTruth(dir, docs());
    const reads: string[] = [];
    const read: ReadPathGuard = {
      assertReadable: (path) => path,
      readText: (path) => readFileSync(path, 'utf8'),
      readBytes: (path) => {
        reads.push(path);
        return readFileSync(path);
      },
    };
    const runDir = join(dir, 'run');
    const context: OfflineSuiteContext = {
      runId: 'spec',
      runDir,
      options: {},
      ci: true,
      read,
      guardWorkerEntry: (entry) => entry,
    };
    const suite = createRubricAgreementSuite({ fixturesDir: dir });
    const output = await suite.run(context);
    expect(reads.sort()).toEqual(
      [
        'MANIFEST.json',
        SKILL_ADJUDICATION_FILE,
        SKILL_DOCS_FILE,
        SKILL_LABELS_FILE,
      ]
        .map((name) => join(dir, name))
        .sort(),
    );
    writeSuiteResult(runDir, output.result, output.cases);
    const { result } = readSuiteResult(runDir, RUBRIC_AGREEMENT_SUITE_ID);
    expect(result.verdict).toBe('pass');

    const registry = createSuiteKindRegistry();
    registerMemorySkillsSuiteKinds(registry);
    expect(
      registry
        .getSuiteKind(result.kind)
        ?.detailsSchema.safeParse(result.details).success,
    ).toBe(true);
  });

  it('marks committed U1 labels as untrusted when the panel manifest is missing', async () => {
    const context: OfflineSuiteContext = {
      runId: 'spec',
      runDir: dir,
      options: {},
      ci: true,
      read: {
        assertReadable: (path) => path,
        readText: (path) => readFileSync(path, 'utf8'),
        readBytes: (path) => readFileSync(path),
      },
      guardWorkerEntry: (entry) => entry,
    };
    const suite = createRubricAgreementSuite({
      fixturesDir: COMMITTED_FIXTURES,
      panelManifest: { ok: false, reason: 'panel-manifest-missing' },
    });

    const { result } = await suite.run(context);

    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      'ground-truth-untrusted: panel-manifest-missing',
    );
    expect(result.groundTruth.method).toBe('model-panel');
    expect(result.groundTruth.method).not.toBe('labelled');
  });

  it('refuses one rater named twice', () => {
    writeSyntheticGroundTruth(dir, docs());
    expect(() =>
      runRubricAgreement(readerOf(dir), { raters: ['r1', 'r1'] }),
    ).toThrow(RubricGroundTruthError);
  });

  it('carries panel provenance and scores 9 of a frozen population of 10', () => {
    const labelled = Array.from({ length: 10 }, (_, index) => {
      const opaqueId = `SKD-${(index + 1).toString(16).padStart(8, '0')}`;
      return {
        opaqueId,
        sha256: sha256Of(opaqueId),
        stratum: 'random' as const,
        totals: [72, 72] as const,
      };
    });
    writeSyntheticGroundTruth(dir, labelled);
    const dropped = labelled[9].opaqueId;
    const labelsPath = join(dir, SKILL_LABELS_FILE);
    const labels = readFileSync(labelsPath, 'utf8')
      .split('\n')
      .filter((line) => line === '' || !line.startsWith(`${dropped},`))
      .join('\n');
    writeFileSync(labelsPath, labels.endsWith('\n') ? labels : `${labels}\n`);
    const pinned = [
      SKILL_LABELS_FILE,
      SKILL_ADJUDICATION_FILE,
      SKILL_DOCS_FILE,
    ];
    writeFileSync(
      join(dir, FIXTURE_MANIFEST_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          files: Object.fromEntries(
            pinned.map((name) => [
              name,
              sha256Of(readFileSync(join(dir, name))),
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
    const { result } = runRubricAgreement(readerOf(dir), {
      raters: ['r1', 'r2'],
      panel: {
        raters: [
          laneManifest('r1', 'xAI', 'grok', 'grok-4.7'),
          laneManifest('r2', 'Google', 'antigravity', 'gemini-3.1-pro'),
        ],
        adjudicator: laneManifest(
          'r3',
          'GLM',
          'ollama-cloud',
          'glm-5.3-flash:cloud',
        ),
        population: 10,
        unresolvedCount: 1,
        unresolvedShare: 0.1,
      },
    });
    expect(result.groundTruth).toEqual({
      id: 'gt-skill-rubric',
      version: 'v1',
      method: 'model-panel',
      panel: 'xAI+Google; adjudicator=GLM',
      raterCount: 2,
    });
    expect(result.claim.text).toContain('xAI+Google; adjudicator=GLM');
    expect(result.claim.text).not.toContain('model-panel:');
    expect(result.claim.text).toContain('raterCount=2');
    expect(result.metrics['items']).toBe(9);
    expect(result.metrics['population']).toBe(10);
    expect(result.metrics['unresolved.count']).toBe(1);
    expect(result.metrics['unresolved.share']).toBe(0.1);
    expect(result.metrics['full.rawAgreement.den']).toBe(9);
    expect(result.naReason ?? '').not.toContain('unresolved-model-panel');
  });
});

function laneManifest(
  raterId: string,
  family: string,
  provider: string,
  model: string,
) {
  return {
    raterId,
    family,
    provider,
    model,
    promptSha256: sha256Of('panel-prompt'),
    packetCount: 10,
    responseCount: 9,
    failureCount: 1,
    timestamp: '2026-10-07T00:00:00.000Z',
  };
}
