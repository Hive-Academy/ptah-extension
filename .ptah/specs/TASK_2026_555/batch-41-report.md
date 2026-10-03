# Batch 41 report — TASK_2026_555 (track B)

Author: Glm lane (started; usage limit), completed by in-process frontend-developer (Advanced owner)

Paths below are relative to `libs/frontend/chat/src/lib/` unless prefixed.

## Review of the lane's file

The Glm lane left `settings/pro-features/agent-behaviour-section.component.ts` unchecked. It was rewritten. The layout and the S-sel wiring were sound. Problems found:

1. **Stale typing.** It kept a local `WorkflowsSetParams` widening and an `as { workflowsDisabled?: boolean }` cast, both marked "until the shared types carry it". The shared types already do: `AgentOrchestrationConfig.workflowsDisabled` and `AgentSetConfigParams.workflowsDisabled` (`libs/shared/src/lib/types/rpc/rpc-agents.types.ts:131`, `:219`). Both are removed.
2. **Ultracode read-back reported a failed disable as saved.** `UltracodeStateService.disable()` flips `enabled` to false before the effort restore. If the restore fails, the lane's check `!enabled()` still passes. Its "revert" called `toggle(!next)` → `enable()`. That re-captures `xhigh` as the "previous" effort and traps the user at X-High. Fixed at the root in the service (see "Read-back design").
3. **Effort read-back hole.** Re-selecting the current level wrote it again. A failed write then rolls back to the same value and reads back as success. The rewrite treats re-selecting the current level as a no-op.
4. **Workflows failure message.** `agent:setConfig` reports a host failure as `{success:false, error}` inside a successful RPC. The lane showed `result.error`, which is `undefined` in that case. It now shows `result.data.error`.
5. **Silent load failure.** `agent:getConfig` had no try/catch and no failure path. The row showed "On" while the value was unknown. The checkbox now stays disabled until the value loads, and a failed load becomes an inline `role="alert"`.
6. **Empty Details column.** The lane added a "Details" column whose cells are all empty until Batch 42's drawer. It is dropped; Batch 42 adds it together with the drawer trigger.
7. **Accessibility.** The popover trigger had no `aria-haspopup`/`aria-expanded`, the choice buttons had no `aria-pressed`, and the disabled controls had no `aria-describedby` reason. All are added.

## Files

| File | Change |
|---|---|
| `settings/pro-features/agent-behaviour-section.component.ts` | CREATE (rewritten). The "Agent behaviour" P2 card with one P4 `table-xs` holding 4 rows, about 393 lines |
| `settings/pro-features/agent-behaviour-section.component.spec.ts` | CREATE. 21 specs |
| `settings/pro-features/workflows-config.component.ts` | DELETE (D14, atomic with the mount) |
| `settings/pro-features/workflows-config.component.spec.ts` | DELETE |
| `settings/advanced-settings.component.ts` | MODIFY. Mounts `ptah-agent-behaviour-section` after the Membership card, and `ptah-workflows-config` is removed |
| `settings/advanced-settings.component.spec.ts` | MODIFY. The stub swaps workflows for agent-behaviour, and the order test asserts `ptah-workflows-config` is gone |
| `settings/pro-features/enhanced-prompts-config.component.ts` | MODIFY (deviation 1). Removed the mode toggle and status badge (moved to A10/A11) and the PR-1 preset radios with their dead `systemPromptPreset` state |
| `services/ultracode-state.service.ts` | MODIFY (deviation 2). `enable`/`disable`/`toggle` read the effort back and return `boolean` |
| `services/ultracode-state.service.spec.ts` | MODIFY. Adds 3 failure-path specs |
| `services/message-sender.service.spec.ts` | MODIFY. The `EffortStateService` stub is now stateful (the read-back needs a readable write) |
| `settings/index.ts` | MODIFY. Removed the `WorkflowsConfigComponent` barrel export (no consumer in `apps/` or `libs/`) |
| `settings/output-style/output-style.store.ts` | MODIFY, comment only. Pointed a doc reference from the deleted file to `EffortStateService.setEffort` |
| `settings/settings.component.html` | MODIFY. `@defer` for the Advanced and Search & Voice tabs (bundle) |
| `settings/settings.component.ts` | MODIFY, comment only. A guard comment says the two tab classes may be referenced only through `@defer` |
| `settings/settings.component.spec.ts` | MODIFY. New "deferred tabs" suite (3 specs) |

No harness or e2e file changed: no selector was renamed (see "Harness / e2e").

## Rows met

| Row | How |
|---|---|
| A10 System prompt mode | "On" checkbox (G1), `aria-label="Toggle Enhanced System Prompt"` kept. It is disabled until a prompt exists, and the row text says why (`aria-describedby`, verbatim "Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project."). S-sel through `saveGeneric`: `enhancedPrompts:setEnabled`, then a status re-read. Undo writes the previous mode. |
| A11 status | P10 `badge badge-outline badge-sm` "Ptah Enhanced" (Sparkles icon `text-secondary`) or "Default", plus "Active for all sessions" / "Standard system prompt". Text is `text-base-content`. |
| A26 / G9 Chat reasoning effort | Label "Chat reasoning effort" with the sub-note "Same value as Providers > Main Agent effort". The value button + chevron opens a P5 `ptah-native-popover` (`placement="bottom-start"`, transparent backdrop, the voice-config precedent) holding the same 6 choices as `popover-effort-btn` buttons. S-sel, Undo = `setEffort(previous)`, with read-back. While Ultracode is on, the cell is disabled and the note adds "· Pinned to X-High by Ultracode" (the [LP] note in A29). |
| A27 Dynamic workflows | "On" checkbox, `aria-label="Toggle dynamic workflows"` kept. S-sel `agent:setConfig {workflowsDisabled}`, Undo = the inverse. The inline "Workflow preference updated." is replaced by the toast. |
| A28 / PR-2 | The sentence "Workflows require a paid plan." is removed (approved 2026-09-30). |
| A12 / PR-1 | The "Default for new sessions" radios are removed from `enhanced-prompts-config` (approved). |
| A29 Ultracode | "On" checkbox, `aria-label="Toggle Ultracode mode"` kept. S-sel, Undo = `toggle(!next)`. Turning it off restores the previous effort, read back in the service. The explanation copy is kept, including the `ultracode` keyword caveat. |

**Correction (rework round 1):** the original claim that D15 held on every row was wrong for A10. `writePromptMode` checked only `result.isSuccess()`, so a host `{success:false}` inside a successful RPC was toasted "Saved system prompt mode.". This is fixed, and every row now checks both layers (see "Rework round 1"). "Saved {label}." appears only after the write's own result. On failure, `checkbox.checked` is reset to the saved signal (the OnPush binding does not re-render an unchanged value) and `saveGeneric` raises the alert toast. D3: every control is disabled while `feedback.saving()`.

## Preserve list (map §4)

| Capability | Verdict | Where |
|---|---|---|
| Enhanced system prompt on/off | moved into the card | agent-behaviour row 1 |
| Ptah Enhanced / Default status text | moved | row 1 status cell |
| Preset radios | **removed, PR-1 approved** | — |
| Generated-at, stack, view, regenerate, download, empty-state | stays in `enhanced-prompts-config` (heading now "System Prompt") until the D-SP drawer in Batch 42 | `advanced-settings.component.ts` mount after the card |
| Reasoning effort, 6 choices incl. SDK default | stays (popover cell) | row 2 |
| Dynamic workflows on/off | stays | row 3 |
| "Workflows require a paid plan." | **removed, PR-2 approved** | — |
| Ultracode on/off + restore of the previous effort | stays | row 4, plus `UltracodeStateService` |
| `aria-label="Toggle Enhanced System Prompt"` (safe-list) | kept, and now exactly one on the page (the old toggle left `enhanced-prompts-config` in the same change) | row 1 |
| Deep-link tab ids `pro-features` / `tools` | unchanged | `settings.component.html` |

## Persisted writes (RPC → store key → runtime reader)

| Control | RPC | Store key | Runtime reader |
|---|---|---|---|
| **Chat reasoning effort (A26)** | `EffortStateService.setEffort` → `config:effort-set {effort, sessionId:null}` (`libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:663-710`); `applyTo` defaults to `'app'` (`:671`) | `ReasoningSettings.effort` → `provider.<authKey>.reasoningEffort` for the active provider, app scope (`libs/backend/settings-core/src/repositories/reasoning-settings.ts:42-47`) | `config:effort-get` (`config-rpc.handlers.ts:642`) → frontend `EffortStateService.currentEffort`, which the chat send passes as `effort` (`chat-session.service.ts:568`, `:1256`). CLI agents read it via `AgentSpawnEnvironment` (`libs/backend/cli-agent-runtime/.../agent-spawn-environment.service.ts:136`, `:141`). This is the same key as Providers > Main Agent effort (G9). |
| Ultracode (A29) | the same `config:effort-set` (pins `xhigh`, then restores the previous value) | the same key as above; the "on" flag itself is session-only (not persisted) | as above, plus `MessageSenderService` stamps `ultracode:` on human input while on |
| Dynamic workflows (A27) | `agent:setConfig {workflowsDisabled}` (`agent-rpc.handlers.ts:395-401`) | `ptah.workflows.disabled` (workspace configuration) | `ChatSessionService.resolveWorkflowsDisabled` (`chat-session.service.ts:1364`) → `sdk-query-options-builder.ts:1250` sets `CLAUDE_CODE_DISABLE_WORKFLOWS=1`. No plan check, which confirms PR-2. |
| System prompt mode (A10) | `enhancedPrompts:setEnabled {workspacePath:'.', enabled}` | unchanged from before the batch (the same RPC the old toggle used) | unchanged |

The only write-path change is client-side: effort and Ultracode writes are now confirmed by read-back before "Saved" is shown. No RPC, key or reader changed.

## Read-back design

- **Effort.** `EffortStateService.setEffort` returns void, sets the signal optimistically, and puts the previous value back when `config:effort-set` fails or throws (`libs/frontend/core/src/lib/services/effort-state.service.ts:36-62`). The card's `writeEffort` awaits it and returns `ok` only if `currentEffort() === requested`. Rollback is invisible only when requested === previous, and `selectEffort` never writes the current value. A rolled-back write is therefore always reported as "Could not save the chat reasoning effort." `writeEffort` also refuses while Ultracode is on, so an Undo cannot break the pin.
- **Ultracode.** The read-back lives in `UltracodeStateService`, the one owner of the mode/effort pair (its only toggle caller is this card):
  - `enable()`: if the effort is not `xhigh` after the write, the mode goes back off and it returns `false`.
  - `disable()`: if the effort is not the remembered previous value after the write, the mode stays on, keeping the remembered value for a retry, and it returns `false`.
  - The card maps `false` to the alert toast "Could not turn on/off Ultracode: …". Control and state never disagree, and the previous effort is never lost.
  - Ambiguous case: if the previous effort was already `xhigh`, a failed write still reads as success. The resulting state is then correct anyway.

## Deletions (D14)

`pro-features/workflows-config.component.ts` and its spec are deleted in the same change that mounts the replacement in `advanced-settings.component.ts`. The barrel export is removed. Remaining references: a grep for `workflows-config|WorkflowsConfigComponent|ptah-workflows-config` over `apps/` and `libs/` finds only the new spec assertion that the element is absent.

## @defer change (bundle)

`settings.component.html` wraps `<ptah-advanced-settings (modelChanged)="onModelChanged()" />` and `<ptah-search-voice-settings />`, each inside its existing `@if`, in:

`@defer (on immediate) { … } @placeholder { <div class="min-h-24" aria-busy="true"></div> }`

- **Trigger.** The brief wrote a bare `@defer`. I used `(on immediate)`, the repo precedent (`providers-settings.component.ts:55`, chat-ui `mcp-directory-browser`). A bare `@defer` defaults to `on idle`, which would leave the tab on its placeholder until the browser goes idle.
- **Split condition.** `settings.component.ts` lists the two classes only in `imports`; no other reference exists in that file or anywhere else in `libs/`/`apps/` (grep). That is the condition for Angular to emit separate chunks. The child components in the settings barrel have no consumers outside `settings/`. **The chunk split and the bundle delta are not measured here**, because the webview build is the team-leader's.
- **Specs.** No existing spec rendered these tabs (all override `imports`/`template`). The new suite "SettingsComponent deferred tabs" covers:
  - Manual mode: the `aria-busy` placeholder shows, then after `render(Complete)` the tab mounts and `(modelChanged)` still triggers `redetectClis` (#84).
  - Playthrough with `whenStable`: both tabs mount and no placeholder remains.
- **Harness / e2e waits.**
  - `waitForSettled` matches `[aria-busy="true"]` (`settings.fixtures.ts:690-693`), so it waits out the placeholder.
  - The reachability kept-selectors test uses `toBeVisible()`, which auto-waits.
  - The `apps/ptah-electron-e2e` `settings.spec.ts:6-7` uses `click` + `toBeVisible()`, also auto-waiting.
  - The showcase `settings-tour.scene.ts:241-272` holds 400 ms before its non-waiting `isVisible()`, enough for an `on immediate` local chunk.
  - None needed a change.

## Harness / e2e

No testid or selector was renamed or removed. The three kept aria-labels are unchanged. The harness and e2e have no workflows-config selectors (grep). New testids added for later harness work (Batch 49): `agent-behaviour-card`, `agent-behaviour-row-{prompt,effort,workflows,ultracode}`, `agent-behaviour-prompt-status`, `agent-behaviour-effort-value`, `agent-behaviour-effort-choice-{default,low,medium,high,xhigh,max}`, `agent-behaviour-workflows-status`, `agent-behaviour-ultracode-status`, `agent-behaviour-load-error`. Harness and e2e projects were not touched, so they were not linted.

## Verify (tails)

| Command | Result |
|---|---|
| `npx nx run @ptah-extension/chat:typecheck --skip-nx-cache` | `Successfully ran target typecheck`. One warning, NG8107 in `peer-session-send-dialog.component.ts:181`, which predates this batch |
| `npx nx run @ptah-extension/chat:lint --skip-nx-cache` (re-run after the last edit) | `✖ 30 problems (0 errors, 30 warnings)`, the same count as Batch 40, none in this batch's files |
| `npx nx run @ptah-extension/chat:test --skip-nx-cache -- --maxWorkers=2` (full) | `Test Suites: 130 passed, 130 total`, `Tests: 2 skipped, 2161 passed, 2163 total`, `Successfully ran target test` |
| Targeted run `npx jest -c libs/frontend/chat/jest.config.ts --testPathPatterns="(agent-behaviour-section\|advanced-settings\|settings\.component\|ultracode-state)"` | 7 suites, 150/150 |

The first full run failed one spec: `MessageSenderService › ultracode keyword injection`. Its `EffortStateService` stub could never read back a write, so the new `enable()` rightly stayed off. The stub was made stateful and the re-run is green (above).

Spec-file types: `ptah_get_diagnostics` reports no errors in the new or changed spec code. The chat spec tsconfig has about 255 errors in other specs, and the one hit in a requested file, `advanced-settings.component.spec.ts:193`, is Batch 40's export test. The `typecheck` target does not cover specs.

Batch 46's files (`ptah-ai/voice-config*`, `voice-details-drawer*`, `search-voice-settings.component.ts`) were not edited and showed no typecheck or test errors in these runs.

## Deviations

1. **`enhanced-prompts-config.component.ts` edited (outside the 5-file list).** Rows A10/A11 move into this card in Batch 41, but that component survives until Batch 42. Leaving it alone would have rendered two `Toggle Enhanced System Prompt` checkboxes, a Playwright strict-mode break and a duplicate control. PR-1 also lives in that file. Only the toggle, the badge and the preset radios were removed; the details stay for Batch 42's drawer.
2. **`UltracodeStateService` contract changed (`Promise<void>` → `Promise<boolean>`)** plus its spec and the `message-sender` spec stub. This is the only way to give A29 a truthful read-back without the trap described in review item 2. Its only toggle caller is this card.
3. **No Details column yet.** It would be empty until Batch 42 (D-SP drawer), which already lists this file.
4. **`@defer (on immediate)` instead of a bare `@defer`.** Reason given in the @defer section.
5. **Effort cell disabled while Ultracode is on.** The old component let you change effort under Ultracode, and turning Ultracode off then silently overwrote that choice with the remembered value. The cell now says "Pinned to X-High by Ultracode". Flagged for review: it is a behaviour change, not a capability removal.
6. **Heading icon.** The card uses `Bot` (lucide) in `text-secondary`, following the other section cards' icon + heading shape. The prototype has no Agent behaviour card to copy from.
7. **Fold check (map §2.2) not measured here.** The Ultracode and workflows sub-lines may wrap to two lines at 1024 px; Gate V owns this.

## Rework round 1 (team-leader rejection: one D15 defect)

### 1. A10 `{success:false}` inside a successful RPC (REQUIRED) — fixed

`enhancedPrompts:setEnabled` returns `{success:false, error}` as an RPC *success* when the params fail to parse or `EnhancedPromptsService.setEnabled` throws (`libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:403-405`, `:432-435`). `writePromptMode` (`agent-behaviour-section.component.ts`) now does what the workflows writer does: `if (!result.data.success) return { ok: false, message: result.data.error ?? PROMPT_MODE_SAVE_FAILED };`. No status re-read follows a failed write.

Regression specs in `agent-behaviour-section.component.spec.ts`:
- `{success:false, error}`: the checkbox stays off, the alert toast carries the host message with no Undo, and no `getStatus` re-read happens.
- `{success:false}` with no message: the toast falls back to "Could not save the system prompt mode."

**Audit of every writer in Batch 41's files:**

| Writer | Two-layer result? | Verdict |
|---|---|---|
| `writePromptMode` (A10), `enhancedPrompts:setEnabled` | yes: `{success, error?}` | **was the defect, now fixed** |
| `writeWorkflowsDisabled` (A27), `agent:setConfig` | yes: `{success, error?}` | already checked `result.data.success` + `data.error` |
| `writeEffort` (A26), `config:effort-set` via `EffortStateService` | no: the result is `{effort}`, and the handler **throws** on failure (`config-rpc.handlers.ts:698-708`), so failure arrives as an RPC error and `setEffort` rolls back | safe; the read-back catches it |
| `writeUltracode` (A29) | same channel as effort | safe; the service reads back |
| `enhanced-prompts-config` regenerate, `enhancedPrompts:regenerate` | yes: `{success, error?, status?}` (handler `:462`, `:468`, `:501`, `:515`) | **same gap, existed before this batch: `{success:false}` cleared the preview, re-read the status and showed nothing.** Fixed: the host error goes to the existing inline error line. Regression spec: new `enhanced-prompts-config.component.spec.ts` (2 specs; Batch 42 carries it into the drawer) |
| `enhanced-prompts-config` download, `enhancedPrompts:download` | yes, but a **user cancel is also `{success:false, error:'Save cancelled by user'}`** (`:628-633`) | **not changed.** It never claims success (no toast or line), and surfacing `{success:false}` would show a cancel as an error unless the copy were string-matched. Left for Batch 42's drawer, which owns this action and should get a distinct cancel signal from the host. |

### 2. Bundle: barrel exports — done (10 removed, 2 kept)

`libs/frontend/chat/src/index.ts:14` does `export * from './lib/settings'`, so the settings barrel re-exports kept the deferred children reachable from the eager graph. I grepped every symbol across `apps/`, `libs/` and `tools/` (`.ts`/`.html`/`.mts`/`.js`). **No file outside `libs/frontend/chat/src/lib/settings/` imports any of them.** The only hits are comments in `webview-e2e-harness/.../settings.fixtures.ts:20`, `:328`, `:342` and `core/.../providers-commit.service.ts:236`. Every in-lib consumer uses a relative path.

| Export | Verdict |
|---|---|
| `LicenseStatusCardComponent`, `EnhancedPromptsConfigComponent`, `McpPortConfigComponent`, `OutputStyleConfigComponent`, `VscodeLmConfigComponent` (Advanced) | **removed** |
| `WebSearchConfigComponent`, `VoiceConfigComponent`, `LocalSttPanelComponent`, `LocalTtsPanelComponent`, `ElevenLabsPanelComponent` (Search & Voice) | **removed** (only `settings/index.ts` edited; no Batch 46 file touched) |
| `SettingsComponent` | kept (the app route uses it) |
| `AgentOrchestrationConfigComponent`, `PtahCliConfigComponent` | **kept.** Also unused outside settings, but they belong to the eager Orchestration tab (`orchestration-settings.component.ts` imports both), so removing them saves nothing. Out of this batch's scope. |

`settings/index.ts` now carries a comment explaining why the deferred children must not be re-exported. The new chunk sizes are not measured here (the webview build is the team-leader's).

Projects that import `@ptah-extension/chat` (grep): `ptah-extension-webview`, `@ptah-extension/tribunal-panel`, `setup-wizard`, `mcp-apps-page`, `harness-builder`, `canvas`. All are typechecked below.

### Verify (rework tails)

| Command | Result |
|---|---|
| `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview @ptah-extension/tribunal-panel @ptah-extension/setup-wizard @ptah-extension/mcp-apps-page @ptah-extension/harness-builder @ptah-extension/canvas --skip-nx-cache --parallel=2` | `Successfully ran target typecheck for 7 projects` |
| `npx nx run @ptah-extension/chat:lint --skip-nx-cache` | `✖ 30 problems (0 errors, 30 warnings)` (unchanged, none in batch files) |
| `npx nx run @ptah-extension/chat:test --skip-nx-cache -- --maxWorkers=2` | `Test Suites: 131 passed, 131 total`, `Tests: 2 skipped, 2165 passed, 2167 total` |
| targeted `--testPathPatterns="(agent-behaviour-section\|enhanced-prompts-config)"` | 2 suites, 25/25 |

Rework files: MODIFY `settings/pro-features/agent-behaviour-section.component.ts` + `.spec.ts`, `settings/pro-features/enhanced-prompts-config.component.ts`, `settings/index.ts`; CREATE `settings/pro-features/enhanced-prompts-config.component.spec.ts`. Not committed.

## Copy for review

- Card heading: "Agent behaviour"
- Prompt row note: "Ptah's project-specific prompt, used for all sessions when on." / (no prompt) "Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project."
- Effort note: "Same value as Providers > Main Agent effort" (+ "· Pinned to X-High by Ultracode")
- Ultracode note: "X-High effort and a planned workflow for each message. The `ultracode` keyword only takes effect on messages you type yourself. Turning Ultracode off restores your previous reasoning effort." Status: "On/Off · Pins X-High while on"
- Toasts: "Saved system prompt mode." / "Saved chat reasoning effort." / "Saved dynamic workflows." / "Saved Ultracode."
- Failures:
  - "Could not save the chat reasoning effort."
  - "Turn Ultracode off to change the chat reasoning effort."
  - "Could not turn on Ultracode: the reasoning effort was not saved."
  - "Could not turn off Ultracode: your previous reasoning effort was not restored."
  - "Could not save the system prompt mode." / "Could not save the dynamic workflows setting." (fallbacks when the host sends no message)
- Load alerts: "Could not load the system prompt status." / "Could not load the dynamic workflows setting." (fallbacks)
- `enhanced-prompts-config` heading changed from "System Prompt Mode" to "System Prompt" (it no longer holds the mode).
