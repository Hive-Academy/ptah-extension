# Code Logic Review - TASK_2026_678_9083 - Phase E visual fix round (E1-E6)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6.5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 6 |
| Minor issues | 8 |
| Reviewer | Anthropic (in-process) |
| Implementer | codex (lanes E1-E6) plus orchestrator spec fixes |
| Range | `git diff a4e0c59bb..294be63cc` (e4375e451 page fixes, 294be63cc entry cards) |

Scope read in full: `pcm-capture.ts` and the new worklet asset against the removed inline source, `apps/ptah-extension-webview/project.json`,
`apps/ptah-electron/scripts/copy-renderer.js` (copy, base-href and CSP blocks), `command-voice-hud.component.ts`,
`command-center-page.component.ts`, `command-center-page.controller.ts` (every changed hunk plus the pulse, projection and voice
entry points), `command-center.store.ts` diff, `command-voice-loop.ts` `start()`, `mute()`, `release()`, `onClip()`,
`session-coordinator.ts` `startVoice/mute/stop/send/open*`, `command-overlay.component.ts` and `command-overlay-positioner.ts`
(complete), `work-projection.ts`, `scene-layout.ts` diff, `command-scene.component.ts` layout effect, `sprite-cache.ts` and
renderer diffs, `status-narrator.ts`, `command-work-list`, `command-pending-input`, `command-session-controls` diffs,
`electron-shell`, `dashboard-grid` and `setup-hub` diffs, `tab-manager.service.ts` terminal-pulse emission (`:1715-1805`), and all
eight lane reports. No tests, typecheck or build were run (read-only rules); the orchestrator's results are taken as given.
Binding text: Amendment A1 and AC22, decision D45.

## AC22 / Amendment A1

No regression. Phase E did not touch `sendCommand`, `confirmProposal`, `expectedRequest`, `answerOrdinaryQuestion`'s Confirm filter
(`controller.ts:488-499`) or the transport. The new pulse effect (`:300-311`) uses its own `statusPulseSeq` and never writes
`expectedRequest`, `armedTurns` or `deliveredPulseSeq`, so it cannot consume a pulse that the Tribunal guard or the voice boundary
needs. The pending card changes are classes plus a placeholder (`command-pending-input.component.ts:21-24,113-120`); the Confirm
button still emits `confirm` to `page.confirmProposal`. The placeholder reads `choices()[0]`, which is the already-filtered ordinary
choice list. The new dock text field submits through the unchanged `sendCommand` path.

## Answers to the review focus items

**1. B1 worklet asset.** Closed in code; runtime still unproven.
- The asset is declared once, in the base `options.assets` of `apps/ptah-extension-webview/project.json:17-31`, so both the
  `production` and `development` configurations emit `dist/apps/ptah-extension-webview/browser/assets/command-center/pcm-capture.worklet.js`
  (neither configuration overrides `assets`; `outputHashing` is `none` in both, so the name is stable). `copy-renderer.js` copies
  that whole directory recursively (`copyRecursive`), so the asset reaches `dist/apps/ptah-electron/renderer/` in both modes.
- URL resolution: `new URL('assets/command-center/pcm-capture.worklet.js', document.baseURI)` (`pcm-capture.ts:63-66`). The patcher
  rewrites `<base href="/">` to `./` (`copy-renderer.js:173-176`), so `baseURI` is `file:///.../renderer/index.html`'s directory and
  the result is `file:///.../renderer/assets/command-center/...`. The base element's URL is frozen at insertion, so a nested route or
  a later `pushState` does not move it. A malformed base would throw inside the `try` (`:61-103`) and surface as `CaptureError('worklet')`
  with the stream released by `stop()`.
- Policy: `script-src 'self'` (`copy-renderer.js:161`) governs worklet module loads, and the renderer's own scripts already rely on
  `'self'` matching `file:`. This is the same mechanism, but the E1 report itself says it did not prove an AudioWorklet load in this
  Electron runtime. The orchestrator's smoke check of Start voice in a packaged build is still the only evidence for B1.
- Processor equivalence: line-by-line the new file equals the removed string (ring size `ceil(sampleRate*0.35)`, `start`/`end`
  handling, prior-sample flush, frame post, per-utterance copy, `registerProcessor('ptah-pcm-ring', ...)`); only formatting differs.
  Nothing else referenced `moduleUrl`; the revoke path was removed with it. OK.

**2. S1 typed voice errors.** Mapping, retry-clear and Start-enabled are correct for capture failures. Mapping at
`command-voice-loop.ts:236-257` follows `CaptureError.reason` (denied, worklet, otherwise unavailable). Cleared on: `setVoiceState('listening')`
(`store:155`, reached from `coordinator.startVoice` `:184` on every successful start), `startVoice()` (`controller:469-474`), and a
marked-tab change (`store:141-144`). After a successful start no stale error remains, because `startVoice()` clears first and a
failing retry re-sets it. Start stays enabled: `canStart = !canStop`, and a capture failure leaves `voiceState` `idle`. Gaps are
M-1 (Start disabled by a streaming typed turn) and M-4 (the typed kinds beyond capture are dead).

**3. S7 turnAbortable and the pulse settle.** `turnAbortable` (`controller:52-60`) is a pure computed over the marked tab's
`status === 'streaming'`; it does not touch `armedTurns` or `deliveredPulseSeq`. The settle effect is race-free against the voice
boundary but has two timing defects (M-2) and one open root cause the lane already declared (no pulse, no settle).

**4. S6 idle root and consistent ids.** Derivation is in two places (see Minor m-5) but yields the same state. The pre-session root
id is `root:<tabId>` (`controller:213`) and the later one is `root:<sessionId>` (`work-projection.ts:90`); `store.setProjection`
drops a selection whose id vanished (`store:219-222`). Consequence in M-3.

**5. E3/E5 overlay.** Plate click now selects through the injected store (`overlay:269-273`); the pin effect compares against
`selectedBeforePin`, which `pin()` sets to the clicked id after calling `select`, so a plain click does not self-unpin. Keyboard:
Enter and Space both pin (`:58-59`, `onLabelEnterKey` prevents default), Escape unpins and restores focus. Defects: S-1 (plate
measurement no longer matches), M-5 (hidden pinned card), m-3 (root focus restore).

**6. E5 toast, pending card, dock.** Toast: non-error tones expire after 5 s with cleanup (`component:236-243`), errors persist until
dismissed (`dismissToast`), the retry-speech action is preserved (`:176-184`). Pending card: cap and placeholder only; answer flow is
unchanged. Dock wiring verified one by one in `component:~172-198` and the HUD: start/stop (`start`, `stop`), mute (`toggleMute`),
interrupt (`interrupt`, only while speaking), voice settings (header button, HUD error block, missing-provider block), send, new
session (`Start new`), status. All emit to the same controller methods as before. The behavioural changes are M-1.

**7. E6.** Both cards gate on `VSCodeService.isElectron` (`dashboard-grid.component.ts:77-79`, `setup-hub.component.ts:1215-1217`), the
same getter other Electron-only surfaces use, so VS Code shows neither and the `command-center` shell tab already existed
(`electron-shell.component.ts:153`). The hub card is a `div role="button"` handling click and `keydown.enter` only; Space is not
handled (m-1). The dashboard entry is a real `<button>`.

**8. Spec quality.** New specs pin: asset URL and worklet-failure cleanup, typed error mapping per capture reason, HUD retry/copy,
retry-clear, listening-clear, new-session clear, toast dismiss and tone-based expiry, plate click/Enter/Space selection, neighbour
avoidance, idle root, label precedence, plate priority, 24-node packing, gating in both hosts. Not pinned: the root-id transition
(M-3), the settle with a follow-up turn running (M-2), the DOM-measured plate size (S-1; the layout specs use a fake `measure`),
Mute with no active microphone (M-1), and Space on the hub card.

## Findings

### Blocking

None.

### Serious

#### S-1. Plate sizes are measured by text equality and now never match, so layout collision uses guessed sizes

- File: `command-scene.component.ts:150-158` (key = `label.element.textContent?.trim()`), `command-overlay.component.ts:60-68` (new two-line plate), `scene-layout.ts:339-345,372` (`measure(label)` consumer).
- Scenario: E3 changed each plate from a single text node (`{{ node.label }}`) into two spans (label, then `provider · state`). The element's `textContent` is now label plus the second line, while `layoutScene` calls `measure(label)` with only `node.label` (or `Provider · label` for children, which already never matched). `measuredLabels.get(text)` therefore misses for every node and the fallback `width = min(220, max(72, len*7+24))`, `height = 28` is used. A real plate is at least 44 px tall (`min-h-11`), is up to about 160 px wide, and for a short label such as "Ptah" is as wide as its second line ("Anthropic · running"), well over the 72 px estimate.
- Impact: label rectangles reserved by the new priority placement (`scene-layout.ts:321-387`) are smaller than the DOM plates the renderer then translates to those coordinates (`command-scene-renderer.ts:286-296`). Neighbouring plates and plate-versus-sphere checks can overlap by tens of pixels in crowded scenes, which is exactly the S8 symptom this round claimed to close. Unit specs cannot see it because they inject a fake `measure`.
- Fix: look measurements up by node id, not text. `SceneLabel` already carries `id`, `width` and `height`; build `measuredById` and give `layoutScene` a `measure(text, nodeId)` (or pre-resolve per node). Add a component spec that renders real plates and asserts the layout used their `offsetWidth/Height`.

### Moderate

#### M-1. `turnAbortable` was folded into `canStop`, which also drives Mute and Start

- File: `command-voice-hud.component.ts:68,76,138-144` (shared `canStop`/`canStart`), `controller.ts:524-526` (`toggleMuteVoice`), `command-voice-loop.ts:547-570` (`mute()`).
- Scenario A: a typed command is streaming and the microphone was never started. Mute is now enabled. Clicking it runs `voice.mute()` unconditionally: it sets `muted`, calls `coordinator.mute()` and flips the store to `voiceState 'muted'` although no capture exists. The HUD then reads "Microphone muted / Click Unmute to listen", `canStop` stays true after the turn ends (`muted` is in the list), and Unmute calls `voice.start()`, which prompts for and opens the microphone from a control labelled Unmute.
- Scenario B: while that typed turn streams, `canStart` is false, so the orb is disabled; the user cannot start voice, and cannot do so if the tab is stuck `streaming`.
- Impact: misleading state and an unintended mic start path on a plausible click; Start regresses from "always the retry" to "blocked during a typed turn".
- Fix: keep `turnAbortable` for Stop only: `canStopTurn = turnAbortable || voice states`, `canMute = voiceState in [listening, thinking, speaking, muted]`, `canStart = !voice-state-busy` (not gated by `turnAbortable`). Guard `voice.mute()` with `if (!this.active && !this.muted) return`.

#### M-2. Terminal-pulse status settle can mark a live turn idle, and has no fallback when no pulse arrives

- File: `controller.ts:300-311`.
- Scenario 1: the user sends a second command while the first is streaming (supported by the sender and the S-1 round's pulse analysis). The first turn's pulse arrives while the second is still running; status is `running`, so it settles to `idle`/`error` while `turnAbortable` is true and Stop is live. The badge says idle during a running turn, and when the second turn ends the pulse is consumed against an already-idle status. A late aborted-turn pulse arriving after a quick re-send has the same effect with `error`.
- Scenario 2 (declared open by E4, "Needed outside scope"): if no terminal `turn_state` reaches `applyTurnState` (`tab-manager.service.ts:1722-1730,1776-1780` also requires a workspace path), the badge stays `running` and `latestReply` stays null; the visual review's S7 symptom is unaffected in that case.
- Fix: settle only when `root.status !== 'streaming'` at the time of the pulse (or derive: when `turnAbortable` falls from true to false and status is `running`, set idle, which also covers the no-pulse case). Add a spec with two overlapping sends.

#### M-3. The pre-session root id differs from the session root id, which drops selection and an open card

- File: `controller.ts:213` (`root:${root.id}`) versus `work-projection.ts:90` (`root:${input.rootSessionId}`); `store.ts:219-222`; `overlay:174-178`.
- Scenario: the user clicks or pins the Ptah plate (or the page selects the root) while the first message is in flight; when the SDK session id arrives the root node id changes, `setProjection` clears the selection, the pin effect unpins, `activeNodeId` keeps the stale old id with no matching node, and the sprite cache builds a new root sprite. The `StatusNarrator` also resets its baseline (`status-narrator.ts:19-24`), which is harmless today only because no children exist before the session id.
- Impact: one-time loss of selection and a vanished card at the most visible moment (first turn); a latent trap if children can exist before the id lands.
- Fix: use a root id that is stable across the transition (for example always `root:<tabId>` from the controller and from `projectOwnedWork`), or carry the selection across by mapping the old root id to the new one in `setProjection`. Pin with a spec.

#### M-4. Typed error kinds beyond capture failures are declared but never produced

- File: `command-center.store.ts:60-68` (`stt`, `tts`, `playback`, `chat`), `command-voice-loop.ts:135-142,358-362,418-424` (toast only).
- Scenario: transcription, speech playback or request failures only show a toast; the old HUD also rendered a persistent line for these (`a4e0c59bb` HUD `:44-56`). Now the HUD says "Voice needs attention" only for capture failures. Because error toasts persist until dismissed, the information is not lost, but dismissing the toast removes the only record, and Retry speech disappears with it. Four union members are dead code. E4 flagged this as outside its authorization.
- Also: for `mic-denied`, `mic-unavailable` and `worklet` the recovery is still "Open Voice settings" (`hud:91-104`); the visual review (S1) said this does not match an OS microphone problem. The decision to keep it is recorded in E4 and is reversible.
- Fix: set `voiceError` at the three voice-loop failure sites (kind plus message, cleared by the same paths) and show a kind-specific recovery.

#### M-5. A pinned card hidden for lack of space leaves an invisible pinned state

- File: `command-overlay-positioner.ts:134-141` (`visibility:hidden`, no position fits), `overlay.component.ts:232-239,265-273`.
- Scenario: a click pins a node; all four candidate positions overlap visible plates (likely in a scene with 6-8 plates and a 256 px wide card), so the card is hidden but `pinnedNodeId` stays set. Hover on any other plate is ignored (`requestOpen` returns while pinned), the hidden Close button cannot be reached, and the only exits are Escape on a plate, another click, or a list selection.
- Impact: hover cards silently stop working until the user guesses to press Escape. Selection itself still works and the rail "Selected work" card shows, so the information is not lost.
- Fix: when no candidate fits, fall back to the least-overlapping candidate (or the Floating UI result) for a pinned card, or unpin when the card cannot be shown; keep hide only for hover.

#### M-6. Compact packing runs a dense grid search inside a reactive effect

- File: `scene-layout.ts:208-275`, called from `command-scene.component.ts:160` on every projection, selection, viewport, theme or label change.
- Scenario: when the wide layout is not clear (crowded or narrow stage), each of up to 5 factors scans a 10 px grid over the viewport for each of up to 23 nodes, each cell scanning previously packed nodes. At 1600x1000 and 24 nodes that is several million distance checks per factor, repeated on every selection change.
- Impact: a possible tens-of-milliseconds stall per click or resize on the stages the fix targets; not measurable here (mic latency and FPS stay user-run per D45).
- Fix: memoize the packed result on `(projection nodes ids, viewport, tribunal lane set)` and reuse it when only selection changes, or use a coarser coarse-to-fine grid.

### Minor

- m-1. `setup-hub.component.ts:757-763`: `role="button"` div handles click and Enter but not Space (and the sibling Tribunal card has the same pattern, so this is inherited). Add `(keydown.space)` with `preventDefault`.
- m-2. `controller.ts:469-474`: `startVoice` clears the toast whenever a voice error exists, including unrelated toasts such as a Tribunal cancellation notice.
- m-3. `command-center-page.component.ts` `focusWorkRow` plus `work-list.focusRow`: the root is no longer in the list, so the Escape focus restore for a hidden root plate (`overlay.unpin`) focuses nothing and focus falls to `body`.
- m-4. `command-session-controls.component.ts:1` and `command-voice-hud.component.ts:1` now start with a UTF-8 BOM; remove it (formatting noise, harmless to TS).
- m-5. Root state is derived in two places: `command-center-projection.source.ts:189-196` computes `rootTabStatus`/`rootQuestionPending`, and `controller.ts:196-226` recomputes both for the same input and overrides them. Keep one.
- m-6. `command-pending-input.component.ts:21`: `max-h-[260px] overflow-y-auto` on the section means a roster with many lanes puts Confirm/Decline behind an inner scroll and clips the focus outline of the first control.
- m-7. `sprite-cache.ts` signature omits "is root", so a non-root with monogram `P`, same palette, same size would reuse the root's sprite. Sizes differ in practice; add `root` to the signature to remove the dependency on that.
- m-8. `electron-shell.component.ts:135`: `overflow-x-auto` on a `tabs-lifted` strip clips the lifted-tab pseudo elements vertically and does not scroll an offscreen active tab into view (new entry cards set the view programmatically). Verify at narrow widths.

## Decisions

| ID | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| R-E1 | Rate the plate-measure mismatch Serious and the Mute/Start coupling Moderate. | Serious vs Moderate for each | S-1 is deterministic (every plate misses the lookup) and defeats the S8 fix in the real DOM; M-1 needs an explicit extra click and does not capture audio without a further click. | yes |
| R-E2 | Accept B1 as code-complete and make the packaged-runtime check an orchestrator gate, not a finding. | Finding vs gate | E1 states the AudioWorklet-under-`file:` load is unproven; there is no code defect to cite. | yes |
| R-E3 | Do not raise the dashboard/lane-report scope mismatch (report says inline template, commit edits the `.html`) as a finding. | Finding vs ignore | The commit contains a coherent `.html` edit and the component still uses `templateUrl`; behaviour is correct. | yes |

## Verdict

- Recommendation: REVISE (NEEDS_REVISION), 0 blocking, 1 serious, 6 moderate, 8 minor.
- Confidence: HIGH on S-1, M-1, M-2 scenario 1 and M-3 (all follow from cited lines); MEDIUM on M-5 and M-6 impact (depends on runtime scene density); LOW on B1 until a packaged Electron smoke check shows the worklet loading under the shipped CSP.
- Top risk: plate collision layout runs on guessed sizes (S-1), so the S8 overlap fix does not hold in the real DOM.
- What a robust implementation would add: id-keyed plate measurement with a DOM-backed spec; separate `canStopTurn`, `canMute` and `canStart` in the HUD with a guard in `voice.mute()`; a settle that checks tab status (or the falling edge of `turnAbortable`) instead of the pulse alone; a root id that is stable across the session-id arrival; typed voice errors at the transcription, playback and request failure sites; a pinned-card fallback position; and a packaged-build smoke test of Start voice, the entry cards and the dense-scene layout.
