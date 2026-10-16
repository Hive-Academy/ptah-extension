# Batch 17 (A5b) report

Task 17.1 is implemented. `score` chooses a model and a matrix score. `spread` ranks eligible candidates inside closeness band B and rotates the best limit class. `RotationStore` persists that cursor in global `IStateStorage`. No file outside the six new ranking files was edited.

## Files

CREATED:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\score.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\spread.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\rotation.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\score.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\spread.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\ranking\rotation.store.spec.ts`

## Requirement coverage

| Req | Rule | Implementation | Spec case |
| --- | --- | --- | --- |
| 7.1 | N equal scores and the same limit state produce N different lanes on N consecutive decisions for one key | `spread.ts:97` takes the cyclic next after the stored id; `spread.ts:134-135` advances one step | `chooses N different lanes across N consecutive decisions for one key` (`spread.spec.ts:70`) |
| 7.2 | Inside B, the only `confirmed-room` lane wins. `unknown` is not room | `spread.ts:87-91` keeps the band, then the best limit class (`confirmed-room`, then `unknown`, then `near-limit`) | `chooses the confirmed-room lane when the other is within B and unknown` (`spread.spec.ts:93`); `chooses confirmed-room over near-limit inside the band` (`spread.spec.ts:103`); `ranks unknown ahead of near-limit and does not treat unknown as room` (`spread.spec.ts:112`); `does not rotate a worse limit class into the pick` (`spread.spec.ts:127`) |
| 7.3 | A lead of more than B is not rotated away. A difference of B-1 or exactly B stays inside | `spread.ts:87` uses `top - score <= CLOSENESS_BAND`. A one-member pool cannot move (`spread.ts:132`) | `keeps a lane inside the band when it trails by B-1` (`spread.spec.ts:146`); `keeps a lane inside the band when it trails by exactly B` (`spread.spec.ts:161`); `does not rotate a lane that trails by B+1` (`spread.spec.ts:172`). `pins the documented closeness band` asserts `CLOSENESS_BAND === 5` (`spread.spec.ts:142`) |
| 7.4 | The same inputs and the same rotation state return the same choice | `spread` is a pure function (`spread.ts:68`). No clock, no I/O, no randomness | `returns the same choice for the same inputs and rotation state` (`spread.spec.ts:190`) |
| 7.5 | L is persisted across a restart, so the next decision continues | `RotationStore.save` / `load` (`rotation.store.ts:193`, `rotation.store.ts:153`) write and read `laneRouting.rotation.v1` | `continues the rotation after a restart (Req 7.5)` (`rotation.store.spec.ts:123`) |
| 7.6 | An `at-limit` lane leaves the rotation. The others keep their order. When it returns it re-enters in that order | `spread.ts:151-155` drops `at-limit`. `spread.ts:137-142` places a departed id by the tie-break | `drops an at-limit lane and keeps the others in rotation order` (`spread.spec.ts:215`); `keeps tie-break order when the last lane becomes at-limit` (`spread.spec.ts:237`) |

Req 7.7 and Req 7.8 belong to the decision-model option list (A8). This batch does not offer options to a model.

Score is the input to the band. Its own edges, including "more than B" for model promotion, are in `score.spec.ts:104` (clears the band), `:123` (exactly B does not), and `:142` (B-1 does not).

## Write path (Mode 3 trace)

| | |
| --- | --- |
| Storage | Global `IStateStorage` (`PLATFORM_TOKENS.STATE_STORAGE`). `RotationStore` takes that port and has no workspace id (`rotation.store.ts:4-6`, `rotation.store.ts:146-148`). Part A line 116: global so every workspace shares the cursor. AB14 must inject the host global state, not workspace state. |
| Key | `laneRouting.rotation.v1`, constant `ROTATION_STORAGE_KEY` (`routing-constants.ts:85`). One key for the whole document. |
| Read | `storage.get(ROTATION_STORAGE_KEY)` (`rotation.store.ts:156`). |
| Write | `storage.update(ROTATION_STORAGE_KEY, document)` (`rotation.store.ts:203`). |
| Value | `{ version: 1, entries: [{ key: string, candidateId: string }, ...] }` (`rotation.store.ts:8-12`, schema `rotation.store.ts:63-88`). `entries` is oldest first, unique keys, length at most 200 (`ROTATION_MAX_KEYS`, `routing-constants.ts:88`). A write of an existing key moves it to the end. Past 200, the oldest entry is dropped (`rotation.store.ts:123`). |
| Rotation key | `${phaseId}\|${taskKind}` (`rotation.store.ts:95-105`). `taskKind` is an `OutcomeTaskKind` from `@ptah-extension/shared` (`OUTCOME_TASK_KINDS`). The key is not split, so a phase id may contain `\|`. `ROTATION_TASK_KINDS` is not used. |
| Read throws | Empty document and reason `rotation store unavailable` (`rotation.store.ts:38`, `rotation.store.ts:158-166`). `record` does not write (`rotation.store.ts:184-188`). |
| Write throws | Logged warn, `{ persisted: false }` (`rotation.store.ts:205-211`). The decision is still returned by the caller. |
| Invalid document | Warn, empty state, reason null (`rotation.store.ts:172-176`). The next `record` replaces it. |

`spread` does not touch storage. It takes a `RotationState` and returns the next one (`spread.ts:115`). The pipeline saves that document after a successful load.

## Index exports

`src/index.ts` was not edited. A8 should export:

```ts
export {
  score,
  type CandidateScore,
  type FallbackModel,
  type ListedModel,
  type ListedProvenance,
  type ModelProvenance,
  type ScoreCell,
  type ScoreInput,
  type ScoreMatrix,
} from './lib/ranking/score';
export {
  spread,
  type RankedCandidate,
  type SpreadInput,
  type SpreadPreferences,
  type SpreadResult,
} from './lib/ranking/spread';
export {
  ROTATION_DOCUMENT_VERSION,
  ROTATION_UNAVAILABLE_REASON,
  RotationStore,
  emptyRotationState,
  lastCandidateId,
  rotationKey,
  withPick,
  type RotationLoad,
  type RotationPick,
  type RotationState,
  type RotationWrite,
} from './lib/ranking/rotation.store';
```

`LANE_ROUTING_TOKENS.ROTATION_STORE` already exists (`di/tokens.ts:26`). This batch did not add `@inject` and did not edit `di/register.ts`. The class is constructed as `new RotationStore(storage, logger)`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A listed model is used only when its own cell beats the family cell by more than B (`score - family > CLOSENESS_BAND`). Exactly B keeps the configured model, or `lane-default` | `>= B` also promotes | Part A §4: the listed model "beats the family-level cell by more than B" (`implementation-plan-part-a.md:229-230`) | yes |
| A subagent has no limit state. It joins the best lane class in the band and does not create a better one. Tie-break then puts a lane before a subagent | Treat a subagent as `confirmed-room`, which would drop an `unknown` lane out of the pool | `SubagentCandidate` has no `limitState` (`candidate.types.ts:32-38`). Limit order is `routing-constants.ts:43-47`. Executor order is lane then subagent (`routing-constants.ts:71`) | yes |
| When the stored id is still in the input but out of the pool, the next pick is the first pool member that sorts after it. When the id is absent, the next pick is the first pool id that sorts after it, else the first member | Always restart at the tie-break first | Part A stores only the candidate id (`implementation-plan-part-a.md:116`). Req 7.6 needs the remaining order to continue | yes |
| The 200-key cap drops the least recently written key. Rewriting a key moves it to the newest end | Drop the oldest insertion even if that key was just updated | Part A: "capped at 200 keys, oldest dropped" (`implementation-plan-part-a.md:116`) | yes |
| The reason string is `rotation store unavailable`, the phrase `compile-reasons.ts:100` already emits. A throwing `get` sets it. An invalid document warns and is replaced on the next `record`, and does not use that phrase | Use the plan's shorthand `rotation-unavailable` (`implementation-plan-part-a.md:240`) for both | Req 4.5 / F11 names the compiler phrase. A stuck "unavailable" on a bad document would never heal | yes |
| `record` skips the write when `get` threw. `save` writes the document it is given | Always overwrite after a failed read | A failed read must not replace a document this process never saw (`rotation.store.ts:17-19`) | yes |

## Assumptions

- The score lookup is `CapabilityMatrixSnapshot.resolve`. `lane-default` and `auto` read the family profile (`capability-matrix.store.ts` `profileModelFor`, around the `LANE_DEFAULT_MODEL` / `AUTOMATIC_MATRIX_MODEL` branch). A8 passes that function. This batch does not call the store.
- A subagent tier (`opus` / `sonnet` from the phase kind, part A data-flow step 5) is passed in as `configuredModel` with provenance `tier`. Score does not see the phase kind.
- `OutcomeTaskKind` is the six-value union in `libs/shared/src/lib/types/lane-outcome.types.ts:17-25`.
- `IStateStorage` is `get` / `update` / `keys` (`libs/backend/platform-core/src/interfaces/state-storage.interface.ts:12-29`).
- Inside the band means `top - score <= CLOSENESS_BAND` (`routing-constants.ts:32-36`). `CLOSENESS_BAND` is 5.
- `unknown` is not evidence of room (`lane-state.ts:158-159` is the `LaneLimitState` union; the order is `routing-constants.ts:39-47`).

## Validation

- `npx eslint` on the six files: exit 0, no problems.
- Degradation audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`. PowerShell has no `grep`, so the same filter was `Select-String -Pattern "lane-routing|FAIL|TOTAL"`. Exit 0. The filter printed `degradation-audit: per-directory totals` and `degradation-audit: TOTAL 296 unsuppressed site(s)`. No `FAIL` line and no `lane-routing` violation line.
- `npx prettier --write` on the six files: exit 0. `rotation.store.ts` was unchanged. The other five were rewritten.
- Jest was not run (decision #53). The team-leader check is `J(libs/backend/lane-routing, libs/backend/lane-routing/src/lib/ranking/score.spec.ts libs/backend/lane-routing/src/lib/ranking/spread.spec.ts libs/backend/lane-routing/src/lib/ranking/rotation.store.spec.ts)`.

## Not done

- `src/index.ts` exports, listed above. A8 owns the barrel.
- `di/register.ts` does not construct `RotationStore`. No `@inject` was added.
- Req 7.7 and Req 7.8 (the model's options, and the always-first fake) are A8.
- The phase-kind to `opus` / `sonnet` tier map is A8. Score accepts the tier it is given.
- `ptah_agent_report` could not be called. Tool search found no `ptah_*` tools on this lane (only the tasks automation server).
