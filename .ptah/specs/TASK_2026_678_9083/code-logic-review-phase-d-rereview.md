# Code logic re-review — Phase D fix `dc2751082`

| | |
| --- | --- |
| Score | 5/10 |
| Assessment | Needs another pass. The consumed-queue bug, the one-hop owner walk, and the `agentId === laneId` join are fixed and covered by specs. Two new gaps in this commit drop a live tool permission and speak the wrong turn. |
| Blocking | 0 |
| Serious | 2 |
| Moderate | 0 |
| Minor | 0 |
| Failure modes | 2 (approval card overwritten by a roster write; typed arm takes an in-flight voice boundary) |
| Reviewer family | grok |
| Implementer family | codex |
| Range | `dc2751082^..dc2751082` |

Evidence against 7–8: a roster write replaces the approval card for the life of that permission object, and a typed send while a voice turn is in flight speaks the voice reply and drops the typed reply. Evidence against 3–4: B1, S1, S2, and M1 match the required behaviour on the paths the new specs drive, and Decline rejects the Tribunal waiter without setting `exited`.

No nx, Jest, or tsc in this lane. The orchestrator reported command-center 189/189, chat-state 598/598, typecheck, and lint. Those runs do not add a roster proposal beside a live permission, or a typed send beside an armed voice token.

## Five logic questions

1. **Silent failure.** A tool permission is drawn, then a roster effect writes `pendingInput`. Decline clears the proposal and leaves the question card. The permission effect does not run again, so Approve never returns. The tool stays blocked with no error.
2. **Surprising user action.** Voice is listening and a spoken turn is in flight. The user types a command. `armTypedTurn` replaces the voice token. The voice reply is spoken as the typed turn, and the typed reply arrives after the token is cleared.
3. **Wrong-answer input.** Two lanes that share a CLI and have no role are claimed newest-`startedAt` first. That assignment is stable for one run. It is the schema decision in the lane P report, and this commit’s council fixture uses one agent per CLI.
4. **Dependency failure.** `discoveryComplete` still resolves from the marked tab’s snapshot when `seq` is already higher, and `pageExit` / `cancelDiscovery` reject the waiter. `agent:getConfig` and `tasks:create` still toast and return the same way as before this commit.
5. **Missing requirement.** The new approval writer and the existing roster writer share one `pendingInput` slot. Nothing in the task text says which one wins, and the fix does not restore the loser.

## Prior findings

| Id | Status | Evidence |
| --- | --- | --- |
| B1 | CLOSED | The ledger still clears only `terminalTurnPulses` (`tab-manager.service.ts:1805-1808`). The latest pulse stays in `lastTerminalPulseByTab` (`:1799-1801`) and is removed in `emitTabClosed` (`:341-344`), which `closeTab`, `forceCloseTab`, and `resetTabToFresh` all call. The page reads that map for the compact reply (`command-center-page.controller.ts:39-46`), the voice baseline (`:102-105`), and the spoken boundary (`:215-227`). The Tribunal waiter reads the same map (`command-center-tribunal.transport.ts:38-41`), records the marked tab’s seq in `answer` (`:84`), resolves immediately when that seq is already newer (`:121-123`), and rejects on `pageExit` / `cancelDiscovery` (`:131-140`). Decline calls `cancelDiscovery` and does not set `exited` (`command-center-page.controller.ts:337-342`); `pageExit` on the coordinator cancels an `answered` entry so `confirmEntry` takes the cancel path (`tribunal-run-coordinator.ts:115-123`, `:168-173`). Specs: `tab-manager.last-terminal-pulse.spec.ts:65-70`, `command-center-page.controller.spec.ts:176-204`, `command-center-tribunal.transport.spec.ts:130-156`. |
| S1 | CLOSED | `input()` grows `ownedTabs` / `owned` until a pass adds nothing (`command-center-projection.source.ts:66-91`). A session is added only when its parent id is already owned, so a disconnected cycle and an unrelated parent stay out. Live children keep the parent session id (`:97-101`). Spec `command-center-projection.source.spec.ts:154-247` covers R → C → G, G’s agent, the unrelated branch, and `cycle-a` / `cycle-b`. |
| S2 | CLOSED | Each manifest lane claims one unclaimed agent in that `workflowRunId` whose `cli` or `ptahCliId` matches the lane family, and whose `role` matches when the lane has one (`command-center-projection.source.ts:155-176`). A run with no agents is `starting`; any `running` agent wins; otherwise `failed` / `timeout` is `failed`; otherwise every `completed` or `stopped` agent is `completed` (`:192-209`). `AgentStatus` is only those five values (`agent-process.types.ts:43-44`), so the final `starting` branch does not flap on a legal status. A bound CLI agent is not also drawn as `cli:<id>` (`work-projection.ts:208-211`). Spec `command-center-projection.source.spec.ts:249-338` uses uuid agent ids, running, completed, and failed. |
| S3 | PARTIAL | The marked-tab path is in place: `permissionRequest` ignores a different `tabId` (`command-center-page.controller.ts:67-78`), the effect publishes kind `approval` and a short prompt (`:183-196`), and `answerPermission` sends `allow` / `deny` once (`:286-299`). Speech hits the approval guard (`command-voice-loop.ts:371-377`). The card disables a second click (`command-pending-input.component.ts:208-216`). Specs: `command-center-page.controller.spec.ts:262-333`. The same controller’s roster effect writes that slot afterwards and the approval card does not come back. Detail is N1. |
| M1 | CLOSED | `armTypedTurn` returns while voice is inactive and otherwise arms one token (`command-voice-loop.ts:414-419`). `sendCommand` calls it only after a successful text send (`command-center-page.controller.ts:309-311`, `:327`). Specs: `command-center-page.controller.spec.ts:207-260`, `command-voice-loop.spec.ts:24-39`. An overlap with an already armed voice token is N2. |

## New findings

### Serious

**N1. A roster write replaces the approval card, and answering the roster does not bring the permission back.**

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:172-177`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:183-201`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:337-344`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:32-84`

Scenario. The marked tab has a `Write` permission. The permission effect sets `pendingInput` to that request and speaks the card prompt. A Tribunal roster then arrives. The roster effect, registered first, runs because its question signal changed, and sets `pendingInput` to the roster question. The permission computed did not change, so the permission effect does not run again. The card’s `@if (proposal())` branch renders Confirm / Decline and hides Approve / Deny. The user declines. `declineProposal` clears `pendingProposal` and does not restore the permission. `pendingInput` stays the roster question. `ordinaryQuestion` skips roster text (`command-center-page.controller.ts:61-63`), so `answerOrdinaryQuestion` will not accept that id. The permission is still in `permissionRequests` and the tool stays blocked.

Fix. Keep one writer for `pendingInput`. While `permissionRequest()` is non-null, leave kind `approval` in place. When a roster closes and that permission is still current, set the approval card again. Speak the permission prompt only when the request id changes.

**N2. A typed send while a voice turn is waiting speaks the voice reply and drops the typed reply.**

- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:393-396`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:414-419`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:99-107`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:211-227`

Scenario. Voice is active. A spoken command has been sent: the loop’s token is 1 and `onVoiceSend` stores token 1 with `minPulseSeq` equal to the tab’s current pulse, for example 4. Before pulse 5 arrives, the user types a command and `sendCommand` succeeds. `armTypedTurn` sets the loop token to 2 and calls `onVoiceSend` again. The snapshot seq is still 4, so the baseline does not move. Pulse 5 is the voice reply. The page effect sees token 2 and `seq > 4`, calls `onTurnBoundary` with token 2, and clears the controller token (`:225-227`). The loop accepts token 2 and speaks the voice reply. Pulse 6, the typed reply, arrives with `voiceTurnToken` already null, so the effect returns at `:214` and that reply is never spoken.

Fix. If `awaitingBoundary` is already true, leave the current token in place and arm the typed turn only after `onTurnBoundary` finishes that token. Keep a separate baseline per armed turn so a pulse from the earlier send cannot satisfy the later token.

## Checked and not filed

- The pulse map is deleted for `close`, `forceClose`, and `reset` through `emitTabClosed` (`tab-manager.service.ts:341-344`, `:1330`, `:1439`, `:1522`). `resetTabToFresh` keeps the tab and drops the old conversation’s pulse, which matches a fresh session. The map does not keep a closed tab.
- Same-tab Tribunal baseline: `answer` stores that tab’s latest seq, and `discoveryComplete` requires a strictly newer snapshot seq (`command-center-tribunal.transport.ts:84`, `:121-123`). The only stored pulse for the tab is the latest one, so an earlier turn on that tab cannot resolve the waiter. `send` writes the same marked tab id again (`session-coordinator.ts:237-240`).
- Classifications written into the snapshot are `success` or `error` (`tab-manager.service.ts:1780-1783`). The waiter treats either as the end of the discovery turn.
- Descendant `parentSessionId` falls back to a parent tab id only when that tab has no session id (`command-center-projection.source.ts:97-101`). `projectOwnedWork` already keys a child with no session id by tab id (`work-projection.ts:79-86`).
- Two lanes of one CLI and no role claim the newest `startedAt` agent first (`command-center-projection.source.ts:157-166`, `agent-monitor.store.ts:2680-2690`). Order does not change when status changes. Lane P kept the manifest schema and matches family plus optional role. This commit’s binding spec uses `codex#1` and `cursor#1`.
- Approve / Deny emit once per request id (`command-pending-input.component.ts:208-216`). A spoken "yes" while kind is `approval` does not call `handlePermissionResponse` (`command-voice-loop.ts:371-377`).
- `armTypedTurn` does not arm while `active` is false (`command-voice-loop.ts:415`). Voice transcripts call `sendCommand(transcript, 'voice')` (`command-center-page.controller.ts:111`), so the voice path does not also call `armTypedTurn`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count the roster/permission clash as S3 PARTIAL plus N1, one Serious | (a) S3 CLOSED and a separate Serious; (b) S3 PARTIAL, with N1 as the write-up, counted once | The isolated permission spec passes (`command-center-page.controller.spec.ts:262-309`). The roster effect still assigns `pendingInput` (`command-center-page.controller.ts:172-177`) after the permission effect (`:183-196`). | yes |
| Leave same-CLI FIFO binding unfiled | (a) new Moderate; (b) accept lane P’s family-plus-role rule for this commit | `command-center-projection.source.ts:157-166`. Spec lanes are different CLIs (`command-center-projection.source.spec.ts:291`). `AgentStatus` cannot flap the run state (`agent-process.types.ts:43-44`). | yes |

Verdict: NEEDS_REVISION
