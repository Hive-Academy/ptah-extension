# Code Logic Review (frontend) - TASK_2026_LANE_CONTROL

Review family: claude (in-process subagent, reason above); Implementer families: codex

Scope: working tree of `.claude-worktrees/lane-control-model` (HEAD 41a27df54 plus uncommitted follow-ups), frontend files only. Read in full: `lane-composer.component.ts`, `agent-follow-up-queue.service.ts`, `agent-monitor-message-handler.service.ts` diff, `lane-thread.ts`, `lane-thread-row.component.ts`, `agent-continue-input.component.ts`, the card header and card diffs, the inspector diff, the lane-event-row diff, the `cli-capability-*` files and the store diff vs `0abc5e54c`. No builds or tests were run (per instructions). Line numbers are working-tree lines.

- Score: 4/10
- Verdict: REVISE

## Defects

Counts: blocking 3, major 7, minor 8.

### Blocking

1. **Inspector steer for SDK subagent and background rows is routed to the CLI-lane composer.**
   `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:199`.
   `@if (row.tray.agentId || parseLaneKey(row.key)?.id; as agentId)` is truthy for every keyed row. `tray.agentId` is the SDK short-hex id (`session-agent-tray.ts:25-28`), and `parseLaneKey` also returns the tool-call id for `sub:` and `bg:` rows. The composer calls `agent:previewMessage` for an id that is not a monitored CLI lane. The preview fails, `queueDisabled()` stays true, and the user sees "Message options unavailable" with no way forward. The old `ptah-agent-steer-input` plus `tray.steer` path is now unreachable for those rows, so the "inspector retains all current actions" Preserve item is broken.
   Fix: mount `ptah-lane-composer` only for `parseLaneKey(row.key)?.kind === 'cli'` with that id. Keep the tray steer input for every other row.

2. **A cancelled queued message loses its text.**
   `lane-composer.component.ts:193-203` (`cancel`) and `:182-185` (draft cleared on accepted).
   After accept the draft is cleared and the composer keeps no per-message text. Cancel calls `store.cancelMessage` and restores nothing. `receipt.preview` is capped at 160 characters and is not the body. This violates "Allow an accepted queued message to return to the draft through agent:cancelMessage" and "Keep failed or cancelled text available as a draft".
   The old `unqueue()` flow in `agent-continue-input` did restore the text. Its replacement `AgentFollowUpQueueService.unqueue/takeUndelivered` is no longer reachable (see defect 4).
   Fix: keep `Map<receiptId, text>` in the composer or store, bounded to 8 per agent. On a cancel receipt with `reason === 'cancelled-by-user'`, restore or append the text to the draft. On `failed`, `expired` or `interrupted-undelivered`, do the same and show the reason.

3. **Canvas lane renders two composers.**
   `agent-card.component.ts:256` now mounts `ptah-agent-continue-input` inside the flat card. `canvas-lane-view.component.ts:211` still mounts another `ptah-agent-continue-input` directly after `<ptah-agent-card presentation="flat">`. Each canvas lane shows two textareas with independent drafts, both bound to the same agent. Double submit across the two is not guarded by `sending`, which is per instance.
   Fix: remove one. Either drop the canvas-level mount, or have the card own it for the `panel` variant only.

### Major

4. **Draft recovery, queued-message editing and coalescing no longer work.**
   `agent-follow-up-queue.service.ts` (whole file) is constructed in `app-shell.component.ts:169` and has no other consumer. `enqueue`, `unqueue`, `takeUndelivered`, `queued` and `undelivered` are not called by any component. Its `accepted` map is never populated by the new composer.
   The Preserve list names "Renderer draft recovery, queued-message editing, coalescing, and cold-resume recovery". The old UI had click-to-edit on the queued message and undelivered recovery. Both are gone, and the service is dead code.
   Fix: wire the service into `LaneComposerComponent` (accepted text, cancel-to-draft, undelivered recovery), or move that logic into the composer and delete the service.

5. **A message that fails after acceptance is silent in the composer.**
   `lane-composer.component.ts:96-98` filters `queuedReceipts` to `state === 'accepted'`. The summary at `:63-73` is rendered only when that list is non-empty. When a push moves the receipt to `failed` (`agent_stopped`, `host-restarted`) or `expired`, the "queued" block disappears. No failure text, no draft restore, and `lastReceiptLabel` is never shown.
   The user sees an emptied composer and believes the message was sent. The thread shows "Failed" only if a preview exists and the transcript section is open.
   Fix: surface the last non-queued receipt (failed, expired, interrupted) in the composer with the reason copy and a "restore to draft" action. For `interrupted-undelivered`, offer Resume as the UX contract requires.

6. **Out-of-order receipts can regress state.**
   `agent-monitor.store.ts:815-826` (`onMessageReceipt`) replaces by id with no `updatedAt` or terminal-state guard. `sendMessage` (`:903-908`) and `cancelMessage` (`:910-915`) merge the RPC result through the same path.
   If a push (`started`, `settled`, `failed`) arrives before the send RPC resolves, the older `accepted` snapshot from the response overwrites it. `AgentFollowUpQueueService` then keeps `queued()` true forever (`:63-73` only fires on a state change).
   Fix: ignore an incoming receipt whose `updatedAt` is below the stored one, or whose state ranks below the stored state, unless the state is terminal.

7. **Previews are loaded once per agent id and never refreshed.**
   `lane-composer.component.ts:121-137`. The effect depends only on `agentId()`. The plan requires a preview on focus, on delivery-mode change and on relevant agent-state change, and a replan on execution.
   Consequences:
   - The preview says `steer`, the lane becomes interrupt-resume-only, and the backend refuses without `allowPartialTurnLoss`. The composer shows an error, the preview is still stale, and the confirmation dialog can never appear. Retry fails the same way.
   - If the initial preview RPC fails, `queueDisabled()` (`:103`) stays true. The message "Try again" has no control that retries. This is a dead end.
   Fix: re-preview on focus and on `stopped()`/status change. Re-preview after any `unsupported`/`failed` send outcome. Add a retry action on preview error.

8. **The interrupt-resume confirmation dialog has no focus management.**
   `lane-composer.component.ts:53-61` and `:152-157`.
   Choosing "Send now" from the menu removes the focused menuitem, so focus falls to `body`. The dialog has `role="alertdialog"` but no focus move, no trap, and Escape is handled only on the composer wrapper (`:13`). Escape does nothing and a keyboard user must tab from the top of the page.
   The text stays editable while the dialog is open, so consent can apply to different text from what was previewed. Also, the dialog shows a static string instead of `lossDisclosure.text`.
   Fix: focus the confirm button on open and restore focus on close. Disable the field while confirming, or snapshot the text. Render `lossDisclosure.text`.

9. **Thread attribution uses the wrong data.**
   `lane-transcript.component.ts:103` passes the literal `'Claude'` as `parentFamily` and `agent.task` as `laneLabel`. Senders render as "Parent agent · Claude" even for a Codex parent. Lane rows render as "<whole task prompt> · cli".
   Fix: use `agent.displayName`, `ptahCliName` or `role` for the lane. Derive the parent family from the parent session, or drop the family.

10. **Thread rows are duplicated and user messages are mislabelled.**
    `lane-thread.ts:21-33`. Transcript messages join a receipt only when `message.id` equals a receipt id. Transcript ids come from stream `message_start.messageId` and are not receipt ids (the author's own report says so). So every user message from the stream is labelled "Parent agent · Claude".
    The same message also gets a separate "You" row from `receipt.preview` (`:34-38`). It then appears a third time in the message bubbles below, because the thread is a separate section (`lane-transcript.component.ts:44-54`). A4 is also acknowledged as unmet in the implementer's own report.
    Fix: correlate on `receipt.sender` plus a normalized preview match, or add a correlation id to the contract. Remove the duplicate block, or render the thread instead of the bubbles. Do not label an unmatched user message "Parent agent".

### Minor

11. **Wrong receipt copy.** `agent-monitor.store.ts:866` returns `'Interrupted ? not sent'` (a literal `?`, bytes `3f`). A6 requires "Interrupted — not sent". Fix: use the em dash character or `—`.

12. **Expired parent delivery is shown as "Waiting for parent".** `agent-monitor.store.ts:852-857` and `lane-thread.ts:44,53` treat any non-`delivered` state as waiting. The shared schema now accepts `state: 'expired'` (`libs/shared/.../schemas.ts:~86`, uncommitted), and `agent-events.ts` no longer drops expired envelopes. Also `AgentParentDeliveryState` (`agent-monitor.ts:8`) lacks `'expired'`, so the spread `...parsed.data` at `agent-monitor-message-handler.service.ts:133-138` should fail to typecheck. Fix: widen the type, add an "Expired / not delivered" label, and re-run the chat typecheck. (Shared and backend are outside my scope; the backend reviewer should confirm.)

13. **Cancel buttons expose raw ids and are not limited to user messages.** `lane-composer.component.ts:66-69` sets `aria-label="Cancel queued message <uuid>"` and lists parent-sent (`sender === 'parent'`) accepted receipts too. Fix: filter to `sender !== 'parent'` or label by the preview text, and name the message in plain words.

14. **`receipts` and `parentDelivery` eviction is not recency-based.** `agent-monitor.store.ts:820-823` and `:834-837`: `Map.set` on an existing key keeps its insertion position, so an active agent can be evicted by the 65th agent. `_previews` (`:809`) is never pruned. Fix: delete then set to refresh position, and prune previews with the agent.

15. **Silent no-op when the outcome has no receipt.** `lane-composer.component.ts:178-185`: a non-`unsupported` outcome with no `receipt` clears the sending flag with no draft change and no message. Fix: show an error.

16. **Follow-up service edge:** `agent-follow-up-queue.service.ts:107` returns without clearing `_queued` when the cancel did not succeed (message already started). The coalesced text stays shown as queued and is never sent. `cancelled` (`:49`) grows when a cancel is refused. Reasons shown to the user at `:69` are raw backend codes. Largely moot if defect 4 removes the service.

17. **Capability table gaps.**
    - `cli-matrix-rows.ts:295-299` makes `CURSOR_NEEDS_KEY` identical to `NOT_INSTALLED`. The "Needs API key" hint is lost and the constant is dead.
    - Provider-backed (Ptah CLI) rows never get a manifest (`cli-matrix-rows.ts:376` is system rows only), so they show "Unverified" for all five badges. This contradicts design note 6 and the plan's `PtahCliRegistry` manifest.
    - The Status column keeps "Ready" for instances (`INSTANCE_STATUS`, `:277`) versus "Installed" for system rows.

18. **Smaller a11y and visual items.**
    - The card header Stop button is `btn-primary` with a red icon on it (`agent-card-header.component.ts:147-160`); contrast and meaning are doubtful. It has an `aria-label`.
    - The Resume button keeps `btn-square` but now carries text (`:166-178`).
    - `lane-thread-row` puts `role="status"` on every receipt label (`:19`), so every row is a live region.
    - A failed completion in `lane-event-row.component.html` keeps `border-l-success` (A9 asks for an error tone).
    - The menu has `role="menu"` without arrow-key handling.
    - The textarea is disabled during send, which drops focus.
    - Compact variant: the resume path hint lowercases the whole string (`lane-composer.component.ts:112`).

## Requirement coverage

| Requirement | Status | Note |
| --- | --- | --- |
| Send queues, preview before execution | PARTIAL | Works, but the preview goes stale (7) |
| Send now preview (steer / interrupt-resume / unsupported + reason) | PARTIAL | Hint shows it. The unsupported reason is only in `title` (minor) |
| Interrupt-resume confirmation names partial-work loss; `allowPartialTurnLoss` only after consent | COMPLETE for the flag (`:159-162`) | Dialog is not keyboard-safe (8) |
| Draft kept until accepted or started; failed text stays | PARTIAL | Sync failure keeps the draft (`:178-180`). Post-accept failure and cancel lose it (2, 5) |
| Cancel only while Queued | COMPLETE | `:97` |
| Stopped lane shows Resume / Resume with message, no Send now | COMPLETE | `:28-31`. Header and card Resume are retained. |
| Compact surfaces hide an empty queue | COMPLETE | `:63` |
| Same composer on strip, subagent lane, card, inspector | PARTIAL | Strip and subagent lane unchanged (documented limit). Inspector is broken for non-CLI rows (1). Canvas is doubled (3). |
| A6 vocabulary, never "Delivered" | PARTIAL | No "Delivered". Wrong glyph in one label (11) |
| A4 single thread | PARTIAL | Acknowledged. Duplicated and mis-attributed (9, 10) |
| A9 sender/preview, bounded thread store, failed completion error tone | PARTIAL | Failed tone in `lane-event-row` is still success (18) |
| A3 CLI management table, live manifest | PARTIAL | System rows only (17) |
| Push validation (Zod), unknown payloads | COMPLETE | `safeParse`, ignored if invalid. No log (minor). Type gap (12). |
| Memory bounds | PARTIAL | Receipts 32/64 and delivery 16/64 are bounded. Eviction is not LRU, previews are unbounded (14). |
| Angular and TS rules | COMPLETE | Standalone, OnPush, `inject()`, signals, `input()`/`output()`. No `any`, `@ts-ignore`, `as unknown as` or `innerHTML` found. `(event.target as HTMLInputElement)` in `:140` is a plain cast. |

## Preserve-list check

- Stop button and `agent:stop`: PRESERVED (`agent-card-header.component.ts:147`). Restyled only.
- Explicit Resume: PRESERVED (header and card buttons retained).
- Permission response: PRESERVED (no diff in the permission UI).
- Account controls and labels: PRESERVED (`accountText` untouched).
- Output view: PRESERVED.
- Codex Send now: depends on the backend preview; the composer path is correct for `steer`.
- Follow-up queue draft recovery, editing and coalescing: BROKEN (2, 4, 5).
- Inspector actions for subagent and background rows: BROKEN (1).
- Background strip and SDK subagent lane: unchanged, so no regression, but no new contract either.
- `ptah-agent-steer-input` shared presentational input: kept, now used only in the inspector fallback (unreachable per 1).
- Canvas lane: duplicated composer (3).

## Test gaps

- `lane-composer.component.ts` has no spec: no coverage for Enter, Ctrl/Cmd+Enter, Esc, the confirm flow, `allowPartialTurnLoss` only after consent, stopped-lane mode, disabled reasons, cancel, double submit, or switching `agentId` mid-send.
- No test for a receipt arriving before the send RPC resolves, or for a stale `accepted` overwriting `settled` (6).
- No test that a failed or expired receipt after accept restores the draft or shows an error (2, 5).
- No test for the inspector with `sub:`/`bg:` keys (1) or for the canvas lane's single-composer invariant (3).
- `lane-thread.spec.ts` only joins on a hand-built equal id. There is no test with realistic stream message ids, so duplication and mislabelling (10) pass.
- No test for `expired` parent delivery or the schema/type mismatch (12).
- The store spec (`agent-monitor.store.spec.ts`) does not test the eviction order for receipts and parent delivery (14).
- No test that preview refreshes after a lane state change or after a failed `Send now` (7).

## Re-review (round 1)

Scope: current uncommitted working tree after `review-fix-frontend.md`. I re-read `lane-composer.component.ts` (all 309 lines), the store receipt and parent-delivery code, the inspector, canvas, thread, follow-up service, card header, lane-event-row and cli-matrix diffs. I did not run builds or tests. The fix report's claims about test counts and `ngc` were not re-verified. The composer spec mocks `AgentMonitorStore`, so it cannot see store-signal behaviour (see N2).

### Per-defect status

| # | Status | Evidence / residual |
| --- | --- | --- |
| 1 | FIXED | `inspector-agents-section.component.ts:199,248-251`: composer only for `cli:` rows present in the monitor, else tray steer. |
| 2 | FIXED | `lane-composer.component.ts:292-301` restores text on cancel; `:160-175` restores on later failure; text map `:88`. Caveat: N1. |
| 3 | FIXED | `canvas-lane-view.component.ts`: second `ptah-agent-continue-input` removed; the card owns the composer (`agent-card.component.ts:256`). |
| 4 | FIXED (within the accepted limit) | Queued edit, coalescing and remount recovery now live in the composer (`:242-254`, `:88`). `AgentFollowUpQueueService` is still a consumer-less service (minor dead code). |
| 5 | FIXED | `:165-172` restores text and shows a reasoned error for failed, expired and interrupted receipts. |
| 6 | FIXED | `agent-monitor.store.ts:815-826` rejects older `updatedAt`, lower rank and conflicting terminal transitions. |
| 7 | FIXED but introduces N2 | Refresh on focus (`:19,24`), menu (`:38`), retry (`:53`), rejected send (`:260,285`), and status change (`:140-145`). The status-change effect is wrong, see N2. |
| 8 | FIXED | Focus into the dialog (`:152-157`), tab trap (`:217-224`), readonly field (`:19,24`), `lossDisclosure.text` shown (`:57`), Escape returns to the menu (`:226-231`). Minor leftovers: N6. |
| 9 | PARTIAL | Hard-coded "Claude" is gone (`lane-transcript.component.ts:105`). The lane label is `agent.cli`, so rows read "codex · codex"; use `displayName`. Minor. |
| 10 | FIXED for duplication | Preview correlation, plus user bubbles suppressed (`lane-transcript.component.ts:52`). New mislabel: N3. Separate section is an accepted limit. |
| 11 | FIXED | `agent-monitor.store.ts:875` (confirmed bytes `e2 80 94` per the fix report; the source now reads "Interrupted — not sent"). |
| 12 | FIXED | `agent-monitor.ts:9` now includes `'expired'`. Distinct label at `agent-monitor.store.ts:860-865` and in `lane-thread.ts`. The `String(state) === 'expired'` casts are now redundant but harmless. |
| 13 | FIXED | `:68-75`: only `sender === 'user'` receipts (`:108`); names use the first 40 preview characters. |
| 14 | PARTIAL | Receipt and delivery maps refresh recency (`agent-monitor.store.ts:~819, ~841`). `_previews` is pruned only when a receipt map is evicted (`:826`), not when an agent leaves the store, so previews for never-messaged agents still accumulate (minor). |
| 15 | FIXED | `lane-composer.component.ts:263`. |
| 16 | FIXED | Service no longer leaves stale queued text on a refused cancel; raw reason codes are replaced with fixed copy. |
| 17 | FIXED with a regression | Cursor key hint restored (`cli-matrix-rows.ts:~288`), Ptah CLI rows get a manifest (`:~479`). New: N4. |
| 18 | FIXED | Stop is `btn-error btn-outline` (`agent-card-header.component.ts:147`), Resume is no longer `btn-square` (`:165`), failed completion gets `border-l-error` (`lane-event-row.component.html:60`). I did not re-inspect the `role="status"` reduction in `lane-thread-row.component.ts`. |

### New defects

**N1 (major). Coalescing loses the earlier queued text when the combined resend fails.**
`lane-composer.component.ts:241-262` and `:282-286`. Send cancels the first queued receipt (`:246`), then deletes its saved text (`:253`), then sends `earlier + draft` (`:256`). If that send is refused (`unsupported`, or a non-accepted receipt at `:258-261`) or throws (`:282`), the earlier text is neither in the draft (only `draftText` remains) nor in `acceptedText`. The backend already cancelled it, so it is gone.
Fix: on every failure after the cancel, prepend `earlier.text` back into the draft, or delete the saved text only after the new send is accepted.

**N2 (major). The status-change preview effect refires on every agent-list update.**
`lane-composer.component.ts:140-145`. The effect reads `this.store.agentsById()` and builds a derived string inside the effect. Angular tracks the `agentsById` signal, not the string. `_byId` (`agent-monitor.store.ts:933-938`) returns a new Map whenever `_agents` changes, which includes streamed output, usage and status updates. Each re-run calls `loadPreviews`: two RPCs and two `_previews` updates (re-rendering `composerState` consumers). With streaming lanes this is a continuous RPC flood per mounted composer. The composer spec mocks the store, so no test sees it.
Fix: use `const laneStatus = computed(() => `${stopped}:${status}`)` (primitive equality) and run the effect on that computed. Also drop the redundant initial load, since the first effect already loads.

**N3 (minor). Unmatched user-role transcript messages are labelled "You".**
`lane-thread.ts:~34`. The spawn task prompt is sent by the parent, and parent messages whose receipt was evicted also carry no receipt. Both now render as "You". Fix: label "You" only for a matched `sender: 'user'` receipt; label the rest neutrally ("Message") or "Parent agent" with no family.

**N4 (minor). Provider-backed instance rows no longer show Error / Initializing / Needs API key.**
`cli-matrix-rows.ts:~427`: `INSTANCE_STATUS` was removed and every enabled instance is `READY`. `keyStatus` still covers keys, but the `error` and `initializing` states are shown nowhere on the row. Design note 5 limits Status to install state, so keep the install-only column but show instance error or initializing as a badge or title.

**N5 (minor). User bubbles are removed from the transcript.**
`lane-transcript.component.ts:52,107`: every user message that has a thread entry is hidden in the bubble list. The thread section sits above and is unbounded, and the transcript loses its prompts in place. Any per-bubble actions on lane user messages are lost (not verified). The separate-section design is accepted; hiding in-place prompts is a side effect. Consider keeping the bubble and dropping the thread row, or bound the thread height and make it scrollable.

**N6 (minor). Focus and menu state quirks.**
`lane-composer.component.ts:137` calls `closeOverlays()` on mount, which latches `returnFocus` true. `:210-215` leaves the Send options menu open after confirm. `:153` returns early when the target is not yet rendered, leaving `returnFocus` set. Fix: reset `returnFocus` on close without a target, and close the menu in `confirmNow`.

**N7 (minor). "Edit" and "Cancel" are identical.**
`lane-composer.component.ts:69-74` both call `cancel(receipt.id)`, which restores the text to the draft. Drop one, or make Cancel discard (with the text kept until Undo).

### Preserve-list re-check

- Stop, explicit Resume, permission response, account controls, output view: PRESERVED.
- Codex Send now: PRESERVED (preview-driven, consent gate intact; `allowPartialTurnLoss` is sent only from `confirmNow`, `:214`).
- Inspector steer for SDK subagent and background rows: RESTORED.
- Canvas lane: one composer (card-owned).
- Queue draft recovery, queued edit, coalescing: RESTORED in the composer, except N1 (earlier text lost when a coalesced resend fails). Host-restart full-text recovery is an accepted limit.
- Provider instance status (Error / Initializing / Needs API key) hidden: N4 (a presentation regression, not a removed control).

### Verdict (round 1)

- Verdict: REVISE
- Score: 6/10
- Open: 0 blocking, 2 major (N1, N2), 5 new minor (N3-N7), plus residuals on 9 and 14 and the dead follow-up service.
- Basis: all three original blocking defects and the Preserve-list breaks are fixed. N1 is a data-loss path in the new coalescing, and N2 is a per-update RPC flood that the mocked specs cannot catch. Fixing those two should move this to APPROVED.

## Final check (after round 2)

Scope: uncommitted working tree after `review-fix-frontend-round2.md`. I re-read `lane-composer.component.ts` lines 79-312 in full plus the thread, transcript, store-prune, matrix and inspector diffs. I did not run builds or tests; the lane's verify result (exit 0) is taken as reported.

### Status of the round-1 items

| Item | Status | Evidence |
| --- | --- | --- |
| N1 (coalescing never loses text on failure) | FIXED for loss, but see N8 | `lane-composer.component.ts:243-257` now sends the combined text first and cancels the earlier receipt afterwards (`:274-282`). A refused or thrown send returns before any cancel, so the draft and the earlier queued message stay intact. A failed cancel is disclosed ("both messages may be delivered", `:278,280`). |
| N2 (preview refresh keyed on a computed status) | FIXED | `:105` `previewKey` is a primitive-string `computed`; the effect at `:140-147` compares it to the previous value and calls `loadPreviews` only on change. Unrelated `agentsById` updates no longer reach the RPC. Bounded cost: one extra reload when the first previews change the mode part of the key. |
| #9 (lane label) | FIXED | `lane-transcript.component.ts:103` uses `agent.displayName ?? agent.cli`; the store already normalises `displayName` with `||` (`agent-monitor.store.ts:1654,1694`), so an empty string is not a concern. |
| #14 (previews pruned with agents) | FIXED | `agent-monitor.store.ts:1879-1886` prunes `_previews` for ids that left `_agents` inside `updateAgents`, and returns the same Map when nothing is stale. |
| N3 (spawn prompt label) | FIXED | `lane-thread.ts:32` labels unmatched user-role text "Parent agent"; "You" only for a matched `sender: 'user'` receipt. |
| N4 (instance error/initializing) | FIXED | `cli-matrix-rows.ts` adds `runtimeStatus`; `ptah-cli-instances.component.ts` renders it as a text badge (`data-testid="cli-matrix-runtime-status"`). Status column keeps install state. |
| N5 (user bubbles) | FIXED | The `threadMessageIds` suppression is gone from `lane-transcript.component.ts` (`grep` finds none); only `message.role === 'assistant'` conditions remain. |
| N6 (focus and menu quirks) | FIXED | `:137` clears stale focus state on mount; `:156` clears `returnFocus` when no target and the menu is closed; `:212-217` closes the menu on confirm; `:228-232` restores focus only when the dialog was open. |
| N7 (duplicate Edit/Cancel) | FIXED | `:68-73` one Edit action with a Pencil icon and a descriptive aria-label. |

### New defect

**N8 (major). The coalescing cancel is not registered in `cancelling`, so the cancelled receipt's push restores the earlier text and shows a false failure.**
`lane-composer.component.ts:274-277` versus `:163` and `:298`. `cancel()` adds the id to `cancelling` before awaiting; the new send-then-cancel path does not. If the backend's `failed`/`cancelled-by-user` push for the earlier receipt reaches the store before the `cancelMessage` RPC resolves (the same push-before-RPC ordering this review has checked throughout), `processReceipt` (`:162-176`) finds the earlier text still in `acceptedText` and:
- appends it to the draft (it is already part of the combined message that was just accepted), and
- shows "Failed: Message was not sent." although the combined message was accepted.
Resending that draft would duplicate the text.
Fix: `LaneComposerComponent`-side `this.cancelling.add(earlierQueuedId)` before `cancelMessage` and `delete` in a `finally`; also delete `acceptedText` for the earlier id before awaiting, since its text is now carried by the combined receipt.

Minor residual (not counted): `AgentFollowUpQueueService` remains a consumer-less service.

### Preserve-list re-check

- Stop, explicit Resume, permission response, account controls, output view: PRESERVED (`agent-card-header.component.ts` diff is styling only).
- Codex Send now: PRESERVED (`allowPartialTurnLoss` sent only from `confirmNow`, `:216`).
- Inspector SDK subagent and background steer via tray: PRESERVED (`cliLaneId`).
- Canvas lane has a single, card-owned composer: PRESERVED.
- Queue draft recovery, edit and coalescing: PRESERVED, except the N8 race on the coalescing path.
- Provider instance status and capability badges: PRESERVED.

### Final verdict

- Verdict: REVISE
- Score: 7/10
- Blocking: 0. Major: 1 open (N8). Minor: 0 new.
- Basis: every round-1 and round-2 item is fixed at the cited lines. The one remaining defect is a small, local race introduced by the N1 rewrite. The fix is to register the earlier id in `cancelling` around the cancel call; with that change and no other edits I would rate this APPROVED (8/10).
