# Code Style Review - TASK_2026_692_f748 (Phase 1 re-review, batches 8F-8H)

Review family: implementer codex, reviewer Claude

First review (summary): scored 7/10, NEEDS_REVISION (0 Blocking, 2 Serious, 2 Moderate, 3 Minor). Serious 1: `ManualCompactAdmission` was declared inline in the agent-sdk barrel with an inline `import()` type. Serious 2: the idle folder failed `prettier --check`. Moderate: a constructor with 4 positional optionals, and the idle constants duplicated across files. Minor: naming drift in the veto reason, and barrel paths that bypassed `helpers/index.ts`.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 (carried over, 1 new) |
| Minor | 3 |

Scope: `git diff daeefb6ec..e931d243c`, read-only. Only `prettier --check` was run. No tests, typecheck or lint.

## Earlier findings

| Finding | Status | Evidence |
| --- | --- | --- |
| Serious 1: `ManualCompactAdmission` defined in the barrel | RESOLVED | The type now lives in `compaction/manual-compact-admission.types.ts:4`, using `import type`. `helpers/index.ts:65-66` re-exports both it and `ManualCompactDecision`. `src/index.ts:142-145` re-exports both by name through `./lib/helpers`. Both go through the same path. |
| Serious 2: idle folder not prettier-clean | RESOLVED | `prettier --check lib/helpers/compaction/idle index.ts` reports "All matched files use Prettier code style!". Seven files elsewhere under `compaction/` still fail, e.g. `context-usage.port.ts` and `subagent-handoff-files.ts`. They are outside this diff, so they are pre-existing and not a finding. |
| Moderate 1: constructor with positional optionals | OPEN | Not addressed in 8F-8H. Unchanged and still tolerable; see the carried finding below. |
| Moderate 2: constants duplicated | OPEN, worse by one copy | The `100_000` floor now sits in `idle-compaction.types.ts:10` and in `compaction-config-provider.ts:117` and `:234` (a literal each time). See the carried finding below. |
| Minor: `manual-reserved` vs `manual-compact-reserved` spelling | OPEN | `IdleSendVetoedError` is now in `idle-compaction.helpers.ts:52` and still uses `'manual-reserved'`. Cosmetic. |

## Requested checks

1. `idle-compaction.helpers.ts` (86 lines): cohesion is acceptable. It holds pure functions (`readIdleSettings`, `resolveIdleSignal`, `sameTimer`, `initialState`) plus a small error class. All are service-support code with no state of their own. No logic is duplicated; the service imports them (`idle-compaction.service.ts:36-40`). The name `helpers` is vague but matches the repo style (`subagent-handoff-files.ts`, and so on). It is not exported through `idle/index.ts`, which is correct. `IdleSendVetoedError` is exported only so the service can use it. Line counts are all under 500: service 488, reducer 415, types 264. The service is close to the limit and is one more feature away from needing another split.
2. Log wording: `signal-failed` is used where a single signal failed (service:160, :283, :421). `group-failed` is used when the pipeline errors (:230). At :235 the finalize hook reports `group-failed` when the group ends after its last signal failed, and it can follow a `signal-failed` entry for the same group. This is defensible, because the group did end in a failed state. It is slightly confusing, because the same reason name covers two different events. Minor.
3. `compaction-config-provider.ts:93-122`: the idle defaults are validated once in the constructor and stored in readonly fields, which matches the existing `budgetDefaults` pattern (resolved at construction, read-only). It is consistent with that pattern, and the live read is cheaper and easier to follow (:203-247). One difference: `budgetDefaults` is a Map built by a `budgetDefault(key)` helper, while the idle defaults are inline validation in the constructor. That is acceptable for two scalars. A fail-fast throw at DI resolution is the same behaviour the `budgetDefault` helper gives.

## New findings

- Moderate - `compaction-config-provider.ts:117` and `:234` use the literal `100_000` for the floor, in addition to `IDLE_MIN_TOKENS_FLOOR` (`idle-compaction.types.ts:10`) and the shared `advanced-settings.types.ts` copy. That makes at least three copies, and the new constructor guard adds one more literal. Import a single constant, or take the floor from shared. This is the same drift risk as before, now with a fourth literal.
- Minor - `idle-compaction.service.ts:393` takes `reason: string`, so the log reasons (`group-failed`, `signal-failed`, `pipeline-failed`, `lookup-failed`) are not type-checked against the `IdleLogReason` union in the types file. Typing the parameter with `IdleLogReason`, or a sibling union, would catch misspelled reasons.
- Minor - `idle-compaction.helpers.ts:48-57` is an error class sitting between pure functions. Fine for now; move it to `idle-compaction.types.ts` if more error types arrive.

## Carried Moderate

- `idle-compaction.service.ts` constructor still uses positional optionals (`callbacks?`, `events?`, `workspace?`, `timing?`). The call sites stay unreadable. Prefer a trailing options object.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Barrel re-exports, never defines types | PASS | `src/index.ts:142-145` |
| Cross-lib access via the barrel | PASS | `helpers/index.ts:65-66` |
| Formatting owned by prettier | PASS (idle folder) | prettier --check clean |
| Files under 500 lines | PASS | service 488 |
| Constructor-resolved defaults like `budgetDefaults` | PASS | `compaction-config-provider.ts:96-122` |
| One source for shared constants | FAIL (Moderate) | `:117`, `:234` |

## Verdict

Recommendation: APPROVE. Both earlier Serious findings are resolved. What remains is a duplicated constant, a loosely typed log reason and the constructor shape, none of which is Blocking or Serious. Confidence: MEDIUM-HIGH, because the review was read-only and no tests were run.
