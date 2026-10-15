# Code logic review — Phase D (batches 11–16)

| | |
| --- | --- |
| Score | 4/10 |
| Assessment | Needs another pass. Voice replies, status narration, the compact latest reply, and Tribunal launch-after-confirm all wait on `terminalTurnPulses`, and the app shell clears that signal first. |
| Blocking | 1 |
| Serious | 3 |
| Moderate | 1 |
| Minor | 0 |
| Failure modes | 4 (pulse loss, unanswered tool permission, unbound lane status, grandchild sessions dropped) |
| Reviewer family | grok |
| Implementer family | codex |
| Range | `4b7455a36^..HEAD` (voice loop only `57f5d0940..HEAD`) |

Evidence against 5–6: one Blocking defect stops the paid launch and the spoken reply on every Electron session, because `AppShellComponent` constructs `NotificationLedgerService` before the page exists. Evidence against 1–2: Decline-first parsing, the discovery answer that is not the word Confirm, the voice turn token, barge-in queue clearing, the Electron route guard, the send-lock banner, rewind persona, and the overlay hover/pin timers are implemented and were read in full.

No nx, Jest, or tsc in this lane. The orchestrator reported the scoped checks passing. Those checks do not construct the shell ledger beside the page, so they are not evidence for B1.

## Five logic questions

1. **Silent failure.** A successful assistant turn appends a terminal pulse. The shell ledger takes and empties the signal. The page effect then sees an empty list and returns. The user gets no spoken reply, no status line, and no updated compact reply. Confirm has already sent the discovery answer, then waits forever on a pulse that will not stay in the signal. The card stays up and Decline no longer applies.
2. **Surprising user action.** Typing a command in the rail while voice is listening never arms `voiceTurnToken`, so that turn's reply and any queued status are not spoken. Clicking Approve on a tool card cannot happen, because the page never puts a permission into `pendingInput`. A spoken "yes" during a tool permission becomes another chat turn.
3. **Wrong-answer input.** A grandchild session whose parent is a child session is omitted. A Tribunal lane whose monitor `agentId` is not the manifest `laneId` stays `queued` while the real agent is a second node. A finished run with no agent still `running` is stored as `unknown`.
4. **Dependency failure.** `discoveryComplete` never times out and never rejects. If the pulse is taken, or no later pulse arrives, `confirm()` stays pending, the 120s roster timer was already cleared, and `resolveDecline` ignores an `answered` entry. `agent:getConfig` failure empties availability and is toasted. `tasks:create` failure is retryable. An invalid roster parse is answered Decline inside `receive`.
5. **Missing requirement.** AC22's tool-permission card is not fed from `ChatStore.permissionRequests`, and the card's response output is wired only to `answerOrdinaryQuestion`. Plan ownership is recursive descendants; the source keeps one parent hop.

## Findings

### Blocking

**B1. Terminal pulses are cleared before the page or the Tribunal waiter reads them.**

- `libs/frontend/notification-center/src/lib/notification-ledger.service.ts:167-173`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:198` (ledger is constructed with the shell)
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:39-49` and `:188-205`
- `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts:32-49`, `:85-88`, `:119-123`
- `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:152-169` and `:280-284`

Scenario. The shell effect is registered first. A completed Command Center turn pushes a pulse. The ledger effect runs, `takeTerminalTurnPulses()` sets the signal to `[]`, then the page effect and the transport effect read the empty list. `onTurnBoundary` is never called, so the assistant reply is not spoken and `StatusNarrator.drain` never runs (AC6, AC12). `latestReply` stays on the previous pulse or null, so the compact reply (AC17) does not update. On Confirm, `answer()` records `boundarySeq` as the current max and `discoveryComplete()` stores a resolver. The completion pulse is taken before that effect sees `seq > boundarySeq`. The resolver stays set. `confirmEntry` is already in state `answered`, so Decline and the timeout return without answering. Navigation calls `pageExit`, which marks the entry cancelled, but nothing resolves `boundaryResolve`, so the confirm promise remains pending. A later unrelated pulse on a still-mounted transport can release that confirm after the user has left the card.

Fix. Do not observe the destructive signal. Give Command Center its own listener or a non-consuming snapshot that the ledger does not clear, and arm `discoveryComplete` against that same source. If the awaited pulse is gone or the waiter is destroyed, reject the promise so `confirmEntry` hits the existing cancel path. Keep Decline available until the launch turn has been sent.

### Serious

**S1. Projection input is one parent hop, not the root's descendants.**

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:60-80`
- Plan: `implementation-plan.md:18` (recursive descendants only). AC11.

Scenario. Root session R has child session C, and C has child session G. G's tab has `parentTabId` of C's tab, and G's `organization.parentSessionId` is C. Both filters compare only to the root, so G is absent from `children` and `persistedChildren`. `projectOwnedWork` can walk a chain, but the chain is never passed in. G and any agent whose `parentSessionId` is G are missing from the canvas, the text list, and status narration. An unrelated session is still excluded, which is correct.

Fix. Collect the descendant closure: walk `parentTabId` / `parentSessionId` until no new id appears, then pass that set to `projectOwnedWork`. Keep the unrelated-parent exclusion.

**S2. Lane status is joined on `agentId === laneId`, which the manifest does not store.**

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:123-163`
- Manifest shape: `libs/frontend/chat-state/src/lib/command-center-records.ts:18` (`laneId` and optional `role` only)
- State mapping that then stays `queued`: `libs/frontend/command-center/src/lib/model/work-projection.ts:149-160`

Scenario. A confirmed Council run persists lanes `{ laneId: 'codex' }`. The monitor reports the worker as `agentId: '<uuid>'`, `workflowRunId` equal to the run. The find on `agentId === lane.laneId` fails, so `VendorLane.agentId` is undefined and `bound` is null. The lane node stays `queued` for the life of the run. The same agent is also drawn as `cli:<uuid>` under the Tribunal node, so the canvas shows a queued lane and a separate running agent (AC15). `derivePhase` sees no bound status. The run node itself is `running` only while some agent status is exactly `running`; when every agent has completed, the run node becomes `unknown` (`command-center-projection.source.ts:160-163`), and the narrator ignores a Tribunal node that is not running, completed, or failed.

Fix. Persist the runtime agent id on the manifest lane, or match `workflowRunId` plus lane role/cli. Map a run with only terminal agents to `completed` or `failed` from those agents. Add a source spec where `agentId` differs from `laneId`.

**S3. Tool permission never becomes the on-page card, so voice does not enter the approval guard.**

- Page pending writers are only the roster and ordinary-question effects: `command-center-page.controller.ts:173-187`
- Approve/Deny on the card call `answerOrdinaryQuestion`: `command-center-page.component.ts:123-128` and `command-center-page.controller.ts:253-262`
- The card UI exists and is unused: `command-pending-input.component.ts:124-146`
- Voice refuses speech only when `pendingInput.kind === 'approval'`: `command-voice-loop.ts:371-377`
- Nothing in `libs/frontend/command-center` reads `ChatStore.permissionRequests` (`chat.store.ts:116`)

Scenario. A delegated tool raises a permission for the marked tab. `pendingInput` stays null. The Command Center page shows no prompt and no Approve/Deny (AC22). A spoken "yes" fails the question and approval checks and is sent as a new chat turn via `sendTranscript`. That does not call `handlePermissionResponse`, so speech does not grant the tool, but the tool stays blocked with no actionable card on this page. The hands-free loop keeps taking utterances. Regular chat may still show the permission, on another surface, while AC25 is holding that composer for sends.

Fix. Project the marked tab's permission request into `pendingInput` of kind `approval`, speak the short summary, and handle the card's Approve/Deny with `handlePermissionResponse` from a click or key only. Do not route that response through `answerOrdinaryQuestion`.

### Moderate

**M1. A typed turn while voice is active never arms the turn token.**

- Token is set only from `onVoiceSend`: `command-center-page.controller.ts:90-96`
- The boundary effect returns while the token is null: `:188-191`
- Rail submit calls `sendCommand` and does not set the token: `:264-282` and `command-center-page.component.ts:147`

Scenario. Voice is listening. The user types a delegation and the assistant turn completes. Even after B1 is fixed, `voiceTurnToken` is null, so `onTurnBoundary` is not called. The reply is not spoken and status lines observed during that turn stay in `StatusNarrator` until some later voice send settles. AC12's boundary for that turn is skipped.

Fix. When voice is active, arm the same token and `minPulseSeq` around a successful `sendCommand`, and ignore a boundary whose token is not the current one (the check in `command-voice-loop.ts:414-420` already does this).

## Checked and not filed

- N1 barge-in clears both `playbackMarks` and `synthesisIds` (`command-voice-loop.ts:276-279`). Stop, mute, and exit clear both as well.
- D36: `onVoiceSend` stores the token and `minPulseSeq` at the current max; `onTurnBoundary` ignores a mismatched token (`command-voice-loop.ts:393-396`, `:414-420`). This does not survive B1, because the pulse never arrives.
- Amendment A1 on the paths that do not depend on B1: `parseRosterProposal` requires Decline first and the page nonce (`tribunal-roster-proposal.ts:121-127`). `receive` answers Decline when parse fails (`tribunal-run-coordinator.ts:88-94`). The discovery answer string does not contain the word Confirm (`tribunal-run-coordinator.ts:14-15`). `CommandCenterTribunalTransport.answer` rewrites an answer that contains that word to Decline (`command-center-tribunal.transport.ts:90-94`). Confirm is only emitted from the card click/Enter/Space (`command-pending-input.component.ts:64-66`, `:177-200`). A second `confirm()` returns the in-flight promise (`tribunal-run-coordinator.ts:127-129`).
- A Tribunal move with no root session id toasts and does not send (`command-center-page.controller.ts:270-276`). Accepted known case.
- Page destroy calls `exit()`, which stops the roster timer, `pageExit`, and `voice.exit` (`command-center-page.component.ts:166-169`, controller `:308-313`).
- Overlay: one card, 150ms open and 200ms close, hover union of canvas id and label id, no close while pinned or while the bridge/card is hovered, Escape unpin, timers cleared on destroy (`command-overlay.component.ts:163-181`, `:225-343`). Positioner schedules at most one frame and disconnects its observer on stop (`command-overlay-positioner.ts:21-43`).
- `command-center` is on `ViewType` and `SURFACE_ROUTE_IDS` (`webview-surface.types.ts:57`, `:79`) and the route uses `canMatch: [electronOnlySurface]` (`app.routes.ts:192-193`). The nav control lives on the Electron shell (`electron-shell.component.ts:147-155`).
- Send lock: banner, placeholder, Enter, and `handleSend` all refuse while `isHeld` (`chat-input.component.ts:153-159`, `:419`, `:630-634`, `:1496`, `:1508`). Queued content is not cleared in this diff.
- Rewind passes `commandCenterPersonaFor` on both the dry run and the commit (`chat-view.component.ts:1686-1694`, `:1770-1775`). `rewindFiles` forwards `systemPrompt` only when it is defined (`claude-rpc.service.ts:356-366`). Non-marked tabs get `undefined`.
- Persona tells the model to copy the page nonce from `<COMMAND_CENTER_TRIBUNAL_REQUEST>` (`command-center-persona.ts:7`). `sendCommand` puts `crypto.randomUUID()` and the root session id in that block (`command-center-page.controller.ts:278-281`).
- Narrow import is `@ptah-extension/tribunal-panel/discovery` (`command-center-tribunal.transport.ts:8`).
- Zoom and pan are absent. No B0 numbers were expected.
- `chat-view.rewind-persona.spec.ts` is source-level, as accepted.
- Renderer, layout, and sprite cache were read for a stuck frame, a leaked animation frame, and a sprite drawn for an unowned id. `dispose` cancels the frame (`command-scene-renderer.ts` constructor and `setSnapshot`). No separate logic defect beyond the projection inputs above.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the ledger `takeTerminalTurnPulses()` interaction as a defect in this phase, not as an accepted shared-signal contract | (a) file B1; (b) assume effects see a snapshot from before the take | Ledger effect is created with the shell (`app-shell.component.ts:198`, `notification-ledger.service.ts:167-173`). Page and transport effects are created later and read the live signal (`command-center-page.controller.ts:192-201`, transport `:35-48`). `takeTerminalTurnPulses` assigns `[]` (`tab-manager.service.ts:1792-1794`). | yes |
