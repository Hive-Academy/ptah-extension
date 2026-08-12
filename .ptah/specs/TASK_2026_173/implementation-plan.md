# Implementation Plan — TASK_2026_173

**Title**: Editor panel — git-diff correctness, measured performance, and hunk-level stage/revert
**Phase**: Architecture / solution design
**Status of inputs**: `task-description.md` is **provisional** (Checkpoint 1 bypassed). See `## Requirements Concerns` — four requirements are wrong or under-specified against the tree as it actually stands, and one sequencing constraint should be reversed.

---

## 0. Executive verdict

The correctness group (A) is real and the evidence holds. The design turns on one decision: **replace the two-RPC, string-keyed, frozen-snapshot diff mechanism with a single backend-authoritative `git:diffFile` RPC and a structured diff-tab record.** Everything in A1–A4 falls out of that one change, which is why this plan recommends merging A1+A2+A3+A4 into a single unit of work rather than the four SEQ-3 prescribes (this is _stricter_ than SEQ-1, not a violation).

D2 (hunk stage/revert) is designed so that **git generates the patch and git consumes the patch** — the frontend never constructs diff text and the modified pane never becomes writable. That is the only design that can satisfy D2 AC9 (byte-identical to CLI git) and AC11 (no accidental edits) simultaneously, and it makes AC6 (stale-snapshot refusal) a server-side comparison rather than a client-side promise.

Three findings surfaced during investigation that are **not** in `context.md`:

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** | `CodeEditorComponent` is destroyed every time a diff tab is activated — the exact teardown TASK_2026_154 removed. The diff view sits in an `@if`/`@else if`/`@else` chain whose final `@else` branch **is** the code editor. So B1's blast radius is twice what the finding says: opening a diff throws away the Monaco model/view-state cache for _every_ open workspace. | `editor-panel.component.ts:254` (`@if activeDiffTab()`) … `:264` (`@else if isActiveFileImage()`) … `:275-287` (`@else` → `<ptah-code-editor>`) |
| **N2** | `execGit` decodes stdout chunk-by-chunk with `Buffer.toString()` and never closes stdin. Chunk-boundary decoding corrupts multi-byte UTF-8 (relevant to A3's non-UTF8 triage and to any byte-fidelity claim), and no stdin means `git apply -` (D2) cannot be invoked at all today.                                                                                        | `exec-git.ts:43` (`stdio: ['pipe','pipe','pipe']`, stdin never `.end()`ed), `:62-64` (`stdout += data.toString()`)                              |
| **N3** | The `porcelain=v2` type-2 (rename/copy) parser discards the original path — it slices only the pre-tab segment. A2 AC6 (staged rename diffs against the correct pre-rename source) is therefore unimplementable without extending `GitFileStatus`.                                                                                                                         | `git-info.service.ts:988-1010`; `GitFileStatus` in `rpc-git.types.ts:6-15` has no `origPath`                                                    |

---

## 1. Codebase investigation summary

### 1.1 What the git capability actually looks like today (contradicts NFR-5's premise)

| Layer         | File                                                                                                                                                                                     | Runtime reach                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Git execution | `libs/backend/vscode-core/src/services/git-info.service.ts`                                                                                                                              | **Platform-agnostic** — `cross-spawn` + `path` only, zero `vscode` imports                                   |
| Git RPC       | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts`                                                                                                                         | Shared lib; manifest entry `{ key: 'git', requires: [] }` (`manifest.ts:154-158`) → **every host serves it** |
| Registration  | VS Code `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:56`; Electron `apps/ptah-electron/src/di/phase-4-handlers.ts:102`; CLI `libs/backend/cli-engine/src/lib/container.ts:274` | All three                                                                                                    |
| Electron-only | `apps/ptah-electron/src/services/git-watcher.service.ts`                                                                                                                                 | Electron only — this is the _only_ Electron-exclusive git code                                               |

**Consequence**: adding a method to `GitInfoService` + `GitRpcHandlers` automatically serves VS Code, Electron and CLI. Creating a `platform-core` git port would produce three identical copies of Node `execGit` code and is architecture theatre. NFR-5's _intent_ (all three runtimes get the capability, no branch inside one adapter) is satisfied by the existing structure. See `## Requirements Concerns` #1.

Where a genuine platform port **is** needed — reading the worktree file bytes for the modified side of a diff — `IFileSystemProvider.readFileBytes()` already exists (`platform-core/src/interfaces/file-system-provider.interface.ts:28`) and is registered in all three hosts under `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`. No new port.

### 1.2 What the RPC dual-registration rule actually gates here

`ALLOWED_METHOD_PREFIXES` already contains `'git:'` (`rpc-handler.ts:70`). The real CI gates for a new `git:*` method are:

1. **Compile-time**: entry in `RpcMethodRegistry` **and** in the `RPC_METHOD_PRESENCE` map that backs `RPC_METHOD_NAMES` (`libs/shared/src/lib/types/rpc.types.ts:1253-1267`, `:2771-2779`, `:2959`). Missing the presence entry is a compile error (`_MissingRpcMethodNames`).
2. **Manifest**: add to `GitRpcHandlers.METHODS` (`git-rpc.handlers.ts:80-97`). `rpc-allowlist.spec.ts:43` asserts `RPC_HANDLER_MANIFEST` partitions `RPC_METHOD_NAMES` _exactly_ — a method in the registry but absent from a `METHODS` tuple **fails CI**.

So the historical silent-crash mode does not apply to `git:` methods; the manifest partition assertion catches it at test time. This is a strictly better guard and should be stated in the task's verification checklist instead of the generic NFR-4 text. See `## Requirements Concerns` #2.

### 1.3 Diff tab state today

`EditorTab` (`editor-tab.types.ts:2-13`) carries `filePath` (the tab key), `content`, `isDiff?`, `originalContent?`, `diffRelativePath?`. `openDiff` (`editor-diff-split.ts:23-96`) keys on `diff:${relativePath}`, early-returns on hit (`:29-36`), makes two parallel RPCs (`git:showFile` + `editor:openFile`, `:42-52`), and hard-fails if `editor:openFile` fails (`:54-62`).

**Persistence reality check**: `EditorService._workspaceEditorState` (`editor.service.ts:43-46`) is a plain in-memory `Map`. `grep` across `libs` + `apps` finds **no writer of editor `openTabs` to disk** — `layout-rpc.handlers.ts` persists pane widths only. Diff tabs therefore do not survive a process restart today and there is no on-disk format to migrate. R-2's mitigation ("test the upgrade path with pre-existing persisted state", "clear the diff-tab portion of persisted state on first run") describes work that does not exist. See `## Requirements Concerns` #3.

### 1.4 The `CodeEditorComponent` reference pattern (B1's source)

`code-editor.component.ts` — verified mechanism, all five parts portable:

| Mechanism                                                                    | Location                       | Ports to diff?                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Always-mounted host, `[class.invisible]` for hiding                          | `:92-96`                       | **Yes** — and is the fix for N1 too                                                                                  |
| Editor created once in `afterNextRender` after `loader.load()`               | `:236-254`, `:294-340`         | Yes                                                                                                                  |
| Per-key model cache, instance-namespaced URIs, LRU cap                       | `:182`, `:209-211`, `:421-448` | Yes, but **pairs** of models, lower cap                                                                              |
| `saveViewState`/`restoreViewState` per key                                   | `:450-458`                     | Yes — `IStandaloneDiffEditor.saveViewState()` returns `IDiffEditorViewState` covering both sides + collapsed regions |
| `pushEditOperations` for external updates, guarded by `applyingExternalEdit` | `:399-411`, `:465-475`         | Yes for content; the guard is **unnecessary** because the diff stays `readOnly`                                      |
| Monaco API held as `this.monacoApi` from the loader                          | `:178`, `:297`                 | Yes — directly satisfies B2 AC4                                                                                      |

Where the diff case **differs**: two models per key (not one); permanently `readOnly` (see §6.1); models must be _evicted on tab close_ rather than LRU-retained (B1 AC5), which the code editor deliberately does not do.

---

## 2. Component 1 — Diff tab identity and revalidation (A1 + A2, SEQ-1)

### 2.1 What identifies a diff tab

**Decision**: keep `EditorTab.filePath` as the single tab-key space (it is the key for `openTabs`, `activeFilePath`, `closeTab`, `switchTab`, workspace cache, and the `@for` track expression at `editor-panel.component.ts:205` — changing the key _type_ would touch every one). Make the diff key structured, and add a typed descriptor so **nothing parses the key string**.

```
key format:  diff:<comparison>:<relativePath>
examples:    diff:staged:libs/frontend/editor/src/lib/diff-view/diff-view.component.ts
             diff:worktree:libs/frontend/editor/src/lib/diff-view/diff-view.component.ts
```

Collision-safe: real file tabs are keyed by _absolute_ paths (`editor-file-ops.ts:41-92`, `openDiff` callers pass `wsRoot + '/' + relativePath`), and `diff:` is already the established sentinel.

**New tab shape** (direct replacement — `isDiff`, `originalContent`, `diffRelativePath` are deleted, not deprecated):

```ts
// services/editor/editor-tab.types.ts
export type DiffComparison = 'staged' | 'worktree';

/** What a diff side actually resolved to. Drives labels and D2's operation set. */
export type DiffSideRef = { kind: 'commit'; sha: string } | { kind: 'index' } | { kind: 'worktree' } | { kind: 'absent' }; // path does not exist at this side

export type DiffTabStatus = 'fresh' | 'refreshing' | 'stale' | 'error';

export interface DiffTabState {
  comparison: DiffComparison;
  /** Workspace-relative path, modified side. */
  path: string;
  /** Workspace-relative path, original side. Differs for staged renames (A2 AC6). */
  originalPath: string;
  original: string;
  modified: string;
  originalRef: DiffSideRef;
  modifiedRef: DiffSideRef;
  /** Backend-issued digest of exactly the bytes this diff was built from. D2 AC6. */
  snapshotToken: string;
  /** true when either side is binary — suppresses hunk actions (D2 AC10). */
  isBinary: boolean;
  status: DiffTabStatus;
  /** Sanitized, user-facing. Never raw stderr (A3 AC4, NFR-8). */
  errorMessage?: string;
  /** Stale-response protection, mirrors loadFileTree's requestId pattern. */
  requestId: number;
}

export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string; // = diff.modified for diff tabs; unchanged role
  isDirty: boolean;
  diff?: DiffTabState; // presence is the discriminant; `isDiff` is gone
}
```

`content` stays the modified side so `switchTab`/`closeTab`'s `activeFileContent.set(tab.content)` (`editor-tabs.ts:85`, `:69`) keep working unmodified.

**Tab label** (A2 AC4 — unambiguous without hover): `foo.ts (staged)` / `foo.ts (working tree)`; deleted → `foo.ts (deleted, staged)`; untracked → `foo.ts (new)`. Derived once at creation from `comparison` + the two refs.

**Migration** (R-2): none required — see §1.3. The only cross-boundary carrier is the in-memory `workspaceEditorState` map, which is written and read by the same process build. If a future change adds persistence, R-2's "drop unrecognized entries, no toast, no crash" rule applies then. The effort R-2 budgets should be reallocated to R-3 triage.

### 2.2 The two comparisons (A2)

| UI row             | Comparison | Original side                  | Modified side                                          |
| ------------------ | ---------- | ------------------------------ | ------------------------------------------------------ |
| **Staged Changes** | `staged`   | `git show HEAD:<originalPath>` | `git show :<path>` (index)                             |
| **Changes**        | `worktree` | `git show :<path>` (index)     | worktree bytes via `IFileSystemProvider.readFileBytes` |

`HEAD ↔ worktree` is **dropped entirely**. It corresponds to no row in the UI, is the source of A2's defect, and its only remaining consumer would be a hypothetical "compare with HEAD" file-tree action that does not exist (`sidebar.component.ts:118` forwards `diffRequested` from the source-control panel only; the file tree emits no diff event).

Side resolution per git status:

| Status               | comparison | originalRef                      | modifiedRef      |
| -------------------- | ---------- | -------------------------------- | ---------------- |
| `M` unstaged         | worktree   | `index`                          | `worktree`       |
| `M` staged           | staged     | `commit(HEAD)`                   | `index`          |
| `??` untracked       | worktree   | **`absent`**                     | `worktree`       |
| `A` staged           | staged     | **`absent`**                     | `index`          |
| `D` unstaged         | worktree   | `index`                          | **`absent`**     |
| `D` staged           | staged     | `commit(HEAD)`                   | **`absent`**     |
| `R` staged           | staged     | `commit(HEAD)` @ `origPath`      | `index` @ `path` |
| repo with no commits | staged     | **`absent`** (HEAD unresolvable) | `index`          |

A4 falls out entirely: nothing hard-requires the worktree file to exist, so a `D` file produces `index ↔ absent` and renders (A4 AC1, AC4). The inverse untracked case is `absent ↔ worktree` (A4 AC5).

**N3 fix required for A2 AC6**: extend `GitFileStatus` with `origPath?: string`, populate it from the `porcelain=v2` type-2 post-tab segment in `parseFileStatus` (`git-info.service.ts:988-1010`), and thread it through `GitStatusService` → `SourceControlFileComponent` → the diff request.

### 2.3 The new RPC — `git:diffFile`

One method, one round trip per tab (today: two RPCs per tab, so refreshing three tabs costs six).

```ts
// libs/shared/src/lib/types/rpc/rpc-git.types.ts
export type GitReadErrorCode = 'not-a-repo' | 'no-commits' | 'ambiguous-ref' | 'git-missing' | 'timeout' | 'permission-denied' | 'unknown';

export type GitBlobRead = { outcome: 'content'; content: string } | { outcome: 'binary'; byteLength: number } | { outcome: 'absent' } | { outcome: 'error'; code: GitReadErrorCode; message: string };

export interface GitDiffFileParams extends GitWorkspaceScopedParams {
  path: string; // workspace-relative, modified side
  comparison: 'staged' | 'worktree';
  /** Pre-rename source path for staged renames; backend falls back to `path`. */
  originalPath?: string;
}

export interface GitDiffFileResult {
  path: string;
  originalPath: string;
  comparison: 'staged' | 'worktree';
  original: GitBlobRead;
  modified: GitBlobRead;
  originalRef: DiffSideRef;
  modifiedRef: DiffSideRef;
  /** sha256 over the exact bytes of both sides + ref identity. Opaque to the client. */
  snapshotToken: string;
}
```

`git:showFile` is **kept unchanged** — `worktree-hook-handler.ts` and other callers still use it, and A3's contract change is delivered through the new method. Do not widen `GitShowFileResult`.

Registration checklist for this method (per §1.2): `RpcMethodRegistry` entry, `RPC_METHOD_PRESENCE` entry, `GitRpcHandlers.METHODS` tuple. `ALLOWED_METHOD_PREFIXES` needs no change (`'git:'` present). Zod schema in a **new** `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts` (none exists today; do not retrofit the other 16 methods in this task).

### 2.4 Revalidation — how a diff tab stays current (A1)

**Trigger source**: `git:status-update`, **not** `editor:reread-open-tabs`.

Rationale: `git:status-update` is the authoritative "git state changed" push, already fires on every commit/stage/checkout/discard (`git-watcher.service.ts:148-171`), and carries `workspaceRoot` + `causes`. `editor:reread-open-tabs` is about worktree _file bytes_ after a git-rename-driven rewrite.

New handling, per message:

| Message                         | New behaviour                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git:status-update`             | Enqueue a refresh of **every** diff tab in the payload's workspace. Debounced 250 ms per workspace.                                                                                                                  |
| `editor:reread-open-tabs`       | **Skip tabs where `tab.diff` is set.** This is the A1 AC5 fix — the loop at `editor-workspace.ts:349-353` stops issuing `editor:openFile` against `diff:…` keys. Verification is a literal count of failed RPCs = 0. |
| `file:content-changed` (path P) | If any `worktree` diff tab has `diff.path === P` (workspace-relative match against the absolute pushed path), refresh that tab.                                                                                      |

**Refresh algorithm** (`EditorDiffSplitHelper.refreshDiffTab(key)`):

1. Read the tab; bail if absent. Capture `originWorkspace`. Bail if `inFlightDiffRefreshes.has(key)` (mirrors `inFlightRereads`, `editor-file-ops.ts:26`) — bounded queueing per NFR-7.
2. Bump `diff.requestId`; set `status: 'refreshing'`. **Do not touch `original`/`modified`** — this is A1 AC6 (no flicker to empty).
3. `rpcCall('git:diffFile', {...})`.
4. Drop the response if `requestId` moved, or `getActiveWorkspacePath() !== originWorkspace`, or the tab was closed.
5. On both sides `outcome:'content'|'absent'|'binary'` → write the new state, `status: 'fresh'`, update `content`, `activeFileContent` if this tab is active, `syncTabsToCache()`.
6. On either side `outcome:'error'` → `status: 'error'`, `errorMessage` = the mapped copy, **retain the previous content**. A1 AC7.
7. On transport failure → `status: 'stale'`, retain content, indicator shown.

**Re-click** (A1 AC4): `openDiff` no longer early-returns. It activates the tab _and_ calls `refreshDiffTab`. The early-return at `editor-diff-split.ts:29-36` is deleted.

**Discard** (A1 AC3): choose "render an empty diff", not self-close. After refresh a discarded file's `worktree` diff has `original === modified`; the diff header renders "No changes". Self-closing a tab the user is looking at is more surprising, and AC3 permits either.

### 2.5 Stale / error indicator surfaces

- **Tab strip**: a small warning glyph next to `fileName` when `diff.status !== 'fresh'`, with `[attr.title]` carrying the reason. Reuses the existing dirty-dot slot pattern (`editor-panel.component.ts:223-228`).
- **Diff header bar** (new, inside `DiffViewComponent`): status chip + Retry button + the D3 layout toggle + the new/deleted/binary chrome. This replaces the floating `(new file)` badge at `diff-view.component.ts:56-62`.
- **Error body**: when `status === 'error'`, an overlay panel over the diff host with the mapped message and Retry. Not a toast — A1 AC7 requires a persistent indicator.

---

## 3. Component 2 — Git read error semantics (A3)

### 3.1 Distinguishing "absent" from "failed"

`git show <rev>:<path>` exits 128 for both a missing path and a broken repo, and the stderr wording is locale-dependent.

**Decision**: classify on the failure path only, using an exit code, not a message.

```
run: git show <rev>:<path>
  exit 0            -> outcome 'content' (or 'binary' if bytes contain NUL)
  exit != 0         -> run: git cat-file -e <rev>:<path>
                         exit 0  -> outcome 'error' (object exists but show failed)
                         exit 1  -> outcome 'absent'
                         other   -> outcome 'error', classify by pre-flight probes
```

Zero extra spawns in the happy path; locale-independent. Pre-flight probes for the error branch (each already implemented or trivial): `isGitRepo()` → `not-a-repo`; `git rev-parse --verify HEAD` fails → `no-commits`; `execGit` rejection with `ENOENT` → `git-missing`; rejection with the timeout message → `timeout`; `EACCES`/`EPERM` → `permission-denied`; else `unknown`.

**Belt-and-braces**: extend `ExecGitOptions` with an `env` merge and set `LC_ALL=C`, `LANG=C`, and `GIT_OPTIONAL_LOCKS=0` on all `execGit` invocations. `GIT_OPTIONAL_LOCKS=0` additionally stops read-only `git status` calls from touching `.git/index.lock` — a free reduction in the watcher feedback loop that B4 is fighting.

### 3.2 `execGit` hardening (N2 — prerequisite for A3 and D2)

Three changes to `libs/backend/vscode-core/src/utils/exec-git.ts`:

1. **Buffer accumulation**: collect `Buffer[]` and `Buffer.concat(...).toString('utf8')` once at close, instead of `stdout += data.toString()` per chunk. Fixes chunk-boundary UTF-8 corruption.
2. **`execGitBuffer(args, cwd, opts): Promise<{ stdout: Buffer; stderr: string; exitCode: number }>`** — new sibling used for blob reads (NUL-byte binary detection, `byteLength`) and for snapshot hashing. `execGit` becomes a thin string wrapper over it.
3. **stdin**: `ExecGitOptions.stdin?: string | Buffer`. Write it and `child.stdin.end()`; when absent, `child.stdin.end()` immediately so no git subcommand can block on an open pipe. Required by D2's `git apply -`.

These are additive; all 16 existing `GitInfoService` call sites are unchanged.

### 3.3 Frontend rendering per outcome

| `original` / `modified` | Render                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content` / `content`   | Normal diff                                                                                                                                                                                                                                                               |
| `absent` / `content`    | "(new file)" chrome — **driven by `originalRef.kind === 'absent'`, not by `originalContent === ''`**. This single change is what fixes A3 AC5: a genuinely empty tracked file now renders as an empty diff, not as a new file. Replaces `diff-view.component.ts:100-102`. |
| `content` / `absent`    | "(deleted)" chrome, modified pane empty (A4 AC3)                                                                                                                                                                                                                          |
| `binary` on either side | "Binary file — diff not shown", hunk actions unavailable (D2 AC10)                                                                                                                                                                                                        |
| `error` on either side  | Error overlay + Retry; **never** rendered as content                                                                                                                                                                                                                      |

### 3.4 Message sanitization (A3 AC3/AC4, NFR-8)

`GitReadErrorCode` → a fixed user-facing string table on the **frontend**. The backend returns the code plus a short, already-sanitized `message` (workspace-relative path only, no stderr). Raw stderr and the absolute workspace path go to `logger.error` and nowhere else. `validatePathSegment` (`git-info.service.ts:450-461`) is called on both `path` and `originalPath` before any git invocation, in the same position as `showFile` uses it today.

### 3.5 Transition plan for newly-visible failures (R-3)

The volume should be small: the only previously-silent case that mapped to a benign outcome was "new/untracked file", and that now classifies as `absent`, not `error`. Everything else was already broken and invisible.

Required triage matrix, executed in Electron **before** the A batch merges, each case recorded as pass / fixed-in-scope / follow-up finding:

submodule path · symlink · path with spaces · path with non-ASCII characters · binary file · file > 10 MB · file added but never committed · detached HEAD · repository with zero commits · path inside a nested git repo · file with CRLF · file with no trailing newline · file that is empty and tracked

Contingency if the volume is large: promote specific enumerated benign cases to their own `outcome` values. **Never** reintroduce the blanket empty-content swallow.

---

## 4. Component 3 — Diff editor lifecycle (B1, B2, and N1)

### 4.1 Template restructure — `editor-panel.component.ts:253-297`

Replace the `@if / @else if / @else` chain with three **simultaneously mounted, absolutely-positioned** layers, mirroring the `[class.invisible]` idiom already proven at `code-editor.component.ts:92-96`:

```
<div class="flex-1 min-h-0 relative">
  <ptah-diff-view   [class.invisible]="!activeDiffTab()"   [diffTab]="activeDiffTab()" />
  <ptah-code-editor [class.invisible]="activeDiffTab() || isActiveFileImage()" ... />
  @if (isActiveFileImage()) { <img ...> }        <!-- no expensive state; @if is fine -->
  @if (isLoading() && !hasActiveFile()) { <spinner overlay> }
</div>
```

This is simultaneously B1's fix and N1's fix. Both editors must be `position:absolute; inset:0` inside the relative parent so the invisible one occupies no layout.

**Layout gotcha carried over from the reference implementation** (`code-editor.component.ts:508-510`): a Monaco editor laid out while hidden measures zero. On becoming visible, call `editor.layout()` inside `requestAnimationFrame` — not a microtask — so Angular has flushed the class removal. Applies to both hosts now.

### 4.2 `DiffViewComponent` rewrite

Input changes from three primitives to one: `readonly diffTab = input<EditorTab | null>(null)`. Everything the component needs (both contents, both refs, status, error, binary flag) is on `DiffTabState`.

**Lifecycle** (all five reference mechanisms, adapted):

- `createDiffEditor` **once** in `afterNextRender` after `loader.load()`; `this.monacoApi` stored from the resolved handle. Never `window.monaco` — B2 AC4 verification ("with the global unavailable, updates SHALL still function") is then structural.
- **Model-pair cache** keyed by the diff tab key, URIs namespaced per instance:
  `ptah-diff://<instanceId>/<encodeURIComponent(key)>/original` and `…/modified`.
- **Cap**: `MAX_DIFF_PAIRS = 30` (each entry is two models; 30 pairs also matches B1 AC5's 30-tab open/close workload).
- **View state**: `saveViewState()` before switching away, `restoreViewState()` after `setModel`, keyed by tab key. `IStandaloneDiffEditor.saveViewState()` returns `IDiffEditorViewState` covering both sides' scroll/cursor plus collapsed regions → B1 AC3 and AC4 together.
- **Content update** (B2 AC1/AC2/AC5): per side,
  `model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)`.
  No dispose, no recreate, incremental re-tokenize, no flash to unstyled text.
- **Language change** (B2 AC3): `this.monacoApi.editor.setModelLanguage(model, lang)` when `model.getLanguageId() !== lang`.
- **No `applyingExternalEdit` guard needed** — the diff stays `readOnly: true`, so no content listener and no user-edit feedback loop exists.

**Eviction on close** (B1 AC5) — the one place the diff diverges from the code editor, which deliberately _retains_ evicted-file models. Implement pull-based, no new coupling:

```
liveDiffKeys = computed(() => new Set(
  editorService.openTabs().filter(t => t.diff).map(t => t.filePath)
));
effect(() => { for (const key of cache.keys()) if (!liveDiffKeys().has(key)) disposePair(key); });
```

This also handles workspace switch (B1 AC6): `openTabs` is replaced wholesale, the outgoing workspace's pairs are disposed, and `diffTab()` goes null → `editor.setModel(null)`, which `IStandaloneDiffEditor` accepts. No throw, no stale diff.

**Cap on `MAX_DIFF_PAIRS`**: because eviction-on-close already bounds the cache to the number of open diff tabs, the LRU cap is a backstop only.

### 4.3 Diff editor options

`readOnly: true` and `renderMarginRevertIcon: false` stay **permanently**. Monaco's built-in revert arrow performs an in-model edit on a writable modified side — the wrong mechanism entirely here, because it would revert into a Monaco buffer rather than into git. D2's affordances are built as glyph-margin decorations + overlay widgets (§6.3). This is an explicit departure from the orchestrator's framing ("D2 later making the modified side writable") and is what makes D2 AC11 ("no accidental edits possible outside the explicit hunk actions") structurally true rather than a behavioural promise.

`renderSideBySide` becomes a signal-driven `updateOptions({ renderSideBySide })` call (D3).

---

## 5. Components 4–8 — the remaining B / C / D items

### 5.1 B3 — directory change indicators

Add to `GitStatusService`, beside `fileStatusMap` (`git-status.service.ts:141-152`):

```ts
readonly changedDirPrefixes = computed<ReadonlySet<string>>(() => {
  const set = new Set<string>();
  for (const f of this._files()) {
    const p = f.path.replace(/\\/g, '/');
    if (f.isDirectory) set.add(p);                       // untracked-directory entries
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) set.add(p.slice(0, i));
  }
  return set;
});
```

`hasChangedChildren` (`file-tree-node.component.ts:284-304`) drops its loop for `changedDirPrefixes().has(relativeDirPath)` — O(1) per node (B3 AC2). Build cost is O(total path segments) once per status update, and `_files` already carries a custom `equal: filesEqual` (`:96`) so the computed only recomputes on genuine change.

- AC3 (correctness both directions): every ancestor of every changed file is inserted; nothing else is.
- AC4 (multi-root): `_files()` is already the active workspace's slice.
- AC5 (mixed separators): normalize on insert and reuse the node's existing normalization on lookup.
- AC6 (clearing): the recomputed set simply lacks the prefix.

### 5.2 B4 — one exclusion source of truth

New in `libs/shared/src/lib/constants/workspace-scan.constants.ts`:

```ts
export const WORKSPACE_SCAN_EXCLUDED_DIRS: ReadonlySet<string>;
export function isExcludedWorkspacePath(relativePath: string): boolean; // splits on [\\/]
```

Consumed by **both** `git-watcher.service.ts:378-393` (path-level test against the `fs.watch` filename) and `editor-rpc.handlers.ts:858` (segment-level test in the tree builder). One implementation, one set — B4 AC2's "reintroducing a second hand-maintained list SHALL be treated as not-done" is then structurally impossible.

**Set contents** — conservative, per R-9 ("over-broad exclusion is worse than the churn it fixes"):
current `HIDDEN_SKIP` (`.git .hg .svn .DS_Store .Trash .cache .tmp .temp .nx`) ∪ current watcher list (`node_modules dist`) ∪ **`.angular`** (the only addition; it is the named M3 churner alongside `.nx/cache`).
Do **not** speculatively add `out`, `build`, `coverage`, `.next`, `.turbo` — those are plausible source directories in some projects.

**Unresolved consequence, needs a decision** — see `## Open Questions` #1: today's tree builder only applies `HIDDEN_SKIP` to entries starting with `.` (`editor-rpc.handlers.ts:858`), so it _shows_ `node_modules` and `dist` while the watcher _ignores_ them. Strictly satisfying AC2 ("both SHALL agree") means either the tree starts hiding them or the watcher stops ignoring them. Hiding them matches VS Code and is almost certainly right, but it is a user-visible change beyond the stated scope.

### 5.3 B5 — drag coalescing

Extract one private helper used by all three handlers (`editor-panel.component.ts:832-858`, `879-903`, `921-949`) — AC4 falls out of having a single implementation:

```
startDragTracking({ onMove(e), onCommit(), onCancel() })
  runOutsideAngular:
    mousemove  -> store latest event; if (!frame) frame = rAF(flush)
    flush      -> frame = null; ngZone.run(() => onMove(latest))     // <=1 CD pass/frame
    mouseup    -> cancelAnimationFrame(frame); ngZone.run(() => onMove(latest)); cleanup()
    window blur / Escape keydown -> cancelAnimationFrame; onCancel(); cleanup()
```

- AC1/M4: exactly one `ngZone.run` per animation frame instead of one per pointer event.
- AC2: the mouseup path cancels the pending frame and applies the final value synchronously — the last update is never lost.
- AC3: blur and Escape teardown are **new** (all three handlers currently leak on window blur); cleanup nulls both listeners and the frame handle.
- AC5: clamping arithmetic is copied verbatim per surface; layout is bit-identical.

### 5.4 C1 — message handlers

Add to `libs/shared/src/lib/types/messages/message-constants.ts` (append-only per the shared-lib guideline):
`GIT_STATUS_UPDATE: 'git:status-update'`, `FILE_TREE_CHANGED: 'file:tree-changed'`, `FILE_CONTENT_CHANGED: 'file:content-changed'`, `EDITOR_REREAD_OPEN_TABS: 'editor:reread-open-tabs'`, plus `payload-map.ts` entries. `git-watcher.service.ts:43-57` swaps its four local string constants for the shared ones — the wire format is byte-identical, satisfying C1 AC2 and AC5 by construction.

- **`GitStatusService`** → `implements MessageHandler`, `handledMessageTypes = [MESSAGE_TYPES.GIT_STATUS_UPDATE]`. `startListening()` keeps the eager `fetchGitInfo()` and drops the listener; `stopListening()` becomes a no-op stub or is removed with its `destroyRef` hook. Register at `apps/ptah-extension-webview/src/app/app.config.ts` alongside the existing `EditorService` provider (`:129`): `{ provide: MESSAGE_HANDLERS, useExisting: GitStatusService, multi: true }`.
  **Gotcha**: `MessageRouterService` reads `handledMessageTypes` in its constructor (`message-router.service.ts:29-31`), so `useExisting` forces `GitStatusService` instantiation at router-construction time. Its constructor only registers a destroy hook (`:157-159`) — safe.
- **`EditorWorkspaceHelper`** is a plain class, not injectable. Route its three types through `EditorService`, which is already a `MessageHandler` (`editor.service.ts:366-394`): extend the `handledMessageTypes` tuple, and delegate in `handleMessage`. The debounce timers and windows stay on the helper unchanged (C1 AC2 — "including existing debounce windows"). `startFileTreeWatcher`/`stopFileTreeWatcher` shrink to timer lifecycle; the raw `window.addEventListener` at `:357` and `removeEventListener` at `:363` are deleted.
- C1 AC4 ("exactly one place to add a message type") is then true: `EditorService.handledMessageTypes` + its switch.

### 5.5 C2 — split-pane save

Root cause: `openFileInSplit` copies content at open time and split edits write only `splitFileContent` (`editor-diff-split.ts:117-123`, `:139-141`), never back into `openTabs`.

**Design** — the open tab record becomes the single owner of content for both panes; the independent Monaco models stay (C2 AC6):

1. `updateSplitContent(content)` also calls `tabs.updateTabContent(splitFilePath, content)` when that path has an open tab. No edit can now be lost, because both panes write the same record.
2. Both panes' `[content]` inputs are driven from the tab record. The left pane already effectively is (`activeFileContent` is set on switch/open only; `onContentChanged` writes the tab, not the signal — `editor-panel.component.ts:654-659`), so no feedback loop is introduced.
3. **Mirroring** (AC1's "reflect that edit" branch): when the same path is open in both panes, the _unfocused_ pane receives the focused pane's content on a short debounce. `CodeEditorComponent.syncFile` already applies external content via `pushEditOperations` guarded by `applyingExternalEdit` (`:399-411`) — no new mechanism, and undo survives. Mirroring only into the unfocused pane prevents cursor-jump while typing.
4. **Conflict at save** (AC2/AC3): if the tab record carries a write from the other pane that this pane has not absorbed, prompt "This file was also edited in the other pane — Overwrite / Cancel". With (1)+(3) in place this should be reachable only under a genuine race.
5. AC5 (different files) is untouched: every branch above is gated on `splitFilePath === activeFilePath`.

This is the highest-uncertainty item after D2 and should be scoped as its own batch.

### 5.6 D1 — accessible semantics

Three nesting sites (the third is not in the findings but is the same defect and is inside the panel D1 AC1 scopes):

| Site                                                                                                                        | Fix                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tab close inside tab button — `editor-panel.component.ts:229` inside `:206`                                                 | Outer becomes `<div role="presentation">` carrying the tab chrome classes; inside, `<button role="tab" [attr.aria-selected]>` for the label and a sibling `<button [attr.aria-label]="'Close ' + fileName">` |
| Stage-all/unstage-all inside section header — `source-control-panel.component.ts:92` inside `:78`, and `:140` inside `:126` | Same pattern: container `<div>`, `<button [attr.aria-expanded]>` toggle + sibling action button                                                                                                              |
| Stage/unstage/discard inside the file row button — `source-control-file.component.ts:68/79/91` inside `:39`                 | Row becomes a `<div role="listitem">` containing a `<button>` for open-diff and sibling action buttons                                                                                                       |

Consequences: `event.stopPropagation()` in `onStageAll`, `onUnstageAll` (`source-control-panel.component.ts:228`, `:233`), `onAction` (`source-control-file.component.ts:175`) and `onTabClose` (`editor-panel.component.ts:672`) is **deleted** — AC5 requires the fix to hold without propagation suppression. Visual identity is preserved by moving chrome classes to the container (AC6). Add `focus-visible` ring utilities and verify `btn-ghost` does not suppress them (AC7).

### 5.7 D3 — inline / side-by-side toggle

- Toggle lives in the new diff header bar; `editor.updateOptions({ renderSideBySide })` — no recreation (AC2, consistent with B1). Save/restore view state around the call for scroll preservation.
- Preference persisted via the **existing** `editor:updateSetting` / `editor:getSetting` methods (already in `EDITOR_PANE_METHODS`, `manifest.ts:104-105`, served by all hosts). No new RPC. Key: `editor.diff.renderSideBySide`.
- New tabs read the persisted value (AC3); it survives restart (AC4). Toggle is a real `<button>` with `aria-pressed` (AC5).
- AC6 (hunk actions in inline layout) is satisfied because D2's affordances are **modified-model line decorations**, which Monaco renders in both layouts.

---

## 6. Component 9 — Hunk stage / revert (D2, lands last)

### 6.1 The governing decision: git generates the patch, git consumes the patch

Two options were considered.

|                               | (a) Frontend derives hunks from Monaco's diff, constructs a unified patch, ships the text                           | (b) **Backend runs `git diff`, ships hunk metadata for display, reassembles a subset of git's own patch, pipes it to `git apply`** |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AC9 byte-identical to CLI git | Not achievable — CRLF, `core.autocrlf`, no-trailing-newline and non-UTF8 all round-trip through JSON string content | **Structural** — the bytes never leave Node; git produced the patch and git applies it                                             |
| AC6 stale-snapshot refusal    | Client-asserted                                                                                                     | **Server-side digest comparison**                                                                                                  |
| AC7 atomicity                 | Hand-rolled                                                                                                         | `git apply --check` dry run, then apply; plus a pre-image snapshot for the destructive path                                        |
| AC10 binary                   | Manual detection                                                                                                    | `git diff` emits `Binary files … differ`, zero hunks → actions absent                                                              |
| AC11 no accidental edits      | Requires a writable modified pane                                                                                   | **Pane stays `readOnly: true`**                                                                                                    |

**(b) is chosen.** Monaco's diff computation is used only for _rendering_ (which is what the Out-of-Scope section reserves it for); the authoritative hunk segmentation is git's. Because git hunk boundaries and Monaco's change regions differ, the affordances must be positioned by git's `@@ -a,b +c,d @@` modified-side line ranges, not by Monaco's regions.

This is exactly what `git add -p` does: it hands `git apply` a subset of the hunks `git diff` produced.

### 6.2 Operation matrix

| Tab comparison | Operation         | Patch source                                               | Apply command             |
| -------------- | ----------------- | ---------------------------------------------------------- | ------------------------- |
| `worktree`     | **stage** (AC2)   | `git diff -U3 --no-color --no-ext-diff -- <path>`          | `git apply --cached -`    |
| `worktree`     | **revert** (AC4)  | same                                                       | `git apply -R -`          |
| `staged`       | **unstage** (AC3) | `git diff --cached -U3 --no-color --no-ext-diff -- <path>` | `git apply --cached -R -` |

The valid operation set is derivable from `comparison` — validate that in the handler, not just the schema.

### 6.3 UI mechanism

`GitDiffFileResult` gains (in the D2 batch, not the A batch — see §7):

```ts
patch: string | null;          // git's own unified diff for this comparison
hunks: GitHunkRef[];           // parsed headers only
// GitHunkRef: { index, originalStart, originalLines, modifiedStart, modifiedLines, header }
```

Affordances are rendered as **glyph-margin decorations plus an overlay widget** anchored at `modifiedStart` in the modified model — no view zones that shift line numbers, no model edits. Keyboard reachability (AC14): a roving-tabindex list of hunk actions in the diff header bar (`Hunk 2 of 7 — Stage / Revert`) driven by the same `hunks` array, so keyboard users never need to reach the margin. Layout-agnostic → D3 AC6.

Revert requires confirmation (AC5) — a modal, not a click.

### 6.4 The apply RPC

```ts
export interface GitApplyHunksParams extends GitWorkspaceScopedParams {
  path: string;
  originalPath?: string;
  comparison: 'staged' | 'worktree';
  operation: 'stage' | 'unstage' | 'revert';
  hunkIndices: number[]; // ordinals into the `hunks` array of the snapshot
  snapshotToken: string; // issued by git:diffFile
}

export type GitApplyHunksFailure = 'STALE_SNAPSHOT' | 'APPLY_FAILED' | 'BINARY_UNSUPPORTED' | 'INVALID_OPERATION' | 'NOT_A_REPO' | 'UNKNOWN';

export interface GitApplyHunksResult {
  success: boolean;
  code?: GitApplyHunksFailure;
  message?: string; // sanitized
  snapshotToken?: string; // the NEW token after a successful apply
}
```

One method with an `operation` discriminant, not three — one Zod schema, one staleness path, one audit log site.

Registration (per §1.2): `RpcMethodRegistry` + `RPC_METHOD_PRESENCE` + `GitRpcHandlers.METHODS`. Zod schema in `git-rpc.schema.ts`. `'git:'` prefix already allowlisted.

### 6.5 Server-side algorithm

```
1. validatePathSegment(path); validatePathSegment(originalPath ?? path)
2. resolveRoot(workspaceRoot) — the existing registered-folder guard (git-rpc.handlers.ts:162-186)
3. reject if operation is not valid for comparison            -> INVALID_OPERATION
4. recompute the snapshot exactly as git:diffFile does
     (read both sides as Buffers, hash, combine with ref identity)
5. if recomputed != params.snapshotToken                      -> STALE_SNAPSHOT   [AC6]
6. run the comparison's git diff -> patch text
   if patch is "Binary files ... differ" or has 0 hunks       -> BINARY_UNSUPPORTED
7. reassemble: keep the file header block (`diff --git`, `index`, `---`, `+++`)
   plus only the selected `@@` hunks, verbatim, including any
   `\ No newline at end of file` marker                        [AC9]
8. destructive path only (operation === 'revert'):
   snapshot the worktree file bytes to a temp file
9. git apply <flags> --check -   (stdin = reassembled patch)   -> APPLY_FAILED    [AC7]
10. git apply <flags> -                                        -> on failure:
      revert: restore from the temp snapshot
      staged: git read-tree <tree captured by `git write-tree` at step 4>
                                                               -> APPLY_FAILED    [AC7]
11. recompute and return the new snapshotToken
12. log { workspaceRoot, path, comparison, operation, hunkIndices,
          snapshotToken, patchSha256, exitCode } at info       [R-1 forensics]
```

Notes:

- Step 7 deliberately does **not** recompute hunk headers. Later hunks' `+`-side start lines are stale relative to a partially applied file; `git apply` tolerates this via context matching and reports the offset. This is precisely `git add -p`'s behaviour. Do **not** pass `--recount` or `--unidiff-zero` (we use `-U3`).
- Step 4's `git write-tree` gives a cheap index rollback point for the `--cached` paths; it writes only tree objects, never moves a ref.
- `core.autocrlf` is handled implicitly: `git diff` emits the patch in index (LF) space and `git apply --cached` applies in the same space; the worktree revert path uses `git apply -R`, which respects the same conversion rules the CLI uses. No line-ending code of our own — that is the whole point of choosing (b).

### 6.6 Post-apply refresh (AC8)

`git apply --cached` writes `.git/index`, which the Electron watcher already watches (`git-watcher.service.ts:151-153`) → `git:status-update` fires → the A1 refresh path updates the diff tab, the Source Control counts, and the file-tree indicators with no manual refresh. On VS Code and CLI (no watcher), the frontend performs an explicit refresh on the RPC response. Belt-and-braces: refresh explicitly on success in all hosts and let the watcher push be idempotent.

---

## 7. B0 — measurement approach (no profiling code shipped)

All four harnesses live in `apps/ptah-electron-e2e/` (never packaged) or as a Jest spec in `libs/frontend/editor`. No product code is instrumented.

| Metric                                           | Method                                                                                                                                                                                                                                                                                                                                  | Sampling                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **M1** diff re-display latency                   | Playwright in `ptah-electron-e2e`. `page.evaluate` installs a `MutationObserver` on the modified editor's `.view-lines`, resolves at the first `rAF` after the expected line count appears; timed from the synthetic click with `performance.now()`. Workload: ~500-line TS file, alternate diff-tab ↔ file-tab.                        | 10 round trips, median + max                                                                        |
| **M2** `git:status-update` handling              | **Jest** in `libs/frontend/editor`: build 300 `GitFileStatus` entries + 100 `FileTreeNodeComponent` fixtures, dispatch the message, time `fixture.detectChanges()` + `TestBed.flushEffects()`. Deterministic, reproducible on any machine, and doubles as a permanent regression guard with a generous upper-bound assertion.           | 10 iterations, median + max                                                                         |
| **M3** `git status` invocations from cache churn | Launch the Electron dev build with `GIT_TRACE=1`; git writes one trace line per invocation to stderr, already captured by the main-process log. Run a 60 s build that writes `.nx/cache` + `.angular/cache`; `grep -c` the trace for `status`. **Zero product-code change.**                                                            | Single 60 s window before and after; also modify one tracked source file mid-window to prove B4 AC3 |
| **M4** CD passes/s during drag                   | Playwright: `page.mouse.move` loop for 2 s over the sidebar splitter; a `MutationObserver` on the sidebar element's `style` attribute counts layout writes; compare against the frame count from a parallel `rAF` counter. Measures the observable effect rather than CD internals — externally verifiable and framework-version-proof. | 2 s window × 5 runs, median + max                                                                   |

**Deviation to flag**: B0 AC5 names Electron as the reference runtime for all measurements. M2's cost is entirely renderer-side and identical across hosts; a Jest harness gives a far more reproducible number than a GPU-scheduled Electron window. Recommend Jest as the reported M2 figure with an Electron spot-check for confirmation.

**Baseline timing** (SEQ-3 §2 requires apples-to-apples): M2, M3 and M4 baselines can be taken on today's code — batches 1–2 touch none of those paths. **M1's baseline must be taken after the A batch lands**, because A rewrites the diff fetch path.

---

## 8. File-by-file change map

### 8.1 `libs/shared`

| File                                            | Change                                                                                                                                                                                                                 | Serves             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/lib/types/rpc/rpc-git.types.ts`            | Add `GitBlobRead`, `GitReadErrorCode`, `DiffSideRef`, `GitDiffFileParams/Result`, `GitHunkRef`, `GitApplyHunksParams/Result/Failure`. Add `origPath?: string` to `GitFileStatus`. Leave `GitShowFileResult` untouched. | A2, A3, A4, D2, N3 |
| `src/lib/types/rpc.types.ts`                    | `RpcMethodRegistry` + `RPC_METHOD_PRESENCE` entries for `git:diffFile` (A batch) and `git:applyHunks` (D2 batch)                                                                                                       | A, D2              |
| `src/lib/types/messages/message-constants.ts`   | Append `GIT_STATUS_UPDATE`, `FILE_TREE_CHANGED`, `FILE_CONTENT_CHANGED`, `EDITOR_REREAD_OPEN_TABS`                                                                                                                     | C1                 |
| `src/lib/types/messages/payload-map.ts`         | Payload entries for the four new types                                                                                                                                                                                 | C1                 |
| `src/lib/constants/workspace-scan.constants.ts` | **NEW** — `WORKSPACE_SCAN_EXCLUDED_DIRS`, `isExcludedWorkspacePath`                                                                                                                                                    | B4                 |

### 8.2 `libs/backend`

| File                                                | Change                                                                                                                                                                                                         | Serves             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `vscode-core/src/utils/exec-git.ts`                 | Buffer accumulation; `execGitBuffer`; `stdin` option + unconditional `stdin.end()`; `env` merge (`LC_ALL=C`, `LANG=C`, `GIT_OPTIONAL_LOCKS=0`)                                                                 | A3, D2, N2         |
| `vscode-core/src/services/git-info.service.ts`      | **NEW** `readBlob(root, ref, path): GitBlobRead` with the show→cat-file classification; **NEW** `diffFile(...)`; **NEW** `applyHunks(...)` (D2 batch); `parseFileStatus` populates `origPath` for type-2 lines | A2, A3, A4, D2, N3 |
| `rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` | Register `git:diffFile` (A) and `git:applyHunks` (D2); extend `METHODS`; inject `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` for the worktree-side read                                                              | A, D2              |
| `rpc-handlers/src/lib/handlers/git-rpc.schema.ts`   | **NEW** — Zod for the two new methods only                                                                                                                                                                     | NFR-3              |

### 8.3 `libs/frontend/editor`

| File                                               | Change                                                                                                                                                                                                                                          | Serves                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `services/editor/editor-tab.types.ts`              | `DiffComparison`, `DiffSideRef`, `DiffTabStatus`, `DiffTabState`; `EditorTab.diff` replaces `isDiff`/`originalContent`/`diffRelativePath`                                                                                                       | A1, A2                 |
| `services/editor/editor-diff-split.ts`             | `openDiff(request)` takes a comparison; builds the structured key; no early return; `refreshDiffTab`, `refreshAllDiffTabs`, `inFlightDiffRefreshes`; `updateSplitContent` also writes the tab record                                            | A1, A2, A3, A4, C2     |
| `services/editor/editor-workspace.ts`              | Raw listener removed; three types delegated from `EditorService`; the reread loop skips `tab.diff`                                                                                                                                              | A1 AC5, C1             |
| `services/editor/editor-file-ops.ts`               | `handleFileContentChanged` becomes a no-op for diff-keyed paths (defence in depth for A1 AC5)                                                                                                                                                   | A1                     |
| `services/editor.service.ts`                       | `handledMessageTypes` extended to 5; `handleMessage` switch; `activeDiffTab` computed reads `tab.diff`; new public `refreshDiffTab`/`openDiff(request)` surface                                                                                 | A1, C1                 |
| `services/git-status.service.ts`                   | `implements MessageHandler`; raw listener removed; **new** `changedDirPrefixes` computed                                                                                                                                                        | B3, C1                 |
| `diff-view/diff-view.component.ts`                 | Rewritten per §4.2 — single `diffTab` input, persistent editor, model-pair cache, view-state cache, `pushEditOperations`, loader handle, header bar, error/binary/new/deleted chrome, `renderSideBySide` toggle, D2 hunk decorations (D2 batch) | B1, B2, A3, A4, D2, D3 |
| `editor-panel/editor-panel.component.ts`           | Three-layer always-mounted content region; tab-strip semantics split; stale/error glyph; `startDragTracking` helper replacing three duplicated drag paths; `onDiffRequested` carries the comparison                                             | B1, B5, D1, N1, A2     |
| `file-tree/file-tree-node.component.ts`            | `hasChangedChildren` → O(1) set lookup                                                                                                                                                                                                          | B3                     |
| `source-control/source-control-panel.component.ts` | Rows emit `{ path, comparison, origPath? }`; section headers de-nested; `stopPropagation` removed                                                                                                                                               | A2, D1                 |
| `source-control/source-control-file.component.ts`  | Row de-nested; emits the structured diff request incl. `origPath`                                                                                                                                                                               | A2, D1, N3             |
| `sidebar/sidebar.component.ts`                     | `diffRequested` output type widened to the structured request                                                                                                                                                                                   | A2                     |
| `code-editor/code-editor.component.ts`             | Mirroring hook for the split-pane case only                                                                                                                                                                                                     | C2                     |
| `src/index.ts`                                     | Export the new diff types if consumed outside the lib                                                                                                                                                                                           | —                      |

### 8.4 `apps`

| File                                                                  | Change                                                                                            | Serves |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| `apps/ptah-electron/src/services/git-watcher.service.ts`              | Use `isExcludedWorkspacePath` in the workspace-root watcher; use shared `MESSAGE_TYPES` constants | B4, C1 |
| `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts` | `HIDDEN_SKIP` deleted; tree builder uses the shared predicate                                     | B4     |
| `apps/ptah-extension-webview/src/app/app.config.ts`                   | `{ provide: MESSAGE_HANDLERS, useExisting: GitStatusService, multi: true }`                       | C1     |
| `apps/ptah-electron-e2e/`                                             | **NEW** M1, M3, M4 harnesses                                                                      | B0     |

### 8.5 Tests

New/updated: `diff-view.component.spec.ts` (lifecycle, model reuse, view state, eviction, error/binary/new/deleted states), `editor-diff-split.spec.ts` (**NEW** — the A1–A4 acceptance matrix), `git-status.service.spec.ts` (`changedDirPrefixes`), `file-tree-node.component.spec.ts` (O(1) path + mixed separators), `editor-panel.component.spec.ts` (both hosts mounted; drag coalescing; de-nested semantics), `git-info.service.spec.ts` (**NEW** — `readBlob` classification, `origPath` parsing, `applyHunks` against real temp repos incl. CRLF / no-trailing-newline / non-ASCII), `editor-workspace.spec.ts` (reread skips diff tabs — the literal A1 AC5 assertion), plus the M2 Jest benchmark.

D2 AC9 verification must run against **real temporary git repositories** created in the test, comparing `git diff` / `git diff --cached` output before and after against the output of the equivalent CLI operation. Mocked git is not acceptable evidence for a claim of byte-identity.

---

## 9. Batching recommendation for the team-leader

| #   | Batch                                | Contents                                                                                                                                                                                                                                                                                                                                 | Constraint                                                                                             |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0   | **Measurement harnesses**            | M1/M3/M4 Playwright + M2 Jest; capture M2, M3, M4 baselines now                                                                                                                                                                                                                                                                          | B0. M1 baseline deferred to after batch 2                                                              |
| 1   | **Message plumbing**                 | C1 in full (shared `MESSAGE_TYPES` + payload map, `GitStatusService`, `EditorWorkspaceHelper`→`EditorService`, watcher constants, `app.config.ts` provider)                                                                                                                                                                              | **Deviates from SEQ-3 §4 — see Requirements Concerns #4**                                              |
| 2   | **THE KEYSTONE — A1 + A2 + A3 + A4** | `exec-git` hardening; `readBlob` + classification; `diffFile`; `origPath` parsing; `git:diffFile` RPC + Zod; diff tab record; `openDiff` rewrite; refresh path; reread skip; comparison-aware source-control rows; all A-group states in `DiffViewComponent`. **R-3 triage matrix executed before merge.** Then capture the M1 baseline. | SEQ-1 satisfied and exceeded; the tab-key scheme changes exactly once                                  |
| 3   | **Diff editor lifecycle**            | B1 + B2 + N1 + D3. M1 after-measurement.                                                                                                                                                                                                                                                                                                 | B1/B2 both touch `DiffViewComponent`; D3 is one `updateOptions` call in the same file                  |
| 4   | **Tree + drag perf**                 | B3 + B5. M2, M4 after-measurements.                                                                                                                                                                                                                                                                                                      | Independent; may run parallel with 3                                                                   |
| 5   | **Watcher exclusions**               | B4. M3 after-measurement.                                                                                                                                                                                                                                                                                                                | Backend/Electron only; blocked on Open Question #1                                                     |
| 6   | **Accessibility**                    | D1 across all three nesting sites                                                                                                                                                                                                                                                                                                        | Independent, low risk; may run parallel with 3–5                                                       |
| 7   | **Split-pane save**                  | C2                                                                                                                                                                                                                                                                                                                                       | Highest uncertainty after D2; isolate it                                                               |
| 8   | **D2 — hunk stage/revert**           | `execGit` stdin already landed in batch 2; `patch`/`hunks` added to `GitDiffFileResult`; `git:applyHunks`; decorations; confirm modal; keyboard list; real-repo tests                                                                                                                                                                    | **SEQ-2 — must not start until batch 2 is independently verified against A1–A4's acceptance criteria** |
| 9   | Follow-up                            | File B6 (file-tree virtualization) with the M2 measurement attached                                                                                                                                                                                                                                                                      | DoD item 10                                                                                            |

The natural cut line if the task runs long (R-7) remains before batch 8.

---

## 10. Risks

| ID      | Risk                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-1** | `git apply` corrupts the index or destroys worktree work (inherits R-1)                                                        | Design (b) — git generates and consumes the patch; `--check` dry run; `git write-tree` rollback point for `--cached`; temp-file pre-image for the destructive revert; server-side `snapshotToken` refusal; full forensic log per operation; real-repo byte-comparison tests |
| **A-2** | Chunk-boundary UTF-8 corruption in `execGit` has been silently mangling content and is only now visible                        | N2 fix lands in batch 2 (before any content-fidelity claim is made). Add a spec with a multi-byte payload straddling a 64 KiB chunk boundary                                                                                                                                |
| **A-3** | `IStandaloneDiffEditor.saveViewState()` may not restore collapsed regions across `setModel` in the pinned Monaco version       | Verify empirically in batch 3 before claiming B1 AC3. If it does not, record the shortfall per B0 AC4 rather than reporting a pass                                                                                                                                          |
| **A-4** | Three-layer always-mounted content region regresses layout (two absolutely-positioned Monaco hosts)                            | Both hosts `absolute inset-0`; `layout()` inside `rAF` on becoming visible (the reference implementation's documented gotcha, `code-editor.component.ts:504-510`); visual check in Electron                                                                                 |
| **A-5** | Server-side `snapshotToken` recomputation on every apply adds two git spawns + one FS read to the write path                   | Acceptable — the operation is user-initiated and infrequent. Do not cache the token; a cached token defeats AC6 entirely                                                                                                                                                    |
| **A-6** | `git apply` offset tolerance silently applies a hunk at a shifted position (the "worst case" R-1 names)                        | The `snapshotToken` check makes the pre-image provably identical to what the user saw, so no shift is possible against a fresh snapshot. Additionally parse `git apply`'s stderr for `offset` and log it                                                                    |
| **A-7** | B4's unified exclusion set changes what the file tree shows (`node_modules`, `dist`)                                           | Blocked on Open Question #1; do not implement until answered                                                                                                                                                                                                                |
| **A-8** | C1's `useExisting` provider changes `GitStatusService` instantiation timing                                                    | Verified safe today (constructor registers a destroy hook only). Re-verify if the constructor grows                                                                                                                                                                         |
| **A-9** | Concurrent agents on this checkout (R-8) — batches 2 and 3 both touch `diff-view.component.ts` and `editor-panel.component.ts` | Do not run batches 2 and 3 in parallel. Batches 4/6 touch disjoint files and may run parallel with 3                                                                                                                                                                        |

---

## 11. Open questions

1. **B4 exclusion unification changes tree visibility.** AC2 demands the watcher and the tree agree. They currently disagree in _both_ directions: the tree hides `.nx`/`.cache` which the watcher does not, and the watcher ignores `node_modules`/`dist` which the tree shows. Unifying means the file tree stops showing `node_modules` and `dist` (matching VS Code) — a user-visible change beyond the stated scope. **Alternative**: two named sets with one shared predicate (`TREE_HIDDEN_DIRS`, `WATCH_IGNORED_DIRS` where the latter ⊇ the former), which honours AC2's "single source of truth" for the _mechanism_ while keeping the visibility rule unchanged. Recommend the second; needs a call.

2. **A1 refresh vs `GitStatusService.CACHE_TTL_MS`.** The 5 s TTL governs `git:info` fetches on workspace switch. Diff refresh is a _different_ RPC (`git:diffFile`) driven by the same push, so the TTL does not gate it and no interaction exists. Confirming: the handoff item asks how they interact — the answer is that they do not, and no change to the fetch scheduling documented at `git-status.service.ts:72-87` is proposed. Flagging in case the PM intended something else.

3. **`patch`/`hunks` in `GitDiffFileResult`: A batch or D2 batch?** This plan puts them in D2 to keep the keystone batch tight, accepting one additive (non-breaking) field change to the result interface. The alternative — ship them in the A batch — costs one extra `git diff` per diff open and slightly enlarges the SEQ-1 diff, in exchange for never touching the contract twice. Recommend D2; low stakes either way.

---

## Requirements Concerns

Four items in the provisional `task-description.md` are wrong or under-specified against the tree as it stands. Stating them rather than silently designing around them.

### 1. NFR-5's `platform-core` port mandate is based on a misreading

> "New git capability SHALL be expressed as a port in `platform-core` with adapter implementations, **not** as a branch inside an existing adapter. `git-watcher.service.ts` is Electron-only; capability added there alone does not satisfy this requirement."

The premise is half-right. `git-watcher.service.ts` is indeed Electron-only. But `GitInfoService` (`libs/backend/vscode-core/src/services/git-info.service.ts`) is **not an adapter** — it is a platform-agnostic Node service imported by the shared `GitRpcHandlers`, whose manifest entry is `requires: []` (`manifest.ts:154-158`), and it is registered in VS Code (`phase-3-handlers.ts:56`), Electron (`phase-4-handlers.ts:102`) and CLI (`cli-engine/container.ts:274`). Adding a method there reaches all three runtimes today.

Creating a `platform-core` git port would mean three identical copies of `cross-spawn`-based git code with no per-runtime variation to justify them, and no existing `git-watcher` behaviour would move. **Recommendation**: restate NFR-5's git clause as _"new git capability SHALL be added to `GitInfoService` + `GitRpcHandlers` (already three-runtime) and SHALL NOT be added to `git-watcher.service.ts` or any host-specific handler."_ The one place a genuine port is needed — worktree file reads — already has one (`IFileSystemProvider.readFileBytes`). D2 AC13 needs the same restatement.

### 2. NFR-4 / D2 AC12 point at the wrong guard for this task

`ALLOWED_METHOD_PREFIXES` already contains `'git:'` (`rpc-handler.ts:70`), so no new `git:*` method can hit the "silent runtime crash" mode NFR-4 describes. The real gates are (a) `RPC_METHOD_PRESENCE` in `rpc.types.ts` (compile error if missing) and (b) `GitRpcHandlers.METHODS`, asserted by `rpc-allowlist.spec.ts:43` to partition `RPC_METHOD_NAMES` exactly (**test failure** if missing). Both are hard failures, neither is silent.

**Recommendation**: keep the end-to-end Electron exercise as a DoD item — it is good practice — but stop describing it as the only thing standing between the team and a silent crash for _this_ task. That framing may cause reviewers to look for a missing prefix that cannot be missing, and to under-weight the manifest tuple that actually can be.

### 3. R-2's persisted-tab-state risk does not exist

R-2 is scored High/Medium = 6 and prescribes explicit upgrade-path testing and a first-run purge contingency. `EditorService._workspaceEditorState` is an in-memory `Map` (`editor.service.ts:43-46`); a repository-wide search finds no writer of editor `openTabs` to disk (`layout-rpc.handlers.ts` persists pane widths only). Diff tabs do not survive a process restart today, so there is no stored old-format entry to encounter on upgrade and no migration to write.

**Recommendation**: reduce R-2 to Low/Low, reallocate its budget to R-3 (whose triage matrix is real work), and reword A2 AC5 — "persisted and the workspace is reopened" — to what it can actually test: _a workspace switch away and back within a session restores the same comparison_. That path does exist (`editor-workspace.ts:74-86`) and the design covers it.

### 4. SEQ-3 §4 sequences C1 the wrong way round

> "C1 touches the same message plumbing A1 relies on; if it is done before A1 it will conflict, so it follows A."

The conflict runs the other direction. A1's fix requires a **new subscriber** for `git:status-update` inside the editor lib. If C1 has not landed, A1 must either add a fourth raw `window.addEventListener` (directly violating the lib's own guideline #1, which C1 exists to enforce) or thread the trigger through `EditorWorkspaceHelper`'s raw handler — and C1 then rewrites that code. Doing C1 first means A1 writes its trigger into the final architecture exactly once.

C1 is small and mechanical (four `MESSAGE_TYPES` entries, two services converted, one provider line). Sequencing it first delays the P0 correctness fixes by one small batch and removes rework from the largest, riskiest batch in the task. **Recommendation**: run C1 as batch 1, A-group as batch 2. This violates neither SEQ-1 nor SEQ-2.

### 5. Minor wording — A4 AC1's "HEAD content on the original side"

> "GIVEN a file with git status `D` (deleted in working tree) … a diff SHALL open showing the **HEAD** content on the original side"

Under the A2 comparison model, a worktree deletion opens the `worktree` comparison, whose original side is the **index**. When nothing is staged, index == HEAD and the criterion passes as written; when the file has staged modifications, the index is the correct original and HEAD would be wrong. **Recommendation**: reword to "the pre-deletion content (index) on the original side". Same nit applies to A4 AC2, which is already correct because the staged comparison's original genuinely is HEAD.
