---
title: >-
  Batch 4.2 + 4.3 implementation report — delete EditorRpcHandlers, collapse
  the watcher exclusion sets
---

# Batch 4.2 + 4.3 — backend-developer report

## Batch 4.2 — delete the editor handler classes

**Deleted:**

- `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts`
- `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.spec.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts`
  (this host had no matching `.spec.ts` — confirmed by directory listing before
  deleting; nothing to remove there)
- `apps/ptah-electron/src/services/rpc/handlers/editor-file-tree-cost.spec.ts`
  — **not named in the batch file list**, but it exclusively tested
  `EditorRpcHandlers.getFileTree`/`getDirectoryChildren` (depth/concurrency
  cost). It imports the class being deleted and has no assertions worth
  re-homing (unlike the `editor-rpc.handlers.spec.ts` reachability suite),
  so it dies with the class. Flagging this as a deviation since it wasn't
  itemized in the batch text.

**Modified:**

- `apps/ptah-electron/src/services/rpc/handlers/index.ts` — removed the
  `EditorRpcHandlers` re-export; barrel is now an empty (documented) module.
- `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts` — removed
  the `EditorRpcHandlers` re-export; kept `FileRpcHandlers`.
- `apps/ptah-electron/src/di/phase-4-handlers.ts` — removed the
  `EditorRpcHandlers` import, its factory registration
  (`container.register(EditorRpcHandlers, { useFactory: ... })`), and its
  entries in both `logger.info(...)` handler-name lists. Restored the
  `PLATFORM_TOKENS` import I initially over-deleted (it's still needed for
  `PLATFORM_TOKENS.APP_UPDATER`) — caught this before running verification.
- `eslint.config.mjs` — removed both `editor-rpc.handlers.ts` entries from
  `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION`; the vscode `file-rpc.handlers.ts`
  entry is untouched (owned by a different, unfinished migration).

## Clarification I did not ask, and why: the rpc-host-profile.ts / phase-3-handlers.ts coupling

Batch 4.2's file list is `handlers/index.ts` (both hosts) +
`phase-4-handlers.ts` + `eslint.config.mjs`. It does **not** list
`apps/ptah-electron/src/rpc-host-profile.ts`,
`apps/ptah-extension-vscode/src/rpc-host-profile.ts`, or
`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts` — but all three still
import `EditorRpcHandlers` (host-profile `hostHandlers` entries for
`host.editorRevert`/`host.editorPane`, and a `registerSingleton` in
phase-3). Batch 4.4's file list explicitly owns "the three host profiles"
and "the two `rpc-surface.spec.ts` files", and depends on 4.1+4.2+4.3, so
this is a **known, designed seam** between batches, not an oversight I
should paper over by reaching into 4.4's files. I left them untouched per
"do not edit files outside your batch's ownership, even to fix something you
noticed" and verified/report the resulting break below instead of silently
fixing it.

## Batch 4.3 — watcher reduction and exclusion-set collapse

**`apps/ptah-electron/src/services/git-watcher.service.ts`:**

- Deleted `scheduleTreeRefresh()`, its call site in `watchWorkspaceRoot`
  (`if (eventType === 'rename') { this.scheduleTreeRefresh(); }`),
  `treeDebounceTimer`, `treeBurstStartedAt`, `TREE_DEBOUNCE_MS`,
  `TREE_MAX_WAIT_MS`, and the `treeDebounceTimer` cleanup block in `stop()`.
- Removed the `EDITOR_REREAD_OPEN_TABS` broadcast line inside
  `scheduleGitOpsRefresh` and its local alias constant; the `fetchAndPush()`
  call on the line above it is untouched.
- Removed the now-unused `FILE_TREE_CHANGED` local alias.
- Kept `scheduleUpdate`, `scheduleContentChange`, `scheduleGitOpsRefresh`,
  and the recursive `watchWorkspaceRoot` watcher exactly as they were
  (minus the tree call site) — the `'workspace'` cause still fires on every
  event.
- Kept the `.git/*` dedicated watchers (`watchFile`/`watchDirectory`) fully
  outside the exclusion predicate, unchanged.
- Updated the class header, `watchWorkspaceRoot` doc comment, and the
  `scheduleGitOpsRefresh` doc comment to stop describing the retired
  responsibilities; fixed three "four debounce windows" comments to "three"
  (workspace/git-ops/content-change are the surviving channels).

**`libs/shared/src/lib/constants/workspace-scan.constants.ts`:**

- Deleted `TREE_HIDDEN_DIRS`. `WATCH_IGNORED_DIRS` is now the single
  exported set: the old `TREE_HIDDEN_DIRS ∪ WATCH_IGNORED_DIRS` union
  (`.git`, `.hg`, `.svn`, `.DS_Store`, `.Trash`, `.cache`, `.tmp`, `.temp`,
  `.nx`, `.angular`, `node_modules`, `dist`) plus `coverage` and `tmp`.
- Rewrote the ~70-line header. It now documents one question ("should a
  write here schedule a `git status` refresh") instead of two, and replaces
  the old "`coverage` is a plausible source directory, don't exclude it"
  paragraph with the new reasoning the task specified verbatim: that
  argument existed to protect the file explorer's rendering, the explorer
  is gone, and the only remaining cost of an over-broad name is a missed
  `git status` refresh — never data loss. `out`, `build`, `.next`, `.turbo`
  keep the higher evidence bar and stay excluded-from-exclusion.
- Deleted the whole "Reachability: navigation is filtered, explicit access
  is not" section — that discussion was about the RPC-level asymmetry
  between `editor:getFileTree` (filtered) and `editor:openFile`/`rootPath`
  (unfiltered), and both endpoints are gone with `EditorRpcHandlers`. There
  is no more navigation-vs-explicit-access distinction to document.
- Updated the `isExcludedWorkspacePath` `@param dirs` doc to stop pointing
  at the deleted `TREE_HIDDEN_DIRS`.

**Where the `EXCLUDED_DIRS_GLOB` assertions now live:** `EXCLUDED_DIRS_GLOB`
was never a literal symbol — it's the batch/plan's informal name for the
reachability suite in `editor-rpc.handlers.spec.ts` (confirmed by grepping
the whole repo for the literal string; it only appears in the task's own
`batches.md`/`implementation-plan.md`). That suite exercised RPC-level
navigation-vs-access behavior that no longer exists once `EditorRpcHandlers`
is deleted — there is nothing meaningful to transplant from it 1:1. What
**does** survive is the underlying claim the suite protected: that the
constants module correctly derives its exclusion decision and doesn't
silently lose or gain names. I rewrote
`libs/shared/src/lib/constants/workspace-scan.constants.spec.ts` to carry
that forward:

- `WATCH_IGNORED_DIRS` still contains every legacy `TREE_HIDDEN_DIRS` name
  (no silent shrinkage from the collapse) and still contains `.angular`.
- New pin: `coverage/lcov.info` and `tmp/x` are excluded (the acceptance
  criterion, worded as a **new capability**, since these two are new).
- New pin: a write under `.nx/cache` (and its Windows-separator form)
  schedules nothing — worded and commented as a **pin of existing
  behaviour** per the task's explicit instruction, since `.nx` was already
  in both legacy sets and the segment-level match already covered nested
  paths under it.
- Negative controls `out`, `build`, `.next`, `.turbo` remain asserted as
  NOT excluded.
- Deleted the old "M3 perf harness `IGNORED_DIRS` copy" describe block
  (it read `apps/ptah-electron-e2e/.../perf-m3-watcher-churn.script.mjs` as
  text and diffed it against `WATCH_IGNORED_DIRS`). Batch 4.5's own task
  text says that harness file "is replaced by Task 4.3's constants spec" —
  i.e. this removal is the expected, designed outcome of 4.3 landing, not
  an accidental loss of coverage. Whoever lands 4.5 should delete the
  `.mjs`/`.md` pair; nothing in my changes still depends on them.

**`apps/ptah-electron/src/services/git-watcher.service.spec.ts`:**

- Deleted the five explicitly-named tree-refresh tests (the two
  fake-timer debounce tests, the `TREE_MAX_WAIT_MS` ceiling test, the
  "forced fire starts a fresh burst" test, and the "stop() clears the
  burst" test).
- The batch's five line references undercounted by two: the "real
  `fs.watch` integration" describe block had two more tests
  (`non-git workspace still receives file:tree-changed...` and
  `writes under .nx/.angular are ignored while a real source write still
pushes`) that asserted on `'file:tree-changed'`, which no longer fires
  after this edit. Rather than delete them outright and lose the only
  end-to-end proof that `WATCH_IGNORED_DIRS` is wired into the real
  `fs.watch` callback, I retargeted both onto `'git:status-update'` (the
  workspace watcher's `scheduleUpdate` still fires on every event,
  filtered or not) and widened the second test's negative-control
  directories to include `coverage` and `tmp`. Timeouts were widened to
  match `WORKSPACE_DEBOUNCE_MS` (2000ms) instead of the deleted
  `TREE_DEBOUNCE_MS` (500ms).
- Repurposed the "forced fire" and "stop() clears the burst" burst-ceiling
  tests onto the git-ops channel instead of deleting the coverage outright
  — `GIT_OPS_MAX_WAIT_MS`/`GIT_DEBOUNCE_MS` carry the same numeric values
  (2000/500) the tree channel used, so the timing arithmetic transfers
  directly and the shared `burstExpired` reset behaviour (generic across
  all three schedulers) keeps a regression test.
- Fixed the `drops events under every excluded directory` /
  `keeps genuine source events (R-9)` tests: moved `coverage/report.ts`
  out of the "not excluded" list (it's now excluded) and added
  `coverage/*`, `tmp/*` cases to the "excluded" list.
- Updated the file header and the "real fs.watch integration" describe
  block comment to describe the git-status-update signal instead of the
  retired file-tree push.

## Post-edit re-read confirmation (pre-commit hook stash hazard)

Re-read every file named in the hazard warning plus the deletions, via
`git status --porcelain` after all edits:

```
 M apps/ptah-electron/src/di/phase-4-handlers.ts
 M apps/ptah-electron/src/services/git-watcher.service.spec.ts
 M apps/ptah-electron/src/services/git-watcher.service.ts
 M apps/ptah-electron/src/services/rpc/handlers/index.ts
 M apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts
 M eslint.config.mjs
 M libs/shared/src/lib/constants/workspace-scan.constants.spec.ts
 M libs/shared/src/lib/constants/workspace-scan.constants.ts
 D apps/ptah-electron/src/services/rpc/handlers/editor-file-tree-cost.spec.ts
 D apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.spec.ts
 D apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts
 D apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts
```

All edits survived — nothing was reverted. No commit or `git add` was run
(per instructions; the orchestrator commits 4.2+4.3 together).

## Verification — real output, not claimed green

### `npx nx run-many -t test -p ptah-electron ptah-extension-vscode @ptah-extension/shared @ptah-extension/rpc-handlers`

Header confirmed 4 projects. **Result: 3 of 4 project test targets failed.**

- `@ptah-extension/shared` — not shown as failing in the summary (it ran
  clean; the failing list only names the other three).
- `@ptah-extension/rpc-handlers` — **FAILED**, but for reasons unrelated to
  this batch: two pre-existing timeout flakes
  (`setup-rpc.handlers.spec.ts › wizard:install-pack-agents › rejects
sources not in the curated pack list`, `voice-rpc.handlers.spec.ts ›
voice:transcribe › leaves no input temp file behind...`), both
  `Exceeded timeout of 5000 ms`. Nothing in this batch touches
  `rpc-handlers`; 89/91 suites and 2685/2718 tests passed.
- `ptah-electron` — **FAILED**: `src/di/rpc-surface.spec.ts` fails to
  compile — `apps/ptah-electron/src/rpc-host-profile.ts:19` imports
  `EditorRpcHandlers` from `./services/rpc/handlers`, which no longer
  exports it (TS2306). This is the batch-4.4-owned file described above.
  383/387 other tests in the project passed.
- `ptah-extension-vscode` — **FAILED**: `src/di/rpc-surface.spec.ts` and
  `src/di/container.smoke.spec.ts` both fail to compile —
  `apps/ptah-extension-vscode/src/rpc-host-profile.ts:18` has the same
  TS2305 error. 7/7 other tests passed.

### `npm run typecheck:all`

**Exit 1.** `Running target typecheck for 93 projects failed` — exactly 2
failed: `ptah-electron:typecheck` and `ptah-extension-vscode:typecheck`,
both with the identical `EditorRpcHandlers` errors:

```
apps/ptah-electron/src/rpc-host-profile.ts(19,35): error TS2306: File
'.../services/rpc/handlers/index.ts' is not a module.

apps/ptah-extension-vscode/src/di/phase-3-handlers.ts(37,3): error TS2305:
Module '"../services/rpc"' has no exported member 'EditorRpcHandlers'.
apps/ptah-extension-vscode/src/rpc-host-profile.ts(18,10): error TS2305:
Module '"./services/rpc/handlers"' has no exported member
'EditorRpcHandlers'.
```

All other 91 projects typechecked clean, confirming the shared-library edit
(`workspace-scan.constants.ts`/`.spec.ts`) and every file this batch actually
owns compile correctly in isolation.

### `npx nx run-many -t lint -p ptah-electron ptah-extension-vscode @ptah-extension/shared`

**Green.** `Successfully ran target lint for 3 projects` — 0 errors, only
pre-existing warnings in files this batch never touched
(`post-init.ts`, `file-rpc.handlers.ts`, `plugin-activation.ts`,
`electron-adapters.ts`, `electron-browser-capabilities.ts`,
`ptah-connectors.catalog.ts`, `rpc.types.ts`).

## Plan deviations

1. Deleted `editor-file-tree-cost.spec.ts` (electron) — not named in the
   batch text but exclusively tests the deleted class; see above.
2. Did **not** touch `apps/ptah-electron/src/rpc-host-profile.ts`,
   `apps/ptah-extension-vscode/src/rpc-host-profile.ts`, or
   `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts`, even though
   leaving them causes the `ptah-electron`/`ptah-extension-vscode`
   typecheck and test failures documented above. These three files are
   explicitly itemized in Batch 4.4's file list ("the three host
   profiles") and Batch 4.4 depends on 4.2+4.3 completing first — this is
   the plan's own designed sequencing, not something I should patch around
   by reaching into another batch's ownership. **Batch 4.4 must land
   before `ptah-electron`/`ptah-extension-vscode` typecheck or test green
   again.**
3. `git-watcher.service.spec.ts`: the batch named 5 tree-refresh tests to
   delete by line number; there were 2 additional tests (in the real
   `fs.watch` integration block) that also depended on the deleted
   `'file:tree-changed'` broadcast. Retargeted rather than deleted, to
   keep the only end-to-end proof that `WATCH_IGNORED_DIRS` gates the real
   watcher callback. Also repurposed 2 of the 5 named tests onto the
   git-ops channel rather than deleting them outright, to keep coverage of
   the shared `burstExpired` reset logic. See the "surviving assertions"
   section above for the reasoning.

## Out-of-scope observations

- `libs/backend/rpc-handlers` has two pre-existing flaky timeout tests
  (`setup-rpc.handlers.spec.ts`, `voice-rpc.handlers.spec.ts`) unrelated to
  this batch — worth a look independent of TASK_2026_385.
- `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.{md,script.mjs}`
  is now provably stale (its guard test in `workspace-scan.constants.spec.ts`
  is gone) and should be deleted by whoever lands Batch 4.5, per that
  batch's own task text.
