/**
 * Content visibility — R1.1.1.
 *
 * The single vocabulary shared by `Category`, `Course` and `LiveSession`.
 * Declared here rather than in `member/` or `admin/` because BOTH sides read
 * it: an admin authors it, a member's request is filtered by it. It is the
 * only kind of type allowed to sit outside those two directories, and
 * `contract-boundary.spec.ts` permits `shared/` imports from both sides for
 * exactly that reason.
 *
 * ⚠️ Visibility is NOT entitlement (A-2). Entitlement — "may this person enter
 * `/members` at all" — derives from `License`/`Subscription`. Visibility
 * decides which content an already-entitled member sees, and derives from
 * `MemberGroupAssignment`. The two are never conflated.
 */

/**
 * The runtime list, in declaration order. Exported as a tuple so a Nest
 * `ParseEnumPipe`, a Zod `z.enum(...)` and a UI `@for` all read the SAME
 * source — a second hand-written copy of these three strings is the drift this
 * lib exists to prevent.
 */
export const VISIBILITIES = ['member', 'cohort', 'staff'] as const;

/**
 * - `member` — every entitled Builders member.
 * - `cohort` — restricted to one or more `MemberGroup.key` values (ANY-match,
 *   AD-10: a `String[]` column, not a join table).
 * - `staff`  — admin only. Invisible to every member endpoint, which answers
 *   `404` and not `403` so the response cannot confirm the resource exists
 *   (R1.1.3).
 */
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Runtime narrowing for the one place a `Visibility` crosses a boundary as a
 * bare string: a persisted column (`String`, not a Postgres enum) read back
 * into TypeScript. `as Visibility` there would be a lie the type system cannot
 * catch.
 */
export function isVisibility(value: unknown): value is Visibility {
  return (VISIBILITIES as readonly unknown[]).includes(value);
}

/**
 * An entitled member's resolved cohort membership, as it appears on the wire.
 *
 * `key` is the machine identifier a visibility check matches against;
 * `name` is the human label rendered on a badge. Both travel together
 * everywhere so no surface has to look one up from the other.
 *
 * ⚠️ An entitled member with NO assignment gets `[]` here and must still see
 * every `member`-visibility surface without erroring (R7.8, A-2). `[]` is a
 * valid, expected, non-exceptional value — never a reason to fail a request.
 */
export interface MemberCohortBadge {
  key: string;
  name: string;
}
