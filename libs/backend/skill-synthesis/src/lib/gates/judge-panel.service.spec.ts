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
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
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
import { SkillJudgeService, JUDGE_REASONS } from '../skill-judge.service';
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
function makeLaneResolver(): LaneResolverService {
  return {
    resolve: jest.fn(
      async (id: SkillLaneId): Promise<SkillLaneResolution> => ({
        ok: true,
        lane: resolvedLane(id, { model: `${id}-lane-model` }),
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

interface Harness {
  readonly panel: JudgePanelService;
  readonly store: SkillCandidateStore;
  readonly candidate: SkillCandidateRow;
  readonly calls: ExecuteCall[];
  readonly db: TestDatabase;
}

function makeHarness(opts: {
  scripts: StreamMessage[][];
  workspace?: Record<string, unknown>;
}): Harness {
  const db = createDb();
  const store = makeCandidateStore(db);
  const { candidate } = store.registerCandidate({
    name: 'bump-the-migration-ratchet',
    description: 'Use when a new migration needs its ratchets bumped.',
    bodyPath: '',
    sourceSessionIds: ['s1'],
    trajectoryHash: 'traj-1',
    embedding: null,
    createdAt: 1_000,
  });

  const query = makeQueryStub(opts.scripts);
  const runner = new LaneRunnerService(
    makeLogger(),
    makeLaneResolver(),
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
  );
  return { panel, store, candidate, calls: query.calls, db };
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
