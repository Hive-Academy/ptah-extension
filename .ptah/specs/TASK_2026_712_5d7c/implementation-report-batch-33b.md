# Implementation report — TASK_2026_712, Batch 33b

Executor: frontend-developer subagent (Claude). Moved here by D31 and D34. No commits, no checks run
beyond `ptah_get_diagnostics` (per the batch rules).

## Changes

| File | Lines | Change |
| --- | --- | --- |
| `libs/frontend/core/src/lib/services/providers-settings.types.ts` | 63-77 | `claudeModel` and `claudeReasoningEffort` folded into `ProvidersOrchestrationField` (after `piModel` / `piReasoningEffort`, the same place the other per-CLI model and effort keys sit). The separate `ProvidersClaudeOrchestrationField` type and its "read only, kept out of the patch" comment are deleted; `ProvidersOrchestration` (Pick) no longer lists it, its key set is unchanged. `ProvidersSettingsPatch.orchestration` now accepts both fields through the existing `ProvidersOrchestrationField` union. |
| `libs/frontend/core/src/lib/services/providers-commit.service.ts` | 158, 162 | `'claudeModel'` and `'claudeReasoningEffort'` added to the per-field orchestration loop in `operations()`, right after `piModel` / `piReasoningEffort`. Same write + read-back as every other per-CLI field; no new code path. |
| `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts` | 779-852 | 3 new tests (5 cases), see "Specs added". |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.ts` | 21, 79-82 | `'claude'` added to `PENDING_USER_REVIEW_IDS`; the claude note comment now says "pending user review" like the other new-copy notes, and the "not yet listed because the spec pins it" sentence is removed. |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.spec.ts` | 102-112 | Pin updated to include `'claude'`; new test that the Claude note equals the Ptah CLI note (same Autopilot mapping). |

## Required change outside my ownership (not edited)

`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:84` re-exports the deleted type.
Delete this one line from the `export type { … } from './providers-settings.types';` block (lines 66-85):

```ts
  ProvidersClaudeOrchestrationField,
```

Without it the core lib does not compile (TS2305, no exported member). The type has no other consumer
in the repository (searched: only this re-export and `implementation-report-batch-29.md`).

## Write-path trace (Claude lane model / effort)

1. Producer: `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts:577-586`
   `orchestrationPatch(key, value)` builds `{ orchestration: { [key]: value } }` with
   `key ∈ CliModelSettingKey | CliEffortSettingKey`, which already contains `claudeModel` /
   `claudeReasoningEffort` (`cli-matrix-rows.ts:24,33,189-190`). Before this batch that patch compiled
   (a variable, so no excess-property check) but `operations()` had no entry for the two keys, so a
   Claude lane save produced **zero operations** and was silently dropped. Now it produces one operation
   per field.
2. Commit: `providers-commit.service.ts:150-183`. Per present field: `fields =
   ['agentOrchestration.<field>']`, `write = agent:setConfig({ [field]: value })` → `success`,
   `readBack = sameSetting((await agent:getConfig())[field], value)` (strict `===` for strings).
   One RPC per field, in the fixed loop order (`claudeModel` with the models, `claudeReasoningEffort`
   after `piReasoningEffort`).
3. Host handler: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
   - Validation: `claudeModel` is in `CLI_MODEL_KEYS` (:101-110), must be a string (`invalidCliModel`);
     `claudeReasoningEffort` must be in `CLAUDE_REASONING_EFFORT_VALUES` (:134; values
     `'' | 'inherit' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, `rpc-agents.types.ts:366-374`).
   - Write: `claudeModel` stored **trimmed** (:802-806); `claudeReasoningEffort` stored as sent (:874-879).
     Both via `setAgentCfg` (:1753) → `workspace.setConfiguration('ptah', 'agentOrchestration.<name>', value)`.
   - Key / scope: `agentOrchestration.claudeModel` and `agentOrchestration.claudeReasoningEffort` are
     file-based settings keys (`libs/backend/platform-core/src/file-settings-keys.ts:122-123`, defaults
     `''` at :340-341), so on Electron they are written to the Ptah settings file, the same store and
     scope as `piModel` / `piReasoningEffort`. No scope parameter is sent; the commit has no per-field
     scope for orchestration keys, same as the other per-CLI fields.
   - Read: `agent:getConfig` returns `getAgentCfg('claudeModel', '')` (:496) and
     `getAgentCfg('claudeReasoningEffort', '')` (:539-540).
4. Read-back comparison: stored string `===` requested string. Consequences (identical to the existing
   per-CLI model fields): a model with leading/trailing whitespace is stored trimmed and reads back as
   `unsaved` (the popover already trims; not a new behaviour); a host that does not report the field
   (`claudeModel?` / `claudeReasoningEffort?` optional in the result) reads back `undefined` and the
   write is reported unsaved, never promoted (D15). An invalid effort is rejected by the host
   (`success: false`) → `failed`, no read-back.

## Decisions

- **D33b-1 — Fold the Claude fields into `ProvidersOrchestrationField` and delete
  `ProvidersClaudeOrchestrationField`.** Options: (a) fold and delete; (b) keep the named subset and
  union it into the patch. Evidence: every other per-CLI model/effort key lives in
  `ProvidersOrchestrationField`, and the separate type existed only to keep the fields out of the
  patch while there was no write path (its own comment); no consumer besides one re-export. Chose (a)
  (no leftover alias). Cost: one-line deletion in `providers-settings-state.service.ts:84` (reported
  above). Reversible.
- **D33b-2 — `claude` belongs in `PENDING_USER_REVIEW_IDS`.** Options: list it, or leave it out.
  Evidence: the list's doc comment defines it as "CLI ids whose copy is new in this task and still
  needs the user's review … The other ids reuse the pre-#575 wording (#70)". The claude note is new
  copy (Batch 26d, no pre-#575 wording exists for a Claude lane); the comment at its definition said it
  was left out only because the spec pinned the list, not on the merits. The two other new notes,
  `ptah-cli` (identical wording) and `grok` (TASK_2026_617), are listed. The list has no runtime
  consumer (only the spec), so listing it changes no UI. Reversible.
- **D33b-3 — Not adding `grokReasoningEffort` / `antigravityReasoningEffort` to the commit loop.**
  They are in `ProvidersOrchestrationField` (so the patch accepts them) but absent from the
  `operations()` loop — the same silent-drop class this batch fixes for Claude. Left out because D32
  routes the open question (they are not in `file-settings-keys.ts`) to Batch 34 and the batch asked
  for the Claude fields only. Flagged below.

## Specs added

- `providers-commit.service.spec.ts`
  - "writes the Claude lane model and effort one field per call and confirms each by read-back":
    both fields → `saved` in loop order; two separate `agent:setConfig` calls with
    `{ claudeModel }` and `{ claudeReasoningEffort }`.
  - "writes an empty Claude lane model (SDK default) and confirms it by read-back": `''` is a value,
    not skipped.
  - `it.each` "a Claude lane effort read back as %s is not saved": different value (`'low'`) and absent
    field → `failed`, `unsaved: ['agentOrchestration.claudeReasoningEffort']`.
- `cli-permission-notes.spec.ts`
  - "describes the system Claude lane by the chat Autopilot level it follows" (note equals the
    Ptah CLI note).
  - Pin updated: `['claude', 'copilot', 'grok', 'ptah-cli']`.

## Specs that use changed members

Searched `**/*.spec.ts` for `ProvidersSettingsPatch`, `ProvidersOrchestration`,
`ProvidersCommitService` and `PENDING_USER_REVIEW_IDS`. The changes only widen
`ProvidersSettingsPatch.orchestration` (two more optional keys) and leave the key set of
`ProvidersOrchestration` unchanged; `operations()` / `run()` signatures are unchanged. All still compile:

- `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts` — modified here; compiles.
- `libs/frontend/core/src/lib/services/providers-connection-setup.service.spec.ts` — unaffected.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts` (`{ orchestration: { codexModel } }`) — unaffected.
- `libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.spec.ts` — unaffected.
- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.spec.ts` — unaffected.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts` — unaffected.
- `libs/frontend/chat/src/lib/settings/ptah-ai/copilot-auto-approve-toggle.component.spec.ts` — unaffected (own local patch type).
- `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.spec.ts` — unaffected.
- `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts` — unaffected.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.spec.ts` — unaffected;
  a Claude-row save in that component now produces a real write (behaviour change, intended).
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.spec.ts` — modified here.

## Diagnostics

`ptah_get_diagnostics` with `files` = the 5 changed files, severity error: **"No diagnostics in the
requested files."** The tool also listed 347 pre-existing errors in unrelated sibling spec files
(`agent-card-truncation.spec.ts`, `chat-input.component.spec.ts`, `compact-session-card.component.spec.ts`,
…; spec-typing noise from the desktop checker, none in files touched here). It did not surface the
expected TS2305 at `providers-settings-state.service.ts:84`, but that line re-exports a type this
batch deletes, so it must be removed (see "Required change outside my ownership").
Not run (per batch rules, orchestrator owns them): `npx nx test core --parallel=1`,
`npx nx test chat --parallel=1`, `npx nx typecheck core`, `npx nx typecheck chat`,
`npx nx typecheck ptah-extension-webview`, lint of the 5 files.

## Out-of-scope observations

- `grokReasoningEffort` / `antigravityReasoningEffort` are accepted by `ProvidersSettingsPatch` but
  dropped by `ProvidersCommitService.operations()` (no loop entry), and they are not file-based keys
  (`file-settings-keys.ts` has no entry). Batch 34 (D32) should decide both together.
