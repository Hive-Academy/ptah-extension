# Batch 52 executor report — TASK_2026_597, N7 per-session auto-compact window override

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-597-session-budget`. Not committed.

## Tasks completed

- 52.1 Query mirror member and session record field
- 52.2 `applySessionAutoCompactWindow` with read-back and restore

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
  - New exported `ContextUsageReadBack { autoCompactThreshold?: number; isAutoCompactEnabled: boolean }`, narrowed from
    SDK `SDKControlGetContextUsageResponse` (`sdk.d.ts:3739-3808`).
  - `Query.getContextUsage?(): Promise<ContextUsageReadBack>` is OPTIONAL (AS-N7c), so existing fakes compile.
  - `SessionControl` now gets a `() => provider.getConfig()` getter (or `null` when the optional
    `SDK_COMPACTION_CONFIG_PROVIDER` is absent).
  - New facade delegate `applySessionAutoCompactWindow(sessionId, window | null)`. It follows the existing
    `setSessionEffort` delegate pattern, because `SessionControl` is not DI-registered and Batch 54's service needs a
    reachable entry point.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`: the
  `SessionRecord.autoCompactOverride?: number | null` field.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`
  - Optional trailing constructor param `getCompactionConfig: (() => CompactionConfig) | null = null`.
  - `applyAutoCompactConfig` sends `rec.autoCompactOverride` when it is a number and logs it with
    `source: 'session-override'`.
  - `applySessionAutoCompactWindow(sessionId, window | null): Promise<SessionBudgetWindow | undefined>`. It never throws.
    - Lower path, in order:
      1. Unknown session, no query, or a window outside the runtime range: `failed`.
      2. `envWindow` set: `env-override`.
      3. No `getContextUsage` on the query: `failed`.
      4. Read back the threshold; if it is already ≤ target: `already-lower`.
      5. Record the override, then send it.
      6. Read back again. If the threshold is ≤ target, return `{target, applied: true}` and log INFO "E2 passed for
         this model class".
      7. Otherwise clear the override, WARN once with `modelClass` and both thresholds (the E2 record), send `null` back,
         and return `not-honoured`.
      8. Any throw or timeout: restore the previous override and return `failed`.
    - Restore path (`null`):
      - No override recorded: return `undefined` and send nothing.
      - Otherwise send `resolveAutoCompactControl(current config)`. That is the configured window, or `null` when
        nothing is configured or compaction is disabled. It never sends a class default.
      - Then clear the override and return `undefined`.
      - If that send throws: keep the override and return `{target: override, applied: true, reason: 'failed'}`.
  - The 5 s timeout (`AUTO_COMPACT_APPLY_TIMEOUT_MS`) moved into the private `withApplyTimeout` helper. The existing
    live apply uses it with unchanged behaviour; its existing timeout spec still passes.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts`: 13 new cases.
  - The override survives a config re-apply.
  - A read-back miss sends `null` back, drops the override, and WARNs once with `modelClass: 'proxied'`.
  - Env skip, `already-lower`, and a timeout (`failed`, override restored).
  - `getContextUsage` absent gives `failed`, and an unknown session gives `failed`.
  - Restore sends the configured window; restore sends `null` when nothing is configured; restore with no override
    sends nothing; a failed restore keeps the override.
  - `A1_DEFAULT_WINDOW` is still `{claude: null, proxied: null}`.

`auto-compact-control.ts` is untouched (`git diff` on it is empty), so `A1_DEFAULT_WINDOW` stays null. The
system-prompt parts of `sdk-query-options-builder.ts` are untouched.

## Stack observed

- `SessionControl` and `SessionRegistry` are plain classes that the facade constructs (header comments in both files).
- `SessionLifecycleManager` is tsyringe-injectable, and `CompactionConfigProvider` is optional-injected
  (`session-lifecycle-manager.ts:359-360`).
- Logging uses the vscode-core `Logger` with `[SessionLifecycle]` prefixes.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers ptah-extension-vscode ptah-electron ptah-cli`
  → "Successfully ran targets typecheck, lint for 6 projects" (12 tasks).
- `npx nx run-many -t test -p @ptah-extension/agent-sdk --maxWorkers=2` → "Successfully ran target test for project
  @ptah-extension/agent-sdk".
- Direct spec run: `session-control.service.spec.ts` 29/29 passed.
- The diff shows no change to `A1_DEFAULT_WINDOW`.

## Deviations and decisions

1. Facade delegate added on `SessionLifecycleManager`. It is not named in 52.1, but that file is in the batch and
   `SessionControl` is otherwise unreachable for Batch 54.
2. `SessionControl` gets a config getter, an optional trailing constructor arg. The signature `(sessionId, window|null)`
   needs `envWindow` and the configured window from somewhere. Existing constructions compile unchanged.
3. A failed restore reports `applied: true, reason: 'failed'`. The lowered window is still in place, so the
   restore-window affordance must stay. This contradicts the shared doc line "`reason` present when `applied` is
   false". The alternative is `applied: false`, which would hide a window that is still lowered. Reviewer: confirm or
   change.
4. Return type is `SessionBudgetWindow | undefined`. A successful restore, or a restore with no override, returns
   `undefined`, meaning no window part.
5. "Injectable timeout": the existing apply uses a module constant tested with jest fake timers. The new method shares
   it through `withApplyTimeout`, the same mechanism; no constructor knob was added.

## Out-of-scope observations

- A read-back miss sends `null` as the plan says. For a session whose user also configured `compaction.threshold`,
  `null` clears that flag-layer window until the next config re-apply or session start. Sending the resolved configured
  value, as restore does, may be preferable. This follows the plan literally; the reviewer should confirm.
- The working tree also has Batch 51's `platform-core/src/file-settings-keys.ts` (+ spec) changes. They are not from
  this batch.
