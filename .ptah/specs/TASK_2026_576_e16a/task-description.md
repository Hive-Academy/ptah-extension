# Requirements - TASK_2026_576_e16a

## Context

Ptah's git surface today is an Electron-only right dock (`GitDockComponent`,
`libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:44-294`). The dock
has four parts: a header (branch picker, stash popover, Open-in, fetch/pull/push),
a source-control rail (staged and unstaged changed-file trees, commit box,
worktree section), a tab strip of Monaco diff and read-only Monaco file tabs with
per-hunk stage, unstage and revert, and a read-only branch-review mode. VS Code
mounts no git UI: file links go to native `file:open`
(`libs/frontend/chat/src/lib/services/file-link-router.service.ts:94-169`). The
webview statically imports four git-ui services
(`apps/ptah-extension-webview/src/app/app.config.ts:62-67`). That import puts all
of git-ui (~41 KB gz) in the eager `main.js` on both hosts, including VS Code,
where it is dead code (`research_notes/In app editor alternatives/bundle-measurements-and-vscode-path.md`, Q1).

The user wants two things. First, the git reliability defects fixed. The audit
in `research_notes/In app editor alternatives/git-backend-root-causes.md` ranks
14 root causes. Most of the "buggy" feel comes from the layers above the git
plumbing, not from the editor:

- the UI throws away mutation results, and commit checks transport success
  rather than git success (`libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:457-496`);
- hook-running commands have a 10 s timeout;
- a status failure renders as a clean tree;
- the status parser does not use `-z`;
- the watcher misses events outside Windows and in linked worktrees.

Second, the user wants a more advanced, polished review experience:

- a change-set card in the chat transcript;
- a review canvas with a virtualized multi-file diff, per-hunk accept/reject
  and line comments sent to the agent;
- a commit composer;
- a task/worktree view with PR and CI status;
- a conflict banner;
- a per-task history timeline;
- a single-file spot editor.

Monaco leaves the review surface. On VS Code the review path uses native editor
views, not an in-webview git UI.

This matters because Ptah's product direction (TASK_2026_384/386) is to own the
agent review loop, not to compete with VS Code as an IDE. Today the loop is
unreliable (lost commit errors, false "clean tree", broken non-ASCII paths) and
incomplete (no transcript change sets, no conflict awareness, no VS Code review
path). The earlier plan, TASK_2026_386, landed only in part. Its carrier still
reads `backlog`.

## Classification

- Type: FEATURE. It adds new user-facing surfaces and reworks an existing one.
  Track 1 is bug fixing, but it ships inside this feature because the new UI
  relies on the corrected result contracts.
- Estimate: XL. Two tracks:
  - 14 backend and UI root causes across `vscode-core`, `rpc-handlers`,
    `ptah-electron`, `agent-sdk`, `cli-engine` and `git-ui`;
  - seven new or rebuilt surfaces across two hosts;
  - a renderer swap (Monaco out) that touches `git-ui`, `skill-synthesis-ui`,
    the webview build and Electron packaging.

  This cannot land as one batch. See the phase split below.

- Priority: not defined here. The repository has no priority scale for task
  carriers.

## Proposed phase split

One task. Each phase is its own gate and its own PR-sized set of batches. Track 1
comes first because every later surface consumes its result contracts. The
user decides at Gate 1 whether any phase becomes a separate task.

| Phase                     | Content                                                                                                                              | Depends on                                 | Could be a separate task?                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------- |
| P1 Reliability core       | Root causes 1-8 (Requirement 1)                                                                                                      | nothing                                    | Yes. It ships value alone and has no UI redesign. |
| P2 Reliability hardening  | Root causes 9-14 (Requirement 2)                                                                                                     | P1 (shared services)                       | Yes                                               |
| P3 Foundation             | Eager-import removal, renderer size decision, VS Code `ptah.review.*` commands, host-agnostic change-set card (Requirements 3, 4, 5) | P1                                         | No                                                |
| P4 Electron review canvas | Review canvas, hunk accept/reject, line comments, spot editor, Monaco removal, parity migration (Requirements 6, 7, 8, 13)           | P3                                         | No                                                |
| P5 Workflow surfaces      | Commit composer, task/worktree view with PR/CI, conflict banner, history timeline (Requirements 9-12)                                | P1, P2 (root cause 12 detection), P4 shell | Yes. The PR/CI part (`gh`) is the most separable. |

## Scope

In scope:

- Track 1: root causes 1-14 from `git-backend-root-causes.md` ("Top root causes"
  list), each with a real-git or behavioural spec.
- Removal of the eager git-ui import in `app.config.ts:62-67`. The push-message
  handlers stay registered.
- A decision on the review diff renderer from a measurement taken in the Nx
  webview production build: `@pierre/diffs` (preferred) or `@codemirror/merge`
  (fallback).
- A host-agnostic change-set card in the chat transcript.
- VS Code: new `ptah.review.*` commands that open native `vscode.changes`,
  `vscode.diff`, `git.openMergeEditor` and `workbench.view.scm`, called from the
  card.
- Electron:
  - review canvas (virtualized multi-file diff, changed-file tree, per-hunk
    accept/reject through `git:applyHunks`, line comments to the agent);
  - single-file CodeMirror 6 spot editor;
  - commit composer (AI message, inline hook output);
  - task/worktree view (branch, ahead/behind, PR and CI status through `gh`);
  - merge/rebase/cherry-pick conflict banner;
  - per-task history timeline.
- Removal of Monaco from the webview and Electron renderer: the
  `monaco-editor` and `ngx-monaco-editor-v2` dependencies, `provideMonacoEditor`,
  the `/assets/monaco` copy, `MonacoLoaderService` and `monaco-theme.ts`.
- Migration of every existing Monaco consumer to the new renderer or editor.
  This includes `skill-synthesis-ui`'s `LazyDiffViewComponent`
  (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.ts:1-19`).
- Preservation of every existing git-ui capability listed in
  `parity-inventory.md`, unless the user approves a proposed removal.

Out of scope:

- WebContainers. They solve a different problem (a browser-side Node runtime),
  and the license is closed (`webcontainers-and-runtimes.md`).
- dugite or a bundled git binary. System git stays: GPL-2.0 binaries, 30-65 MB
  per platform, and version drift from the git the agents use (`synthesis.md` §3.5).
- An in-app 3-way merge editor. No reference product ships one. Conflicts are
  handed to the agent or to an external or native merge editor (TASK_2026_386
  owner decision).
- A workspace file tree, search-in-files, a multi-tab editor, a terminal and
  LSP. TASK_2026_385 retired these and TASK_2026_386 said they do not return.
- Mounting git-ui in a VS Code sidebar. VS Code's native SCM, diff and merge
  editors cover the need (`bundle-measurements-and-vscode-path.md` Q2, option A
  verdict).
- Creating, merging or commenting on PRs from Ptah. This task shows PR and CI
  status and an "open PR in browser" link only. PR creation is a follow-up task
  (see Open questions).
- Pre-turn snapshots for per-turn diffs. That needs a snapshot store and a
  `TextDocumentContentProvider`, and nobody has designed it
  (`bundle-measurements-and-vscode-path.md` Q2 Gaps). In this task, card diffs
  compare the current working tree against HEAD, or against the task's base
  branch in the canvas. Snapshots would go to a follow-up task.
- LFS smudge handling and `working-tree-encoding` transcoding in diffs. This
  task detects both and labels them (Requirement 2.4). It does not render them
  correctly.
- The CLI host (`apps/ptah-cli`). It gets no new UI. It receives only the
  backend fixes that Track 1 makes in shared services, including root cause 13.
- Updating the stale TASK_2026_386 carrier. That is carrier housekeeping for the
  orchestrator, not deliverable work.

## Requirements

### 1. Reliability core (root causes 1-8, must-have)

Requirement: the git backend and the Electron git UI shall report git's real
outcome for every operation, so that the user never sees success, a clean tree
or "not a repo" when git failed.

Acceptance criteria:

1. RC1:
   - When `git:stage`, `git:unstage`, `git:discard`, stage-all or unstage-all
     returns `data.success: false`, the UI shall show `data.error` next to the
     affected row or section until the user dismisses it or the next action
     succeeds.
   - After every mutation, success or failure, the status list shall refresh
     from git.
2. RC1: when a pre-commit or commit-msg hook rejects a commit (transport
   `success: true`, `data.success: false`):
   - the commit message shall be kept;
   - the hook's output shall be shown;
   - no success indication shall appear.

   A spec with a real failing hook, not a mocked `{ success: true }`, shall
   prove it.

3. RC2:
   - When a commit runs a hook that takes 60 s, the commit shall complete
     without a timeout.
   - The same holds for checkout, stash apply/pop and push when their hooks run
     longer than 10 s.
   - A cancel or timeout during a hook shall not leave `.git/index.lock` behind.
4. RC3:
   - When `git status` exits non-zero, times out or cannot take the lock, the
     `git:info` result shall carry a `statusUnavailable` reason that
     distinguishes timeout, error and lock.
   - The UI shall keep showing the last good file list, marked as stale with
     that reason, and not an empty tree.
   - A transient `isGitRepo` failure shall not render "not a Git repository".
5. RC4: when the repository contains files whose names have non-ASCII
   characters (for example `café.txt`, CJK or Arabic names), a double quote, a
   backslash, or a leading or trailing space:
   - status shall list the real names;
   - line counts shall show;
   - diff, stage, unstage and discard shall succeed on each of them.
6. RC4: when a staged rename is discarded, the operation shall succeed with no
   "pathspec did not match" error. A real-git spec shall cover a rename, a quoted
   path and a space-padded path.
7. RC5 (Electron, on Linux, macOS and Windows): when an external process changes
   HEAD, the index, a nested ref (`refs/heads/x`, `refs/remotes/origin/x`),
   `packed-refs`, `MERGE_HEAD` or the linked-worktree common dir, the status and
   branch views shall update without a worktree file event. Examples of such a
   process: a terminal `git add`, `git commit`, `git fetch`, or the agent's
   Bash. This covers files that did not exist when the watcher started, and
   repeated writes after git's lock-and-rename.
8. RC6:
   - When two Ptah mutations run at the same time in one repository, they shall
     run one after the other, and both shall succeed.
   - When a Ptah mutation meets an `index.lock` held by another process, it
     shall retry for a bounded time. If the lock remains, the user shall see
     "Another git process is using this repository", never the raw stderr.
9. RC7: when the user's git config sets `diff.noprefix=true`, custom
   `diff.srcPrefix`/`dstPrefix`, or a textconv driver for a file, hunk stage,
   unstage and revert shall still succeed on that file. A real-git spec shall
   prove each case.
10. RC8:
    - When push, pull or fetch runs longer than 30 s and finishes before the
      backend limit, the UI shall show the real outcome, not
      "RPC timeout: git:push".
    - While the operation runs, the sync controls shall show it is in progress.

### 2. Reliability hardening (root causes 9-14, should-have)

Requirement: branch, worktree, diff-refresh, repository-state and DI behaviour
shall not lose work, leave debris or show stale data.

Acceptance criteria:

1. RC9:
   - When the user creates a new branch with uncommitted changes, including
     untracked files, the branch shall be created and the changes carried over,
     as `git switch -c` does.
   - When the user switches to an existing branch with changes that would be
     overwritten, the UI shall offer "Stash & switch" and "Cancel". "Discard &
     switch" stays available only as a separately confirmed action.
   - Checking out a remote branch (`origin/x`) shall create or reuse a local
     tracking branch `x`, not detach HEAD.
2. RC10:
   - When Ptah creates an agent worktree under `.claude-worktrees/`, it shall
     add that directory to the repository's `.git/info/exclude` if it is not
     already ignored. The directory shall then not appear in `git status` or in
     "Stage all".
   - When the SDK `WorktreeRemove` hook fires, the worktree directory shall be
     removed and `git worktree prune` shall run.
   - Worktrees that git reports as `locked` or `prunable` shall be labelled as
     such in the UI.
   - `git:worktrees`, `git:addWorktree` and `git:removeWorktree` shall act on
     the `workspaceRoot` given in the request, like the other git RPCs.
3. RC11:
   - When a status push arrives, only open diffs whose path is in the change
     set, or all of them if the index or HEAD changed, shall be re-read.
   - A refresh requested while the same diff is already refreshing shall run
     once more afterwards, not be dropped.
4. RC12:
   - When the repository is mid-merge, mid-rebase or mid-cherry-pick
     (including inside a linked worktree), `git:info` shall report the operation
     and the conflicted paths.
   - Unmerged entries shall be reported as conflicted, not as `M`.
   - A diff read of a file larger than a fixed size limit shall return a
     "too large" result instead of sending the content.
   - LFS pointer files shall be labelled as such.
5. RC13: in VS Code and the CLI, invalidating the git cache from the worktree
   hook, the task sweep or the file-link policy shall be visible to the next
   `git:*` RPC. In other words, `GitInfoService` is one instance per host, as in
   Electron.
6. RC14: when a ref argument begins with `-` (for example
   `--output=/tmp/x`), `getLastCommit`, `checkout` and every other user-ref call
   site shall refuse it or pass it after `--end-of-options`/`--`. It shall never
   be read as a git option. A spec shall cover each call site.

### 3. Startup bundle and renderer decision

Requirement: the webview build shall carry no git UI code in its eager bundle.
The review renderer shall be chosen from a measured number, not from an
estimate.

Acceptance criteria:

1. When the webview production build finishes, no eager chunk shall contain a
   `ptah-git-*` or `ptah-diff-view` component selector (or its successors).
   `git:status-update`, `git:worktreeChanged` and `file:content-changed` pushes
   shall still reach their handlers. The existing routing specs
   `apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts` and
   `git-dock-arming-identity.spec.ts`, or their updated equivalents, shall pass.
2. Before any review-canvas batch starts, a measurement recorded in the task
   folder shall report, from the Nx webview production build:
   - the initial and lazy gzip size of `@pierre/diffs` (pinned exact version,
     fine-grained Shiki grammars, JavaScript regex engine);
   - the same for `@codemirror/merge`.

   The renderer choice and its reason shall be stated there.

3. When the chosen renderer is `@pierre/diffs`, its hunk indices shall map
   one-to-one onto the `@@` hunks that `git:applyHunks` consumes. A spec shall
   prove this on a multi-hunk, a rename and a CRLF file.

### 4. Change-set card in the chat transcript (both hosts)

Requirement: a user reading a chat session can see, at the end of each agent
turn that changed files, which files changed and by how much, and can open a
review from there.

Acceptance criteria:

1. When an agent turn ends after it wrote, edited or deleted at least one file,
   the transcript shall show one card for that turn. The card lists each file
   with its status (added, modified, deleted, renamed) and its +/- counts, plus
   the totals.
2. When a turn changed no files, no card shall appear.
3. When a file on the card no longer differs from HEAD (it was committed or
   reverted), the card shall mark that file as such, not show stale counts.
4. When the git status is unavailable (Requirement 1.4), the card shall show
   the file names with "counts unavailable", not zeros.
5. On Electron, "Review" shall open the review canvas scoped to the card's
   files, and a file row shall open that file in the canvas.
6. On VS Code, the card's actions shall be served by Requirement 5.
7. The card shall render from persisted session data when an old session is
   reopened. It shall not depend on a live stream.

### 5. VS Code native review path

Requirement: VS Code users review agent changes in VS Code's own diff, changes,
merge and SCM views, launched from the change-set card, with no git UI mounted
in the webview.

Acceptance criteria:

1. When the user clicks "Review all" on a card in VS Code, a native multi-file
   changes editor shall open. It lists the card's files, each compared against
   HEAD. Added files have no left side and deleted files have no right side.
2. When the user clicks a file row on the card in VS Code, a native diff editor
   shall open for that file against HEAD.
3. When a card's file is conflicted, its action shall open VS Code's merge
   editor for that file.
4. "Open Source Control" shall reveal VS Code's Source Control view.
5. The webview shall reach these views only through new `ptah.review.*`
   commands. The `command:execute` allowlist
   (`libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:27-39`)
   shall not gain `vscode.diff`, `vscode.changes` or any other non-`ptah.`
   entry.
6. Each `ptah.review.*` command shall refuse, and not open, a path that
   resolves outside the workspace folders.
7. When the built-in `vscode.git` extension is disabled or not yet active, file
   diffs shall still open against HEAD content, and the card shall stay usable.
8. The VS Code webview shall mount no git dock, review canvas or spot editor.
   The VSIX shall contain no Monaco, CodeMirror or diff-renderer assets that
   exist only for those surfaces.

### 6. Electron review canvas

Requirement: an Electron user reviews all the changes of a task or turn in one
scrolling view, decides hunk by hunk, and sends line feedback to the agent.

Acceptance criteria:

1. When the canvas opens for a working tree, it shall list every changed file
   (staged and unstaged, or the card's subset) in a changed-file tree and in a
   continuous scrolling diff. Selecting a file in the tree shall scroll its diff
   into view.
2. When the change set holds at least 200 changed files, or a file with 10,000
   changed lines, the canvas shall stay scrollable and responsive: off-screen
   files are not rendered. Files over the size limit (Requirement 2.4) shall
   show a "too large to display" row with Open-in.
3. When the user accepts a hunk in an unstaged diff, the hunk shall be staged
   through `git:applyHunks`. The view shall update from a fresh git read, not
   from local state alone.
4. When the user rejects a hunk in an unstaged diff, a confirmation shall
   appear. After confirmation the hunk is reverted through `git:applyHunks`.
5. In a staged diff, unstage shall be offered per hunk. In a branch or
   historical comparison, no hunk mutation shall be offered.
6. When a hunk action is refused (`STALE_SNAPSHOT`, offset mismatch, lock), the
   canvas shall show the backend's sanitized reason next to the hunk and
   re-read the diff. It shall never apply to a renumbered hunk.
7. When the user adds a comment on one or more lines and chooses "Send to
   agent", the comments shall arrive as one message in the chat session that
   owns the change set. Each comment carries the file path, the line range and
   the quoted lines. Unsent comments shall survive closing and reopening the
   canvas within the same app session.
8. The canvas shall offer split and unified layouts. The choice shall persist
   across restarts (today's setting key is `diff.renderSideBySide`).
9. Branch review shall remain available: pick base and head, see totals, filter
   files, mark files as viewed. Viewed marks persist per repository.
10. Binary files, LFS pointers, submodules and conflicted files shall each show
    a labelled row with no attempt to render text.

### 7. Single-file spot editor (Electron)

Requirement: an Electron user can make a small edit to one file without leaving
Ptah. It is not an IDE.

Acceptance criteria:

1. When the user chooses "Edit" on a file in the canvas, or opens a chat file
   link, one file shall open in a CodeMirror 6 editor with syntax highlighting
   for the file's language, at the linked line when one is given.
2. When the user saves, the file shall be written to disk, and the canvas and
   status shall reflect the change.
3. When the file changed on disk after it was opened (for example, the agent
   edited it), save shall not overwrite silently. The user shall see a conflict
   choice: reload, or overwrite.
4. Opening a second file shall replace the first. When the first has unsaved
   changes, the user shall be asked first. There shall be no tabs, file tree,
   LSP, go-to-definition or search-in-files.
5. Markdown files shall keep a rendered preview toggle. Files over 512 KB shall
   keep today's preview limit
   (`libs/frontend/git-ui/src/lib/file-view/file-view.component.ts:32`).
6. Paths the backend refuses shall show today's blocked state with an Open-in
   action and the outside-workspace confirmation
   (`file-view.component.ts:102-192`).

### 8. Monaco removal

Requirement: Monaco shall no longer ship in the webview or the Electron
renderer.

Acceptance criteria:

1. After the change, the packages `monaco-editor` and `ngx-monaco-editor-v2`
   shall not appear in root `package.json` dependencies.
   `provideMonacoEditor` shall not appear in `app.config.ts`. No `assets/monaco`
   folder shall exist in `dist/apps/ptah-extension-webview` or the Electron
   renderer output.
2. `apps/ptah-electron/src/config/packaged-deps.spec.ts` shall assert that
   Monaco is absent from the product, not only from the main manifest.
3. The Skills tab clone-diff drawer (`LazyDiffViewComponent`) shall render its
   in-memory current-vs-proposed diff with the new renderer and keep its lazy
   boundary.

### 9. Commit composer (Electron)

Requirement: an Electron user commits staged changes with a message they can
generate, edit and see the hook result of, without leaving the review.

Acceptance criteria:

1. When the user clicks "Generate message" with staged changes, a proposed
   message shall be filled in from the staged diff. The user can edit it.
   Nothing shall be committed until the user clicks Commit.
2. When message generation fails or no provider is available, the composer
   shall say so and keep the field editable. The Commit button shall still work
   with a typed message.
3. When the commit runs hooks, their output shall stream into the composer as
   they run.
4. On hook failure, the full output and exit status shall stay visible, and the
   message shall be kept (Requirement 1.2).
5. On success, the new commit's short hash and subject shall be shown, and the
   message field cleared.
6. Commit shall be disabled while nothing is staged or the message is empty.
   The staged-file count shall be visible.

### 10. Task / worktree view (Electron)

Requirement: an Electron user sees, for the task or worktree they are in, where
its branch stands locally and on the remote, including its PR and CI status.

Acceptance criteria:

1. The view shall show the current branch, its upstream, and ahead/behind
   counts that update after fetch, pull, push or an external ref change
   (Requirement 1.7).
2. The view shall list the repository's worktrees with branch, path, main,
   active, locked and prunable labels. It keeps today's switch, add (with
   optional path and new-branch toggle), remove and force-remove capabilities.
3. When `gh` is installed and authenticated and the branch has a PR, the view
   shall show the PR number, title, state (open, draft, merged, closed), review
   decision and CI check summary (passing, failing, pending counts). There
   shall be an action to open the PR in the browser.
4. When `gh` is missing, unauthenticated or the remote is not GitHub, the view
   shall show that reason in one line, with no error styling and no repeated
   prompts. The rest of the view works.
5. PR/CI status shall refresh on view open, after push, and on a manual refresh.
   It shall not poll more often than once a minute while the view is visible.

### 11. Conflict banner (Electron)

Requirement: when the repository is mid-merge, mid-rebase or mid-cherry-pick, an
Electron user is told clearly and given the three ways out.

Acceptance criteria:

1. When Requirement 2.4 reports an operation in progress, a banner shall appear
   above the review surfaces. It names the operation, the conflicted-file
   count and the files.
2. "Ask agent to resolve" shall send the active session a message that names
   the operation and the conflicted paths.
3. "Open in editor" shall open the conflicted file in the user's chosen
   external editor. When that editor supports a merge tool, it opens the merge
   tool. On Windows this shall work when the editor launcher is a `.cmd` shim.
4. "Abort" shall ask for confirmation, then run the matching abort (merge,
   rebase or cherry-pick). The banner shall disappear once git reports no
   operation.
5. When no conflicted paths remain, the banner shall offer "Continue"
   (commit or `--continue`). Continue shall not be offered while conflicts
   remain.
6. Delete/modify, symlink and submodule conflicts shall not launch an
   interactive merge tool. They offer "Ask agent" and "Open folder" only.

### 12. Per-task history timeline (Electron)

Requirement: an Electron user sees what happened on the task's branch over time.

Acceptance criteria:

1. The timeline shall list the commits on the task branch since it left its
   base branch, newest first. Each entry shows short hash, subject, author and
   relative time.
2. Selecting a commit shall open its changes in the review canvas as a
   read-only historical comparison.
3. When the branch has no commits of its own, the timeline shall say so.
4. The timeline shall show the stash entries and keep today's stash
   capabilities:
   - list with message, branch and age;
   - apply, pop, and drop with confirmation;
   - per-file stash diff.

   It may also keep the header popover.

### 13. Parity of the redesigned Electron surface

Requirement: nothing the current git dock can do is lost without the user's
approval.

Acceptance criteria:

1. Every row of `parity-inventory.md` whose decision is `keep` or `move` shall
   have a passing test at the named location before the batch that removes the
   old component is accepted.
2. No `remove-proposed` row shall be removed unless the user approved it at
   Gate 1. Rows the user rejects become `keep` or `move`.

## Non-functional requirements

- Bundle:
  - The webview `initial` budget in
    `apps/ptah-extension-webview/project.json:57-62` (warning 2.5 MB, error
    3.5 MB) shall still pass.
  - The eager `main.js` gzip size shall not grow compared with the base
    commit's build (measured with the same build configuration). Every new
    surface loads lazily.
- Startup: `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` shall
  report a second-boot "reload → canvas interactive" time no worse than the base
  commit on the same machine, recorded in the task folder. The repository sets
  no numeric TTI threshold, and this task does not invent one.
- Angular: new components shall be standalone and `OnPush`, with state in
  signals (the pattern every existing git-ui component uses, for example
  `git-dock.component.ts:220`).
- Library rules: barrels ≤150 lines, the layer rule and naming suffixes per
  `CONVENTIONS.md`. git-ui must not depend on `chat`
  (`libs/frontend/git-ui/src/index.ts:5-6`).
- Hosts: Electron gets the full surface. VS Code gets the card and
  `ptah.review.*` only. The CLI gets backend fixes only. The VS Code engine
  floor `^1.100.0` shall keep working
  (`apps/ptah-extension-vscode/package.json:15-17`). If `vscode.changes` is
  unavailable at the floor, the card falls back to per-file `vscode.diff`.
- Platforms: Windows, macOS and Linux. Requirements 1.7 and 11.3 are
  explicitly cross-platform and need evidence on each OS, or a CI matrix run.
- Security:
  - No new webview-to-host command bypasses the `ptah.` allowlist
    (Requirement 5.5).
  - All path arguments are workspace-contained (Requirement 5.6).
  - Git error text shown to users carries no absolute paths or raw stderr
    beyond hook output the user asked to see (the existing NFR-8 rule in
    `diff-view.component.ts:386-391`).
  - Refs are guarded against flag injection (Requirement 2.6).
- Accessibility:
  - Every new interactive control is keyboard reachable with a visible focus
    ring and an accessible name.
  - Hunk navigation and actions work without a mouse, as today's roving-tabindex
    hunk toolbar does (`diff-view.component.ts:249-345`).
  - Destructive confirmations use a modal alertdialog that focuses the
    non-destructive choice (today's revert dialog, `diff-view.component.ts:482-567`).
  - New surfaces shall pass an axe-core scan (the repo already carries
    `axe-core`/`@axe-core/playwright`, `package.json:207,253`) with no
    critical or serious violations, in dark and light themes.

## Stakeholders

| Stakeholder                                                | What they need from this change                                          | How they will judge it                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Electron desktop user reviewing agent work                 | Trustworthy git state and a fast place to accept or reject agent changes | Commit errors show; no false "clean tree"; hunk accept/reject works on first try; the canvas scrolls smoothly on large change sets |
| VS Code extension user                                     | Review agent changes in VS Code's own views                              | The card opens native diffs and changes views; no extra startup weight                                                             |
| Non-English-locale user                                    | File names in their language work                                        | Stage/diff/discard on non-ASCII names succeed                                                                                      |
| User whose repo has hooks (husky, lint-staged, commitlint) | Ptah commits behave like terminal commits                                | No 10 s kill, no stranded `index.lock`                                                                                             |
| Agent session (the model)                                  | Receives review feedback it can act on                                   | Comment messages carry path, line range and quoted lines                                                                           |
| Ptah maintainers                                           | Smaller renderer, fewer flaky git specs, no dead Monaco                  | Monaco gone from `package.json` and dist; real-git specs cover root causes 1-14                                                    |
| VS Code Marketplace scanner                                | No `eval`/`new Function` bundles in the VSIX                             | VSIX packaging passes unchanged (`.vscodeignore:47-49` no longer needed for Monaco)                                                |

## Risks

| Risk                                                                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pierre/diffs` costs more in the Angular build than measured with esbuild, or churns between versions | MEDIUM     | HIGH   | Architect runs the Requirement 3.2 measurement as the first P3 batch. Pin an exact version. Keep `@codemirror/merge` as the documented fallback before any canvas batch starts. |
| Pierre's hunk model does not line up with git's `@@` hunks after renames or CRLF                       | MEDIUM     | HIGH   | Requirement 3.3 spec gates the renderer choice. Senior-tester writes it against real git before canvas UI work.                                                                 |
| Pierre's shadow-DOM rendering fails the accessibility requirements (keyboard hunk navigation, ARIA)    | MEDIUM     | MEDIUM | ui-ux-designer specifies hunk controls rendered by Angular outside the shadow root. Visual-reviewer runs axe in P4.                                                             |
| `vscode.changes` or `git.openMergeEditor` behave differently at engine floor 1.100                     | MEDIUM     | MEDIUM | Architect confirms against the 1.100 API. Requirement 5.7 fallback to per-file `vscode.diff` is specified up front.                                                             |
| Watcher rework (RC5) regresses Windows, which works today                                              | MEDIUM     | HIGH   | Keep the Windows e2e `git-watcher.spec.ts` green. Add real-git watcher specs per OS in the CI matrix before merging P1.                                                         |
| Serializing writes (RC6) deadlocks with `applyHunks`'s internal multi-step sequence                    | LOW        | HIGH   | Architect defines the mutex scope around whole operations, not single spawns. Backend-developer adds a concurrency spec with two parallel hunk applies.                         |
| Removing the eager import breaks push routing for services not yet instantiated                        | MEDIUM     | HIGH   | Requirement 3.1 keeps the routing specs as gates. Frontend-developer lands the import change in its own batch.                                                                  |
| Removing Monaco silently drops a capability (glyph accelerator, layout persistence, stale chip)        | MEDIUM     | MEDIUM | Enforced through `parity-inventory.md` (Requirement 13). Team-leader blocks the deletion batch until each row's test passes.                                                    |
| The `gh` CLI differs across OSes or prompts interactively                                              | LOW        | MEDIUM | Run `gh` with non-interactive env and a JSON output flag, time-bounded. Requirement 10.4 degrades quietly.                                                                      |
| Scope is XL and phases drift into each other                                                           | HIGH       | MEDIUM | Phase gates as in the split above. The user decides at Gate 1 whether P1 or P5 becomes a separate task.                                                                         |

## Open questions

- Should P1 (reliability core) ship as its own task and PR ahead of the UI work?
  Recommended: yes, because it has value alone and no design dependency. The
  user answers at Gate 1.
- PR creation from Ptah (`gh pr create`, with an AI description) is out of scope
  here. Is it wanted as the next task? The user answers.
- Line-comment delivery: should comments be sent immediately, or collected and
  reviewed as a draft before sending? Recommended: a draft batch with one
  "Send" action, as in Requirement 6.7. The ui-ux-designer can refine this.
- Commit-message generation: which provider and model does it use when the
  active session's provider is unavailable? The software-architect answers from
  the existing provider plumbing.
- Is the per-task history timeline scoped to the task's worktree branch only, or
  also to the main checkout? Recommended: the current workspace's branch. The
  ui-ux-designer answers.
- Does the Claude Agent SDK skip its own worktree removal when a
  `WorktreeRemove` hook is registered? This affects RC10. The researcher-expert
  or backend-developer answers.

## Handoff

- Next specialist: ui-ux-designer (design-spec.md + prototype). A
  researcher-expert spike on the `@pierre/diffs` Angular-build measurement and
  the VS Code 1.100 API checks (Requirements 3.2, 5.1-5.3) runs in parallel
  before the software-architect.
- Why: the scope and parity are fixed, so the open question is how seven new
  Electron surfaces and one host-agnostic card look and fit together. Two
  external unknowns (renderer cost in the real build, VS Code API at the engine
  floor) must be answered before the architect commits to a shape.
