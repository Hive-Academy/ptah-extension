/**
 * SessionArchaeologistService — P2-3, graceful null degradation.
 *
 * THE LANE RUNNER HERE IS REAL, and that is the entire design of this file.
 * P2-3's two cases are both statements about what happens when a CAPABILITY is
 * missing, and a stubbed `LaneRunnerService` would let this spec assert that
 * the analyzer handles a `LaneRunResult` shape the spec itself invented. Both
 * cases therefore drive a real `LaneRunnerService`:
 *
 *  * **Case 1** resolves it out of a tsyringe container in which
 *    `INTERNAL_QUERY_SERVICE_TOKEN` is genuinely NOT registered — the CLI and
 *    e2e host shape — so the `unavailable` outcome comes from the optional
 *    injection resolving `null`, not from a hand-written literal.
 *  * **Case 2** gives it a working endpoint on a lane declaring
 *    `toolUse: 'none'` and splits in two, because the collapse and the
 *    degradation are DIFFERENT facts:
 *      - **2a** — the reply STILL asks to read more turns. Only the capability
 *        collapse can end that run, so a single pass proves R6 rather than
 *        proving the fixture stopped asking; and because the analyst named
 *        evidence it never received, the verdict is degraded.
 *      - **2b** — the identical lane, with a reply that is TERMINAL. Same
 *        collapse, same single pass, `degradedReason: null`. The analyst said
 *        it was done, and a verdict it called final is complete however
 *        cheaply it was produced.
 *    The two differ by exactly one thing — whether the reply carries requests —
 *    which is the point: the signal is what the ANALYST wanted, not what the
 *    LANE could do.
 *
 * The database is real for the same reason it is in the sibling spec: "a
 * verdict row EXISTS with `intent === null`" is a claim about a row, and the
 * degraded row is the record that stops the drain re-attempting the same
 * session forever.
 *
 * NO EXCEPTION, NO RETRY STORM. Every case below asserts that `analyze`
 * RESOLVES. A throw out of a background stage is the failure mode this whole
 * contract exists to prevent, so it is asserted directly rather than implied by
 * the absence of a red test.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
} from '../lanes/lane-runner.test-support';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import {
  INTERNAL_QUERY_SERVICE_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
} from '../di/tokens';
import { SessionVerdictStore } from './session-verdict.store';
import {
  ARCHAEOLOGY_DEGRADED_REASONS,
  SessionArchaeologistService,
} from './session-archaeologist.service';
import type { TranscriptJsonlReader } from './transcript-window.reader';

const SQL_0034 = MIGRATIONS.find((m) => m.version === 34)?.sql ?? '';

/**
 * A reply that is a complete verdict AND still asks to read more.
 *
 * Paired with {@link TERMINAL_REPLY} below, these two are the ONLY difference
 * between case 2a and case 2b: same lane, same collapse, same pass count. What
 * separates a degraded verdict from a complete one is whether the ANALYST
 * wanted more evidence — not what the lane was capable of.
 */
const INSATIABLE_REPLY = {
  intent: 'Make the flaky integration test deterministic',
  outcome: 'The shared clock was frozen and the suite stopped flaking',
  evidenceClass: 'tests-green',
  frictionMap: [{ turnIndex: 5, kind: 'retry', note: 'suite re-run twice' }],
  routine: {
    summary: 'Freeze the clock before asserting on a scheduled side effect',
    steps: ['freeze time', 'run the effect', 'assert', 'restore'],
    citations: [5, 7],
  },
  requestTurns: [{ from: 0, to: 3 }],
  requestSearch: ['flaky'],
};

/**
 * The same verdict, TERMINAL — no `requestTurns`, no `requestSearch`. The
 * analyst says it is done, so nothing was left unread and the verdict is
 * complete however cheaply it was produced.
 */
const TERMINAL_REPLY = {
  intent: INSATIABLE_REPLY.intent,
  outcome: INSATIABLE_REPLY.outcome,
  evidenceClass: INSATIABLE_REPLY.evidenceClass,
  frictionMap: INSATIABLE_REPLY.frictionMap,
  routine: INSATIABLE_REPLY.routine,
};

function transcript(): unknown[] {
  const messages: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    messages.push({
      type: 'user',
      message: { role: 'user', content: `user says thing number ${i}` },
    });
    messages.push({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `assistant answers thing ${i}` }],
      },
    });
  }
  return messages;
}

function makeJsonl(): TranscriptJsonlReader {
  return {
    findSessionsDirectory: jest.fn(async () => '/sessions'),
    readJsonlMessages: jest.fn(async () => transcript()),
  };
}

function makeWorkspace(settings: Record<string, unknown>): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      key in settings ? (settings[key] as T) : (fallback as T),
  } as unknown as IWorkspaceProvider;
}

describe('SessionArchaeologistService — graceful null degradation (skipped without any SQLite binding)', () => {
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

  // ── Case 1: no query path in this host ────────────────────────────────────

  describe('case 1 — INTERNAL_QUERY_SERVICE_TOKEN is not registered', () => {
    /**
     * A real `LaneRunnerService` out of a container that deliberately omits the
     * query token. Resolving it through DI — rather than passing `null` — is
     * what makes this a test of the HOST SHAPE (CLI, e2e) instead of a test of
     * a constructor argument.
     */
    function buildFromContainerWithoutQueryService(): {
      service: SessionArchaeologistService;
      execute: jest.Mock;
    } {
      const child = container.createChildContainer();
      const resolver = makeResolverStub(resolvedLane('archaeologist'));
      const budget = makeBudgetStub();
      const query = makeQueryStub([]);

      child.register(TOKENS.LOGGER, { useValue: makeLogger() });
      child.register(SKILL_SYNTHESIS_TOKENS.LANE_RESOLVER_SERVICE, {
        useValue: resolver.service,
      });
      child.register(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE, {
        useValue: budget.store,
      });
      // INTERNAL_QUERY_SERVICE_TOKEN is deliberately NOT registered.
      expect(child.isRegistered(INTERNAL_QUERY_SERVICE_TOKEN, true)).toBe(
        false,
      );

      const runner = child.resolve(LaneRunnerService);
      return {
        execute: query.execute,
        service: new SessionArchaeologistService(
          noopLogger,
          makeWorkspace({}),
          makeJsonl(),
          runner,
          store,
        ),
      };
    }

    maybe('resolves — it does not throw', async () => {
      const { service } = buildFromContainerWithoutQueryService();
      await expect(
        service.analyze({ sessionId: 's-noquery', workspaceRoot: '/ws' }),
      ).resolves.toBeDefined();
    });

    maybe(
      'leaves a verdict row with a null intent and the reason why',
      async () => {
        const { service } = buildFromContainerWithoutQueryService();

        const result = await service.analyze({
          sessionId: 's-noquery-row',
          workspaceRoot: '/ws',
        });
        expect(result.status).toBe('ok');

        const row = store.findBySession('s-noquery-row');
        expect(row).not.toBeNull();
        expect(row?.intent).toBeNull();
        expect(row?.outcome).toBeNull();
        expect(row?.evidenceClass).toBeNull();
        expect(row?.routine).toBeNull();
        expect(row?.frictionMap).toEqual([]);
        expect(row?.degradedReason).toBe(
          ARCHAEOLOGY_DEGRADED_REASONS.NO_QUERY_PATH,
        );
        expect(row?.degradedReason).toBe('no-query-path');
        // Nothing ran, so nothing was paid for.
        expect(row?.passes).toBe(0);
      },
    );

    maybe(
      'sends synthesis down the extractor fallback, not down a verdict',
      async () => {
        const { service } = buildFromContainerWithoutQueryService();
        await service.analyze({
          sessionId: 's-fallback',
          workspaceRoot: '/ws',
        });

        // `hasUsableVerdict` IS the fallback branch: a present-but-degraded row
        // reads false, so a consumer preferring the verdict falls through to
        // `ExtractedTrajectory.canonicalText`. The three states stay distinct —
        // this session was analyzed, it simply has no verdict.
        expect(store.findBySession('s-fallback')).not.toBeNull();
        expect(store.hasUsableVerdict('s-fallback')).toBe(false);
      },
    );

    maybe(
      'does not retry: exactly one row, written once, no LLM call',
      async () => {
        const { service, execute } = buildFromContainerWithoutQueryService();

        const first = await service.analyze({
          sessionId: 's-noretry',
          workspaceRoot: '/ws',
        });
        const second = await service.analyze({
          sessionId: 's-noretry',
          workspaceRoot: '/ws',
        });

        expect(first.status).toBe('ok');
        expect(second.status).toBe('ok');
        // No endpoint was ever contacted — the host has none.
        expect(execute).not.toHaveBeenCalled();
        // A re-analysis REPLACES rather than appending; `created_at` survives.
        const row = store.findBySession('s-noretry');
        expect(row?.createdAt).toBeLessThanOrEqual(row?.updatedAt ?? 0);
        expect(store.listDegraded(10)).toHaveLength(1);
      },
    );
  });

  // ── Case 2: the lane cannot drive the retrieval loop ──────────────────────

  describe("case 2 — the lane declares toolUse: 'none'", () => {
    function buildSinglePassLane(reply: unknown): {
      service: SessionArchaeologistService;
      execute: jest.Mock;
    } {
      const resolver = makeResolverStub(
        resolvedLane('archaeologist', { config: { toolUse: 'none' } }),
      );
      const budget = makeBudgetStub();
      // One scripted reply per possible call. If the pass budget did NOT
      // collapse, the loop would ask again and the stub would answer again —
      // which is precisely how this fixture fails when R6 regresses.
      const query = makeQueryStub([
        [resultMessage({ structured_output: reply })],
        [resultMessage({ structured_output: reply })],
        [resultMessage({ structured_output: reply })],
        [resultMessage({ structured_output: reply })],
      ]);

      const runner = new LaneRunnerService(
        makeLogger(),
        resolver.service,
        budget.store,
        query.query,
        null,
      );

      return {
        execute: query.execute,
        service: new SessionArchaeologistService(
          noopLogger,
          // The analyzer never reads `toolUse` itself — the lane reports the
          // collapse as `passesAllowed`. The key is set so the fixture states
          // one configuration rather than two.
          makeWorkspace({ 'skillSynthesis.archaeologist.toolUse': 'none' }),
          makeJsonl(),
          runner,
          store,
        ),
      };
    }

    // ── 2a: the collapse cut the analyst off mid-request ────────────────────

    maybe(
      '2a — collapses to a single pass even though the reply asks for more',
      async () => {
        const { service, execute } = buildSinglePassLane(INSATIABLE_REPLY);

        const result = await service.analyze({
          sessionId: 's-single-pass',
          workspaceRoot: '/ws',
        });

        expect(result.status).toBe('ok');
        // The lane's default `maxPasses` is 4 and the reply asked for more every
        // time; one execution is the capability guard, not the model relenting.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(store.findBySession('s-single-pass')?.passes).toBe(1);
      },
    );

    maybe(
      '2a — records tool-use-unsupported when the collapse left requests unserved',
      async () => {
        const { service } = buildSinglePassLane(INSATIABLE_REPLY);
        await service.analyze({
          sessionId: 's-collapse',
          workspaceRoot: '/ws',
        });

        const row = store.findBySession('s-collapse');
        expect(row?.degradedReason).toBe(
          ARCHAEOLOGY_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED,
        );
        expect(row?.degradedReason).toBe('tool-use-unsupported');
        // The single pass still produced a real verdict — a degraded ANALYSIS is
        // not an empty one. What earns the reason is that the analyst NAMED
        // evidence it never got: turns 0–3 and every turn matching its probe.
        expect(row?.intent).toBe(INSATIABLE_REPLY.intent);
        expect(row?.evidenceClass).toBe('tests-green');
        expect(store.hasUsableVerdict('s-collapse')).toBe(false);
      },
    );

    // ── 2b: the same collapse, but the analyst was finished ─────────────────

    maybe(
      '2b — a terminal single-pass verdict is COMPLETE, not degraded',
      async () => {
        const { service, execute } = buildSinglePassLane(TERMINAL_REPLY);

        const result = await service.analyze({
          sessionId: 's-terminal-collapse',
          workspaceRoot: '/ws',
        });

        expect(result.status).toBe('ok');
        const row = store.findBySession('s-terminal-collapse');
        // R6's collapse is UNCHANGED — same lane, same single pass as 2a.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(row?.passes).toBe(1);
        /**
         * …and yet no degraded reason, because the analyst said it was done.
         * The capability was standing in as a proxy for incompleteness, and on
         * a clean single-pass verdict that proxy is wrong. Left as-is, every
         * cheap non-tool-use lane — exactly the lanes phase 1's provider
         * routing exists to move background work ONTO — would spend tokens
         * nightly and have `hasUsableVerdict` discard all of it.
         */
        expect(row?.degradedReason).toBeNull();
        expect(store.hasUsableVerdict('s-terminal-collapse')).toBe(true);
        // A complete verdict, not a stub: the fix is to the reason write, not
        // to the predicate that reads it.
        expect(row?.intent).toBe(TERMINAL_REPLY.intent);
        expect(row?.evidenceClass).toBe('tests-green');
        expect(row?.routine?.citations).toEqual([5, 7]);
      },
    );

    maybe(
      '2b — a terminal verdict is not on the degraded feed at all',
      async () => {
        const { service } = buildSinglePassLane(TERMINAL_REPLY);
        await service.analyze({
          sessionId: 's-not-degraded',
          workspaceRoot: '/ws',
        });

        // `listDegraded` is the "why is there no verdict for these?" feed. A
        // complete verdict appearing on it would be a false report to the user
        // as well as a discarded result.
        expect(store.listDegraded(10)).toEqual([]);
      },
    );

    // ── Shared to both ──────────────────────────────────────────────────────

    maybe('never gives a non-tool-use lane a multi-turn budget', async () => {
      const { service, execute } = buildSinglePassLane(INSATIABLE_REPLY);
      await service.analyze({ sessionId: 's-turns', workspaceRoot: '/ws' });

      // The guard is applied BEFORE the call rather than discovered by it: a
      // lane that cannot drive tools must not be able to burn `timeoutMs`
      // finding that out.
      expect(execute.mock.calls[0][0].maxTurns).toBe(1);
    });

    maybe('resolves — it does not throw', async () => {
      const { service } = buildSinglePassLane(INSATIABLE_REPLY);
      await expect(
        service.analyze({
          sessionId: 's-collapse-noThrow',
          workspaceRoot: '/ws',
        }),
      ).resolves.toBeDefined();
    });
  });
});
