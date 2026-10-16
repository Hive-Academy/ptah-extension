# Batch F6 — Electron e2e repair

Source: CI run 38939406603 (`D:\tmp\ptah-649-pr\e2e2.txt`), following [Batch F4](batch-F4-e2e-report.md). Edit-only; no checks were run.

| Test | Failing assertion | Cause | Decision | Change (file:line) |
| --- | --- | --- | --- | --- |
| `new-project.spec.ts:192` intake summary | `innerText()` timed out on `ptah-harness-builder-view [role="log"]` at line 207. | Current ChatView renders the transcript through `ptah-chat-transcript` and has no descendant with `role="log"`; the preceding tab-scoped transcript assertion passed. | Spec drift | Read the same tab's transcript text and retain each intake line plus seed exclusion: `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:206-214`. |
| `new-project-dotnet.spec.ts:278` .NET skills | Same `[role="log"]` timeout at line 317. | Same removed locator. | Spec drift | Read `ptah-chat-transcript[data-tab-id]` and retain .NET skill, TypeScript skill exclusion, intake and seed exclusion assertions: `apps/ptah-electron-e2e/src/specs/harness/new-project-dotnet.spec.ts:308-326`. |
| `new-project-dotnet.spec.ts:329` install hint | Same `[role="log"]` timeout at line 373. | Same removed locator. | Spec drift | Read the tab-scoped transcript; retain install-hint transport and transcript secrecy assertions: `apps/ptah-electron-e2e/src/specs/harness/new-project-dotnet.spec.ts:358-376`. |
| `new-project.spec.ts:322` reload | `ptah-harness-builder-view ptah-chat-transcript[data-tab-id="…"]` absent after `ui.prepare()` at line 369; manual inspection saw Chat. | Electron `setState` sends async IPC, but `VSCodeService.setState` merged each key against synchronous `getState`. A subsequent theme/layout write can use a stale main-process snapshot and erase the saved route. This is a source-level causal inference; CI has not yet confirmed it for this run. | App fix | Merge Electron writes in a renderer-local state snapshot until reload: `libs/frontend/core/src/lib/services/vscode.service.ts:77, 221-257`; unit regression for stale IPC reads: `libs/frontend/core/src/lib/services/vscode.service.spec.ts:386-409`. Keep the route, same-tab, transcript and single-start e2e assertions; update its later transcript locator at `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:370-374`. |
| `new-project-question-routing.spec.ts:178` unrelated question | Builder `ptah-question-card` count 1, expected 0 at line 240. | `session:id-resolved` attaches the SDK id to TabState but does not append it to `StreamRouter`'s conversation binding. Thus `routeQuestionPrompt` finds no target tab and ChatView's active-tab fallback shows the question on the builder. | Spec setup | Send a real foreign `chat:chunk` before resolution so `routeStreamEvent` binds that SDK session to the canvas tab. Keep both builder absence and foreign-tab presence assertions: `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts:189-211, 240-249`. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Scope transcript text by its existing tab ID. | Reuse current host; add a new test ID; search for a descendant role. | `chat-view.component.html` renders `ptah-chat-transcript`; F4's immediately preceding `data-tab-id` check passes in CI, while `[role="log"]` does not exist. | Yes. |
| Preserve the saved Electron route across adjacent state writes. | Change boot precedence; alter the e2e reload; merge async IPC writes locally. | `SurfaceRoutePersistence` writes every `NavigationEnd` through `VSCodeService.setState`; Electron preload sends `set-state` asynchronously and `get-state` reads committed storage synchronously. Boot already restores saved routes when present (`initial-navigation.ts`, `webview-routing.spec.ts`). | Yes; remove the local snapshot if Electron gains synchronous or acknowledged state writes. |
| Bind the foreign session through its normal stream path. | Change router fallback; send `session:id-resolved` alone; send a stream event with the foreign tab ID. | `ChatMessageHandler.handleSessionIdResolved` updates TabState; `StreamRouter.routeStreamEvent` appends the SDK session to the tab's conversation, which `routeQuestionPrompt` consults. | Yes. |

## Proposed Removals

none

## Unverified

No Nx, Jest, Playwright, TypeScript, lint, build, serve, or e2e command was run, per the edit-only instruction. CI must verify the five cases and the new unit spec. The exact order of Electron main-process state commits during the failing run is not in the cleaned log, so the reload cause remains an inference from the state bridge and the observed return to Chat.
