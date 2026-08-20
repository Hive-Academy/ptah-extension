import { LIVE_STATES } from '@ptah-contracts/community';

import {
  LIVE_FALLBACK_MINUTES,
  LIVE_FALLBACK_MS,
  deriveLiveState,
  effectiveEnd,
} from './live-feed-state';

/**
 * RISK-W — `state` over the FULL CROSS-PRODUCT of its inputs.
 *
 * Three states, two nullable inputs and a clock. `tasks.md` asks for a
 * table-driven spec over
 * (`endsAt` null/set) × (`hasReplay` false/true) × (before/during/after),
 * which is twelve rows; they are enumerated below as DATA rather than as twelve
 * `it` blocks, so a missing combination is visible as a gap in the table instead
 * of as a test nobody wrote.
 *
 * ⚠️ THE BOUNDARIES ARE ASSERTED AT THE EXACT MILLISECOND, separately. A table
 * that only samples "well before" and "well after" passes against a `<=` where a
 * `<` was meant, and off-by-one on the live indicator is precisely the defect a
 * member notices.
 */

const START = new Date('2026-08-08T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const END = new Date(START.getTime() + HOUR);

/** Every row of the cross-product, as data. */
interface Row {
  readonly endsAt: Date | null;
  readonly hasReplay: boolean;
  readonly when: 'before' | 'during' | 'after';
  readonly expected: 'upcoming' | 'live' | 'replay' | null;
}

/**
 * `after` is chosen relative to the row's own end: one hour past a real
 * `endsAt`, and one hour past the fallback window when `endsAt` is null. A
 * single fixed "after" instant would sit INSIDE the two-hour fallback window and
 * the null-`endsAt` rows would silently be testing `during` twice.
 */
function nowFor(row: Row): Date {
  switch (row.when) {
    case 'before':
      return new Date(START.getTime() - HOUR);
    case 'during':
      return new Date(START.getTime() + HOUR / 2);
    case 'after':
      return new Date(effectiveEnd(START, row.endsAt).getTime() + HOUR);
  }
}

const TABLE: readonly Row[] = [
  // ── endsAt SET ─────────────────────────────────────────────────────────
  { endsAt: END, hasReplay: false, when: 'before', expected: 'upcoming' },
  { endsAt: END, hasReplay: false, when: 'during', expected: 'live' },
  // 🔴 The row the contract is explicit about: over, nothing to replay ⇒ the
  // item DROPS OUT of the feed rather than appearing as an empty 'replay'.
  { endsAt: END, hasReplay: false, when: 'after', expected: null },
  { endsAt: END, hasReplay: true, when: 'before', expected: 'upcoming' },
  { endsAt: END, hasReplay: true, when: 'during', expected: 'live' },
  { endsAt: END, hasReplay: true, when: 'after', expected: 'replay' },
  // ── endsAt NULL ────────────────────────────────────────────────────────
  // 🔴 The RISK-W rows. A naive `startsAt < now < endsAt` makes every one of
  // these 'upcoming' or dropped, and a session that is actually streaming right
  // now never shows a live indicator.
  { endsAt: null, hasReplay: false, when: 'before', expected: 'upcoming' },
  { endsAt: null, hasReplay: false, when: 'during', expected: 'live' },
  { endsAt: null, hasReplay: false, when: 'after', expected: null },
  { endsAt: null, hasReplay: true, when: 'before', expected: 'upcoming' },
  { endsAt: null, hasReplay: true, when: 'during', expected: 'live' },
  { endsAt: null, hasReplay: true, when: 'after', expected: 'replay' },
];

const describeRow = (row: Row): string =>
  `endsAt=${row.endsAt ? 'set' : 'null'} replay=${row.hasReplay} ${row.when}`;

describe('deriveLiveState — RISK-W', () => {
  describe('the full cross-product, as a table', () => {
    it.each(TABLE.map((row) => [describeRow(row), row] as const))(
      '%s',
      (_label, row) => {
        expect(
          deriveLiveState(
            { startsAt: START, endsAt: row.endsAt, hasReplay: row.hasReplay },
            nowFor(row),
          ),
        ).toBe(row.expected);
      },
    );

    it('covers all twelve combinations, with no duplicate row', () => {
      // The table IS the coverage claim, so its completeness is asserted rather
      // than counted by eye. A combination missing from it would otherwise look
      // exactly like a combination that passes.
      const keys = TABLE.map(
        (row) => `${row.endsAt === null}|${row.hasReplay}|${row.when}`,
      );
      expect(new Set(keys).size).toBe(12);
      expect(keys).toHaveLength(12);
    });

    it('produces every declared LiveState, plus the null drop', () => {
      // Anti-vacuity: if the derivation collapsed to one answer the table would
      // still be twelve green rows against twelve identical expectations.
      const produced = new Set(
        TABLE.map((row) =>
          deriveLiveState(
            { startsAt: START, endsAt: row.endsAt, hasReplay: row.hasReplay },
            nowFor(row),
          ),
        ),
      );
      // Every value the contract declares is actually produced by the table…
      for (const state of LIVE_STATES) {
        expect(produced).toContain(state);
      }
      // …and so is the drop, which is the fourth outcome and not a state.
      expect(produced.has(null)).toBe(true);
      expect(produced.size).toBe(LIVE_STATES.length + 1);
      expect(TABLE.filter((row) => row.expected === null)).toHaveLength(2);
    });
  });

  describe('the boundaries, to the millisecond', () => {
    it('is LIVE at exactly startsAt — not "starts in 0 minutes"', () => {
      expect(
        deriveLiveState(
          { startsAt: START, endsAt: END, hasReplay: false },
          START,
        ),
      ).toBe('live');
    });

    it('is UPCOMING one millisecond before startsAt', () => {
      expect(
        deriveLiveState(
          { startsAt: START, endsAt: END, hasReplay: false },
          new Date(START.getTime() - 1),
        ),
      ).toBe('upcoming');
    });

    it('is LIVE one millisecond before endsAt, replay or not', () => {
      // At `endsAt - 1ms` the session has NOT ended, so the replay id is
      // irrelevant — asserted for both, because a derivation that consulted
      // `hasReplay` too early would pass the single-fixture version of this.
      for (const hasReplay of [false, true]) {
        expect(
          deriveLiveState(
            { startsAt: START, endsAt: END, hasReplay },
            new Date(END.getTime() - 1),
          ),
        ).toBe('live');
      }
    });

    it('has ENDED at exactly endsAt — the end instant is not still live', () => {
      expect(
        deriveLiveState({ startsAt: START, endsAt: END, hasReplay: true }, END),
      ).toBe('replay');
      expect(
        deriveLiveState(
          { startsAt: START, endsAt: END, hasReplay: false },
          END,
        ),
      ).toBeNull();
    });

    it('with a null endsAt, is live for exactly LIVE_FALLBACK_MINUTES', () => {
      const input = { startsAt: START, endsAt: null, hasReplay: true };
      const lastLiveInstant = new Date(START.getTime() + LIVE_FALLBACK_MS - 1);
      const firstEndedInstant = new Date(START.getTime() + LIVE_FALLBACK_MS);

      expect(deriveLiveState(input, lastLiveInstant)).toBe('live');
      expect(deriveLiveState(input, firstEndedInstant)).toBe('replay');
    });
  });

  describe('effectiveEnd — the arithmetic the Postgres `where` is written against', () => {
    it('is endsAt when there is one', () => {
      expect(effectiveEnd(START, END)).toEqual(END);
    });

    it('is startsAt + LIVE_FALLBACK_MS when there is not', () => {
      expect(effectiveEnd(START, null)).toEqual(
        new Date(START.getTime() + LIVE_FALLBACK_MS),
      );
    });

    it('LIVE_FALLBACK_MS is derived from LIVE_FALLBACK_MINUTES, not re-typed', () => {
      // Two independently written numbers is how the classifier and the query
      // come to disagree about which sessions are still running.
      expect(LIVE_FALLBACK_MS).toBe(LIVE_FALLBACK_MINUTES * 60 * 1000);
      expect(LIVE_FALLBACK_MINUTES).toBeGreaterThan(0);
    });
  });

  describe('purity — `now` is a parameter, never a clock read', () => {
    it('answers identically for the same inputs across a real event-loop turn', async () => {
      // 🔴 THE PROPERTY RISK-W IS ABOUT. If the function read the clock
      // internally, two calls straddling a boundary could disagree — which is
      // how one session becomes 'live' in `upcoming` and 'replay' in `replays`
      // on the same screen.
      const input = { startsAt: START, endsAt: END, hasReplay: true };
      const now = new Date(END.getTime() - 5);

      const first = deriveLiveState(input, now);
      await new Promise((resolve) => setImmediate(resolve));
      const second = deriveLiveState(input, now);

      expect(first).toBe('live');
      expect(second).toBe(first);
    });

    it('moves the answer when — and only when — `now` moves', () => {
      const input = { startsAt: START, endsAt: END, hasReplay: true };
      expect(deriveLiveState(input, new Date(START.getTime() - 1))).toBe(
        'upcoming',
      );
      expect(deriveLiveState(input, START)).toBe('live');
      expect(deriveLiveState(input, END)).toBe('replay');
    });
  });
});
