# Batch 10 (A5a) report

Task 10.1 is implemented. `constrainPhase` is a pure, deterministic filter. `src/index.ts` was not edited (A8 owns exports). No file outside `LR/ranking/` was edited.

## Files

CREATED:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\candidate.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\hard-constraints.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\hard-constraints.spec.ts`

## Requirement coverage

| Req | Exclusion reason / rule | Spec case |
| --- | --- | --- |
| 3.2 | `at-limit` (lane not left eligible) | `excludes an at-limit lane with rule at-limit and keeps the other lane` |
| 3.2 | `disabled` | `excludes a disabled lane with rule disabled` |
| 3.2 | `not-installed` | `excludes a not-installed lane with rule not-installed` |
| 3.2 | `at-limit` wins when the same lane is also disabled and not installed | `reports at-limit when that lane is also disabled and not installed` |
| 3.2 | none of `confirmed-room`, `near-limit`, `unknown` | `keeps confirmed-room, near-limit and unknown lanes in input order` |
| 3.2 | phase `no-eligible-candidate` when every lane is `at-limit` | `returns no-eligible-candidate when every lane is at-limit` |
| 3.3 | phase `reviewer-family`, rule `reviewer-family`, `needsDisclosedFallback: true` | `returns reviewer-family when the only spawnable reviewer shares the implementer family` |
| 3.3 | rule `reviewer-family`; a different family stays eligible (lane and subagent) | `keeps a different-family lane and excludes the implementer family with rule reviewer-family` |
| 3.3 | `reviews` limits which implement families count | `uses only the implement phases named by reviews` |
| 3.3 | omitted `reviews` uses every implement phase | `forbids every implement phase family when reviews is omitted` |
| 3.3 | `document-review` uses the same family rule | `excludes the author family on document-review with rule reviewer-family` |
| 3.3 | phase `reviewer-family` when the other family is `at-limit` and a same-family lane is spawnable | `returns reviewer-family when the other family is at-limit and a same-family lane is spawnable` |
| 3.3 | `at-limit` before family, so the phase is `no-eligible-candidate` | `returns no-eligible-candidate when the same-family reviewer is at-limit` |
| 3.3 | family check skipped on the pre-review pass | `does not apply reviewer-family when deferReviewerFamily is set` |
| 3.4 | `never-on-a-lane` on `visual-review`; the subagent stays | `excludes every lane on visual-review with rule never-on-a-lane and keeps the subagent` |
| 3.4 | `never-on-a-lane` on `design`; the subagent stays | `excludes every lane on design with rule never-on-a-lane and keeps the subagent` |
| 3.4 | lanes only → `no-eligible-candidate`, not a lane executor | `returns no-eligible-candidate when a visual-review phase has only lanes` |
| 3.5 | no exclusion rule; the gate schema has no batch-size field | `rejects a batch-size field on the gate result and on a roster entry` |
| 3.6 | `pin-unavailable` / `at-limit`; the other lane is not chosen | `returns pin-unavailable with rule at-limit and does not substitute another lane` |
| 3.6 | `pin-unavailable` / `not-listed` | `returns pin-unavailable with rule not-listed when the pin names no row` |
| 3.6 | `pin-unavailable` / `reviewer-family` | `returns pin-unavailable with rule reviewer-family for a same-family pin` |
| 3.6 | `pin-unavailable` / `never-on-a-lane`; the subagent is not substituted | `returns pin-unavailable with rule never-on-a-lane and does not substitute the subagent` |
| 3.6 | pin accepted; only that candidate is eligible | `accepts a spawnable pin and does not keep another eligible lane` |
| 3.6 | unique `cli` pin resolves to `ptahCliId` | `resolves a unique cli pin to that lane id` |
| 3.6 | ambiguous `cli` pin is `not-listed` | `returns pin-unavailable with rule not-listed when the cli pin is ambiguous` |

The reviewer-family case also parses the unavailable shape with `UnavailableEntrySchema`. Candidate identity (`toLaneCandidate`, `toSubagentCandidate`) is covered under `candidate types`. `returns the same result for the same input without mutating candidates` locks determinism.

Req 3.1 and Req 3.7 stay with A8 (`implementation-plan.md` requirement-coverage row). `pruned` stays with Requirement 12.2 (A8). This filter's `HARD_CONSTRAINT_RULES` omits it.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| First matching lane rule wins: `at-limit`, `disabled`, `not-installed`, `never-on-a-lane`, then `reviewer-family`. Subagents are checked only for family | one combined reason; disabled before limits | Part A component 4 lists the rules in that order (`implementation-plan-part-a.md` ranking-engine bullet). Req 2.7's all-`at-limit` fixture needs `at-limit` to be the recorded rule | yes (one function) |
| Review phases are `review` and `document-review`. Never-on-a-lane phases are only `visual-review` and `design` | treat every phase as a review; also block plan/architecture | Req 3.3 is the review-family rule. Part A names `visual-review` and `design` for the never-on-a-lane list (`lane-assignment.md` lines 66-67). Plan and architecture remain lane phases in that file | yes (two constants) |
| Phase reason is `reviewer-family` when nothing remains and at least one candidate was excluded for `reviewer-family`. A same-family lane that is `at-limit` does not count, so the phase is `no-eligible-candidate` and `needsDisclosedFallback` stays false | always `reviewer-family` when any family matches; always `no-eligible-candidate` when any other rule fired | Req 3.3: do not return a same-family lane when no other family is eligible, and set the disclosed-fallback flag. Req 2.7: an all-`at-limit` phase is `no-eligible-candidate`. The flag is defined for the exclusion reason `reviewer-family` (Req 2.3), not for a pin rule | yes |
| A pin matches one candidate id, or a `cli` value that belongs to exactly one lane. Zero or many matches are `not-listed`. A broken pin is `pin-unavailable` with that rule and is never replaced | match `cli` even when several Ptah CLI rows share it; pick the first duplicate | Pin comment on the args schema: `cli` value, `ptahCliId`, or `subagent:<role>`. `ptah-cli` is not a unique id (`candidate.types.ts` `laneCandidateId`). Req 3.6 forbids substitution | yes |
| `deferReviewerFamily` skips the family check. An empty implementer set excludes nobody | always apply family, which would drop same-family lanes before implementers exist | Data flow steps 6 and 9: non-review constraints first, reviewer family after the implementer choice | yes |
| A null limit map, or a missing key, is `unknown`, not `at-limit` | exclude lanes with no limit evidence | Port comment on `RouteCandidateSource.limits`: a null map means limits are unavailable and every lane is `unknown` (Req 4.5) | yes |

## Assumptions

Batch 10 owns no row in the assumptions table (`implementation-plan.md` "Assumptions to check first"). None were resolved here.

Checked before writing:

- `EXCLUSION_RULES` and the unavailable exclusion-reason enum are the Batch 5 result schema (`route-decide-result.schema.ts`).
- `PHASE_KINDS` is the Batch 5 args schema.
- Lane id and family follow `laneFamilyOf` / `SUBAGENT_FAMILY` (`libs/shared/src/lib/utils/lane-family.ts`) and `CliDetectionResult.disabled` / `installed` (`agent-process.types.ts`).
- `LaneLimitState` includes `at-limit`; `EXCLUDED_LIMIT_STATE` in `routing-constants.ts` is that spelling.

## Validation notes

- Rule 9: ranking source imports `@ptah-extension/shared`, this lib's contracts (zod schemas) and `routing-constants.ts`. It does not import `vscode-core`, `platform-core`, or `lane-outcomes`.
- Strict TypeScript: no `any`, no `@ts-ignore`, no `as unknown as`.
- `assertConstraintVocabulary` runs at load and checks the hard-constraint rules and phase kinds against the Batch 5 consts.
- `ptah_get_diagnostics` is not available in this lane (tool search returned no `ptah_*` tools). No Nx, Jest, build, serve, dev, e2e, or package command was run (decision #53). There is no verification tail. The team-leader owns `J(libs/backend/lane-routing, libs/backend/lane-routing/src/lib/ranking/hard-constraints.spec.ts)`.

## Risks

- Parallel lanes own matrix, decision-model, persistence-sqlite, and vscode-lm-tools files. This batch did not touch them.
- A5b will import `RoutingCandidate` from `candidate.types.ts`. The shape carries `id`, `family`, `limitState`, `preferredRank`, and `kind` for the tie-break. It does not carry a score; scoring stays in A5b.
- The "at-limit row that scores highest" acceptance line is enforced by removing the row before scoring. The score comparison itself is A5b / A8.
