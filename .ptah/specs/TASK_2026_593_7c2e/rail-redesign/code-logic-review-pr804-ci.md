# Code Logic Review — `TASK_2026_593_7c2e` PR #804 CI product fix

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 6/10             |
| Assessment          | NEEDS_REVISION   |
| Blocking issues     | 0                |
| Serious issues      | 1                |
| Moderate issues     | 1                |
| Failure modes found | 2                |

**Review family: grok. Implementer family: Ollama Cloud (Glm model glm-5.3:cloud).**

Score 6, not 7: the CI wipe is closed, and a failed confirmed reload plus Retry now leaves the editor read-only under a stale error banner. Score 6, not 5: same-sha and different-sha dirty applies keep the buffer and the loaded `sha256`, confirmed Reload still mounts, and `readSeq` / `destroyed` still run before the new branch.

## Decisions

1. The Retry trap is a defect in this change.
   - Options: (a) intended — Retry is background, so a dirty buffer ignores a successful read; (b) defect — a fresh read must not leave `status: 'error'` in place while `modified` stays true.
   - Evidence: `canEdit` is false unless `status === 'fresh'` (`spot-editor.component.ts:431-439`). The error banner and Retry stay up (`:301-314`). `retry()` always calls `reload()` (`:638-640`). The new guard returns before `file.set` (`:804-812`). Before this diff, that `reload()` still executed `file.set` and `mountDocument` while `modified` was true, so Retry finished the discarded view.
   - Reversible: yes. One branch in `reload`.

2. An older in-flight read clearing a newer `stale` mark is a defect, and it is not data loss.
   - Options: (a) ignore, because the host conflict check still runs; (b) record it as moderate.
   - Evidence: the new branch writes `stale` from the read that started earlier (`:809-810`). `notifyDiskChange` can set `stale` again during that await (`:601-603`). The host refuses a stale `expectedSha256` and leaves the file unchanged (`libs/backend/rpc-handlers/src/lib/handlers/file-edit-rpc.handlers.spec.ts:254-267`).
   - Reversible: yes.

3. The post-save baseline revert is pre-existing and out of this verdict.
   - `reload` captured `current` before the await and still `file.set`s that result on the clean path (`:794-819`). A save that finishes during the await can update `file()` to a new sha (`:746-767`); the late read can write the old snapshot back and return on `result.sha256 === current.sha256` without remounting. That order existed before this diff (`file.set` already sat above the `unchanged` return). The next edit sends the old hash and the host answers `conflict` (same spec, `:254-267`). Not charged against this fix.

## Root cause

Agreed, with the limit already in `pr804-ci-fix.md`. The pre-fix condition was `fresh && sha256 equal && !this.modified()` and then `mountDocument` (diff of `reload`). A same-sha read that resolved after typing failed that condition and replaced the buffer. This change deletes the `!this.modified()` term (`:819`) and refuses a background apply while `modified()` or `saving()` (`:804-812`). Which watcher push started the CI read is still not proven from the trace. The apply-time hole is in the source either way.

## Five logic questions

### 1. How does this fail silently?

Retry after a failed `reload(true)` looks like another failed read. The RPC result can be `fresh` and the guard drops it (`spot-editor.component.ts:804-812`), so the banner at `:301-314` stays. No error is thrown.

A second `file:content-changed` sets `stale` (`:601-603`). The older read then executes `stale.set(false)` when its sha matches the baseline (`:809-810`). The banner disappears. Save still sends the original `expectedSha256` (`:739`).

### 2. What user action produces unexpected behaviour?

Edit the file, confirm Discard and reload or the conflict dialog's Reload, and have that `file:viewContent` come back non-fresh. The editor goes read-only, the unsaved badge remains, and Retry does not restore the document. Back still asks before leaving (`goBack` at `:621-626`).

### 3. What input data produces a wrong answer?

A `fresh` view whose `sha256` equals the sha captured at the start of `reload`, applied after a later push already set `stale`. The flag becomes false even though the later push said the disk changed (`:809-810`).

A `fresh` view after a non-fresh `reload(true)` is ignored while `modified` is still true, so `file().status` stays `'error'` (`:804-812`, `:814-818`).

### 4. What happens when a dependency fails?

`FileViewReaderService.read` turns a failed RPC into `status: 'error'` and copies the previous `sha256` (`file-view-reader.service.ts:81-90`, `:117-124`). `reload` still clears `stale` and `saveError` and `file.set`s that error when the dirty guard does not run (`spot-editor.component.ts:814-818`). `mountDocument` is skipped. `modified` is unchanged because `load` / `setModified(false)` lives in `mountDocument` (`:894-898`, `codemirror-setup.ts:227-232`).

`destroyed` or a newer `readSeq` still returns at `:803` and again inside `mountDocument` (`:891-893`). A thrown `file:saveContent` is logged and becomes the fixed save message (`:743-755`). A conflict response still sets `stale` and opens the dialog (`:770-774`).

### 5. What is missing that the requirements never mentioned?

The fix names Retry as a background caller and does not say what Retry should do when `modified` is still true because a confirmed reload never mounted. That combination is the serious finding.

No test holds a read across `saving()`, a non-fresh result, conflict Reload, destroy, or a second push. Those branches were reviewed from source. Jest was not re-run (parent owns the check slot).

## Failure modes

### Confirmed reload fails, then Retry cannot apply a good read

- Trigger: `reload(true)` from Discard and reload (`:673`) or conflict Reload (`:711`) gets `status !== 'fresh'`. The user then clicks Retry (`:311`).
- Symptom: the read-error banner stays, the editor is read-only, the unsaved badge stays, Save stays disabled. A later successful read does not change the document.
- Evidence: non-fresh `reload(true)` skips the dirty guard, runs `stale.set(false)` and `file.set(result)`, and returns before `mountDocument` (`:814-818`). `modified` stays true. `canEdit` requires `status === 'fresh'` (`:431-439`), so `editable` is false and `canSave` is false (`:442-451`). `retry()` calls `reload()` with `discardEdits` false (`:638-640`). The guard sees `modified()` and returns without `file.set` (`:804-812`). The stale banner, which is the remaining `reload(true)` entry (`:630-635`, `:673`), was cleared at `:814`.
- Current handling: background guard treats this Retry as a dirty race and drops the fresh result.
- Recommendation: a `fresh` result must not leave a previous `'error'` / `'blocked'` status in place. Keep the buffer and the loaded `sha256` (do not `mountDocument`, do not adopt the new sha). Clear the error banner so `canEdit` can become true. On a non-fresh `reload(true)`, leave `stale` as it was so Discard and reload is still on screen. Add a unit test that fails the confirmed read, resolves Retry with a new sha, and asserts the banner, the buffer, and `expectedSha256`.

### Older read clears a newer stale mark

- Trigger: `reload()` is in flight from a clean editor (`:605`). The user types. Another `notifyDiskChange` for this file sets `stale` (`:601-603`) and does not start a second read. The first read resolves `fresh` with the baseline sha.
- Symptom: the stale banner never appears (or disappears). The buffer and dirty flag stay. The next save still sends the loaded hash.
- Evidence: `:809-810` assigns `stale` from `current` captured at `:794`, not from pushes that landed during the await. Host behaviour contains the write (`file-edit-rpc.handlers.spec.ts:254-267`).
- Current handling: last writer is the older read.
- Recommendation: on the dirty return, set `stale` true when the sha differs, and leave a `true` mark alone when the sha matches. Do not force `false` over a mark set while the read was in flight.

## Blocking issues

None.

## Serious issues

### Retry is a no-op after a failed confirmed reload while edits are still marked

- File: `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts:638-640`, `:673`, `:711`, `:804-818`, `:431-439`, `:301-314`
- Scenario: confirmed Reload's read returns `error` or `blocked`. `modified` is still true because `mountDocument` did not run. Retry's read returns `fresh`.
- Impact: the user cannot edit or save, and the banner still says the file could not be opened. The successful read was dropped. Back is the remaining exit (`:621-626`).
- Fix: see the first failure mode. Do not adopt the new sha while the dirty buffer stays.

## Moderate and minor issues

### Same-sha dirty apply clears stale set by a later push

- File: `spot-editor.component.ts:601-603` and `:809-810`
- Scenario and impact: failure mode 2. The host conflict check blocks a silent overwrite. The user loses the early banner only.

Minor: the new tests never call `reload(true)` on the conflict dialog's secondary button with a held read. The immediate test at `spot-editor.component.spec.ts:569-588` still passes if that call omitted `true`, because the user is already dirty when an immediate read returns, which is the pre-fix mount path. The source at `:711` does pass `true`.

## Data flow

1. `notifyDiskChange` (`:592-606`) — OK at push time. Dirty or saving sets `stale` and does not read. Clean calls `reload()`.
2. `reloadFromBanner` (`:630-635`) — OK. Dirty asks; the confirm path is `reload(true)` (`:673`). Clean calls `reload()`.
3. `retry` (`:638-644`) — gap. Has a document: `reload()` with the default. No document: `open()`, which clears `modified` itself (`:868-872`).
4. `onDialogSecondary` (`:707-711`) — OK for a fresh read. `kind === 'conflict'` then `reload(true)`.
5. `reload` captures `file()`, cursor, and `++readSeq` (`:793-797`) — OK. Callers cannot interleave until the await.
6. `reader.read` (`file-view-reader.service.ts:61-92`) — OK. Failures return `error` and keep the previous sha.
7. `destroyed` / `seq` (`spot-editor.component.ts:803`) — OK. Checked before any write.
8. Dirty and not `discardEdits` (`:804-812`) — OK for the CI case (buffer, dirty flag, baseline sha preserved; different sha sets `stale`). Gap: drops a `fresh` result that should clear an existing error status; same sha forces `stale` false.
9. Clean / `discardEdits` (`:814-820`) — `stale` and `saveError` clear, then `file.set`, before status is known. Non-fresh returns with the buffer untouched. Same sha and not `discardEdits` returns without `mountDocument`, so undo history stays (no `load`). `discardEdits` mounts even when the sha matches.
10. `mountDocument` (`:887-901`) — OK. Re-reads `readSeq` after `ensureEditor()`. `notifyDiskChange` requires `hasDocument` (`:594-596`), and `hasDocument` is set only after the editor promise exists (`:901`), so that await is a resolved promise (microtask). A keystroke cannot run there.
11. `save` (`:714-780`) — OK alongside an in-flight background reload that started first: `reload` has already bumped `readSeq`, `save` records that value, the dirty guard does not bump it again, and a successful save still applies. A reload that starts after `save` captured `readSeq` still drops the save result at `:747` (pre-existing). `notifyDiskChange` will not start that reload while `saving()` is true (`:601-603`).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Apply-time guard keeps edits and baseline when dirty or saving | COMPLETE | Dirty return does not `file.set` (`:804-812`). `saving()` is included. |
| Same-sha background read does not mount (undo kept) | COMPLETE | `:819` returns before `mountDocument`. |
| Clean reload still remounts a new sha | COMPLETE | Guard skipped; `:820` mounts. Spec `:965-973`. |
| Confirmed Discard and reload replaces a dirty buffer | COMPLETE for a fresh read | `:673` passes `true`. Spec `:976-991`. Non-fresh read does not replace and clears `stale`. |
| Conflict Reload replaces a dirty buffer | COMPLETE for a fresh read | `:711` passes `true`. Spec `:569-588` (immediate RPC). |
| `readSeq` and destroy guards | COMPLETE | `:803`, `:891-893`. Unchanged and still before the new branch. |
| Errors | PARTIAL | Dirty + failed read leaves the previous mark (`:809-811`). Confirmed reload + failed read, then a good Retry, sticks on the error banner. |
| No new public API | COMPLETE | Optional argument on `protected reload`. Call sites in this file only. |

Implicit requirements not addressed: restoring a usable editor after Retry when `modified` is still true and `status` is `error`.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Same sha, user typed during the read | YES | `:804-812` returns, no mount | Later `stale` mark cleared if this read matches the baseline |
| Different sha, user typed during the read | YES | `stale` true, no `file.set` | Next save sends the old hash (spec `:958-962`) |
| `saving()` true at apply | YES | Same branch | Save that already finished is the pre-existing clean-path case |
| Clean, new sha | YES | `mountDocument` | |
| `discardEdits`, same or new sha | YES | Mounts | |
| Non-fresh `reload(true)` | NO | `file.set` error, `modified` stays, `stale` cleared | Retry cannot finish |
| Second push during the read | NO | Older read can clear `stale` | Host conflict still refuses the write |
| Superseded read / destroy | YES | `:803` | |
| `retry` with no document | YES | `open()` | |

## Checks and limitations

- No Jest, typecheck, lint, build, serve, or e2e. The parent owns the check slot. Lane claims of 51 passing tests were not re-run.
- `ptah_*` tools are not connected. `search_tool` for `ptah` returned no tools. Evidence is `git diff` of the two spot-editor files, reads of `reload` and its callers, `FileViewReaderService.read`, `canEdit`, the error / stale template, `codemirror-setup.ts` `load` / `markSaved`, the new spec block, the conflict and stale-banner specs, and the host conflict spec cited above.
- No `code-style-review` for this diff was in the task folder. Style is not scored here.
- CI artifacts from run 39533059655 were not re-opened. The root-cause agreement is from the current diff plus `pr804-ci-fix.md`.
- Electron, TUI, and VS Code hosts were not executed. The change is inside `@ptah-extension/git-ui` and adds no RPC field.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on the two findings (both are straight-line from the cited branches). MEDIUM on the original CI trigger identity.
- Top risk: a failed confirmed reload plus Retry leaves the spot editor read-only on an error that the successful read did not clear.
- What a robust implementation would add: the status repair in the first failure mode, a one-way `stale` set in the dirty branch, and unit tests for non-fresh `reload(true)` followed by Retry, `saving()` true at apply, and a second `notifyDiskChange` during a same-sha read.
