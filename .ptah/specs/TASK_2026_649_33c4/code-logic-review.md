# Code Logic Review - TASK_2026_649_33c4

Reviewer: code-logic-reviewer (Claude). Scope: `git diff main...HEAD -- libs apps` at HEAD `01cc3bc2a`,
focused on the 649 commits `0019f598a..01cc3bc2a`. All paths are relative to the worktree root.
Evidence: whole-file reads of the files named below, plus one targeted Jest run
(`apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts`: 6 of 6 fail, see S5).
No source was edited, no git write operation was run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 6 / 10 |
| Verdict | APPROVED WITH FIXES (fix S1-S5 before the PR; no Blocking issue) |
| Blocking | 0 |
| Serious | 5 |
| Moderate | 11 |
| Minor | 6 |

Why 6 and not 7-8: the structure is sound (frozen turn start before the first await, pinned root on the
write side, generation guards in hydration, single-flight guards in the leave and entry flows). But five
defects sit on likely paths (interrupt then continue, first-message retry, leaving the builder by any
route other than the dialog, a workspace switch, the webview test suite). Why not 5: nothing loses saved
data, and each Serious item has a one- or two-line fix.

## Findings

| ID | Sev | Area | Where | One-line |
| --- | --- | --- | --- | --- |
| S1 | Serious | D9 | `harness-proposal-turn-attribution.service.ts:94,107-113`; `harness-proposal-store.service.ts:48-59`; `harness-proposal-hydration.service.ts:109-124,357-366` | After an interrupted turn the next turn is unattributed and its proposals sort BEFORE every older attributed one, so older values and an older `isConfigComplete=false` win |
| S2 | Serious | Entry | `message-sender.service.ts:420-424`; `harness-workflow-request.service.ts:118-147,361` | The first-message preamble is consumed before `chat:start`; "Retry message" (and a reload) resends without the seed prompt, silently |
| S3 | Serious | Hand-off | `harness-workflow-request.service.ts:211,231-240,259`; `harness-builder-view.component.ts:450` | A pending intent that is never cancelled makes every Hub entry point return `'cancelled'` with no message until reload |
| S4 | Serious | D13 | `harness-proposal-store.service.ts:153-159,161-179`; `harness-rpc.handlers.ts:910-921`; `harness-builder-view.component.ts:454-479` | Proposals are saved under the pinned root but read (and the builder initialised) under the active root; after a workspace switch they are unreadable |
| S5 | Serious | Tests | `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:186,237-245,280` | The spec now fails 6/6 (no `SURFACE_ACTIVE` provider, asserts the removed AppState hand-off); `ptah-extension-webview` test would fail in CI |
| M1 | Moderate | D9 | `harness/di.ts:61-64`; `harness-proposal-store.service.ts:69-75` | The attribution service is constructed lazily with the store, so the first proposal after app start has no turn start |
| M2 | Moderate | D13/D9 | `harness-proposal-turn-attribution.service.ts:52`; `harness-proposal-store.service.ts:161-179` | Exact string equality of hook cwd vs pinned root; `requireRoot` hard-fails any non-normalized root with no fallback |
| M3 | Moderate | D13 | `ptah-api-builder.service.ts:874,1036-1045`; `mcp-caller-workspace-resolver.ts:66-77` | The pinned root can be the caller-declared MCP URL root, never checked against open folders |
| M4 | Moderate | Leave | `harness-builder-view.component.ts:496-560` | The outcome of `completePendingIntent` is ignored; no progress while `startNewProject` runs; the page flips to "no longer open" |
| M5 | Moderate | Binding | `harness-builder-view.component.ts:325,329,404-433,454-479`; `harness-helper.service.ts:80-85`; `harness-builder-sidebar.component.ts` (`document` signal) | State leaks and an init race when the route param changes on the same component instance |
| M6 | Moderate | Hydration | `harness-proposal-hydration.service.ts:314,339-340`; `builder-apply-section.component.ts:285-292`; `builder-ai-helpers-section.component.ts` (`addHelperResult`) | In the `error` state the preview is frozen, Apply still works on it, and "Added to preview" is announced without effect |
| M7 | Moderate | Records | `harness-builder-records.service.ts:244,255` | `sweepOrphans` is never called; tab close and session delete never `clearTab` (the spec requires both) |
| M8 | Moderate | Hub | `setup-hub.component.ts:1339-1361`; `harness-workflow-request.service.ts:222,238-239` | `openHarnessBuilder` and `resumeNewProject` discard the outcome; a failed navigation is not reported |
| M9 | Moderate | D12 | `harness-workflow-request.service.ts:97-106`; `harness-workflow-message.handler.ts:93,113,124` | The a1 abort warning and c1 relay errors only render on the Hub; in the switch flow the user never lands there |
| M10 | Moderate | Pinned root | `harness-builder-records.service.ts:108-116`; `harness-builder-view.component.ts:341-352`; `builder-apply-section.component.ts:292` | Apply writes to the case-folded, slash-normalized root, wrong on case-sensitive trees (WSL UNC) |
| M11 | Moderate | Entry | `harness-workflow-request.service.ts:221-222` | A same-mode tab makes a New Project request drop its validated intake silently |
| m1-m6 | Minor | misc | see "Minor" | |

## Five logic questions

1. Silent failure. The first-message retry sends the visible text without the seed prompt and reports
   success (S2). A proposal written in the turn after an interrupt is accepted and then shadowed (S1).
   `acceptPush` drops a revision that fails the schema with no log and no refresh (M6). A failed
   navigation from a Hub card shows nothing (M8). A stale pending intent makes the Hub cards inert (S3).
2. Unexpected user action. Stop, then ask again (S1). Leave the dialog open and navigate with a shortcut
   or a menu command (S3). Switch workspace in Electron and reopen the builder (S4). Click Back to Setup
   Hub while a New Project start is still running (M4). Reload between tab creation and first send (S2).
3. Wrong answer from valid input. Two proposals for the same field in different turns, the newer one
   unattributed (S1). A Windows path with a different case or separators between hook cwd and the pinned
   root (M2). A UNC/WSL workspace passed through `canonicalHarnessRoot` (M10).
4. Dependency failure. `chat:abort` failure is handled (a1). `harness:get-proposal` failure sets `error`,
   which then freezes the preview (M6). `harness:initialize` returning another root becomes a permanent
   init error (S4). `startNewProject` failing after the old builder was discarded leaves the user on a
   closed page (M4).
5. Missing and unrequested. No cleanup of local records on tab close (M7). No capability check for
   providers that never fire `UserPromptSubmit` (m2). No cap on the revision count in the proposal file
   (m5). No auto-clear of a stale intent (S3).

## Serious

### S1 - An interrupted turn makes the next turn unattributed, and unattributed revisions lose to older ones

- Files: `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-turn-attribution.service.ts:94,101,107-113`;
  `harness-proposal-store.service.ts:48-59,124-126`; `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts:109-124,357-366`.
- Evidence of the premise: the only emitters of `turnEnded`/`turnFailed` are the Stop hook
  (`libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts:105`) and the StopFailure hook
  (`stop-failure-hook-handler.ts:92`). `chat:abort` calls `sdkAdapter.interruptSession`
  (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1289-1290`), a user interrupt,
  for which Claude Code does not run Stop hooks. Nothing else clears `active`.
- Scenario: turn T1 starts at 10:00, the agent proposes `agents` (partial, `isConfigComplete=false`),
  revision R1 stores `turnStartedAt=10:00`. The user clicks Stop. `active` stays T1. The user types a
  follow-up: `onPromptSubmit` sees `state.active` and sets `ambiguous = true`, `active = undefined`. The
  agent proposes the final config (`isConfigComplete=true`): `capture()` returns no start, so R2 has no
  `turnStartedAt`. Both `compareRevisions` (backend) and `orderedRevisions` (frontend) place revisions
  without a start BEFORE every revision with one, so the order is `[R2, R1]`. Result: R1's field values
  overwrite R2's on overlapping ids/fields, the merged `isConfigComplete` is R1's `false`, and the sidebar
  never shows "Configuration looks ready" although the agent finished. Live and reload give the same
  wrong answer.
- Impact: a very ordinary interaction (Stop, then ask again) silently demotes the agent's newest
  proposal; the user sees a stale preview.
- Fix: clear attribution state on interrupt. Subscribe the service to the abort path (for example call
  `onTurnEnd(sessionId)` from `ChatSessionService.abortSession`, or emit a `turnEnded`-like event from
  `interruptSession`), and treat a new prompt after `active` as a replacement (the new turn wins) instead
  of `ambiguous`, because the SDK serializes turns per session. Independently, order unattributed
  revisions by write time among themselves and place them AFTER attributed ones only when their write
  time is later than the newest attributed `turnStartedAt`.

### S2 - Retrying the first New Project message drops the seed prompt

- Files: `libs/frontend/chat/src/lib/services/message-sender.service.ts:420-424` (consume),
  `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:118-147` (retry),
  `:150-185` (send), `:361` (the only `setFirstMessagePreamble`), `libs/frontend/chat-state/src/lib/tab-persistence.ts:115,238` (only `workflow` persists).
- Scenario: New Project start. `enter()` sets the preamble (the `startNewProject` seed with stack and
  plugin context), navigates, then `sendFirstMessage`. `startConversation` calls
  `consumeFirstMessagePreamble` before `chat:start`; the RPC then fails (backend rejects, auth, timeout).
  The entry error and "Retry message" appear. `retryFirstSend` removes the failed bubble and calls
  `sendFirstMessage(tabId, pending.content)` where `content` is only the intake summary. The preamble is
  gone, so the agent runs without the seed prompt and without `proposeConfig` instructions; nothing tells
  the user. The same loss happens when the app reloads between tab creation and the first send
  (`firstMessagePreamble` is not persisted), and for Configure when the user's first send fails and they
  resend by hand.
- Impact: the builder looks alive but the agent is un-framed; no proposals arrive, the preview stays empty.
- Fix: store the preamble in `pendingFirstSends` and re-apply `setFirstMessagePreamble` before every retry;
  better, have `startConversation` restore the preamble when `chat:start` fails (it already undoes the
  streaming flags there). Persist `firstMessagePreamble` in tab persistence for workflow-tagged tabs.

### S3 - A pending intent that is never cancelled disables every Hub entry silently

- Files: `harness-workflow-request.service.ts:211` (`if (this.transitioning || this._pendingIntent()) return 'cancelled'`),
  `:231-240` (set before navigation), `:259` (`cancelPendingIntent`); `harness-builder-view.component.ts:450`
  (`ngOnDestroy` only disconnects the observer); `setup-hub.component.ts:1339-1361,1478-1500` (outcome
  `'cancelled'` is neither shown nor handled).
- The intent is cleared only by: Cancel/Escape/backdrop in the dialog, a completed Save/Discard, or a
  non-landed navigation. Paths that leave it set: the view is destroyed while the dialog is open (a
  keyboard shortcut, a menu command, an `appState` view change, the source tab closed by another actor so
  `pageState` becomes `missing`), the source page lands in `wrong`/`missing` so the dialog effect
  (`view:435-446`) never opens it, or `completePendingIntent` returns `'cancelled'` because
  `transitioning` was true (`:264`).
- Scenario: Configure running; Hub, New Project, intake, "Open leave choices"; the builder page opens with
  the dialog; the user presses a global shortcut to another surface. Back on the Hub, the AI Team Builder
  and New Project cards, the relay and the confirm button all return `'cancelled'`. No error, no spinner,
  until the webview reloads. If the user later reopens that builder page the old dialog pops up again.
- Fix: in `ngOnDestroy` call `cancelPendingIntent()` when `pendingIntent()?.sourceTabId === tabId()` and no
  transition is running; in `requestAndNavigate` replace a stale intent when its source tab no longer
  exists or is not the displayed surface; make the Hub show `hubError` for `'cancelled'` with a stale
  intent.

### S4 - D13 is half done: reads and builder init still use the active workspace root

- Files: `harness-proposal-store.service.ts:153-159` (`get` calls `requireRoot()` with no argument, so it
  is always the provider root) versus `:93-101` (`save` honours the pinned root);
  `harness-rpc.handlers.ts:910-921` and `harness-rpc.schema.ts:203-205` (`harness:get-proposal` takes
  `sessionId` only, strict); `harness-builder-view.component.ts:454-479` (`rpc.initialize()` has no pin and
  the response root must equal the pinned root).
- Scenario: Electron, workspace A. A builder session proposes a config; the proposal is stored under
  `A/.ptah/harness/proposals`. The user switches to workspace B (or opens the builder tab of A from the
  tab bar while B is active), then reloads or the page rebinds. `hydration.bind` calls `getProposal`;
  the store reads `B/.ptah/...` and returns `null` (`read` also rejects a record whose `workspaceRoot`
  differs), so the status is `unavailable` and the preview is empty although the file exists. In the same
  state `initializeBuilder` throws "Workspace changed during builder setup", so `initialized` stays false
  and Apply, presets and helpers are unavailable ("Retry" fails the same way until the user switches back).
  The header badge promises "This configuration will still be applied to the workspace this build started
  in", which is not true for this state.
- Fix: accept an optional `workspaceRoot` (validated like `HarnessWorkspacePinParamsSchema`, normalized)
  in `harness:get-proposal` and `harness:initialize`, pass the tab's pinned root from the page, and have
  `store.get(sessionId, workspaceRoot?)` use `requireRoot(workspaceRoot)`.

### S5 - `unit5-message-routing.spec.ts` fails 6/6 after the transport change

- File: `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:186` (injects
  `HarnessWorkflowMessageHandler`), `:237-245` and `:280` (assert `appState.harnessWorkflowRequest()`).
- Run: `npx jest -c apps/ptah-extension-webview/jest.config.ts <spec> --coverage=false --maxWorkers=2`:
  "Tests: 6 failed, 6 total". Cause 1: the handler now injects `HarnessWorkflowRequestService` -> `ChatStore`
  -> `BatchedUpdateService`, which needs `SURFACE_ACTIVE` (NG0201); the production root provides it
  (`app.config.ts:148`), the spec does not. Cause 2: even with the provider, nothing sets
  `AppStateManager.harnessWorkflowRequest` any more (`requestHarnessWorkflow` has no remaining caller, see m3),
  so the two behavior asserts are stale.
- Impact: the project's own test target fails; the handoff only ran `app.routes.spec.ts` for this project.
- Fix: add the `SURFACE_ACTIVE` provider to the spec (mirror `app.config.ts`) and assert the new behavior
  (`requestAndNavigate` called, or `hubError` set for a malformed payload); remove the dead AppState API.

## Moderate

- M1 `harness/di.ts:61-64`, `harness-proposal-store.service.ts:69-75`. The attribution service registers its
  hook subscriptions only when the store is first resolved. Nothing resolves the store at startup (the RPC
  handler and the API builder resolve it at call time). The first turn of a brand-new session after app
  launch has already fired `UserPromptSubmit`, so its proposals are unattributed (user choice wins, e.g.
  after loading a preset). Resumed sessions are fine because the page reads proposals on open. Fix: resolve
  the attribution service eagerly in the composition root, or construct it from `registerHarnessServices`.
- M2 `turn-attribution.service.ts:52` compares hook `cwd` with the session root by `===`; case, trailing
  separator or worktree-vs-folder differences silently drop attribution. `harness-proposal-store.service.ts:161-179`
  throws for any root where `path.normalize(root) !== root` (for example `C:/proj` on Windows); before
  this change every root was accepted, now `proposeConfig` rejects with an error the agent sees but no
  fallback to the unpinned path. Fix: compare with a normalizing helper; on a non-normalized root normalize
  instead of throw.
- M3 `ptah-api-builder.service.ts:874` feeds `getPolicyWorkspaceRoot` from `resolveSessionWorkspaceRoot`,
  whose first tier is the root declared in the MCP URL (caller input, `workspace-root-resolver.ts`). The
  proposal store then `mkdir -p`s and writes `<root>/.ptah/harness/proposals/<hash>.json`. The MCP
  dispatcher validates the same value with `isPathWithinRoots` (`mcp-caller-workspace-resolver.ts:66-77`);
  this path does not. Fix: validate the pinned root against `workspaceProvider.getWorkspaceFolders()`, or
  prefer the session tier.
- M4 `harness-builder-view.component.ts:496-560`. `await this.requests.completePendingIntent()` (line 549)
  discards `'failed'/'cancelled'`. After Discard the tab is closed, so `pageState` becomes `missing` and
  the "This builder session is no longer open" card shows for the whole `startNewProject` RPC (seconds);
  its "Back to Setup Hub" button navigates to the Hub, after which `enter` navigates to the new builder
  anyway. After Save the dialog closes, `leaving` is true but nothing is visible, and a failed `enter` puts
  its `hubError` on a page the user is not on (the user stays on a paused draft). Fix: keep the dialog open
  with a busy state until the outcome is known; surface failures on the current page.
- M5 Same component instance, route param change (the switch flow navigates builder A -> builder B on one
  route config). `initialized` is not reset (`view:325`, set only in `initializeBuilder`), so the sidebar
  shows "ready" with emptied lists until the new response; two overlapping `initializeBuilder` calls can end
  with `initError=true` after the winner set `initialized=true` (the stale call's catch at `:477-478` runs
  last, success never clears `initError`). `saveFailed` (`:329`) is only reset on Cancel, so it stays true
  after a successful retry and shows "The draft could not be saved" on the next dialog.
  `HarnessHelperService._result` is a root singleton and the sidebar's `document` signal lives on the
  retained instance, so a helper result or generated document from tab A can be "Added to preview" in tab B
  and makes `hasPreview()` true for an empty tab B. Fix: key all of this state by `tabId` or reset it in the
  binding effect.
- M6 `hydration:339-340` skips `recompute()` while `status === 'error'`. In that state
  `builder-apply-section.component.ts:285-292` still applies `hydration.config()` (a frozen, possibly
  partial preview) and the helper/preset commit paths write a snapshot and announce "Added to preview"
  though the preview did not change. `acceptPush` (`:314`) returns silently when a revision fails schema
  validation (no log, no `refreshSession`). Fix: gate Apply on `status() !== 'error'`, fall back to
  `refreshSession` and log in `acceptPush`, and let `setSnapshot` recompute when the cause is only the
  failed read.
- M7 `harness-builder-records.service.ts:255` (`sweepOrphans`) and tab-close/session-delete cleanup are
  specified (`design-spec.md:181,412`, `implementation-plan.md:36,136`) but never called; `clearTab` is
  only used by Discard and entry rollback. A closed draft tab leaves a draft pointer, so
  `existingDraftAt` (`view` computed) tells the user "You already have a saved draft" and snapshots and
  stack profiles accumulate in localStorage. Fix: sweep after tab restore and on `tabs.tabClosed` and the
  delete path (`forgetWorkflowSession` site in `app-shell.component.ts`).
- M8 `setup-hub.component.ts:1339-1361`: `openHarnessBuilder` and `resumeNewProject` ignore the outcome.
  `requestAndNavigate` returns `navigateToBuilder(...)` directly for the same-mode path (`:222`) and for the
  conflict path (`:238-239`), and a `'failed'` result there is not turned into `reportHubError` (only
  thrown errors are). A failed lazy chunk load on a Hub click shows nothing. Fix: report `hubError` for
  `'failed'` inside the service so every caller benefits.
- M9 D12 a1/c1 render only on the Hub. In the two-way switch the user goes builder A -> builder B and never
  sees the "previous session could not be stopped" warning, and the old agent may still be running. A relay
  that arrives while the user is in chat and fails is invisible until they open the Hub, then persists
  indefinitely. Fix: show the warning on the destination builder page too (read the same signal), and
  clear stale `hubError` on a successful entry.
- M10 `canonicalHarnessRoot` (`records.service.ts:108-116`) lowercases the whole path for drive and UNC
  roots. `pinnedRoot()` (`view:341-352`) is that canonical form and is passed as the write target
  (`apply-section:292`, `rpc.apply({workspaceRoot})`, backend `harness-rpc.handlers.ts:487-520`).
  On a case-sensitive tree behind a UNC path (`\\wsl.localhost\Ubuntu\home\User\Proj`) Apply writes
  CLAUDE.md, agents and MCP config into `//wsl.localhost/ubuntu/home/user/proj`. Fix: keep the canonical
  form for keys and comparisons only; send the tab's original `workspacePath` to RPCs.
- M11 `harness-workflow-request.service.ts:221-222`. When a same-mode tab or draft exists, a New Project
  request with a validated intake (relay or `confirmDiscardAndStart`) navigates to it and drops the
  intake with no message. Fix: report that the existing session was resumed, or route the intake into the
  existing flow.

## Minor

- m1 Turn start is the hook time, not the send time (`attribution.service.ts:87-89`); a user choice made
  between Send and the first hook (seconds on a cold SDK start) is overridden by that turn's proposals.
- m2 Providers that never fire `UserPromptSubmit` (non-Claude adapters) get no turn starts, so the agent can
  never override a user-chosen field and the UI does not say why.
- m3 Dead code: `AppStateManager.requestHarnessWorkflow`/`consumeHarnessWorkflowRequest`/`HarnessWorkflowRequest`
  (`app-state.service.ts:130,1384,1389,1466`) have no caller; `sweepOrphans` (M7).
- m4 `HarnessProposalTurnAttributionService` reference counting (`capture().release`) protects nothing:
  `turnStartedAt` is returned as a string copy at capture time.
- m5 `revisions` in a proposal file grows without bound and the whole file is rewritten per save
  (`store.service.ts:124-141`).
- m6 The Hub status label "Running" (`hasRunningMode`) is true for any open non-draft flagged tab, including
  an idle restored one, and the conflict confirm then triggers for it; Hub intake text is lost if the user
  cancels from the leave dialog.

## Hand-off and leave checks (focus 3 and 4)

| Check | Result |
| --- | --- |
| Guard set before first await | OK (`requestAndNavigate:211-219`, `completePendingIntent:264-274`) |
| Double click on Save/Discard | OK (`transition` flag, `chooseLeave:497`) |
| Cancel clears intent | OK (`view:498-503`) |
| `chat:abort` failure | OK, warning set and flow continues (`view:526-533`); visibility limited (M9) |
| Malformed relay | OK, single error line and early return (`message-handler:93-124`) |
| Intent survives view destroy | NO (S3) |
| Tab id missing / closed / invalid | OK, `missing` card (`view:353-366`); bare `harness-builder` route (no params) also lands there |
| Mode vs tab workflow mismatch | OK, `wrong` card with Open in chat; the page never retags |
| Route param change on same instance | Partly (hydration and `bindTab` rebind; leaks in M5) |
| Effects firing twice | OK (keys `hydrationKey` and `initKey`); `initializeBuilder` can overlap (M5) |
| Unhandled rejections | None found; every async entry has try/catch or outcome handling |

## D9 / D13 / hydration checks (focus 1, 2, 5)

- Freeze before first await: OK. `harness-namespace.builder.ts:1106-1120` reads session, root and calls
  `getProposingTurnStartedAt` synchronously, then `await saveProposal`. `release()` runs in `finally`.
- Concurrent turns: OK for distinct sessions (keyed map). Same session: overlapping prompts mark the
  session ambiguous (safe, unattributed). The stale-after-abort case is S1.
- Record without start: user wins. Frontend `recompute` applies a pending choice last when no attributed
  revision follows it (`hydration:357-367`), matching D9. Strict `<` on ISO strings is safe because both
  sides use `toISOString`.
- Pinned root on write: OK for the session-derived tier (stable per session). Read side: S4. Root source
  trust: M3.
- `legacy` records without `revisions` get one unattributed revision (`schemas.ts:487-499`): OK.
- Precedence after reload equals live (same code path), which is why S1 is wrong in both.

## Parity check (focus 6)

Rows from `parity-inventory.md`; "reachable" means a wired user path exists at HEAD.

| Row | Capability | Status |
| --- | --- | --- |
| 1, 2, 5, 6 | Hub grid, header, intake modal, start-new-project RPC | Reachable, unchanged (Hub design kept) |
| 3, 4, 9, 10, 11 | Entry, resume, adapter, relay, hand-off | Reachable via `HarnessWorkflowRequestService`; old AppState hand-off removed (dead API m3, stale spec S5) |
| 7 | Stack profile | Wired (`builder-stack-profile-section`), local record, gated on `initialized` |
| 8, 43 | Conflict confirm, Start over | Wired: b1 copy + leave dialog (D12) |
| 12, 13 | Init with Retry, pin badge | Wired; pin badge and init conflict in S4/M5; idle follow-the-workspace re-init no longer applies on the tab-bound page (intended by design, row 13 "one pin") |
| 14 | Header title, summary | Wired (title, badge, `configSummary`) |
| 15-26, 31 | Composer, transport, transcript, cards, stats, Stop, model/effort | Replaced by shared chat; reachable |
| 27 | Stop (pause) | Chat-input Stop; no leave prompt |
| 28 | Workflow error alert | Entry error banner with Retry (S2 caveat), Hub error line (M8, M9) |
| 29 | Reload resume | Tab persistence plus draft pointer; no "Resumed after reload" note for plain reload (not a removal decision, minor) |
| 30, 59 | Flagged session as tile/badge | Done in 648 |
| 32, 33 | Leave while running, panel toggle | X button and Show/Hide panel present |
| 34-38 | Live preview, intake, hydration, merge | Wired; New Project proposals no longer dropped (hydration not mode-gated) |
| 39-42 | Ready banner, Apply, result, error | Wired in `builder-apply-section`; M6, M10 |
| 44-46 | Presets list, Save, Start from preset | Wired in `builder-presets-section` (a preset's `claudeMd` is not a choice field and is not carried into the preview) |
| 47 | Health | Wired (`HarnessHealthStore.refresh()` after Apply) |
| 48 | Agent tools | Unchanged (`harness-namespace.builder.ts`) |
| 49-53, 54 (discover-mcp, generate-prompt, generate-claude-md) | AI helpers | Wired: 8 `HELPERS` entries |
| 54 (search-skills, create-skill) | Agent tools | `keep (agent tool)` per D7, no sidebar buttons: correct |
| 55, 56 | Backend streaming, op-surface streaming | Unchanged backend; frontend surface removed (no callers) |
| 57 | Accessibility | Dialog has trap, Escape, `aria-modal`; M5 stale `saveFailed` aside |
| 58 | Grid adoption (FU-648-2) | Not exercised by 649 (D5); `requestCanvasTab` is called only in grid layout |
| 60 | Route | `harness-builder/:mode/:tabId` added; bare `harness-builder` route kept and lands on the `missing` card (no params) |

No user-visible capability disappeared without a decision row. The only removals are the old transport,
the AppState hand-off consumer and the `ptah.harness.workflow.v1` record (all `replace-infra`).

## D11 (focus 7)

`harness-builder-view.component.ts` host: `display:flex; flex-direction:column; height:100%; min-height:0;
overflow:hidden`; body row `flex flex-1 min-h-0 overflow-hidden`; docked wrapper `h-full min-h-0`;
sheet `absolute inset-0 min-h-0 overflow-hidden`; sidebar `aside` `flex flex-col min-h-0 h-full` with
`data-testid="sidebar-scroll-body"` as `flex-1 min-h-0 overflow-y-auto` and a fixed strip above it. The
Electron shell adds `min-h-0` on the 3-panel row and the configuration host
(`electron-shell.component.ts:276,308`); the route wrapper is `h-full w-full` (`app-shell.component.html:69`).
No missing ancestor constraint found by reading. The pixel proof at a short height is still owed (handoff
step 4); this review did not render it.

## Failure modes (summary)

| Name | Trigger | Symptom | Evidence | Fix |
| --- | --- | --- | --- | --- |
| Shadowed proposal | Stop, then continue | Stale preview, no "ready" state | S1 | Clear on interrupt |
| Unframed agent | First send fails and is retried, or reload | Builder chats but never proposes | S2 | Restore and persist preamble |
| Dead Hub | Dialog abandoned | Cards do nothing, no message | S3 | Cancel on destroy |
| Invisible proposal | Workspace switch | Empty preview, no Apply | S4 | Pass pinned root on reads |
| Red suite | CI | 6 failing tests | S5 | Fix spec, remove dead API |

## Verdict

- Recommendation: APPROVED WITH FIXES.
- Confidence: HIGH for S2-S5 (read and, for S5, run); MEDIUM-HIGH for S1 (the premise that an interrupt
  skips the Stop hook is documented Claude Code behavior and consistent with the code, but not run here).
- Top risk: S1/S3 are silent. The user sees a wrong preview or a dead button with no message.
- Fix round (suggested order): S5 (mechanical), S2, S3, S4, S1; then M1-M3, M6, M8 as cheap items. M4/M5
  deserve one design decision (busy state in the dialog, per-tab state). Re-review scoped to the touched
  files plus a test for each Serious item: interrupt-then-continue ordering, retry-with-preamble,
  destroy-with-intent, get-proposal under another active root.

## Re-review of 66e4227d6

Scope: `git show 66e4227d6 -- libs apps` read for the backend, shared, chat-state, message-sender,
hydration, request service, view and Hub changes. Orchestrator-verified checks were not re-run. No source
edited, no git write.

### Per-finding status

| ID | Status | Evidence | Remaining or new risk |
| --- | --- | --- | --- |
| S1 | Fixed | `chat-session.service.ts:1294-1295` calls `turnAttribution?.onTurnAborted` after `interruptSession`; `harness-proposal-turn-attribution.service.ts:107-109` reuses `onTurnEnd` (clears `active` and `ambiguous`). The order key is `turnStartedAt ?? updatedAt`, then `updatedAt`, then stable position, identical in `harness-proposal-store.service.ts:48-57` and `harness-proposal-hydration.service.ts` `orderedRevisions`. My Stop-then-continue scenario now yields `[R1, R2]` and the merged `isConfigComplete` is R2's | Introduces N2. Other interrupt sites (`chat-session.service.ts:1515,1683`, `chat-slash-command-router.service.ts:93`) do not clear attribution; the next prompt is then `ambiguous`, which is benign now (ordered by write time) |
| S2 | Fixed | `message-sender.service.ts:375,423,470-475,503-508` restores the consumed preamble on both the structural failure and the throw path; `pendingFirstSends` keeps `preamble` and `retryFirstSend` re-sets it only when the tab has none; `tab-persistence.ts:116-118,242-246` persists it for workflow tabs only and sanitizes on restore | Restore runs only on failure and the next success consumes it once, so no double apply. A throw after a successful `chat:start` would restore a used preamble; no such throw exists today (minor) |
| S3 | Fixed | `requestAndNavigate` drops a pending intent when the source tab is gone or `router.currentSurface() !== 'harness-builder'`; the view's `ngOnDestroy` cancels when `!transition && dialogOpen && source == tab`. Live flows hold: a relay or Hub call while the builder page with the dialog is displayed keeps the intent (`'cancelled'`); the Hub cannot be the displayed surface while the dialog is open; the landing window is covered by the `transitioning` check that runs first. A `wrong`/`missing` page whose dialog never opened is handled by the surface rule | Residual: the surface check does not compare which builder tab is displayed, so a stale intent for tab A survives while the user sits on builder B. `'cancelled'` from a superseded navigation or a double click now shows "Finish the current builder switch before opening another" (misleading, minor) |
| S4 | Partly fixed | `harness-rpc.schema.ts` get-proposal and initialize take a validated `workspaceRoot`; `harness-proposal-store.service.ts` `get(sessionId, workspaceRoot?)`; hydration passes `originalWorkspaceRoot`; `initializeBuilder` passes `pinnedWorkspaceRoot()`. Works when the tab's `workspacePath` is the same string the session was started with (Electron) | N1 breaks it when `workspacePath` is `null` (VS Code panel) on Windows; N4 |
| S5 | Fixed | The AppState workflow-request API is removed with no remaining references (grep); `unit5-message-routing.spec.ts` provides `SURFACE_ACTIVE` and asserts the request flow (orchestrator ran 7/7) | none |
| M10 | Partly fixed | The view keeps the original path (`pinnedWorkspaceRoot`) for the sidebar, Apply, initialize and get-proposal; the canonical form is for keys only | The fallback `lookup.workspacePath ?? this.requests.workspaceRoot` is still the canonical (lowercased, slash-normalized) form, see N1 |
| M11 | Partly fixed | A same-mode request now lands on the existing tab, prefills its composer with `formatIntakeSummary(intake)` and returns `'resumed'`; the Hub closes the intake modal for `landed`/`resumed` | N3: the prefill overwrites text already in that composer; the notice goes through the Hub error line |

### New findings

#### N1 - Serious - pinned-root fallback sends the lowercased canonical root; initialize rejects it and the proposal read misses (VS Code, Windows)

- Files: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`
  (`pinnedWorkspaceRoot`: `lookup.workspacePath ?? this.requests.workspaceRoot`);
  `harness-workflow-request.service.ts:73-77` (the `workspaceRoot` getter returns `canonicalHarnessRoot(...)`);
  `harness-rpc.handlers.ts` initialize (`path.normalize(folder) === requestedRoot`);
  `harness-proposal-store.service.ts:190-210` (`read` rejects `result.data.workspaceRoot !== root`).
- `TabLookupResult.workspacePath` is `null` in the VS Code panel (`tab-workspace-partition.service.ts:21-27`), so
  the fallback runs. `canonicalHarnessRoot` lowercases the whole path for drive-letter and UNC roots.
- Scenario: VS Code on Windows, folder `C:\Users\Ann\MyApp`. The page sends `c:/users/ann/myapp` to
  `harness:initialize`. The handler compares `c:\users\ann\myapp` with `C:\Users\Ann\MyApp` using `===`: no
  match, so "Pinned workspace root is not an open workspace folder." is thrown. `initError` is permanent and
  Apply, presets and AI helpers are unavailable. Before this commit initialize took no argument and worked.
  Likewise `get-proposal` finds the file (case-insensitive FS) but `read` rejects the record because its stored
  `workspaceRoot` differs by case, returns null, and the preview shows `unavailable` after reload. Even in
  Electron, a difference in drive-letter case or trailing separator between the tab's `workspacePath` and
  `getWorkspaceFolders()` triggers the same.
- Fix: send the raw `tabs.activeWorkspacePath ?? vscode.config().workspaceRoot` as the fallback (not the
  canonical getter), and compare roots on the backend with one helper that is case-insensitive on win32 and
  tolerant of trailing separators (the existing `isPathWithinRoots`, or an equality variant), for the
  open-folder check in initialize and for the stored-versus-requested check in `read`.

#### N2 - Moderate - D9 user-choice precedence is lost for unattributed revisions that sort after an attributed one

- File: `harness-proposal-hydration.service.ts` `recompute` (a choice is applied just before the first
  revision whose `turnStartedAt > chosenAt`), combined with the new `turnStartedAt ?? updatedAt` ordering.
- Scenario: the user picks `agents` at 10:00. Turn T2 starts 10:05 and an attributed revision R is written. A
  later unattributed revision U (a mid-turn queued prompt marked `ambiguous`, or a provider that fires no hook)
  is written at 10:07 for the same field. Order `[R, U]`: the choice is applied before R, then R and U
  overwrite it. D9 says a record without a stored start leaves the user's choice winning; it now loses
  whenever an attributed revision with a later start precedes it. Before the fix unattributed revisions sorted
  first, so the choice always won over them.
- Fix: in `recompute`, re-apply the user choice after any unattributed revision that touches the chosen
  field (or apply the choice last for fields whose latest revision is unattributed).

#### N3 - Moderate - the M11 resume overwrites the composer and reports through the Hub error line

- Files: `harness-workflow-request.service.ts` (`requestComposerPrefill(formatIntakeSummary(...), same)` then
  `reportHubError('Resumed your existing New Project session...')`); `chat-view.component.ts:1376-1388`
  (`restoreContentToInput` replaces the composer text).
- Scenario: the user has half-typed a reply in the open New Project session, goes to the Hub and submits a new
  intake. The reply is replaced by the intake summary with no undo. The informational message is stored as
  `hubError` (error styling), shown only on the Hub the user just left, and appears later as a stale red line.
- Fix: append to, or confirm before replacing, non-empty composer text; show the notice as a status on the
  builder page or through a Hub status signal, not the error channel.

#### N4 - Minor - get-proposal accepts any absolute root and prunes under it

- Files: `harness-rpc.handlers.ts` get-proposal (no open-folder check, unlike initialize) and
  `harness-proposal-store.service.ts` `prune` (unlinks expired or invalid hash-named files under the supplied
  root). The schema rejects relative and `..` paths and the input comes from the webview, so the reach is
  small, but the two RPCs validate differently. Fix: share the open-folder check.

### Other observations

- M1, M2, M3 and M5-M9 were outside this fix scope and remain open. With the new ordering an unattributed
  first proposal (M1) is placed by write time, so its impact dropped.
- `reportEntryOutcome` is applied to `openHarnessBuilder`, `resumeNewProject` and both intake paths, which
  closes M8 for the Hub cards.

### Updated verdict

- S1, S2, S3 and S5 are fixed. S4 and M10 are fixed for Electron and any host whose tab has a `workspacePath`,
  and regress on VS Code for Windows paths with uppercase letters (N1).
- Open Serious: N1. New Moderate: N2, N3.
- Score 7/10. Verdict: APPROVED WITH FIXES (no Blocking). Fix N1 before the PR; N2 and N3 can follow in the
  same round if cheap. Tests to add: initialize and get-proposal with a mixed-case Windows root and a null tab
  `workspacePath`; hydration with `[choice, attributed R, unattributed U]`.

## Final review of 0df579dbb

Scope: `git show 0df579dbb -- libs apps`, read for the backend handlers, schema, store, the new
`workspace-authorization.ts` helpers, and the harness-builder view, Hub, hydration and request service. The
orchestrator-verified checks were not re-run. No source edited, no git write.

### Per-finding status

| ID | Status | Evidence |
| --- | --- | --- |
| N1 | Fixed | The VS Code fallback is now `requests.rawWorkspaceRoot` (`harness-builder-view.component.ts` `pinnedWorkspaceRoot`). The backend resolves every pinned root with `findOpenWorkspaceRoot` (`workspace-authorization.ts`), which uses `sameWorkspaceRoot` (resolve, strip trailing separators, lowercase on win32) and returns the open folder's own spelling. Initialize returns `pinnedFolder` as `workspaceRoot` and builds context from it. The store `read` now compares with `sameWorkspaceRoot`. The frontend compare in `initializeBuilder` is `canonicalHarnessRoot(response.workspaceRoot) !== canonicalHarnessRoot(pinned)`; canonical form folds drive case, slashes and trailing separators, which is what `sameWorkspaceRoot` equates, so a valid root no longer mismatches. Electron (tab `workspacePath`) and VS Code (null path) both reach the same helper |
| N1 store change | Safe | `requireRoot` dropped `path.normalize(x) === x` and added a `..` segment check plus absolute, trim and NUL checks. The root is only used through `path.join(root, '.ptah', ...)`, so a non-normalized spelling (forward slashes, trailing separator) is harmless; traversal is rejected on both separators |
| N2 | Mostly fixed | `harness-proposal-hydration.service.ts` `recompute`: after an unattributed revision, the user choice is re-applied for the fields that revision touches. The N2 scenario `[choice, attributed R, unattributed U]` now keeps the choice. New edge case N5 below |
| N3 | Fixed | The prefill goes through `restoreContentToInput`, which returns early when the composer has non-blank text (`chat-input.component.ts:1574-1577`), so typed text is never overwritten; the intake is also stored in `resumedIntake` and shown in a `<details>` on the builder page for that tab id. The Hub no longer uses the error channel: `reportEntryOutcome` dismisses the Hub error for `landed`/`resumed` |
| N4 | Fixed | `harness:get-proposal` calls `findOpenWorkspaceRoot` and throws before `resolveService`/`store.get`, so no read or prune happens for a non-open root. `harness:apply` got the same check and now writes into the open folder's spelling |

### New findings

#### N5 - Moderate - the N2 fix applies the choice early and lets a later stale attributed revision override it

- File: `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts` `recompute`
  (`applyChoice` now does `pending.delete(field)` without an early return, and the new block calls it right
  after an unattributed revision that touches the field).
- Scenario: the unattributed revision U (for example the first proposal after launch, M1) is written at 10:03
  and sorts by write time. Turn T2 starts 10:04. The user chooses `agents` at 10:05. T2 proposes `agents`,
  attributed with start 10:04. Order `[U, R(10:04)]`. The choice is applied right after U and removed from
  `pending`; then R merges over it. D9 says a proposal from a turn that started before the choice (10:04 <
  10:05) is stale for the chosen field and the user wins; here the agent overrides the choice. Before this
  change the choice stayed pending and was applied last.
- Fix: keep the field pending after the unattributed re-apply (apply without deleting), so a later attributed
  revision with `turnStartedAt > chosenAt` still triggers the pre-apply and a stale one is followed by the
  end-of-loop apply; or re-apply the choice after every revision whose `turnStartedAt <= chosenAt`.

#### N6 - Minor - the resumed-intake note is never cleared

- File: `harness-workflow-request.service.ts` (`_resumedIntake` is set on `'resumed'` and cleared only on a
  later `'landed'` for a same-mode request) and `harness-builder-view.component.ts` (`resumedIntake` has no
  Dismiss). After the user sends the intake (or discards it) the banner "New intake for this session - review
  before sending" stays for the tab until reload, and it duplicates the text the composer already holds.
  Fix: clear it when the tab's message list grows or add a Dismiss button.

### Other checks (no defect found)

- `sameWorkspaceRoot` on posix is case-sensitive and strips trailing separators; on win32 it lowercases after
  `path.win32.resolve`, and `C:\` / UNC share roots are kept intact by the `parse(...).root` guard.
- `findOpenWorkspaceRoot` over `getWorkspaceFolders()` covers all open Electron workspaces
  (`electron-workspace-provider.ts:78`), so a pinned root for a non-active workspace passes; a workspace that
  was closed mid-build now makes initialize, get-proposal and apply reject with the same message (intended).
  The CLI commands send no `workspaceRoot` (`apps/ptah-cli/src/cli/commands/harness.ts:348,393`), so they are
  unaffected.
- Still open from earlier rounds and not part of the correction scope: M1-M9 (notably M4 leave outcome,
  M5 same-instance state, M6 hydration error state, M7 records sweep).

### Final verdict

- Blocking: 0. Serious open: 0 (S1-S5, N1, N3, N4 fixed). Moderate new: N5. Minor new: N6.
- Score 8/10. Verdict: APPROVED. N5 is a narrow D9 edge and a one-line change; fix it in the PR if cheap,
  otherwise track it with M1-M9 as follow-ups.
