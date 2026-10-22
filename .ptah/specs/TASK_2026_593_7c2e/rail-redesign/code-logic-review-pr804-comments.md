# Code Logic Review — `TASK_2026_593_7c2e` PR804 CodeRabbit comments

## Summary

| Metric              | Value        |
| ------------------- | ------------ |
| Overall score       | 8/10         |
| Assessment          | APPROVED     |
| Blocking issues     | 0            |
| Serious issues      | 0            |
| Moderate issues     | 0            |
| Failure modes found | 0            |

Independent logic review of the two spot-editor reload races against commit `7ce426499`. Implementer family: Ollama Cloud (Glm). Reviewer family: grok. Production file read in full: `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`. Supporting code read: `codemirror-setup.ts` (`text`, `markSaved`, `updateListener`), `file-view-reader.service.ts` (`baseState` / `mapResult`). Tests read for the race describe, save/conflict/stale-banner coverage, and the `type` / `holdNextRead` helpers in `spot-editor.component.spec.ts`. Fix report read: `pr804-review-comments-fix.md`. No `code-style-review.md` in the task folder. No source edits.

`ptah_*` tools are not registered in this session (`search_tool` for `ptah` and `agent_report` returned no tools). Symbol and text search used native Grep after that empty result.

Score 8, not 9: a read dropped because a completed save replaced the captured hash (`spot-editor.component.ts:844`) does not raise `stale` when that read already observed different bytes. The editor stays clean until the next save. That is an explicit trade-off, not a buffer wipe or a wrong `expectedSha256`. Score is not 5–6: both CodeRabbit interleavings are closed before `file.set` / `mountDocument`, and the new tests hold the RPC and assert buffer plus hash rather than stubbing the apply function.

## Review family

| Role | Family | Notes |
| --- | --- | --- |
| Implementer | Ollama Cloud (Glm) | Report states both comments were confirmed on the pre-fix source and fixed only in the two spot-editor files |
| Reviewer | grok | This document. Did not re-run Jest, typecheck, or lint (orchestrator runs validation) |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the post-save silent-stale window as accepted, not a revision | (a) Approve the early return with no stale mark. (b) Require `stale` whenever the dropped result hash differs from the post-save hash | (b) marks the common case too: the held read still carries pre-save `SHA_A` while the live baseline is `SHA_B` (`spot-editor.component.ts:844` compares against the captured hash, and `SHA_A !== SHA_B`). That is a false "changed on disk" after a successful save. (a) matches the tested contract at `spot-editor.component.spec.ts:1211` and still sends the saved hash on the next save (`:1192-1194`). Host conflict handling is unchanged (`save` at `:770-774`) | Yes. One condition before the `return` at `:844` |
| Do not reopen the in-flight save that loses to `readSeq` | (a) Leave it. (b) File it as a new defect of these guards | `save` clears `saving` then returns when `readSeq` moved (`:746-747`) without `markSaved`. `reload` has always bumped `readSeq` before the await (`:806`). `notifyDiskChange` does not start a reload while `saving()` (`:601-604`). The new guards do not add this drop. The fix report already bounds it | Not part of this diff |

## Five logic questions

### 1. How does this fail silently?

No new success-looking data loss on the two reported races.

- Confirmed discard, then typing, then a fresh read: `discardText` is taken synchronously before the await (`:803-806`). Apply demotes `discardEdits` when the buffer text changed (`:813-823`) and the existing dirty-keep branch returns before `mountDocument` (`:824-838`). The loaded hash is not replaced. A failure that looked like a successful discard (buffer replaced, dirty cleared, save enabled against disk bytes the user never accepted) no longer happens for a fresh result.
- Read captured at hash H0, save completes with H1, then the read applies: `save` writes `{ ...current, content, sha256: result.sha256 }` and `markSaved` (`:763-765`). Apply hits `this.file()?.sha256 !== current.sha256` (`:844`) and returns before `this.file.set(result)` (`:847`) and before the same-sha short-circuit (`:850`). The old silent failure was a clean buffer whose file signal had been put back to H0, so the next save sent `expectedSha256: H0` against H1 on disk. That assignment no longer runs.

Residual, accepted: if the dropped read's bytes are neither the captured baseline nor the saved hash, `:844` returns with `stale` left false (`save` already cleared it at `:766`). The editor looks clean. The next save still presents `expectedSha256` of the saved hash, and a host conflict still opens the existing dialog (`:770-774`). This is a missed warning, not a reverted baseline. See Decisions.

### 2. What user action produces unexpected behaviour?

Traced actions that stay on the previous contract:

- Banner Reload → Discard and reload, with no further typing. `onDialogConfirmed` calls `reload(true)` (`:672-673`). Text at apply equals `discardText`, so the demotion does not run. Dirty-keep is skipped because `discardEdits` stays true. Disk bytes mount (`:851`). Same call for the conflict dialog's Reload (`:711`).
- Typing after confirm, then undo back to the confirmed text before the read lands. Content equality keeps the discard (`codemirror-setup.ts:250` and `:218-221`). The spec drives a real CodeMirror `dispatch` and `undo` (`spot-editor.component.spec.ts:206-214`, `:1104-1108`).
- Typing after confirm, then a failed read, then Retry. Demotion requires `result.status === 'fresh'` (`:815`), so the error status is still stored and the editor goes read-only through `canEdit` (`:431-439`, template `:301-315`). Retry calls `reload()` with no discard (`:638-640`). The buffer is dirty, so dirty-keep restores `status: 'fresh'` without adopting disk bytes (`:834-836`). A failed read keeps the previous hash (`file-view-reader.service.ts:117-125`), so the following save still sends that hash.
- Background reload while clean, then edits before the read returns. `discardEdits` is false, so Fix 1 does not run. Dirty-keep keeps the buffer and sets `stale` only when the result hash differs (`:830`). A second push during that read only sets `stale` (`:601-603`) and the older same-hash result does not clear it, because the clear is after the keep return (`:845`).

No user action in this diff produces a new wrong buffer or a new false conflict dialog.

### 3. What input data produces a wrong answer?

- Same disk bytes as the captured read, after a completed save: result hash equals the captured hash, live hash does not. The read is dropped (`:844`). Next save uses the hash `save` stored. Covered by `expectedSha256: SHA_B` at `spot-editor.component.spec.ts:1192-1194`.
- Newer disk bytes than both the capture and the save: same return, buffer unchanged (`spec:1198-1211`). The test does not send a second save. The hash cannot diverge from the sibling test unless `:844` stopped returning; it returns before any `file.set`.
- Post-confirmation text that undoes to the CodeMirror baseline (cleaner than the confirmed snapshot) while a discard read is in flight: demotion runs (`text !== discardText`) but `modified()` is false (`codemirror-setup.ts:253-258` pattern via the update listener). Dirty-keep does not run. The confirmed reload still mounts disk. That matches the confirmation: the unsaved net is gone and the user already asked for disk. Not a lost post-confirmation insert.
- `discardText === null` only when `discardEdits` and there is no handle (`:805`). There is no buffer to protect. A handle whose text is `''` is a real snapshot (`??` does not replace `''`).

`markSaved` compares against the saved string, not the buffer (`codemirror-setup.ts:253-258`). A save during a discard read cannot make the buffer look unchanged unless the user actually restored that text.

### 4. What happens when a dependency fails?

- `file:viewContent` fails or returns `not-found` during a confirmed reload: `FileViewReaderService.mapResult` keeps the previous hash and content on non-blocked errors (`file-view-reader.service.ts:155-172`). Apply does not demote, does not mount (`:849`), and stores the error state. Retry is the recovery above. Blocked reasons clear signal content (`:162`) and hide the editor (`editorVisible`, component `:482-488`). That blocked path is unchanged and is not what comment 4350386543 describes; post-confirmation demotion correctly does not run for a non-fresh result, so a blocked confirmed reload still reports the block.
- `file:saveContent` throws or returns no data: hash is not updated (`:743-761`), so Fix 2 does not drop the in-flight read. A conflict result sets `stale` and does not change the hash (`:770-774`), so a read still in flight is not treated as "baseline replaced".
- Save RPC succeeds, then `readSeq` no longer matches: the success is ignored (`:747`) and the hash stays at the capture. Fix 2 does not invent a new baseline. Pre-existing; not introduced by `:844`.
- A later `reload` or `open` bumps `readSeq` (`:806`, `:900`). The older apply returns at `:812` before either new guard. Destroy does the same.

### 5. What is missing that the requirements never mentioned?

- The echo `file:content-changed` after save is not delivered in the unit tests (`holdNextRead` never pushes). Production relies on that push when a dropped read saw newer bytes. The component's own push path refuses to start a reload while `modified()` or `saving()` (`:601-604`), and a successful save clears `stale` (`:766`). A push that arrives only during the save, plus a dropped read that already saw the newer bytes, leaves no second read. The next save is the conflict surface. The fix report states this limit. It is not a hole in comment 4350386562's hash requirement.
- No Electron pass. The diff does not change the template.

## Failure modes

No new failure mode that loses post-confirmation edits or rewrites a saved baseline.

Scope checked, all handled as cited above:

- Discard confirmation, edits during `reader.read`, fresh disk bytes (4350386543).
- Those edits undone back to the confirmed text.
- Those edits plus a failed read and Retry.
- Background read held across a completed save, result still the old bytes (4350386562).
- That read answering with a third hash.
- Prior dirty-keep, explicit discard with no extra typing, failed confirmed reload, and same-hash read versus a newer push.

Residual uncertainty: Jest was not re-run here. The implementer reports `58 passed` for this spec and a red/green check with the guards removed. This review judged the assertions and the apply order, not a fresh runner log. Host enforcement of `expectedSha256` is outside the diff; the client still sends the live `file().sha256` (`:739`) and still treats `reason === 'conflict'` as a dialog (`:770-774`).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None filed. The silent-stale window at `spot-editor.component.ts:844` is the accepted decision above, not an open defect: marking it would false-alarm the common pre-save result (`SHA_A` against a live `SHA_B`).

## Data flow

1. `onDialogConfirmed` / `onDialogSecondary` → `reload(true)` (`:673`, `:711`). OK.
2. `reload` reads `this.file()` as `current` and, for a discard, `handle.text()` as `discardText` (`:800-805`). OK. Capture is before the first await, so a keystroke cannot land between confirm and the snapshot.
3. `readSeq` increments (`:806`). An in-flight `save` that captured the previous seq will drop its result (`:747`). Pre-existing. OK for this change.
4. `reader.read` (`:807-810`). Failure preserves hash (`file-view-reader.service.ts:117-125`). OK.
5. Stale seq or destroy → return (`:812`). OK.
6. Fresh result and buffer text ≠ `discardText` → `discardEdits = false` (`:813-823`). OK. Non-fresh keeps the discard so the error banner still shows.
7. `(modified \|\| saving) && !discardEdits` → keep buffer, maybe `stale`, maybe repair `status` (`:824-838`). OK. Runs before the hash check, so post-save typing is not dropped by Fix 2.
8. Live hash ≠ captured hash → return (`:844`). OK for the saved baseline. Does not set `stale`. Accepted.
9. Otherwise clear `stale` / `saveError`, `file.set(result)` (`:845-847`). OK.
10. Non-fresh → return, no mount (`:849`). OK.
11. Background read with the same hash → return, undo history kept (`:850`). OK.
12. `mountDocument` (`:851`, `:918-932`). OK. Only the confirmed unchanged buffer, or a clean reload, reaches it.

Save path: guard (`:717-720`) → RPC with `expectedSha256: current.sha256` (`:739`) → on success replace hash and `markSaved` (`:763-765`). `markSaved` does not change text unless the user typed during the RPC (`codemirror-setup.ts:253-258`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 4350386543: edits typed after confirmed `reload(true)` are not mounted over | COMPLETE | Demotion plus dirty-keep. Spec holds the read, types, then releases (`spec:1062-1090`) and checks `expectedSha256: SHA_A` |
| 4350386562: a read started before a completed save must not restore the old baseline; the next save uses the saved hash | COMPLETE | Early return at `:844`. Spec checks the second save sends `SHA_B` (`spec:1168-1195`) |
| Explicit discard with no post-confirmation edit still replaces the buffer | COMPLETE | Unchanged fall-through. Spec `:976-991` |
| Undo back to the confirmed text still discards | COMPLETE | Spec `:1093-1112` |
| Failed confirmed reload stays read-only; Retry keeps the buffer and the original hash, including post-confirmation edits | COMPLETE | Spec `:994-1038` and `:1115-1165` |
| Dirty background reload keeps buffer, dirty flag, and loaded hash; same-hash result does not clear a newer stale mark | COMPLETE | Spec `:924-963` and `:1041-1059`. Fix 2 is not on that path |
| Tests use a real in-flight read, not a stubbed apply | COMPLETE | `holdNextRead` replaces `file:viewContent` with a promise released after `type` / `clickSave` (`spec:906-921`). `type` dispatches into the live `EditorView` (`:206-214`), which runs `onModifiedChange` synchronously (`codemirror-setup.ts:218-221`) |
| No new data loss or false conflict from these guards | COMPLETE | See questions 1–3. Missed stale is not a false conflict |

Implicit requirements not addressed: none required for these two comments. The echo-push gap is documented and does not revert the saved hash.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty buffer at confirm | YES | `''` is kept as `discardText` | None |
| No editor handle | YES | `discardText` null skips demotion | Nothing to keep |
| Undo of the post-confirmation insert only | YES | Text matches snapshot; discard stands | None |
| Undo past the snapshot to the CodeMirror baseline | YES | Mounts disk because the buffer is clean | Matches the confirmed discard |
| Save completes during the held read, result is old bytes | YES | `:844` | None for the hash |
| Save completes, result is a third hash | YES | Same return; buffer kept | No stale banner until next save |
| Save completes, then the user types before apply | YES | Dirty-keep returns first (`:824`) | Baseline stays the saved hash |
| Failed read after post-confirmation edits | YES | No demotion; no mount; Retry repairs status | Editor is read-only until Retry, as before |
| Conflict `reason` during the read | YES | Hash unchanged, so Fix 2 does not drop the read | None |
| Second reload / open | YES | `readSeq` mismatch at `:812` | None |
| Save already in flight when discard reload starts | YES (pre-existing) | Success dropped at `:747` | Not introduced here. Report left it out of scope |
| `notifyDiskChange` while saving | YES | Sets `stale` only (`:601-603`) | Does not start the 4350386562 race by itself |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: a dropped read that saw bytes other than the saved file leaves the editor clean until the next save (`spot-editor.component.ts:844`).
- What a robust implementation would add: nothing required for these comments. A later change could set `stale` only when a fresh dropped result's hash differs from the post-save hash and a follow-up read is not already queued; that false-alarms the common pre-save result unless the echo push is guaranteed to clear it.

## Limitations of this review

- Jest, typecheck, and lint were not run. The orchestrator owns that check. The "58 passed" figure is the implementer's report, not a command this review executed.
- `ptah_agent_report` is not registered here, so delivery depends on the final message if the report call cannot be made.
- Electron UI was not exercised. No template or style change.
