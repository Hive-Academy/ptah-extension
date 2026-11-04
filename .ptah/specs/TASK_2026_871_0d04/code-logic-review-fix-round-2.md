# Code Logic Review — fix round 2 — `TASK_2026_871_0d04`

## Verdict

**APPROVED WITH FIXES — 8/10.** The partial listing check, the overview's silent empty list, the document read race that stays swapped, and the sticky detail error are closed. A swap that is restored before the second `realpath` is an accepted limitation, and it is a reasonable bound for this Electron app. One new minor remains: a board reload can leave the detail-error marker pointing at a message it no longer owns. That keeps the score out of the 9–10 band. It stays out of the 5–6 band because no blocking or serious hole from round 1 is still open in the code this round was allowed to change.

No catalogue skill was loaded. This review is the role procedure. Tests, builds, and diagnostics were not run. The fix reports' Jest results are not treated as evidence. `code-style-review.md` is still absent.

## Status

| Item | Status | Evidence |
| --- | --- | --- |
| Original 4 (listing swap) | Accepted-limitation | After `readDirectory`, the code requires the path to still be a directory with the same canonical path, and only then applies the 200-name cap (`task-index.service.ts:475-480`). Timestamps are no longer compared, so a child write during the list stays `ready` (spec asserts this at `task-index.service.spec.ts:785`). A swapped directory that is still swapped, including one with 201 names, is `rejected` rather than `too_many` (`:806` in that spec, logic at `task-index.service.ts:478-480`). `FileStat` has no `dev` or `ino` (`platform.types.ts:41-46`), and `readDirectory` still materializes every name. A swap restored before the second `realpath` is still invisible. That remainder is the same bound as New Serious 2. |
| New Serious 1 (detail listing) | Resolved | `listEntries` is gone. `getDetail` lists through `listFolderEntries(root, folderName, '')` and throws when the state is not `ready`, after a warn (`task-index.service.ts:356-360`). A failed enumeration is logged with the original `Error` (`:485-486`) and becomes `unreadable`, not `[]`. A swap still in place fails the detail (`task-index.service.spec.ts:835`). Success is still `{ task }` plus `artifacts` and `entries`. |
| New Serious 2 (document bytes) | Accepted-limitation | The bounded read still cannot open relative to a held directory. After it returns, `readFolderMarkdown` resolves the folder and the file again, requires both paths unchanged and the folder still a directory, and drops the bytes otherwise (`task-index.service.ts:430-438`). A post-check failure is `rejected` (`:439-443`). The spec covers a parent or file path that changes during the read (`task-index.service.spec.ts:850`). A swap restored before those `realpath` calls still returns the bytes. See the judgment below. |
| New Serious 3 (sticky error) | Resolved | `loadTaskDetail` clears a detail-owned error as soon as it takes the sequence (`tasks-store.service.ts:1286-1289`, `:1270-1277`). Thrown and unsuccessful `tasks:get` results go through `setDetailError` (`:1256`, `:1311`). `reconcileAfterBulk` ignores a detail refresh whose sequence moved (`:2184-2191`). `applyMetadata` does the same for the detail refresh, and still records a board-reload failure (`:2349-2362`). A later successful open clears A's detail error (`tasks-store.service.spec.ts` "clears task A's detail error once task B's detail loads") and does not clear a different board error ("keeps a board error raised after a detail error"). A's refresh rejection after B is open stays silent ("stays silent when task A's detail refresh fails after task B was opened"). |
| Minor 4 (mtime and `too_many` order) | Resolved | Same lines as original 4: identity is type plus canonical path (`task-index.service.ts:476-479`); `too_many` is decided only after that check (`:480`). The port still cannot stop `readDirectory` early. That limit is documented and is not a wrong result. |
| Minor 5 (filesystem cause dropped) | Resolved | The document-read `catch` logs the caught value with `logger.error` before mapping it, and skips `ENOENT` and the two containment messages (`task-index.service.ts:452-454`). The listing `catch` does the same (`:485-486`). |
| Minor 6 (conflict reported as `WRITE_FAILED`) | Open | Unchanged. `readCurrentStatus` still calls `getDetail` with no catch (`tasks-rpc.handlers.ts:1315`), and `applyBulkStatus` still turns that throw into `WRITE_FAILED` (`:1005-1019`). Round 2 left `libs/backend/rpc-handlers` out of scope. This is deferred, not accepted as correct. |

## Accepted limitation (New Serious 2)

The bound is reasonable for this app, and it should not block the round.

The process is the user's Electron shell reading that user's workspace. A planted symlink or junction is rejected without a race: `lstat` refuses a non-regular file (`task-index.service.ts:424-426`), `containedTask` refuses a non-directory segment (`:409-410`), and `readFileBoundedNoFollow` opens with `O_NOFOLLOW` and checks the opened inode (`electron-file-system-provider.ts:97-113`). The remaining case is a directory replaced for the duration of the read and put back before the second `realpath`. The caller who can do that already has the user's filesystem rights and can read the other file directly. Node's `fs` API, and this port (`file-system-provider.interface.ts:69-74`), expose no `openat` against a held directory fd. Adding one was out of scope. Discarding the bytes when the path is still wrong after the read closes the swap that stays swapped, which is the case a malicious folder can set up in advance. The same residual applies to listing (original 4). It is not a sandbox escape against another user.

## New findings

### Blocking

None.

### Serious

None.

### Minor

1. **A board write can inherit the detail-error marker** — `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1204`, `:2469`, `:2490`, `:1270-1277`.
   - Scenario: a detail load stores message M in both `_error` and `detailErrorMessage`. `loadBoard` sets `_error` to `null` (`:1204`) and does not clear the marker. The board request then stores its own message (`:2490`). `clearDetailError` treats `_error() === detailErrorMessage` as "this banner is still the detail failure." When the board message is the same string as M, the next `loadTaskDetail` removes the board banner. `fetchBoard`'s success path (`:2469`) has the same split: the signal is cleared and the marker is left behind until a later detail load.
   - What the user sees: a board failure whose text matches an earlier detail failure disappears when the next task opens. Different strings, which is what the new spec uses, stay put.
   - Fix: clear `detailErrorMessage` in every non-detail write to `_error` (`loadBoard`, `fetchBoard`, the board-reload branches at `:2177` and `:2359`), or replace the string compare with a token those writers do not reuse.

## Five logic questions

1. **How does this fail silently?** A directory or file swapped out and restored before the second `realpath` is returned as a normal listing or document (`task-index.service.ts:475-481`, `:433-447`). That is the accepted limitation, not a new swallow. `getDetail` no longer turns a listing failure into an empty file list (`:356-360`).
2. **What user action produces unexpected behavior?** Open a task after a board reload whose error text equals the previous detail error: the banner can clear (`tasks-store.service.ts:1204`, `:1270-1277`). Opening B after A's detail failed, with different messages, clears only A's message.
3. **What input produces a wrong answer?** None on the non-race paths. `build 2026.11.03` was already fixed in round 1 and was not part of this diff.
4. **What happens when a dependency fails?** A document or listing exception is logged and mapped to `unreadable` or `rejected` (`task-index.service.ts:449-455`, `:482-488`). A thrown `tasks:get` still becomes a detail error only while its sequence is current (`tasks-store.service.ts:1254-1256`, `:2188-2191`).
5. **What is still unspecified?** The bulk-label and conflict-enrichment callers of `getDetail` (`tasks-rpc.handlers.ts:1001-1019`, `:1315`). A throw there is still `WRITE_FAILED`.

## Review family

- Reviewer: grok
- Implementers: codex (backend), claude (frontend)

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept the post-read path check in place of `openat`. | Demand a directory-handle port; accept the documented residual. | Port has no `openat` (`file-system-provider.interface.ts:69-74`). `FileStat` has no inode (`platform.types.ts:41-46`). Persistent swaps are rejected (`task-index.service.ts:436-438`, `:478-479`). The principal is the local user. | Yes |
| Leave Minor 6 Open rather than Accepted-limitation. | Treat scope exclusion as acceptance; keep it open. | The behavior is unchanged and the round-2 report calls it deferred, not correct (`fix-round-2-backend-report.md`). | Yes |
| Call the marker desync Minor, not Serious. | Serious, because it can hide a board error; Minor, because it needs equal strings. | Detail transport failures are wrapped (`tasks-store.service.ts:1256`). The new spec uses different strings and those stay. Collision is the hole. | Yes |

## Residual uncertainty

`readRoundJudge` is still `exists` plus `readFile` (`task-index.service.ts:517-518`). That method was not in this diff. Hard links still look like regular files. The new specs were read, not executed. Adapter `O_NOFOLLOW` behavior was not re-run.
