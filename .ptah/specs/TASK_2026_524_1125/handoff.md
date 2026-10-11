# Handoff — TASK_2026_524_1125 Batches 3–4 (route reuse + route persistence)

## Setup

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-524-batch3-4`
- Branch: `refactor/task-524-batch3-4-route-reuse` (from main 69a2b835e). `npm ci` done.
- **Nothing is committed.** Commit only when the user asks, as 2 PRs:
  - **PR A = Batch 3** (retained app-shell row via `*ptahRetainWhile`).
  - **PR B = Batch 4 + H1** (addressable sub-state, `ptahRoute` persistence, VS Code panel serializer).
- Main checkout `D:\projects\ptah-extension` has unrelated uncommitted changes — never touch.
- Plan: `implementation-plan.md` in this folder (§8, D5, D6, Host contract, Integration "Data flow").

## Rules (repeat to every lane)

- Memory-safe checks only: `npx nx run-many -t test,typecheck,lint -p <one-project> --parallel=1`; confirm header names exactly one project. Jest `--coverage=false --maxWorkers=2`. Filter output.
- Never workspace-wide; never build/serve/dev/e2e/package. One heavy check at a time across all lanes.
- Max 3 lanes; self-contained prompts with absolute paths and deliverables; ~20 min / ~40 tool calls per lane.
- Cross-side review: codex CLI reviews subagent code, a subagent reviews codex code; max 2 revise rounds. Codex does not run tests — run them yourself.
- Agents never run git writes. No bare `git stash` (stack is shared).
- Commitlint: subject ≤72, body lines ≤100, scope in enum (`git`/`security` are not scopes).

## Status per batch

| Batch | Scope                                                                                                            | Review                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 3a    | `RetainedViewDirective` (core)                                                                                   | approved                                                                                                  |
| 3b    | app-shell retained row; `NotificationLedgerService`, `AgentFollowUpQueueService`, eager `ThemeService`           | approved r2                                                                                               |
| 4a    | shared `webview-route-state`, core `boot-navigation`                                                             | approved                                                                                                  |
| 4b    | `SurfaceRoutePersistence`, `navigateToUrl`, D6 `replaceUrl` extras                                               | approved r2                                                                                               |
| 4c    | `ChatTabRouteSync` (chat `:tabId`)                                                                               | r2 REVISE defect 3 accepted as documented ASSUMPTION (see below)                                          |
| 4e    | Thoth tab routes, `selectTab` uses `replaceUrl`                                                                  | approved r2                                                                                               |
| 4e2   | `thoth` `loadChildren` → `THOTH_ROUTES`                                                                          | approved r1                                                                                               |
| H1    | `registerWebviewPanelSerializer` for `ptah-angular-spa`                                                          | approved r2                                                                                               |
| 4d    | boot navigation in webview (`initial-navigation.ts`, `app.ts`)                                                   | r2 REVISE: defect 2 fixed (r2 revision, unreviewed after fix); defect 1 accepted as follow-up (see below) |
| 4f    | `openSkillsDivergedClones` → `requestSurface('thoth',['skills'])`, request token cleared on cancelled/failed nav | approved r2                                                                                               |

**2026-10-11:** final scoped checks all pass (core, shared, chat, notification-center, thoth-shell,
ptah-extension-webview 17 suites / 435 tests, ptah-extension-vscode). thoth-shell failures did not
reproduce (31/31, 12.6 s); likely a timeout under machine load.
4d follow-up: a boot navigation cancelled by a newer host navigation returns without waiting; if that
newer navigation then fails, no surface lands. Owned by the newer navigation's caller.

## Next steps (in order)

1. **Codex review of 4d** (read-only, no checks). Cite plan §8, D5, Host contract, Data flow. Note the new file `apps/ptah-extension-webview/src/app/initial-navigation.ts` (outside plan, extracted so specs run real code). Deliverable `batch4d-review.md`. Max 2 rounds.
2. **4f** (frontend-developer): `libs/frontend/core/src/lib/services/app-state.service{,.spec}.ts` — `openSkillsDivergedClones` keeps the `canSwitchViews()` guard, calls `this.requestSurface('thoth', ['skills'])` and `this._skillsDivergedRequest.set(this._activeWorkspacePath())`, and no longer calls `setThothActiveTab`. Verify core only. Then codex review `batch4f-review.md`.
3. **Investigate thoth-shell**: a recent `@ptah-extension/thoth-shell` run had 2 failures in `thoth-shell.component.spec.ts` (32 s suite, worker force-exit). Earlier the same project passed 31/31. Re-run once, fix if real (likely `whenStable()` hang → wait for `NavigationEnd`).
4. **Final scoped checks, one at a time**: `@ptah-extension/core`, `@ptah-extension/shared`, `@ptah-extension/chat`, `@ptah-extension/notification-center`, `@ptah-extension/thoth-shell`, `ptah-extension-webview`, `ptah-extension-vscode`.
5. Report to user. Commit only on request (PR A files vs PR B files — split by batch table above).

## Last known check results

- chat, core, ptah-extension-vscode: pass.
- thoth-shell: 2 failures (see step 3).
- ptah-extension-webview: pass after 4d (17 suites, 428 tests, typecheck+lint clean).

## Follow-ups to report (non-blocking)

- 4c ASSUMPTION: a tab selection in the same sync turn as the first Electron workspace load can be overridden by a held `/chat/<id>`. Future fix: expose last-loaded active tab id from `TabManagerService.switchWorkspace`.
- H1: a failed restore closes the panel without fallback HTML; `retainContextWhenHidden` on restored panels needs manual smoke.
- Electron with no workspace folder: a held unknown tab id stays in the URL and is persisted.
- `parseWebviewRouteState` rejects `/marketplace/{overview,servers}/<origin>:<key>` (colon); see `server-ref.ts:31-37`.
- Electron `setState` is async IPC — reload right after navigation can lose the last write; an always-overlong seed means host wins every boot.
- Jest "worker failed to exit gracefully" warning in webview/thoth-shell suites; possibly the persistence subscription in specs.
- No spec covers ChatTabRouteSync correcting a restored `/chat/<unknown-id>` at boot.
- Manual checks needed: VS Code restart restore, Electron reload restore.
- TASK_2026_531_c4a8 task.md still says `backlog` though PR #638 merged it.

## Pitfalls

- Never `ViewContainerRef.detach()` in read/earlyRead phase.
- Background behavior inside `#shellRow` must live in an eagerly injected root service.
- Shared `__mocks__/vscode.ts` lacks `ExtensionMode`/`ViewColumn` — use local `jest.mock` overrides, do not edit the shared mock.
- `whenStable()` can hang in routed specs — wait for `NavigationEnd`.
- 4c/4e2/4d all touch `app.routes.ts` / `webview-routing.spec.ts` — serialize edits there.
- Codex lanes over ~60k tokens cannot resume; give full prompts.

## Reports in this folder

batch3b-atrisk-report, batch3b-review-r2, h1-report, h1-review(-r2), batch4b-report, batch4b-review(-r2), batch4c-report, batch4c-review(-r2), batch4e-report, batch4e-review(-r2), batch4e2-report, batch4e2-review, batch4d-report.
