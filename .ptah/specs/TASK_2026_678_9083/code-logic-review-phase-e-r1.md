# Code Logic Review - TASK_2026_678_9083 - Phase E revise round 1

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7.5/10 |
| Assessment | APPROVED (one Moderate follow-up recommended before release) |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 (F-1, F-2) |
| Minor issues | 8 |
| Range | `git diff e404f9495 8d15080be -- libs/` (27 files) |

Scope read in full: `command-center-page.controller.ts`, `command-center-turn-status.ts`, `command-voice-loop.ts` (`start`, `mute`,
`stop`, `exit`, `release`, `onClip`), `session-coordinator.ts`, `command-center.store.ts` (`setSession`, `setProvider`),
`voice-provider-summary.ts`, `work-projection.ts`, `command-center-projection.source.ts`, `command-scene.component.ts` (layout effect,
`setOverlayLabels`, `ResizeObserver`), `scene-layout.ts` label placement, `command-voice-hud.component.ts` flags, the chip template and
computeds in `command-center-page.component.ts`, and the five lane reports. Cross-checked N5 against `stream-viewport-controller.service.ts`,
`stream-flush-scheduler.service.ts`, `chat-stream-delivery-coordinator.service.ts`, `tab-manager.service.ts` (`registerVisibleTab`,
`applyTurnState`), `turn-state-applier.service.ts`, `batched-update.service.ts`, `notification-ledger.service.ts`,
`voice-config.component.ts:234-273,390-394`. One Jest call, on `command-center-page.controller.spec.ts` and
`command-scene.component.spec.ts`: 2 suites, 51 tests, all pass. No runtime/Electron run, so rendered layout and the live host
reveal are not proven by me.

## Review family

Reviewer: Anthropic (in-process, Claude). Implementer: codex CLI lanes (layout, state, turn, scene, chip) plus small Anthropic
orchestrator edits (`command-center-turn-status.ts`, `voice-provider-summary.ts`, harness mocks). Reviewer family differs from the
implementer lanes; the orchestrator edits are from my own family, so I read them with the same suspicion as the lane code.

## Status of each prior finding

| Finding | Status | Evidence |
| --- | --- | --- |
| S-1 plate measure by text | CLOSED | `command-scene.component.ts:151-171` builds the map by `label.id` and `scene-layout.ts:365` calls `measure(point.node.id, label)`. No loop (see S-1 notes). |
| M-1 `turnAbortable` folded into Mute/Start | CLOSED | `command-voice-hud.component.ts:138-146` has separate `canMute`, `canStopTurn`, `canStart`; `command-voice-loop.ts:548` guards `mute()`; spec `controller.spec.ts:345`. |
| M-2 pulse settle | PARTIAL | Overlapping send, pulse-while-streaming and the true-to-false no-pulse fallback are fixed. Status is still only ever pushed down, never derived: see F-1. |
| M-3 root id | CLOSED | `work-projection.ts:90` and `controller.ts:214` both give `root:<tabId>`. No reader parses the suffix. |
| N5 tab never visible | CLOSED by static trace (runtime unproven) | Trace verified below. `command-center-turn-status.ts:13-25`. |
| M-d voice carries across Start new | CLOSED | `controller.ts:279-286`, `command-voice-loop.ts:583-609`. |

### S-1 (measure by node id)

- Measurement: `SceneLabel.id` comes from the overlay's `data-node-id`. A node without a measured plate falls back to the guess.
  A first frame for a new node uses the guess and then relayouts once the plate is observed, so there is a one-frame jump (Minor, F-9).
- ResizeObserver loop: not reachable. Plates are `absolute left-0 top-0` and are positioned only with `style.transform` and `display`
  (`command-scene-renderer.ts:286-296`, overlay `:40`). A transform never changes `offsetWidth/Height`, so a relayout cannot resize a
  plate, and the stage canvas is `absolute inset-0` so setting `canvas.width/height` cannot resize the stage. Observer registration
  fires once per `observe()` with unchanged sizes, and `setOverlayLabels` returns early on equal ids, elements and sizes
  (`:248-258`). The callback only writes when a size really changed.
- Hidden plate: a `display:none` plate reports 0x0. `setOverlayLabels` keeps the last non-zero size (`:238-247`) and the layout falls
  back to the guess when the size has never been non-zero (`:165`). No NaN and no zero-size rect reaches `layoutScene`.
- Root plate: `scene-layout.ts:385-398` forces a clamped rect under the root when the whole 4-candidate list plus the 12 px grid fails,
  so the root plate is always placed. A degenerate viewport (height under about 108 px) skips the grid loop and uses the forced rect.

### N5 (verified trace)

1. `StreamViewportController.deriveViewport` adds the active tab only when `currentSurface() === 'chat'`, plus `visibleTabIds`
   (`stream-viewport-controller.service.ts:75-87`). On the Command Center surface the tab is therefore hidden unless registered. Correct.
2. Host: `route()` sends `CHAT_CHUNK` only if `visibleTabIds.has(tabId)`, else `retain()` (`chat-stream-delivery-coordinator.service.ts:176-190`).
   `turn_state` is a flat stream event (`live-message-projection.ts:54`, `stream-delta-coalescer.ts:89`), so it is retained in the same
   tail and is not sent. Matches the lane trace. (The report names `publishTerminal`, but that carries only `CHAT_COMPLETE/CHAT_ERROR`.)
3. Reveal: `updateViewport` reveals every tab in `nextVisible` that the host has not made visible, and `reveal()` sends one snapshot
   with the retained tail (and the deferred terminal) before adding the tab to its visible set (`:247-341`). So a turn that started
   before the page opened, or the first events of a turn sent within the 50 ms debounce, are delivered on registration, not lost.
4. Frontend: `currentViewport` flips immediately, so `tierFor` returns `visible` and `StreamFlushScheduler` runs the work within 50 ms
   (`stream-flush-scheduler.service.ts:31-37,80-90`).
5. `TurnStateApplier` finalizes (forced `flushSync`), then `applyTurnState` writes `status`, `lastTerminalReason`, then the pulse in
   one synchronous block (`tab-manager.service.ts:1760-1805`). The pulse guard needs `tab.status` still streaming; the optimistic
   `markTabStreaming` in `message-sender.service.ts:431,766` provides that.
6. The root `BatchedUpdateService` uses the app-level `SURFACE_ACTIVE` = chat (`app.config.ts:148`), so on this surface streaming-state
   publication is deferred. That does not affect status, pulse, `lastAssistantMessage` (payload field) or the graph: agent nodes come
   from `AgentMonitorStore`, written directly (`accumulator-core.service.ts:498`), and finalization force-flushes.

Cleanup when another surface registers the same tab: the helper registers only if the tab is not already in the set, and only the
registrant unregisters (`command-center-turn-status.ts:17-23`), so a canvas tile or conductor tile registered first is never dropped.
The set is not ref-counted: if the page registers first and another surface registers the same tab afterwards, the page's cleanup
removes it for both (F-2). Effect cleanup also fires on page destroy and on tab change (spec `controller.spec.ts:477`).

### M-2 scenarios

- Two overlapping sends, pulse 1 while the root still streams: effect 1 (`:39-47`) consumes the seq but skips the settle because
  `turnAbortable()` is true; status stays running; turn 2's terminal then settles. Pinned by spec `:391`.
- No pulse: effect 2 (`:48-64`) settles on the streaming-to-not-streaming edge, `error` when `lastTerminalReason` is set and not
  `completed`, else idle. `status` and `lastTerminalReason` are written in the same `updateTabInternal`, so the read is consistent.
- Ordering: with a real terminal event `status` and the pulse change in one synchronous block, so the first effect to run sees both
  and settles by classification; the second then finds the status no longer `running`. Either order gives the same result.
- User Stop: `coordinator.stop()` sets `stopped` first, so neither effect overwrites it.
- Gaps: F-1.

### M-d

- null to tab: `previousMarkedTabId` is null, so no exit (`controller.ts:281`). The effect never ends a loop the user started on the
  same tab, and `send()` re-calls `setSession` with the same id (no change event).
- Resume: `openOrResumeInternal` keeps the id for an existing tab. If a stale marked id is replaced by another during page open, voice
  is not yet active, so `exit()` is a no-op.
- Start new: `newCommandCenter` releases the lock and sets `idle`, then `setSession(newTab)` fires the effect; `release()` clears
  loop `muted`, `store.muted`, queued clip, marks and stops the capture. A start in flight (permission prompt) sees the bumped
  `generation` and stops its capture (`command-voice-loop.ts:261-263`). Spec `:460`.
- The old turn's armed pulse tokens are cleared twice (effect and `onTurnsAbandoned`); harmless.

### M-3 readers

Every consumer takes the id from `projection.nodes[0].id` or from node data: store selection (`setProjection` drops only ids that
vanish), pin effect, sprite cache (keyed by node id, now stable so no root sprite rebuild), `StatusNarrator.observe(root, nodes)`
(root id now stable, baseline kept), `nodeForSession` for children and Tribunal runs (`work-projection.ts:154-156`), and
`buildStatusContext`. `grep "root:"` finds only the two producers. Nothing persisted keys on the root id.

## Findings

### Blocking

None.

### Serious

None.

### Moderate

#### F-1. Session status is pushed down but never derived, so the badge still lies in three likely cases

- File: `session-coordinator.ts:~91-98,118-123` (resume sets `running`), `command-center-turn-status.ts:48-64` (settle edge only).
- Scenarios:
  1. Reopen the page on an existing idle session: `openOrResumeInternal` ends with `setSessionStatus('running')` unconditionally.
     `turnAbortable` is false and was never true, so the edge needed by effect 2 never occurs and effect 1 has no new pulse. The header
     shows "Session abc12345 · running" and the dock "running" with nothing running until the next turn ends. This is the default
     path whenever a previous Command Center session exists.
  2. A turn that streams again without a new send (backend wakes a background task, or a queued message starts a new generating phase
     after an `idle` was already applied): status stays `idle` or `error` while Stop is live.
  3. `awaiting-background` or `sleeping` are not `streaming`, so the root leaves `turnAbortable` and the fallback reports `idle` while
     background work is still pending.
- Impact: display only (no control is gated on `sessionStatus`; Stop uses `turnAbortable`), but it is the S7 symptom on the most
  common reopen path.
- Fix: derive the shown status: `turnAbortable() ? 'running' : sessionStatus() === 'running' ? 'idle' : sessionStatus()`, or have
  `openOrResumeInternal` set `idle` for a tab that is not streaming. Add a spec for a resumed idle tab.

#### F-2. Visible-tab registration is not ref-counted and has two sharp edges

- File: `command-center-turn-status.ts:13-25`, `tab-manager.service.ts:3091-3106`.
- Scenario A: the page registers tab T, a second surface registers T afterwards (no-op because it is already in the set), and the page
  unregisters on destroy or on Start new: the second surface loses visibility and the host starts retaining its stream. Low
  probability today (canvas tiles and the conductor tile do not normally show the marked tab) but the comment on the helper states the
  rule only for one ordering.
- Scenario B: Start new while the old turn is still streaming drops the old tab from the set, so the host retains its stream and its
  terminal `turn_state`; the old tab keeps `status: 'streaming'` in the frontend until it is revealed again (for example when selected
  in chat). Same behaviour as before this round (it was never visible), so not a regression.
- Fix: a counted register/unregister in `TabManagerService` (map of tabId to count), or document the single-owner rule at
  `registerVisibleTab`. Scenario B could also release the old tab only once its status is not `streaming`.

### Minor

- F-3 (carried, pre-existing): the tab-change effect (`controller.ts:279-286`) exits voice but leaves `pendingProposal`, `expectedRequest`
  and the roster timer from the old session; `shownInput` (`:171-179`) keeps the "Tribunal proposal" card until the 120 s roster timeout.
  Confirm is still a click on the card (AC22 holds) but would act on the old root. Clear them in that effect (call the same teardown
  as `exit()` minus voice exit). I did not trace `tribunal.confirm` past its root check.
- F-4: chip labels differ from Settings (`voice-provider-summary.ts:15-47` vs `voice-config.component.ts:237-264`). Provider label is
  `Local` where Settings shows the registry label `Local (Whisper / Kokoro)`. ElevenLabs TTS always shows `ElevenLabs voice`; Settings
  shows `No voice chosen` when `voiceId` is empty (key set, so the chip shows Ready), `Custom voice` or the voice name. The local STT
  model rule, local TTS voice id, ElevenLabs STT model, and the Ready/Not downloaded/No key status rules match exactly. Cheap fix:
  `No voice chosen` when `elevenlabs.voiceId` is empty, and the same display string for local.
- F-5: `CommandVoiceLoop.start()` recomputes readiness itself (`command-voice-loop.ts:207-216`) instead of calling
  `summarizeVoiceProviders`, and its failure paths call `setProvider({false,false})` (`:192,200`). `setProvider` keeps old labels and
  derives `Not downloaded`/`No key` from the booleans (`store.ts:245-273`), so an RPC failure reads as a missing key or download on the
  chip. Pass `summarizeVoiceProviders(null)` there.
- F-6: the chip says `Voice unavailable` both while the config is loading and after a failure, and `open()` awaits `openOrResume()`
  before it fetches the config (`controller.ts:411-413`); if `openOrResume` rejects the config is never fetched. Pre-existing ordering.
  The chip button sets `aria-label` to a sentence that does not contain its visible text (label-in-name).
- F-7: `void this.voice.exit()` in the effect (`controller.ts:283`) leaves a rejected `capture.stop()` unhandled.
- F-8: when the root plate's four nearby candidates are blocked, the grid search starts at the top-left of the stage
  (`scene-layout.ts:351-358`), so the plate can land far from the root sphere with no leader; the 12 px grid is up to about 10k
  candidates on a 1600x1000 stage inside a reactive effect (M-6 carried, not re-scored).
- F-9: first frame for a new node uses the guessed plate size and then jumps once measured. A plate hidden because nothing fit keeps
  its stale (possibly larger) size and stays hidden until the text changes.
- F-10: with N5, Command Center turns now produce completion ledger entries and a notification burst
  (`notification-ledger.service.ts:165-171`) in addition to the spoken reply. Consistent with chat tabs, but check that the burst
  does not play a sound over the voice reply.

## AC22 / Amendment A1 check

No regression. This round did not change `sendCommand`, `confirmProposal`, `answerOrdinaryQuestion`'s Confirm filter
(`controller.ts:458-473`), the nonce framing, or the transport. A Tribunal roster Confirm still comes only from the `confirm` output
of the pending card to `confirmProposal`; no text path emits it:
- Spoken or typed `confirm/yes/approve/go ahead` while a Tribunal request is outstanding is refused by `answerOrdinaryQuestion`
  (`:462-467`), and roster questions are excluded from `ordinaryQuestion` (`:117-134`).
- `release()` now resets the loop's `pendingRoster` (`command-voice-loop.ts:598`), but `onClip` also refuses transcripts while
  `store.pendingInput()?.kind === 'question'` (`:379-392`) and `answerOrdinaryQuestion` returns false for a roster card, so a spoken
  "confirm" after a Start new cannot reach the model as text.
- New pieces (chip click, `canMute/canStopTurn/canStart`, status effects, visibility registration, `exit()` on tab change) never write
  `expectedRequest`, `armedTurns` or `deliveredPulseSeq`. The status pulse effect lives in its own closure `statusPulseSeq`.
- N5 makes pulses actually arrive live for the first time; the Tribunal guard that consumes them is unchanged and covered by specs
  (`controller.spec.ts:1010,1034`). It was exercised with synthetic pulses only, so the first real-host run should confirm the guard
  does not clear `expectedRequest` before the roster question arrives.

## Five logic questions

1. Silent failure: F-1 (status badge reads `running` or `idle` against reality), F-5 (RPC failure shown as "No key"/"Not downloaded").
2. User action: Start new while a roster card is pending (F-3); Start new while the old turn streams (F-2 B); clicking the chip while voice is running navigates away from the page and destroys it.
3. Input: an ElevenLabs config with a key but no voice id renders Ready with "ElevenLabs voice" (F-4); an unknown provider string is treated as `local` (same as Settings).
4. Dependency failure: voice-config RPC failure leaves labels but flips status text (F-5); `capture.stop()` rejection (F-7); the viewport RPC failing leaves the frontend tier at `visible` while the host keeps retaining (existing design, `declare()` catch sets `v2Accepted=false`, which returns tier to `focused`, so recovered).
5. Missing: no integration spec joins the page registration with the real host reveal; no spec for resumed-idle status; no spec that the chip equals the Settings row for the same DTO.

## Residual uncertainty

- Rendered layout is unproven. In particular `.stage` is `flex: 1 1 auto` and the scene's inner stage is `h-full min-h-[320px]` under an
  inline custom element; if the percentage height does not resolve, the canvas is 320 px inside a taller stage. The visual reviewer
  should check 892x735 and 1440x900. This is not a logic defect I can prove from source.
- N5 is confirmed by reading both sides of the protocol, not by a live trace. The first Electron run should log that
  `lastTurnStateRevision` is now defined on the marked tab after a turn.

## Verdict

- Recommendation: APPROVE; fix F-1 before release (small, derived-status change) and F-3/F-4 in the same pass if cheap.
- Score: 7.5/10. The five targeted defects are closed or substantively closed, no regression to AC22, no new blocking or serious
  logic defects. Held below 8 by the partially closed M-2 (F-1, on the default reopen path), the non-ref-counted visibility
  registration, and zero real-host evidence for N5.
- Confidence: MEDIUM-HIGH on logic; LOW on rendered layout.
- Top risk: status badge showing `running` after reopening an idle session, which is the user-visible S7 symptom surviving on the
  common path.

## Delta review r1b

Range: `git diff 8d15080be 95e8cd4fe -- libs/` (11 files), lane report `reports/phase-e-r1b-report.md`. Read in full: `command-center-turn-status.ts`,
the changed hunks of `command-center-page.controller.ts`, `session-coordinator.ts`, `voice-provider-summary.ts`, `command-voice-loop.ts`, plus
`command-center-tribunal.transport.ts` and `tribunal-run-coordinator.ts` (`pageExit`, `confirm`). One Jest call on the controller,
session-coordinator and voice-loop specs: 3 suites, 84 tests, all pass. The passing specs do not cover the new Serious finding below,
because the transport is mocked.

### Status of F-1, F-3, F-4, F-5, F-7

| Finding | Status | Evidence |
| --- | --- | --- |
| F-1 status badge | CLOSED (Minor F-11 left) | `shownSessionStatus` (`command-center-turn-status.ts:8-23`) derives `running` from the root tab (`streaming`, `awaiting-background`, `sleeping`) and shows a stale stored `running` as `idle`. Resume sets `idle` unless the tab is live (`session-coordinator.ts:95-101,130-136`). Header, dock and session controls all read the derived value (`page.component.ts:141,185,315`). |
| F-3 stale roster card on Start new | PARTIAL: the card is cleared, but the fix introduces a Serious regression (N-1) | `controller.ts:313-324,616-630`. |
| F-4 chip labels | CLOSED with an accepted deviation | `voice-provider-summary.ts:36-38` shows `No voice chosen` for an empty ElevenLabs voice id. `Local` stays short and `ElevenLabs voice` stays for a set id (recorded decision; Settings names the voice with a separate voice-list call). Status and model rules still match Settings. |
| F-5 failure shows "No key" | CLOSED | `command-voice-loop.ts:193,201` call `summarizeVoiceProviders(null)`, which sets `stt/tts: null`, so the chip reads `Voice unavailable`. `start()` still recomputes readiness itself on success (`:207-216`): duplication only. |
| F-7 unhandled `exit()` rejection | CLOSED | `controller.ts:315-320` catches it and shows a fixed-text toast. |

### shownSessionStatus: the gap between send and first streaming status

No flash from `running` to `idle` and no new gap. `message-sender.service.ts:431` (`chat:start`) and `:766` (`chat:continue`) call
`markTabStreaming` before the RPC, so the derived value turns `running` as soon as the sender reaches that line, which is earlier than
before (the stored status was only set after the send resolved, in `session-coordinator.ts` `send()`). Before `markTabStreaming` the
badge shows what it showed before the click (`idle`); on the `continue` path there is a `session:validate` round trip in that window
(`message-sender.service.ts:~663`), so "pressed Send, badge still idle for tens of ms" is possible, as it was before. A failed send
rolls the tab back (`:495`), the derived value returns to `idle`, and `fail()` stores `error`. A stored `running` with a tab that has
ended is shown as `idle`, so the stale value cannot leak. Resume reads `existing.status` from the snapshot taken before
`await switchSession`; if the tab starts streaming during that await the stored value is `idle` but the derived value is still
`running`, and if it ended during the await the stored `running` is masked by the derived `idle`. Both are correct for display.

### F-3 teardown and the new tab's roster request

Orchestrator reasoning about `handledRosterQuestionId`: holds. The roster effect selects questions with `item.tabId === tabId` for the
new marked tab, so the old tab's roster question is never re-handled; with `pendingProposal` null, `shownInput()` ignores
`handledRosterQuestionId` (`controller.ts:~177`); a new tab's roster has a different request id, so the
`request.id === handledRosterQuestionId` skip does not hide it. Leaving the id stale is harmless, and resetting it would have re-armed the
120 s timeout, as the correction states.

Does the teardown cancel or decline a roster that belongs to the new tab? Not in the Start new flow. The effect runs in the flush right
after `setSession`, before any send is possible, so `expectedRequest` and `pendingProposal` of the new tab cannot exist yet; I found no
path that requests a Tribunal for the new tab in the same tick as the tab change. `tribunal.pageExit()` is not filtered by tab: it
declines every open entry and cancels every answered entry in the coordinator (`tribunal-run-coordinator.ts:115-125`). That is correct for
Start new because all pending entries belong to the old root. The Decline for the old question goes through `answerQuestion` with
`markedTabId` = the new tab, but the response is keyed by request id (`chat.store.ts:507-520`) and the deciding tab only controls
`cancelPendingQuestionOnOtherTabs`, so it still reaches the old question.

### New findings

#### N-1 (Serious). Tab-change teardown permanently disables the Tribunal transport for the rest of the page

- File: `command-center-page.controller.ts:313-324,625-626` (teardown calls `tribunalTransport.pageExit()`),
  `command-center-tribunal.transport.ts:116,131-134`.
- Scenario: the user clicks Start new (or any marked-tab change after the first assignment). `teardownSessionState()` runs
  `tribunalTransport.pageExit()`, which sets `exited = true`. Nothing ever sets it back (only the declaration at `:33` and the
  assignment at `:132`; `open()` does not reset it). In the new session the user requests a Tribunal and clicks Confirm:
  `tribunal-run-coordinator.ts:169` awaits `transport.discoveryComplete()`, which now rejects with `Page exited` at `transport.ts:116`;
  the coordinator reports `discovery-failed` as retryable (`:172-173`). Every retry fails the same way. The Confirm answer was already
  delivered at `:166`, so the model has it and no launch happens.
- Impact: after Start new, Tribunal cannot be launched until the page is reloaded. This is a core Command Center capability failing
  after a very ordinary action. Spec `controller.spec.ts:1474` uses a mocked transport (`pageExit: jest.fn()`) and the integration
  harness mocks `discoveryComplete`, so nothing exercises it.
- Fix: do not call `transport.pageExit()` on the tab-change path. Call `tribunalTransport.cancelDiscovery()` there (it rejects the old
  boundary wait) and keep `pageExit()` for page destroy and `exit()`; or clear `exited` at the end of the tab-change teardown. Add a
  spec with the real transport: Start new, then a roster Confirm reaches `discoveryComplete` without rejecting.

#### F-11 (Minor). Badge reads `running` while `sleeping` or `awaiting-background`, with Stop disabled

- File: `command-center-turn-status.ts:14-20`, `controller.ts:57-65`.
- Scenario: a root with session crons or background tasks stays `sleeping`/`awaiting-background` for minutes. The badge says `running`,
  the root plate says `idle` (`rootWorkState` counts only `streaming`), and Stop is disabled because `turnAbortable` is `streaming`
  only. Three signals disagree; pick one source for "busy".

#### F-12 (Minor). Stored and shown status differ by design during background work

- File: `command-center-turn-status.ts:58-93`. The settle effects now skip while awaiting; the terminal pulse (phase idle/failed from
  `awaiting-background` or `sleeping`, `tab-manager.service.ts:1730-1736`) settles the stored value afterwards. Display stays correct
  even if the pulse is lost. Noted only so nobody reads `store.sessionStatus()` directly for decisions.

### AC22 / Amendment A1

Still holds. A Tribunal roster Confirm is emitted only by the card's `confirm` output to `confirmProposal`. The new teardown never
answers Confirm: the only text it can cause is `Decline` for the old proposal via `pageExit` (the transport also maps any `confirm`
text to `Decline`, `transport.ts:89`), and a Confirm clicked after the teardown returns immediately because `pendingProposal()` is null
(`confirmProposal` guard, spec `:1474`). `answerOrdinaryQuestion`'s Confirm filter, `sendCommand` and the nonce framing are unchanged in
this diff, and the voice guards (`pendingInput` question refusal, `pendingRoster`) are unchanged.

### Updated verdict

- Recommendation: REVISE (small). N-1 must be fixed before this phase closes: a one-line change plus one spec. Everything else from
  r1 and r1b is closed or accepted.
- Assessment: NEEDS_REVISION. Blocking 0, Serious 1 (N-1), Moderate 1 (F-2 carried), Minor 9.
- Score: 6.5/10 (from 7.5). A confirmed regression in Tribunal launch after Start new outweighs the F-1/F-4/F-5/F-7 closures; with N-1
  fixed and a real-transport spec I would score 8/10.
- Confidence: HIGH on N-1 (two assignments and one guard, read directly); MEDIUM on the rest (no runtime run).

## Delta review r1c

Range: `git diff 95e8cd4fe be433c363 -- libs/` (controller, controller spec, transport spec), lane report `reports/phase-e-r1c-report.md`.
Read only; no Jest, Nx or build was run (the orchestrator's 35-suite run is taken as given). Also read `tribunal-run-coordinator.ts:115-125,
140-200,244-260` and `command-center-tribunal.transport.ts:33-50,77-98,115-141`.

### N-1 status: CLOSED

`teardownSessionState(pageLeave)` (`controller.ts:~619-628`): the marked-tab-change effect passes `false` (`:314`) and takes the
`cancelDiscovery()` branch; `exit()` passes `true` (`:616`) and keeps `tribunalTransport.pageExit()`. `exited` is therefore set only on
real page exit (and by the transport's own `onDestroy`, `transport.ts:49`). The real-transport spec
(`transport.spec.ts:152-172`) proves the three states in order: the old wait rejects with `Discovery cancelled`, a fresh wait on the new
tab resolves from the new tab's pulse, and after `pageExit()` discovery rejects with `Page exited`.

### Old wait or pending launch that could still fire for the old root: none found

- `tribunal.pageExit()` runs before `cancelDiscovery()` in the same teardown (`:~621-623`). It marks every `answered` entry
  `cancelled` and declines every `open` entry (`tribunal-run-coordinator.ts:115-125`). The `confirmEntry` continuation that is awaiting
  `discoveryComplete()` (`:169`) receives the rejection, and `isCancelled(id, entry)` is true (`:172`), so it returns `cancel(entry)`
  and never reaches the manifest write or the launch send (`:175-197`). If the wait were to resolve instead, the second check at `:175`
  still stops it. There is no path where the old root's confirm continues.
- `cancelDiscovery()` nulls `boundaryResolve` and `boundaryReject` before rejecting (`transport.ts:136-141`), so a later old-tab pulse
  cannot resolve the old wait, and the transport's pulse effect reads only the currently marked tab (`:36-47`).
- It cannot reject a wait the new session needs: the effect runs in the flush right after `setSession`, and a new-session wait only
  exists after the user clicks Confirm on a new roster, which needs a send and a roster question first. `discoveryComplete()` stores a
  single resolver and overwrites it, so a fresh wait is independent of the cancelled one.
- `boundarySeq` may be reset by the `Decline` that `pageExit` sends for an old open proposal (`transport.answer` reads the marked tab,
  which is already the new tab, `transport.ts:82-84`). `answer()` sets it again at every Confirm before the new wait begins, so the new
  boundary cannot be satisfied by an older pulse.

### AC22 / Amendment A1: holds

The change only chooses which of two cleanup calls to make. It sends no new text. The text an answered or open proposal can receive in
teardown is still `Decline`; the Confirm path sends the fixed discovery answer, not the user's words, and only from the card via
`confirmProposal`. `answerOrdinaryQuestion`'s Confirm filter, `sendCommand` and the voice guards are untouched in this diff.

### Other defects in these three files

None blocking. Minor only:
- The controller spec (`controller.spec.ts:1451-1463`) uses the mocked coordinator and transport, so it proves routing (which method is
  called), not behaviour; the behaviour is covered by the real-transport spec. Together they are adequate.
- Carried, unchanged and not re-scored: F-2 (visible-tab registration is not ref-counted), F-11/F-12 (busy-state sources disagree
  during `sleeping`/`awaiting-background`), F-6, F-8, F-9, F-10, and the unproven items under "Residual uncertainty" above (rendered
  layout, a live N5 trace).

### Final verdict for Phase E revise round 1

- Recommendation: APPROVE.
- Assessment: APPROVED. Blocking 0, Serious 0, Moderate 1 (F-2, carried and low probability), Minor 9.
- Score: 8/10. Closed with evidence: S-1, M-1, M-3, M-d, N5 (static trace), F-1, F-3 (with N-1 fixed), F-4 (accepted deviation), F-5,
  F-7. M-2 is now closed through the derived status. Held below 9 by the ref-count gap (F-2), the inconsistent busy signals (F-11), and
  the absence of any live-host evidence for N5 and the rendered layout, which the visual re-review must supply.
- Confidence: HIGH on the teardown and Tribunal paths (read directly, plus the real-transport spec); MEDIUM on N5 and layout (no
  runtime run by me).
- Top risk: first real Electron run of N5, where pulses will arrive live for the first time and the Tribunal guard that consumes them
  has so far been exercised only with synthetic pulses.
