# Code Logic Review — fix round 1 — `TASK_2026_871_0d04`

## Verdict

**REVISE — 6/10.** Findings 1, 2, 3, and 5 are fixed on the paths the original review named. A recognized document or `task.md` that is already a symlink, a junction, or larger than 1 MiB is no longer read with `readFile`, and a rejected `tasks:get` for B no longer leaves A's detail on screen. The score stays out of the sound 7–8 band because the overview that `getDetail` returns still lists the folder with an unbounded, unchecked `readDirectory` whose failures look like an empty folder, and a failed open's error banner survives the next successful open. It stays out of the 3–4 band because those two blocking reads and the stale-detail bug are closed without a race.

No catalogue skill was loaded. This review is the role procedure, and no assigned skill covers it. No pending handoff record for this deliverable was found. Tests, builds, and `ptah_get_diagnostics` were not run (memory limit in the assignment). The fix report's Jest runs are not treated as evidence. Line citations are from the current sources.

## Original findings

| # | Severity | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Blocking | Resolved | `readArtifact` delegates to `readFolderMarkdown` (`task-index.service.ts:387-391`). A non-file `lstat` (symlink or junction) returns `rejected` before any read (`:420-422`). Size above 1 MiB returns `too_large` without calling the reader (`:423`); a short `lstat` that grows past the bound is discarded because `read.truncated` is also `too_large` (`:425-426`). NUL bytes and invalid UTF-8 return `binary` (`:427-429`). Missing stays `null`. Every other state is logged and thrown (`:390-391`), and `tasks:getArtifact` still returns `{ file, content }` on success (`tasks-rpc.handlers.ts:693`, `rpc-tasks.types.ts:79-89`) or the existing sanitized error (`tasks-rpc.handlers.ts:695-698`). The reader maps that failure to `status: 'error'` (`task-folder.store.ts:253-255`). |
| 2 | Blocking | Resolved | `getDetail` reads `task.md` through the same helper (`task-index.service.ts:347-351`). `CARRIER_FILE` is `task.md`, which passes the markdown-name check (`:416`). Missing is still `null` (`:348`). Link, oversize, binary, and unreadable states are logged and thrown (`:349-351`), not returned as a missing task. `tasks:get` still returns `{ task }` (`tasks-rpc.handlers.ts:660`, `rpc-tasks.types.ts:58-60`). `containedTask` refuses a non-directory segment, so a symlinked `.ptah`, `specs`, or task folder fails closed (`task-index.service.ts:403-409`). |
| 3 | Serious | Resolved | `loadTaskDetail` clears `_taskDetail` and calls `folder.selectTask` before the await (`tasks-store.service.ts:1263-1268`). `selectTask` drops the previous reader (`task-folder.store.ts:181-184`). A thrown `tasks:get` is caught in `openTask` and stored as an error (`tasks-store.service.ts:1242-1248`). A `{ success: false }` result takes the same error path after the clear (`:1279-1280`). A late response is dropped when `detailReqSeq` has moved (`:1275`), including after `closeTask` (`:1292`). The header and body both key off `detail()` / `loading()` (`task-detail.component.ts:156-191`), so A's body cannot paint under B. |
| 4 | Serious | Partial | A swap that is still in place when the second `realpath` runs is rejected (`task-index.service.ts:455-459`), which is what `task-index.service.spec.ts:771-781` stubs. The check is not identity: it compares `ctime` and `mtime` (`:457-458`). Creating or replacing a child during `readDirectory` updates the directory mtime, so a normal write while the folder is open becomes `rejected` ("only folders inside the task folder are listed", `task-folder-files.component.ts:70-71`). `too_many` returns before that check (`task-index.service.ts:454`), so a swapped directory with more than 200 names is classified as too many and the names were already materialized. A swap that is undone before the second `lstat` still returns the foreign names. `readDirectory` on Electron and CLI has no count limit (`electron-file-system-provider.ts:54-64`, `cli-file-system-provider.ts:55-66`). |
| 5 | Minor | Resolved | `versionToken` keeps a token only when it is not a bare `YYYY.M.D` and the text before it does not end in `build` (`cli-version-label.ts:16-30`). Traced against the probe lines: `codex-cli 0.155.1` → `v0.155.1`; `2.1.0 (Claude Code)` → `v2.1.0`; `cursor 2025.11.06-8fe8a63` → `v2025.11.06-8fe8a63` (the hash suffix fails `DATE_TOKEN`); `opencode v2.0.12` → `v2.0.12`; `GitHub Copilot CLI 1.0.83.` → `v1.0.83` (the sentence dot is outside the token); `build 2026.11.03` and `2026.11.03` stay unprefixed. The same expectations are in `cli-version-label.spec.ts:9-19`. `VERSION_TOKEN` is not global, so `exec` is not stateful. |

## New findings

### Blocking

None.

### Serious

1. **The overview list is still an unbounded, silent directory read** — `libs/backend/task-specs/src/lib/task-index.service.ts:346`, `:357`, `:661-666`.
   - Scenario: `getDetail` now reads the carrier through `readFolderMarkdown`, then calls `listEntries(folderDir)` on `path.join(root, '.ptah', 'specs', folderName)`. `listEntries` calls `readDirectory` with no `lstat`, no canonical check, no 200-name cap, and no second stat. The `catch` has no log and returns `[]`.
   - What the user sees: a junction swapped in after the carrier check contributes that directory's names to `artifacts` and `entries` on a successful `tasks:get`. A directory read that fails (permissions, the path disappearing) produces a normal task whose file list is empty.
   - Fix: list the canonical directory from `containedTask` with the same post-check as `listFolderEntries`, cap the names, and log and fail the detail when the listing fails instead of returning `[]`.

2. **Containment for a document is checked, then the file is opened by path** — `libs/backend/task-specs/src/lib/task-index.service.ts:418-425`; `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:95-113` (CLI copy at `cli-file-system-provider.ts:97-115`).
   - Scenario: `readFolderMarkdown` `lstat`s the target, rejects a non-regular file, and checks `realpath` is inside the task. It then calls `readFileBoundedNoFollow`. That helper `lstat`s again, refuses a symlink, opens with `O_NOFOLLOW`, and checks the opened inode against its own `lstat`. It never receives the task directory. If the task directory is replaced with a junction after the service's `realpath` and before the helper's `lstat`, the helper opens `<junction>/<file>` and, when that path is a stable regular file, returns its bytes as `ready`.
   - What the user sees: `context.md` or `task.md` renders the same-named file from the junction target. A file-level symlink swap is closed; this window is the parent directory.
   - Fix: open the validated directory and read the child relative to that handle (`openat` / `FILE_FLAG_OPEN_REPARSE_POINT` on the directory). Discard the bytes unless the handle's parent is still the directory that was checked.

3. **A newer task can keep, or gain, the previous request's error** — `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1246-1248`, `:1276-1280`, `:2153-2156`, `:2312-2319`.
   - Scenario: `openTask` and the `isSuccess() === false` branch set `_error` and never clear it on a later success. `loadBoard` is the clear (`:1196`), not a successful `tasks:get`. Separately, `reconcileAfterBulk` and `applyMetadata` catch a rejected `loadTaskDetail` with no `detailReqSeq` check. `loadTaskDetail` bumps the sequence and clears detail before the await, so the user can open B while A's refresh is in flight. A's throw then writes `The change was saved, but the board could not be reloaded…` onto B, including after B has already loaded.
   - What the user sees: B's detail is correct, and the alert still describes A's transport failure or a refresh of A. Retry reloads the whole board.
   - Fix: clear `_error` at the start of the request that still owns `detailReqSeq`, and in those two refresh catches set the refresh message only when that call's sequence is still current.

### Minor

4. **The new listing post-check uses timestamps and skips itself for large directories** — `libs/backend/task-specs/src/lib/task-index.service.ts:453-458`.
   - Scenario: a child create during `readDirectory` changes directory `mtime`, so the user's own task folder is `rejected`. A swapped directory with 201 or more entries returns `too_many` with no second `realpath`, after every name was allocated.
   - Fix: compare device and inode, or hold the directory handle. Apply that check to the `too_many` result as well. Keep the 200-name cap, and stop `readDirectory` early only if a bounded listing is added to the port.

5. **The filesystem cause is dropped before the new log line** — `libs/backend/task-specs/src/lib/task-index.service.ts:430-433`, `:349-351`, `:390-391`.
   - Scenario: `readFolderMarkdown` turns `EACCES` and every non-`ENOENT` exception into the word `unreadable` and does not log the `Error`. `getDetail` / `readArtifact` log that word and throw `new Error('Task … read failed: unreadable')`. `sanitize` logs the wrapper (`tasks-rpc.handlers.ts:1472-1478`), so the original code and path never reach the logger.
   - Fix: log the caught value with `logger.warn` / `logger.error` inside `readFolderMarkdown` before mapping it to a state. Keep the client message generic.

6. **A conflict enrichment read now reports a write failure** — `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:1001-1019`, `:1311-1316`; `libs/backend/task-specs/src/lib/task-index.service.ts:349-365`.
   - Scenario: `readCurrentStatus` is documented to return `{}` when the carrier cannot be read. `getDetail` used to return `null` on a bad read. It now throws for `rejected`, `too_large`, `binary`, and `unreadable`. `applyBulkStatus` awaits that read while building a `TASK_CONFLICT` entry. The throw is caught by the outer `catch` and replaced with `WRITE_FAILED`. `applyBulkLabel` (`:1157-1237`) has the same shift: an unreadable carrier used to be handed to the writer and now becomes `WRITE_FAILED` without a write.
   - What the user sees: a status conflict, or a label update of a carrier the safe reader refuses, is reported as a failed write.
   - Fix: catch inside `readCurrentStatus` and return `{}`. In `applyBulkLabel`, map a refused carrier read to a non-write result that is not `WRITE_FAILED`.

## Five logic questions

1. **How does this fail silently?** `listEntries` catches every directory error and returns `[]` (`task-index.service.ts:665-666`), so `tasks:get` succeeds with no files. `readFolderMarkdown` drops the filesystem error on the way to `unreadable` (`:430-433`). A successful later `openTask` does not clear `_error` (`:1276-1278`), so the banner keeps describing a failure that is no longer the one on screen.
2. **What user action produces unexpected behavior?** Open A, let `tasks:get` throw, then open B successfully: B's detail is B's, and the alert still says A failed (`tasks-store.service.ts:1248`, `:1276-1278`). Save metadata or finish a bulk edit while switching from A to B: the refresh `catch` can attach A's reload failure to B (`:2155-2156`, `:2318-2319`). Browse a task folder while a file is created in it: the listing can come back refused (`:457-458`, `task-folder-files.component.ts:70-71`).
3. **What input produces a wrong answer?** A task directory replaced by a junction after the carrier check and before `listEntries` supplies outside names on a successful detail (`:357`, `:663`). The same replacement after `realpath` and before `readFileBoundedNoFollow` supplies outside bytes for that file name (`:424-425`, `electron-file-system-provider.ts:97-113`). `build 2026.11.03` and `2026.11.03` do not become version labels (`cli-version-label.ts:24-29`).
4. **What happens when a dependency fails?** A thrown `tasks:get` clears detail, ends loading, and sets the store error when the sequence is current (`tasks-store.service.ts:1242-1248`, `:1268`, `:1282-1283`). `tasks:getArtifact` failures become a document error, not `content: null` (`task-folder.store.ts:253-267`). A bulk conflict's follow-up read throws and is reported as `WRITE_FAILED` (`tasks-rpc.handlers.ts:1005-1019`).
5. **What is missing that the requirements never spelled out as a handle?** The file port can `lstat` and open `O_NOFOLLOW` by path. It cannot read relative to a directory handle the service already validated, which is what makes both the listing recheck and the document read lose to a swap that does not stay in place (`file-system-provider.interface.ts:69-74`).

## Probe lines

| Input | Result | Where |
| --- | --- | --- |
| `codex-cli 0.155.1` | `v0.155.1` | token `0.155.1`, prefix is not `build` |
| `2.1.0 (Claude Code)` | `v2.1.0` | match at `^`, `(?!\w)` at the space |
| `cursor 2025.11.06-8fe8a63` | `v2025.11.06-8fe8a63` | suffix fails `DATE_TOKEN` |
| `opencode v2.0.12` | `v2.0.12` | `v` is outside the capture |
| `GitHub Copilot CLI 1.0.83.` | `v1.0.83` | trailing dot is not part of the token |
| `build 2026.11.03` | `build 2026.11.03` | date token and a `build` prefix |
| `2026.11.03` | `2026.11.03` | `DATE_TOKEN` |

## Review family

- Reviewer: grok
- Implementers: codex (backend), claude (frontend)

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the sanitized `tasks:get` / `tasks:getArtifact` errors as compatible. | Keep `{ task }` and `{ file, content: string \| null }` and throw; add typed states on those responses. | Success shapes are unchanged (`rpc-tasks.types.ts:58-60`, `:79-89`). `sanitize` already replaces unexpected errors with a fixed sentence (`tasks-rpc.handlers.ts:1472-1478`). The assignment requires that compatibility. Distinct `binary` / `too_large` copy remains on `tasks:readFolderMarkdown` only. | Yes |
| Mark finding 4 Partial rather than Open. | Open until a directory handle exists; Partial because a persistent swap is rejected. | The second `realpath` plus the spec at `task-index.service.spec.ts:771-781` matches the recheck the original fix allowed. Timestamps, the early `too_many` return, and swap-back keep it from Resolved. | Yes |
| Do not re-run Jest or diagnostics. | Run the scoped specs; review from the sources only. | The assignment forbids tests and builds under the memory limit. Adapter behavior was read, not executed. | Yes |

## Residual uncertainty

`readRoundJudge` still uses `exists` and `readFile` (`task-index.service.ts:492-494`). It was not part of this diff. Hard links are regular files to `lstat` and are not covered by the symlink checks. `O_NOFOLLOW` was confirmed in both adapters' source and was not executed on Windows. No `code-style-review.md` was present, so nothing was deduplicated against a style review.
