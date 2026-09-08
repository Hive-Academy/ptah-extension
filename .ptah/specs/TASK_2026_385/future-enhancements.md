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

## 3b. Hunk action buttons are unclickable at the dock's default width

**Priority: high. This is a user-facing regression, not a test problem.**

Found while migrating the git e2e specs (Batch 3.3), and confirmed against the
source.

The hunk action cluster (Stage / Unstage / Discard) is a floating Monaco
content widget anchored at the selected hunk
(`diff-view.component.ts:605`, `syncHunkWidget` at `:1567`). Its CSS is
`white-space: nowrap` — and the component's own comment at `:683` says that
exists to stop the buttons wrapping "when the modified pane is narrow", so the
risk was already known.

The dock makes the pane narrow enough to trigger it. `DEFAULT_EDITOR_WIDTH` is
700 px (`electron-layout.service.ts:34`), and `git-dock.component.ts:52` spends
256 px of that on the `w-64` source-control sidebar. That leaves a **~444 px
diff pane**. The three-button `nowrap` cluster overflows the visible width, and
its rightmost buttons land under Monaco's own vertical scrollbar, which paints
on top and swallows the click.

Evidence from the e2e run — the click is intercepted, not missing:

```
locator resolved to <button ... data-testid="hunk-widget-revert" ...>Discard…</button>
<div class="slider"></div> from <div ... class="visible scrollbar vertical">…</div>
  subtree intercepts pointer events
```

`hunk-widget-stage`, the leftmost button, never failed — only the buttons
further right collide. That asymmetry is the signature of the overflow.

**This ships to users.** The same dock, the same 700 px default and the same
collision apply to anyone who has not dragged the divider wider. Discard and
Unstage are simply not clickable out of the box.

It is a consequence of hosting the diff in a narrow docked sidebar instead of
the old `ptah-editor-panel`'s wide main-content tab area, so it did not exist
before this task.

**The e2e specs work around it** by resizing the Electron window to 2200x1000
before interacting. That is a test-side fix and deliberately does NOT hide the
product defect — `diff-view.component.ts` was left untouched.

**Fix**: a design decision, and it belongs to TASK_2026_386 with the dock's
other UI work. Either raise the dock's default width, or let the widget cluster
wrap instead of overflowing, or drop the button labels to icons at narrow
widths. Whichever is chosen, pin it with a test at the default width, not a
widened one.

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

**This is not only a delay.** Because the run exceeds a five-minute timeout, the
hook gets killed mid-run, and a killed hook never restores lint-staged's stash —
which silently reverts tracked files to HEAD. See item 8. Fixing this item
removes the trigger for that data loss, so treat the two together.

---

## 8. A killed pre-commit hook reverts tracked files to HEAD

**Priority: high.** Tooling, not code. **Cause identified 2026-09-07.**

### The symptom

In-place edits to tracked files disappear from the working tree while newly
created files survive untouched. Seen at least three times on this branch by
two independent sessions: Phase 2 lost its edits to the moved files (reviewers
caught it, not the tests), and a peer session saw the same shape in
`libs/frontend/marketplace` and `libs/backend/rpc-handlers`.

### The cause

**`lint-staged`'s stash, plus a killed hook.** `.husky/pre-commit` runs
`npx lint-staged --concurrent false`, and lint-staged's default path opens by
stashing the working tree ("Backing up original state in git stash"), runs its
tasks, then restores. **A hook killed before the restore step never puts the
stash back.** Tracked files revert to their HEAD version; newly created files
survive because they have no HEAD version to revert to. That is exactly the
selective shape observed, and it explains why reverted files came back looking
like clean HEAD rather than corrupted.

`--no-stash` is **not** the fix and must not be added back — the hook's own
comment records why (TASK_2026_224): in lint-staged 16 it implies
`--no-hide-partially-staged`, so tasks run against the full working tree and
the post-task `git add` stages whatever is on disk.

An earlier hypothesis on record — a stale editor buffer overwriting an agent's
disk write — was **withdrawn by the session that proposed it** once the stash
mechanism was found. Do not chase it.

### What triggers the kill here

Item 7. The all-project `nx lint` genuinely needs more than five minutes, so
any five-minute command timeout around `git commit` kills the hook mid-run.
Measured 2026-09-07: exactly that sequence produced both a stale
`.git/index.lock` and the reversion.

### Recovery

**The lost work is recoverable.** The stash entry survives as a dangling
object:

```
git fsck --unreachable | grep commit
git stash apply <sha>
```

Check this **before** re-editing anything, and before making further commits —
they make the entry harder to find.

### The quieter second route

After a successful hook run, `format:write` has rewritten files on disk while
the index still holds the pre-format copy, so `git status` shows `MM` on files
whose worktree already matches HEAD. Harmless alone. But a later
`git commit` **without** a pathspec commits those stale index copies over good
work. Clear them with a plain `git add` on your own paths.

Note the interaction the hook's own comment documents: `git commit -- <paths>`
means `--only`, which commits the **working tree** content of those paths and
bypasses the index. Verify `git diff -- <paths>` is empty before relying on it.

### The `--cached` trap, specifically

A pathspec commit is safe for ordinary edits, which is why several sessions
relied on it all day to keep their commits clear of each other's files. It has
exactly one sharp edge, and it cost a sibling session **348 files** on
2026-09-07.

`git rm -r --cached <path>` drops the index entry and **deliberately leaves the
file on disk** — untracking without deleting. A following
`git commit -- <path>` then reads the worktree, finds the file present and
identical to HEAD, records no change, and **discards the staged deletion**,
reporting success.

The hazard is therefore not "deletions are unreliable through a pathspec." If
the file is genuinely gone from disk, the pathspec commit records the deletion
correctly — that case is handled. It fails only where the index and the
worktree are _meant_ to disagree, which is precisely what `--cached` exists to
create.

Rules that follow:

- Use a pathspec commit for editing work, including deletions where the file is
  actually removed from disk.
- Use a bare `git commit` from a checked index whenever the intent is
  **untracking** rather than editing.
- Either way, verify the commit rather than its exit code. `git show --stat`
  costs nothing and is the only thing that catches this.

### Fixes

1. Raise or remove the five-minute timeout around any `git commit` in this
   repository. The kill is what causes the data loss.
2. Do item 7 — scope the hook's lint to affected projects so it finishes well
   inside any timeout.

**Interim guard, already in use**: after any batch that edits files in place,
re-read each file and confirm the change survived before calling the batch
done. Never trust a batch report that says green.
