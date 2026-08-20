/**
 * `planClusterDraft` — the drafting half of the hold-out contract (B3.6).
 *
 * B3.2 shipped a replay gate that can only measure transfer if a cluster member
 * was withheld from the draft. Nothing withheld one, so the gate reported
 * `replay-no-holdout` for every cluster it would ever see. These are the specs
 * for the half that was missing.
 *
 * What is pinned, in order of how badly it hurts to get wrong:
 *
 *  1. **The two sides agree.** `selectHoldoutSessionId(clusterSessionIds,
 *     draftedSessionIds)` must return exactly `plan.holdoutSessionId` for EVERY
 *     plan. A drafting side that excludes a different member than the gate
 *     subtracts does not throw — it produces a `null` confidence that is
 *     indistinguishable from "this cluster had nothing to spare", so nothing
 *     ever reports the drift. The `describe.each` below is deliberately wide,
 *     because the whole value of the assertion is that it fires on a mutation.
 *  2. **The floor outranks the measurement.** A cluster sitting exactly on
 *     `suggestionMinClusterSize` must be drafted from EVERY member and reported
 *     with `holdoutSessionId: null`. Holding one back there buys a number by
 *     turning cluster synthesis into single-session synthesis.
 *  3. **`null` is the honest answer, not a degradation.** B3.1 pinned that
 *     `replay_confidence` `null` means "never measured"; an unmeasurable cluster
 *     must reach that `null` rather than a fabricated hold-out.
 */
import {
  clusterSessionIdsOf,
  planClusterDraft,
  type ClusterMemberSessions,
} from './cluster-holdout';
import { selectHoldoutSessionId } from './replay-validator.service';

/** A cluster member reduced to the only field the planner reads. */
function member(...sourceSessionIds: string[]): ClusterMemberSessions & {
  readonly label: string;
} {
  return { sourceSessionIds, label: sourceSessionIds.join('+') };
}

// ── The agreement invariant ─────────────────────────────────────────────────

/**
 * Every shape a real cluster can arrive in. Named so a failure says which one.
 *
 * `minClusterSize` is carried per-case because the floor is half of what makes
 * a plan correct: the same members with a different floor are a different
 * decision.
 */
const CLUSTERS: ReadonlyArray<{
  readonly name: string;
  readonly members: readonly ClusterMemberSessions[];
  readonly minClusterSize: number;
}> = [
  {
    name: 'three single-session members, floor 2 — one to spare',
    members: [member('s-a'), member('s-b'), member('s-c')],
    minClusterSize: 2,
  },
  {
    name: 'two single-session members, floor 2 — exactly on the floor',
    members: [member('s-a'), member('s-b')],
    minClusterSize: 2,
  },
  {
    name: 'two single-session members, floor 1 — one to spare',
    members: [member('s-a'), member('s-b')],
    minClusterSize: 1,
  },
  {
    name: 'a member carrying two sessions, one of them the greatest',
    members: [member('s-a'), member('s-b'), member('s-c', 's-z')],
    minClusterSize: 2,
  },
  {
    // THE case that makes the invariant itself mutation-sensitive. Two members
    // carry a spare session each, so dropping one leaves TWO sessions unused
    // and the gate returns the greatest of them. Only a drafting rule that
    // reserves the greatest of the whole cluster survives that: any other
    // consistent rule reserves one session and is recovered as a different one.
    name: 'two multi-session members — the reserved id must be the greatest unused',
    members: [member('s-a', 's-y'), member('s-b'), member('s-c', 's-z')],
    minClusterSize: 2,
  },
  {
    name: 'ids whose lexicographic order is not their insertion order',
    members: [member('s-z'), member('s-a'), member('s-m'), member('s-b')],
    minClusterSize: 2,
  },
  {
    name: 'duplicate sessions across members',
    members: [member('s-a'), member('s-a'), member('s-b'), member('s-c')],
    minClusterSize: 2,
  },
  {
    name: 'blank and whitespace ids mixed in',
    members: [
      member(''),
      member('  '),
      member('s-a'),
      member('s-b'),
      member('s-c'),
    ],
    minClusterSize: 2,
  },
  {
    name: 'every member shares one session — nothing is separable',
    members: [member('s-only'), member('s-only')],
    minClusterSize: 2,
  },
  {
    name: 'a cluster with no usable session id at all',
    members: [member(''), member('   ')],
    minClusterSize: 2,
  },
  {
    name: 'a floor of 0 — never draft from nothing',
    members: [member('s-a')],
    minClusterSize: 0,
  },
];

describe('planClusterDraft — the drafting side agrees with the gate', () => {
  it.each(CLUSTERS.map((c) => [c.name, c] as const))(
    'the gate recovers exactly the reserved hold-out: %s',
    (_name, spec) => {
      const plan = planClusterDraft(spec.members, spec.minClusterSize);

      // THE invariant. If this fails, the hold-out is consumed by the draft and
      // the replay gate silently measures recall — or nothing at all.
      expect(
        selectHoldoutSessionId(plan.clusterSessionIds, plan.draftedSessionIds),
      ).toBe(plan.holdoutSessionId);
    },
  );

  it.each(CLUSTERS.map((c) => [c.name, c] as const))(
    'the draft never sees the held-out session: %s',
    (_name, spec) => {
      const plan = planClusterDraft(spec.members, spec.minClusterSize);
      if (plan.holdoutSessionId === null) return;

      expect(plan.draftedSessionIds).not.toContain(plan.holdoutSessionId);
      for (const drafted of plan.drafted) {
        expect(drafted.sourceSessionIds.map((id) => id.trim())).not.toContain(
          plan.holdoutSessionId,
        );
      }
    },
  );

  it.each(CLUSTERS.map((c) => [c.name, c] as const))(
    'a reserved plan never drafts below the floor: %s',
    (_name, spec) => {
      const plan = planClusterDraft(spec.members, spec.minClusterSize);
      if (plan.holdoutSessionId === null) return;

      expect(plan.drafted.length).toBeGreaterThanOrEqual(spec.minClusterSize);
      expect(plan.drafted.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(CLUSTERS.map((c) => [c.name, c] as const))(
    'the drafted sessions are always a subset of the cluster: %s',
    (_name, spec) => {
      const plan = planClusterDraft(spec.members, spec.minClusterSize);
      for (const id of plan.draftedSessionIds) {
        expect(plan.clusterSessionIds).toContain(id);
      }
    },
  );
});

// ── The reservation itself ──────────────────────────────────────────────────

describe('planClusterDraft — reservation', () => {
  it('holds back the member owning the lexicographically greatest session', () => {
    const a = member('s-a');
    const b = member('s-b');
    const c = member('s-c');
    const plan = planClusterDraft([a, b, c], 2);

    expect(plan.reason).toBe('holdout-reserved');
    expect(plan.holdoutSessionId).toBe('s-c');
    expect(plan.drafted).toEqual([a, b]);
    expect(plan.draftedSessionIds).toEqual(['s-a', 's-b']);
    expect(plan.clusterSessionIds).toEqual(['s-a', 's-b', 's-c']);
  });

  it('is deterministic — member order does not change the pick', () => {
    const forwards = planClusterDraft(
      [member('s-a'), member('s-b'), member('s-c')],
      2,
    );
    const backwards = planClusterDraft(
      [member('s-c'), member('s-b'), member('s-a')],
      2,
    );
    expect(forwards.holdoutSessionId).toBe(backwards.holdoutSessionId);
    expect([...forwards.draftedSessionIds].sort()).toEqual(
      [...backwards.draftedSessionIds].sort(),
    );
  });

  it('drops a multi-session member whole, since a body cannot be split', () => {
    const plan = planClusterDraft(
      [member('s-a'), member('s-b'), member('s-c', 's-z')],
      2,
    );
    expect(plan.holdoutSessionId).toBe('s-z');
    // `s-c` left with its member. It is unused by the draft, but the hold-out
    // is still the greatest of what is unused, so the gate still recovers `s-z`.
    expect(plan.draftedSessionIds).toEqual(['s-a', 's-b']);
    expect(
      selectHoldoutSessionId(plan.clusterSessionIds, plan.draftedSessionIds),
    ).toBe('s-z');
  });
});

// ── The floor ───────────────────────────────────────────────────────────────

describe('planClusterDraft — the floor outranks the measurement', () => {
  it('declines to reserve when the draft would fall below suggestionMinClusterSize', () => {
    const a = member('s-a');
    const b = member('s-b');
    const plan = planClusterDraft([a, b], 2);

    expect(plan.reason).toBe('cluster-at-floor');
    expect(plan.holdoutSessionId).toBeNull();
    // Drafted from EVERY member — a 2-member cluster is never distilled from 1.
    expect(plan.drafted).toEqual([a, b]);
    expect(plan.draftedSessionIds).toEqual(['s-a', 's-b']);
  });

  it('reserves from the same two members once the floor drops to 1', () => {
    const plan = planClusterDraft([member('s-a'), member('s-b')], 1);
    expect(plan.reason).toBe('holdout-reserved');
    expect(plan.holdoutSessionId).toBe('s-b');
    expect(plan.draftedSessionIds).toEqual(['s-a']);
  });

  it('never drafts from zero members, even with a floor of 0', () => {
    const only = member('s-a');
    const plan = planClusterDraft([only], 0);

    expect(plan.reason).toBe('cluster-at-floor');
    expect(plan.holdoutSessionId).toBeNull();
    expect(plan.drafted).toEqual([only]);
  });

  it('declines when every member shares the one session', () => {
    const plan = planClusterDraft([member('s-only'), member('s-only')], 2);
    expect(plan.reason).toBe('cluster-at-floor');
    expect(plan.holdoutSessionId).toBeNull();
    expect(plan.drafted).toHaveLength(2);
  });
});

// ── Degenerate input ────────────────────────────────────────────────────────

describe('planClusterDraft — nothing to hold out', () => {
  it('reports no-cluster-sessions when no member carries a usable id', () => {
    const plan = planClusterDraft([member(''), member('   ')], 2);
    expect(plan.reason).toBe('no-cluster-sessions');
    expect(plan.holdoutSessionId).toBeNull();
    expect(plan.clusterSessionIds).toEqual([]);
    expect(plan.draftedSessionIds).toEqual([]);
  });

  it('handles an empty cluster without inventing a hold-out', () => {
    const plan = planClusterDraft([], 2);
    expect(plan.holdoutSessionId).toBeNull();
    expect(plan.drafted).toEqual([]);
  });
});

describe('clusterSessionIdsOf', () => {
  it('trims, de-duplicates and drops blanks', () => {
    expect(
      clusterSessionIdsOf([member(' s-a ', 's-b'), member('s-a', '', '  ')]),
    ).toEqual(['s-a', 's-b']);
  });
});
