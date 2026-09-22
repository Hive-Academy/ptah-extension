/**
 * Budget tests — TASK_2026_493_9f58 deliverable 2 and `context.md` "Budgets".
 *
 * One test per limit, in the shape the task fixes: a spec EXACTLY at the limit
 * is accepted and a spec one step ABOVE it is rejected. The at-limit half is
 * the half that catches the real defect — an off-by-one that rejects a legal
 * spec is invisible to an "over the limit is rejected" test on its own.
 *
 * The numbers are read from `DASHBOARD_LIMITS`, never retyped, so confirming a
 * provisional budget in TASK_2026_494 does not require editing this file.
 */

import {
  dashboardJsonBytes,
  makeChart,
  makeDashboardSpec,
  makeDashboardSpecOfExactBytes,
  makeList,
  makeNestedStats,
  makeStatPairs,
  makeTable,
} from '../testing/fixtures/dashboard-spec';
import { DASHBOARD_LIMITS } from './dashboard-catalog';
import {
  countDashboardComponents,
  dashboardTreeDepth,
} from './dashboard-spec.schemas';
import { validateDashboardSpec } from './dashboard-spec.validator';

const validate = (spec: unknown) =>
  validateDashboardSpec(spec, dashboardJsonBytes);

describe('dashboard budgets — at the limit passes, above it is rejected', () => {
  describe('component count', () => {
    const limit = DASHBOARD_LIMITS.maxComponents;

    it(`accepts a tree of exactly ${limit} components`, () => {
      const components = makeStatPairs(limit);
      expect(countDashboardComponents(components)).toBe(limit);

      expect(validate(makeDashboardSpec({ components })).ok).toBe(true);
    });

    it(`rejects a tree of ${limit + 1} components`, () => {
      const components = makeStatPairs(limit + 1);
      expect(countDashboardComponents(components)).toBe(limit + 1);

      const result = validate(makeDashboardSpec({ components }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain(
        `over the ${limit} limit`,
      );
    });
  });

  describe('tree depth', () => {
    const limit = DASHBOARD_LIMITS.maxTreeDepth;

    it(`accepts a tree exactly ${limit} levels deep`, () => {
      const components = makeNestedStats(limit);
      expect(dashboardTreeDepth(components)).toBe(limit);

      expect(validate(makeDashboardSpec({ components })).ok).toBe(true);
    });

    it(`rejects a tree ${limit + 1} levels deep`, () => {
      const components = makeNestedStats(limit + 1);
      expect(dashboardTreeDepth(components)).toBe(limit + 1);

      const result = validate(makeDashboardSpec({ components }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('levels deep');
    });
  });

  describe('string length', () => {
    const limit = DASHBOARD_LIMITS.maxStringLength;

    it(`accepts a string of exactly ${limit} characters`, () => {
      const spec = makeDashboardSpec({ title: { text: 'x'.repeat(limit) } });

      expect(validate(spec).ok).toBe(true);
    });

    it(`rejects a string of ${limit + 1} characters`, () => {
      const spec = makeDashboardSpec({
        title: { text: 'x'.repeat(limit + 1) },
      });

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('title.text');
    });
  });

  describe('table rows', () => {
    const limit = DASHBOARD_LIMITS.maxTableRows;

    it(`accepts a table of exactly ${limit} rows`, () => {
      const spec = makeDashboardSpec({ components: [makeTable(limit, 2)] });

      expect(validate(spec).ok).toBe(true);
    });

    it(`rejects a table of ${limit + 1} rows`, () => {
      const spec = makeDashboardSpec({ components: [makeTable(limit + 1, 2)] });

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('rows');
    });
  });

  describe('table columns', () => {
    const limit = DASHBOARD_LIMITS.maxTableColumns;

    it(`accepts a table of exactly ${limit} columns`, () => {
      const spec = makeDashboardSpec({ components: [makeTable(1, limit)] });

      expect(validate(spec).ok).toBe(true);
    });

    it(`rejects a table of ${limit + 1} columns`, () => {
      const spec = makeDashboardSpec({ components: [makeTable(1, limit + 1)] });

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('columns');
    });
  });

  describe('series points', () => {
    const limit = DASHBOARD_LIMITS.maxSeriesPoints;
    // Split across two series on purpose: the budget is per CHART, so a spec
    // that stays under the per-series array cap while doubling the chart's
    // total is the case a naive `z.array().max()` would wave through.
    const half = Math.floor(limit / 2);

    it(`accepts a chart carrying exactly ${limit} points across its series`, () => {
      const spec = makeDashboardSpec({
        components: [makeChart([half, limit - half])],
      });

      expect(validate(spec).ok).toBe(true);
    });

    it(`rejects a chart carrying ${limit + 1} points across its series`, () => {
      const spec = makeDashboardSpec({
        components: [makeChart([half, limit - half + 1])],
      });

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain(
        `over the ${limit} limit`,
      );
    });
  });

  describe('total UTF-8 bytes', () => {
    const limit = DASHBOARD_LIMITS.maxSpecBytes;

    it(`accepts a spec of exactly ${limit} UTF-8 bytes`, () => {
      const spec = makeDashboardSpecOfExactBytes(limit);
      expect(dashboardJsonBytes(spec)).toBe(limit);

      const result = validate(spec);
      expect(result.ok).toBe(true);
      expect(result.bytes).toBe(limit);
    });

    it(`rejects a spec of ${limit + 1} UTF-8 bytes`, () => {
      const spec = makeDashboardSpecOfExactBytes(limit + 1);
      expect(dashboardJsonBytes(spec)).toBe(limit + 1);

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain(
        `over the ${limit} byte limit`,
      );
    });

    it('counts multi-byte characters as their UTF-8 length, not their JS length', () => {
      // The check must not be `JSON.stringify(...).length`. An emoji is 2 UTF-16
      // code units but 4 UTF-8 bytes, so a string-length check would let a spec
      // through at roughly double the intended size.
      const wide = '😀'.repeat(400);
      const spec = makeDashboardSpec({ components: [makeList([wide])] });

      expect(dashboardJsonBytes(spec)).toBeGreaterThan(
        JSON.stringify(spec).length,
      );
      expect(validate(spec).bytes).toBe(dashboardJsonBytes(spec));
    });
  });

  describe('string length applies to every string, including the timestamp', () => {
    const limit = DASHBOARD_LIMITS.maxStringLength;

    // Revision 1, finding 4. `z.iso.datetime({ offset: true })` had no `.max()`,
    // and ISO 8601 allows fractional seconds of arbitrary length, so a 2,022-
    // character timestamp was ACCEPTED: inside the byte budget, over the one
    // string budget, and passed straight to the text fallback.
    const isoOfLength = (length: number): string => {
      const prefix = '2026-09-22T00:00:00.';
      return `${prefix}${'1'.repeat(length - prefix.length - 1)}Z`;
    };

    it(`accepts a generatedAt of exactly ${limit} characters`, () => {
      const generatedAt = isoOfLength(limit);
      expect(generatedAt).toHaveLength(limit);

      expect(validate(makeDashboardSpec({ generatedAt })).ok).toBe(true);
    });

    it(`rejects a generatedAt of ${limit + 1} characters`, () => {
      const generatedAt = isoOfLength(limit + 1);
      expect(generatedAt).toHaveLength(limit + 1);

      const result = validate(makeDashboardSpec({ generatedAt }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('generatedAt');
    });
  });

  describe('a pathological tree is rejected, never thrown (revision 1, finding 3)', () => {
    /** A stat chain `depth` levels deep, as raw JSON. */
    const deepChain = (depth: number): unknown => {
      let node: Record<string, unknown> = { id: 's', kind: 'stat', value: 1 };
      for (let level = 1; level <= depth; level++) {
        node = { id: `s${level}`, kind: 'stat', value: 1, children: [node] };
      }
      return { ...makeDashboardSpec(), components: [node] };
    };

    it.each([9, 200, 999])(
      'returns a rejection for a tree %i levels deep instead of throwing',
      (depth) => {
        const spec = deepChain(depth);
        // Well inside the byte budget — that is the whole point of the finding:
        // 999 levels is 51,072 bytes against a 262,144 byte cap, so the byte
        // check cannot be what saves us. Before the fix, 9 and 200 rejected
        // and 999 threw `RangeError: Maximum call stack size exceeded`.
        expect(dashboardJsonBytes(spec)).toBeLessThan(
          DASHBOARD_LIMITS.maxSpecBytes,
        );

        const result = validate(spec);
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.reason).toContain('levels deep');
      },
    );

    it('returns a rejection for a tree so deep that measuring it overflows too', () => {
      // At 5,000 levels even `JSON.stringify` overflows, so the byte counter
      // throws before the structural walk runs and only the outer catch can
      // answer. Any rejection is correct here; an exception is not.
      const spec = deepChain(5_000);
      expect(() => dashboardJsonBytes(spec)).toThrow(RangeError);

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason.length).toBeGreaterThan(0);
    });

    it('rejects, without throwing, a nesting depth that overflows the byte counter itself', () => {
      // `jsonUtf8Bytes` is `JSON.stringify`, which recurses over the WHOLE
      // value — including a key the schema never visits. This input throws
      // inside the byte count, before any budget has been read, so only the
      // validator's outer catch can turn it into an answer.
      let blob: unknown = 1;
      for (let level = 0; level < 200_000; level++) blob = { a: blob };
      expect(() => dashboardJsonBytes(blob)).toThrow(RangeError);

      const result = validate({ ...makeDashboardSpec(), bogus: blob });
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain(
        'could not be validated',
      );
      // Unmeasurable, and says so rather than reporting a made-up 0.
      expect(result.ok ? 0 : result.bytes).toBeUndefined();
    });

    it('still rejects an over-depth tree through the zod refinement for a parseable one', () => {
      // The structural pre-check must not have replaced the refinements: a tree
      // small enough to parse is still reported with the refinement's wording.
      const result = validate(
        makeDashboardSpec({
          components: makeNestedStats(DASHBOARD_LIMITS.maxTreeDepth + 1),
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain('levels deep');
    });
  });

  describe('unique ids (a rejection with no numeric limit)', () => {
    it('rejects a duplicate id among siblings', () => {
      const spec = makeDashboardSpec({
        components: [
          { id: 'same', kind: 'stat', value: 1 },
          { id: 'same', kind: 'stat', value: 2 },
        ],
      });

      const result = validate(spec);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toContain(
        'duplicate component id(s): same',
      );
    });

    it('rejects a duplicate id across nesting levels', () => {
      const spec = makeDashboardSpec({
        components: [
          {
            id: 'same',
            kind: 'stat',
            value: 1,
            children: [{ id: 'same', kind: 'stat', value: 2 }],
          },
        ],
      });

      expect(validate(spec).ok).toBe(false);
    });

    it('accepts ids that differ only at one character', () => {
      const spec = makeDashboardSpec({
        components: [
          { id: 'a', kind: 'stat', value: 1 },
          { id: 'b', kind: 'stat', value: 2 },
        ],
      });

      expect(validate(spec).ok).toBe(true);
    });
  });
});
