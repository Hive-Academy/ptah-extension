# TASK_2026_437 — Electron main process freezes under heavy file-system and process load

## User intent

> "our application after all the performance and timeout fixes is not usable at all and very slow
> actually it just completely crashed when i tried opening up 3 sessions tiles"
>
> "this needs an appropriate investigation as we don't want this happening again and we need also
> to allow for having long and heavy node process running in our app without affecting it badly
> like that"

Two goals:

1. Explain and prevent the freeze of 2026-09-14 permanently.
2. Make the app tolerate long, heavy processes (agent Bash commands, git, builds, bulk file
   operations) without the UI or other sessions degrading.

## Evidence gathered (2026-09-14, installed build)

Log: `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-09-14.log`

### The freeze (11:45:49Z → 11:46:25Z)

- Session `175019c3` (agent, YOLO) ran ONE Bash command at 11:45:49 that executed
  `git worktree remove` + `git branch -d` for 10 worktrees under `.claude-worktrees/` and
  `.claude/worktrees/`, then `git worktree prune`. Each worktree is a full checkout (~7,400 files).
- 3 s later: main event-loop lag 265–615 ms sampled every 2 s, uninterrupted for 33 s.
- 11:46:10: `[GitInfoService] git status timed out after 10000ms`.
- 11:46:25: log stops. No shutdown sequence, no Windows crash record, no Crashpad dump.
  Relaunch at 11:54:53. Two other sessions and three canvas tiles froze with it.
- Aftermath on disk: 8 worktree folders under `.claude-worktrees/` left behind, empty except a
  `node_modules` JUNCTION pointing at the main `node_modules`. 6 worktrees still registered.

### Confirmed code defects

1. **Watchers do not ignore agent worktrees.**
   - `apps/ptah-electron/src/services/git-watcher.service.ts:449-466` — recursive `fs.watch` on the
     workspace root; filter is `WATCH_IGNORED_DIRS`
     (`libs/shared/src/lib/constants/workspace-scan.constants.ts:57`), which lacks
     `.claude-worktrees` and `.claude/worktrees`. Every delete event runs JS on main and re-arms
     `scheduleUpdate`.
   - `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts:635` —
     chokidar `**/*` watcher with `DEFAULT_WORKSPACE_EXCLUDES`
     (`workspace-default-excludes.ts:1`), which also lacks the worktree folders. Chokidar opens one
     `fs.watch` per directory across every worktree and awaits `isIgnored` per event.
2. **Git status runs overlap without bound.** `git-watcher.service.ts:667` calls
   `invalidateReadCache(workspaceRoot)` before `getGitInfo` (`:671`); `invalidateReadCache`
   deletes the in-flight entry (`libs/backend/vscode-core/src/services/git-info.service.ts:326-328`),
   so `coalesce` (`:335`) never joins the running run. Forced max-wait: workspace 8 s, `.git` 2 s.
3. **No crash / hang observability.** `apps/ptah-electron/src` has no `render-process-gone`,
   `child-process-gone` or `unresponsive` handler. Renderer console output never reaches the log.

### Other observed load (same log and prior days)

- Boot: main lag 0.3–4.0 s for ~70 s on every launch (also on 9/9–9/13).
  `editor:detectTargets` 51 s, `git:info` 15.5 s, file index 7 s, user-layer reconcile, session
  import, daily 1.26 GB SQLite backup.
- Third launch 12:40:35: `chat:resume` of one session → main lag 0.6–1.6 s for 30 s,
  `session:validate` 4.7 s, `chat:continue` 8.6 s.
- `skillSynthesis:runCurator` ran 294 s (~40 SDK queries). During the network outage the memory
  curator Codex proxy failed repeatedly every 1–30 s.
- Workspace state store (TASK_2026_430): 895 MB on disk; old generations never deleted
  (36 manifests, 1,392 value files / 508 MB); legacy `workspace-state.json` 336 MB still present;
  each session save = two commits rewriting a ~290 KB manifest.

## User decisions (2026-09-14, on implementation-plan.md)

- Scope: implement ALL four phases (P1 → P4), shipped in order.
- Nested git repositories and worktrees are excluded from every consumer, including the `@` picker.
- Electron `crashReporter` enabled with local dumps only, never uploaded.
- Defaults taken for the remaining plan questions: CLI uses `@parcel/watcher` only if it packages
  cleanly (else keep its current watcher behind the port); measure SQLite main-thread cost before
  moving it; scroll-back paging of old history is deferred.

### Unconfirmed candidates (from code reading)

- Tile open replays full session history in one synchronous renderer loop; quadratic
  finalization (`message-finalization.service.ts:303-321`); `chat:resume` returns events plus a
  duplicate `messages` array with no cap.
- Tab persistence retries a full `JSON.stringify` of all tabs on every save after a
  `localStorage` quota failure (`tab-manager.service.ts:2368-2379`).
- Streaming per-frame re-parse of the whole growing markdown message.
- One eval'd `Worker` thread created per spawned process
  (`off-thread-process-spawner.ts:294`).
