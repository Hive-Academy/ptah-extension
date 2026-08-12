/**
 * P0-6 (store half) — the daily budget ledger, and the UTC rollover.
 *
 * The rollover assertions use timestamps chosen so a local-time key would give
 * a DIFFERENT answer than a UTC one on this machine, which is the only way the
 * test can actually fail if someone swaps `toISOString()` for a locale-aware
 * formatter.
 */
import 'reflect-metadata';
import { SkillBudgetStore, utcDayKey } from './skill-budget.store';
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
  });

  it('creates the day row on the first record', () => {
    store.record(
      { inputTokens: 1_000, outputTokens: 250, costUsd: 0.02 },
      UTC_MIDNIGHT,
    );

    expect(store.todayUsage(UTC_MIDNIGHT)).toEqual({
      dayKey: '2026-08-13',
      inputTokens: 1_000,
      outputTokens: 250,
      costUsd: 0.02,
      updatedAt: UTC_MIDNIGHT,
    });
  });

  it('accumulates every later record onto the same day', () => {
    store.record({ inputTokens: 1_000, costUsd: 0.01 }, UTC_MIDNIGHT);
    store.record({ outputTokens: 400 }, UTC_MIDNIGHT + 60_000);
    store.record(
      { inputTokens: 500, outputTokens: 100, costUsd: 0.03 },
      UTC_MIDNIGHT + 120_000,
    );

    expect(store.todayUsage(UTC_MIDNIGHT)).toMatchObject({
      inputTokens: 1_500,
      outputTokens: 500,
      updatedAt: UTC_MIDNIGHT + 120_000,
    });
    expect(store.todayUsage(UTC_MIDNIGHT).costUsd).toBeCloseTo(0.04, 10);
    expect(countDays(db)).toBe(1);
  });

  it('sums input AND output into the number the drain gates on', () => {
    store.record({ inputTokens: 1_200, outputTokens: 800 }, UTC_MIDNIGHT);
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(2_000);
  });

  it('rolls over at UTC midnight — the new day starts at zero', () => {
    store.record({ inputTokens: 2_000_000 }, JUST_BEFORE_UTC_MIDNIGHT);

    expect(store.spentToday(JUST_BEFORE_UTC_MIDNIGHT)).toBe(2_000_000);
    // One millisecond later, a different day key, an empty budget.
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);

    store.record({ inputTokens: 5 }, UTC_MIDNIGHT);
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(5);
    // Yesterday's ledger is untouched — it is history, not a rolling window.
    expect(store.spentToday(JUST_BEFORE_UTC_MIDNIGHT)).toBe(2_000_000);
    expect(countDays(db)).toBe(2);
  });

  it('treats an absent usage field as zero, not as NaN', () => {
    store.record({}, UTC_MIDNIGHT);
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);
    store.record({ costUsd: 0.5 }, UTC_MIDNIGHT);
    expect(store.spentToday(UTC_MIDNIGHT)).toBe(0);
    expect(store.todayUsage(UTC_MIDNIGHT).costUsd).toBeCloseTo(0.5, 10);
  });
});

function countDays(db: TestDatabase): number {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM skill_synthesis_budget')
    .get() as { cnt: number };
  return Number(row.cnt);
}
