# Future enhancements — TASK_2026_385

Items found during Phase 3 that were deliberately **not** fixed in this task.
Each says what it is, why it was deferred, and what it would cost. Nothing here
is a blocker for Phase 4.

Recorded 2026-09-07.

---

## 1. git-ui's weight sits in the initial bundle, not the lazy chunk

**Priority: high.** This is the largest finding of Phase 3.

`apps\ptah-extension-webview\src\app\app.config.ts:58-63` statically imports
`DiffTabsService`, `GitBranchesService`, `GitStatusService` and
`WorktreeService` from `@ptah-extension/git-ui`, to register them in the
`MESSAGE_HANDLERS` multi-provider. A static import of the library barrel pulls
the whole graph — the components too — into the **initial** bundle.

Measured against `239f8013e`: git-ui's real payload is ~78 kB raw in
`chunk-KAUG6AKV.js`, an _initial_ chunk. The lazy
`import('@ptah-extension/git-ui')` that Batch 3.1 added to
`electron-shell.component.ts` emits only a **559-byte** re-export barrel.

So the dock's lazy mount buys nothing today. This is not a defect in Batch 3.1
or in the Phase 2 carve: the services must be registered eagerly to receive
`git:status-update` pushes, and they currently share a library with the
components.

**Fix**: give the four services their own secondary entry point
(`@ptah-extension/git-ui/services`, the shape `@ptah-extension/editor/services`
already uses at `app.config.ts:57`), leaving the components behind the lazy
barrel. `app.config.ts` then imports only the services entry point.

**Cost**: one `ng-packagr` secondary entry point, an `eslint.config.mjs`
`checkDynamicDependenciesExceptions` entry with a measured justification, and
one import rewrite. Re-measure the chunk table afterwards to confirm the
components actually left the initial bundle.

**Blocked on**: nothing. Best done after Phase 4 deletes the editor library, so
the measurement is taken against the final import graph.

---

## 2. A bundle budget over git-ui cannot be expressed today

**Priority: medium.** Depends on item 1.

This was Batch 3.4, closed as obsolete. Two independent blockers:

- There is no meaningful lazy chunk to budget (item 1).
- Angular's `@angular/build:application` budget checker matches a
  `"type": "bundle"` entry by `chunk.names.includes(budget.name)`, and the chunk
  name derives from the resolved entry-point file's basename. git-ui's chunk is
  named `index`, shared with six unrelated lazy chunks, so a budget named
  `git-ui` matches nothing, scores `size: 0`, and always passes. esbuild-based
  Angular does **not** honour webpack-style `webpackChunkName` comments.
  `any` / `anyScript` are not a substitute: any threshold low enough to matter
  for git-ui fails immediately on the unrelated 329 kB chunk.

**Fix**: do item 1 first. A distinct services entry point gives the components'
chunk a distinguishable name, at which point a `"type": "bundle"` budget can
key on it. Re-measure before choosing a number.

---

## 3. `git:push` failure is silent to the user

**Priority: medium.**

`libs\frontend\git-ui\src\lib\git-dock\git-dock-header.component.ts:124-132`
awaits the push result and discards it. `git-branches.service.ts:505-532` only
logs to `console.error`. On failure the button simply becomes clickable again,
the ahead-count badge is unchanged because nothing refreshed, and the user's
only signal is that "Push" is still there.

Pre-existing debt, carried over verbatim from
`git-status-bar.component.ts`. Batch 3.1's contract said **port, not redesign**,
so it was deliberately not fixed. It is now in a live file and worth closing.

**Fix**: surface the returned `GitPushResult.error` in a transient toast or an
inline banner, and refresh the ahead count on the failure path.

---

## 4. A non-git workspace shows an empty file list with no message

**Priority: low.**

`GitDockComponent` always renders `ptah-source-control-panel`; only the header
is gated on `gitStatus.isGitRepo()`
(`git-dock-header.component.ts:35`). In a workspace that is not a git
repository the user sees an empty panel with no explanation.

`SourceControlPanelComponent` was outside Batch 3.1's scope, so this was left
alone.

**Fix**: gate the dock body on `isGitRepo()` too, with an empty state that says
the workspace is not a git repository.

---

## 5. Duplicate RPC method registration overwrites silently

**Priority: medium.** Infrastructure, wider than this task.

`RpcHandler.registerMethod`
(`libs\backend\vscode-core\src\messaging\rpc-handler.ts:153-169`) overwrites an
existing method with only a `logger.warn` that nothing reads at runtime.
`resolveRpcHandlerPlan` calls `register()` once per plan step in manifest
order, and `register()` is not entry-scoped — it wires every method its class
touches. So two classes touching one method name means last-writer-wins, with
no build-time and no dev-mode signal.

Batch 3.2 hit exactly this: `EditorRpcHandlers.register()` would have re-bound
`file:open` after the new handler on every boot, silently restoring the old
file-read behaviour. It was caught by review, not by a test.

`verifyAndReportRpcRegistration` / `assertOnDrift` do not catch it — they check
_set coverage_ against `RPC_METHOD_NAMES`, not collisions within one name.

**Fix**: a dev-mode assertion in `registerHandlers` that fails when two plan
steps register the same method name.

**Cost**: small, and it converts a whole class of silent regression into a loud
boot failure.

---

## 6. `EditorRpcHandlers` is still app-local on two hosts

**Priority: low.**

`APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` (`eslint.config.mjs:38-42`) still
holds three entries, all awaiting the P3 move into
`libs/backend/rpc-handlers`. The oldest has been there since TASK_2026_173.

Batch 3.2 kept the list shrinking rather than growing — its new handler went
into the lib instead of onto the list — but did not shorten it.

**Fix**: fold into whatever task deletes the editor surface on each host. Two
of the three entries are `editor-rpc.handlers.ts` files that Phase 4 already
touches.

---

## 7. The pre-commit hook lints every project

**Priority: medium.** Repository-wide, not specific to this task.

The husky pre-commit hook runs `nx lint` across all 73 projects rather than the
staged files. Measured 2026-09-07: a `no-unexpected-multiline` error in an
untracked `chat-ui` spec owned by a different session blocked every commit in
this working tree, including a finished and fully verified Batch 3.1. The same
run also exceeded a five-minute timeout, and the killed process left a stale
`.git/index.lock` behind.

On a tree shared by several sessions this means any one session's mid-edit
error stops all work, and the failure names a project the committer never
touched.

**Fix**: scope the hook's lint to affected projects (`nx affected -t lint`), or
to the staged files. Keep the full sweep in CI, where it belongs.

---

## 8. Files revert to HEAD on disk mid-run

**Priority: high.** Tooling, not code. Unproven cause.

Reported twice on this branch, by two independent sessions. In-place edits to
existing files disappear from the working tree while newly created files
survive untouched. Phase 2 lost its edits to moved files this way and the
reviewers, not the tests, caught it. A peer session reported the same shape in
`libs/frontend/marketplace` and `libs/backend/rpc-handlers`.

The leading hypothesis, from that peer and **not proven**, is a stale editor
buffer: a file already open in the editor holds an older in-memory copy, an
agent writes the file on disk, and the editor later saves its stale buffer over
that write. A newly created file has no buffer to overwrite, which matches the
selective shape and the fact that reverted files came back looking like clean
HEAD rather than corrupted.

**Discriminator if it recurs**: check unsaved editor buffers at that moment. An
unsaved buffer for the reverted file confirms the hypothesis; a clean result
rules it out and points elsewhere.

**Interim guard, already in use**: after any batch that edits files in place,
re-read each one and confirm the change survived before calling the batch done.
Never trust a batch report that says green.
