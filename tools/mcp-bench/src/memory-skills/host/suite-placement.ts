/**
 * Plan-order constraints of host suites that share the bench host's one
 * database (Phase 3.5 review findings 4 and 5). Pure: the runner parent's
 * plan schema (`runner/runner-plan.ts`), the host plan schema
 * (`plan.schema.ts`) and the host executor (`memory-skills-host.ts`) all
 * refuse a plan that breaks them, before any suite runs.
 *
 * - `first`: the suite measures what it writes into a database no other suite
 *   has written (`mem.scope.write` counts every row, `scope-write.suite.ts`);
 *   it must be the first host suite. Its run also gates on the row count, so
 *   a seeded database fixture makes it `na`, not `pass`.
 * - `last`: the suite rewrites the shared database (the retention suites run
 *   180 simulated days of archive and delete over every row); only other
 *   `last` suites may follow it.
 * - `any`: no constraint.
 *
 * The host suites declare their placement (`MemorySkillsHostSuite.placement`);
 * {@link HOST_SUITE_PLACEMENTS} is the same table for the parent, which
 * cannot load the host suites. `suite-placement.spec.ts` pins the two equal.
 */

export type SuitePlacement = 'any' | 'first' | 'last';

/** Every host suite with a constraint, by id; any other id is `any`. */
export const HOST_SUITE_PLACEMENTS: Readonly<
  Record<string, Exclude<SuitePlacement, 'any'>>
> = {
  'mem.scope.write': 'first',
  'mem.retention.lifecycle': 'last',
  'mem.retention.growth': 'last',
  'mem.ranking.roster': 'last',
};

export function hostSuitePlacement(id: string): SuitePlacement {
  return Object.hasOwn(HOST_SUITE_PLACEMENTS, id)
    ? HOST_SUITE_PLACEMENTS[id]
    : 'any';
}

export interface PlacementProblem {
  /** Index of the offending suite in the host suite list. */
  readonly index: number;
  readonly message: string;
}

/** Every violation of the placement rules in one ordered host suite list. */
export function suitePlacementProblems(
  ids: readonly string[],
  placementOf: (id: string) => SuitePlacement,
): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  let rewriter: string | null = null;
  ids.forEach((id, index) => {
    const placement = placementOf(id);
    if (placement === 'first' && index > 0) {
      problems.push({
        index,
        message: `suite ${id} must be the first host suite: it measures a database no other suite has written`,
      });
    }
    if (rewriter !== null && placement !== 'last') {
      problems.push({
        index,
        message: `suite ${id} must run before ${rewriter}, which archives and deletes every row of the shared database`,
      });
    }
    if (placement === 'last' && rewriter === null) rewriter = id;
  });
  return problems;
}
