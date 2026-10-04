## Backend implementation — `TASK_2026_597`, batch 51

**Tasks completed**: 51.1 (`sessionBudget.*` file-based keys and defaults), 51.2 (`SessionBudgetConfigProvider`)

**Files**:

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/backend/platform-core/src/file-settings-keys.ts`
  - New `SESSION_BUDGET_SETTINGS_DEFAULTS`, built from shared `SESSION_BUDGET_SETTINGS`.
  - The ten keys are added to the end of `FILE_BASED_SETTINGS_KEYS`, and their defaults to the end of
    `FILE_BASED_SETTINGS_DEFAULTS`.
  - Nothing existing moved: the TASK_2026_609 `agentGeneration.models` and Batch 37 `subagentPromptCacheTtl` entries
    stay where they were.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/backend/platform-core/src/file-settings-keys.spec.ts`
  - New describe block. It names the ten keys and their defaults literally.
  - It checks the key set matches the shared table exactly.
  - It checks the `null` default for `tightenWindowTokens` is returned as `null` by a real `PtahFileSettingsManager`
    in a temp dir.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts`
  - `@injectable() SessionBudgetConfigProvider.getConfig(): SessionBudgetConfig`.
  - Reads through `ConfigManager` on every call, with no cache.
  - Each value is checked against the shared bounds: type, finite, integer when required, min/max, and `null` only
    for nullable settings. The tighten/handoff order uses `isSessionBudgetPercentOrderValid`; a pair out of order
    falls back to both defaults.
  - A bad value logs WARN once per key and value; repeats of the same value are de-duplicated with a bounded
    `Map` (key → last rejected value).
  - If the store throws, all defaults are returned and one WARN is logged.
  - Rejected strings are never echoed in logs; the log shows only their type.
  - Also exports `SESSION_BUDGET_DEFAULT_CONFIG`.
  - Not registered in DI and not added to the agent-sdk barrel; both belong to Batch 55.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget/libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.spec.ts` — 94 tests:
  - min, max, min−1 step and max+1 step for all seven numeric settings;
  - wrong types (numeric string, boolean, NaN, Infinity, object);
  - fractions rejected for integer settings, and a fractional `usd` accepted;
  - `null` window, and `null` on non-nullable settings;
  - booleans and the unit enum;
  - tighten < handoff (equal, above, and a valid handoff below the default tighten);
  - WARN once per value, with a re-warn when the value changes, and no string echoed;
  - a change seen on the next call;
  - a throwing store returns defaults with one WARN;
  - AS-N7a: no `sessionBudget.*` key in `KNOWN_CONFIG_KEYS`.

**Stack observed**:

- tsyringe `@injectable` / `@inject(TOKENS.CONFIG_MANAGER | TOKENS.LOGGER)`, copied from `compaction-config-provider.ts`.
- Validation is hand-written guards: `ConfigManager.get` returns `unknown`, as in the compaction provider.
- `ConfigManager.get` throws when the file store is not configured (`vscode-core/src/config/config-manager.ts:106-113`).
  This is the "unreadable" path.
- `PtahFileSettingsManager.get` returns a registered `null` default as `null` (`file-settings-manager.ts:103-111`).
- platform-core → shared is allowed: both projects are tagged `scope:shared` (`eslint.config` `onlyDependOnLibsWithTags`),
  and platform-core already imports shared types.

**Verification**:

- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-core @ptah-extension/agent-sdk ptah-extension-vscode ptah-electron ptah-cli`
  — 10/10 targets succeeded.
- `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli --maxWorkers=2`
  - platform-core, agent-sdk, platform-vscode and platform-cli passed.
  - platform-electron failed only `workspace-watch-host.stress.spec.ts`, because the `.mjs` was missing. After
    `npx nx run ptah-electron:build-workspace-watch-host`, the re-run passed: 37 suites passed, 2 skipped; 667 tests
    passed, 4 skipped, 3 todo.
- The two touched specs run directly: provider spec 94/94, `file-settings-keys.spec.ts` 254/254.
- The agent-sdk typecheck and test ran with Batch 52's in-progress edits in the same tree, and both were green.

**Plan deviations**:

- Defaults are derived from `SESSION_BUDGET_SETTINGS`, not written out again as literals, so the table has one
  source. That source needs a value import from `@ptah-extension/shared` in `file-settings-keys.ts`, which is
  allowed by the boundary rules. The spec still states the ten values literally.
- `SESSION_BUDGET_DEFAULT_CONFIG` is exported from the provider file for reuse and specs. It is not in the barrel.

**Out-of-scope observations**: none
