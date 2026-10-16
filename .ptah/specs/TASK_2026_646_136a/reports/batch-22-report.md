# Batch 22 (A12) report: Decision model settings row

Task 22.1: done. Executor: subagent frontend-developer (Anthropic). No git actions taken. `batches.md` / `task.md` not edited.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\decision-model-row.component.ts`: the seventh role card, `ptah-decision-model-row` (537 lines).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\decision-model-row.component.spec.ts`: 19 cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.ts`: `BackgroundConsumerId` gains `'decision'` (:18); new `ProviderConsumerId` (:28), `PROVIDER_CONSUMER_IDS`, `BACKGROUND_ROLE_IDS` (:36); decision-row derivation `DECISION_KIND_OPTIONS` (:294), `buildDecisionRow` (:377), `decisionModelInput` (:425), `sameDecisionSelection` (:440), `parseDecisionModelStatus` (:472). `buildConsumerRows` and `consumerPatch` are unchanged apart from the id type narrowed to `ProviderConsumerId`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.spec.ts`: one import line extended; a new describe block with 15 cases. The existing cases are unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.ts`: imports and renders `<ptah-decision-model-row>` after the six cards (:495), and the internal id type is now `ProviderConsumerId`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.spec.ts`: setup now provides a `ClaudeRpcService` mock (the card reads `agent:getConfig` itself); one new case for the seventh card. The existing cases are unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts`: summary text gains "decision" (:150); `roleCount = BACKGROUND_ROLE_IDS.length` (:251), so it shows 7.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts`: '6 roles' becomes '7 roles', plus an exact summary-text assertion; the stub's id type is `ProviderConsumerId`.
- MODIFIED (outside the listed files, needed for typecheck) `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\chat\src\lib\settings\providers\connection-usage.ts`: `UsedBy.id` / `addRole` use `ProviderConsumerId`. Type only, no behaviour change.
- NOT touched: `libs/frontend/core/src/lib/services/providers-settings.types.ts`. No patch type needs the field, because the row does not write through the Providers state service.

## Assumptions resolved (file:line)

1. **Contract.** I read the contract as committed and did not change it. `DecisionModelStatusDto` is at `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:145-153`, `AgentOrchestrationConfig.decisionModel` at :227, and `decisionModel?` + `decisionModelJevApiKey?` at :273-279. The read uses `agent:getConfig` and the writes use `agent:setConfig` (`rpc.types.ts:1285-1287`). No new RPC method, DTO state, DI service or MCP tool was added.
2. **Host access.** The row calls `ClaudeRpcService` with a 5 s timeout. The same tab already does this in `lane-guards-settings.component.ts:242-244,270-272`, and Settings does it in `pro-features/agent-behaviour-section.component.ts:402,442`.
3. **Save feedback.** The row uses `SettingsSaveFeedbackService.saveGeneric` (`feedback/settings-save-feedback.service.ts:148`). That is the entry for writes outside `ProvidersSettingsStateService`; precedent is `agent-behaviour-section.component.ts:335-373`. Toast messages are fixed sentences and never contain host text: the convention is pinned at `agent-behaviour-section.component.spec.ts:183`.
4. **Ollama suggestions.** They come from `PROVIDER_MODELS_LOADER.listModels('ollama')`. That is the catalogue port the provider picker in this area already uses: `providers/providers-models-loader.service.ts:8-15`, provided at `settings/settings.component.ts:116`. The registry id `'ollama'` is at `libs/shared/src/lib/providers/entries/local-provider-entry.ts:35`. No model names are hard-coded. The field is free text with a native `<datalist>` (precedent `skill-synthesis-ui/.../agent-model-editor.component.ts:303-319`).
5. **Structured-output source (sub-part delivered, with a stated approximation).** The configured providers come from the `extraProviders()` the assignments component already builds from `state.route().data.providers`. `ProviderModelInfo` has no structured-output flag (`ModelCapability`, `libs/shared/src/lib/types/auth-env.types.ts:43-50`). The backend adapter asks the SDK for `outputFormat: json_schema` (`agent-sdk/.../structured-decision.adapter.ts:134`), and readiness checks only the credential (:97-110). So suggestions are filtered to `supportsToolUse` (`decision-model-row.component.ts:522`), on the assumption that SDK structured output runs as a tool call. Free text stays allowed. This can be reversed: drop the filter. See Decisions.
6. **Set-up deep link.** The row emits `setupProviderRequested`. The assignments component forwards it to `openProviderSetup` (`orchestration-settings.component.ts:162,337`). The link target is `'ollama'` for the Ollama kind and the chosen `providerId` for structured. Jev has no provider entry in the registry (no `typesafe`/`jev` provider in `libs/shared`), so for Jev the row's own key field is the set-up.
7. **Decision deep link.** I did not add one. Core's `PendingSettingsTab.section` (`libs/frontend/core/src/lib/services/app-state.service.ts:148-160`) names no `decision` section. Widening `OrchestrationSettingsFocusTarget` broke `settings.component.ts:69`, so the focus target stays on `ProviderConsumerId`. The `background-models` link already opens and focuses the roles that contain the card.
8. **Fixed helper text size.** The assignments spec V36-2 forbids `text-[10px]`/`text-[11px]` on anything that is not a `.btn` inside this host. The row uses `text-xs` labels; the 11 px only sits on `btn` actions and the 9 px on the badge, the same as the siblings.
9. **TASK_2026_658 overlap check.** No overlap. Its change in `orchestration-settings.component.ts` is the advanced groups after the session budget (`TASK_2026_658_advanced_settings/implementation-plan.md:264`). This batch touches only the roles summary, the count and the type imports.

## Requirements 1.1-1.8 (UI side)

- **1.1.** The card is the seventh role after the six, with `data-testid="consumer-row-decision"` (assignments spec case). The summary reads "Memory curator, archaeologist, synthesis, judge, replay, judging, decision" and shows "7 roles" (orchestration spec).
- **1.2.** The picker has exactly Unset (default), Ollama decision model, TypeSafe Jev and Structured-output model (`DECISION_KIND_OPTIONS`, rows spec + component spec). Ollama is free text with suggestions from the catalogue. Jev takes an optional model (placeholder `jev-1.13.0`; an empty field omits `model`) and a write-only key. Structured takes a configured provider plus a model.
- **1.3.** Unset sends `{ decisionModel: { kind: 'unset' } }` at once. The row itself never makes a decision request.
- **1.4.** 'local' shows "Runs on this machine: the request text and lane data stay on this machine." 'remote' shows "The request text and lane data are sent to {TypeSafe Jev | Ollama | provider name}."
- **1.5.** All five states have a badge and a sentence. `detail` shows as "Detail: …" through interpolation only, and a markup-in-detail case is covered. no-credential, unreachable and unsupported-endpoint show "Set up {name}" (except Jev) and `role="alert"`. When the status read fails, the row says "not reachable", offers Retry, and saving still works (spec case).
- **1.6.** Restore after restart is the backend's job: the row re-reads `agent:getConfig` on init.
- **1.7.** The six rows keep their values and behaviour. `buildConsumerRows` still returns six (`provider-consumer-rows.spec.ts` existing cases unchanged and passing). Existing assignments and orchestration cases pass; only '6 roles' became '7 roles', as the brief asks.
- **1.8.** A structured selection with `reportsConfidence === false` shows "This model reports no confidence, so its answers carry no confidence score."

## Jev key handling

- The key field is `type="password"` with `autocomplete="new-password"`. It is never prefilled, and it is cleared after a successful save and when the popover closes. The key is never logged.
- The key is trimmed before it is sent. A blank or whitespace-only field never sends `decisionModelJevApiKey` (spec case).
- Delete is a separate "Remove stored key" button that sends `{ decisionModelJevApiKey: '' }` (spec case). A save that stores a key has no Undo, because a key cannot be restored.

## Risks handled

- **Stale status after a write:** each write re-reads `agent:getConfig`. A failed re-read shows "not reachable" and does not mark the save as failed.
- **Untrusted host data:** `parseDecisionModelStatus` validates the DTO before it reaches view state. An unknown state such as `model-unavailable` is rejected (decision #46).
- **Suggestion races:** a request counter means the newest catalogue load wins.
- **Saving while another save runs:** controls follow `feedback.saving`, and the cell is `aria-disabled` so it keeps focus (sibling pattern). Close returns focus to the cell.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Read and write the row through `ClaudeRpcService` + `saveGeneric`, not through `ProvidersSettingsStateService` | extend `ProvidersOrchestration` and the commit path in core / own RPC in the row | the commit read-back compares per field (`providers-commit.service.ts:211-214`); an object field and a write-only key do not fit it; same-tab precedent `lane-guards-settings.component.ts` | yes |
| Unset saves at once; the other kinds save with an explicit Save | save on every keystroke / all kinds via Save | free-text fields cannot save on each choice; siblings save on choice | yes |
| Structured suggestions are filtered to `supportsToolUse` | no filter / tool-use filter | no structured-output flag on `ProviderModelInfo`; adapter uses SDK `json_schema` output | yes (one line, :522) |
| No `decision` deep link | add it to core `PendingSection` / leave it out | core type at `app-state.service.ts:148`; outside this batch's files | yes |

## Verification (all run after `T\visual\batch-22-before.md` existed, one at a time)

`NX_NO_CLOUD=true npx jest -c libs/frontend/chat/jest.config.ts <decision-model-row.component.spec.ts> <provider-consumer-rows.spec.ts> <provider-consumer-assignments.component.spec.ts> <orchestration-settings.component.spec.ts> <connection-usage.spec.ts> --coverage=false --maxWorkers=2`

```
Test Suites: 5 passed, 5 total
Tests:       150 passed, 150 total
```

`NX_NO_CLOUD=true npx nx lint @ptah-extension/chat --parallel=1`

```
✖ 51 problems (0 errors, 51 warnings)
 NX  Successfully ran target lint for project @ptah-extension/chat
```

The only warning on a touched file is the existing `max-lines` warning on `provider-consumer-assignments.component.ts`: 766 lines before this batch, 774 after (+8: import, imports entry, 6 template lines; limit 700, `eslint.config.mjs:556-559`). The new files are below the limit and raise no warnings.

`NX_NO_CLOUD=true npx nx typecheck @ptah-extension/chat --parallel=1`

```
 NX  Successfully ran target typecheck for project @ptah-extension/chat
```

The only diagnostic is an existing NG8107 warning in `peer-session-send-dialog.component.ts`. The first run failed on `overview-tab.component.ts:329` and `settings.component.ts:69` when `'decision'` was added. Narrowing `connection-usage.ts` and `OrchestrationSettingsFocusTarget` to `ProviderConsumerId` fixed both.

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`

```
  libs/frontend/chat: 10 ok (baseline 11)
degradation-audit: TOTAL 296 unsuppressed site(s)
```

No FAIL lines, and none of this batch's files is flagged.

## Out-of-scope observations

- `libs/frontend/chat/src/lib/settings/providers/routing-map.component.spec.ts:195`: the Providers routing map's "Background roles" node still says "6 roles". That map lists provider-connection users, so the decision model may rightly be left out; that is the team-leader's call.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:762`: the `agent:getConfig` fixture has no `decisionModel`, so the card shows "not reachable" in e2e and visual runs. Adding a fixture status would give the before/after screenshots a real state.
- The working tree also has changes this batch did not make (another lane's): `.ptah/specs/TASK_2026_646_136a/batches.md`, `decisions.md`, and `libs/backend/vscode-lm-tools/src/lib/code-execution/**` (route-tool handlers, outcome-report tool/handler, agent namespace builder, protocol dispatcher, tool-result budget, ptah-api builder). Only the 9 `libs/frontend/chat` files listed above belong to Batch 22.
