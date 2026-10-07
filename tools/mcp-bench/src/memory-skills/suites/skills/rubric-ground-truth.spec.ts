import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modelPanelName } from '../../labelling/model-panel';
import {
  FIXTURE_MANIFEST_FILE,
  RUBRIC_GROUND_TRUTH_ID,
  RUBRIC_GROUND_TRUTH_RATER_COUNT,
  RUBRIC_GROUND_TRUTH_VERSION,
  SKILL_ADJUDICATION_FILE,
  SKILL_DOCS_FILE,
  SKILL_LABELS_FILE,
  groundTruthNaReason,
  loadRubricGroundTruth,
  rubricGroundTruthMetadata,
  type GroundTruthFileReader,
} from './rubric-ground-truth';
import {
  sha256Of,
  writeSyntheticGroundTruth,
  type SyntheticDoc,
} from './rubric-ground-truth.test-support';

const PANEL = modelPanelName('xAI', 'Google', 'GLM');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rubric-panel-'));
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

function doc(index: number, totals: readonly [number, number]): SyntheticDoc {
  const opaqueId = `SKD-${(index + 1).toString(16).padStart(8, '0')}`;
  return {
    opaqueId,
    sha256: sha256Of(opaqueId),
    stratum: 'random',
    totals,
  };
}

function writeDocs(docs: readonly SyntheticDoc[]): void {
  writeSyntheticGroundTruth(dir, docs);
}

/** Drop both rater rows for one document and re-pin the manifest. */
function unlabel(opaqueId: string): void {
  const labelsPath = join(dir, SKILL_LABELS_FILE);
  const labels = readFileSync(labelsPath, 'utf8')
    .split('\n')
    .filter((line) => line === '' || !line.startsWith(`${opaqueId},`))
    .join('\n');
  writeFileSync(labelsPath, labels.endsWith('\n') ? labels : `${labels}\n`);
  const files = [SKILL_LABELS_FILE, SKILL_ADJUDICATION_FILE, SKILL_DOCS_FILE];
  writeFileSync(
    join(dir, FIXTURE_MANIFEST_FILE),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        files: Object.fromEntries(
          files.map((name) => [name, sha256Of(readFileSync(join(dir, name)))]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

describe('rubric ground-truth panel metadata', () => {
  it('records method, panel and raterCount for the verified families', () => {
    expect(rubricGroundTruthMetadata('model-panel', PANEL)).toEqual({
      id: RUBRIC_GROUND_TRUTH_ID,
      version: RUBRIC_GROUND_TRUTH_VERSION,
      method: 'model-panel',
      panel: 'xAI+Google; adjudicator=GLM',
      raterCount: RUBRIC_GROUND_TRUTH_RATER_COUNT,
    });
    expect(rubricGroundTruthMetadata('labelled')).toEqual({
      id: RUBRIC_GROUND_TRUTH_ID,
      version: RUBRIC_GROUND_TRUTH_VERSION,
      method: 'labelled',
      raterCount: RUBRIC_GROUND_TRUTH_RATER_COUNT,
    });
    expect(rubricGroundTruthMetadata('labelled')).not.toHaveProperty('panel');
    expect(RUBRIC_GROUND_TRUTH_RATER_COUNT).toBe(2);
  });

  it('loads without a panel as labelled, with raterCount 2', () => {
    writeDocs([doc(0, [72, 72])]);
    const truth = loadRubricGroundTruth(readerOf(dir), {
      raters: ['r1', 'r2'],
    });
    expect(truth.state).toBe('loaded');
    if (truth.state !== 'loaded') return;
    expect(truth.method).toBe('labelled');
    expect(truth.panel).toBeUndefined();
    expect(truth.raterCount).toBe(2);
    expect(truth.population).toBe(1);
    expect(truth.acceptedCount).toBe(1);
    expect(truth.unresolvedShare).toBeNull();
  });

  it('does not adjudicate a total gap of exactly 12 and does adjudicate 13', () => {
    writeDocs([doc(0, [64, 76])]);
    const within = loadRubricGroundTruth(readerOf(dir), {
      raters: ['r1', 'r2'],
    });
    expect(within.state).toBe('loaded');
    if (within.state === 'loaded')
      expect(within.pendingAdjudication).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'rubric-panel-'));
    writeDocs([doc(0, [64, 77])]);
    const over = loadRubricGroundTruth(readerOf(dir), { raters: ['r1', 'r2'] });
    expect(over.state).toBe('loaded');
    if (over.state === 'loaded') {
      expect(over.pendingAdjudication).toEqual(['SKD-00000001']);
    }
  });

  it('marks more than 10% unresolved as ground-truth-untrusted', () => {
    const docs = Array.from({ length: 10 }, (_, index) => doc(index, [72, 72]));
    writeDocs(docs);
    unlabel(docs[0].opaqueId);
    unlabel(docs[1].opaqueId);
    const truth = loadRubricGroundTruth(readerOf(dir), {
      raters: ['r1', 'r2'],
      panel: {
        method: 'model-panel',
        panel: PANEL,
        population: 10,
        unresolvedCount: 2,
      },
    });
    expect(truth.state).toBe('loaded');
    if (truth.state !== 'loaded') return;
    expect(truth.method).toBe('model-panel');
    expect(truth.panel).toBe(PANEL);
    expect(truth.raterCount).toBe(2);
    expect(truth.population).toBe(10);
    expect(truth.acceptedCount).toBe(8);
    expect(truth.full.rawAgreement.den).toBe(8);
    expect(truth.unresolvedShare).toBe(0.2);
    expect(truth.untrustedReason).toContain('unresolved-model-panel 2/10');
    expect(groundTruthNaReason(truth)).toMatch(
      /^ground-truth-untrusted: unresolved-model-panel 2\/10/,
    );
  });

  it('keeps 1 unresolved of 10 in the denominator and scores the other 9', () => {
    const docs = Array.from({ length: 10 }, (_, index) => doc(index, [72, 72]));
    writeDocs(docs);
    unlabel(docs[9].opaqueId);
    const truth = loadRubricGroundTruth(readerOf(dir), {
      raters: ['r1', 'r2'],
      panel: {
        method: 'model-panel',
        panel: PANEL,
        population: 10,
        unresolvedCount: 1,
      },
    });
    expect(truth.state).toBe('loaded');
    if (truth.state !== 'loaded') return;
    expect(truth.population).toBe(10);
    expect(truth.acceptedCount).toBe(9);
    expect(truth.unresolvedIds).toEqual([docs[9].opaqueId]);
    expect(truth.full.rawAgreement.den).toBe(9);
    expect(truth.unresolvedShare).toBe(0.1);
    expect(truth.untrustedReason ?? '').not.toContain('unresolved-model-panel');
  });
});
