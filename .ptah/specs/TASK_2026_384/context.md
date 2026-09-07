# Context

## Intent

The owner does not want Ptah to compete with VS Code. The in-app editor surface
(file tree, Monaco tabs and split panes, xterm terminal, search-in-files,
quick-open, vim mode, branch picker) is slow, costly to maintain, and never
reaches editor quality.

The target model is the one the market ships in 2026. Claude Code desktop has an
integrated terminal, a small file editor, a rebuilt diff viewer, and a
right-click "Open in" menu for VS Code, Cursor and Zed. Superset has a built-in
diff and file editor, a persistent terminal per worktree, and an in-app browser.
T3 Code has inline diff review and one-button commit, push and PR. None of them
ships a file explorer as primary navigation, tabs, split panes, search-in-files,
or vim.

## Decision: reshape, not demolish

- **Retire:** file tree as primary navigation, multi-tab Monaco with split
  panes, search-in-files, quick-open, vim, branch picker popover, git status
  bar, layout persistence RPCs. Zero external consumers for all of these.
- **Keep and elevate:** diff view, source control, worktrees, git services.
  This is the product core. It is host-agnostic and already used by the CLI
  and the agent SDK.
- **Keep, retarget:** one single-file editor for spot edits, one terminal bound
  to the agent session or worktree, not to an IDE panel.
- **Add:** change-set review per agent turn, task to worktree binding, merge
  and PR, open-in-external-editor launcher.
- **Tooling:** CodeMirror 6 with `@codemirror/merge` replaces Monaco for the
  diff view and the spot editor. Removes the 16 MB Monaco asset tree, the
  100 ms loader poll, and the model cache. Do not embed VS Code
  (openvscode-server, code-server).

## Research method

Workflow `wf_a95774ff-3cc`, 20 agents. Seven parallel mappers (frontend
consumers, shared contracts, backend handlers, host wiring, tests and e2e, git
keep-surface, performance evidence). One adversarial verifier per feature
refuted claims and hunted for missed couplings. One synthesizer wrote
`research-report.md`.

## Timer and watcher audit

The frontend has no polling loop that checks files. File and git updates are
event-driven from the Electron `GitWatcherService`: one recursive `fs.watch` on
the workspace root, dedicated watchers on `.git/HEAD`, `index`, `packed-refs`,
`ORIG_HEAD`, `FETCH_HEAD`. It pushes `git:status-update`, `file:tree-changed`,
`file:content-changed`.

Editor-owned timers, all debounces, all removed or moved by TASK_2026_385:
Monaco loader poll (`monaco-loader.service.ts:150`, 100 ms until loaded, 20 s
cap), vim load spin (`vim-mode.service.ts:140`), tree refresh and reread-all-tabs
debounces (`editor-workspace.ts:431,462`), diff mirror timer
(`editor-diff-split.ts:526`), search debounce, error toast timeout, inline input
blur. Host side: the tree refresh job and the content reread job in
`git-watcher.service.ts:491-497`.

Recurring intervals that are not about the editor and stay: two 1 second ticks
for elapsed-time labels while an agent runs (`agent-monitor.store.ts:506`,
`background-agent.store.ts:165`), two 30 second diagnostics polls in the Skills
and Memory tabs (subscriber-counted), update check every 4 hours, license
revalidation every 24 hours.

The one real churn source is the recursive watcher itself. `.nx/cache` and
`.angular/cache` are not in its ignore list (`perf-m3-watcher-churn.md`). The
watcher must stay because it is how agent edits reach the change-set view. The
fix is to widen the ignore list and drop the tree job.

## Split into two tasks

- **TASK_2026_385 (subtractive, build green at each phase):** carve
  `libs/frontend/git-ui`, delete the IDE shell, the terminal panel wiring, the
  dead RPC namespaces, the tree job and the watcher churn.
- **TASK_2026_386 (additive):** change-set review, CodeMirror diff and spot
  editor, session-bound terminal, task to worktree binding, merge and PR,
  open-in-external-editor launcher.

## Decisions, 2026-09-06

1. Terminal dropped. `node-pty` and xterm leave the Electron package in
   TASK_2026_385 phase 1.
2. Launcher: binaries first, deep links as fallback, detected editors only.
3. Merge conflict: blocking dock state with per-file "Open in", no in-app
   resolver.

Details in `../TASK_2026_386/context.md`.
