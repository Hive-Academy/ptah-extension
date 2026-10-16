# Code logic review: Setup Hub merge resolution

Verdict: **APPROVED — 8/10** (0 blocking, 0 serious, 0 moderate, 1 minor)

Review family: codex (reviewer); setup-hub resolution author: codex lane; merge commit: Claude orchestrator

Scope: merge `df77b2f44`, main parent `3c153c574`, branch parent `4ffb07f26`, base `6c0490f1f`. The two Setup Hub files were compared against both parents. The working copies match the merge commit. This is a merge-logic review; the author-reported 11 passing tests in `reports/merge-2-resolution-report.md` were not rerun under the read-only review rules.

## Findings

| Severity | File:line | Issue | Evidence |
| --- | --- | --- | --- |
| Minor | `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:797` | Space does not activate the Command Center card from the keyboard. | The card is a focusable `div` with `role="button"`, but it handles only click and `keydown.enter` (lines 796-800). Unlike a native button, a `div` does not supply Space activation. The new tests exercise click and Enter only (`setup-hub.component.spec.ts:90-112`). This is limited to keyboard users pressing Space; Enter works. |

Score basis: the merge retains the main-side behavior and the branch card, and the route and host gates are consistent with the new entry. This is in the sound 7-8 band. The minor keyboard gap and absence of an independent runtime check keep it below 9; no main regression or serious failure supports a lower band.

## Main preservation checklist

- [x] **Adapter retained.** Main's removal of direct `HarnessRpcService` and `HarnessWorkflowService` from the Hub survives; the merged component injects `HarnessWorkflowRequestService` (`setup-hub.component.ts:1232-1235`). Configure and resume call `requestAndNavigate` (`:1402-1407`, `:1426-1431`).
- [x] **Warnings and errors retained.** Main's hub alert markup, service-backed signals and dismiss handlers survive (`setup-hub.component.ts:263-303`, `:1307-1318`); the merge adds no edits in those ranges.
- [x] **Conflict and intake flow retained.** Main's leave-choices confirmation, request-service mode queries, validated-intake handoff and outcome reporting survive (`setup-hub.component.ts:1200-1225`, `:1319-1355`, `:1433-1447`, `:1526-1588`). The `P2..M` diff contains no removals or edits in these flows.
- [x] **Main tests retained.** The main parent has nine `it(...)` cases and the merge has eleven. The `P2..M` spec diff changes only imports, provider wiring and the two inserted Command Center cases; the existing assertions remain intact (`setup-hub.component.spec.ts:124-220`).
- [x] **Branch card retained.** The card block and `openCommandCenter()` method in `P1` and `M` compare exactly. It appears after Tribunal and before Configuration (`setup-hub.component.ts:790-845`), uses the `Mic` icon, and calls `setCurrentView('command-center')` (`:1413-1415`). The different whole-component patch IDs are explained by main's adapter/import edits; the relevant branch blocks compare equal.
- [x] **Electron and test behavior checked.** `isElectron` reads `VSCodeService.isElectron` (`setup-hub.component.ts:1248-1250`); the card is under `@if (isElectron)` (`:790`). `VSCodeService` reads its config signal (`libs/frontend/core/src/lib/services/vscode.service.ts:182-183`). The tests recreate `host` and `navigate` in `beforeEach` (`setup-hub.component.spec.ts:46-47`), mark the OnPush fixture for check after changing the stub (`:91-93`, `:106-108`, `:114-116`), and assert click, Enter and hiding in VS Code (`:90-122`). The app route is registered at `apps/ptah-extension-webview/src/app/app.routes.ts:205-214` and uses the Electron surface guard.
- [x] **Clean-file spot check.** Stable patch IDs match for `apps/ptah-electron/src/activation/bootstrap.ts` (`5c0afab1`), `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`394e717f`), and `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (`2abf1a0f`). Each compared `git diff P2 M -- file` with `git diff B P1 -- file`.

## Five logic questions

1. **Silent failure:** `AppStateManager.setCurrentView` can return without navigating when `canSwitchViews()` is false (`libs/frontend/core/src/lib/services/app-state.service.ts:1002-1013`). The Command Center card uses the same existing navigation contract as Tribunal (`setup-hub.component.ts:1409-1415`); this is not a merge-specific regression. The tests assert the navigation request, not settled navigation.
2. **Unexpected user action:** pressing Space on the focused custom button does nothing (`setup-hub.component.ts:796-800`), as reported above.
3. **Wrong-answer input:** the new card passes no user data. The host boolean controls rendering, and the literal route ID is the registered Command Center route (`setup-hub.component.ts:790`, `:1413-1415`; `app.routes.ts:205-214`). No malformed input path was added here.
4. **Dependency failure or malformed return:** Command Center navigation delegates to the existing `void` `setCurrentView` API, so this card receives no failure result (`app-state.service.ts:1002-1013`). The preserved builder adapter reports its cancelled/failed outcomes through Hub alerts (`setup-hub.component.ts:1433-1447`). The new host read is a boolean getter and introduces no async dependency.
5. **Unspecified case:** keyboard Space activation is absent from the requested Enter coverage and remains the minor finding. No other missing merge requirement was established from these two files.

## Commands run

- `git diff --stat B P2`, `git diff --stat P2 M`, and `git diff --stat B P1` for the two Setup Hub files.
- `git diff --unified=3 B P2 -- <component/spec>`, `git diff --unified=3 P2 M -- <component/spec>`, and `git diff --unified=1 B P1 -- <spec>`; inspected the main adapter/alert flow and branch card/test additions.
- `git show P1:<component>` and `git show M:<component>` with exact card/method comparison; `git show P2:<spec>` and `git show M:<spec>` to count nine versus eleven tests.
- `git diff P2 M -- <three sampled files> | git patch-id --stable` compared with the corresponding `git diff B P1` patch IDs.
- `git diff --exit-code M -- <component/spec>` and `git diff --check P2 M -- <component/spec>`; both clean.
- Read task context, task description, implementation plan, style review, root `CLAUDE.md`, the author's resolution report, and targeted route/host/navigation code. Used `ptah_ast_analyze` on both Setup Hub files. `ptah_code_search_symbols` returned zero hits with an empty index, so native `rg` was used for targeted symbol lookup.

No Nx, Jest, TypeScript compiler, build, serve, package or e2e command was run, as requested. The author's report records one targeted Jest run with 11 passing tests; that result is cited as reported evidence, not independent verification.

## Decisions

- **Approve with a minor accessibility finding.** Options were to approve, require revision, or reject. The `P2..M` changes preserve main's logic, the card and route are coherent, and the Space gap is narrow and reversible by adding a handler or using a native button. The evidence supports approval without claiming complete keyboard coverage.
- **Use main as the preservation baseline.** Options were a manual line inventory or the parent diffs. `B..P2` identifies main's behavior and `P2..M` shows only card-related additions and fixture wiring; exact branch-block comparison confirms the former card behavior. This choice is reversible and auditable from the listed Git commands.
- **Do not rerun diagnostics or tests.** The task explicitly prohibits Nx, Jest and tsc. The author's targeted Jest result and static diff review are the available verification evidence; an independent runtime check remains outside this review's authorization.
