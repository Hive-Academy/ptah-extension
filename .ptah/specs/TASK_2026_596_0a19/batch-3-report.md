# Backend implementation — `TASK_2026_596_0a19`, batch 3

**Tasks completed**: 3.1 (`window-state.ts`, `lane-state.ts`, barrel update), 3.2 (`plan-limit-format.ts`)

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\window-state.ts`: `classifyWindow`, `classifyOwnerEvidence`, `isActiveLimitEvidence`, `resetPassage`, `activeWindowExhaustion`, `activeEstimatedExhaustion`, `usedPercent`, `windowObservedAt`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\window-state.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\lane-state.ts`: `ownerRelation`, `applicableWindows`, `applicableOwnerEvidence`, `applicableLimits`, `windowModelScope`, `classifyLaneState`, `groupAlternatives`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\lane-state.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\plan-limit-format.ts`: `formatRelative`, `formatLocalAbsolute`, `formatLocalWithRelative`, `formatToolUtc`, `formatToolInstant`, `PLAN_LIMIT_SOURCE_LABELS`, `windowFieldSources`, `formatSourceChips`, `formatToolSourceText`, `formatUsed`, `formatToolResetText`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\plan-limit-format.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\index.ts`: named exports for the three new modules
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\index.ts`: named re-exports so the new API reaches `@ptah-extension/shared`. Plan Component 2 lists this file as MODIFY; see the deviations section.

## Stack observed

- TypeScript library `@ptah-extension/shared`. The targets typecheck, test (`@nx/jest`, ts-jest, node environment) and lint come from `libs/shared/project.json`.
- The library is zod-free, as `libs/shared/src/index.ts` and the header of `plan-limit.types.ts` require.
- Pure-util pattern and file layout follow the Batch 2 files `instants.ts` and `evidence-precedence.ts`.
- Barrels use explicit named exports, following the existing `utils/index.ts` and `plan-limits/index.ts`.
- There is no DI or registration; these are plain module functions.

## Per-task evidence

### Task 3.1

- **First-match order (Decision 1, design §2.1).** `classifyWindow` checks the states in this order: `limit-reached`, `reset-usage-unknown`, `usage-unknown`, `estimate-only`, `aged`, `not-confirmed`, `near-limit`, `ok`. The spec has one case per rule. It also pins that rule 2 runs before stale and aged, and that rule 1 wins over stale and aged.
- **Active-limit test.** `isActiveLimitEvidence` is the one shared test: not `estimated`, and the reset is unknown or still ahead. The window state, the owner-level lane state and later surfaces all use it, which matches design §3.2, "the same active non-estimated test".
- **Effective reset of a window exhaustion.** It is the exhaustion's own reset. If the exhaustion has none, it is the window reset, but only when that window reset is later than the exhaustion's observation. An older window reset cannot clear a newer limit hit.
- **`resetPassage`.** It returns the reset that came after the last observation (case a or b) separately from the next reset. Design Rev 3 finding 4b needs these as two facts.
- **`ownerRelation` (R7).** It returns `unknown` when either side is missing or has kind `unknown`, even when the keys are equal. It returns `different` when the providers differ, or when the kinds match and the keys differ. It returns `unknown` for two known kinds that differ on one provider. Otherwise it returns `same`. The spec tests this three ways:
  - an explicit 13-row `it.each` table, checked in both argument orders;
  - a dedicated R7 case;
  - a generated truth table over 4×4 kinds × provider × key (64 combinations), which checks the rule and symmetry.
- **`applicableWindows` (Req 4.5).** An unscoped window applies to every scope. A scoped window applies only to the same scope. The scope comes from `modelScope`, or from the `weekly_model:<scope>` key when `modelScope` is absent. Scopes are compared trimmed and case-insensitively. A `null` scope matches unscoped windows only. `applicableOwnerEvidence` applies the same rule to `OwnerLimitEvidence.modelScope`.
- **`classifyLaneState` (design §2.2).** States are checked in this order:
  1. at-limit: active non-estimated owner evidence, or any `limit-reached` window.
  2. near-limit.
  3. confirmed-room, which needs all of these:
     - no lookup failure;
     - status `available`;
     - the window set is established;
     - the window set is non-empty;
     - every window is `ok`;
     - no active cooldown;
     - no active estimated limit.
  4. unknown, with every blocking reason listed.

  Reasons are a typed union (`LaneStateReason`), so the UI and the tool text each word them their own way. A `limits` value of `undefined` means there is no snapshot for the lane's own owner. The lane is then `unknown` with reason `no-snapshot` or `lookup-failed`, and it borrows nothing.
- **`groupAlternatives`.** Returns the four groups and keeps input order. An empty roster gives four empty groups.

### Task 3.2

- **Time zone.** Callers pass it as a parameter: `LocalTimeOptions.timeZone` and `zoneNameLocale`. An unknown zone falls back to UTC instead of throwing.
- **"today".** It follows the local calendar day, not the UTC day. The spec covers 23:50 CEST → 00:10 CEST, which renders as "Mon 5 Oct 00:10 CEST".
- **Daylight saving.** The spec covers the CEST→CET change on 26 Oct.
- **Midnight.** It renders as `00`, not `24`, because the formatter uses `hourCycle: 'h23'`.
- **Sample outputs.**
  - Local: "today 15:10 CEST", "Thu 8 Oct 09:00 CEST".
  - Relative: "in 3h 10m", "22m ago", "in 1d 21h", "in 5h 0m".
  - Tool: "2026-10-04 15:10 UTC (in 3h 10m)".
- **Source labels.** Short labels as in design §1, "~ Estimate" included.
- **Chips.** One chip with no prefix when every claim shares a source. Otherwise each chip is prefixed with its fields, e.g. "used · reset Provider API" and "limit From error".
- **Tool source text.** For example "used+reset provider-api; limit error-derived", or `-` when no claim has a source.
- **`formatUsed`.** Returns "unknown" for an absent or non-finite value. It never returns 0 for an unknown value.
- **`formatToolResetText`.** Implements the design §5 wording "reset passed <t>; next reset <t|unknown>; last observed <t>, before it".
- **Brand guard.** A spec checks that `plan-limit-format.ts` contains no provider brand names (claude, anthropic, codex, openai, gemini, antigravity, ollama, opencode, glm).

## Fixtures covered

| Fixture | Spec |
| --- | --- |
| F2 | `plan-limit-format.spec.ts` "F2: API used beside an estimated reset…" (per-field sources: chips and tool text); `window-state.spec.ts` "F2: … is not estimate only" |
| F3 | `window-state.spec.ts` (usedPercent undefined, "usage unknown"); `plan-limit-format.spec.ts` (`formatUsed` → "unknown", no used-source claim); `lane-state.spec.ts` F3/F4 |
| F4 | `window-state.spec.ts` "F4 2a" plus the 2b cases; `plan-limit-format.spec.ts` "F4: reset passed…"; `lane-state.spec.ts` F3/F4 |
| F11 | `window-state.spec.ts` "F11: both exhausted with different resets" |
| F22 | `lane-state.spec.ts`: applicableWindows/Evidence F22, and the classifyLaneState F22 case (Opus lane at limit, Sonnet lane confirmed room) |
| F25 | `window-state.spec.ts` "F25: … 5-hour expires at 15:10 while the weekly one stays exhausted" (1 ms before, at the reset, after the weekly reset) |
| R7 truth table | `lane-state.spec.ts` "ownerRelation (Decision 3, R7)" |

The lane-state specs also cover F42, F43, F44, F45 and F46 at engine level. Batch 14 and Batch 22 still own the tool-text versions.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=2 --skip-nx-cache` passed all three targets (typecheck, test, lint). This is the run after the prettier pass.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/plan-limits --maxWorkers=2`: 5 suites, 171 tests, all passing. This confirms the new specs ran.
- `grep -rn "Date.now" libs/shared/src/lib/utils/plan-limits` found nothing. No zod import anywhere in `plan-limits/`.
- Prettier flagged the 6 new files, so I ran `prettier --write` on them and re-ran the targets above.

## Plan deviations

1. **`utils/index.ts` edited.** The batch's file list for Task 3.1 names only `plan-limits/index.ts`. But `utils/index.ts` re-exports plan-limits by name, so without this edit the new API would not reach `@ptah-extension/shared` consumers in Batches 13, 14 and 18-21. Plan Component 2 (`implementation-plan.md:561`) lists the file as MODIFY. The edit only adds named exports.
2. **`status` moved out of the lane context.** Decision 1 puts `status` in `ctx`. `classifyWindow` takes `PlanLimitStateContext {now, nearLimitPercent, freshnessMs, status}` exactly as written. `classifyLaneState` instead reads `status` from `ApplicableLimits`, which carries status, windowSetEstablished, windows, ownerEvidence and cooldown. Its context is `LaneStateContext` (the same fields minus `status`, plus `lookupFailure?`). This keeps status tied to the owner snapshot it describes. There is no `lookup-failed` member in `ProviderAccountUsageStatus`, so a lookup failure has to come in from outside the snapshot.
3. **Extra pure helpers.** I exported `resetPassage`, `formatUsed`, `formatToolResetText`, `formatLocalWithRelative`, `windowFieldSources`, `isActiveLimitEvidence` and `active*Exhaustion`. Each one carries a design rule word for word (§2.1 rule 2 and Rev 3 finding 4b, §0.4.4, §1, §3.2 "same active test", §5 reset cell) that the UI batches (18-21) and the tool batch (14) would otherwise have to re-derive separately.

## Risk and edge-case handling

- **Unknown is never 0.** An absent, NaN or zero-limit amount gives no percent and the `usage-unknown` state; `formatUsed` renders "unknown".
- **Reset passed with no newer read.** The state is `reset-usage-unknown`, checked before age and stale. The passed reset and the next reset stay separate facts.
- **Opus-only exhaustion stays out of Sonnet scope.** Scoped windows and scoped owner evidence are filtered by scope; the F22 spec covers it.
- **R7.** `ownerRelation` returns `unknown` for any side with kind `unknown`, regardless of keys.
- **Estimated evidence.** It never makes a window or lane at-limit (Req 5). As a conservative addition, an active estimated limit also blocks confirmed room (reason `estimated-limit`), because Req 5 room needs "no active exhaustion".
- **Exhaustion with an unknown reset.** It stays active in the engine. Clearing it (a newer same-allowance read, a `plan` success, the longest-window elapse, or a restart) is the ledger's job in Batch 8, per Decision 4.
- **Carry-forward from Batch 2.** Freshness is measured from `usedObservedAt ?? observedAt` as stamped on the window, so stale data re-served later still ages from its original observation. The engine never re-stamps.
- **Lane with unknown model scope.** It matches unscoped windows only, following the prototype `laneState` (`!w.scope || w.scope === scope`). Such a lane could show room while a model-scoped window it might use is exhausted. Batches 13 and 18 should pass the lane's resolved scope whenever it is known.
- **Locale and zone safety.** Weekday, month and digits always come from `en-US`, so the surrounding English text stays consistent. Only the zone abbreviation follows `zoneNameLocale`. The same zone reads "CEST" under `en-GB` but "GMT+2" under `en-US`, so the webview's choice of locale decides the abbreviation (T1). Specs pin both locales.

## Out-of-scope observations

- None in code. The `session-stats-summary.component.*` changes in the working tree are the pre-existing Context rename reserved for Batch 16; I did not touch them.
