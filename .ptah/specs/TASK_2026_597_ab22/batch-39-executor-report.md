# Batch 39 executor report: N1 setting and env-override display in the UI

Executor: frontend-developer. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-597-followups`. Not committed.

## Tasks completed

- 39.1 State carries the TTL setting and env override
- 39.2 `subagent-cache-ttl-setting` component, mounted in Orchestration settings

## Files

All paths under `D:/projects/ptah-extension/.claude-worktrees/task-597-followups/`.

- MODIFIED `libs/frontend/core/src/lib/services/providers-settings.types.ts`: `'subagentPromptCacheTtl'` added to `ProvidersOrchestrationPolicyField`, which puts it on both the patch and `ProvidersOrchestration`. `'subagentPromptCacheTtlEnvOverride'` is added to the `ProvidersOrchestration` Pick only, so it is read-only and cannot be patched. Both stay optional (Pick of optional RPC fields), so no existing `ProvidersOrchestration` literal had to change.
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`: `refreshOrchestration` reads `subagentPromptCacheTtl`. A missing value, or one outside `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS`, becomes `'auto'`. It also passes `subagentPromptCacheTtlEnvOverride` through, and a missing one stays `undefined` (no override).
- MODIFIED `libs/frontend/core/src/lib/services/providers-commit.service.ts`: `'subagentPromptCacheTtl'` added to the existing orchestration write and read-back loop (`agent:setConfig`, then `agent:getConfig` with `sameSetting`).
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts`: the projection test now expects `'auto'` and no override for a host without the fields. Two new tests: a read with `'5m'` and `'invalid'`, and an unknown value read as `'auto'`.
- MODIFIED `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts`: one new test for a TTL-only write that saves on read-back and sends only `{ subagentPromptCacheTtl }` (never the override). Two new cases where the read-back is a different value or missing, and the write is not saved.
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.ts`: standalone, OnPush, uses `inject()` and signals. It has a labelled `<select>` with the options "Auto (1 hour for sessions with subagents)", "5 minutes" and "1 hour". It saves through `SettingsSaveFeedbackService.save` (toast and Undo) and `state.saveSettings({ orchestration: { subagentPromptCacheTtl } })`. The select shows only the read-back value (D15). After a write with an unknown outcome it shows "Unknown", takes no writes, and offers "Check saved setting again". When the override is set, the select stays editable and a notice is linked to it through `aria-describedby`:
  - `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=<value> is set in your environment and takes precedence.`
  - for `invalid`: `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL has an invalid value and is ignored by Ptah.`
  - There is no "not passed to the SDK" notice.
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.spec.ts`: 9 tests:
  - the options and label, with no notice when there is no override
  - write, read-back, toast and Undo
  - an override of `5m` and of `1h`: the notice text, and the select stays editable and writes
  - an `invalid` override
  - a rejected write
  - an unconfirmed write, then re-check
  - choosing the same value writes nothing
  - an unloaded read, then re-check
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` (kept small, F10): one import, one `imports` entry, and one `@defer (on viewport)` block placed after the CLI matrix. Its `@placeholder` has the same footprint as the card (`min-h-[2.75rem] rounded-xl border border-base-300 bg-base-200/40`, `aria-busy`).
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts`: adds a TTL stub, and a test that checks the placeholder state, the complete state, and that the card sits after the CLI matrix and before the background roles.

## Stack observed

- Angular standalone components, OnPush, `inject()`, `signal` / `computed`, with built-in control flow and `@defer` (`orchestration-settings.component.ts`).
- State lives in `ProvidersSettingsStateService` with its section signals, and writes go through `ProvidersCommitService` (`providers-commit.service.ts:181-205`).
- Save feedback comes from `SettingsSaveFeedbackService`, and busy controls use `SettingsBusyDisabledDirective` (`copilot-auto-approve-toggle.component.ts`).
- Styling is DaisyUI and Tailwind: `select select-bordered select-xs` as in `elevenlabs-panel.component.ts:334`, and the section card classes of `agent-orchestration-config.component.ts:54`.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/webview-e2e-harness ptah-extension-webview 2>&1 | tail -40` gave "Successfully ran targets typecheck, lint for 4 projects" (8 tasks).
- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat --maxWorkers=2` gave "Successfully ran target test for 2 projects". The first run had 1 failure in my new spec (the select fell back to the first enabled option while the outcome was unknown). I fixed it by making the "Unknown" option `selected`, and the re-run is green. A direct jest run of the two chat specs I touched gave 33/33.
- I took no screenshots, as instructed. QA takes the Mode 3 before and after screenshots, dark and light, of Settings → Orchestration, with the "before" from `5bb19f9fb`.
- I could not check the end-to-end read-back against Batch 38 here, because Batch 38 is running in parallel. The specs mock the RPC, as batches.md § PR 2 scope (dependency on 38) allows.

## Deviations

- The batch did not specify a separate "Unknown" state for the select. While a write's outcome is unknown, the select shows an "Unknown" placeholder option instead of the old value. This is the select version of the Copilot toggle's indeterminate state, and the reason is D15.
- Read-back uses strict equality like the other policy fields. A host that does not return the field yet (before Batch 38) reports the write as not saved rather than assuming it saved. This is covered by a spec.
- Mount position: after the CLI matrix and before the read-error rows and background roles. The batch did not specify a position.

## Out-of-scope observations

- `git status` also shows Batch 38 files (agent-sdk, rpc-handlers) and a modified `batches.md`. These belong to the parallel batch and the team-leader, and I did not touch them.
