# Session handoff — TASK_2026_385

Written 2026-09-07. Read this first, then `context.md` for scope and
`batches.md` for the batch text. The coupling map is in
`../TASK_2026_384/research-report.md`.

## State

Branch `fix/empty-assistant-bubbles`. Phases 0, 1 and 2 are complete and
committed. Phase 3 is next and has not started.

| Commit      | Content                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `adc809373` | Phase 0. Vim, quick-open, search, dead worktree components, `layout:*` RPCs. |
| `d9a2a9f1a` | Phase 1. Terminal panel, PTY host, `node-pty` and xterm packaging.           |
| `16e13df24` | Batch 2.1. The `git-ui` project scaffold and the path alias.                 |
| `c6b263c72` | Phase 2. The git surface carve. 65 files.                                    |
| `f0ce01699` | The TASK_2026_384, 385 and 386 spec folders.                                 |

Batches 0.1 through 2.7 are marked COMPLETE in `batches.md` with their commit
hashes. Batches 3.1 through 4.5 are PENDING.

## Verification state at the Phase 2 close

All green, measured after the final fix:

- `npm run typecheck:all` — 94 projects.
- `npx nx run-many -t lint` — 10 projects. Only pre-existing `max-lines` and
  `no-non-null-assertion` warnings in the chat library.
- `npx nx run-many -t test` — 9 projects: `@ptah-extension/git-ui`,
  `editor`, `skill-synthesis-ui`, `chat`, `core`, `rpc-handlers`,
  `platform-core`, `shared`, `ptah-extension-webview`.
- `npx nx build ptah-extension-webview`.

Not run at the Phase 1 close and still not run: `nx run ptah-electron-e2e:e2e`.
Run it before Batch 3.3 touches those specs.

## What Phase 2 delivered

`libs/frontend/git-ui` now owns the whole webview git surface. Its `CLAUDE.md`
is the authority on its boundaries and public API. Key points:

- `GitStatusService`, `GitBranchesService`, `WorktreeService`,
  `SourceControlService` and `DiffTabsService` are all `MessageHandler`
  implementations, registered in the `MESSAGE_HANDLERS` multi-provider in
  `apps/ptah-extension-webview/src/app/app.config.ts:189-193`.
- `WORKTREE_CHANGED_MESSAGE_TYPE` is the literal `'git:worktreeChanged'`. It is
  deliberately not a `MESSAGE_TYPES` member. Three backend producers broadcast
  it. Do not move the wire contract.
- The diff layout preference persists through `settings:get` / `settings:set`
  under the file-based key `diff.renderSideBySide`. The old
  `editor:getSetting` and `editor:updateSetting` methods are gone from every
  contract site.
- `fileStatusMap` and `changedDirPrefixes` left `GitStatusService`. They live in
  `libs/frontend/editor/src/lib/file-tree/file-tree-git-index.service.ts`, and
  they die with the editor library in Batch 4.1.
- The editor library holds private copies of `monaco-loader.service.ts` and
  `services/editor/git-read-error-messages.ts`. They also die in Batch 4.1.

## Failure mode to avoid, seen this session

Phase 2 was implemented, then the in-place edits to the **moved** files were
lost from the working tree while the new files survived. The reviewers caught
it. Two lessons:

1. After a batch that moves files, grep the destination library for the old
   paths before you call it done. For this task the probe was:
   `Grep pattern "editor-tab.types|editor\.service|@ptah-extension/editor"
path libs/frontend/git-ui`.
2. Do not trust a batch report that says green. Re-run the acceptance command
   yourself.

## Another session shares this working tree

At the time of writing, the working tree also carries work that is **not** this
task and must never be staged by it:

- `libs/frontend/canvas/**` and `.ptah/specs/TASK_2026_387/` — staged by the
  other session, left staged and untouched.
- `.gitignore`, `tools/video-editor/`, `.ptah/specs/TASK_2026_383/`.

Commit with an explicit path list, never `git add -A` on the repository root.
The Phase 2 commit used `git commit -F <file> -- <path> <path> …`.

An explicit path list is not enough on its own. **The husky pre-commit hook runs
`nx lint` across all 73 projects, not only the staged files.** One lint error in
any foreign, uncommitted file therefore blocks every commit in this working
tree. Measured 2026-09-07: a `no-unexpected-multiline` error in an untracked
`chat-ui` spec owned by a third session held up a finished Batch 3.1. If a
commit fails on a project you never touched, look for a foreign edit before you
look at your own work.

**`batches.md` is the single source of truth between sessions**, and it will be
ahead of this document. Read it first.

## Repository rules that cost time this session

- The commitlint `scope` enum no longer contains `specs`. Use `docs` for
  spec-folder commits. The `git-ui` scope was added in Batch 2.1.
- `git commit -F -` with a here-string through PowerShell produces an empty
  message. Write the message to a file and pass the path.
- `npx nx test A B C` runs only project A and turns the rest into Jest path
  filters. Always `npx nx run-many -t test -p A B C`.
- The `git-ui` typecheck target is
  `npx ngc --noEmit --project libs/frontend/git-ui/tsconfig.lib.json`.
- Run `npx nx reset` before any `nx graph` check. The cache goes stale.
- Use complete absolute Windows paths for Read and Write.

## Next: Phase 3

Batches 3.1 and 3.2 are parallel. 3.3 and 3.4 both depend on 3.1.

### Batch 3.1 — Git dock (frontend-developer)

Create `GitDockComponent` and `GitDockHeaderComponent` in `git-ui`, mount them
in the `electron-shell.component.ts` right-dock slot. The header is a **port**
of `git-status-bar.component.ts:40-141`, not a new design. The dock constructor
must call `startListening()` on `GitStatusService` and `GitBranchesService` and
disarm both on destroy. **Until this lands, every `git:status-update` push is
dropped**, so it gates Phase 4. Full text in `batches.md` Batch 3.1.

### Batch 3.2 — External-editor `file:open` (backend-developer)

A new minimal Electron handler that spawns `code -g <path>:<line>` through
`SDK_TOKENS.SDK_PROCESS_SPAWNER`. It must validate containment with
`isPathWithinRoots` before any spawn, call `notifyFileOpened` on the success
path, and never throw. The launcher port is TASK_2026_386, not this task. Full
text in `batches.md` Batch 3.2.

### Batch 3.3 — e2e, docs and showcase retarget (devops-engineer)

Re-home six git specs under `apps/ptah-electron-e2e/src/specs/git/`, add
`git-dock.spec.ts` that pins acceptance criterion "a synthetic
`git:status-update` reaches the dock", retarget `editor-git.shot.ts` and
rewrite `git/git-status.md`.

### Batch 3.4 — Lazy-chunk budget (devops-engineer)

Build the webview, read the emitted `git-ui` chunk size, then write a measured
`maximumError` into `apps/ptah-extension-webview/project.json`. Do not guess.

## Then Phase 4

Delete the editor library and every contract, manifest, capability,
expected-absent list, e2e spec, showcase scene and doc that names it. Drop the
tree refresh job from `git-watcher.service.ts` and widen its ignore list.
Batches 4.1 through 4.5 in `batches.md`.

## Open item

Where the task-to-worktree binding lives when a task has no carrier. The
proposal on record is to create the carrier on the first bind. This belongs to
TASK_2026_386, not here.

## How to resume

Run the orchestration workflow in verify-and-commit mode per batch: developer
agent → `code-style-reviewer` and `code-logic-reviewer` in parallel → fix →
re-verify → one commit per batch with an explicit path list → mark the batch
COMPLETE with its hash in `batches.md`.
