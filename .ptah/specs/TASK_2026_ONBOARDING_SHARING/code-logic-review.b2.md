# Code Logic Review B2 (frontend attachments)

Review family: claude (reviewer) vs codex (implementer)

Score: 6.5/10. Verdict: REVISE. No blocking defects; chat-input parity holds. Three serious/moderate defects need fixing before accept.

## Parity (chat-input) - OK
Paste, drop, `file:pick`, `file:pick-images`, 5 MB and media-type checks, 4 s error timer, suggestion add with dedupe, per-tab draft restore, send payload, clear-after-send guarded by `isSubmittedDraft`, and compact-store `hasContent` (chat-input.component.ts:869, 1001) all match `main`. Intentional changes: picker and read failures now show an error (main only logged); `remove(id)` matches both files and images; `clear()` also resets the error. None of these loses a capability.

## Defects

1. SERIOUS - root provider in production code. `composer-attachments.service.ts:11` has `providedIn: 'root'` although every owner lists it in `providers` (chat-input.component.ts:162, answer-dock:23, intake:40, team-builder:28). Any component that injects it without a providing ancestor gets one app-wide singleton that is never destroyed. That singleton leaks attachments (base64 images) across tabs and pages and is shared between chat and onboarding. Fix: remove `providedIn: 'root'` and add `providers: [ComposerAttachmentsService]` in the direct-instantiation specs.

2. MODERATE - clear-after-send wipes attachments added during the await. `toSendOptions()` is a snapshot, but `attachments.clear()` runs after the await (answer-dock.component.ts:244-248; intake.page.ts:308-310; team-builder-start.page.ts:149-151). Anything the user attached during `sending` or `starting` is deleted without being sent. Fix: snapshot ids/paths before the call and remove only those on success, as chat-input does with `isSubmittedDraft`.

3. MODERATE - attachments silently dropped when the session is reused. In `harness-session.controller.ts:290-291`, when `reconcile()` is true (the first message was already accepted) the start returns `reused`. `lastStartCreated` stays false, so nothing is cleared or sent. The user navigates away and the attachments are lost, with no message. The text-only hash also means the same brief with different attachments always lands here. Fix: on `reused` with non-empty attachments, either send them through `session.send` or set `actionError` ("Attachments were not sent; session already started").

4. MODERATE - `onDrop` always calls `preventDefault`/`stopPropagation` (composer-attachments.service.ts:46-52). Combined with the `(dragover)="$event.preventDefault()"` on the onboarding textareas, dragging plain text or non-image files into the brief becomes a no-op with no feedback. Fix: handle the event only when `dataTransfer.files.length > 0`, and show the unsupported-format error for non-image files.

5. MODERATE - behaviour change in the controller start path (harness-session.controller.ts:290-294). Previously a same-hash saved session with an unaccepted first send returned `reused`. It now auto-retries the send inside `start`. It is covered by a spec and plausibly intended, but not stated in the plan; confirm against C1/C2. It also returns `failed` where it used to return `reused`.

6. MINOR - FileReader race. A read still pending when the user clicks Send is silently omitted, then appears in the tray after the clear and looks unsent (service.ts:59-84). Fix: track a `pendingReads` signal and disable send, or await it, in the onboarding inputs.

7. MINOR - accessibility and hint. The "Attachments are not saved if you leave this page" hint is not linked via `aria-describedby`. It also appears in the answer dock, which does not navigate. The drop zone has no role or label. Send stays disabled with attachments only (answer-dock:65,146), which is consistent with the harness needing text but has no hint; chat-input differs by defaulting to "What is in this image?".

8. MINOR - `reader.onerror` console.warn (service.ts:81) lacks a degradation-audit marker. The error is shown, so add a `reported` marker. Catches at lines 109 and 143 are marked correctly.

## Harness pass-through - OK except item 3
Attachments go only through `firstSend`, `retrySend` and `send` (controller.ts:353, 399, 532, 598). They are not persisted, and the spec asserts the record has no `attachments`. The intake hash is text-only. A failed send keeps attachments (`lastStartCreated` is false). Success clears them. Cleanup: the error timer is cleared in `ngOnDestroy`, and `destroyRef` guards the page code.

## Tests
New specs assert real behaviour (payload, no persistence, retry, failed reply keeps attachments). Missing: reused-session attachments (item 3), attachments added during send (item 2), text drag (item 4).

## Re-review round 1

Score: 8/10. Verdict: REVISE (one moderate regression; everything else accepted).

### Original defects
1. Root provider - FIXED. composer-attachments.service.ts:10 is plain `@Injectable()`; chat-input.component.ts:162, answer-dock, intake and team-builder list it in `providers`. The three chat-input specs now add it explicitly (command-center-lock, component, streaming-fold); assertions are unchanged, only providers added.
2. Clear wipes later attachments - FIXED. `snapshotForSend()` + `removeSent()` removes by object identity (service.ts `removeSent`); used in answer-dock, intake and team-builder. `pendingAttachments` is reset on success and overwritten on resubmit; the conflict `resolve()` path removes the snapshot too.
3. Reused session drops attachments - FIXED. controller.ts ~L290 returns `failed` with an actionable message when attachments are present on a reconciled session. The page shows the error and keeps the attachments.
4. onDrop swallows non-image drops - PARTIAL. It now calls preventDefault only when the drop contains an image, but see R1 below.
5. Controller retry change - FIXED (documented as a decision; spec covers concurrent retries).
6. Pending reads - FIXED. `pendingReads` is decremented in `onload` (finally), `onerror` and the synchronous catch. Send is gated in chat-input (canSend, L1003, L1628), the answer dock (both buttons plus the method), intake and team-builder. No deadlock path; `abort` is never called.
7. a11y - FIXED. The hint ids are unique: `dock-attachment-hint` vs `dock-sheet-attachment-hint`, `project-` and `team-`. The tray drop zone has role=group and a label. The hint is still worded "not saved if you leave this page" in the dock (cosmetic).
8. Audit marker - FIXED (inline marker; the lane reports degradation-audit green).

### Regressions
R1. MODERATE - non-image file drop is no longer default-prevented (service.ts onDrop, ~L48-53). main's chat-input always called preventDefault/stopPropagation. Now a dropped PDF or other non-image file shows the error but the browser default runs. The textareas and the tray zone all have `(dragover)=preventDefault`, so the drop is accepted and, in Electron, the renderer can navigate to `file://...` and lose the whole session/page. Also chat-input's handleDrop (L1203) no longer stops propagation for those drops. Fix: preventDefault + stopPropagation whenever `dataTransfer.files.length > 0` (still let pure-text drops through). Add a spec for a non-image drop asserting `defaultPrevented`.
R2. MINOR - a chat-input drop of a non-image file now shows an error where main silently ignored it. Intentional per the fix report; acceptable.

### Checked and OK
- Provider scope: every chat-input host gets its own instance. The chat-view and conversation consumers do not inject the service, so nothing relied on a root instance. Mobile and desktop docks each get their own hint id.
- chat-input send: `toSendOptions()` is taken before the await, and `clear()` stays guarded by `isSubmittedDraft`, so parity with main holds. Failed chat sends still clear, as on main.
- Reused sessions, text/image/other drops: see above.
- The two transcript specs (chat-transcript.change-set / display) are not in this diff, and the reported 5 s timeouts are plausibly load-related. Not a B2 defect, but CI is the gate.
