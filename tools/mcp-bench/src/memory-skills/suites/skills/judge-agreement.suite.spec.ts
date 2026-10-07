/**
 * Batch 21.2 spec for `skill.judge-agreement` and `.panel`. It drives the REAL
 * `SkillJudgeService` and `JudgePanelService`, constructed positionally as the
 * product's own specs do, through the REAL `RecordedLaneRunner` double and the
 * pass-through `LaneTap`. The "model" behind the double is a synthetic lane in
 * this file (it scores a document from a planned table); it is recorded into
 * the spec temp dir and replayed from there. Labels, documents and the id-map
 * are synthetic too. No live model, no bench host, no real packet.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  JudgePanelService,
  SkillJudgeService,
  type LaneRunnerService,
  type LaneRunRequest,
  type LaneRunResult,
  type NewCandidateInput,
  type SkillCandidateRow,
  type SkillCandidateStore,
  type SkillSynthesisSettings,
} from '@ptah-extension/skill-synthesis';
import type { Logger } from '@ptah-extension/vscode-core';

import { CassetteStore } from '../../doubles/cassette-store';
import { RecordedLaneRunner } from '../../doubles/recorded-lane-runner';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { rubricDetailsSchema } from '../../memory-skills-suite-kinds';
import { readSuiteResult } from '../../runner/suite-result';
import {
  createJudgeAgreementSuites,
  JUDGE_AGREEMENT_SUITE_ID,
  JUDGE_PANEL_AGREEMENT_SUITE_ID,
  judgeAgreementOptionsSchema,
  judgeAgreementPorts,
  runJudgeAgreement,
  type JudgeKind,
  type JudgeServices,
} from './judge-agreement.suite';
import { JudgeCorpusError, loadJudgeCorpus } from './judge-corpus';
import { LaneTap } from './judge-lane-tap';
import {
  loadRubricGroundTruth,
  panelProvenanceFromManifest,
} from './rubric-ground-truth';
import {
  sha256Of,
  trustedDocs,
  writeSyntheticGroundTruth,
  type SyntheticDoc,
} from './rubric-ground-truth.test-support';

const PLANTED = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
  'planted-negatives.v1',
);
const MODEL = 'synthetic:judge-spec';
const MIN_JUDGE_SCORE = 6;

const SETTINGS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 200,
  candidatesDir: '',
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinToolUses: 2,
  // Off on purpose: the suite must force the gate on to measure it.
  judgeEnabled: false,
  minJudgeScore: MIN_JUDGE_SCORE,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 2,
  suggestionMaxCandidates: 1000,
};

function logger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** Bodies of pseudo-random length, so the length baseline is near chance. */
function documentText(opaqueId: string, index: number): string {
  const body = `## Steps\n\n${'step '.repeat(20 + ((index * 37) % 17) * 9)}\n`;
  return `---\nname: ${opaqueId}\ndescription: "Use when synthetic case ${index} applies."\n---\n\n${body}`;
}

interface Fixture {
  readonly root: string;
  readonly home: string;
  readonly docs: SyntheticDoc[];
  readonly texts: Map<string, string>;
}

function writeCorpus(home: string): {
  docs: SyntheticDoc[];
  texts: Map<string, string>;
} {
  const texts = new Map<string, string>();
  const docs = trustedDocs((opaqueId) => {
    const text = documentText(opaqueId, texts.size);
    texts.set(opaqueId, text);
    return sha256Of(text);
  });
  const documentsDir = join(home, 'judge-agreement', 'documents');
  mkdirSync(documentsDir, { recursive: true });
  const idMap: Record<string, unknown> = {};
  for (const doc of docs) {
    writeFileSync(
      join(documentsDir, `${doc.opaqueId}.md`),
      texts.get(doc.opaqueId) ?? '',
      'utf8',
    );
    // Private keys the suite must ignore ride along, as in the real id-map.
    idMap[doc.opaqueId] = {
      stratum: doc.stratum,
      sha256: doc.sha256,
      slug: `private-slug-${doc.opaqueId}`,
    };
  }
  writeFileSync(
    join(home, 'judge-agreement', 'id-map.json'),
    JSON.stringify(idMap),
    'utf8',
  );
  cpSync(
    PLANTED,
    join(home, 'fixtures', 'memory-skills', 'planted-negatives.v1'),
    {
      recursive: true,
    },
  );
  return { docs, texts };
}

function fixture(options: { labels: boolean }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'judge-agreement-'));
  const home = join(root, 'home');
  const { docs, texts } = writeCorpus(home);
  if (options.labels) {
    writeSyntheticGroundTruth(join(home, 'fixtures', 'memory-skills'), docs);
  }
  return { root, home, docs, texts };
}

function corpusOf(home: string) {
  return loadJudgeCorpus({
    documentsDir: join(home, 'judge-agreement', 'documents'),
    idMapFile: join(home, 'judge-agreement', 'id-map.json'),
    plantedNegativesDir: join(
      home,
      'fixtures',
      'memory-skills',
      'planted-negatives.v1',
    ),
  });
}

function truthOf(
  home: string,
  panel?: ReturnType<typeof judgeAgreementOptionsSchema.parse>['panel'],
) {
  const dir = join(home, 'fixtures', 'memory-skills');
  return loadRubricGroundTruth(
    (name) => {
      const path = join(dir, name);
      return existsSync(path) ? readFileSync(path) : null;
    },
    {
      raters: ['r1', 'r2'],
      ...(panel === undefined
        ? {}
        : { panel: panelProvenanceFromManifest(panel) }),
    },
  );
}

/** The synthetic lane: composite = clamp(total / 8 - 2, 1, 10); planted -> `planted`. */
function syntheticLane(
  docs: readonly SyntheticDoc[],
  planted = 2,
  model = MODEL,
): Pick<LaneRunnerService, 'run'> {
  const plan = new Map(
    docs.map((doc) => [
      doc.opaqueId,
      Math.min(10, Math.max(1, doc.totals[0] / 8 - 2)),
    ]),
  );
  return {
    run(req: LaneRunRequest): Promise<LaneRunResult> {
      const name = /^Skill name: (.+)$/m.exec(req.prompt)?.[1] ?? '';
      const value = plan.get(name) ?? planted;
      const json = {
        novelty: value,
        actionability: value,
        scope: value,
        generalization: value,
        triggerClarity: value,
      };
      return Promise.resolve({
        status: 'ok',
        run: {
          lane: { model },
          text: JSON.stringify(json),
          json,
          structuredOutputHonoured: true,
          usage: {},
          truncated: false,
          degradedReason: null,
          executions: 1,
          passesAllowed: 1,
        },
      } as unknown as LaneRunResult);
    },
  };
}

/** The candidate store surface the ports and the panel touch, in memory. */
class InMemoryCandidates {
  readonly rows = new Map<string, SkillCandidateRow>();
  readonly verdicts: string[] = [];

  registerCandidate(input: NewCandidateInput) {
    const existing = [...this.rows.values()].find(
      (row) => row.trajectoryHash === input.trajectoryHash,
    );
    if (existing) return { candidate: existing, reused: true };
    const row = {
      id: `cand-${this.rows.size + 1}`,
      name: input.name,
      description: input.description,
      bodyPath: input.bodyPath,
      trajectoryHash: input.trajectoryHash,
      status: 'candidate',
      triggerScore: null,
      triggerPrecision: null,
      triggerRecall: null,
      replayConfidence: null,
    } as unknown as SkillCandidateRow;
    this.rows.set(row.id, row);
    return { candidate: row, reused: false };
  }

  findById(id: string): SkillCandidateRow | null {
    return this.rows.get(id) ?? null;
  }

  listByStatus(): SkillCandidateRow[] {
    return [];
  }

  recordJudgeVerdict(id: string): void {
    this.verdicts.push(id);
  }

  recordJudgePanel(): void {
    // The rationale column is not read by the suite.
  }
}

function services(
  inner: Pick<LaneRunnerService, 'run'>,
  laneMode: 'record' | 'replay',
  store = new InMemoryCandidates(),
): JudgeServices & { store: InMemoryCandidates } {
  const tap = new LaneTap(inner);
  const lane = tap as unknown as LaneRunnerService;
  const judge = new SkillJudgeService(logger(), lane);
  const workspace = {
    getConfiguration: <T>(_section: string, _key: string, fallback: T) =>
      fallback,
  } as unknown as IWorkspaceProvider;
  const panel = new JudgePanelService(
    logger(),
    workspace,
    judge,
    lane,
    store as unknown as SkillCandidateStore,
    null,
  );
  return { judge, panel, store, settings: SETTINGS, tap, laneMode };
}

function recordingLane(
  root: string,
  inner: Pick<LaneRunnerService, 'run'>,
): RecordedLaneRunner {
  return new RecordedLaneRunner({
    store: new CassetteStore({
      path: join(root, 'cassettes', 'lane-runner.jsonl'),
      mode: 'record',
    }),
    model: MODEL,
    inner,
  });
}

function replayingLane(root: string): RecordedLaneRunner {
  return new RecordedLaneRunner({
    store: new CassetteStore({
      path: join(root, 'cassettes', 'lane-runner.jsonl'),
      mode: 'replay',
    }),
    model: MODEL,
  });
}

async function judgeRun(
  f: Fixture,
  kind: JudgeKind,
  svc: JudgeServices,
  overrides: Record<string, unknown> = {},
  runName = 'run',
) {
  const options = judgeAgreementOptionsSchema.parse({
    model: MODEL,
    ...overrides,
  });
  return runJudgeAgreement({
    suiteId:
      kind === 'skill-judge'
        ? JUDGE_AGREEMENT_SUITE_ID
        : JUDGE_PANEL_AGREEMENT_SUITE_ID,
    runDir: join(f.root, runName),
    options,
    corpus: corpusOf(f.home),
    truth: truthOf(f.home, options.panel),
    ports: judgeAgreementPorts(kind, svc),
  });
}

function expectExactRates(metrics: Record<string, number | null>): void {
  for (const key of Object.keys(metrics)) {
    if (!key.endsWith('.num')) continue;
    const name = key.slice(0, -'.num'.length);
    const num = metrics[key];
    const den = metrics[`${name}.den`];
    if (num === null || den === null || den === 0) {
      expect(metrics[name]).toBeNull();
    } else {
      expect(metrics[name]).toBe(num / den);
    }
  }
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tracked(f: Fixture): Fixture {
  roots.push(f.root);
  return f;
}

describe('skill.judge-agreement', () => {
  it('passes in record mode on trusted synthetic labels, with both controls and the baselines', async () => {
    const f = tracked(fixture({ labels: true }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const { result, cases, rawPath } = await judgeRun(f, 'skill-judge', svc);

    expect(result.naReason).toBeUndefined();
    expect(result.verdict).toBe('pass');
    // 16 labelled + 10 planted, three repeats each; one lane call per run.
    expect(cases).toHaveLength(26 * 3);
    expect(result.modelCalls).toBe(26 * 3);
    expect(result.cost.calls).toBe(26 * 3);
    const details = rubricDetailsSchema.parse(result.details);
    if (details.mode !== 'judge-vs-human') throw new Error('wrong mode');
    expect(details).toMatchObject({
      judge: 'skill-judge',
      model: MODEL,
      repeats: 3,
      positiveControl: { n: 6, passRate: 1 },
      negativeControl: { n: 36, failRate: 1 },
      meanRepeatSd: 0,
      saturationShare: 0,
    });
    // The rubric the product sent, pinned by sha256.
    expect(details.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metrics['promptPin.distinct']).toBe(1);
    expect(details.spearman).toBeGreaterThan(0.95);
    expect(result.metrics['all.items']).toBe(16);
    expect(result.metrics['withoutAnchor.items']).toBe(6);
    expect(result.metrics['all.marginOverLength']).toBeGreaterThanOrEqual(0.2);
    expect(
      result.metrics['withoutAnchor.marginOverLength'],
    ).toBeGreaterThanOrEqual(0.2);
    expect(result.metrics['minJudgeScore']).toBe(MIN_JUDGE_SCORE);
    expectExactRates(result.metrics);
    expect(result.baselines.map((baseline) => baseline.id)).toEqual([
      'score-by-length',
      'random-scorer',
    ]);
    expect(result.deltas['score-by-length']['all.spearman']).toBe(
      (result.metrics['all.spearman'] ?? 0) -
        (result.metrics['all.lengthSpearman'] ?? 0),
    );

    // Raw outputs live in the run dir only; cases carry no document text.
    const raw = readFileSync(rawPath, 'utf8').trim().split('\n');
    expect(raw).toHaveLength(26 * 3);
    expect(rawPath.startsWith(join(f.root, 'run'))).toBe(true);
    const serialisedCases = JSON.stringify(cases);
    for (const text of f.texts.values()) {
      expect(serialisedCases).not.toContain(text.slice(40, 120));
    }
    expect(serialisedCases).not.toContain('private-slug');
  });

  it('is na (lane-runner-replay) when the same outputs are replayed from the cassette', async () => {
    const f = tracked(fixture({ labels: true }));
    await judgeRun(
      f,
      'skill-judge',
      services(recordingLane(f.root, syntheticLane(f.docs)), 'record'),
    );
    const { result } = await judgeRun(
      f,
      'skill-judge',
      services(replayingLane(f.root), 'replay'),
      {},
      'replay-run',
    );
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/^lane-runner-replay: /);
    // The replayed numbers stay reported.
    expect(result.metrics['positiveControl.passRate']).toBe(1);
  });

  it('records panel provenance on the claim and keeps the scorecard method labelled', async () => {
    const f = tracked(fixture({ labels: true }));
    const population = f.docs.length;
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
      packetCount: population,
      responseCount: population,
      failureCount: 0,
      timestamp: '2026-10-07T00:00:00.000Z',
    });
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const { result } = await judgeRun(f, 'skill-judge', svc, {
      panel: {
        raters: [
          lane('r1', 'xAI', 'xai', 'grok-4'),
          lane('r2', 'Google', 'google', 'gemini-2.5'),
        ],
        adjudicator: lane('r3', 'GLM', 'ollama-cloud', 'glm-4.5'),
        population,
        unresolvedCount: 0,
        unresolvedShare: 0,
      },
    });
    expect(result.groundTruth.method).toBe('labelled');
    expect(result.groundTruth.raterCount).toBe(2);
    expect(result.claim.text).toContain(
      'model-panel:xAI+Google; adjudicator=GLM',
    );
    expect(result.claim.text).toContain('raterCount=2');
  });

  it('is na (ground-truth-untrusted) today: no labels committed, controls still measured', async () => {
    const f = tracked(fixture({ labels: false }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const { result } = await judgeRun(f, 'skill-judge', svc);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(
      /^ground-truth-untrusted: skill-labels\.v1\.csv, skill-adjudication\.v1\.csv, skill-docs\.v1\.json not committed/,
    );
    const details = rubricDetailsSchema.parse(result.details);
    if (details.mode !== 'judge-vs-human') throw new Error('wrong mode');
    expect(details.spearman).toBeNull();
    expect(details.kappa).toBeNull();
    expect(details.positiveControl).toEqual({ n: 6, passRate: 1 });
    expect(details.negativeControl).toEqual({ n: 36, failRate: 1 });
    expect(result.groundTruth.raterCount).toBeUndefined();
  });

  it('fails when the judge passes the planted negatives', async () => {
    const f = tracked(fixture({ labels: true }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs, 9)),
      'record',
    );
    const { result } = await judgeRun(f, 'skill-judge', svc);
    expect(result.verdict).toBe('fail');
    // 2 fallback documents x 3 fail the gate; 10 planted x 3 pass it.
    expect(result.metrics['negativeControl.failRate.num']).toBe(6);
    expect(result.metrics['negativeControl.failRate.den']).toBe(36);
  });

  it('is na (model-not-pinned) when the lane reports another model', async () => {
    const f = tracked(fixture({ labels: true }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs, 2, 'other-model')),
      'record',
    );
    const { result } = await judgeRun(f, 'skill-judge', svc);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      `model-not-pinned: lane reported judge=other-model; the plan pins ${MODEL}`,
    );
  });

  it('is na (prompt-drift) when the rubric differs from the pinned sha256', async () => {
    const f = tracked(fixture({ labels: true }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const { result } = await judgeRun(f, 'skill-judge', svc, {
      promptSha256: '0'.repeat(64),
    });
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(
      /^prompt-drift: judge rubric sha256 [0-9a-f]{64}, pinned 0{64}$/,
    );
  });

  it('runs the real panel: an empty library makes the lens degenerate, so every verdict is one panellist and is persisted', async () => {
    const f = tracked(fixture({ labels: true }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const { result } = await judgeRun(f, 'judge-panel', svc);
    expect(result.verdict).toBe('pass');
    expect(result.metrics['panel.singlePanellist']).toBe(1);
    expect(result.metrics['panel.escalated']).toBe(0);
    const details = rubricDetailsSchema.parse(result.details);
    expect(details.mode === 'judge-vs-human' && details.judge).toBe(
      'judge-panel',
    );
    // One registered row per document, one persisted verdict per run.
    expect(svc.store.rows.size).toBe(26);
    expect(svc.store.verdicts).toHaveLength(26 * 3);
  });

  it('refuses a packet whose document differs from the id-map', () => {
    const f = tracked(fixture({ labels: true }));
    const [first] = f.docs;
    writeFileSync(
      join(f.home, 'judge-agreement', 'documents', `${first.opaqueId}.md`),
      'tampered',
      'utf8',
    );
    expect(() => corpusOf(f.home)).toThrow(JudgeCorpusError);
  });

  it('runs as a host suite from the isolated home and refuses a CI plan', async () => {
    const f = tracked(fixture({ labels: false }));
    const svc = services(
      recordingLane(f.root, syntheticLane(f.docs)),
      'record',
    );
    const [single] = createJudgeAgreementSuites({ resolveServices: () => svc });
    expect(single.placement).toBe('last');
    const context = (ci: boolean, runDir: string) =>
      ({
        runId: 'spec',
        runDir,
        options: { model: MODEL, repeats: 1 },
        workspaceRoot: f.root,
        isolation: { home: f.home },
        ci,
      }) as unknown as MemorySkillsHostSuiteContext;

    await expect(
      single.run(context(true, join(f.root, 'ci-run'))),
    ).rejects.toThrow(/local-only/);

    const runDir = join(f.root, 'host-run');
    await single.run(context(false, runDir));
    const { result, cases } = readSuiteResult(runDir, JUDGE_AGREEMENT_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/^ground-truth-untrusted: /);
    expect(cases).toHaveLength(26);
    expect(
      existsSync(join(runDir, 'raw', `${JUDGE_AGREEMENT_SUITE_ID}.jsonl`)),
    ).toBe(true);
  });
});
