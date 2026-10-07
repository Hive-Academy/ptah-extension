/**
 * Batch 23 spec for `skill.namer.collisions` and `skill.trigger-eval.human`.
 *
 * - The namer suite reads a SMALL SYNTHETIC candidate copy (and its freeze
 *   manifest) built in a temp folder; the private frozen copy is never opened.
 *   The suffix grammar comes from the REAL `SkillMdGenerator`.
 * - The trigger suite scores synthetic labels with the REAL
 *   `TriggerEvalService` over a deterministic keyword embedder. The parent
 *   container's lane runner (the model path) throws if it is ever called.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PERSISTENCE_TOKENS,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  SkillMdGenerator,
  f1,
  type SkillSynthesisSettings,
} from '@ptah-extension/skill-synthesis';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';

import {
  computeManifestSha256,
  sha256,
} from '../../data/verify-candidate-manifest';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import {
  evaluatePanelEligibility,
  modelPanelName,
  toCommittedTriggerLabel,
  type PanelLaneIdentity,
} from '../../labelling/model-panel';
import { funnelDetailsSchema } from '../../memory-skills-suite-kinds';
import { readSuiteResult } from '../../runner/suite-result';
import {
  NAMER_AND_TRIGGER_SUITES,
  NAMER_COLLISIONS_SUITE_ID,
  TRIGGER_EVAL_HUMAN_SUITE_ID,
  namerCollisionsSuite,
  triggerEvalHumanSuite,
} from './namer-and-trigger.suite';
import {
  NAMER_COLLISIONS_NA_REASON,
  NAMER_PROBE_SLUG,
  classifyCollisions,
  probeSlugGrammar,
  runNamerCollisions,
  type CandidateWriter,
} from './namer-collisions';
import {
  TRIGGER_EVAL_DISPLAY_LABEL,
  runTriggerEvalHuman,
  scoreWithProductService,
  type TriggerLabel,
} from './trigger-human-eval';

const SNAPSHOT = 'skill-candidates-synthetic';
/** Every synthetic "user" slug carries this marker, so a leak is detectable. */
const MARK = 'zqprivate';

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** Every rate metric's value is exactly its `num / den` (`null` for den 0). */
function expectExactRates(metrics: Record<string, number | null>): void {
  for (const key of Object.keys(metrics)) {
    if (!key.endsWith('.num')) continue;
    const name = key.slice(0, -'.num'.length);
    const num = metrics[`${name}.num`];
    const den = metrics[`${name}.den`];
    expect(num).not.toBeNull();
    expect(den).not.toBeNull();
    expect(metrics[name]).toBe(
      den === 0 ? null : (num as number) / (den as number),
    );
  }
}

function fakeContext(
  home: string,
  runDir: string,
  container: DependencyContainer,
  options: unknown,
  ci = false,
): MemorySkillsHostSuiteContext {
  return {
    runId: 'spec',
    runDir,
    options,
    workspaceRoot: home,
    isolation: { home } as never,
    container,
    doubles: {} as never,
    ci,
  };
}

// ====================================================== namer collisions

interface SyntheticDir {
  readonly name: string;
  /** SKILL.md body; `null` writes only a notes file. */
  readonly body: string | null;
}

const COPY: readonly SyntheticDir[] = [
  { name: `${MARK}-alpha`, body: 'Body A' },
  { name: `${MARK}-alpha-2`, body: 'Body A' }, // same work drafted twice
  { name: `${MARK}-alpha-3`, body: 'Body B' },
  { name: `${MARK}-beta`, body: 'Body C' },
  { name: `${MARK}-gamma-2`, body: 'Body D' }, // suffix-shaped, no base
  { name: `${MARK}-delta`, body: 'Delta 1' },
  { name: `${MARK}-delta-2`, body: 'Delta 2' },
  { name: `${MARK}-delta-3`, body: 'Delta 3' },
  { name: `${MARK}-delta-4`, body: 'Delta 4' },
  { name: `${MARK}-delta-5`, body: 'Delta 5' }, // a full group
  { name: `${MARK}-eps`, body: null }, // no SKILL.md
  { name: `${MARK}-eps-2`, body: 'Eps' },
];

/** Write the synthetic copy and its freeze manifest; returns the manifest sha. */
function writeSyntheticCopy(home: string): string {
  const snapshots = join(home, 'snapshots');
  const root = join(snapshots, SNAPSHOT);
  const files: Record<string, string> = {};
  for (const dir of COPY) {
    mkdirSync(join(root, dir.name), { recursive: true });
    const [file, text] =
      dir.body === null
        ? ['notes.txt', 'no skill file\n']
        : [
            'SKILL.md',
            `---\nname: ${dir.name}\ndescription: synthetic\n---\n\n${dir.body}\n`,
          ];
    writeFileSync(join(root, dir.name, file), text, 'utf8');
    files[`${dir.name}/${file}`] = sha256(text);
  }
  const manifestSha256 = computeManifestSha256(files);
  writeFileSync(
    join(snapshots, `${SNAPSHOT}.manifest.json`),
    JSON.stringify({
      source: 'synthetic',
      dirs: COPY.length,
      files: Object.keys(files).length,
      manifestSha256,
      files_sha256: files,
    }),
    'utf8',
  );
  return manifestSha256;
}

function realGenerator(logger: Logger): SkillMdGenerator {
  const child = rootContainer.createChildContainer();
  child.register(TOKENS.LOGGER, { useValue: logger });
  child.register(SkillMdGenerator, { useClass: SkillMdGenerator });
  return child.resolve(SkillMdGenerator);
}

describe('skill.namer.collisions', () => {
  let home: string;
  let runDir: string;
  let manifestSha256: string;
  let logger: Logger;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ptah-620-namer-'));
    runDir = join(home, 'run');
    manifestSha256 = writeSyntheticCopy(home);
    logger = silentLogger();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const options = (): unknown => ({
    snapshotName: SNAPSHOT,
    expectedManifestSha256: manifestSha256,
  });

  it('reads the suffix grammar off the real SkillMdGenerator and cleans its scratch folder', () => {
    const grammar = probeSlugGrammar(realGenerator(logger), home);
    expect(grammar).toEqual({
      suffixes: ['-2', '-3', '-4', '-5'],
      maxPerBase: 5,
      writes: 5,
    });
    expect(
      readdirSync(home).filter((n) => n.startsWith('namer-probe-')),
    ).toEqual([]);
  });

  it('counts collisions on the frozen copy with exact rates and reports na', () => {
    const { result, cases } = runNamerCollisions({
      home,
      options: options(),
      writer: realGenerator(logger),
    });
    expect(result.suiteId).toBe(NAMER_COLLISIONS_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(NAMER_COLLISIONS_NA_REASON);
    expect(result.modelCalls).toBe(0);
    expect(result.baselines).toEqual([]);
    expect(result.metrics).toMatchObject({
      dirs: 12,
      collided: 7,
      slugCollisionRate: 7 / 12,
      'slugCollisionRate.num': 7,
      'slugCollisionRate.den': 12,
      selfCollisionShare: 1 / 7,
      'selfCollisionShare.num': 1,
      'selfCollisionShare.den': 7,
      baseGroups: 5,
      groupsWithCollision: 3,
      largestGroup: 5,
      fullGroups: 1,
      groupsOverLimit: 0,
      suffixShapedNoBase: 1,
      collidedWithoutBody: 1,
      'probe.maxPerBase': 5,
      'probe.suffixes': 4,
    });
    expectExactRates(result.metrics);
    const details = funnelDetailsSchema.parse(result.details);
    expect(details.slugCollisionRate).toBe(7 / 12);
    expect(details.stages).toEqual([
      {
        stage: 'draft',
        in: 12,
        out: 5,
        invariants: [
          {
            id: 'group-size-within-retry-limit',
            pass: true,
            violations: 0,
            exampleIds: [],
          },
        ],
      },
    ]);
    expect(cases.map((c) => [c.caseId, c.outcome])).toEqual([
      ['frozen-copy/manifest', 'pass'],
      ['probe/slug-grammar', 'pass'],
      ['invariant/group-size-within-retry-limit', 'pass'],
    ]);
    // Counts only: no frozen name, body or path reaches the output or a log.
    const output = JSON.stringify({ result, cases });
    expect(output).not.toContain(MARK);
    expect(output).not.toContain('Body A');
    expect(output).not.toContain(home);
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(
      MARK,
    );
  });

  it('host suite writes a result the runner reads back', async () => {
    const container = rootContainer.createChildContainer();
    container.register(TOKENS.LOGGER, { useValue: logger });
    await namerCollisionsSuite.run(
      fakeContext(home, runDir, container, options()),
    );
    const { result, cases } = readSuiteResult(
      runDir,
      NAMER_COLLISIONS_SUITE_ID,
    );
    expect(result.verdict).toBe('na');
    expect(result.metrics['slugCollisionRate']).toBe(7 / 12);
    expect(cases).toHaveLength(3);
  });

  it('refuses a copy that differs from its freeze manifest, naming counts only', () => {
    writeFileSync(
      join(home, 'snapshots', SNAPSHOT, `${MARK}-beta`, 'SKILL.md'),
      'tampered',
      'utf8',
    );
    let message = '';
    try {
      runNamerCollisions({
        home,
        options: options(),
        writer: realGenerator(logger),
      });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('1 changed');
    expect(message).not.toContain(MARK);
  });

  it('refuses a manifest that is not the pinned frozen one', () => {
    expect(() =>
      runNamerCollisions({
        home,
        options: {
          snapshotName: SNAPSHOT,
          expectedManifestSha256: 'a'.repeat(64),
        },
        writer: realGenerator(logger),
      }),
    ).toThrow(/not the frozen one/);
  });

  it('fails the probe case when the generator never refuses, and rethrows a real write error', () => {
    let n = 0;
    const neverRefuses: CandidateWriter = {
      writeCandidate: () => {
        n += 1;
        const slug = n === 1 ? NAMER_PROBE_SLUG : `${NAMER_PROBE_SLUG}-${n}`;
        return { slug, dir: slug, filePath: slug };
      },
    };
    const { cases, result } = runNamerCollisions({
      home,
      options: options(),
      writer: neverRefuses,
    });
    expect(cases.find((c) => c.caseId === 'probe/slug-grammar')?.outcome).toBe(
      'fail',
    );
    expect(result.metrics['probe.maxPerBase']).toBeNull();

    const broken: CandidateWriter = {
      writeCandidate: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    expect(() => probeSlugGrammar(broken, home)).toThrow(/EACCES/);
  });

  it('flags groups larger than the probed limit', () => {
    const counts = classifyCollisions(
      ['x', 'x-2', 'x-3'],
      { suffixes: ['-2', '-3'], maxPerBase: 2, writes: 2 },
      () => null,
    );
    expect(counts).toMatchObject({
      collided: 2,
      baseGroups: 1,
      largestGroup: 3,
      groupsOverLimit: 1,
      fullGroups: 0,
      collidedWithoutBody: 2,
    });
  });

  it('counts a nested suffix (x-2 taken, so x-2-2) as its own group', () => {
    const counts = classifyCollisions(
      ['x', 'x-2', 'x-2-2'],
      { suffixes: ['-2'], maxPerBase: 2, writes: 2 },
      () => 'same',
    );
    expect(counts).toMatchObject({
      collided: 2,
      baseGroups: 2,
      groupsWithCollision: 2,
      largestGroup: 2,
      sameBodyAsBase: 2,
    });
  });
});

// ====================================================== trigger eval (human)

const KEYWORDS = ['git', 'sql', 'css'] as const;

/** Deterministic embedder: one dimension per keyword, plus one for "none". */
class KeywordEmbedder implements IEmbedder {
  readonly dim = KEYWORDS.length + 1;
  readonly modelId = 'spec-keyword';
  readonly embed = jest.fn(async (texts: readonly string[]) =>
    texts.map((text) => {
      const words = text.toLowerCase().split(/[^a-z]+/);
      const vector = new Float32Array(this.dim);
      KEYWORDS.forEach((keyword, i) => {
        vector[i] = words.filter((word) => word === keyword).length;
      });
      if (vector.every((value) => value === 0)) vector[KEYWORDS.length] = 1;
      return vector;
    }),
  );
  async dispose(): Promise<void> {
    return undefined;
  }
}

function triggerLane(
  family: string,
  raterId: string,
  provider: string,
  model: string,
): PanelLaneIdentity {
  return { family, raterId, provider, model };
}

/** Verified panel spelling. Callers pass this into `toCommittedTriggerLabel`. */
function verifiedTriggerPanel(): string {
  const eligibility = evaluatePanelEligibility({
    raters: [
      triggerLane('xAI', 'r-xai', 'xai', 'grok-4'),
      triggerLane('Google', 'r-google', 'google', 'gemini-2.5'),
    ],
    adjudicator: triggerLane('GLM', 'r-glm', 'ollama-cloud', 'glm-4.5'),
  });
  if (!eligibility.ok) throw new Error(eligibility.reason);
  return eligibility.panel;
}

function committedTrigger(
  label: TriggerLabel,
  panel: string | undefined,
): ReturnType<typeof toCommittedTriggerLabel> {
  return toCommittedTriggerLabel(
    {
      skillId: label.skillId,
      shouldTrigger: [...label.shouldTrigger],
      nearMiss: [...label.nearMiss],
      raterId: 'r-xai',
      ratedAt: '2026-10-07T00:00:00.000Z',
    },
    label.description,
    panel,
  );
}

const LABELS: readonly TriggerLabel[] = [
  {
    skillId: 'git-flow',
    description: 'Use git to branch and git commit.',
    shouldTrigger: ['git rebase help', 'undo git commit', 'css only please'],
    nearMiss: ['sql git mix', 'sql only'],
  },
  {
    skillId: 'sql-help',
    description: 'Write a sql query.',
    shouldTrigger: ['sql join'],
    nearMiss: ['css grid'],
  },
  {
    skillId: 'css-help',
    description: 'Fix css style.',
    shouldTrigger: ['css flexbox'],
    nearMiss: ['git stash'],
  },
];

const SELF_GENERATED = [
  { skillId: 'git-flow', shouldTrigger: ['git log'], nearMiss: ['sql git'] },
  { skillId: 'sql-help', shouldTrigger: ['sql index'], nearMiss: ['sql only'] },
];

const SETTINGS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  evictionDecayRate: 0.1,
  generalizationContextThreshold: 2,
  dedupClusterThreshold: 0.85,
  prefilterMinEdits: 1,
  prefilterMinToolUses: 1,
  judgeEnabled: true,
  minJudgeScore: 6,
  judgeModel: 'inherit',
  maxPinnedSkills: 5,
  curatorEnabled: false,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 3,
  suggestionMaxCandidates: 100,
};

const ENABLED_KEY = 'skillSynthesis.triggerEval.enabled';

interface TriggerFixture {
  readonly container: DependencyContainer;
  /** The parent's lane runner: the model path. It must never be called. */
  readonly modelLane: jest.Mock;
  readonly parentStore: jest.Mock;
  readonly embedder: KeywordEmbedder;
}

function triggerContainer(
  opts: { gateEnabled?: boolean; embedder?: boolean } = {},
): TriggerFixture {
  const container = rootContainer.createChildContainer();
  const modelLane = jest.fn(() => {
    throw new Error('a model was called');
  });
  const parentStore = jest.fn(() => {
    throw new Error('the product candidate store was used');
  });
  const embedder = new KeywordEmbedder();
  container.register(TOKENS.LOGGER, { useValue: silentLogger() });
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getConfiguration: <T>(_section: string, key: string, fallback: T): T =>
        key === ENABLED_KEY && opts.gateEnabled === false
          ? (false as T)
          : fallback,
    },
  });
  if (opts.embedder !== false) {
    container.register(PERSISTENCE_TOKENS.EMBEDDER, { useValue: embedder });
  }
  container.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useValue: { run: modelLane },
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, {
    useValue: {
      listByStatus: parentStore,
      recordTriggerEval: parentStore,
    },
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, {
    useValue: { readSettings: () => SETTINGS },
  });
  return { container, modelLane, parentStore, embedder };
}

function writeJsonl(path: string, lines: readonly unknown[]): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
    'utf8',
  );
}

describe('skill.trigger-eval.human', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ptah-620-trigger-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const env = (fixture: TriggerFixture) => ({
    container: fixture.container,
    readSettings: () => SETTINGS,
  });

  const writeLabels = (panel?: string): void =>
    writeJsonl(
      join(home, 'memory-skills', 'skill-triggers.v1.jsonl'),
      LABELS.map((label) => committedTrigger(label, panel)),
    );

  it('is na: ground-truth-absent while U4 has not labelled, and touches no service', async () => {
    const fixture = triggerContainer();
    const { result, cases } = await runTriggerEvalHuman({
      home,
      options: {},
      env: env(fixture),
    });
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(
      /^ground-truth-absent: gt-skill-triggers@v1/,
    );
    expect(cases).toEqual([]);
    expect(result.modelCalls).toBe(0);
    expect(result.metrics).toMatchObject({
      precision: null,
      'precision.num': 0,
      'precision.den': 0,
      skills: 0,
      expectedSkills: 23,
    });
    expectExactRates(result.metrics);
    expect(funnelDetailsSchema.parse(result.details).precision).toBeNull();
    expect(fixture.modelLane).not.toHaveBeenCalled();
    expect(fixture.embedder.embed).not.toHaveBeenCalled();
    expect(result.displayLabel).toBe('skill.trigger-eval.panel');
    expect(result.groundTruth.method).toBe('labelled');
    expect(result.groundTruth).not.toHaveProperty('panel');
  });

  it('scores the labels through the real TriggerEvalService without calling a model', async () => {
    writeLabels();
    const fixture = triggerContainer();
    const { result, cases } = await runTriggerEvalHuman({
      home,
      options: { expectedSkills: 3 },
      env: env(fixture),
    });

    // The model path and the product store were never reached.
    expect(fixture.modelLane).not.toHaveBeenCalled();
    expect(fixture.parentStore).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(0);
    // The scoring path ran: one embed call per skill.
    expect(fixture.embedder.embed).toHaveBeenCalledTimes(3);

    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      'report-only: benchmark-design.md:100 sets no threshold',
    );
    expect(result.metrics).toMatchObject({
      precision: 4 / 5,
      'precision.num': 4,
      'precision.den': 5,
      recall: 4 / 5,
      'recall.num': 4,
      'recall.den': 5,
      skills: 3,
      'skills.evaluated': 3,
      'skills.perfect': 2,
      promptsLabelled: 9,
      promptsScored: 9,
    });
    expectExactRates(result.metrics);
    expect(cases.map((c) => [c.caseId, c.outcome])).toEqual([
      ['skill/git-flow', 'fail'],
      ['skill/sql-help', 'pass'],
      ['skill/css-help', 'pass'],
    ]);
    expect(cases[0].observed).toBe(
      `tp 2/3 should-trigger, fp 1/2 near-miss, precision ${2 / 3}, recall ${2 / 3}`,
    );
    expect(result.cost.calls).toBe(3);
    const details = funnelDetailsSchema.parse(result.details);
    expect(details).toMatchObject({
      precision: 4 / 5,
      recall: 4 / 5,
      stages: [],
    });
    expect(result.suiteId).toBe('skill.trigger-eval.human');
    expect(result.displayLabel).toBe(TRIGGER_EVAL_DISPLAY_LABEL);
    expect(TRIGGER_EVAL_DISPLAY_LABEL).toBe('skill.trigger-eval.panel');
    expect(result.groundTruth).toEqual({
      id: 'gt-skill-triggers',
      version: 'v1',
      method: 'labelled',
      raterCount: 2,
    });
    expect(result.groundTruth).not.toHaveProperty('panel');
    expect(result.claim.text).toContain('skill.trigger-eval.panel');
    expect(result.claim.text).toContain(
      'model-panel labels; id kept for compatibility',
    );
    expect(result.claim.text).not.toContain('adjudicator=');
    expect(result.claim.text).not.toMatch(/\bhuman\b/i);
  });

  it('records method model-panel when the U4 import wrote one verified panel', async () => {
    const panel = verifiedTriggerPanel();
    expect(panel).toBe(modelPanelName('xAI', 'Google', 'GLM'));
    writeLabels(panel);
    const fixture = triggerContainer();
    const { result } = await runTriggerEvalHuman({
      home,
      options: { expectedSkills: 3 },
      env: env(fixture),
    });
    expect(result.suiteId).toBe('skill.trigger-eval.human');
    expect(result.displayLabel).toBe('skill.trigger-eval.panel');
    expect(result.groundTruth).toEqual({
      id: 'gt-skill-triggers',
      version: 'v1',
      method: 'model-panel',
      panel,
      raterCount: 2,
    });
    expect(result.claim.text).toContain(panel);
    expect(result.claim.text).not.toContain('model-panel:');
  });

  it('stays labelled when the U4 import wrote no panel', async () => {
    writeLabels(undefined);
    const fixture = triggerContainer();
    const { result } = await runTriggerEvalHuman({
      home,
      options: { expectedSkills: 3 },
      env: env(fixture),
    });
    expect(result.groundTruth).toEqual({
      id: 'gt-skill-triggers',
      version: 'v1',
      method: 'labelled',
      raterCount: 2,
    });
    expect(result.groundTruth).not.toHaveProperty('panel');
  });

  it('refuses a label file that mixes panelled and unpanelled rows', async () => {
    const panel = verifiedTriggerPanel();
    writeJsonl(join(home, 'memory-skills', 'skill-triggers.v1.jsonl'), [
      committedTrigger(LABELS[0], panel),
      committedTrigger(LABELS[1], undefined),
    ]);
    const fixture = triggerContainer();
    await expect(
      runTriggerEvalHuman({
        home,
        options: { expectedSkills: 2 },
        env: env(fixture),
      }),
    ).rejects.toThrow(/mix a panel/);
  });

  it('refuses a label file whose committed rows name different panels', async () => {
    const xaiFirst = verifiedTriggerPanel();
    const googleFirst = evaluatePanelEligibility({
      raters: [
        triggerLane('Google', 'r-google', 'google', 'gemini-2.5'),
        triggerLane('xAI', 'r-xai', 'xai', 'grok-4'),
      ],
      adjudicator: triggerLane('GLM', 'r-glm', 'ollama-cloud', 'glm-4.5'),
    });
    if (!googleFirst.ok) throw new Error(googleFirst.reason);
    writeJsonl(join(home, 'memory-skills', 'skill-triggers.v1.jsonl'), [
      committedTrigger(LABELS[0], xaiFirst),
      committedTrigger(LABELS[1], googleFirst.panel),
    ]);
    const fixture = triggerContainer();
    await expect(
      runTriggerEvalHuman({
        home,
        options: { expectedSkills: 2 },
        env: env(fixture),
      }),
    ).rejects.toThrow(/more than one panel/);
  });

  it('records exactly the product measurement for each skill', async () => {
    const fixture = triggerContainer();
    const run = await scoreWithProductService(
      env(fixture),
      LABELS,
      new Map(LABELS.map((label) => [label.skillId, label])),
    );
    expect(run.laneCalls).toBe(3);
    expect(run.recorded.get('git-flow')).toEqual({
      precision: 2 / 3,
      recall: 2 / 3,
      score: f1(2 / 3, 2 / 3),
    });
    expect(run.recorded.get('sql-help')).toEqual({
      precision: 1,
      recall: 1,
      score: 1,
    });
  });

  it('scores the recorded self-generated sets as the baseline', async () => {
    writeLabels();
    writeJsonl(
      join(home, 'memory-skills', 'self-generated.jsonl'),
      SELF_GENERATED,
    );
    const fixture = triggerContainer();
    const { result, cases } = await runTriggerEvalHuman({
      home,
      options: {
        expectedSkills: 3,
        selfGeneratedFile: 'memory-skills/self-generated.jsonl',
      },
      env: env(fixture),
    });
    expect(fixture.modelLane).not.toHaveBeenCalled();
    const [baseline] = result.baselines;
    expect(baseline.id).toBe('self-generated');
    expect(baseline.label).toContain('2 of 3 labelled skills');
    expect(baseline.metrics).toMatchObject({
      precision: 2 / 4,
      'precision.num': 2,
      'precision.den': 4,
      recall: 1,
      'recall.num': 2,
      'recall.den': 2,
    });
    expectExactRates(baseline.metrics);
    expect(result.deltas['self-generated']['precision']).toBeCloseTo(
      0.8 - 0.5,
      12,
    );
    expect(result.deltas['self-generated']['recall']).toBeCloseTo(0.8 - 1, 12);
    expect(cases.map((c) => c.baselineOutcomes)).toEqual([
      { 'self-generated': 'fail' },
      { 'self-generated': 'fail' },
      undefined,
    ]);
    expect(result.cost.calls).toBe(5);
  });

  it('is na: ground-truth-incomplete with fewer labelled skills than the design expects', async () => {
    writeLabels();
    const { result } = await runTriggerEvalHuman({
      home,
      options: {},
      env: env(triggerContainer()),
    });
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(
      'ground-truth-incomplete: 3 of 23 skills labelled',
    );
    expect(result.metrics['precision']).toBe(4 / 5);
  });

  it('is na with the product skip reason when the gate is off or no embedder exists', async () => {
    writeLabels();
    const off = await runTriggerEvalHuman({
      home,
      options: { expectedSkills: 3 },
      env: env(triggerContainer({ gateEnabled: false })),
    });
    expect(off.result.naReason).toMatch(/^trigger-eval-disabled:/);
    expect(off.result.metrics['precision']).toBeNull();

    const noEmbedder = await runTriggerEvalHuman({
      home,
      options: { expectedSkills: 3 },
      env: env(triggerContainer({ embedder: false })),
    });
    expect(noEmbedder.result.naReason).toMatch(/^trigger-eval-no-embedder:/);
  });

  it('refuses a label file that labels one skill twice', async () => {
    writeJsonl(join(home, 'memory-skills', 'skill-triggers.v1.jsonl'), [
      LABELS[0],
      LABELS[0],
    ]);
    await expect(
      runTriggerEvalHuman({ home, options: {}, env: env(triggerContainer()) }),
    ).rejects.toThrow(/labels skill git-flow twice/);
  });

  it('host suite resolves the product settings reader and writes its result', async () => {
    writeLabels();
    const fixture = triggerContainer();
    const runDir = join(home, 'run');
    await triggerEvalHumanSuite.run(
      fakeContext(home, runDir, fixture.container, { expectedSkills: 3 }),
    );
    const { result, cases } = readSuiteResult(
      runDir,
      TRIGGER_EVAL_HUMAN_SUITE_ID,
    );
    expect(result.metrics['recall']).toBe(4 / 5);
    expect(cases).toHaveLength(3);
    expect(fixture.modelLane).not.toHaveBeenCalled();
  });
});

describe('NAMER_AND_TRIGGER_SUITES', () => {
  it('refuses a CI run before reading any fixture or resolving a service', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ptah-620-ci-'));
    try {
      const container = rootContainer.createChildContainer();
      const resolve = jest.spyOn(container, 'resolve');
      const createChild = jest.spyOn(container, 'createChildContainer');
      for (const suite of NAMER_AND_TRIGGER_SUITES) {
        const runDir = join(home, `ci-${suite.id}`);
        const refusal =
          suite.id === TRIGGER_EVAL_HUMAN_SUITE_ID
            ? `${TRIGGER_EVAL_HUMAN_SUITE_ID} is local-only: it scores model-panel labels with the real embedder (display ${TRIGGER_EVAL_DISPLAY_LABEL}; model-panel labels; id kept for compatibility); it never runs in CI`
            : new RegExp(
                `^${suite.id.replaceAll('.', '\\.')} is local-only: .*; it never runs in CI$`,
              );
        await expect(
          suite.run(fakeContext(home, runDir, container, {}, true)),
        ).rejects.toThrow(refusal);
        if (typeof refusal === 'string') {
          expect(refusal).not.toContain('human labels');
        }
        expect(() => readSuiteResult(runDir, suite.id)).toThrow(/wrote no/);
      }
      expect(resolve).not.toHaveBeenCalled();
      expect(createChild).not.toHaveBeenCalled();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('registers both host suites with no placement constraint', () => {
    expect(
      NAMER_AND_TRIGGER_SUITES.map((suite) => [suite.id, suite.placement]),
    ).toEqual([
      [NAMER_COLLISIONS_SUITE_ID, undefined],
      [TRIGGER_EVAL_HUMAN_SUITE_ID, undefined],
    ]);
  });
});
