/**
 * `skillSynthesis:digest` — criterion P4-1 (TASK_2026_180 Phase 4, task B4.4.2).
 *
 * P4-1: against a SEEDED DB, the result is sorted by `score` DESCENDING and
 * every item carries a non-empty `evidence.sessionIds`, a `counts` map, and a
 * `winRate` that is `number | null`.
 *
 * THE ONE RULE THIS FILE EXISTS FOR IS NOT THE SORT. `winRate` is
 * `number | null` and `null` is NEVER `0`: `null` means nobody measured this
 * skill, `0` means it was measured and lost every measured session. `0` is
 * falsy, so a single `||` or `?? 0` anywhere on the wire path retitles a
 * measured failure as an absent measurement — and the result still typechecks
 * and still renders. Every assertion here is written as `toBeNull()` /
 * `toBe(0)`, never `toBeFalsy()`, because `expect(0).toBeFalsy()` and
 * `expect(null).toBeFalsy()` both pass and would sail straight through the
 * regression the rule exists to catch.
 *
 * WHY A REAL DATABASE AND NOT A CURATOR STUB. A stub would let the mapper
 * return whatever the stub was told to return, which proves the mapper copies
 * fields and nothing else. The seed below drives the REAL
 * `SkillGapCuratorService` over the REAL stores, so the ranking under
 * assertion is the one a host actually produces: a skill measured at `0`
 * ranking FIRST and an unmeasured skill ranking LAST.
 *
 * WHICH BINDING. `better-sqlite3` in this repo is rebuilt against Electron's
 * ABI by postinstall, so it cannot load in the Jest/Node runner; the opener
 * below falls back to Node's built-in `node:sqlite` — the same engine behind a
 * different binding. The opener is local rather than imported from
 * `skill-synthesis`'s `queue-db.test-support`, because that helper is a
 * deep path into another lib's `src/` and this lib imports its siblings through
 * their barrels only. A SKIPPED run of this file proves nothing, which is why
 * the binding guard below is a plain `it` that FAILS rather than a gated one
 * that goes quiet.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  SKILL_SYNTHESIS_TOKENS,
  SkillCandidateStore,
  SessionVerdictStore,
  SkillSuggestionStore,
  SkillGapCuratorService,
} from '@ptah-extension/skill-synthesis';
import type { SkillSynthesisDigestResult } from '@ptah-extension/shared';
import { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';

const WORKSPACE = '/ws';

/** The subset of the driver surface the stores touch. */
interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = (file: string) => TestDatabase;

/** `better-sqlite3` if it loads, else `node:sqlite`, else `null`. */
function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => TestDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => TestDatabase;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

/** Every bundled migration's base SQL, ascending — the real lineage. */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [...MIGRATIONS].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.sql) db.exec(migration.sql);
  }
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler registered for ${name}`);
      return fn(params);
    },
  };
}

interface Seeded {
  readonly db: TestDatabase;
  readonly candidates: SkillCandidateStore;
  readonly verdicts: SessionVerdictStore;
}

/** The real stores over `db`, plus the real curator wired to them. */
function makeCurator(db: TestDatabase): Seeded & {
  curator: SkillGapCuratorService;
} {
  const connection = { db, vecExtensionLoaded: false, isOpen: true } as never;
  const vecStatus = {
    available: false,
    getStatus: () => ({ available: false, reason: 'binary-missing' }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  } as never;
  const candidates = new SkillCandidateStore(noopLogger, connection, vecStatus);
  const verdicts = new SessionVerdictStore(noopLogger, connection);
  const suggestions = new SkillSuggestionStore(noopLogger, connection);
  return {
    db,
    candidates,
    verdicts,
    curator: new SkillGapCuratorService(
      noopLogger,
      candidates,
      verdicts,
      suggestions,
      // No memory reader: sweep (d) is silent, which is the CLI/e2e host and
      // keeps this seed's ranking a function of the three DB-backed sweeps.
      null,
    ),
  };
}

/** A promoted skill in the library, through the real store path. */
function promoteSkill(
  candidates: SkillCandidateStore,
  name: string,
  description: string,
): void {
  const { candidate } = candidates.registerCandidate({
    name,
    description,
    bodyPath: `/skills/${name}/SKILL.md`,
    sourceSessionIds: [],
    trajectoryHash: `hash-${name}`,
    embedding: null,
    createdAt: 1,
  });
  candidates.updateStatus(candidate.id, 'promoted', { promotedAt: 2 });
}

function invoke(
  candidates: SkillCandidateStore,
  slug: string,
  sessionId: string,
  at: number,
): void {
  candidates.recordSkillEvent({
    skillSlug: slug,
    sessionId,
    workspaceRoot: WORKSPACE,
    contextId: null,
    source: 'tool-use',
    succeeded: true,
    isError: false,
    invokedAt: at,
  });
}

function saveVerdict(
  verdicts: SessionVerdictStore,
  sessionId: string,
  evidenceClass: string | null,
  fields: {
    intent?: string;
    friction?: Array<{
      turnIndex: number;
      kind: 'correction' | 'retry';
      note: string;
    }>;
  } = {},
): void {
  verdicts.save(
    {
      sessionId,
      workspaceRoot: WORKSPACE,
      intent: fields.intent ?? null,
      outcome: null,
      evidenceClass: evidenceClass as never,
      frictionMap: fields.friction ?? [],
      turnCount: 8,
    },
    10,
  );
}

const RESEARCH_DESCRIPTION =
  'Research a library across documentation sources and summarize findings';
const RESEARCH_INTENT =
  'Research the sqlite library documentation and summarize the findings';
const FRICTION_NOTE = 'migration lock timed out during prisma deploy';

/**
 * The seed, and every number in the expected ranking is a consequence of it:
 *
 *  - `deep-research` is invoked once, in a session whose verdict is
 *    `no-correction` — weak evidence of success, so it is neither a win nor
 *    unknown. `wins 0 / measured 1` = a win rate of **exactly `0`**. Its
 *    win-rate item therefore scores `0.2 + (1 - 0) * 0.6 = 0.8` and ranks
 *    FIRST: the worst measured rate is the most worth looking at.
 *  - `deep-research` also fits `s-win-1` (a `tests-green` session whose intent
 *    shares 6 of its 8 content tokens) and was never invoked there — one
 *    missed trigger, scoring `0.55`.
 *  - Two sessions hit the same friction with no success anywhere in the
 *    cluster — a friction opportunity, scoring `0.5`.
 *  - `flaky-formatter` is invoked once in a session with NO verdict row at
 *    all. `measured = 0`, so its win rate is `null` — not `0` — and
 *    `scoreForWinRate(null)` is `0.1`, ranking it LAST.
 *
 * So the digest is `[0.8 win-rate, 0.55 missed-trigger, 0.5 friction,
 * 0.1 win-rate]`, and the two ends of it are the whole rule: measured-and-
 * losing first, never-measured last.
 */
function seed(s: Seeded): void {
  promoteSkill(s.candidates, 'deep-research', RESEARCH_DESCRIPTION);
  promoteSkill(
    s.candidates,
    'flaky-formatter',
    'Format broken yaml manifests when committing',
  );

  // Measured and lost: one invocation, one settled-but-unwon session.
  invoke(s.candidates, 'deep-research', 's-measured-loss', 100);
  saveVerdict(s.verdicts, 's-measured-loss', 'no-correction');

  // Unmeasured: one invocation, no verdict row for its session at all.
  invoke(s.candidates, 'flaky-formatter', 's-no-verdict', 110);

  // A succeeded session `deep-research` fit and never ran in.
  saveVerdict(s.verdicts, 's-win-1', 'tests-green', {
    intent: RESEARCH_INTENT,
  });

  // Two sessions, same friction signature, neither a win.
  for (const sessionId of ['s-fric-1', 's-fric-2']) {
    saveVerdict(s.verdicts, sessionId, 'unverified', {
      intent: 'Deploy the prisma migration',
      friction: [
        { turnIndex: 1, kind: 'retry', note: FRICTION_NOTE },
        { turnIndex: 2, kind: 'correction', note: FRICTION_NOTE },
      ],
    });
  }
}

interface BuildOptions {
  /** Omit the gap curator entirely — a host that never swept. */
  withCurator?: boolean;
  /** Skip seeding, for the empty-library case. */
  withSeed?: boolean;
}

function buildHandlers(db: TestDatabase, opts: BuildOptions = {}) {
  const withCurator = opts.withCurator ?? true;
  const rpcHandler = makeRpcHandler();
  const sentry = { captureException: jest.fn() };

  const seeded = makeCurator(db);
  if (opts.withSeed ?? true) seed(seeded);

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, noopLogger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, {
    readSettings: jest.fn().mockReturnValue({}),
  });
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
    seeded.candidates,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE, {
    getSnapshot: jest.fn(),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, {
    listRecent: jest.fn().mockReturnValue([]),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE, {
    todayStageUsage: jest.fn().mockReturnValue([]),
  });
  if (withCurator) {
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_GAP_CURATOR_SERVICE,
      seeded.curator,
    );
  }
  child.registerInstance(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    createMockWorkspaceProvider({ folders: [WORKSPACE] }),
  );
  child.register(SkillsSynthesisRpcHandlers, {
    useClass: SkillsSynthesisRpcHandlers,
  });

  child.resolve(SkillsSynthesisRpcHandlers).register();

  const call = (params?: unknown) =>
    rpcHandler.call(
      'skillSynthesis:digest',
      params,
    ) as Promise<SkillSynthesisDigestResult>;

  return { call, curator: seeded.curator };
}

describe('skillSynthesis:digest — P4-1', () => {
  it('has a working SQLite binding (this file proves nothing when skipped)', () => {
    // Not a `maybe`. A silently skipped suite is green while asserting
    // nothing, which is precisely the failure mode the null rule cannot
    // afford. If this ever fails, the rest of the file is decoration.
    expect(opener).not.toBeNull();
  });

  maybe('ranks the seeded digest by score, DESCENDING', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db);
      const { items } = await call();

      expect(items.length).toBeGreaterThanOrEqual(4);

      // Stated as a pairwise walk rather than by comparing against a re-sorted
      // copy: `[...items].sort(byScore)` would agree with an ascending result
      // just as happily once both sides were re-sorted the same way.
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i - 1].score).toBeGreaterThanOrEqual(items[i].score);
      }
      // And the ends, so a merely-stable order cannot pass: the measured-and-
      // losing skill is first, the never-measured one is last.
      expect(items[0].kind).toBe('win-rate');
      expect(items[0].evidence.winRate).toBe(0);
      expect(items[items.length - 1].kind).toBe('win-rate');
      expect(items[items.length - 1].evidence.winRate).toBeNull();
      expect(items[0].score).toBeGreaterThan(items[items.length - 1].score);
    } finally {
      db.close();
    }
  });

  maybe(
    'gives every item non-empty evidence.sessionIds and a counts map',
    async () => {
      const db = createDb();
      try {
        const { call } = buildHandlers(db);
        const { items } = await call();

        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(Array.isArray(item.evidence.sessionIds)).toBe(true);
          expect(item.evidence.sessionIds.length).toBeGreaterThan(0);
          for (const sessionId of item.evidence.sessionIds) {
            expect(typeof sessionId).toBe('string');
            expect(sessionId.length).toBeGreaterThan(0);
          }
          expect(Object.keys(item.evidence.counts).length).toBeGreaterThan(0);
          for (const value of Object.values(item.evidence.counts)) {
            expect(typeof value).toBe('number');
          }
        }
      } finally {
        db.close();
      }
    },
  );

  maybe('carries a winRate that is number | null and never NaN', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db);
      const { items } = await call();

      for (const item of items) {
        const rate = item.evidence.winRate;
        if (rate === null) continue;
        expect(typeof rate).toBe('number');
        expect(Number.isNaN(rate)).toBe(false);
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
      // Both values are present in this seed, which is what makes the pair of
      // assertions below meaningful rather than vacuous.
      expect(items.some((i) => i.evidence.winRate === null)).toBe(true);
      expect(items.some((i) => i.evidence.winRate === 0)).toBe(true);
    } finally {
      db.close();
    }
  });

  maybe(
    'keeps null and 0 distinct on the wire — a measured loss is NOT unmeasured',
    async () => {
      const db = createDb();
      try {
        const { call } = buildHandlers(db);
        const { items } = await call();

        const measured = items.find(
          (i) => i.kind === 'win-rate' && i.title.includes('deep-research'),
        );
        const unmeasured = items.find(
          (i) => i.kind === 'win-rate' && i.title.includes('flaky-formatter'),
        );
        if (!measured || !unmeasured) {
          throw new Error('seed did not produce both win-rate items');
        }

        // `toBe(0)` and `toBeNull()`, NEVER `toBeFalsy()` — both values are
        // falsy, so a falsiness check would pass against a mapper that had
        // collapsed one into the other and would prove nothing at all.
        expect(measured.evidence.winRate).toBe(0);
        expect(unmeasured.evidence.winRate).toBeNull();
        expect(unmeasured.evidence.winRate).not.toBe(0);
        // The distinction survives into the ranking too: measured-and-losing
        // outranks never-measured.
        expect(measured.score).toBeGreaterThan(unmeasured.score);
      } finally {
        db.close();
      }
    },
  );

  maybe('honours limit without re-ordering the ranked head', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db);
      const full = await call();
      const clipped = await call({ limit: 2 });

      expect(clipped.items).toHaveLength(2);
      expect(clipped.items.map((i) => i.title)).toEqual(
        full.items.slice(0, 2).map((i) => i.title),
      );
    } finally {
      db.close();
    }
  });

  maybe(
    'treats an explicit empty workspaceRoot as a different request from omitting it',
    async () => {
      const db = createDb();
      try {
        const { call, curator } = buildHandlers(db);
        const spy = jest.spyOn(curator, 'runDigest');

        await call();
        expect(spy).toHaveBeenLastCalledWith(
          expect.objectContaining({ workspaceRoot: WORKSPACE }),
        );

        // `''` is the cross-project feed. A `||` on this path would forward the
        // host's workspace instead and silently widen nothing / narrow nothing
        // visibly — the caller would simply never reach the feed it asked for.
        await call({ workspaceRoot: '' });
        expect(spy).toHaveBeenLastCalledWith(
          expect.objectContaining({ workspaceRoot: '' }),
        );
      } finally {
        db.close();
      }
    },
  );

  maybe('returns an empty digest on a host with no curator', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db, { withCurator: false });
      await expect(call()).resolves.toEqual({ items: [] });
    } finally {
      db.close();
    }
  });

  maybe('returns an empty digest against an unseeded library', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db, { withSeed: false });
      const { items } = await call();
      expect(items).toEqual([]);
    } finally {
      db.close();
    }
  });

  /**
   * B4.8 — `allowRewrite` is forwarded, never defaulted, and never coerced.
   *
   * The digest sweep can author its description rewrite on an LLM lane, and
   * NOTHING budgets that call: `digest` is in `TOKEN_SPENDING_STAGES` but has
   * no registered queue handler and no producer, so the drain's daily token
   * gate never sees a digest item, and this RPC is the only way `runDigest` is
   * reached. The panel calls this RPC automatically, so "omitted spends
   * nothing" is a money rule rather than an ergonomic one.
   *
   * These tests assert what this handler PASSES DOWN, not what the curator then
   * does with it. The curator's own spec owns "a `false` makes zero lane calls";
   * duplicating that here would test the same behaviour twice and neither test
   * would notice the handler quietly inserting a default of its own.
   */
  describe('allowRewrite — the flag that decides whether the sweep spends', () => {
    maybe(
      'forwards the flag UNSET when the caller omitted it, rather than defaulting here',
      async () => {
        // `undefined`, not `false`. The default deliberately lives in
        // `runDigest`, so it protects every caller of that method rather than
        // only the ones that arrive through this RPC. A `?? false` here would
        // look like the safer code and would in fact move the guard to the one
        // place a future non-RPC caller cannot inherit it from.
        const db = createDb();
        try {
          const { call, curator } = buildHandlers(db);
          const spy = jest.spyOn(curator, 'runDigest');

          await call();

          expect(spy).toHaveBeenLastCalledWith(
            expect.objectContaining({ allowRewrite: undefined }),
          );
          // Stated twice on purpose: `objectContaining({x: undefined})` also
          // matches an object with no `x` at all, so on its own it could not
          // tell a forwarded `undefined` from a forwarded `true`.
          expect(spy.mock.calls[0][0].allowRewrite).not.toBe(true);
        } finally {
          db.close();
        }
      },
    );

    maybe.each([true, false] as const)(
      'forwards an explicit %s verbatim',
      async (allowRewrite: boolean) => {
        const db = createDb();
        try {
          const { call, curator } = buildHandlers(db);
          const spy = jest.spyOn(curator, 'runDigest');

          await call({ allowRewrite });

          expect(spy).toHaveBeenLastCalledWith(
            expect.objectContaining({ allowRewrite }),
          );
        } finally {
          db.close();
        }
      },
    );

    maybe('rejects a non-boolean rather than coercing it', async () => {
      // `z.coerce.boolean()` maps the STRING `'false'` to `true`, which on this
      // field is the difference between a read and an unbudgeted LLM call. The
      // schema uses a plain `z.boolean()` for exactly that reason, and this is
      // the assertion that keeps someone from "fixing" a stringly-typed caller
      // by adding the coercion.
      const db = createDb();
      try {
        const { call } = buildHandlers(db);
        await expect(call({ allowRewrite: 'false' })).rejects.toBeInstanceOf(
          RpcUserError,
        );
        await expect(call({ allowRewrite: 1 })).rejects.toBeInstanceOf(
          RpcUserError,
        );
      } finally {
        db.close();
      }
    });
  });

  maybe('rejects an out-of-range limit at the boundary', async () => {
    const db = createDb();
    try {
      const { call } = buildHandlers(db);
      await expect(call({ limit: 0 })).rejects.toBeInstanceOf(RpcUserError);
      await expect(call({ limit: 5000 })).rejects.toBeInstanceOf(RpcUserError);
    } finally {
      db.close();
    }
  });
});
