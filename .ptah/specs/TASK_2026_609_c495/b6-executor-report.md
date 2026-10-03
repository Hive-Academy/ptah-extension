# B-6 executor report — TASK_2026_609_c495, Batch B-6 (Task B-6.1)

Executor: frontend-developer. No git run. batches.md and reconcile-guard.ts not edited.

## Files (exactly the six B-6 lists)

W = `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`

- CREATED `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.ts`. Contains `AgentModelsStore` (an `@Injectable()` provided by the view, so it lasts only as long as the view) and `AgentModelEditorComponent` (`ptah-agent-model-editor`, standalone, OnPush, signals + `inject()`, no `[innerHTML]`).
- CREATED `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.spec.ts`. 18 cases.
- MODIFIED `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`. New input `modelGuard: ReconcileGuardComponent | null` (default `null`). On an agent card with a guard set, the card renders the editor (`[locked]="busy()"`). The card itself still injects nothing.
- MODIFIED `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`. Changes:
  - provides `AgentModelsStore`
  - `reconcileGuard` viewChild changed from private to protected
  - `[modelGuard]="onAgentTab() ? (reconcileGuard() ?? null) : null"`
  - `agentModels.load()` runs on Agents-tab entry (same effect as the harness refresh) and on Refresh
  - +9 counted lines (730 → 739; the max-lines warning was already there, FU-3)
- MODIFIED `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`. New methods:
  - `getAgentModels()` (throws on error)
  - `setAgentModel(params)`, which returns `AgentModelSaveOutcome = {ok:true,result} | {ok:false, code: RpcUserErrorCode|null, message}`. A refusal comes back as data so the editor can branch on its code.
  - `listCliModels()` (`agent:listCliModels`)
  - `getAgentLaneConfig()` (`agent:getConfig`)
- MODIFIED `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`. 7 new cases.

## Stack observed

- Angular 22.1.7 (root `package.json`).
- Signals, `input()`/`output()`, `inject()`, OnPush, as in `clone-card.component.ts` and `quarantined-agents-panel.component.ts`.
- Tailwind + daisyUI classes (`btn-xs`, `badge-xs`, `input-xs input-bordered`, `radio-xs`). The datalist markup follows `tasks-ui/.../task-metadata-editor.component.ts:107-123`.
- A per-surface `@Injectable()` needs an eslint-disable line, as `clone-bulk-rebase.service.ts:53` already has.
- Inputs and buttons inside the clickable `NativeCardComponent` do not open the drawer (its `NESTED_INTERACTIVE_SELECTOR`). The section also carries `data-card-ignore`.

## Loading (AgentModelsStore)

- `load()` runs `getAgentModels`, `listCliModels` and `getAgentLaneConfig` together (`allSettled`). A synchronous throw is turned into a rejection, so `load` never rejects. A sequence number drops stale replies.
  - `getAgentModels` failure → the load-error state.
  - List failure → the input gets no suggestions.
  - Config failure → empty rows say `inherits: lane default`.
- WORKSPACE_CHANGED (A-5). An effect watches `VSCodeService.config().workspaceRoot`; `vscode.service.ts:99-106` and `electron-layout.service.ts:545` update it. When it changes after the first `load()`, the store reloads. It is not wired to a separate message handler.
- `applySaved()` adopts the `machine`/`workspace` layers that `setAgentModel` re-read, and the server classification of the saved key. Saving an empty value removes that key's entry.
- Labels never come from `agent:listCliModels`:
  - stored values: `snapshot.classification[scope][slug|'*'][provider]`, falling back to `classifyAgentModelValue` over `snapshot.lists`
  - typed values: `classifyAgentModelValue(provider, draft, snapshot.lists[provider])`
- `agent:listCliModels` only fills the `<datalist>` (codex/copilot/cursor/opencode). Claude has no list there, so its row shows a placeholder instead (`opus, sonnet, haiku or inherit`).

## UI states and their copy

| State | Copy / behaviour |
| --- | --- |
| Loading | `Loading models…` |
| Load error | `Models unavailable: <reason>` + `Reload` |
| No folder (`workspaceRoot: null`) | `Open a workspace folder to set per-agent models.` (no Edit) |
| Row, value set | `<value>` + source: `workspace override` / `workspace default` (ws `'*'`) / `machine default` / `machine default, all agents` (machine `'*'`) + badge |
| Row badges (server class) | listed → `listed`; unlisted → `not in provider list`; unverifiable → `list unavailable`; malformed → `not written: invalid id` |
| Row, empty Claude | `template` |
| Row, empty non-Claude | `inherits: <model> (lane default)` from `agent:getConfig`, or `inherits: CLI default` when the lane field is `''`. Config unreadable: `inherits: lane default` |
| Unsupported provider (from `getAgentModels.unsupportedProviders`) | Edit disabled; `Not supported for <Provider> agent copies.` |
| Editing | Scope radios `This workspace` / `Machine default` (default: the scope that holds the agent's own value, else workspace). Input with datalist, `Save`, `Cancel`. Enter saves, Escape cancels. Focus moves to the input. The whole-workspace line comes from the existing `RECONCILE_WHOLE_WORKSPACE_NOTICE` constant |
| Machine scope selected (AC7) | `Applies to every workspace without its own value.` (shown before saving) |
| Typed-value hint | empty → `Saving an empty value clears this agent's workspace override.` / `…machine default.`<br>malformed → Claude `Use opus, sonnet, haiku or inherit.`, OpenCode `Use the provider/model form, without spaces.`, others `Not a valid <P> model id (no spaces or line breaks).` (Save disabled)<br>listed → `In <P>'s model list.`<br>unlisted → `Not in <P>'s model list; you will be asked to confirm.`<br>unverifiable → `<P>'s model list is unavailable, so this value cannot be checked.` |
| Unlisted confirmation (client class, or server `MODEL_NOT_AVAILABLE`) | `"<value>" is not in <P>'s model list. Save it anyway?` (or the server message) + `Save anyway` / `Back`. Save anyway resends with `confirmUnlisted: true` |
| Guard could not check | `Could not check for hand-edited files; nothing was saved.` + `Retry`. The typed value stays; `setAgentModel` is not called |
| Guard Cancel | No message; the form closes and the typed value is dropped (the row shows the previous value) |
| `INVALID_PARAMS` / `PERSISTENCE_UNAVAILABLE` / `WORKSPACE_NOT_OPEN` / other / throw | `Not saved: <server message>`. The previous value is still displayed and the draft stays in the input |
| `UNAUTHORIZED_WORKSPACE` | Models reload; the row says `The workspace changed, so nothing was saved. Models were reloaded.` |
| Saved, reconcile failed | `Saved; provider copies not updated: <reason>` + `Sync` (guard → `store.reconcile()`) |

Accessibility:
- The section is labelled `Model per provider for <slug>`.
- Each Edit button has aria-label `Edit <Provider> model for <slug>`.
- The input has a visually hidden `<label for>`; the scope radios are in a `<fieldset>` with an sr-only legend.
- Failures use `role="alert"`; notices use `role="status"`.

## Save flow

1. `guard().confirm({ onlyWhenEdits: true, confirmLabel: 'Save model' })`. The guard shows a modal only when there are edits, or when it cannot check.
2. `rpc.setAgentModel({ workspaceRoot: snapshot.workspaceRoot (verbatim), slug, provider, scope, value: trimmed || null, confirmUnlisted? })`.
3. `store.applySaved(...)`, then `HarnessHealthStore.reconcile()`, then read `harness.error()` for the reconcile-failure row message.

## How a guard failure is told apart from Cancel (reconcile-guard.ts unchanged)

`ReconcileGuardComponent.confirm` resolves `false` for both cases. `AgentModelEditorComponent.runGuard()` tells them apart from the state the guard leaves in `HarnessHealthStore`:

- Before the call it records `wasBusy = harness.busy()` and `before = harness.health()`.
- After a `false` it counts the result as "could not check" when `wasBusy || harness.error() !== null || harness.health() === null || harness.health() === before`.

This works because of how the guard behaves:

- **Busy:** it never calls `refresh`.
- **Read failed:** the store sets `error`.
- **No report:** health is `null`.
- **Cancel:** this can only follow a fresh, successful `refresh({refresh:true})`, and `applyReport` (`harness-health.store.ts:285-291`) always stores the newly deserialised report object. So after a Cancel the error is `null` and health is a new object.

One side effect: the guard's re-entry case (`inFlight`: a second confirm while a modal is open returns `false` without reading) leaves health unchanged. It is therefore reported as "could not check" with Retry, not as a silent Cancel. That is the safer of the two readings.

## Spec cases

`agent-model-editor.component.spec.ts` uses:
- a real `ReconcileGuardComponent` and a real `HarnessHealthStore`
- `ClaudeRpcService` mocked for `harness:health`/`harness:reconcile`, returning a fresh report object per read
- a mocked `SkillSynthesisRpcService`
- a `VSCodeService` stub with a `config` signal

Cases:

- Rows:
  - value + source for each provider, `template` for empty Claude, `inherits: CLI default`
  - `inherits: gpt-5-codex (lane default)`
  - server-class badge (`not in provider list`)
  - unsupported row disabled with its note
  - no-folder state shows no Edit
  - datalist options come from `listCliModels`
- AC7: the machine copy appears only when Machine default is selected.
- A malformed value disables Save, and no harness call is made.
- No edits: `setAgentModel` is called once with `workspaceRoot: '/ws/resolved'` verbatim, in the order `harness:health` → `set` → `harness:reconcile`, and the row updates.
- **Health-read failure**: `setAgentModel` is not called, `GUARD_FAILED_COPY` and Retry are shown, the input keeps `o3`, and there is no reconcile.
- **Retry after recovery**: the value is saved exactly once and the failure message clears.
- **User Cancel** (localEdit present): no `setAgentModel` call, no failure or save message, the form closes, and the previous value `gpt-5` is shown.
- Unlisted: the confirmation appears with no call; Save anyway sends `confirmUnlisted: true`.
- `MODEL_NOT_AVAILABLE`: the server message is shown, then a confirmed resend (2 calls, the second with `confirmUnlisted: true`).
- `INVALID_PARAMS` and `PERSISTENCE_UNAVAILABLE` (it.each): `Not saved: …`, previous value displayed, draft kept, no reconcile.
- `UNAUTHORIZED_WORKSPACE`: `getAgentModels` is called again, the notice is shown, no reconcile.
- Reconcile failure: `Saved; provider copies not updated: codex target is locked` + Sync button.
- WORKSPACE_CHANGED (`workspaceRoot` signal changes): reload.
- Load failure: `Models unavailable: <reason>`.

`skill-synthesis-rpc.service.spec.ts` (+7):
- `getAgentModels` method/params/result, and its throw
- `setAgentModel` sends params verbatim and wraps success as `{ok:true,result}`
- `MODEL_NOT_AVAILABLE` comes back as data with its code
- a failure with no code comes back as `code:null` with the fallback message
- `listCliModels` / `getAgentLaneConfig` method names with `undefined` params

## Checks (tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui` (`--skip-nx-cache`) → `Successfully ran targets typecheck, lint for project @ptah-extension/skill-synthesis-ui`.
  - The lint warnings on the touched files are max-lines only: `agent-model-editor.component.ts` (765 > 700, new) and `skill-clones-view.component.ts` (739; it was already 730 at HEAD).
  - An earlier lint error (`use-injectable-provided-in`) was fixed with the same eslint-disable line `CloneBulkRebaseService` uses.
- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --maxWorkers=2` (`--skip-nx-cache`) → `Test Suites: 35 passed, 35 total` / `Tests: 597 passed, 597 total` / `Successfully ran target test`.
- Not run here: screenshots (B-7, visual-reviewer).

## Deviations and notes

1. **`AgentModelsStore` is in the editor file.** It is a separate job (loading, plus the reload on workspace change) and would naturally go in its own file, but B-6 allows exactly six files. Putting it in the view instead would have pushed the 730-line view further past the limit. Consequence: `agent-model-editor.component.ts` carries a max-lines warning (765 counted lines). Suggested follow-up: move the store to `clones/agent-models.store.ts` (one new file, no behaviour change); this could go with FU-3.
2. **No view-spec coverage of the new wiring.** `skill-clones-view.component.spec.ts` is not one of B-6's files. Its existing rpc mock has no `getAgentModels`, so in those tests the agent cards render `Models unavailable: …`. No existing assertion depends on that, and all 597 tests pass. A view-level case (cards get `modelGuard` only on the desktop Agents tab, and Refresh reloads the models) belongs with FU-3 or B-7 QA.
3. **No Claude datalist.** `agent:listCliModels` has no `claude` list. Claude's four allowed values are given as the placeholder and the malformed hint.
4. **Unlisted confirmation is inline in the row, not a modal.** This keeps one row's state together and avoids opening a second modal next to the guard. After `MODEL_NOT_AVAILABLE`, the resend goes through the full save path, including the guard (`onlyWhenEdits`, so usually silent).
5. **"Sync" after a reconcile failure is in the row.** It runs the same guard → `store.reconcile()` as the view's Sync button, but does not emit up to the view. That avoided new card outputs.

## Out-of-scope observations

- `NativeCardComponent` with `clickable` renders `role="button"` around nested controls. This was already true of the card's footer buttons, and is now also true of the model inputs. The card handles clicks correctly, but nested interactive content inside `role="button"` is an ARIA authoring issue that applies to the whole card, not only this batch.
- When the guard is called again while its modal is open, it returns `false` without any signal. The editor reads this as "could not check", which is safe. A reason exposed by `confirm` itself would remove the need for the heuristic, but that is a `reconcile-guard.ts` change and was not made here.
