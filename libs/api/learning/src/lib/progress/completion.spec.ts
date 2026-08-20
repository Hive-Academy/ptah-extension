import {
  POSITION_OVERSHOOT_TOLERANCE_SECONDS,
  clampPositionSeconds,
  completionThresholdSeconds,
  hasUsableDuration,
  isAutoComplete,
  isImplausiblePosition,
} from './completion';

/**
 * R2.3.2 / R2.3.4 / ASSUMPTION-8 — COMPLETION IS A COMPARISON BETWEEN TWO
 * DIFFERENT QUANTITIES OF THE SAME TYPE, AND THIS FILE IS THE ONLY THING THAT
 * CHECKS THEY ARE THE RIGHT WAY ROUND.
 *
 * ── THE SHAPE OF THIS SPEC IS THE DELIVERABLE, NOT JUST ITS CASES ───────────
 *
 * Batch 6.1's finding (TASK_2026_177 F-1) was that the two existing unread
 * tests "restated the implementation's arithmetic as the expectation, over two
 * independent integers whose units never appear". `expect(unreadCount(10, 4))
 * .toBe(6)` cannot detect a unit mismatch, because the units are not in it:
 * `10` and `4` are just numbers and any subtraction of them looks as right as
 * any other. **Those tests were not merely blind to the defect; they were its
 * accomplices.** The same sentence would be true of
 * `expect(isAutoComplete(90, 100)).toBe(true)`, so that assertion does not
 * appear anywhere below. Three rules, all of them the point:
 *
 *   1. ONE SOURCE OF TRUTH PER CASE. The fixture is a {@link Playback} — a
 *      video of some duration plus the positions a player actually reported —
 *      and BOTH the stored value and the expected verdict are derived from it
 *      by {@link storedFurthestOf} and {@link trulyCompleteOf}. Neither is
 *      typed in by hand beside the other.
 *
 *   2. THE DOMAIN FACT IS RESTATED INDEPENDENTLY. {@link NINETY_PERCENT} is
 *      declared HERE and is never imported from `completion.ts`, and the
 *      expectation is expressed as a RATIO — "the member reached at least 90%
 *      of the video", which is R2.3.2's own words — not as the implementation's
 *      `ceil(duration * ratio)` threshold. A spec that derived its expectation
 *      from the implementation's constants could only confirm the
 *      implementation is self-consistent, which is precisely the state F-1
 *      shipped in.
 *
 *   3. THE WRITE DIRECTION IS COVERED TOO. A read-side-only test cannot see a
 *      write that stores the wrong unit — B6.1's `markCategoryRead` round trip
 *      is the case that REFUSED the obvious one-line fix. Here the write
 *      direction is {@link completionThresholdSeconds} (a duration in, a
 *      position out) and the round trip
 *      `isAutoComplete(completionThresholdSeconds(d), d)` is asserted as a
 *      PROPERTY over a table of durations rather than as two independent
 *      expectations. `progress.service.spec.ts` carries the other half — the
 *      writes that store a position and a completion — over the same fixtures.
 */

/**
 * R2.3.2's threshold, as a fraction of the video.
 *
 * ⚠️ DECLARED HERE, NOT IMPORTED FROM `completion.ts`. See rule 2 above. If
 * someone changes `COMPLETION_THRESHOLD_RATIO` to 0.8, this spec must go red;
 * an imported constant would follow the change and stay green.
 */
const NINETY_PERCENT = 0.9;

/* -------------------------------------------------------------------------- */
/* The fixture model                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One member's playback of one lesson: the video's length, and the positions
 * the player reported, in the order it reported them.
 *
 * ⚠️ `durationSeconds` IS A DURATION AND `reportedPositions` ARE POSITIONS. The
 * two field names are the only place the distinction is written down, which is
 * exactly the situation `completion.ts` exists to make survivable.
 */
interface Playback {
  readonly label: string;
  readonly durationSeconds: number | null;
  readonly reportedPositions: readonly number[];
}

/**
 * What the server would have STORED after this playback — R2.3.1's monotonic
 * rule, modelled independently of `ProgressService`.
 *
 * The maximum of the reported positions, each first brought into range: a
 * player overshoots the end, and the server stores the largest value that could
 * be true rather than the largest value claimed.
 */
function storedFurthestOf(playback: Playback): number {
  const inRange = playback.reportedPositions.map((position) =>
    playback.durationSeconds !== null && playback.durationSeconds > 0
      ? Math.min(position, playback.durationSeconds)
      : position,
  );
  return Math.max(0, ...inRange);
}

/**
 * Did this member actually watch 90% of the video? — the DOMAIN fact, as a
 * ratio.
 *
 * ⚠️ NOT `stored >= Math.ceil(duration * 0.9)`. That is the implementation's
 * formulation and restating it here would make this function an echo. A ratio
 * is what R2.3.2 says and it is arrived at by a different route: it divides
 * where the implementation multiplies, so an inverted comparison in
 * `completion.ts` cannot survive both.
 *
 * A duration that is `null` or `<= 0` is not a video anyone can watch 90% of,
 * so the honest answer is `false` however far the position went.
 */
function trulyCompleteOf(playback: Playback): boolean {
  const { durationSeconds } = playback;
  if (durationSeconds === null || durationSeconds <= 0) return false;
  return storedFurthestOf(playback) / durationSeconds >= NINETY_PERCENT;
}

const PLAYBACKS: readonly Playback[] = [
  {
    label: 'opened and abandoned in the first minute',
    durationSeconds: 600,
    reportedPositions: [0, 12, 41],
  },
  {
    label: 'watched most of it but stopped at 80%',
    durationSeconds: 600,
    reportedPositions: [120, 300, 480],
  },
  {
    label: 'stopped one second short of the threshold',
    durationSeconds: 600,
    reportedPositions: [539],
  },
  {
    label: 'reached exactly the threshold',
    durationSeconds: 600,
    reportedPositions: [540],
  },
  {
    label: 'watched to the end',
    durationSeconds: 600,
    reportedPositions: [200, 599, 600],
  },
  {
    label: 'seeked backwards after finishing — progress must not regress',
    durationSeconds: 600,
    reportedPositions: [600, 30, 45],
  },
  {
    label: 'a video whose 90% point is not a whole second',
    durationSeconds: 95,
    reportedPositions: [86],
  },
  {
    label: 'the same video, one second below its 90% point',
    durationSeconds: 95,
    reportedPositions: [85],
  },
  {
    label: 'the player overshot the end by a second',
    durationSeconds: 300,
    reportedPositions: [301],
  },
  {
    label: 'a lesson with NO persisted duration (ASSUMPTION-8)',
    durationSeconds: null,
    reportedPositions: [10, 4000],
  },
  {
    label: 'a lesson whose persisted duration is 0 (a PT0S video)',
    durationSeconds: 0,
    reportedPositions: [0, 5, 900],
  },
];

/* -------------------------------------------------------------------------- */

describe('isAutoComplete — over real playbacks, not over two loose integers', () => {
  it.each(PLAYBACKS.map((p) => [p.label, p] as const))(
    '%s',
    (_label, playback) => {
      // BOTH sides come from the same fixture: the stored position is derived
      // by the model's monotonic rule, and the expectation by the ratio rule.
      // Neither is typed in beside the other, so they cannot be in different
      // units without the model itself being wrong.
      expect(
        isAutoComplete(storedFurthestOf(playback), playback.durationSeconds),
      ).toBe(trulyCompleteOf(playback));
    },
  );

  it('the fixture table actually contains both verdicts', () => {
    // 🔴 ANTI-VACUITY. If every playback were incomplete, an implementation
    // that returned `false` unconditionally would pass every case above — and
    // that implementation is EXACTLY what the zero-duration bug looks like from
    // the other side.
    const verdicts = PLAYBACKS.map(trulyCompleteOf);

    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('🔴 the argument order is load-bearing — swapping the two changes the answer', () => {
    // The defect this whole file exists for. Both calls compile; one is
    // nonsense. A position of 60 into a 600-second video is not complete; a
    // "position" of 600 into a "video" of 60 would be.
    expect(isAutoComplete(60, 600)).toBe(false);
    expect(isAutoComplete(600, 60)).toBe(true);
  });
});

describe('the round trip — the write direction, stated as a property', () => {
  const DURATIONS = [1, 2, 3, 7, 10, 59, 60, 95, 100, 599, 600, 3600, 7200];

  it.each(DURATIONS)(
    'isAutoComplete(completionThresholdSeconds(%i), %i) is true',
    (duration) => {
      // The property `post-numbering.ts` states between `repliesRead` and
      // `markerForAllRepliesRead`, applied here. It asserts the two functions
      // are inverses ACROSS the unit boundary, which is the thing a pair of
      // independent expectations cannot say.
      expect(
        isAutoComplete(completionThresholdSeconds(duration), duration),
      ).toBe(true);
    },
  );

  it.each(DURATIONS)(
    'and one second BELOW the threshold is not complete (duration %i)',
    (duration) => {
      // Without this half, a `completionThresholdSeconds` that returned `0`
      // would satisfy every assertion above.
      const justBelow = completionThresholdSeconds(duration) - 1;

      expect(isAutoComplete(justBelow, duration)).toBe(
        justBelow / duration >= NINETY_PERCENT,
      );
    },
  );

  it('the threshold agrees with the ratio rule for every integer position', () => {
    // 🔴 THE FLOATING-POINT GUARD. The implementation multiplies by 0.9 and
    // rounds up; this spec divides and compares. Those two routes can disagree
    // at a boundary where `duration * 0.9` is not exactly representable — and a
    // disagreement would mean the server marks a lesson complete at a position
    // the requirement says it should not, or the reverse. Swept rather than
    // spot-checked, because the failure is by construction rare and specific.
    for (let duration = 1; duration <= 2000; duration++) {
      const threshold = completionThresholdSeconds(duration);

      for (const position of [threshold - 1, threshold, threshold + 1]) {
        if (position < 0) continue;
        expect({
          duration,
          position,
          complete: isAutoComplete(position, duration),
        }).toEqual({
          duration,
          position,
          complete: position / duration >= NINETY_PERCENT,
        });
      }
    }
  });

  it('the threshold is never below 90% of the duration — it rounds UP', () => {
    // `Math.floor` would complete a 95-second video at 85 seconds (89.5%),
    // which breaches the requirement it implements. Stated as the property
    // rather than as "expect(threshold).toBe(86)".
    for (const duration of DURATIONS) {
      expect(
        completionThresholdSeconds(duration) / duration,
      ).toBeGreaterThanOrEqual(NINETY_PERCENT);
    }
  });

  it('the threshold is an integer — positions arrive as whole seconds', () => {
    for (const duration of DURATIONS) {
      expect(Number.isInteger(completionThresholdSeconds(duration))).toBe(true);
    }
  });
});

describe('ASSUMPTION-8 + Batch 9A Finding 4 — an unusable duration never auto-completes', () => {
  it('hasUsableDuration rejects null, 0 and negative', () => {
    expect(hasUsableDuration(null)).toBe(false);
    expect(hasUsableDuration(0)).toBe(false);
    expect(hasUsableDuration(-1)).toBe(false);
    expect(hasUsableDuration(1)).toBe(true);
  });

  it('a `null` duration is never complete, for ANY position', () => {
    // R2.3.4 / §4.6.6 / ASSUMPTION-8: keying on the DURATION rather than on the
    // presence of a `youtubeVideoId` is the only reading that cannot compute a
    // threshold against nothing. The feature-off path (R2.2.6) produces exactly
    // this lesson — a video id and no runtime.
    for (const position of [0, 1, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(isAutoComplete(position, null)).toBe(false);
    }
  });

  it('🔴 a `0` duration is never complete either — the zero-threshold defect', () => {
    // The gap Batch 9A's Finding 4 handed to this task. `PT0S` is a form the
    // parser UNDERSTANDS (YouTube emits it for a video still processing), so a
    // lesson can legitimately persist `videoDurationSeconds = 0`. With a naive
    // threshold, `0 >= 0.9 * 0` is TRUE and every such lesson is complete the
    // instant a member opens it — silently, for every member. ASSUMPTION-8 as
    // written keys on `null` and does NOT catch this.
    for (const position of [0, 1, 900]) {
      expect(isAutoComplete(position, 0)).toBe(false);
    }
  });

  it('a negative duration is refused rather than trusted', () => {
    expect(isAutoComplete(0, -30)).toBe(false);
  });

  it('completionThresholdSeconds REFUSES an unusable duration rather than returning 0', () => {
    // Returning `0` would hand back a threshold every position satisfies —
    // the same defect, moved one function along.
    for (const duration of [0, -1]) {
      expect(() => completionThresholdSeconds(duration)).toThrow(
        /manual-completion-only/,
      );
    }
  });
});

describe('clampPositionSeconds — §4.6.5', () => {
  it('clamps a position past the end to the duration', () => {
    expect(clampPositionSeconds(605, 600)).toBe(600);
  });

  it('leaves an in-range position alone', () => {
    expect(clampPositionSeconds(412, 600)).toBe(412);
  });

  it('clamps rather than rejects, so the final tick can still complete a lesson', () => {
    // The concrete reason the tolerance exists: the poll interval plus the
    // whole-second rounding of the persisted duration mean the LAST position a
    // player reports routinely sits past the end. Refusing it would prevent the
    // completing write from ever landing.
    const playback: Playback = {
      label: 'watched to the end, reported one second past it',
      durationSeconds: 600,
      reportedPositions: [601],
    };

    expect(isAutoComplete(storedFurthestOf(playback), 600)).toBe(true);
  });

  it('does not clamp when there is no usable duration — there is no ceiling', () => {
    expect(clampPositionSeconds(4000, null)).toBe(4000);
    expect(clampPositionSeconds(4000, 0)).toBe(4000);
  });

  it('never clamps a value UPWARD', () => {
    // A clamp that raised a position would fabricate progress.
    for (const position of [0, 1, 599]) {
      expect(clampPositionSeconds(position, 600)).toBeLessThanOrEqual(position);
    }
  });

  it('a hostile client cannot buy completion with a large number', () => {
    // §4.6.6 — completion is computed server-side. The submitted value is
    // clamped BEFORE the threshold is applied, so the largest claim available
    // is "I watched the whole thing", which is what it would have been anyway.
    const clamped = clampPositionSeconds(Number.MAX_SAFE_INTEGER, 600);

    expect(clamped).toBe(600);
  });
});

describe('isImplausiblePosition — the tolerance decides logging, never storage', () => {
  it('a position inside the tolerance is plausible', () => {
    expect(
      isImplausiblePosition(600 + POSITION_OVERSHOOT_TOLERANCE_SECONDS, 600),
    ).toBe(false);
  });

  it('a position beyond it is not', () => {
    expect(
      isImplausiblePosition(601 + POSITION_OVERSHOOT_TOLERANCE_SECONDS, 600),
    ).toBe(true);
  });

  it('nothing is implausible when there is no duration to compare against', () => {
    expect(isImplausiblePosition(999999, null)).toBe(false);
  });

  it('the verdict changes nothing about what is stored', () => {
    // Stated explicitly so nobody later turns this into a rejection: both an
    // implausible and a plausible overshoot clamp to the same value.
    expect(clampPositionSeconds(10_000, 600)).toBe(
      clampPositionSeconds(601, 600),
    );
  });
});
