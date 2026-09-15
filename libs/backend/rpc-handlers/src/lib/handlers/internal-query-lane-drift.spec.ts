/**
 * Drift pin for TASK_2026_437 C14 (Batch 16b): the internal-query lane names
 * skill-synthesis sends and the lane allow-list agent-sdk's gate governs.
 *
 * skill-synthesis cannot import agent-sdk (it reaches the concrete service by
 * token through its local `IInternalQuery` mirror), so each lib declares the
 * strings by value. A rename on either side compiles, and each lib's own specs
 * only check its own copy — skill-synthesis's background calls would silently
 * stop yielding to a generating turn. This lib imports both and is where a
 * divergence fails CI (precedent: workspace-intelligence
 * `workspace-exclusion-drift.spec.ts`).
 */

// The two barrels load tsyringe-decorated classes.
import 'reflect-metadata';
import {
  GOVERNED_BACKGROUND_LANES,
  SKILL_SYNTHESIS_QUERY_LANE as SDK_SKILL_SYNTHESIS_QUERY_LANE,
  USER_ACTION_QUERY_LANE as SDK_USER_ACTION_QUERY_LANE,
} from '@ptah-extension/agent-sdk';
import {
  SKILL_SYNTHESIS_QUERY_LANE,
  USER_ACTION_QUERY_LANE,
  skillQueryLane,
} from '@ptah-extension/skill-synthesis';

describe('internal-query lane names — agent-sdk and skill-synthesis agree', () => {
  it('declares the same background lane string on both sides', () => {
    expect(SKILL_SYNTHESIS_QUERY_LANE).toBe(SDK_SKILL_SYNTHESIS_QUERY_LANE);
  });

  it('declares the same user-action lane string on both sides', () => {
    expect(USER_ACTION_QUERY_LANE).toBe(SDK_USER_ACTION_QUERY_LANE);
  });

  it("governs skill-synthesis's background lane", () => {
    expect(GOVERNED_BACKGROUND_LANES.has(SKILL_SYNTHESIS_QUERY_LANE)).toBe(
      true,
    );
    // The lane skill-synthesis actually sends for background work.
    expect(GOVERNED_BACKGROUND_LANES.has(skillQueryLane({}))).toBe(true);
  });

  it('never governs the user-action lane skill-synthesis sends for a click', () => {
    expect(GOVERNED_BACKGROUND_LANES.has(USER_ACTION_QUERY_LANE)).toBe(false);
    expect(
      GOVERNED_BACKGROUND_LANES.has(skillQueryLane({ userInitiated: true })),
    ).toBe(false);
  });
});
