# Implementation plan review (Gate 2, Anthropic side) - TASK_2026_593_7c2e

Verdict: REVISE

Reviewed: `implementation-plan.md` (129 lines) against `task-description.md`, `decisions.md` #1-#15, `design-spec.md`, `design-revision-1.md`, `parity-inventory.md`, `context.md`, and the source in this worktree. No checks were run; this is a document review.

What holds up: the core/feature split is legal. `libs/frontend/core` is `type:core`, `notification-center` and `chat` are `type:feature`, `chat-state` is `type:data-access` (each lib's `project.json:7`). The port + three adapters shape follows the repository pattern. The `attention:` prefix is correctly routed to `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-69`). Every file named in the batch table exists. No file appears in two rows (checked mechanically). No row has more than 8 files. Every AC from 1 to 35 maps to at least one batch. The plan never edits `orchestra-canvas.component.ts`, and it keeps `BackOfficeActivityService`. The evidence I spot-checked is accurate: `permission-handler.service.ts:111-125`, `sdk-permission-handler.ts:336-346`, `electron-user-interaction.ts:144-150`, `notification-center.store.ts:17-32` and `angular-webview.provider.ts:65-82,214-232`.

## Rulings on the two known conflicts

### Ruling 1: session-title opt-in (plan decision "No host session-title opt-in" vs decisions.md #10)

The two sources say:

- `design-spec.md:56` says: "Never include ... a session title in OS or VS Code host notifications. **Session titles have no host-notification opt-in.**"
- `decisions.md:13` (#10) says "a setting may show titles (off by default)", and `task-description.md:101` repeats it ("A separate title-display opt-in may show the session title and defaults off").

Authority: #10 does not come from a user answer. Its source column reads "privacy; reviewer". The task description was approved by lane review (decisions #1: lane-review for Gates 1 and 2). The design is the only user-approved artifact of the two (#15, Gate 1.7, "notification is approved"). It is also later and more specific. #10 is permissive ("may"). No formal AC requires the setting: AC15, AC16 and AC26 cover only the default text. The capability does not exist today, so leaving it out removes nothing a user has now.

**Ruling: the approved design wins. Build no title opt-in.** The plan's justification is wrong, though. It says the design "strengthens the task privacy default", which treats the design as agreeing with #10 when in fact it overrides it. The topic is privacy, which is a user-reserved category, so the plan must not settle it silently. Required changes are under Serious S1, and the item is listed under "User decisions needed".

### Ruling 2: Clear all (plan decision "Formal AC7 governs Clear all presentation")

The user-approved design is explicit in three places:

- `design-spec.md:31`: "Clear all notices removes only Recent notices and transient failure/warning snackbars. It leaves live request snackbars and Needs you rows untouched."
- `design-spec.md:37`: "It clears only Recent notices and transient failure/warning presentations, never live request snackbars or Needs you rows."
- `design-revision-1.md` M3: "live requests and their snackbars remain until answered or individually dismissed."

AC7 (`task-description.md:34`, plus `:76`) says Clear all also hides "live-request snackbars". The task description was approved by lane review, not by the user. A plan, a reviewer or a team leader cannot overrule a user-approved design, and the plan must not propose amending `design-spec.md`.

**Ruling: implement the design.** Do not edit `design-spec.md`. Add a note to `decisions.md`, not a design change, saying that the clause "including live-request snackbars" in AC7 and `task-description.md:76` is superseded by #15 (`design-spec.md:31,37`, `design-revision-1.md` M3). Reviewers and testers check AC7 under that reading. AC28 stays satisfied through the per-snackbar dismiss. The exact plan edits are in Blocking B1.

## Blocking

**B1. Clear all must follow the approved design.**
Evidence: `implementation-plan.md:7`, `:40`, `:46`, `:76`, `:121` and `:129`, against `design-spec.md:31,37`.
Required changes:
- `:7`: remove "Implement AC7 ... Amend the design-spec wording before UI sign-off". Replace it with: "Clear all follows the user-approved design (#15): it clears Recent notices and transient failure/warning snackbars only. Live request snackbars and Needs you rows stay until the request is answered or withdrawn, or until that snackbar is dismissed individually. AC7's live-snackbar clause is superseded; recorded in decisions.md."
- `:40` (`clearAll` contract): change "clears Recent and hides current snackbars" to "clears Recent notices and hides transient failure/warning presentations; never touches live-request presentations".
- `:46`: change "Live request stays until answered, snoozed, or Clear all" to "until answered, withdrawn, or individually dismissed". Add the design rule that Clear all is enabled only while a Recent notice or a transient failure/warning snackbar exists (`design-spec.md:37`).
- `:76`: keep "Clear all clears dismissible history/presentations only", and add "never live-request snackbars".
- `:121`: replace the decision row with "Clear all scope follows approved design #15; AC7 clause superseded (decisions.md note)", and drop "amend design-spec.md:37".
- A1 seam (`:43`): the Clear all test must assert that live-request snackbars stay visible after Clear all.

**B2. The git warning snackbar contradicts the approved design. This is the same class of error as B1.**
Evidence: `implementation-plan.md:7` and `:122` choose "Implement AC10", showing the snackbar while git is open and suppressing it only when the strip is *focused*. The design (`design-spec.md:17`) says: "Show one keyed warning snackbar for 10s **only while the git surface is not visible**. When the git surface is visible, its dismissible local strip is the sole active presentation." `design-revision-1.md` M2 records this as the explicit fix.
Required changes:
- Rewrite the git sentence at `:7`, the row at `:122` and the git bullet at `:67`. Visibility of the git surface, not focus, decides suppression. When git is visible, the strip is the only presentation. When git is hidden, show one 10s warning snackbar. The Recent notices row exists in both cases.
- Add a `decisions.md` note that the clause "show one ... warning snackbar ... while the git surface is open" in AC10 (`task-description.md:37`, `:89`) is superseded by #15.
- C2's seam must test the hidden case and the visible case.

## Serious

**S1. The title opt-in decision is misattributed and must be flagged to the user (Ruling 1).**
Evidence: `implementation-plan.md:63` and `:120`, against `decisions.md:13`.
Required changes:
- Reword `:120` to "No session-title host opt-in: approved design #15 (`design-spec.md:56`) supersedes the optional setting in #10 / `task-description.md:101`".
- Have the orchestrator add a matching `decisions.md` note.
- Add the item to the plan's `## Clarifications Needed`, recommending the approved design. The build does not wait on the answer: the shipped behaviour (no titles) is identical either way, and adding the setting later is additive.

**S2. Some permission producers are not covered by host ingress.**
B3 (`:94`) and Risks (`:106`) list only `sdk-permission-handler.ts:253-344` and `cli-agent-runtime/.../agent-events.ts:302-305`. Two more sources send permission requests to the webview:
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.ts:63-76`. The MCP `approval_prompt` path calls `permissionPromptService.createRequest` and sends `MESSAGE_TYPES.PERMISSION_REQUEST`.
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:957-971`, a second `PERMISSION_REQUEST` emission path.

Without them, AC1, AC13 and AC14 fail for MCP approval prompts while the app is in the background.
Required change: add `approval-prompt.handler.ts` and its spec to an ingress batch, or route that path through the coordinator. Name every producer, and add a test that fails if a new emission of `PERMISSION_REQUEST` or `AGENT_MONITOR_PERMISSION_REQUEST` bypasses the coordinator.

**S3. `HostAttentionCoordinator` is never registered or wired.**
B3 creates `host-attention-coordinator.ts`, but no row modifies:
- `libs/backend/agent-sdk/src/lib/di/register.ts` or `libs/backend/agent-sdk/src/lib/di/tokens.ts`;
- the VS Code phase files `apps/ptah-extension-vscode/src/di/phase-*.ts`;
- the Electron DI phase that resolves agent-sdk services;
- the CLI container at `libs/backend/cli-engine/src/lib/container.ts`.

The `expected-resolvable.ts` edits in B4, B5 and B6 cannot list a token that nothing registers.
Required changes:
- Specify the coordinator's token, its registration phase in each host, its dependency on `PLATFORM_TOKENS.<new>` and settings, and who constructs it.
- Add those files to batches, respecting the 8-file cap, and add the token to all three `expected-resolvable.ts` files.

**S4. Nothing in the renderer consumes the new host protocol.**
Component 3 (`:54`) defines an `attention:changed` push, an `attention:getSnapshot` RPC and a host Open route. Component 4 (`:61`) adds "queues route until renderer readiness". No frontend batch registers a `MESSAGE_HANDLERS` handler (`libs/frontend/core/src/lib/services/message-router.types.ts`) or calls the snapshot. That leaves these requirements unbuilt:
- AC2/AC14: reconcile on reveal;
- AC5/AC13: native click routes to the correct session;
- AC32: host action on a surfaceMode request.

Required change: either assign a handler file to an A-batch owner, for example a chat-lib handler that feeds `NotificationService` and `NOTIFICATION_FOCUS_ROUTER`, with its spec, or remove the push and snapshot and state how reveal reconciliation and host-originated routing work without them. A contract nobody consumes is a speculative surface.

**S5. Batch A3 cannot pass its own checks.**
A3 deletes `notification-ledger.service.ts`, but other batches' files import it:
- `libs/frontend/notification-center/src/index.ts:3` (owned by A4);
- `notification-announcer.component.ts:2,26` (A4);
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:69,181` (A5);
- three app-shell specs (A5).

Required change: move the deletion to the last of A3, A4 and A5. Or put the deletion, `index.ts` and the announcer in one row, and state the ordering in the paragraph at `:103`.

**S6. The Electron adapter cannot reach `Notification` as planned.**
`platform-electron` receives Electron APIs through `ElectronPlatformOptions` (`libs/backend/platform-electron/src/registration.ts:60-61`: `getWindow`, `dialog` and others are injected; the lib does not import `electron`). The options are built in `apps/ptah-electron/src/activation/bootstrap.ts`. B4 owns `phase-0-platform.ts`, which only spreads options (`phase-0-platform.ts:46-51`).
Required changes:
- Add `bootstrap.ts` to B4 and specify the injected `Notification` factory on the options type.
- Specify the main-to-renderer path for the click route. This path depends on S4.

**S7. The VS Code visibility seam is undefined.**
`:62` says to "wire visibility changes and reveal" in `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`. The adapter lives in `libs/backend/platform-vscode`, which cannot import the app. Views are registered through `webviewManager.registerWebviewView` (`angular-webview.provider.ts:70,231`).
Required change: name the contract. Either the port gets a visibility input that the provider feeds for `ptah.main` and every panel, or the adapter queries the vscode-core `WebviewManager`. Give the file and owner of each side. The current text leaves the lane to invent a cross-boundary API.

## Moderate

**M1. The voice-session sound guard cannot sit in core.** `CommandCenterVoiceSessionService` lives in `libs/frontend/chat-state` (`type:data-access`). The A1 seam (`:43`) lists "active voice mute" as a pure core-model test. Required change: the chat source computes a sound-eligibility flag on the item and core only respects it. Alternatively the guard stays in notification-center (A4) after its tag allowance is checked. State which.

**M2. The action-dispatch contract is missing.** Notification-center "imports core only" (`:32`), and "action identifiers are resolved by source adapters" (`:40`). Required change: define the core-level dispatch seam that lets the bell and snackbar invoke Allow, Deny, Answer, Retry or Switch without importing chat. This could be a token such as `NOTIFICATION_FOCUS_ROUTER`, or a handler registration on `NotificationService`. Give its failure behaviour.

**M3. The responder signature must be preserved and its guard reused.** `canvas-lane-view.component.ts:219,393` and its spec (`:312-313`) call `respondLane(agentId, requestId, decision)`. Canvas files are outside this task. `AgentPermissionResponder` already has a guard (`agent-permission-responder.ts:18,27-29`, `answeredRequestIds`). Required change: A2 keeps the public signature, and it extends or reuses the existing guard instead of adding a second in-flight set (`:41`).

**M4. Back-office projection: ordering and compatibility.**
- `orchestra-canvas.component.ts:21,300` injects `BackOfficeActivityService` until TASK_702 removes the ticker. Required change: C3 keeps the current public surface and only adds to it.
- A2 (`:32`) projects back-office failures, but C3 adds the failure projection later. Required change: move the back-office projection to C3, or schedule C3 before A2.

**M5. RPC contract placement and schema ownership.**
- `rpc.types.ts` is 4301 lines and already splits types by domain (`rpc.types.ts:11-15`, `libs/shared/src/lib/types/rpc/`). Required change: put the attention RPC types in a new `libs/shared/src/lib/types/rpc/rpc-attention.types.ts` and touch `rpc.types.ts` only for the re-export and the method-map entry.
- A6 (`:54`) and B2 both claim "strict Zod" schemas. Required change: name one owner. The precedent is `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.schema.ts`; for push payloads it is `libs/shared/src/lib/types/messages/schemas.ts`.
- B2 also needs the handler exported from `libs/backend/rpc-handlers/src/lib/handlers/index.ts` and `src/index.ts`, following `SettingsRpcHandlers` (`handlers/index.ts:56`, `src/index.ts:43`).

**M6. DI and RPC guard specs land in a later batch than the change they guard.** B2 adds the prefix, manifest entry and handler, but the three host `rpc-surface.spec.ts` files are updated in B6. The host specs are red for every commit in between. Required change: put the guard spec updates in the same commit as B2 (and the same for `expected-resolvable.ts` in S3), or require B2 and B6 to be committed together.

**M7. The shared port contract suite is missing.** The repository pattern requires a contract suite in `libs/backend/platform-core/src/testing/contracts/` for a new port. The seam at `:64` mentions a "shared port contract", but no row creates it. Required change: add it to B1 and run it in B4, B5 and B6.

**M8. B2's change to `agent-rpc.handlers.ts` has no stated purpose.** Required change: state why B2 modifies this file, or drop it from the row.

## Minor

- **m1.** "finish sound/announcer" (`:71`) reads as removing the announcer. The announcer is `keep` (`parity-inventory.md:18`), and A4 modifies it rather than deleting it. Reword to "finished-turn sound and announcements".
- **m2.** Carry these approved design rules into Component 2 (`:46`):
  - one card at 900px and below, and one card when vertical space is short (`design-spec.md:27,35`);
  - pause timeouts and hide redundant snackbars while the bell panel is open (`:39`);
  - hover and focus pause the timer without restarting it, and no auto-dismiss while focus is inside a snackbar (`:51`);
  - a dismiss hit area of 24/44px (`:51`);
  - the snackbar host has no live role, and the shell announcer owns announcements (`:51`).
- **m3.** `:62` reads as if "Open Ptah" appears only when no view is visible. The design (`:56`) says the *message is emitted* only when no Ptah sidebar or panel is visible, and every message carries Open Ptah. Reword.
- **m4.** The design is inconsistent with itself about where focus goes when the bell opens (`design-spec.md:39`: heading; `:51`: first enabled row). The plan's choice (`:46`) matches `:51` and AC29, which is correct. Record it in `decisions.md` so the visual reviewer does not reopen it.
- **m5.** On merge order (`:103`), name the PR that must merge before TASK_702's last phase: the one containing A2-A5, where the bell gets the lane Allow/Deny/Open actions. Decision #14 is about this task's merge, not a "Phase A" the 702 side cannot see.
- **m6.** Remove `:129` ("the team leader should update the design text before visual sign-off"). Nobody edits the approved design; the AC notes go in `decisions.md`.

## User decisions needed

1. **Session-title opt-in for host notifications.** Decision #10 (reviewer-derived) allows an off-by-default setting; the user-approved design (#15, `design-spec.md:56`) says there is no opt-in. Options: (a) **no opt-in, per the approved design (Recommended)**; (b) add the off-by-default title setting from #10. The build proceeds with (a). Choosing (b) later adds one boolean setting and one text-builder branch.

No capability removals beyond those the user already approved were found. The ledger, the completion rows and Read all, the finished-turn sound, and the one-off voice toast (moved) are all covered by `parity-inventory.md:10,11,15,25,38,63`. The canvas chip, dock and ticker remain TASK_702's, as approved under #13.

## Round 1 re-review

Verdict: REVISE

Reviewed the revised `implementation-plan.md` (140 lines) against `implementation-plan-revision-1.md`, round 0 above, `decisions.md` #15-#19, `design-spec.md` and `task-description.md`. This was a read-only check. New file:line claims were spot-checked in the worktree. One new Serious finding remains: a batch cannot pass its own scoped test. It is a small fix in the batch table. Every round-0 Blocking finding is resolved.

### Host ingress claim (verified)

The architect says Electron and CLI use their own webview-manager adapters, so all three need one shared ingress contract. This is **true**:

- Every request producer pushes through `TOKENS.WEBVIEW_MANAGER`:
  - `sdk-permission-handler.ts:269-270` (normal);
  - `:340-343` (lane);
  - `:975` calls `sendPermissionRequest` (second path);
  - `ask-user-question.service.ts:85-88`;
  - `cli-agent-runtime/src/lib/wiring/agent-events.ts:303-305` (`broadcastMessage`);
  - `vscode-lm-tools/.../approval-prompt.handler.ts:71-73`.
- That token is bound to three different classes:
  - VS Code: `vscode-core/src/di/register.ts:74` -> `WebviewManager`;
  - Electron: `apps/ptah-electron/src/activation/bootstrap.ts:412-416` -> `ElectronWebviewManagerAdapter`, which overrides the vscode-core binding;
  - CLI: `cli-engine/src/lib/container.ts:412-413` -> `CliWebviewManagerAdapter`, or an injected `pushAdapter`. The TUI's `TuiWebviewManagerAdapter` extends `CliWebviewManagerAdapter` (`apps/ptah-tui/src/transport/tui-webview-manager-adapter.ts:3`), so it is covered.
- The cited method ranges are accurate: `webview-manager.ts:192-218,297-307`, `webview-manager-adapter.ts:47-61,88-90` and `cli-webview-manager-adapter.ts:25-38`.
- I found no fourth `WEBVIEW_MANAGER` binding outside specs.

A hook in VS Code's `WebviewManager` alone would miss every Electron and CLI request, so one shared ingress is the right design.

### Round-0 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 Clear all | Resolved | `:88`, `:40` (contract), `:44` (A1 test keeps live snackbar), `:48` (enablement rule), `:80`, `:132`; matches `design-spec.md:31,37` and decision #16 |
| B2 git warning | Resolved | `:88`, `:70`, `:110` (C2 tests hidden and visible), `:133`; matches `design-spec.md:17` and #17 |
| S1 title opt-in | Resolved | `:65`, `:131`, `:140`; `decisions.md` #18 exists |
| S2 producer coverage | Resolved | Producers named at `:56` and `:117`, all verified above; census at `:59`; MCP handler and spec in B3c. The question event is still outside the normalised set (see N2). |
| S3 coordinator DI | Resolved | `:56`, B3a (`register.ts:199`, `tokens.ts:25` verified); VS Code `phase-2-libraries.ts:179` and CLI `container.ts:678` verified as the `registerSdkServices` sites. Electron attach location is ambiguous (see N3). |
| S4 renderer consumer | Resolved | `:57`, A7 owns handler, spec and `app.config.ts` (`MESSAGE_HANDLERS` block at `app.config.ts:238-263` verified) |
| S5 ledger deletion order | Resolved | Today every ledger importer is a file in A3 (`notification-center.store.ts`, its spec), A4 (`notification-announcer.component.ts`), A5 (`app-shell.component.ts` and three specs), or A5b (`notification-center/src/index.ts`); no canvas or other importer (grep) |
| S6 Electron Notification | Partly | Factory on `ElectronPlatformOptions` (`registration.ts:49-61` verified) and `bootstrap.ts` in B4a. The adapter has no specified way to read window focus or to restore the window (see N4). |
| S7 VS Code visibility | Resolved | `IPtahViewVisibility` (`:64`), B1/B3b/B5a/B5b; `webview-manager.ts:126-137,155-172,272-275` verified |
| M1 voice guard | Resolved | `:41`, `:44`, A2 |
| M2 action dispatch | Resolved | `:43` `ATTENTION_ACTION_DISPATCHER`, with failure and stale-generation behaviour |
| M3 responder | Resolved | `:41`, `:118`; `agent-permission-responder.ts:18,20-47` matches |
| M4 back office | Resolved | `:72`, C3, public API kept |
| M5 RPC placement | Resolved | `:55`, `rpc.types.ts:11-17` re-export pattern, `handlers/index.ts:56`, `src/index.ts:43` verified |
| M6 guard specs with change | Resolved for RPC and DI | B2a and B2b are one commit; each DI row changes `expected-resolvable.ts`. The same class of problem recurs for settings (see N1). |
| M7 contract suite | Resolved | B1 creates `run-host-attention-contract.ts`; B4a, B5a and B6a run it |
| M8 `agent-rpc.handlers.ts` | Resolved | Dropped (`:98`) |
| m1-m3, m5, m6 | Resolved | `:73`, `:48`, `:64`, `:113`, `:140` |
| m4 bell focus | Resolved in plan | `:134`; the `decisions.md` entry is still pending with the orchestrator, as the plan says |

Structural checks:

- Rows are file-disjoint (checked mechanically: no duplicate across 24 rows). The largest rows have 8 files: A2, A5, A6, B1, B2a and C1.
- No row edits `orchestra-canvas.component.ts` or any `libs/frontend/canvas` file.
- `:113` names the A2-A5 PR as the one that must merge before TASK_2026_702 removes the chip.

### New findings

#### Blocking

None.

#### Serious

**N1. B1 cannot pass its own `shared` test because the settings guard specs sit in B7.**

- B1 adds two descriptors to `libs/shared/src/lib/types/advanced-settings.types.ts`.
- `libs/shared/src/lib/types/advanced-settings.types.spec.ts:36-38` asserts `toHaveLength(29)`. That spec belongs to B7 (`:108`), which runs much later.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts:23,186` also enumerates keys and defaults, and B7 owns it too.
- So B1's acceptance check ("platform-core/shared typecheck/test/lint") fails. This is the same class of problem as round-0 M6 and S5.

Required change: move both spec files into the row that changes the settings. B1 is at 8 files, so split it:

- **B1a ports:** the three interface files, `run-host-attention-contract.ts`, `di/tokens.ts`, `platform-core/src/index.ts`.
- **B1b settings:** `advanced-settings.types.ts`, `advanced-settings.types.spec.ts`, `file-settings-keys.ts`, `file-settings-keys.spec.ts`.

B7 keeps only the three `surface-composition.spec.ts` files. State what B7 asserts about them: today they test lazy push and RPC round-trips, not attention. Or drop B7 if nothing there guards this change.

#### Moderate

**N2. The question event is outside the ingress normalisation and the census.**

- `:56` says the ingress "normalizes `PERMISSION_REQUEST` and `AGENT_MONITOR_PERMISSION_REQUEST`", and `:59` censuses only those two types.
- But VS Code shows `showInformationMessage` for questions (`:64`), and the producer `ask-user-question.service.ts:85-88` sends `MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST` through the same transport.
- As written, a lane can leave questions out of the coordinator and still pass the census. AC1, AC13 and AC14 would then fail for questions while the app is in the background.

Required change: add `ASK_USER_QUESTION_REQUEST` to the normalised set at `:56` and to the census types at `:59` and `:100`.

**N3. Electron attach site.**

- `:56` says Electron resolves and attaches the coordinator "after `phase-2-libraries.ts:218`", and B4b owns `phase-2-libraries.ts`.
- But the Electron transport is built only at `bootstrap.ts:412`. That runs after `ElectronDIContainer.setup(...)` at `bootstrap.ts:272`, which runs the phases.
- At phase-2 time there is no adapter to attach to. The coordinator is already registered by `registerSdkServices` at `:218` (B3a).

Required change:

- State that the attach and the shutdown detach happen in `bootstrap.ts` right after the `WEBVIEW_MANAGER` registration (`:413-416`). That file is in B4a.
- State what, if anything, B4b changes in `phase-2-libraries.ts`, or drop the file from B4b.

**N4. The Electron adapter cannot see window focus or restore the window through the cited options.**

- `ElectronPlatformOptions.getWindow` returns `ElectronBrowserWindowApi`, which exposes only `webContents.send` (`electron-user-interaction.ts:54-58`, `bootstrap.ts:253-262`).
- `:63` requires two things the platform lib cannot do through that type: "issues only while the relevant Ptah BrowserWindow is unfocused", and "click restores/shows/focuses the window".

Required change: name the extra injected capability. Examples are `isWindowFocused()` and `revealWindow()` on the options, or on the notification factory's context, built in `bootstrap.ts`. Keep it optional, as with `createNotification`. Cover it in the B4a adapter spec.

#### Minor

- **n1.** `WebviewManager.broadcastMessage` calls `this.sendMessage` for each panel (`webview-manager.ts:302-303`). If the observer sits at the top of `sendMessage`, a broadcast to N panels observes the event N+1 times. The test "one observation per broadcast" (`:59`) will catch this. Say in B3b that the per-panel fan-out goes through an unobserved private send path.
- **n2.** `CliWebviewManagerAdapter.dispatch` unwraps `MESSAGE_TYPES.BATCH` (`cli-webview-manager-adapter.ts:71-82`). Observing before dispatch sees only the outer type. Permission and question events are not batched today, but the census should assert that, or the observer should see unwrapped members.
- **n3.** B3c edits `agent-events.ts` but not its existing `agent-events.spec.ts`. Add the spec; the row has 7 files, so it stays within 8.
- **n4.** `ptah-view-visibility.ts` in `platform-vscode` will read vscode-core's `WebviewManager`. `platform-vscode` imports no vscode-core code today. The tags allow the dependency (`scope:extension,type:feature` -> `type:util`). Platform registration runs in phase 0, before vscode-core registers `WEBVIEW_MANAGER`, so resolve the manager lazily through `TOKENS.WEBVIEW_MANAGER` and do not construct it eagerly. State the new dependency in B5a. Also add "B3b precedes B5a" to the ordering at `:113`, because B5a subscribes to the event that B3b adds.
- **n5.** On Electron, `EXPECTED_RESOLVABLE` holds handler classes only (`apps/ptah-electron/src/di/expected-resolvable.ts:13-23`), and `container.smoke.spec.ts:260-264` reads `.name`. Optional tokens are pinned as separate exported constants (`:25-64`). Pin the coordinator symbol the same way; do not put the token in the array.
- **n6.** di-lint (`.husky/pre-push`, `tools/di-lint/check-injects.ts`) fails if an `@inject` token has no registration anywhere. B3a injects `PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS`, which is first bound in B4a, B5a and B6a. Do not push between B3a and the first adapter row, or have B3a use `isOptional`.

### User decisions needed

None new. The privacy confirmation for the session-title opt-in is already recorded as user-reserved (decision #18, plan `:140`). The build proceeds under option (a). The revision introduces no capability removal beyond those already approved.

## Round 2 re-review

Verdict: APPROVED

Reviewed the revised `implementation-plan.md` (137 lines) against `implementation-plan-revision-2.md`, the round 1 findings above, and `decisions.md` #1-#21. This was a read-only check. Decision #21 is treated as binding. New file:line citations were spot-checked in the worktree. No Blocking or Serious finding remains. One Moderate and two Minor items carry forward to implementation.

### Findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| N1 settings guard specs | Resolved | B1b (`:97`) owns `advanced-settings.types.ts` and `file-settings-keys.ts` together with both specs, and runs shared plus platform-core checks itself. `advanced-settings.types.spec.ts:36-38` (`toHaveLength(29)`) is the only count assertion on the table; the other `ADVANCED_SETTINGS` specs (chat `advanced-settings-group.component.spec.ts:24-28`, memory-curator ranges, rpc-handlers settings) derive from the table and do not pin a count. `command-work-list.component.spec.ts:38` is an unrelated `29`. B7 was dropped with a reason (`:113`, revision-2 Decisions). |
| N2 question ingress | Resolved | `ASK_USER_QUESTION_REQUEST` is in the normalised set (`:56`), the census (`:59`) and the B3b check (`:101`). The producer `ask-user-question.service.ts:85-89` was verified. |
| N3 Electron attach site | Resolved, with residual R2-2 | Attach is in `bootstrap.ts` after `:412-416` (verified: `TOKENS.WEBVIEW_MANAGER` registered with `ElectronWebviewManagerAdapter`). Phase 2 is left untouched (`:113`; `phase-2-libraries.ts:218` verified as `registerSdkServices`). B4b no longer owns phase 2 (`:104`). |
| N4 Electron focus/reveal | Resolved | `isWindowFocused` and `revealWindow` are optional options built in bootstrap (`:63`). `ElectronPlatformOptions` at `registration.ts:49-61` and `ElectronBrowserWindowApi` at `electron-user-interaction.ts:54-58` were verified. B4a tests focus, minimized restore, show/focus and the missing-capability fallback (`:103`). |
| n1 broadcast double count | Resolved | B3b (`:101`). `webview-manager.ts:302-303` was re-verified: panels go through `this.sendMessage`. |
| n2 CLI BATCH | Resolved | The census asserts that current producers do not batch (`:59`, `:101`). `cli-webview-manager-adapter.ts:71-82` was verified. |
| n3 agent-events spec | Resolved | B3c has 8 files (`:102`); the spec exists. |
| n4 platform-vscode dependency/order | Resolved | B5a (`:105`) uses lazy `TOKENS.WEBVIEW_MANAGER`. "B3b precedes B5a" (`:113`). There is no reverse import from vscode-core to platform-vscode (grep), so there is no cycle. |
| n5 Electron pin | Resolved | B4b (`:104`) |
| n6 di-lint | Resolved | B3a and B4a are pushed together (`:113`). `.husky/pre-push` runs `di-lint:lint` on every push (verified). |
| #21 coherence | Resolved in the plan, with residual R2-1 | `:7`, `:55`, `:65`, `:100`, `:120` and `:131` agree: the title is always included, truncated, with a generic fallback and no setting key. The B3a test asserts title inclusion together with the exclusion of question/body, prompt, arguments, raw error, secrets and paths. No "no title" rule is left in the plan. |

Structural checks: the 24 rows have 2-8 files each, and no file is in more than one row (checked by script). Each row can pass its own scoped tests. B2a and B2b are one commit. B3b precedes B5a. The new producer citations were verified: `sdk-permission-handler.ts:340-344,975`, `agent-events.ts:303-306`, `approval-prompt.handler.ts:71-75`. So were the transport sites: VS Code `webview-manager.ts:192-218,297-307`, Electron `webview-manager-adapter.ts:47-61,88-90`, and CLI `cli-webview-manager-adapter.ts:25-40`.

### New findings

#### Blocking

None.

#### Serious

None.

#### Moderate

- **R2-1. AC26 and the task-description still require titles to be excluded.** Three places in `task-description.md` contradict #21:
  - `:101` excludes session titles and describes an off-by-default title opt-in.
  - `:109` (AC26) requires a title canary to be absent from the default notice.
  - `:131` records a "separate title opt-in off" decision.

  The plan cites AC26 as a target of B1a, B3a and B5a (`:96`, `:100`, `:105`). It does not say that AC26's title clause is superseded, as it does for AC7 (#16) and AC10 (#17) at `:7`. A tester or reviewer who checks AC26 as written would assert the opposite of the B3a title test.

  Carry-forward: before B3a, add one sentence to the plan at `:7` and record it in `decisions.md`: "AC26's title canary and `task-description.md:101,131` are superseded by #21. Every other AC26 canary stays." Testers must read AC26 as amended by #21.

#### Minor

- **R2-2. Electron detach site.** `:56` and `:103` say that bootstrap "detaches it at shutdown". `bootstrap.ts` has no shutdown or dispose hook (grep). Electron teardown lives in `apps/ptah-electron/src/main.ts:238` (`before-quit`) and `:398` (`will-quit`), and that file is in no row. Choose one:
  - add `main.ts` to B4a, which makes it 8 files;
  - hook the observer's disposable into an existing teardown that bootstrap already owns;
  - state that the detach is not needed at process exit.

  The B4a test "shutdown detach" must match whichever is chosen.
- **R2-3. Ordering omits the dependencies on B3a's token.**
  - B4a (bootstrap), B5b (VS Code `phase-2-libraries.ts`) and B6b (CLI `container.ts`) all resolve `SDK_TOKENS.HOST_ATTENTION_COORDINATOR`, which B3a adds.
  - B3a implements the B1a ingress port.
  - `:113` says only "B1a precedes B1b and adapters; B3a precedes B3b/B3c and B2a/B2b". The B3a/B4a push pairing implies the rest.

  Carry-forward: the team-leader orders B1a -> B3a -> {B4a, B5b, B6b}.

### User decisions needed

None. #21 settled the title question, so the round 0 and round 1 entries for the title opt-in are closed. No new capability removal was found.
