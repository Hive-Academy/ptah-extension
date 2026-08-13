/**
 * P0-6 (store half) — the daily budget ledger, the UTC rollover, and the
 * per-stage split B0.8 added on top of both.
 *
 * The rollover assertions use timestamps chosen so a local-time key would give
 * a DIFFERENT answer than a UTC one on this machine, which is the only way the
 * test can actually fail if someone swaps `toISOString()` for a locale-aware
 * formatter.
 *
 * The B0.8 half exists to pin ONE property above all others: **`spentToday()`
 * still means the day total.** B0.4's budget gate compares it against
 * `skillSynthesis.budget.maxTokensPerDay`, so a per-stage ledger that quietly
 * narrowed it would move the point at which the drain stops spending without a
 * single line of the drain changing. Every stage-split test below therefore
 * re-asserts the day figure beside the per-stage one.
 */
import 'reflect-metadata';
import {
  SkillBudgetStore,
  utcDayKey,
  type SkillBudgetStage,
} from './skill-budget.store';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';

/** 2026-08-12T23:59:59.999Z — still "yesterday" in every timezone west of UTC. */
const JUST_BEFORE_UTC_MIDNIGHT = Date.UTC(2026, 7, 12, 23, 59, 59, 999);
/** 2026-08-13T00:00:00.000Z — the rollover instant. */
const UTC_MIDNIGHT = Date.UTC(2026, 7, 13, 0, 0, 0, 0);

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

describe('utcDayKey', () => {
  it('keys on the UTC calendar day, not the host timezone', () => {
    expect(utcDayKey(JUST_BEFORE_UTC_MIDNIGHT)).toBe('2026-08-12');
    expect(utcDayKey(UTC_MIDNIGHT)).toBe('2026-08-13');
  });

  it('is stable across host timezones', () => {
    // Machines at UTC+13 and UTC-8 are on different calendar days at this
    // instant. The key is derived from `toISOString`, which is UTC by
    // definition, so both agree — a locale-aware formatter would not.
    expect(utcDayKey(JUST_BEFORE_UTC_MIDNIGHT)).toBe(
      new Date(JUST_BEFORE_UTC_MIDNIGHT).toISOString().slice(0, 10),
    );
  });
});

maybe('SkillBudgetStore', () => {
  let db: TestDatabase;
  let store: SkillBudgetStore;

  beforeEach(() => {
    db = openQueueDb(opener as NonNullable<typeof opener>, makeTempDbPath());
    store = new SkillBudgetStore(noopLogger, asConnection(db));
  });

  afterEach(() => db.close());

  it('reports zero spend for a day with no row', () => {
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);
    expect(store.todayUsage(UTC_MIDNIGHT)).toEqual({
      dayKey: '2026-08-13',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      updatedAt: 0,
    });
    expect(store.todayStageUsage(UTC_MIDNIGHT)).toEqual([]);
  });

  it('creates the day row on the first record', () => {
    store.record(
      { inputTokens: 1_000, outputTokens: 250, costUsd: 0.02 },
      { now: UTC_MIDNIGHT },
    );

    expect(store.todayUsage(UTC_MIDNIGHT)).toEqual({
      dayKey: '2026-08-13',
      inputTokens: 1_000,
      outputTokens: 250,
      costUsd: 0.02,
      updatedAt: UTC_MIDNIGHT,
    });
  });

  it('accumulates every later record onto the same day and stage', () => {
    store.record({ inputTokens: 1_000, costUsd: 0.01 }, { now: UTC_MIDNIGHT });
    store.record({ outputTokens: 400 }, { now: UTC_MIDNIGHT + 60_000 });
    store.record(
      { inputTokens: 500, outputTokens: 100, costUsd: 0.03 },
      { now: UTC_MIDNIGHT + 120_000 },
    );

    expect(store.todayUsage(UTC_MIDNIGHT)).toMatchObject({
      inputTokens: 1_500,
      outputTokens: 500,
      updatedAt: UTC_MIDNIGHT + 120_000,
    });
    expect(store.todayUsage(UTC_MIDNIGHT).costUsd).toBeCloseTo(0.04, 10);
    expect(countRows(db)).toBe(1);
  });

  it('sums input AND output into the number the drain gates on', () => {
    store.record(
      { inputTokens: 1_200, outputTokens: 800 },
      { now: UTC_MIDNIGHT },
    );
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(2_000);
  });

  it('rolls over at UTC midnight — the new day starts at zero', () => {
    store.record({ inputTokens: 2_000_000 }, { now: JUST_BEFORE_UTC_MIDNIGHT });

    expect(store.spentToday(JUST_BEFORE_UTC_MIDNIGHT)).toBe(2_000_000);
    // One millisecond later, a different day key, an empty budget.
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);

    store.record({ inputTokens: 5 }, { now: UTC_MIDNIGHT });
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(5);
    // Yesterday's ledger is untouched — it is history, not a rolling window.
    expect(store.spentToday(JUST_BEFORE_UTC_MIDNIGHT)).toBe(2_000_000);
    expect(countRows(db)).toBe(2);
  });

  it('rolls over per stage as well as per day', () => {
    // The rollover is keyed on the DAY half of the composite key, so adding
    // stages must not let yesterday's judge spend leak into today's.
    store.record(
      { inputTokens: 900 },
      { stage: 'judge', now: JUST_BEFORE_UTC_MIDNIGHT },
    );
    store.record({ inputTokens: 4 }, { stage: 'judge', now: UTC_MIDNIGHT });

    expect(totalFor(store, 'judge', UTC_MIDNIGHT)).toBe(4);
    expect(totalFor(store, 'judge', JUST_BEFORE_UTC_MIDNIGHT)).toBe(900);
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(4);
  });

  it('treats an absent usage field as zero, not as NaN', () => {
    store.record({}, { now: UTC_MIDNIGHT });
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);
    store.record({ costUsd: 0.5 }, { now: UTC_MIDNIGHT });
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);
    expect(store.todayUsage(UTC_MIDNIGHT).costUsd).toBeCloseTo(0.5, 10);
  });

  // ── the per-stage split (B0.8) ────────────────────────────────────────────

  it('books an unattributed record to the empty stage', () => {
    store.record({ inputTokens: 10, outputTokens: 5 }, { now: UTC_MIDNIGHT });

    expect(store.todayStageUsage(UTC_MIDNIGHT)).toEqual([
      {
        dayKey: '2026-08-13',
        stage: '',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0,
        updatedAt: UTC_MIDNIGHT,
      },
    ]);
  });

  it('keeps one row per stage for a single day', () => {
    store.record({ inputTokens: 100 }, { stage: 'judge', now: UTC_MIDNIGHT });
    store.record(
      { inputTokens: 700, outputTokens: 300 },
      { stage: 'synthesis', now: UTC_MIDNIGHT },
    );
    store.record({ inputTokens: 50 }, { stage: 'judge', now: UTC_MIDNIGHT });

    expect(countRows(db)).toBe(2);
    expect(
      store.todayStageUsage(UTC_MIDNIGHT).map((e) => [e.stage, e.totalTokens]),
    ).toEqual([
      ['synthesis', 1_000],
      ['judge', 150],
    ]);
  });

  /**
   * THE property B0.4 depends on. The gate calls `spentToday`; splitting the
   * ledger must not change the number it trips on.
   */
  it('leaves spentToday as the day total across every stage', () => {
    store.record(
      { inputTokens: 600, outputTokens: 400 },
      { stage: 'archaeology', now: UTC_MIDNIGHT },
    );
    store.record(
      { inputTokens: 300, outputTokens: 200 },
      { stage: 'judge', now: UTC_MIDNIGHT },
    );
    // Spend from outside a drain stage counts against the same cap.
    store.record(
      { inputTokens: 400, outputTokens: 100 },
      { now: UTC_MIDNIGHT },
    );

    expect(store.spentToday(UTC_MIDNIGHT)).toBe(2_000);
    // And it is exactly the sum of the per-stage entries — the Activity strip
    // can never show less than what the cap is counting.
    const perStage = store
      .todayStageUsage(UTC_MIDNIGHT)
      .reduce((sum, e) => sum + e.totalTokens, 0);
    expect(perStage).toBe(store.spentToday(UTC_MIDNIGHT));
    expect(store.todayUsage(UTC_MIDNIGHT)).toMatchObject({
      inputTokens: 1_300,
      outputTokens: 700,
    });
  });

  it('orders the per-stage ledger heaviest first', () => {
    store.record({ inputTokens: 1 }, { stage: 'digest', now: UTC_MIDNIGHT });
    store.record({ inputTokens: 900 }, { stage: 'replay', now: UTC_MIDNIGHT });
    store.record({ inputTokens: 40 }, { stage: 'judge', now: UTC_MIDNIGHT });

    expect(store.todayStageUsage(UTC_MIDNIGHT).map((e) => e.stage)).toEqual([
      'replay',
      'judge',
      'digest',
    ]);
  });

  it('rejects a stage that is not a queue stage', () => {
    // `0035` carries no CHECK, so this union is the only enforcement there is.
    expect(() =>
      store.record(
        { inputTokens: 1 },
        { stage: 'archaeologist' as unknown as SkillBudgetStage },
      ),
    ).toThrow(/not a queue stage/);
    expect(countRows(db)).toBe(0);
  });

  it('counts an unrecognised stored stage as unattributed rather than dropping it', () => {
    // A row written by a future build. Dropping it would make the per-stage
    // entries sum to less than `spentToday`, which is the one property the
    // Activity strip is read against.
    db.prepare(
      `INSERT INTO skill_synthesis_budget
         (day_key, stage, input_tokens, output_tokens, cost_usd, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('2026-08-13', 'from-the-future', 70, 30, 0, UTC_MIDNIGHT);
    store.record({ inputTokens: 10 }, { now: UTC_MIDNIGHT });

    const entries = store.todayStageUsage(UTC_MIDNIGHT);
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe('');
    expect(entries[0].totalTokens).toBe(110);
    expect(entries[0].totalTokens).toBe(store.spentToday(UTC_MIDNIGHT));
  });

  // ── the attribution scope the drain opens ─────────────────────────────────

  it('books a record made inside withStage to that stage', () => {
    store.withStage('embedding', () => {
      store.record({ inputTokens: 12 }, { now: UTC_MIDNIGHT });
    });

    expect(store.todayStageUsage(UTC_MIDNIGHT).map((e) => e.stage)).toEqual([
      'embedding',
    ]);
  });

  it('follows the await chain, so a stage that awaits is still attributed', async () => {
    // This is why the carrier is AsyncLocalStorage and not a field: the ledger
    // write happens after the LLM call resolves, several frames below the
    // drain, and by then a field would already have been overwritten.
    await store.withStage('synthesis', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      store.record({ inputTokens: 5, outputTokens: 5 }, { now: UTC_MIDNIGHT });
    });

    expect(totalFor(store, 'synthesis', UTC_MIDNIGHT)).toBe(10);
  });

  it('keeps two overlapping scopes from stealing each other s spend', async () => {
    // Two cron tiers can be mid-await at the same time. A mutable field would
    // cross-attribute here; an async-context store cannot.
    const judge = store.withStage('judge', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      store.record({ inputTokens: 100 }, { now: UTC_MIDNIGHT });
    });
    const replay = store.withStage('replay', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      store.record({ inputTokens: 7 }, { now: UTC_MIDNIGHT });
    });
    await Promise.all([judge, replay]);

    expect(totalFor(store, 'judge', UTC_MIDNIGHT)).toBe(100);
    expect(totalFor(store, 'replay', UTC_MIDNIGHT)).toBe(7);
  });

  it('lets an explicit stage override the ambient one', () => {
    store.withStage('judge', () => {
      store.record({ inputTokens: 3 }, { stage: 'digest', now: UTC_MIDNIGHT });
    });

    expect(totalFor(store, 'digest', UTC_MIDNIGHT)).toBe(3);
    expect(totalFor(store, 'judge', UTC_MIDNIGHT)).toBe(0);
  });

  it('reports the unattributed stage outside any scope', () => {
    expect(store.currentStage()).toBe('');
    store.withStage('clustering', () => {
      expect(store.currentStage()).toBe('clustering');
    });
    expect(store.currentStage()).toBe('');
  });

  it('returns whatever the scoped function returns', () => {
    expect(store.withStage('prefilter', () => 42)).toBe(42);
  });
});

function countRows(db: TestDatabase): number {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM skill_synthesis_budget')
    .get() as { cnt: number };
  return Number(row.cnt);
}

function totalFor(
  store: SkillBudgetStore,
  stage: SkillBudgetStage,
  now: number,
): number {
  return (
    store.todayStageUsage(now).find((e) => e.stage === stage)?.totalTokens ?? 0
  );
}
