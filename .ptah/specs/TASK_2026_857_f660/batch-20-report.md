# Batch 20 report: host routing settings toggle (Electron)

Executor: frontend-developer subagent. I ran no git commands, did not edit `batches.md` or `task.md`, and took no screenshots.

## Tasks

### Task 20.1: `HostRoutingSettingComponent` (`ptah-host-routing-setting`), DONE

- Standalone, `ChangeDetectionStrategy.OnPush`, `inject()`, state in `signal()`, derived state in `computed()`. It is self-contained like `CopilotAutoApproveToggleComponent`, so it has no inputs or outputs (plan Component 19).
- Data goes through `ClaudeRpcService` only, with a 5 s timeout (same as `lane-guards-settings.component.ts` and `decision-model-row.component.ts`):
  - On init it reads `settings:get {key:'agentOrchestration.hostRouting'}` and `agent:getConfig` in parallel (`Promise.all`).
  - `decisionModel` is validated with the existing `parseDecisionModelStatus` (`../providers/decision-model-row.view`).
  - A stored `undefined`/`null` reads as the default `true` (A6). Any non-boolean counts as a failed read.
  - `unset` + `unreachable` is the host's "selection not read" answer. It counts as a failed read, not as "no model" (same rule as `selectionNotRead` in `decision-model-row.component.ts:789`).
- `effective = computed(() => modelConfigured() === true && stored() !== false)`.
- Writes:
  - `settings:set {key, value}` goes through `SettingsSaveFeedbackService.saveGeneric`. The toast reads "Saved routing suggestions." and offers Undo, which writes the previous value.
  - Every write and every Undo re-reads `settings:get`, so the checkbox shows only a value it read back.
  - Only a literal `success: true` counts as saved.
  - A failed write shows the alert toast "Could not save routing suggestions. The saved setting is unchanged." and keeps the value it re-read.
  - A write that throws, or one whose re-read fails, shows "Could not confirm whether routing suggestions was saved." Then the row switches to the error state with Retry.
- States:
  - Loading: `role="status"`.
  - Error: "The setting could not be read." and a Retry button (`data-testid="host-routing-retry"`), with no value shown. No write is accepted until a read succeeds.
  - Ready, model set: the toggle is enabled.
  - Ready, no decision model: the toggle is unchecked and natively `disabled`, with the note "Off: set a decision model in Providers to use this." (`data-testid="host-routing-needs-model"`). A click writes nothing and the stored value is left unchanged. The row never implies routing is running.
  - Busy: `SettingsBusyDisabledDirective` is bound to `saving() || feedback.saving()`, as in the copilot row.
- Accessibility:
  - The visible `<label for="host-routing-toggle">` reads "Routing suggestions", and the checkbox's `aria-label` is the same text.
  - `aria-describedby` is `host-routing-help`, or `host-routing-help host-routing-needs-model` when no model is set.
  - The section is `aria-labelledby` the label.
  - The focus ring uses the copilot/lane-guards `focus-visible:outline…` string.
- Styling copies the siblings:
  - Toggle `toggle toggle-xs toggle-success`, as in the copilot row.
  - Section, header border (`border-b border-base-content/10 pb-2`), `text-xs text-base-content-muted` help text and the `btn btn-outline btn-sm border-base-content-muted` Retry button, as in Lane guards.
- Logs carry the error type only, never message text (privacy NFR). Each deliberate swallow carries `degradation-audit: reported`.
- Evidence: spec `host-routing-setting.component.spec.ts`, 8 tests:
  - The default (no stored value) reads as on, and the request shape is checked.
  - A stored `false` shows as off.
  - Turning it off and then on persists each change and re-reads after each write.
  - With no decision model it is inactive, disabled, shows the note, and a click writes nothing.
  - A save failure keeps the previous value with no Undo. A later save's Undo then restores the value.
  - A re-read that fails after a write is unconfirmed and shows Retry.
  - A failed read shows Retry, and Retry reads again.
  - The control is busy-disabled while its write runs.

### Task 20.2: mount after `<ptah-lane-guards-settings />` under `@if (isElectron)`, DONE

- `orchestration-settings.component.ts`:
  - Imports `HostRoutingSettingComponent` and `VSCodeService`.
  - Adds `protected readonly isElectron = inject(VSCodeService).isElectron === true;`.
  - Renders `@if (isElectron) { <ptah-host-routing-setting /> }` directly after `<ptah-lane-guards-settings />`, not deferred.
  - The class doc order comment is updated.
- Evidence: `orchestration-settings.component.spec.ts` now provides a `VSCodeService` stub and stubs the row. Two new tests:
  - Electron: the row is mounted after Lane guards and before the advanced groups, and the defer block count is still 3.
  - Not Electron: the row is not mounted, and Lane guards still is.
- The existing 6 tests are unchanged and run with `isElectron: true`.

## Files touched

- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\frontend\chat\src\lib\settings\ptah-ai\host-routing-setting.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\frontend\chat\src\lib\settings\ptah-ai\host-routing-setting.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts`
- CREATED this report.

## Verification

First run of `npm run verify -- -p @ptah-extension/chat` exited 1 (typecheck passed):

- Lint: 1 error, `label-has-associated-control`. The checkbox sat inside `@if` inside a wrapping `<label>`. Fixed with `<label for=…>` and an input `id`.
- Tests: 2 failures in the new spec. One asserted the class string order. The other was a microtask-depth flush. Both were fixed in the spec.

Final run (tail):

```
$ npm run verify -- -p @ptah-extension/chat 2>&1 | tail -40
[verify 2026-10-30T19:15:42.024Z] lock slot 1 acquired after 72s: verify lint,test,typecheck (@ptah-extension/chat)

 NX   3 tasks: 3 succeeded

  Run duration:      4m 12s
  Cache:             0/3 hit (0%)
[verify 2026-10-30T19:20:01.037Z] lock released after 259.0s, exit code 0
```

- The lint log from the final run shows `125 problems (0 errors, 125 warnings)`. That is the same 125 warnings as before this batch, so the batch adds no lint warnings.
- The first run's test summary for the whole project was 302 suites and 5350 tests, with only the 2 new-spec failures. Both failures were fixed and the final run passed.
- Batch 20 lists no other typecheck. `libs/frontend/chat` is a webview lib. The change touches no shared contract, and the host apps do not compile it.
- I took no screenshots, as instructed. The visual-reviewer owns them.

## Decisions

| Decision                                                                                                                  | Options                                      | Evidence                                                                                                     | Reversible |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| No decision model: native `disabled`, not `ptahBusyDisabled`                                                              | native disabled / busy-disabled              | `busy-disabled.directive.ts:28-30`: a control disabled "for a lasting reason ... can stay natively disabled" | yes        |
| A read of either the stored flag or the decision model that fails shows the single error row with Retry                   | per-field partial state / single error       | plan:1132-1133, 1144-1146 ("never shows a value it did not read back")                                       | yes        |
| `unset` + `unreachable` decision model = read failure, not "no model"                                                     | treat as unset / treat as unread             | `decision-model-row.component.ts:570-575, 789-791` (host's "selection not read")                             | yes        |
| Stored non-boolean (other than undefined/null) = read failure                                                             | coerce / fail                                | the row must not guess a value; undefined/null = default `true` (A6)                                         | yes        |
| Toast field name lowercase "routing suggestions" ("Saved routing suggestions."); visible/aria label "Routing suggestions" | same casing / sentence case in toast         | copy reads as a sentence in `Saved {label}.` (`settings-save-feedback.service.ts:180`)                       | yes        |
| Failure toast uses fixed copy, not the host's `error` string                                                              | host text / fixed text                       | the host error may carry raw text; fixed copy matches the copilot row's `NOT_SAVED`                          | yes        |
| Row layout: label + toggle on one line in a Lane-guards-style header block, help text under it                            | separate h3 header + row / single header row | plan: "one row inside the existing Context Management tab"                                                   | yes        |

## Risks handled

- Model unset: no write, and the stored value is left alone. Pinned by the spec, which checks that `settings:set` is not called and the stored value stays `true`.
- Showing an unread value: every write re-reads, and a failed re-read switches to the error row. Pinned by the spec.
- Boundaries: only `@ptah-extension/core`, plus sibling files inside `libs/frontend/chat`. No new Nx edge and no raw message posting.

## Out-of-scope observations

None.

## Electron navigation path (for the visual-reviewer)

Electron app, then **Settings** (gear icon in the app shell), then the **Context Management** tab (internal tab id `orchestration`). Scroll past the Subagent prompt-cache TTL, the Session budget and **Lane guards**. **Routing suggestions** (`data-testid="host-routing-setting"`) is the section directly below Lane guards and above the advanced groups (Context budgets, Codex agents, Background queries).

- Model set: configure a decision model in **Settings > Providers > Background model roles > Decision model**. The toggle is enabled and on by default.
- Model unset: set the Decision model to Unset. The toggle is unchecked and disabled, with the note "Off: set a decision model in Providers to use this."
- Capture both states in dark and light themes. The before shots are from base `1d2fbd4b5`, which has no row.
