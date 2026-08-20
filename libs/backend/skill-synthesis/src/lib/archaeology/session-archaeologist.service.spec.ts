/**
 * SessionArchaeologistService — P2-1, the multi-pass loop.
 *
 * These assertions run against a REAL SQLite database with `0034` applied. The
 * whole claim of this batch is "the STORED row carries an intent, an evidence
 * class, integer friction turn indices and a non-empty citation list", and a
 * mocked store that hands back whatever it was given proves none of it — the
 * store is also the layer that THROWS on a fractional index, which is the
 * throw this analyzer exists to keep out of the drain.
 *
 * `better-sqlite3` in this repo is rebuilt against Electron's ABI by postinstall
 * and cannot load under Jest/Node, so the shared opener in
 * `../queue/queue-db.test-support.ts` falls back to Node's built-in
 * `node:sqlite`. Reusing it rather than copying the house native-gate is
 * deliberate: the copied gate makes specs SKIP silently — green while asserting
 * nothing.
 *
 * The LANE is stubbed and the READER is real. That split is the point: the lane
 * has four specs of its own, whereas the thing under test here is what
 * TypeScript does between two model replies — which windows it serves, when it
 * heartbeats, and when it stops.
 *
 * What is pinned, in order of how badly it hurts to get wrong:
 *
 *  1. **`touchClaim` fires BETWEEN passes, and a `false` stops every write.**
 *     Asserted as an ORDER, not a call count: a heartbeat that happens to run
 *     after the last pass satisfies `toHaveBeenCalled` and defends nothing.
 *     The analyzer takes the drain's `SkillStageContext.touch` callback, so the
 *     stub below wires it to a REAL `SkillQueueStore.touchClaim(id)` spy — the
 *     same one-liner the drain builds (`skill-drain.service.ts:568`) — rather
 *     than to an invented boolean.
 *  2. **The pass ceiling holds** against a model that asks for more forever.
 *  3. **The stored row's shape**, read back out of SQLite.
 *  4. **Model output is sanitized before it reaches the store**, because the
 *     store's rejection of a fractional index would otherwise surface as a
 *     throw out of a background stage.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { resolvedLane } from '../lanes/lane-runner.test-support';
import type {
  LaneRunRequest,
  LaneRunResult,
  LaneRunnerService,
} from '../lanes/lane-runner.service';
import type { SkillQueueStore } from '../queue/skill-queue.store';
import { SessionVerdictStore } from './session-verdict.store';
import { SESSION_VERDICT_JSON_SCHEMA } from './session-verdict.types';
import {
  ARCHAEOLOGY_DEGRADED_REASONS,
  SessionArchaeologistService,
  type SessionArchaeologyResult,
} from './session-archaeologist.service';
import type { TranscriptJsonlReader } from './transcript-window.reader';

const SQL_0034 = MIGRATIONS.find((m) => m.version === 34)?.sql ?? '';

const SERVICE_SOURCE = fs.readFileSync(
  path.join(__dirname, 'session-archaeologist.service.ts'),
  'utf8',
);

// ── Transcript fixtures ─────────────────────────────────────────────────────

function userTurn(text: string): unknown {
  return { type: 'user', message: { role: 'user', content: text } };
}

function assistantTurn(text: string): unknown {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

/** Twelve turns, each individually identifiable in a rendered window. */
function transcript(): unknown[] {
  const messages: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    messages.push(userTurn(`user says thing number ${i}`));
    messages.push(assistantTurn(`assistant answers thing number ${i}`));
  }
  return messages;
}

function makeJsonl(messages: unknown[] = transcript()): TranscriptJsonlReader {
  return {
    findSessionsDirectory: jest.fn(async () => '/sessions'),
    readJsonlMessages: jest.fn(async () => messages),
  };
}

// ── Lane stub ───────────────────────────────────────────────────────────────

function okRun(
  json: unknown,
  opts: { passesAllowed?: number; model?: string } = {},
): LaneRunResult {
  return {
    status: 'ok',
    run: {
      lane: resolvedLane('archaeologist', {
        model: opts.model ?? 'a-tier-alias',
      }),
      text: JSON.stringify(json),
      json,
      structuredOutputHonoured: true,
      usage: {},
      truncated: false,
      degradedReason: null,
      executions: 1,
      passesAllowed: opts.passesAllowed ?? 4,
    },
  };
}

interface LaneStub {
  service: LaneRunnerService;
  run: jest.Mock;
  requests: LaneRunRequest[];
}

/**
 * Replays `scripts` in order; the last entry repeats, so a "the model never
 * stops asking" case does not need one entry per pass.
 */
function makeLaneStub(scripts: LaneRunResult[], order?: string[]): LaneStub {
  const requests: LaneRunRequest[] = [];
  const run = jest.fn(async (req: LaneRunRequest) => {
    order?.push('pass');
    requests.push(req);
    return scripts[Math.min(requests.length - 1, scripts.length - 1)];
  });
  return { run, requests, service: { run } as unknown as LaneRunnerService };
}

interface QueueStub {
  store: SkillQueueStore;
  touchClaim: jest.Mock;
  /** Exactly what the drain hands a stage handler as `ctx.touch`. */
  touchOf(id: string): () => boolean;
}

function makeQueueStub(held = true, order?: string[]): QueueStub {
  const touchClaim = jest.fn((_id: string) => {
    order?.push('touch');
    return held;
  });
  const store = { touchClaim } as unknown as SkillQueueStore;
  return {
    touchClaim,
    store,
    touchOf: (id: string) => () => store.touchClaim(id),
  };
}

function makeWorkspace(settings: Record<string, unknown>): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      key in settings ? (settings[key] as T) : (fallback as T),
  } as unknown as IWorkspaceProvider;
}

// ── Model replies ───────────────────────────────────────────────────────────

const PASS_1_REPLY = {
  intent: 'Recover a stacked branch after a bad rebase',
  outcome: 'Not yet settled — the failing turns are earlier in the session',
  evidenceClass: 'unverified',
  frictionMap: [{ turnIndex: 9, kind: 'retry', note: 'rebase run again' }],
  routine: null,
  requestTurns: [{ from: 2, to: 4 }],
};

const PASS_2_REPLY = {
  intent: 'Recover a stacked branch after a bad rebase without losing the WIP',
  outcome: 'The branch was recovered and the test suite ran green afterwards',
  evidenceClass: 'tests-green',
  frictionMap: [
    { turnIndex: 3, kind: 'correction', note: 'wrong base named' },
    { turnIndex: 9, kind: 'retry', note: 'rebase run again' },
  ],
  routine: {
    summary: 'Recover a stacked branch after a bad rebase',
    steps: ['find the reflog entry', 'reset onto it', 're-run the tests'],
    citations: [3, 9, 11],
  },
};

describe('SessionArchaeologistService — static contract (no database needed)', () => {
  it('finds migration 0034 in the shipped MIGRATIONS tuple', () => {
    // Without this the behaviour block would be running against an empty
    // schema and every row assertion below would be meaningless.
    expect(SQL_0034).toContain(
      'CREATE TABLE IF NOT EXISTS skill_session_verdicts',
    );
  });

  it('collapses the pass budget from a capability VALUE, never from a branch', () => {
    // R6 is "one code path, two configurations". The lane already reports
    // `passesAllowed: 1` both for a DECLARED `toolUse: 'none'` and for an
    // endpoint DISCOVERED unable to drive the loop, so the analyzer must read
    // that number rather than re-deciding it. A `toolUse === ...` comparison
    // here would be the second code path this rule exists to prevent — and the
    // one that later grows a provider branch beside it.
    expect(SERVICE_SOURCE).not.toMatch(/toolUse\s*===/);
    expect(SERVICE_SOURCE).toContain('run.passesAllowed');
  });

  it('names the two shared degraded reasons by reference, not by re-spelling', () => {
    // `no-query-path` vs `noQueryPath` is exactly the drift an open vocabulary
    // invites; the shared map is the single spelling.
    expect(ARCHAEOLOGY_DEGRADED_REASONS.NO_QUERY_PATH).toBe('no-query-path');
    expect(ARCHAEOLOGY_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED).toBe(
      'tool-use-unsupported',
    );
  });
});

describe('SessionArchaeologistService — multi-pass (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  let db: TestDatabase | null = null;
  let store: SessionVerdictStore;

  beforeEach(() => {
    if (!opener) return;
    db = opener(makeTempDbPath());
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SQL_0034);
    store = new SessionVerdictStore(noopLogger, asConnection(db));
  });

  afterEach(() => {
    db?.close();
    db = null;
  });

  function build(
    lane: LaneStub,
    settings: Record<string, unknown> = {},
    messages: unknown[] = transcript(),
  ): SessionArchaeologistService {
    return new SessionArchaeologistService(
      noopLogger,
      makeWorkspace(settings),
      makeJsonl(messages),
      lane.service,
      store,
    );
  }

  // ── The heartbeat ─────────────────────────────────────────────────────────

  maybe(
    'heartbeats the claim BETWEEN the two passes, not around them',
    async () => {
      const order: string[] = [];
      const lane = makeLaneStub(
        [okRun(PASS_1_REPLY), okRun(PASS_2_REPLY)],
        order,
      );
      const queue = makeQueueStub(true, order);
      const service = build(lane);

      const result = await service.analyze({
        sessionId: 's-two-pass',
        workspaceRoot: '/ws',
        touch: queue.touchOf('q-1'),
      });

      expect(result.status).toBe('ok');
      // The ORDER is the assertion. A heartbeat that only ran after the final
      // pass would satisfy a call count and would not defend the run at all.
      expect(order).toEqual(['pass', 'touch', 'pass']);
      expect(queue.touchClaim).toHaveBeenCalledTimes(1);
      expect(queue.touchClaim).toHaveBeenCalledWith('q-1');
    },
  );

  maybe('a lost claim stops the run and writes NOTHING', async () => {
    const lane = makeLaneStub([okRun(PASS_1_REPLY), okRun(PASS_2_REPLY)]);
    const queue = makeQueueStub(false);
    const service = build(lane);

    const result = await service.analyze({
      sessionId: 's-lost',
      workspaceRoot: '/ws',
      touch: queue.touchOf('q-lost'),
    });

    expect(result.status).toBe('lost-claim');
    // Stopped mid-loop: the second pass never ran…
    expect(lane.run).toHaveBeenCalledTimes(1);
    // …and no verdict was written for a row this worker no longer holds.
    expect(store.findBySession('s-lost')).toBeNull();
  });

  maybe(
    'never heartbeats when there is no queue row to heartbeat',
    async () => {
      const lane = makeLaneStub([okRun(PASS_1_REPLY), okRun(PASS_2_REPLY)]);
      const queue = makeQueueStub();
      const service = build(lane);

      await service.analyze({ sessionId: 's-no-row', workspaceRoot: '/ws' });

      expect(lane.run).toHaveBeenCalledTimes(2);
      expect(queue.touchClaim).not.toHaveBeenCalled();
    },
  );

  // ── The windows ───────────────────────────────────────────────────────────

  maybe('pass 1 serves tail AND head, bounded by the lane budget', async () => {
    const lane = makeLaneStub([okRun(PASS_2_REPLY)]);
    const service = build(lane, {
      'skillSynthesis.archaeologist.maxInputChars': 4000,
    });

    await service.analyze({ sessionId: 's-windows', workspaceRoot: '/ws' });

    const prompt = lane.requests[0].prompt;
    expect(prompt).toContain('=== opening turns ===');
    expect(prompt).toContain('=== most recent turns ===');
    // Turn 0 (head) and turn 11 (tail) both present, addressed by index.
    expect(prompt).toContain('[#0 user]');
    expect(prompt).toContain('[#11 assistant]');
    expect(prompt).toContain('The session has 12 turns');
    // The prompt fits the lane budget, so the runner's own clip never fires.
    expect(prompt.length).toBeLessThanOrEqual(4000);
    // The rubric rides the UNCLIPPED half.
    expect(lane.requests[0].systemPromptAppend).toContain(
      'Reply with ONLY a JSON object',
    );
    expect(lane.requests[0].outputSchema).toBe(SESSION_VERDICT_JSON_SCHEMA);
  });

  maybe(
    'pass 2 serves EXACTLY the requested range, plus the verdict so far',
    async () => {
      const lane = makeLaneStub([okRun(PASS_1_REPLY), okRun(PASS_2_REPLY)]);
      const service = build(lane);

      await service.analyze({ sessionId: 's-range', workspaceRoot: '/ws' });

      expect(lane.run).toHaveBeenCalledTimes(2);
      const prompt = lane.requests[1].prompt;
      expect(prompt).toContain('=== turns #2–#4 ===');
      expect(prompt).toContain('[#2 user]');
      expect(prompt).toContain('[#3 assistant]');
      expect(prompt).toContain('[#4 user]');
      // Turn 5 was not asked for and is not served.
      expect(prompt).not.toContain('[#5 assistant]');
      // The verdict-so-far travels with it, so the model refines rather than
      // starting over from a window it can no longer see.
      expect(prompt).toContain('Recover a stacked branch after a bad rebase');
    },
  );

  maybe('serves a literal search probe over the transcript', async () => {
    const lane = makeLaneStub([
      okRun({
        ...PASS_1_REPLY,
        requestTurns: [],
        requestSearch: ['thing number 5'],
      }),
      okRun(PASS_2_REPLY),
    ]);
    const service = build(lane);

    await service.analyze({ sessionId: 's-search', workspaceRoot: '/ws' });

    const prompt = lane.requests[1].prompt;
    expect(prompt).toContain('=== turns containing "thing number 5" ===');
    expect(prompt).toContain('[#10 user]');
    expect(prompt).toContain('[#11 assistant]');
  });

  // ── Termination ───────────────────────────────────────────────────────────

  maybe('a reply carrying no requests is terminal at pass 1', async () => {
    const lane = makeLaneStub([okRun(PASS_2_REPLY)]);
    const queue = makeQueueStub();
    const service = build(lane);

    const result = await service.analyze({
      sessionId: 's-terminal',
      workspaceRoot: '/ws',
      touch: queue.touchOf('q-t'),
    });

    expect(lane.run).toHaveBeenCalledTimes(1);
    expect(queue.touchClaim).not.toHaveBeenCalled();
    expect(unwrap(result).passes).toBe(1);
    expect(unwrap(result).degradedReason).toBeNull();
  });

  maybe(
    'honours maxPasses against a model that never stops asking',
    async () => {
      // Every reply carries `requestTurns`, so only the ceiling can end this.
      const lane = makeLaneStub([okRun(PASS_1_REPLY)]);
      const service = build(lane, {
        'skillSynthesis.archaeologist.maxPasses': 2,
      });

      const result = await service.analyze({
        sessionId: 's-ceiling',
        workspaceRoot: '/ws',
      });

      expect(lane.run).toHaveBeenCalledTimes(2);
      expect(unwrap(result).passes).toBe(2);
      // The last pass is told so, rather than being cut off mid-negotiation.
      expect(lane.requests[1].prompt).toContain('This is your LAST pass');
    },
  );

  // ── The stored row (P2-1's headline assertion) ────────────────────────────

  maybe(
    'stores intent, evidence class, integer friction indices and citations',
    async () => {
      const lane = makeLaneStub([okRun(PASS_1_REPLY), okRun(PASS_2_REPLY)]);
      const service = build(lane);

      await service.analyze({
        sessionId: 's-row',
        workspaceRoot: '/ws',
      });

      const row = store.findBySession('s-row');
      expect(row).not.toBeNull();
      if (!row) return;

      expect(row.intent).toBe(PASS_2_REPLY.intent);
      expect(row.outcome).toBe(PASS_2_REPLY.outcome);
      expect(row.evidenceClass).toBe('tests-green');

      expect(row.frictionMap).toHaveLength(2);
      for (const entry of row.frictionMap) {
        expect(Number.isInteger(entry.turnIndex)).toBe(true);
        expect(entry.turnIndex).toBeGreaterThanOrEqual(0);
      }
      expect(row.frictionMap.map((f) => f.turnIndex)).toEqual([3, 9]);

      expect(row.routine).not.toBeNull();
      expect(row.routine?.citations.length).toBeGreaterThan(0);
      for (const citation of row.routine?.citations ?? []) {
        expect(typeof citation).toBe('number');
      }

      expect(row.turnCount).toBe(12);
      expect(row.passes).toBe(2);
      expect(row.lane).toBe('archaeologist');
      expect(row.model).toBe('a-tier-alias');
      expect(row.degradedReason).toBeNull();
      // A full multi-pass verdict is what phase 3 prefers over the extractor.
      expect(store.hasUsableVerdict('s-row')).toBe(true);
    },
  );

  // ── Model output is untrusted ─────────────────────────────────────────────

  maybe('sanitizes model output the store would otherwise reject', async () => {
    const lane = makeLaneStub([
      okRun({
        intent: '  Trim me  ',
        outcome: null,
        evidenceClass: 'wildly-invented-class',
        frictionMap: [
          { turnIndex: 4.7, kind: 'correction', note: 'fractional index' },
          { turnIndex: -1, kind: 'retry', note: 'negative index' },
          { turnIndex: 2, kind: 'not-a-kind', note: 'unknown kind' },
          { turnIndex: 6, kind: 'dead-end', note: 'the good one' },
        ],
        routine: {
          summary: 'A routine nobody can trace back to a turn',
          steps: ['step'],
          citations: [],
        },
      }),
    ]);
    const service = build(lane);

    // The store THROWS on a fractional turn index and on an uncited routine.
    // A throw here is the retry storm P2-3 forbids, so it must never reach it.
    const result = await service.analyze({
      sessionId: 's-dirty',
      workspaceRoot: '/ws',
    });
    expect(result.status).toBe('ok');

    const row = store.findBySession('s-dirty');
    expect(row?.intent).toBe('Trim me');
    // An unrecognised evidence class is dropped, not cast into the union — the
    // migration's CHECK would reject it anyway, less legibly.
    expect(row?.evidenceClass).toBeNull();
    expect(row?.frictionMap.map((f) => f.turnIndex)).toEqual([4, 6]);
    // A routine with no surviving citation is a claim, not evidence.
    expect(row?.routine).toBeNull();
  });

  maybe(
    'records a degraded row when the reply carries no verdict object',
    async () => {
      const lane = makeLaneStub([okRun('not an object at all')]);
      const service = build(lane);

      const result = await service.analyze({
        sessionId: 's-no-verdict',
        workspaceRoot: '/ws',
      });

      expect(result.status).toBe('ok');
      const row = store.findBySession('s-no-verdict');
      expect(row?.intent).toBeNull();
      expect(row?.degradedReason).toBe(
        ARCHAEOLOGY_DEGRADED_REASONS.NO_VERDICT_IN_REPLY,
      );
    },
  );

  maybe(
    'degrades rather than throws when the transcript cannot be read',
    async () => {
      const lane = makeLaneStub([okRun(PASS_2_REPLY)]);
      const jsonl: TranscriptJsonlReader = {
        findSessionsDirectory: jest.fn(async () => null),
        readJsonlMessages: jest.fn(async () => []),
      };
      const service = new SessionArchaeologistService(
        noopLogger,
        makeWorkspace({}),
        jsonl,
        lane.service,
        store,
      );

      const result = await service.analyze({
        sessionId: 's-unreadable',
        workspaceRoot: '/ws',
      });

      expect(result.status).toBe('ok');
      // Nothing was spent: the lane was never reached.
      expect(lane.run).not.toHaveBeenCalled();
      expect(store.findBySession('s-unreadable')?.degradedReason).toBe(
        ARCHAEOLOGY_DEGRADED_REASONS.TRANSCRIPT_UNREADABLE,
      );
    },
  );

  // ── Lane failure ──────────────────────────────────────────────────────────

  maybe(
    'a pass-1 lane failure writes NOTHING and stays re-eligible',
    async () => {
      const lane = makeLaneStub([
        {
          status: 'failed',
          failure: {
            kind: 'timeout',
            reason: 'lane timed out',
            retryAfterMs: 60_000,
          },
        },
      ]);
      const service = build(lane);

      const result = await service.analyze({
        sessionId: 's-fail-1',
        workspaceRoot: '/ws',
      });

      expect(result.status).toBe('failed');
      if (result.status !== 'failed') return;
      expect(result.verdict).toBeNull();
      // No degraded row: a timeout is a transport fault, and a row saying
      // "analyzed, no verdict" would stop the drain re-attempting a session that
      // was never actually analyzed.
      expect(store.findBySession('s-fail-1')).toBeNull();
      /**
       * And the analyzer does NOT opt the run into the lane's own `requeue`
       * write. That seam has exactly one owner — the drain maps `SkillLaneFailure`
       * onto row transitions in `applyLaneFailure`, and doing both double-writes
       * the row: harmless while `requeue` is idempotent, a real defect the moment
       * the terminal ceiling fires against a claim the runner already released.
       * The failure travels back as DATA instead, ready for `lane-failed`.
       * P1-7's source scan in `skill-drain.failures.spec.ts` pins the same rule
       * mechanically; this pins the behaviour it protects.
       */
      expect(lane.requests[0].queueItemId).toBeUndefined();
    },
  );

  maybe('a later lane failure keeps the pass already paid for', async () => {
    const lane = makeLaneStub([
      okRun(PASS_1_REPLY),
      {
        status: 'failed',
        failure: {
          kind: 'timeout',
          reason: 'lane timed out',
          retryAfterMs: 60_000,
        },
      },
    ]);
    const service = build(lane);

    const result = await service.analyze({
      sessionId: 's-fail-2',
      workspaceRoot: '/ws',
    });

    expect(result.status).toBe('failed');
    const row = store.findBySession('s-fail-2');
    expect(row?.intent).toBe(PASS_1_REPLY.intent);
    expect(row?.passes).toBe(1);
    // Marked with the failure kind, so a reader can tell a cut-short analysis
    // from a complete one.
    expect(row?.degradedReason).toBe('timeout');
  });
});

/** Narrow an `ok` result, failing loudly rather than optional-chaining past it. */
function unwrap(result: SessionArchaeologyResult) {
  if (result.status !== 'ok') {
    throw new Error(`expected an ok result, got ${result.status}`);
  }
  return result.verdict;
}
