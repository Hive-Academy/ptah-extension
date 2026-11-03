# Code Logic Review — B4a (harness services)

Scope: `git diff HEAD -- libs/` plus `harness-session.controller.ts` and its spec. Read in full: controller, request service, spec of controller, records/hydration/leave/apply diffs. Old view (`harness-builder-view.component.ts` 380-610) read for caller tracing. No checks run (coordinator owns verify).

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REVISE |
| Blocking | 1 |
| Serious | 3 |
| Moderate | 5 |

## Acceptance checklist

| Item | Status | Note |
| --- | --- | --- |
| First send with no mounted transcript | OK | controller.ts:184,214; spec asserts `registerVisibleTab` not called |
| Idempotent per tab+hash | PARTIAL | tab+hash guard works (:201-203); no mode-level guard on `start` itself (S2) |
| 10 s readiness timeout -> failed + Retry | OK | :236-245, :208-209, :226-230 |
| Reconcile before Retry | PARTIAL | false positive when send throws (S3) |
| Stop `uncertain`, nothing else proceeds | OK in controller (:338-374, `leave` :129); old view does not use it (M1) |
| Record zod round trip, cleared with tab | OK | records.service `clearTab` + orphan sweep; no old data to migrate (new `session` key kind, strictObject only on new keys) |
| `revisions` ordered/folded, no user overrides | OK | hydration.service.ts:408-416 folds from `revision.configUpdates` only, independent of `config` |
| Request service no `visibleTabIds` | OK | removed |
| `navigateToBuilder` target | OK | request.service.ts:259 unchanged |
| Six restore outcomes asserted | OK | spec covers all six in one test; the `wrong-mode` via saved record (:300) is not separately hit |

Public surface of `HarnessWorkflowRequestService` is unchanged (all members listed at HEAD still exist). Only consumers are `harness-builder-view.component.ts` (entryErrors :397, reportAbortFailure :552, retryFirstSend :587) and `setup-hub.component.ts`; none is broken at compile level. Removed private state (`pendingFirstSends`, `firstSendsInFlight`) has no outside readers.

## Blocking

### B1. `activeSessionIn` counts saved-draft tabs, so the old Save-then-switch flow now fails with "conflict"
- File: harness-session.controller.ts:114-123 (used at :148-149); request.service.ts:209-225, :285-288
- Scenario: user is in the AI Team Builder, requests New Project from the hub; the pending-intent dialog is answered Save. The old view keeps the saved tab (it only resets/closes the previous draft, view:550-565) and then calls `completePendingIntent()` -> `enter('new-project')` -> `controller.start`. `activeSessionIn` iterates every tab with a `harness-*` workflow and does not exclude the draft tab the request service excludes (`findRunningTab` :233-238). It returns the saved configure tab, so `start` returns `conflict`, the hub shows "Another builder session is open", and the requested New Project never starts. The same happens whenever a draft of the other mode exists and the user starts the other mode directly (`requestAndNavigate` -> `enter`, :188).
- Impact: regression of a working flow on the old surface that must stay reachable until B5b.
- Fix: skip tabs that are the draft pointer of their mode (`records.readDraft(root, mode)?.tabId`), or only treat a tab as active if it has a running/unsaved state; add a spec for conflict with a saved draft present.

## Serious

### S1. Stale `record` signal makes failure paths target a dead tab
- File: controller.ts:63-68 (record never reset), :144-170; request.service.ts:289-294
- Scenario: a first session leaves a record in the per-mode signal (tab later discarded by the old view, which never touches the controller; or `leave(...,'discard')` :131-134 which does not clear the signal). The next `enter` fails before a tab is created (`startNewProject` fails :163, workspace changed :169). `session.record()?.tabId` is the dead tab id, so the error goes into `entryErrors[deadTab]` and the code navigates the builder to that dead tab. The user sees no hub error and lands on a broken builder.
- Fix: have `start` return the tabId in the `failed` outcome (or clear `record` at the top of `start`/after `leave`), and have the request service read it from the outcome.

### S2. `start` has no in-flight guard
- File: controller.ts:138-193
- Between the `activeSessionIn` check (:148) and `createTab` (:170) there are two awaited RPCs (:162, :166). Two concurrent `start` calls (B4b UI double-submit, hub plus another entry; the request service guard covers only its own callers) both create tabs and both send. The tab+hash `inFlight` key (:201) differs per tab and does not help. Violates the "idempotent send" intent at the session level.
- Fix: per-mode+workspace start promise, or re-run the active check right before `createTab`.

### S3. Reconcile treats an unsent bubble as accepted when the send throws
- File: controller.ts:214-219 vs :255-257
- `failedBubbles` is only populated when `sendOrQueueMessage` returns `success:false`. If it throws (the old code captured the bubble in both branches), the optimistic user bubble with identical `rawContent` remains, `reconcile` counts it as accepted (:257), sets phase `done` (:265) and Retry send never re-sends. The user sees a "done" session with no agent turn, a silent failure that looks successful.
- Fix: capture the bubble in the catch path too (move capture to before the throw/catch), or reconcile only on `ackedAt`/`claudeSessionId`/streaming status.
- Spec gap: the reconcile test (spec:134) only covers `{success:false}` followed by a session id appearing; no test for a thrown send or a real resend.

## Moderate / minor

- M1. Old view leave (view:540-551) still ignores abort failure and discards the tab. Pre-existing and covered by B5b, but note it contradicts the "uncertain: nothing else proceeds" rule on the surface that is live now; `stopUncertain`/`stopChoice` in the leave dialog have no consumer yet. Acceptable as a known gap if B5b is the owner; make sure B5b's plan lists it. The unchanged message-handler copy is not a gap by itself (generic text).
- M2. Navigation failure after a successful `start` leaves a running session with no rollback (request.service.ts:297-298; old code closed the tab and cleared records on `!landed`). A cancelled/failed navigation now leaves an invisible agent turn running. Next entry resumes it, so recoverable, but surprising.
- M3. `stop` calls `chat:abort` for any session with an id, even an idle/finished one (controller.ts:361-364). If the backend returns failure for a non-running session, `leave` returns `uncertain` for a completed session and the user can only Keep current. Not verified against `abortSession`; confirm idle abort succeeds.
- M4. `recordApply` silently no-ops if `writeSession` fails (controller.ts:96-101); `applyReceipt.appliedAt` uses strict `z.iso.datetime()` (records.service sessionSchema), which rejects offset timestamps and would make this fail silently. Surface the failure or loosen to the format the apply response uses.
- M5. `failedBubbles` entries and `phase`/`error` are never cleared on `leave`/`restore` failure outcomes (:61, :289-314); `restore` leaves a previous record in the signal when it returns `missing`/`wrong-mode`. `lastRevisionId` is in the schema but never written. Fold `ordinal` is positional so it shifts if an earlier revision arrives late.
- Minor: `firstSend` returns false on an in-flight duplicate and `start` then reports the generic "could not be sent" text (:185). Timer in `waitReady` is bounded to 10 s and needs no teardown. The effect (:103) is created once per mode in the root injector; fine. Errors shown in UI state are fixed strings, with causes only logged: no provider detail leaks (asserted in spec:152).

## Five logic questions (short)

1. Silent failure: S3 (done with no turn), M4 (apply receipt not persisted).
2. Unexpected user action: Save-then-switch (B1); double-submit (S2).
3. Wrong answer data: identical-content bubble treated as accepted (S3).
4. Dependency failure: RPC failure before tab creation (S1); abort failure handled in controller, ignored in old view (M1).
5. Missing: mode-level start guard, rollback on navigation failure, draft-aware conflict check.

## Verdict

REVISE, score 5/10. Fix B1 (regression on the live old surface) and S1-S3 and add specs: conflict with saved draft, failed-start after a stale record, thrown send then Retry. Everything else in the acceptance list is met, and records, hydration, and apply-section changes look sound.

## Re-review (round 1)

Scope: controller (read in full), request service enter/navigation diff, controller and request-service spec titles/bodies for the named tests, old view leave path (view:520-572) for the Save-then-switch trace. Nothing was run (coordinator owns verify), so test claims are read from the spec bodies, not executed.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 (new, residual) |

### Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| B1 saved draft counted as active | RESOLVED | controller.ts:135 skips `tab.id === readDraft(root, mode)?.tabId`. Old view Save path writes `replaceDraft` first (view:533) then `completePendingIntent` (view:569), so the draft pointer exists when `start` runs. Same exclusion as `findRunningTab` (request.service:233), so the two guards agree. Spec 124 seeds a configure draft and starts new-project; it asserts `started` and a single `createTab`. It does test the real path (draft written through `records.writeDraft`). |
| S1 stale record | RESOLVED | `startInternal` resets record/phase/error first (:179-181); request service reads `session.record()?.tabId` only after that reset (:288), so a pre-tab failure goes to the hub. Restore clears on missing/wrong-mode (:339-357). Spec 158 covers it. |
| S2 no in-flight guard | RESOLVED | per-workspace `starts` map (:161-170). Lock is released in `finally`, so a throwing start does not deadlock. Ordering is right: the owner registers its `await task` before any waiter, so its `finally` deletes the key before the first waiter resumes, and that waiter re-registers synchronously (no await before `starts.set`); later waiters see it. Recheck re-runs `activeSessionIn` and hits the `reused` branch. Specs 132 and 146 assert one `createTab`/one send for same-mode and cross-mode. |
| S3 thrown send read as accepted | RESOLVED | catch captures the new user bubble whenever `before` is set (:261-266), covering both `success:false` and a throw; reconcile excludes it (:297); Retry removes it and resends (:322-327). Spec 199 throws from `send`, asserts `failed`, then `retrySend` true, two sends, bubble removed, map empty. |
| M2 navigation rollback | RESOLVED | request.service:297-303 discards a `started` session via `leave`; `uncertain` surfaces a hub error and keeps the tab. Specs at 89 and 95 assert both. |
| M3 abort of finished session | RESOLVED (with caveat below) | controller.ts:402-408. Specs 247/255 assert no abort for a loaded tab and abort still sent for streaming. |
| M4 receipt write failure / offset timestamp | RESOLVED | :97-111 plus records schema `offset: true`; spec 276. |
| M5 failedBubbles lifecycle | RESOLVED | cleared on tab close (effect :117-120), discard (:150), restore (:340-357), success (:299). Spec 213. `lastRevisionId` unused and positional fold ordinal remain, both harmless. |
| M1 old-view leave / stopUncertain consumer | Deferred to B5b by decision, not counted. |

### Regression scrutiny

- Start lock: no deadlock on a throw inside the try (it returns `failed`). Residual: code before the `try` in `startInternal` (:182-198, for example a throwing `readSession`) would reject the owner and every waiter's `await pending` (:164), so waiters get a rejection instead of an outcome and do not retry. Unlikely but cheap to guard (`await pending.catch(() => undefined)`). Moderate.
- "Loaded = finished": a `streaming` or `resuming` tab is never treated as stopped (:403-404 gate on `!running`). Fresh/draft tabs with an ack but no session id still return `uncertain` (:411). Residual: tab status `loaded` can coexist with background agents still running (the awaiting-background case) and `applyStatusErrorReset` forces `loaded`; the abort is then skipped and Discard closes the tab. Matches how the rest of the host reads busy, so acceptable, but note it. Moderate.
- Navigation-failure discard: also fires when the user cancels the pending-intent navigation (outcome `cancelled`), discarding a just-started session (:297). Only for `started`, never `reused`, so no user work is lost, and the reverse is a hidden running turn. Acceptable; moderate to confirm in the B4b UX.
- Same-mode active tab with no saved session record falls through to creating a second tab (:188-198). Only reachable for a tab created outside the controller; the old view no longer creates any. Minor.
- A `failed` outcome that returns a real tab (first-send failure, different brief) routes the error to that tab and navigates there (:287-291), which is what the old Retry UI expects.
- End to end old surface: Save-then-switch (view:533 -> :569 -> `enter` -> `start`) now proceeds; cross-mode with a running non-draft tab still reports conflict (spec 117) and the request service's own pending-intent guard still comes first; same-mode re-entry reuses with no second send.

### Verdict

APPROVE, 8/10. No blocking or serious issues. Keep the three moderates for B4b/B5b. Confidence MEDIUM-HIGH because the specs were read, not run.
