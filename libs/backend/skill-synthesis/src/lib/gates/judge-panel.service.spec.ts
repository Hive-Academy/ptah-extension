/**
 * P3-2 — the two-judge panel, its escalation, and the constraint that it is NOT
 * a tribunal.
 *
 * ## Why this runs the REAL judge, the REAL runner and a REAL database
 *
 * Every assertion here is about a COST or a PERSISTED FACT:
 *
 *  - "exactly two calls" / "a third call" is only meaningful if the calls are
 *    counted where they are actually paid for — at `IInternalQuery.execute`.
 *    A mocked `SkillJudgeService` would count invocations of a jest.fn and would
 *    pass just as happily against a panel that made four lane calls per judge.
 *  - "all three rationales land in `judge_panel_rationales`" is a claim about a
 *    column. A mocked store proves the service called the method it was written
 *    to call, and nothing about what SQLite ended up holding.
 *
 * `better-sqlite3` is rebuilt against Electron's ABI by postinstall and cannot
 * load under Jest, so `resolveOpener` falls back to Node's built-in
 * `node:sqlite`. Reused rather than re-copied because the house native-gate
 * pattern makes specs SKIP SILENTLY — green while asserting nothing.
 *
 * ## The lane stub answers with `structured_output` on purpose
 *
 * The judge and synthesis lanes both default to `structuredOutput: 'sdk'`, and
 * `LaneRunner`'s ladder re-runs ONCE without `outputFormat` when a lane that
 * declared `'sdk'` resolves no JSON at all. A stub that answered in prose would
 * therefore make one judge cost two `execute` calls and would break every count
 * in this file — while looking like an escalation.
 *
 * There is deliberately not a single provider id anywhere in this file. Lanes
 * differ by declared capability; the models below are named after the LANE they
 * belong to, which is how the escalation's lane is identified.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS, type IEmbedder } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  resolvedLane,
  resultMessage,
  type ExecuteCall,
  type StreamMessage,
} from '../lanes/lane-runner.test-support';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import type { LaneResolverService } from '../lanes/lane-resolver.service';
import type { SkillLaneId, SkillLaneResolution } from '../lanes/lane.types';
import { SkillCandidateStore } from '../skill-candidate.store';
import {
  SkillJudgeService,
  JUDGE_CRITERION_KEYS,
  JUDGE_REASONS,
} from '../skill-judge.service';
import type {
  CandidateId,
  JudgePanelRationale,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from '../types';
import {
  JudgePanelService,
  JUDGE_PANEL_ENABLED_KEY,
  JUDGE_PANEL_REASONS,
  JUDGE_PANEL_THRESHOLD_KEY,
  maxCriterionDelta,
} from './judge-panel.service';
import {
  JUDGE_LENS_MAX_NEIGHBOURS,
  JUDGE_LENS_MIN_SIMILARITY,
  selectLensNeighbours,
} from './judge-lens';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const SQL_0033 = MIGRATIONS.find((m) => m.version === 33)?.sql ?? '';
const SQL_0036 = MIGRATIONS.find((m) => m.version === 36)?.sql ?? '';

// ── The tribunal ban, asserted mechanically ─────────────────────────────────

/** `src/`, from `src/lib/gates/`. */
const SRC_ROOT = path.resolve(__dirname, '..', '..');

/** Every production `.ts` under `src/`, spec + test-support excluded. */
function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionSources(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    if (entry.name.endsWith('.test-support.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * Global invariant 9. "Panel" is two internal-query calls on one lane; it is not
 * the multi-vendor tribunal, and this library imports nothing from it.
 *
 * The pattern matches an IMPORT of a tribunal module, not the word — this file's
 * own prose says "tribunal" repeatedly, and a bare word match would either flag
 * the documentation that explains the rule or force the rule to go undocumented.
 */
const TRIBUNAL_IMPORT =
  /(?:from|import|require)\s*\(?\s*['"][^'"]*tribunal[^'"]*['"]/i;

describe('the panel is two internal-query calls, never the tribunal (invariant 9)', () => {
  it('no production file in this library imports a tribunal module', () => {
    const offenders = productionSources()
      .filter((file) => TRIBUNAL_IMPORT.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('the scan can actually fail — it flags a synthetic tribunal import', () => {
    // A scan that cannot go red is decoration. This proves the regex reacts to
    // every import spelling the lib could plausibly grow, without waiting for
    // someone to write one.
    const spellings = [
      `import { Council } from '@ptah-extension/tribunal';`,
      `import type { Panel } from '@ptah-extension/tribunal-types';`,
      `export { forge } from '../../tribunal/forge';`,
      `const t = require('@ptah-extension/tribunal');`,
      `const t = await import('@ptah-extension/tribunal');`,
    ];
    for (const line of spellings) {
      expect(TRIBUNAL_IMPORT.test(line)).toBe(true);
    }
    // …and does not fire on the prose that documents the ban.
    expect(
      TRIBUNAL_IMPORT.test('// NOT the tribunal — see global invariant 9.'),
    ).toBe(false);
  });
});

// ── The real database ───────────────────────────────────────────────────────

/**
 * `openQueueDb` applies `0032` + `0035` — the QUEUE and BUDGET tables — and
 * never creates `skill_candidates`, which predates `0032`. So the base table is
 * built here and `0033` + `0036` are applied FROM `MIGRATIONS`, exactly as
 * `skill-candidate.store.spec.ts` and `cluster-holdout-end-to-end.spec.ts` do.
 * `judge_panel_rationales` is a `0033` column, so a rename there fails this spec
 * rather than silently disagreeing with it.
 */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec(`
    CREATE TABLE skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      body_path TEXT NOT NULL,
      source_session_ids TEXT NOT NULL DEFAULT '[]',
      trajectory_hash TEXT NOT NULL UNIQUE,
      embedding_rowid INTEGER,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')) DEFAULT 'candidate',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      promoted_at INTEGER,
      rejected_at INTEGER,
      rejected_reason TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      residency TEXT NOT NULL DEFAULT 'resident' CHECK(residency IN ('resident','dormant'))
    );
  `);
  db.exec(SQL_0033);
  db.exec(SQL_0036);
  return db;
}

function makeCandidateStore(db: TestDatabase): SkillCandidateStore {
  return new SkillCandidateStore(
    makeLogger() as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    { available: false } as never,
  );
}

// ── Collaborators ───────────────────────────────────────────────────────────

function settings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: false,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    ...overrides,
  };
}

/**
 * A resolver that answers PER LANE, with the lane id encoded in the model.
 *
 * That encoding is how "the third call ran on the `synthesis` lane" is asserted
 * at the only place it is observable — the config `execute` was handed. It is a
 * LANE id, not a provider id: which endpoint sits behind a lane is not this
 * file's business and never appears in it.
 */
function makeLaneResolver(maxInputChars?: number): LaneResolverService {
  return {
    resolve: jest.fn(
      async (id: SkillLaneId): Promise<SkillLaneResolution> => ({
        ok: true,
        lane: resolvedLane(id, {
          model: `${id}-lane-model`,
          config: maxInputChars === undefined ? {} : { maxInputChars },
        }),
      }),
    ),
  } as unknown as LaneResolverService;
}

/** A workspace whose settings come from one plain map. */
function makeWorkspace(
  values: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback: T): T =>
        key in values ? (values[key] as T) : fallback,
    ),
  } as unknown as IWorkspaceProvider;
}

type Scorecard = {
  novelty: number;
  actionability: number;
  scope: number;
  generalization: number;
  triggerClarity: number;
};

/** A flat scorecard, all five criteria at the same value unless overridden. */
function card(base: number, overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    novelty: base,
    actionability: base,
    scope: base,
    generalization: base,
    triggerClarity: base,
    ...overrides,
  };
}

/** One lane answer that honours the schema — exactly one `execute` call. */
function scoredReply(scorecard: Scorecard): StreamMessage[] {
  return [resultMessage({ structured_output: scorecard })];
}

/**
 * A lane answer the judge cannot read. `structured_output` is PRESENT (so the
 * runner resolves it and never fires its second rung) but is not a scorecard, so
 * the judge reports `unscored` after ONE call. That distinction is what makes an
 * R8 call count assertable at all.
 */
function unreadableReply(): StreamMessage[] {
  return [resultMessage({ structured_output: 'not-a-scorecard' })];
}

// ── The second panellist's lens (B3.4b) ─────────────────────────────────────
//
// The panel embeds DESCRIPTIONS — the target's and every active rival's — and
// ranks them locally, so a two-dimensional embedder is a complete stand-in for
// the real one: what is under test is the ranking, the floor and the rendering,
// none of which cares how many dimensions arrived.

const TARGET_DESCRIPTION =
  'Use when a new migration needs its ratchets bumped.';

/** Cosine 1.0 against the target — a description already on this ground. */
const NEAR_VECTOR = [1, 0];

/** Cosine 0.0 against the target — below the floor, so not a neighbour. */
const FAR_VECTOR = [0, 1];

/** The default rival: an active skill whose description says the same thing. */
const DEFAULT_RIVAL: LensRival = {
  name: 'bump-the-schema-ratchet',
  description: 'Use when a migration lands and the ratchets need bumping.',
};

interface LensRival {
  readonly name: string;
  readonly description: string;
  /** Defaults to {@link NEAR_VECTOR}. */
  readonly vector?: number[];
}

interface LensMeasurements {
  readonly triggerScore?: number;
  readonly triggerPrecision?: number;
  readonly triggerRecall?: number;
  readonly replayConfidence?: number;
}

function makeEmbedder(vectors: Map<string, number[]>): {
  embedder: IEmbedder;
  embed: jest.Mock;
} {
  const embed = jest.fn(async (texts: readonly string[]) =>
    texts.map((text) => Float32Array.from(vectors.get(text) ?? FAR_VECTOR)),
  );
  return {
    embed,
    embedder: {
      dim: 2,
      modelId: 'spec-embedder',
      embed,
      dispose: jest.fn(async () => undefined),
    } as unknown as IEmbedder,
  };
}

/** An embedder that rejects — the panel must lose neighbours, not the judge. */
function makeThrowingEmbedder(): IEmbedder {
  return {
    dim: 2,
    modelId: 'spec-embedder-broken',
    embed: jest.fn(async () => {
      throw new Error('the model never loaded');
    }),
    dispose: jest.fn(async () => undefined),
  } as unknown as IEmbedder;
}

interface Harness {
  readonly panel: JudgePanelService;
  readonly store: SkillCandidateStore;
  readonly candidate: SkillCandidateRow;
  readonly calls: ExecuteCall[];
  readonly db: TestDatabase;
  readonly embed: jest.Mock;
}

function makeHarness(opts: {
  scripts: StreamMessage[][];
  workspace?: Record<string, unknown>;
  /**
   * The active library the second panellist is shown. Defaults to ONE rival on
   * the same ground, because that is the ordinary case — a library that already
   * holds something adjacent — and because a panel with an empty lens
   * deliberately does not convene a second panellist at all.
   */
  rivals?: readonly LensRival[];
  /** Gate results already recorded on the candidate's row. */
  measured?: LensMeasurements;
  /** `'none'` models a host with no embedder registered. */
  embedder?: 'none' | 'throws';
  /** Clip every lane's prompt, to prove where the lens rides. */
  maxInputChars?: number;
}): Harness {
  const db = createDb();
  const store = makeCandidateStore(db);
  const { candidate } = store.registerCandidate({
    name: 'bump-the-migration-ratchet',
    description: TARGET_DESCRIPTION,
    bodyPath: '',
    sourceSessionIds: ['s1'],
    trajectoryHash: 'traj-1',
    embedding: null,
    createdAt: 1_000,
  });

  const rivals = opts.rivals ?? [DEFAULT_RIVAL];
  const vectors = new Map<string, number[]>([
    [TARGET_DESCRIPTION, NEAR_VECTOR],
  ]);
  rivals.forEach((rival, index) => {
    vectors.set(rival.description, rival.vector ?? NEAR_VECTOR);
    const registered = store.registerCandidate({
      name: rival.name,
      description: rival.description,
      bodyPath: '',
      sourceSessionIds: [],
      trajectoryHash: `traj-rival-${index}`,
      embedding: null,
      createdAt: 1_000,
    });
    store.updateStatus(registered.candidate.id, 'promoted');
  });

  const measured = opts.measured;
  if (measured) {
    if (
      measured.triggerScore !== undefined ||
      measured.triggerPrecision !== undefined ||
      measured.triggerRecall !== undefined
    ) {
      store.recordTriggerEval(candidate.id, {
        score: measured.triggerScore ?? null,
        precision: measured.triggerPrecision ?? null,
        recall: measured.triggerRecall ?? null,
        evaluatedAt: 2_000,
      });
    }
    if (measured.replayConfidence !== undefined) {
      store.recordReplay(candidate.id, {
        confidence: measured.replayConfidence,
        holdoutSessionId: 'holdout-session',
        replayAt: 2_000,
      });
    }
  }

  const embedder = makeEmbedder(vectors);
  const query = makeQueryStub(opts.scripts);
  const runner = new LaneRunnerService(
    makeLogger(),
    makeLaneResolver(opts.maxInputChars),
    makeBudgetStub().store,
    query.query,
    null,
  );
  const judge = new SkillJudgeService(makeLogger(), runner);
  const panel = new JudgePanelService(
    makeLogger(),
    makeWorkspace(opts.workspace),
    judge,
    runner,
    store,
    opts.embedder === 'none'
      ? null
      : opts.embedder === 'throws'
        ? makeThrowingEmbedder()
        : embedder.embedder,
  );
  return {
    panel,
    store,
    candidate,
    calls: query.calls,
    db,
    embed: embedder.embed,
  };
}

function storedRationales(
  store: SkillCandidateStore,
  id: CandidateId,
): JudgePanelRationale[] {
  const raw = store.findById(id)?.judgePanelRationales ?? null;
  return raw === null ? [] : (JSON.parse(raw) as JudgePanelRationale[]);
}

const BODY = '1. Read the migration registry.\n2. Bump every ratchet.';

// ── P3-2 ────────────────────────────────────────────────────────────────────

describe('JudgePanelService — P3-2', () => {
  maybe('escalates a per-criterion delta above the threshold', async () => {
    // The batch's own numbers: judge A novelty 9, judge B novelty 4, delta 5 > 3.
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 4 })),
        scoredReply(card(6)),
      ],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    // THREE calls, and the third is the escalation.
    expect(h.calls).toHaveLength(3);
    expect(result.escalated).toBe(true);
    expect(result.maxDelta).toBe(5);
    expect(result.reason).toBe(JUDGE_PANEL_REASONS.escalated);

    // The first two ran on the JUDGE lane, the third on SYNTHESIS.
    expect(h.calls.map((c) => c.model)).toEqual([
      'judge-lane-model',
      'judge-lane-model',
      'synthesis-lane-model',
    ]);

    // The escalation was shown BOTH rationales — not a summary of them.
    const escalationPrompt = h.calls[2].prompt;
    expect(escalationPrompt).toContain('panellist-a');
    expect(escalationPrompt).toContain('panellist-b');
    expect(escalationPrompt).toContain('novelty=9');
    expect(escalationPrompt).toContain('novelty=4');

    // …and the verdict is the ESCALATION's, not the midpoint of the two.
    expect(result.verdict.status).toBe('scored');
    expect(result.verdict.score).toBe(6);
  });

  maybe('lands all three rationales in judge_panel_rationales', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 4 })),
        scoredReply(card(6)),
      ],
    });

    await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    const stored = storedRationales(h.store, h.candidate.id);
    expect(stored.map((entry) => entry.role)).toEqual([
      'panellist-a',
      'panellist-b',
      'escalation',
    ]);
    expect(stored[0].criteria?.novelty).toBe(9);
    expect(stored[1].criteria?.novelty).toBe(4);
    expect(stored[2].score).toBe(6);
    // The stored summary is what the escalation actually read.
    expect(h.calls[2].prompt).toContain(stored[0].summary);
    expect(h.calls[2].prompt).toContain(stored[1].summary);
  });

  maybe('control: a delta of 2 costs exactly two calls', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 7 })),
      ],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(2);
    expect(result.escalated).toBe(false);
    expect(result.maxDelta).toBe(2);
    expect(result.reason).toBe(JUDGE_PANEL_REASONS.agreed);
    // The agreed verdict is the per-criterion mean: novelty (9+7)/2 = 8.
    expect(result.verdict.criteria?.novelty).toBe(8);
    expect(result.verdict.score).toBe((8 + 7 + 7 + 7 + 7) / 5);
    expect(storedRationales(h.store, h.candidate.id)).toHaveLength(2);
  });

  // ── The threshold is STRICTLY greater ────────────────────────────────────
  //
  // Off by one here is not cosmetic: `>=` buys a third model call on every
  // candidate whose panellists differ by exactly the configured gap, and `>`
  // moved one point the other way buys none, ever.

  maybe('a delta of exactly 3 does NOT escalate', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 6 })),
      ],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(result.maxDelta).toBe(3);
    expect(result.escalated).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  maybe('a delta of 4 does escalate', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 5 })),
        scoredReply(card(6)),
      ],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(result.maxDelta).toBe(4);
    expect(result.escalated).toBe(true);
    expect(h.calls).toHaveLength(3);
  });

  maybe('the threshold is read from settings, not hardcoded', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 6 })),
        scoredReply(card(6)),
      ],
      workspace: { [JUDGE_PANEL_THRESHOLD_KEY]: 2 },
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    // The same delta of 3 that did not escalate at the default now does.
    expect(result.maxDelta).toBe(3);
    expect(result.escalated).toBe(true);
    expect(h.calls).toHaveLength(3);
  });

  maybe('compares PER CRITERION, not on the composite', async () => {
    // Composites are identical (7.0 each) while novelty differs by 6. A
    // headline-only comparison would call this agreement.
    const a = card(7, { novelty: 10, actionability: 4 });
    const b = card(7, { novelty: 4, actionability: 10 });
    expect(maxCriterionDelta(a, b)).toBe(6);

    const h = makeHarness({
      scripts: [scoredReply(a), scoredReply(b), scoredReply(card(5))],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(result.escalated).toBe(true);
    expect(h.calls).toHaveLength(3);
  });

  // ── R8 ───────────────────────────────────────────────────────────────────

  maybe('R8 — an unscored first verdict buys no second judge', async () => {
    const h = makeHarness({
      // A second script is present precisely so that a panel which ran the
      // second judge anyway would SUCCEED at it, and the count is what fails.
      scripts: [unreadableReply(), scoredReply(card(9))],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(1);
    expect(result.panellists).toBe(1);
    expect(result.escalated).toBe(false);
    expect(result.verdict.status).toBe('unscored');
    expect(result.verdict.score).toBeNull();
    expect(result.reason).toBe(JUDGE_REASONS.noJson);
  });

  maybe(
    'R8 — the unscored verdict is persisted, and it carries no score',
    async () => {
      const h = makeHarness({ scripts: [unreadableReply()] });

      await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      const row = h.store.findById(h.candidate.id);
      expect(row?.judgeStatus).toBe('unscored');
      expect(row?.judgeScore).toBeNull();
      expect(row?.judgeScore).not.toBe(10);

      const stored = storedRationales(h.store, h.candidate.id);
      expect(stored).toHaveLength(1);
      expect(stored[0].role).toBe('panellist-a');
      expect(stored[0].score).toBeNull();
    },
  );

  maybe('R8 — a disabled judge gate spends nothing at all', async () => {
    const h = makeHarness({ scripts: [scoredReply(card(9))] });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings({ judgeEnabled: false }),
    });

    expect(h.calls).toHaveLength(0);
    expect(result.verdict.status).toBe('disabled');
    // Nothing deliberated, so nothing is recorded — a one-entry panel saying
    // "there is no gate here" would be noise in a column the UI renders.
    expect(result.persisted).toBe(false);
    expect(h.store.findById(h.candidate.id)?.judgePanelRationales).toBeNull();
  });

  // ── The panel switch ─────────────────────────────────────────────────────

  maybe('a disabled panel runs one judge and stops', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(9)), scoredReply(card(2))],
      workspace: { [JUDGE_PANEL_ENABLED_KEY]: false },
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(1);
    expect(result.panellists).toBe(1);
    expect(result.reason).toBe(JUDGE_PANEL_REASONS.disabled);
    expect(result.verdict.score).toBe(9);
    expect(h.store.findById(h.candidate.id)?.judgeScore).toBe(9);
  });

  // ── Degraded panels ──────────────────────────────────────────────────────

  maybe(
    'an escalation that cannot score yields `unscored`, never the midpoint',
    async () => {
      const h = makeHarness({
        scripts: [
          scoredReply(card(9)),
          scoredReply(card(4)),
          unreadableReply(),
        ],
      });

      const result = await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      expect(h.calls).toHaveLength(3);
      expect(result.escalated).toBe(true);
      expect(result.reason).toBe(JUDGE_PANEL_REASONS.escalationUnscored);
      // The midpoint would have been 6.5 — a number no judge awarded, on a pair
      // whose disagreement is the reason the escalation was paid for.
      expect(result.verdict.status).toBe('unscored');
      expect(result.verdict.score).toBeNull();
      expect(result.verdict.score).not.toBe(6.5);
      expect(h.store.findById(h.candidate.id)?.judgeScore).toBeNull();
      expect(storedRationales(h.store, h.candidate.id)).toHaveLength(3);
    },
  );

  maybe(
    'a second panellist that cannot score leaves the first verdict standing',
    async () => {
      const h = makeHarness({
        scripts: [scoredReply(card(8)), unreadableReply()],
      });

      const result = await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      expect(h.calls).toHaveLength(2);
      expect(result.escalated).toBe(false);
      expect(result.maxDelta).toBeNull();
      expect(result.verdict.status).toBe('scored');
      expect(result.verdict.score).toBe(8);

      const stored = storedRationales(h.store, h.candidate.id);
      expect(stored).toHaveLength(2);
      expect(stored[1].status).toBe('unscored');
      expect(stored[1].summary).toContain('no score');
    },
  );

  // ── The store is the enforcing edge ──────────────────────────────────────

  maybe('recordJudgePanel rejects a non-scored entry carrying a number', () => {
    const db = createDb();
    const store = makeCandidateStore(db);
    const { candidate } = store.registerCandidate({
      name: 'x',
      description: 'y',
      bodyPath: '',
      sourceSessionIds: [],
      trajectoryHash: 'traj-guard',
      embedding: null,
      createdAt: 1,
    });

    expect(() =>
      store.recordJudgePanel(candidate.id, [
        {
          role: 'panellist-a',
          status: 'unscored',
          score: 10,
          criteria: null,
          reason: 'whatever',
          summary: 'panellist-a: no score (whatever)',
        },
      ]),
    ).toThrow('must carry score=null');

    expect(store.findById(candidate.id)?.judgePanelRationales).toBeNull();
  });
});

// ── B3.4b — the panellists ask DIFFERENT questions ──────────────────────────
//
// B3.4 called `judge()` twice with byte-identical arguments. Nothing but
// sampling could separate the two panellists, so against a temperature-0
// endpoint the second call was guaranteed to reproduce the first — a second
// bill for a first opinion, and an escalation that could never fire.
//
// EVERY ASSERTION IN THIS BLOCK IS ABOUT THE REQUESTS, NOT THE CALL COUNT. A
// spec that counted calls passes unchanged against the bug being fixed here,
// which is exactly how that bug survived a suite that was otherwise green.

describe('the two panellists are asked different questions', () => {
  maybe('B carries a lens and evidence that A does not', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(7)), scoredReply(card(7))],
      measured: {
        triggerScore: 0.2,
        triggerPrecision: 0.1,
        triggerRecall: 0.4,
      },
    });

    await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(2);
    const [a, b] = h.calls;

    // The ARTIFACT is identical — same document, same variable half. Varying
    // that would make the two scorecards answers to different questions about
    // different things, and the per-criterion delta would mean nothing.
    expect(b.prompt).toBe(a.prompt);

    // The QUESTION is not. This is the assertion the old panel fails.
    expect(b.systemPromptAppend).not.toBe(a.systemPromptAppend);
    expect(a.systemPromptAppend).not.toContain('SECOND REVIEWER');
    expect(b.systemPromptAppend).toContain('SECOND REVIEWER');

    // B is shown the library A never saw…
    expect(a.systemPromptAppend).not.toContain(DEFAULT_RIVAL.name);
    expect(b.systemPromptAppend).toContain(DEFAULT_RIVAL.name);

    // …and the measurements A never saw.
    expect(a.systemPromptAppend).not.toContain('0.20');
    expect(b.systemPromptAppend).toContain('0.20');
    expect(b.systemPromptAppend).toContain('0.10');
    expect(b.systemPromptAppend).toContain('0.40');
  });

  maybe('the SCORECARD stays identical while the lens varies', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(7)), scoredReply(card(7))],
      measured: { triggerScore: 0.2 },
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    const [a, b] = h.calls;
    // Same five criteria, same 1-10 scale, on BOTH sides. The escalation
    // compares per criterion; a differently-shaped rubric on one side would
    // silently turn every delta into noise.
    for (const key of JUDGE_CRITERION_KEYS) {
      expect(a.systemPromptAppend).toContain(key);
      expect(b.systemPromptAppend).toContain(key);
    }
    expect(a.systemPromptAppend).toContain('Score each criterion 1-10');
    expect(b.systemPromptAppend).toContain('Score each criterion 1-10');
    expect(b.systemPromptAppend).toContain('SAME 1-10 scale');
    // And the two scorecards were still comparable enough to average.
    expect(result.verdict.criteria).toEqual(card(7));
  });

  maybe('the lens is read FRESH, not from the caller row', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(7)), scoredReply(card(7))],
      rivals: [],
    });

    // A gate measured this candidate AFTER the caller loaded its row — which is
    // the ordinary order, because the gates are what produce the measurement.
    h.store.recordTriggerEval(h.candidate.id, {
      score: 0.15,
      precision: 0.1,
      recall: 0.3,
      evaluatedAt: 3_000,
    });
    expect(h.candidate.triggerScore).toBeNull();

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    // Taking the stale copy would have degenerated the lens and skipped B.
    expect(h.calls).toHaveLength(2);
    expect(result.lens?.measurements?.triggerScore).toBe(0.15);
    expect(h.calls[1].systemPromptAppend).toContain('0.15');
  });

  maybe('a measured 0 is shown; an unmeasured gate is not', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(7)), scoredReply(card(7))],
      rivals: [],
      measured: { triggerScore: 0 },
    });

    await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    const b = h.calls[1];
    // `0` is a measurement that went badly and is evidence AGAINST the
    // candidate; `null` never happened and must not be rendered as a zero.
    expect(b.systemPromptAppend).toContain('retrieval trigger score: 0.00');
    expect(b.systemPromptAppend).not.toContain('replay confidence against');
    expect(b.systemPromptAppend).not.toContain('retrieval precision');
  });

  maybe('a description below the floor is not a neighbour', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(7)), scoredReply(card(7))],
      rivals: [
        {
          name: 'descale-the-espresso-machine',
          description: 'Use when the espresso machine needs descaling.',
          vector: FAR_VECTOR,
        },
        DEFAULT_RIVAL,
      ],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(result.lens?.neighbours.map((n) => n.name)).toEqual([
      DEFAULT_RIVAL.name,
    ]);
    expect(h.calls[1].systemPromptAppend).toContain(DEFAULT_RIVAL.name);
    // Telling B the library already covers ground it does not cover is evidence
    // for a lower novelty score with nothing behind it.
    expect(h.calls[1].systemPromptAppend).not.toContain(
      'descale-the-espresso-machine',
    );
  });

  it('ranks nearest first and keeps at most the shortlist', () => {
    const rivals = [
      { name: 'e', description: 'e' },
      { name: 'd', description: 'd' },
      { name: 'c', description: 'c' },
      { name: 'b', description: 'b' },
      { name: 'a', description: 'a' },
    ];
    const picked = selectLensNeighbours(rivals, [0.5, 0.6, 0.7, 0.8, 0.9]);

    expect(picked.map((n) => n.name)).toEqual(['a', 'b', 'c']);
    expect(picked).toHaveLength(JUDGE_LENS_MAX_NEIGHBOURS);
    // A misaligned pairing would attribute one skill's description to another's
    // score, so it yields nothing rather than a plausible wrong answer.
    expect(selectLensNeighbours(rivals, [0.9])).toEqual([]);
    // The floor is absolute, not relative.
    expect(
      selectLensNeighbours(rivals, [0, 0, 0, 0, JUDGE_LENS_MIN_SIMILARITY]),
    ).toHaveLength(1);
  });
});

// ── The lens rides the unclippable half ─────────────────────────────────────

describe('the lens cannot be clipped away', () => {
  maybe(
    'survives a maxInputChars clip that would eat it off a prompt',
    async () => {
      // The REAL runner, with every lane clipped far below the prompt. On
      // `prompt` the lens would be truncated and B would silently become A —
      // the fix would look applied while doing nothing.
      const h = makeHarness({
        scripts: [scoredReply(card(7)), scoredReply(card(7))],
        measured: { triggerScore: 0.2 },
        maxInputChars: 40,
      });

      await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      expect(h.calls).toHaveLength(2);
      const b = h.calls[1];
      expect(b.systemPromptAppend).toContain('SECOND REVIEWER');
      expect(b.systemPromptAppend).toContain(DEFAULT_RIVAL.name);
      expect(b.systemPromptAppend).toContain('0.20');
      // The clip really did fire — otherwise this case proves nothing.
      expect(b.prompt.length).toBeLessThanOrEqual(80);
      expect(b.prompt).not.toContain('SECOND REVIEWER');
      expect(b.prompt).not.toContain(DEFAULT_RIVAL.name);
    },
  );
});

// ── The principled skip ─────────────────────────────────────────────────────

describe('a degenerate lens buys no second judge', () => {
  maybe('no neighbours and nothing measured spends one call', async () => {
    const h = makeHarness({
      // The second script is present precisely so a panel that ran B anyway
      // would SUCCEED at it, and the count is what fails.
      scripts: [scoredReply(card(9)), scoredReply(card(2))],
      rivals: [],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(1);
    expect(result.panellists).toBe(1);
    expect(result.escalated).toBe(false);
    expect(result.reason).toBe(JUDGE_PANEL_REASONS.lensDegenerate);
    // "We looked and there was nothing" — not "we never looked".
    expect(result.lens).toEqual({ neighbours: [], measurements: null });
    // The first verdict still stands and is still persisted.
    expect(result.verdict.score).toBe(9);
    expect(h.store.findById(h.candidate.id)?.judgeScore).toBe(9);
    expect(storedRationales(h.store, h.candidate.id)).toHaveLength(1);
  });

  maybe('neighbours alone convene B', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(9)), scoredReply(card(8))],
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(2);
    expect(result.panellists).toBe(2);
    expect(result.lens?.neighbours).toHaveLength(1);
    expect(result.lens?.measurements).toBeNull();
  });

  maybe(
    'a measurement alone convenes B in a host with no embedder',
    async () => {
      const h = makeHarness({
        scripts: [scoredReply(card(9)), scoredReply(card(8))],
        embedder: 'none',
        measured: { replayConfidence: 0.3 },
      });

      const result = await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      expect(h.calls).toHaveLength(2);
      expect(result.lens?.neighbours).toEqual([]);
      expect(h.calls[1].systemPromptAppend).toContain(
        'replay confidence against',
      );
      expect(h.calls[1].systemPromptAppend).toContain('0.30');
      // No embedder means no description ranking, however full the library is.
      expect(h.calls[1].systemPromptAppend).not.toContain(DEFAULT_RIVAL.name);
    },
  );

  maybe('no embedder and nothing measured degenerates', async () => {
    const h = makeHarness({
      scripts: [scoredReply(card(9)), scoredReply(card(2))],
      embedder: 'none',
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(1);
    expect(result.reason).toBe(JUDGE_PANEL_REASONS.lensDegenerate);
  });

  maybe(
    'an embedder that rejects costs the neighbours, not the judge',
    async () => {
      const h = makeHarness({
        scripts: [scoredReply(card(9)), scoredReply(card(8))],
        embedder: 'throws',
        measured: { triggerScore: 0.2 },
      });

      const result = await h.panel.evaluate({
        candidate: h.candidate,
        body: BODY,
        settings: settings(),
      });

      expect(h.calls).toHaveLength(2);
      expect(result.lens?.neighbours).toEqual([]);
      expect(result.verdict.status).toBe('scored');
      expect(h.calls[1].systemPromptAppend).toContain('0.20');
    },
  );

  maybe('the embedder is not paid for before R8 has cleared', async () => {
    const h = makeHarness({ scripts: [unreadableReply()] });

    await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(1);
    expect(h.embed).not.toHaveBeenCalled();
  });
});

// ── The escalation adjudicates a real conflict ──────────────────────────────

describe('the escalation is shown what only B saw', () => {
  maybe('carries the same evidence on the same unclippable half', async () => {
    const h = makeHarness({
      scripts: [
        scoredReply(card(7, { novelty: 9 })),
        scoredReply(card(7, { novelty: 4 })),
        scoredReply(card(6)),
      ],
      measured: { triggerScore: 0.2 },
    });

    const result = await h.panel.evaluate({
      candidate: h.candidate,
      body: BODY,
      settings: settings(),
    });

    expect(h.calls).toHaveLength(3);
    const escalation = h.calls[2];
    expect(escalation.model).toBe('synthesis-lane-model');
    // Without this the escalation is told that one reviewer scored novelty 4
    // and never why, and splitting the difference is the only move left — the
    // answer this third call exists to avoid.
    expect(escalation.systemPromptAppend).toContain(
      'NOT shown the same material',
    );
    expect(escalation.systemPromptAppend).toContain(DEFAULT_RIVAL.name);
    expect(escalation.systemPromptAppend).toContain('0.20');
    expect(escalation.prompt).toContain('novelty=9');
    expect(escalation.prompt).toContain('novelty=4');
    expect(result.verdict.score).toBe(6);
  });
});
