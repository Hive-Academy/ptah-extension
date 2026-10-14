# Backend batch report - TASK_2026_658 (Components 1-4)

Worktree: D:\projects\ptah-extension\.claude-worktrees\feat-advanced-settings-ui (branch
feat/advanced-settings-ui). Nothing committed; working tree left dirty for the orchestrator.

## Status

- [x] Component 1 - shared table and validator
- [x] Component 2 - platform-core defaults derivation
- [x] Component 3 - memory-curator drift guard
- [x] Component 4 - settings:set boundary validation

## Files (relative to the worktree)

### Component 1 - shared

- CREATED `libs/shared/src/lib/types/advanced-settings.types.ts`: `AdvancedSettingGroupId`,
  `AdvancedSettingApply` (`live | next-run | next-agent | restart`), `AdvancedNumberSetting` /
  `AdvancedBooleanSetting` (discriminated on `kind`), `AdvancedSetting`, `AdvancedSettingGroup`,
  `AdvancedSettingValidation`, `ADVANCED_SETTING_GROUPS` (7 groups), `ADVANCED_SETTINGS`
  (27 descriptors, bounds/defaults/apply exactly as plan rows 56-82), `findAdvancedSetting(key)`,
  `validateAdvancedSettingValue(setting, value)`. Pure, never throws. Error copy:
  "Use a whole number from 7 to 365 days." / "Use a number from 0 to 1." (no unit) /
  "Use on or off." (booleans). Bounds are printed with en-US thousands separators
  ("1,000 to 100,000,000 weighted tokens").
- CREATED `libs/shared/src/lib/types/advanced-settings.types.spec.ts`: 27 unique keys, group
  ids/titles, every group non-empty, label/help non-empty, each default accepted by its own
  validator, literal pins of all 24 numeric bounds + integer flag, the 3 boolean keys, refusals
  (below/above, fraction, NaN, +/-Infinity, numeric string, null, undefined, boolean; booleans
  refuse string/number/null/undefined), cron.maxConcurrentJobs 0 refused.
- MODIFIED `libs/shared/src/index.ts`: one `export * from './lib/types/advanced-settings.types';`
  after the session-budget line.

### Component 2 - platform-core

- MODIFIED `libs/backend/platform-core/src/file-settings-keys.ts`: imports `ADVANCED_SETTINGS`;
  new `ADVANCED_SETTINGS_DEFAULTS` derived like `SESSION_BUDGET_SETTINGS_DEFAULTS`; spread at the
  end of `FILE_BASED_SETTINGS_DEFAULTS`; the 25 literal entries deleted (short pointer comments left
  where the old comments carried consumer-parity notes); the harness key-list comment rewritten
  (the keys now have defaults 1500 / true, equal to harness-sync's constants).
- MODIFIED `libs/backend/platform-core/src/file-settings-keys.spec.ts`: new block
  "Settings advanced keys (TASK_2026_658)": literal pin of all 27 defaults (the 25 pre-change
  literal values + harness 1500/true), key-for-key equality with the shared table, and a file-store
  read-back test.
- Byte-identical check: `git diff -U0` on file-settings-keys.ts shows exactly 25 removed default
  lines and no other changed default literal; each removed value equals the descriptor default and
  is pinned literally in the spec. The pre-existing literal pins (compaction, codex, retention,
  lifecycle, internalQuery, judge panel, replayValidation, ...) still pass unchanged.

### Component 3 - memory-curator

- CREATED `libs/backend/memory-curator/src/lib/retention/advanced-settings-ranges.spec.ts`: for
  each of the 6 clamped fields, descriptor min/max equal `MEMORY_RETENTION_SETTING_RANGES` /
  `MEMORY_LIFECYCLE_SETTING_RANGES`, default equals `MEMORY_RETENTION_DEFAULTS` /
  `MEMORY_LIFECYCLE_DEFAULTS`, and `integer` is true (the clamp truncates). Keys are taken from
  `MEMORY_*_KEYS`, so a renamed key also fails.

### Component 4 - rpc-handlers

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts`: in
  `registerSet`, after the `isFileBasedSettingKey` guard, `findAdvancedSetting(key)`; when a
  descriptor exists and the validator refuses, return `{ success: false, error: <validator message> }`
  without calling `setConfiguration` and without logging; when it passes, write the validated value.
  Keys without a descriptor are unchanged. Imports from the `@ptah-extension/shared` barrel.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.spec.ts`: valid writes
  for 4 described keys (int, decimal, boolean, 0 = off); 7 refusals (below min, above max, fraction,
  numeric string, null, missing value, non-boolean) each assert the exact message, no write and no
  `logger.error`; `sessionBudget.tokens: 5` (no descriptor) is still written as given.

## A2 resolution

`skillSynthesis.judgePanel.disagreementThreshold` max = **9** (min 0, decimals allowed, default 3,
unit "points"). Each judge criterion is scored 1-10: `toScore` refuses anything outside 1..10
(libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:354-359) and the verdict JSON schema
says minimum 1, maximum 10 (:105-115). The panel compares `maxCriterionDelta` (largest per-criterion
absolute gap, judge-panel.service.ts:646-653) with the threshold using `<=` (:369-373), so no gap
can exceed 10 - 1 = 9; a higher threshold would mean "never escalate", which 9 already expresses.
The consumer accepts any finite value >= 0 (:628-643), so `integer: false`.

## Verification (run from the worktree)

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/advanced-settings.types.spec.ts --coverage=false --maxWorkers=2`
  -> 1 suite, 78 passed.
- `npx jest -c libs/backend/platform-core/jest.config.ts libs/backend/platform-core/src/file-settings-keys.spec.ts --coverage=false --maxWorkers=2`
  -> 1 suite, 286 passed (the console.warn ENOENT lines are the file store's normal
  first-load message, also printed by the pre-existing session-budget test).
- `npx jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/retention/advanced-settings-ranges.spec.ts --coverage=false --maxWorkers=2`
  -> 1 suite, 7 passed.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`
  -> 1 suite, 36 passed.
- `npx eslint <8 changed files>` -> exit 0, no errors or warnings except
  "No cached ProjectGraph is available", so `@nx/enforce-module-boundaries` was SKIPPED in this run
  (the orchestrator's `nx lint` will apply it; all new imports are scope:shared -> scope:shared or
  backend -> shared, which the plan cites as allowed).
- `npx prettier --write <8 changed files>` applied; `--check` clean.
- Type check: ts-jest compiles each spec and its imports with diagnostics on, and all four suites
  passed. `ptah_get_diagnostics` timed out (still running after 45 s), so no separate tsc result.
  `nx typecheck` not run, per instructions.

## Decisions

- No `step` field on number descriptors. The plan's architecture list mentions min/max/integer/step,
  but nothing reads a step: the validator does not enforce one and the Component 5 renderer uses a
  text input with `inputmode` derived from `integer`. Left out under the simplicity rule; add it with
  its first reader.
- `unit` is optional and absent only for `replayValidation.minConfidence` (a bare 0-1 ratio). Units:
  tokens, weighted tokens, queries, ms, days, records, memories, points, jobs.
- `apply` mapping: `next-run` is also used for the two skill-retirement keys (applies on the next
  retirement sweep); the renderer's "Applies on the next cleanup run." copy reads correctly for both.
- Validator messages carry the range and unit only, never the key or the value, so the backend
  refusal is safe to show inline and contains no secret.
- Booleans refuse with "Use on or off." to match a toggle UI rather than "true or false".
- Harness keys: the old platform-core comment said their defaults were deliberately left to
  harness-sync. The plan overrides that so `settings:get` returns a value; the comment now says the
  defaults must equal harness-sync's `DEFAULT_PREFLIGHT_TIMEOUT_MS` (1500) and
  `DEFAULT_MANAGE_GITIGNORE` (true), and the platform-core spec pins both literals.
- Help copy states what each value controls in one or two short sentences and was checked against
  the consumer (e.g. archive uses `last_used_at` and skips pinned memories; per-lane = per
  background feature; boot-scan backoff re-defers while the user chatted recently). It never restates
  range or apply timing.

## Plan deviations

- `step` omitted (see Decisions). Everything else as planned.

## Out-of-scope observations

- No spec ties harness-sync's `DEFAULT_PREFLIGHT_TIMEOUT_MS` / `DEFAULT_MANAGE_GITIGNORE` to the
  shared table. The platform-core spec pins the literals, but a change in harness-sync would not fail
  it. A small parity spec in `libs/backend/harness-sync` (like Component 3) would close that; not in
  this batch's file list.
- The same applies to the other consumer-side constants that duplicate the defaults
  (`SKILL_TRIGGER_DEFAULTS`, `JUDGE_PANEL_THRESHOLD_DEFAULT`, internal-query gate defaults, codex lane
  budgets). Their existing parity specs import `FILE_BASED_SETTINGS_DEFAULTS`, which still carries
  the same values, so they keep working.
