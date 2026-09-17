# Code Logic Review — `TASK_2026_437_0778` Batch 4

Scope: `apps/ptah-electron/src/services/git-watcher.service.ts` (+ spec),
`libs/shared/src/lib/types/messages/payload-map.ts`,
`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` (+ spec),
`libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts` (+ spec).
Reviewed against `implementation-plan.md` components C3/C5, INV-1/2/5/6, AC-1/AC-2,
`batches.md` Batch 4, and the shipped APIs from Batch 2 (`EventStormBreaker`,
`NestedRepoRoots`, `NESTED_WORKSPACE_PATH_RULES`) and Batch 3 (`GitInfoService.refreshGitInfo`).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 7/10                                  |
| Assessment            | APPROVE_WITH_FIXES                    |
| Blocking issues       | 0                                     |
| Serious issues        | 1                                     |
| Moderate issues       | 3                                     |
| Failure modes found   | 4                                     |

`npx nx run-many -t test -p ptah-electron @ptah-extension/shared @ptah-extension/git-ui @ptah-extension/workspace-intelligence` — header "4 projects and 5 tasks they depend on", all green (ptah-electron 583/587 + 4 skipped; shared 1512/1512; git-ui 343/343; workspace-intelligence 1029/1029). `typecheck,lint` for the same set plus `ptah-extension-webview` — 0 errors, only pre-existing unrelated warnings. This is cached-but-current output against the working tree (Batch 5 files present, uncommitted, disjoint from Batch 4's files).

## Five logic questions

### 1. How does this fail silently?

- `admitEvent`/`isIgnoredWorkspaceEvent` never throw, so a mis-detected nested
  root (see Moderate-1) does not error — it just silently keeps watching (or
  silently stops watching) a subtree, with only a `debug`-level log line
  (`git-watcher.service.ts:664-666`) that nothing surfaces to the user.
- `WorkspaceFileIndexService.search()` (`workspace-file-index.service.ts:929`)
  is synchronous and reads `entry.files` directly, with no readiness check.
  During a post-storm rebuild, `build()` clears `entry.files`/`entry.directories`
  synchronously before repopulating them across yielded batches
  (`workspace-file-index.service.ts:433-434`). A `search()` call issued in that
  window returns an empty or partial result set with no error and no
  indication the index is degraded — a caller (e.g. the `@` file picker) can
  read this as "the file does not exist" rather than "the index is rebuilding".
  This was called out by the executor as an accepted deviation, but it is a
  genuine silent-wrong-answer window, not merely a documentation note.
- `refreshNestedRepoRoots` swallows a `getWorktrees` failure into one `warn`
  line and keeps the previous (possibly stale/empty) root set
  (`git-watcher.service.ts:733-747`) — correct per the plan's stated failure
  behaviour, but worth naming: a persistently failing `git worktree list` (e.g.
  a corrupted `.git`) degrades silently to "no dynamic exclusion" forever,
  with only the one-time warn as evidence.

### 2. What user action produces unexpected behaviour?

- An agent (or user) creating a nested repository or worktree directly under
  the workspace root, then immediately writing many files into it before any
  `.git` marker event reaches the watcher, has those early events counted by
  `isIgnoredWorkspaceEvent` as NOT excluded (the root is not yet known) and
  processed normally — see Failure mode 1 below.
- A user with `PTAH_WATCH_STORM_*` env overrides that produce a very small
  `enterEventsPerWindow` could see ordinary bursts (a formatter running over
  many files) treated as a "storm" and coalesced into one delayed status
  update — this is the intended degrade path, not a bug, but is undocumented
  in this batch (no mention of the override surface in `CLAUDE.md` or a
  troubleshooting note).

### 3. What input data produces a wrong answer?

- `Set<string>` truncation in `scheduleContentChange`
  (`git-watcher.service.ts:826-841`): once `contentChangeTruncated` is `true`,
  no further paths are added to `pendingContentPaths`, but the set is not
  cleared either — so the eventual truncated push carries up to 256
  *arbitrary* (first-256, insertion order) paths plus `truncated: true`. This
  matches the documented contract, so not a defect, but worth noting for the
  reviewer of `diff-tabs.service.ts`: a truncated batch's `filePaths` are
  otherwise-unused since the renderer ignores them on `truncated === true` and
  revalidates everything — confirmed correct at `diff-tabs.service.ts:404-409`.
- `noteGitMarker` + `nestedRepoRootOf`: a workspace-relative filename like
  `packages/.gitkeep` or `vendor.gitignore` — anything containing the
  substring `.git` without a `.git` PATH SEGMENT — passes the cheap
  `filename.includes('.git')` gate, calls `noteGitMarker`, and then correctly
  returns `undefined` from `nestedRepoRootOf` (segment-exact match only). No
  wrong answer, but confirms the substring gate is deliberately loose and the
  segment-exact work happens downstream — fine, but see Moderate-2 for the
  per-event cost this creates.

### 4. What happens when a dependency fails?

- `GitInfoService.getWorktrees()` failure: handled (see Q1/Q3), keeps static
  rules, warns once (`worktreeListFailureLogged`).
- `GitInfoService.refreshGitInfo()` rejection inside `fetchAndPush`: the
  `try/catch` around it (unchanged from before this batch, `git-watcher.service.ts`
  further down in `fetchAndPush`) still applies — not modified by this batch,
  not re-reviewed here beyond confirming the call site swap is correct.
- `fs.watch` throwing/erroring is unchanged by this batch (still the existing
  `catch` in `watchDirectory`); the nested-root and storm-breaker logic sit
  entirely inside the callback and do not change that failure path.
- File-index `build()` failure during a post-storm rebuild: handled —
  `entry.buildPromise = undefined` on error (`workspace-file-index.service.ts:786`),
  which per Moderate-3 also silently cancels a queued extra rebuild.

### 5. What is missing that the requirements never mentioned?

- No test exercises `stormRebuildQueued` (a second storm-exit while a
  post-storm rebuild is still running) — see Moderate-3.
- No test exercises a workspace-root event whose filename contains `.git` as
  a substring but not a segment, or a large nested-repo `.git/objects` deletion,
  to pin the per-event allocation cost claimed as "0 allocations while
  storming" — see Serious-1.
- The `PTAH_WATCH_STORM_*` overrides are wired into both call sites
  (`git-watcher.service.ts`, `workspace-file-index.service.ts`) via
  `readEventStormBreakerOptionsFromEnv`, but nothing pins that the two
  breakers can be tuned independently (they read the same env keys — a single
  override affects both the git watcher AND the file index simultaneously).
  Acceptable for P1 but worth a one-line note if it surprises Batch 6/17.

## Failure modes

### 1. Early-window blind spot for a freshly created nested repo/worktree

- Trigger: `git worktree add` or `git clone` directly under the watched
  workspace root, followed immediately (same tick / same debounce window) by
  a burst of file-creation events inside the new subtree, before the `.git`
  marker event for that subtree is observed and processed.
- Symptom: those early events are NOT yet excluded (the root is unknown),
  so they count toward the storm breaker and can schedule a `git status`
  refresh / content push for files that belong to a nested repository the
  design intends to be invisible everywhere (user decision Q1).
- Evidence: `git-watcher.service.ts:614-635` (`onWorkspaceEvent` — exclusion
  test happens before the current event's own `.git` detection can register a
  root that a LATER, but same-burst, event needs); `noteGitMarker` only adds a
  root once ITS OWN event (naming `.git`) arrives, so any event ordered ahead
  of that one in the same `fs.watch` delivery batch is unprotected.
- Current handling: none beyond "the static rules already cover the far more
  common agent-worktree case, so this is useful before the async
  `getWorktrees()` listing lands" (module doc, `:293-296`). That comment
  addresses START-time seeding latency, not the narrower in-storm race
  described here.
- Recommendation: acceptable residual risk for P1 (the actual incident
  trigger — `.claude-worktrees/*` — is covered by the STATIC rules, not this
  dynamic path, so the blind spot cannot reproduce 09-14). Worth a one-line
  note in the module doc distinguishing "dynamic root detection has a startup
  race" from "static rules have none," so a future reader does not assume
  `NestedRepoRoots` closes this gap completely.

### 2. Post-storm file-index rebuild wipes the index before refilling it

- Trigger: any event storm on the file index (10s of files/sec above the
  breaker threshold), including the exact 09-14 shape (mass worktree delete)
  replayed against a *previously indexed* workspace.
- Symptom: `search()` / `searchDirectories()` / `getAll()` — all synchronous,
  no readiness gate — return empty or partial results for the duration of the
  rebuild walk, silently. A caller cannot distinguish "no matches" from
  "index mid-rebuild."
- Evidence: `workspace-file-index.service.ts:432-434` (`build()` clears both
  maps up front), `:929` (`search` reads `this.active` with no ready check),
  `:985` (`isReady()` exists but nothing forces a caller through it).
- Current handling: `ensureReadyFor`/`ensureReady` correctly await the
  rebuild (pinned by the new spec, "waits for the post-storm rebuild instead
  of serving a half-built index"), but that is an opt-in path; `search` is
  not routed through it and the executor's own batch note calls this out as
  an accepted deviation, not a fix.
- Recommendation: for P1, at minimum surface `isReady()` to whatever RPC
  handler backs the `@` picker / search UI so a mid-rebuild query can show
  "reindexing" instead of "no results" — or note explicitly in
  `workspace-intelligence/CLAUDE.md` that direct `search()` callers must check
  `isReady()` themselves. Batch 11 replacing this path is not a reason to ship
  a silent-empty-result window in the interim without at least a doc pointer.

### 3. Queued post-storm rebuild is dropped on a failed rebuild

- Trigger: a storm exits, its rebuild starts, a SECOND storm begins and exits
  while the first rebuild is still running (setting `stormRebuildQueued`),
  and the first rebuild's `build()` call throws.
- Symptom: the queued second rebuild is silently discarded.
  `entry.buildPromise = undefined` in the error branch
  (`workspace-file-index.service.ts:786`), and the `.finally()` guard
  (`:794`) only re-invokes `rebuildAfterStorm` `if (entry.buildPromise)` —
  which is now `undefined`, so the queued flag is consumed but never acted on.
  The index is left un-rebuilt and stale until the next natural trigger
  (workspace switch, restart, or another storm).
- Evidence: `workspace-file-index.service.ts:779-797`.
- Current handling: matches "same recovery as a failed first build: the next
  query rebuilds" (comment at `:785`) for the FIRST failure, but that
  rationale does not obviously cover the queued-rebuild case, and no test
  exercises it either way (grepped the spec: no `stormRebuildQueued` coverage).
- Recommendation: Moderate because a genuine double-storm-during-rebuild is
  an edge case, but it is exactly the shape of event a 09-14-style incident
  could produce (mass delete → rebuild → new files created by the same script
  → second storm). Add a spec pinning the queued-then-failed path, or clarify
  in the comment that the drop is intentional and self-healing (the index
  merely serves a stale-but-valid snapshot until the next trigger).

### 4. Worktree-list race is handled, but only for the LATEST call

- Trigger: two `refreshNestedRepoRoots` calls in flight for the same
  workspace (e.g. one from `start()`'s unawaited seed, one from a debounced
  `.git/worktrees` change firing very early), with the FIRST call's promise
  resolving AFTER the second's.
- Symptom: none observed as a bug — both calls capture `generation` at call
  time and check `this.armGeneration !== generation` only against `stop`/`start`
  transitions, not against each other, so an out-of-order resolution of two
  calls within the SAME generation would let the older listing overwrite the
  newer one's discovered roots (`this.nestedRepoRoots = next` at
  `:747` unconditionally replaces the field, and `next` is seeded fresh from
  `NestedRepoRoots.fromWorktreeList` plus only `this.discoveredNestedRoots`
  read AT THE TIME THAT CALL RESOLVES — which is current, so this self-heals
  because `discoveredNestedRoots` is authoritative and re-applied every time).
- Evidence: `git-watcher.service.ts:715-748`.
- Current handling: correct by construction — `discoveredNestedRoots` is the
  running Set that both calls read at resolution time, so an out-of-order
  double refresh converges to the same result either way (last-write-wins on
  `nestedRepoRoots`, but both writes derive from the same authoritative
  `discoveredNestedRoots` plus whatever `getWorktrees()` currently reports).
  Documented here as a checked-and-clear failure mode, not a defect.

## Blocking issues

None.

## Serious issues

### `.git`-marker detection is not allocation-free while storming, contrary to the stated quality bar

- File: `apps/ptah-electron/src/services/git-watcher.service.ts:614-627` (`onWorkspaceEvent`), `:660-687` (`noteGitMarker`), `nestedRepoRootOf` in `libs/shared/src/lib/utils/nested-repo-roots.ts:164-176`.
- Scenario: Task 4.1's quality requirement is explicit — "per OS event ≤ 1 predicate + 1 counter + ≤ 1 timer re-arm; 0 allocations while storming" (`batches.md:289`, `implementation-plan.md:306-307`). `onWorkspaceEvent` runs `noteGitMarker` (two regex `.test()` calls, and on a non-root match, `nestedRepoRootOf` which `.split()`s the path and builds a `parents` array) for EVERY event whose filename contains the substring `.git` — BEFORE the storm-breaker `record()` call, i.e. unconditionally, whether storming or not. For the exact 09-14 trigger (agent-worktree file deletes) this is negligible, because only the worktree's own single `.git` link file matches. But for a mass deletion of a nested repository's own `.git` directory (`pkg/sub/.git/objects/**`, `.git/worktrees/<name>/**` at depth) — squarely inside "an unlisted high-churn folder... degrades a helper process, not the app" (P2 goal) but still live in P1 — every one of those events pays a split + array allocation before the storm breaker or the exclusion predicate even runs, and `isIgnoredWorkspaceEvent`'s own predicate still runs afterward regardless of storming state.
- Impact: the design intent ("excluded events never count toward a storm," "0 allocations while storming") is correct for the counted/excluded distinction, but the "0 allocations" bar is violated specifically for `.git`-bearing paths, which is exactly the path shape a `git worktree remove` produces under `.git/worktrees/*` — a scenario the review brief calls out by name ("does the incident deleted worktree metadata under `.git/worktrees/*`" get breaker protection?). It does get COUNTED (the breaker still runs after `noteGitMarker`), but the allocation happens first, every time, unconditionally.
- Fix: gate `noteGitMarker`'s expensive path (the `nestedRepoRootOf` call and its allocations) behind a check for "not already stormed as excluded" is not meaningful here since inclusion is unknown until the check runs — instead, consider recording the storm-breaker hit FIRST (cheap counter) and skip `noteGitMarker`'s more expensive branch entirely while `storming`, falling back to only the cheap `ROOT_GIT_DIR_EVENT`/`ROOT_WORKTREES_EVENT` regex tests (no `nestedRepoRootOf` call, no array build) until the storm exits, then let the post-storm `refreshNestedRepoRoots` reconcile any roots missed during the storm from the authoritative `git worktree list`. This trades a transient "nested root discovered late" for actually bounding allocation during a storm, matching the stated quality bar.

## Moderate and minor issues

- **Moderate** — `workspace-file-index.service.ts:929` `search()`/`:948` `getAll()`/`:967` `searchDirectories()` have no readiness gate, so a post-storm rebuild silently empties results for callers that do not route through `ensureReadyFor` first (Failure mode 2). Document or gate.
- **Moderate** — `workspace-file-index.service.ts:794` drops a queued post-storm rebuild if the rebuild ahead of it in the queue fails (Failure mode 3). Untested edge case; add a spec or document the self-healing rationale explicitly.
- **Moderate** — Failure mode 1 (early-window nested-root blind spot) is real but does not reproduce 09-14 (static rules cover the actual trigger). Worth a one-line doc clarification only.
- **Minor** — `EVENT_STORM_BREAKER_ENV` is shared verbatim between the git watcher and the file index (`readEventStormBreakerOptionsFromEnv(process.env)` called from both, same env var names), so operators cannot tune the two independently. Not a defect for P1 scope but worth flagging before Batch 6/17 build on it.
- **Minor** — `diff-tabs.service.ts` `toFileContentChange` filters non-string/empty entries out of `filePaths` but does not defend against a truthy `truncated` combined with a huge `filePaths` array from a hostile/buggy producer — low risk since the only producer is the trusted main process in the same release, matches `implementation-plan.md:358` ("only producer... only consumer").

## Data flow

1. `fs.watch` (recursive, workspace root) fires → `onWorkspaceEvent(root, eventType, filename)`. OK.
2. `.git`-substring gate → `noteGitMarker` (root discovery / worktree re-list scheduling). OK for correctness; not allocation-free while storming (Serious-1).
3. `isIgnoredWorkspaceEvent` (WATCH_IGNORED_DIRS ∪ NESTED_WORKSPACE_PATH_RULES ∪ NestedRepoRoots) → excluded events return immediately, never touching the breaker. OK, matches "excluded events never count toward a storm."
4. `EventStormBreaker.record()` → `'normal'` schedules `scheduleUpdate` + (on `change`) `scheduleContentChange`; `'entered'` cancels pending timers and arms the one storm-exit timer; `'storming'` returns with zero timer/path work. OK.
5. Storm exit (`poll()` via the one armed timer) → exactly one `pendingCauses.add('workspace')` + `fetchAndPush()`, and one `contentChangeTruncated = true` + `flushContentChanges()`. OK, matches AC-1/AC-2.
6. `fetchAndPush` → `GitInfoService.refreshGitInfo(root)` (single-flight + trailing rerun from Batch 3) → `git:status-update` broadcast. OK, no more `invalidateReadCache` double-call (confirmed removed; the old comment explaining the two-call ordering was replaced with one explaining the new single call).
7. `flushContentChanges` → `FILE_CONTENT_CHANGED` push with `{ filePaths, truncated }`, capped at 256, one push per debounce/max-wait window. OK.
8. Renderer `DiffTabsService.onFileContentChanged` → `truncated` routes through the existing `git:status-update` debounce (`onGitStatusUpdate()`) plus a `fileViewRevalidationPending` latch for file-view tabs; non-truncated matches tab keys once per push. OK, verified no gap between `refreshAllDiffTabs` (diff tabs) and `refreshAllFileViews` (view tabs) — tabs are mutually exclusive between `.diff` and `.view`.
9. File index: `admitEvent` (breaker) gates `onCreate`/`onChange`/`onDelete` before the awaited `isExcluded` check ever runs — OK, matches "skip per-event isExcluded and the add/delete" while storming.
10. File-index storm exit → `rebuildAfterStorm`: `build()` clears then repopulates the maps under the SAME watcher/generation; `ensureReadyFor` correctly awaits it (pinned by spec); direct `search()` does not (Failure mode 2, gap).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| C3: exclusion before `.git` filter, breaker-gated per-event work, single content timer | COMPLETE | Serious-1: allocation bound not fully held for `.git`-bearing paths while storming |
| C3: `NestedRepoRoots` seeded from `fromWorktreeList` (not awaited), re-listed on `.git/worktrees` activity (debounced) | COMPLETE | Failure mode 1 (narrow, does not reproduce 09-14) |
| C3: storm exit issues exactly one `refreshGitInfo` + one truncated push | COMPLETE | none found |
| C5: `FileContentChangedPayload` batch shape, forward-slash absolute paths | COMPLETE | none found |
| C5: `DiffTabsService` validates payload, truncated → full refresh via existing debounce | COMPLETE | none found |
| P1 file-index breaker adoption (INV-6, minimal per batch note) | COMPLETE | Failure mode 2 (search not readiness-gated), Failure mode 3 (queued rebuild can be dropped on failure) |
| AC-1/AC-2 mechanism: 10,000 events under `.claude-worktrees` → 0 schedules/broadcasts; 10,000 under `src\` in 1s → storm entered, 1 refresh, 1 push | COMPLETE | Pinned by new specs in both files; verified passing |

Implicit requirements not addressed: a readiness signal for direct (non-`ensureReadyFor`) file-index search callers during a post-storm rebuild; independent tuning of the two `EventStormBreaker` instances (git watcher vs file index) sharing the same env var namespace.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| 10,000 events under `.claude-worktrees`/`.claude/worktrees` | YES | Static rules exclude before the breaker ever counts them | none |
| 10,000 events under `src/` in 1s (storm) | YES | Breaker enters, one exit timer, exactly one refresh + one truncated push | none |
| Storm that never quiets | YES | `maxStormMs` forces periodic exit/re-entry, pinned by spec | none |
| `.claude/commands`, `.claude/skills` under storm-free load | YES | Still schedule normally (not excluded) | none |
| Nested `.git` FILE (worktree) vs DIR (repo) | YES | Both are `nestedRepoRootOf`'s marker segment | none |
| `.git/worktrees` add/remove | YES | Debounced re-list, dedicated watcher when the dir exists at `start()` | a repo that GAINS a `worktrees` dir after `start()` (first `git worktree add` in a repo with none before) has no dedicated watcher armed for it — only caught indirectly via the workspace-root recursive watcher's own `.git/worktrees` event, which IS still handled by `onWorkspaceEvent`/`noteGitMarker`. Confirmed correct via `ROOT_WORKTREES_EVENT` matching the root-relative path regardless of the dedicated `watchDirectory` call. |
| Worktree-list failure | YES | Keeps static rules, warns once | none |
| Stale worktree-list resolution (generation moved on) | YES | `armGeneration` check drops it | Pinned by spec |
| Content-change batch cap (256) | YES | `truncated: true`, renderer does one full revalidation | none |
| `stop()` mid-storm | YES | Cancels storm timer, no refresh issued | Pinned by spec |
| File-index storm → rebuild → search during rebuild | PARTIAL | `ensureReadyFor` waits; `search()` does not | Failure mode 2 |
| File-index double-storm during rebuild (queued rebuild) | NO TEST | Code path exists (`stormRebuildQueued`) but untested and drops on rebuild failure | Failure mode 3 |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: the file index can silently serve empty/partial search results during a post-storm rebuild window (Failure mode 2) — bounded and self-healing, but not surfaced to any caller that skips `ensureReadyFor`.
- What a robust implementation would add: (1) skip the `nestedRepoRootOf` allocation path while storming in `noteGitMarker`, reconciling from `git worktree list` at storm exit instead (Serious-1); (2) a readiness check or explicit doc note on `search()`/`getAll()`/`searchDirectories()` for the post-storm-rebuild window; (3) a spec pinning the queued-rebuild-then-failure path so its silent-drop behaviour is either intentional and documented, or fixed.

---

## Delta review (review fixes)

Scope: re-review of the fixes applied on top of the above review, read directly from
the uncommitted working tree in `D:\projects\ptah-437` (HEAD `bf247ed3c`, nothing
committed — the diff against HEAD is the whole batch, not just the fixes, so each
finding below is verified by reading current code/tests against the base review's
`file:line` evidence rather than by diffing a pre-fix snapshot). Re-ran
`npx nx run-many -t test -p ptah-electron @ptah-extension/workspace-intelligence @ptah-extension/git-ui`
— 3 projects + 5 dependency tasks, all green (workspace-intelligence 1030/1030,
git-ui 343/343, ptah-electron 584/588 + 4 pre-existing skips), fully cached against
the current working tree hashes.

### Fix 1 — storm-safe `.git` marker handling (Serious-1)

CONFIRMED, correctly implemented and tested.

- `onWorkspaceEvent` (`git-watcher.service.ts:614-627`) runs `filename.includes('.git')`
  — `String.prototype.includes` scans the existing string with no substring
  allocation — BEFORE `isIgnoredWorkspaceEvent` and BEFORE `this.stormBreaker.record()`.
  While storming (`this.stormBreaker.isStorming`), the branch only sets
  `this.gitMarkerSeenDuringStorm = true` (`:620`) and never calls `noteGitMarker`,
  so `nestedRepoRootOf`'s `.split()` + array build never runs per event during a
  storm — the allocation the base review flagged is gone.
- Proven, not asserted: `git-watcher.service.spec.ts:697-722` mocks
  `nestedRepoRootOf` via `jest.mock('@ptah-extension/shared', ...)` (`:28-31`),
  drives 10,000 `.git`-bearing rename events across two shapes
  (`.git\worktrees\wt-N\objects\I` and `vendor\repo\.git\objects\I`) during an
  active storm, and asserts `expect(parseSpy).not.toHaveBeenCalled()` — a real
  spy assertion of zero calls, not an indirect inference. The same test also
  confirms the deferred reconciliation: `gitInfo.getWorktrees` is called exactly
  once after the storm exits (`:720`).
- Flag-loss check: `stop()` (`:421-462`) resets `gitMarkerSeenDuringStorm = false`
  and `clearTimeout`s both `stormTimer` and `nestedRootsRefreshTimer`
  synchronously. Since `exitStorm()` (`:895-918`) runs the
  `gitMarkerSeenDuringStorm` check and `scheduleNestedRootsRefresh()` call
  synchronously in the same tick as the storm-exit timer callback, there is no
  JS-visible window where `stop()` can interleave mid-`exitStorm()` — the only
  way to lose a discovered-but-unlisted root is a `stop()` landing strictly
  between storm exit and the 500ms `NESTED_ROOTS_REFRESH_DEBOUNCE_MS` firing,
  which is benign: the next `start()` re-seeds `nestedRepoRoots` from a fresh
  `git worktree list` anyway (`:290-296`, not awaited). This exact interleaving
  (storm exits, `gitMarkerSeenDuringStorm` true, `stop()` before the debounced
  re-list fires) has no dedicated spec — `git-watcher.service.spec.ts` has no
  `gitMarkerSeenDuringStorm`/`nestedRootsRefreshTimer` reference at all. Moderate,
  untested, but the residual behaviour is provably safe by construction (see
  above), not merely assumed.

### Fix 2 — atomic snapshot swap in the file index (Failure mode 2 mechanics)

CONFIRMED for the scenario the base review actually named (post-storm rebuild
against a previously-indexed workspace); the caller-side readiness gap is
unchanged and was never a required fix.

- `build()` now takes an `into: FolderSnapshot = entry` parameter
  (`workspace-file-index.service.ts:443-450`); `rebuildAfterStorm` passes a fresh
  `staging` object (`:793`) so `into.files.clear()`/`into.directories.clear()`
  (`:454-455`) operate on the staging maps, never on `entry.files`/`entry.directories`
  directly. `search()`/`getAll()`/`searchDirectories()` (`:970-1023`) still read
  `this.active.files`/`.directories` by reference, and that reference is not
  reassigned until the `.then()` success branch (`:806-811`) — so a query mid-rebuild
  reads the OLD, complete snapshot, never a partially-cleared one. This is the exact
  mechanism the base review's "current handling" note anticipated but the pre-fix
  code did not yet have (pre-fix `build()` cleared `entry.files`/`entry.directories`
  unconditionally at `:432-434` per the base review's own citation).
- Live watcher events during a rebuild are applied to BOTH snapshots:
  `addLiveFileEntry` (`:897-903`) writes to `entry` and, when `entry.stormStaging`
  is set, also to the staging snapshot; `onDelete` (`:869-873`) deletes from both
  `entry.files` and `entry.stormStaging?.files`. A file deleted mid-walk is
  therefore NOT resurrected by the walk finishing later — the delete already
  removed it from `into` (staging) if the walk's batch for that path had not yet
  landed, or removes it retroactively if the walk's `discoverWorkspacePaths`
  batch already wrote it (the delete runs after, per JS event-loop ordering,
  since `onDelete` is synchronous and any batch write inside `build()` yields
  between batches). Proven by
  `workspace-file-index.service.spec.ts:1167-1205` ("keeps serving the previous
  snapshot during the rebuild and swaps the new one in at the end" — asserts a
  live create during the rebuild gate is visible immediately AND survives the
  swap) and `:1207-1247` (queued-rebuild-after-failure test, below).
- `ignoreFiles` swap: same mechanism — `into.ignoreFiles = parsed` (`:470`)
  writes to staging during a rebuild, `entry.ignoreFiles` unchanged until swap.
  `isExcluded()`'s awaited ignore check (called from `onCreate`/`onChange`,
  gated by `admitEvent` first) reads `entry.ignoreFiles` (not staging), so a
  live event during a rebuild is excluded/included by the PRE-rebuild ignore
  rules, consistent with "queries keep serving the previous one" — no
  half-migrated `ignoreFiles` state is observable.
- Teardown/generation during a rebuild: `teardownEntry` (`:626-628`) calls
  `this.clearStorm(entry)` before disposing the watcher, which sets
  `entry.stormStaging = undefined` and `entry.stormRebuildQueued = false`
  — but `rebuildAfterStorm`'s in-flight `build()` promise is NOT cancelled, only
  its bookkeeping variables. The `.then()`/`.catch()`/`.finally()` handlers all
  re-check `entry.generation !== generation` before touching `entry.files`/etc.
  (`:801, :814, :824`), so a build that resolves after a teardown-and-restart
  correctly no-ops rather than resurrecting a torn-down entry's data. Pinned by
  `workspace-file-index.service.spec.ts:1154-1165` ("dispose during a storm
  cancels the pending rebuild").
- `ensureReadyFor`/`isReady()` semantics: `rebuildAfterStorm` never touches
  `entry.buildPromise` (grepped — no reference to `buildPromise` anywhere in
  `rebuildAfterStorm`, `admitEvent`, `armStormTimer`, or `clearStorm`), so
  `ensureReadyFor` (`:345-380`) continues to gate ONLY the first build, exactly
  as before this batch. `entry.ready` is set `true` once at the end of `doStart`
  (`:427`) and never touched by the storm-rebuild path — correct, since a
  folder that was already `ready` before a storm stays `ready` throughout the
  rebuild (the base review's Failure mode 2 was never about the first-build
  window; it was specifically about a storm wiping an ALREADY-indexed folder,
  which this fix resolves).
- Residual, correctly out of scope for "fix the atomic swap": `search()`/
  `getAll()`/`searchDirectories()` still have no `isReady()` gate for the
  FIRST-build window (a caller that bypasses `ensureReadyFor` and calls
  `search()` while `ready` is still `false` can still see a partially-populated
  `entry.files` map, because `into` defaults to `entry` there too). This was
  the base review's Moderate-1 recommendation ("surface `isReady()` ... or note
  explicitly"), not a required fix, and remains open — see CLAUDE.md finding
  below.
- Memory doubling / LRU: a rebuild holds two full snapshots (`entry.files`/
  `entry.directories` plus `staging.files`/`staging.directories`) for the
  rebuild's duration, which was already true of the pre-fix code's local
  `parsed` ignore-file array and is inherent to any atomic-swap design: no new
  concern introduced by this fix, not evaluated further (no LRU/eviction
  interaction observed — `lastActiveAt`/overflow-cap logic is untouched by this
  diff).

### Fix 3 — queued rebuild survives a failed rebuild (Failure mode 3)

CONFIRMED, correctly implemented and tested.

- `rebuildAfterStorm`'s `.finally()` (`workspace-file-index.service.ts:813-819`)
  now unconditionally clears `entry.stormStaging` and, if
  `entry.stormRebuildQueued` is set, clears the flag and calls
  `rebuildAfterStorm` again — regardless of whether the `.then()` or `.catch()`
  branch ran. This replaces the pre-fix code's `if (entry.buildPromise)` gate
  (base review's citation, old `:794`) that the base review correctly identified
  as broken for the failure branch (the old error branch set
  `entry.buildPromise = undefined`, so the old `.finally()`'s truthiness check
  silently dropped the queued rebuild).
- Queue is still bounded to exactly one: `stormRebuildQueued` is a `boolean`
  (`:227`), not a counter or array, and `rebuildAfterStorm`'s entry guard
  (`if (entry.stormStaging) { entry.stormRebuildQueued = true; return; }`,
  `:784-787`) means a third storm ending while a queued rebuild is already
  pending just re-sets the same boolean — no unbounded growth.
- Proven by `workspace-file-index.service.spec.ts:1207-1247`: rebuild 1 is
  parked on a gate, storm 2 ends and queues a second rebuild, rebuild 1's walk
  is then made to throw, and the test asserts (a) `logger.error` was called
  with the "keeping the previous snapshot" message, (b) `discoverWorkspacePaths`
  was called a THIRD time (the queued rebuild actually ran), and (c) a file
  created after the failure (`gen/after-failure.ts`) is found by `search()` —
  proving the queued rebuild's own success is what's being served, not a stale
  snapshot from before either storm.

### Fixes 4-7 — casts, comments, CLAUDE.md

- `as unknown as Error` casts: CONFIRMED removed everywhere they were flagged
  (`git-watcher.service.ts` — grepped, zero remaining occurrences in the file).
  `Logger.warn(message: string, ...args: unknown[]): void`
  (`libs/backend/vscode-core/src/logging/logger.ts:145`) — the second argument
  was always typed `unknown[]`, so the cast was pure noise and nothing
  downstream narrows it to `Error` (`error()` is a separate, differently-typed
  method at `:156` that this batch does not touch). No behaviour change, style
  fix only, correctly applied.
- `libs/backend/workspace-intelligence/CLAUDE.md:127-138`: the new bullet
  accurately describes the storm-pause/rebuild mechanism this batch adds
  (per-folder breaker, staging snapshot, atomic swap, failed-rebuild and
  queued-rebuild behaviour, Batch 11 note). One imprecision: the closing clause
  "so `search`/`getAll`/`searchDirectories` never see a half-built index" reads
  as a blanket guarantee when it is only true for the post-storm-rebuild case
  just described — the FIRST-build window (before `ready` becomes `true`) is
  not covered by this guarantee and CLAUDE.md does not say so. A reader
  skimming this bullet in isolation could conclude `search()` is always safe to
  call without `ensureReadyFor`/`isReady()`, which is not true. Minor —
  narrow the sentence to "never see a half-built index **during a rebuild**" or
  add a clause distinguishing first build from rebuild.
- `git-watcher.service.ts:236-242`: the `CONTENT_CHANGE_MAX_WAIT_MS` doc comment
  was rewritten from "Three debounce windows" (flagged as stale by the style
  review) to "Four content debounce windows" — this is itself now inaccurate/
  confusing: there is exactly ONE content-change debounce timer (the single
  timer this batch introduced to replace the per-file map), and the file has
  FIVE debounce constants in total (`CONTENT_CHANGE_DEBOUNCE_MS`,
  `GIT_DEBOUNCE_MS`, `WORKSPACE_DEBOUNCE_MS`,
  `NESTED_ROOTS_REFRESH_DEBOUNCE_MS`, `SWITCH_DEBOUNCE_MS` — grepped). "Four
  content debounce windows" parses as "four windows that are each content
  debounce windows," which is wrong on both the noun (only one is a content
  window) and the count (five total, not four). Minor documentation defect,
  attempted fix landed worse than the original ambiguity it replaced.

### New finding: `degradation-audit:lint` currently FAILS for `apps/ptah-electron`

**Serious.** Not one of the seven fixes requested, but directly relevant to
"did Batch 4 introduce unmarked degradation sites" and confirms the task's own
lead: the tool's prior findings at (pre-fix) `git-watcher.service.ts:706` and
`:709` are the SAME catch block as the current `:728`/`:731` — the fixes shifted
its line numbers by adding code above it but did not resolve the underlying
marker-placement defect.

- Ran `npx tsx tools/degradation-audit/check-degradation.ts` (the same command
  `degradation-audit:lint`'s Nx target runs) directly against the working tree.
  Result: `apps/ptah-electron: 6 FAIL (baseline 4)` — this batch's working tree
  currently fails the repo's own CI gate (`.github/workflows/ci.yml:138-141`,
  `node node_modules/nx/bin/nx.js run degradation-audit:lint`).
- The two new violations are both the `refreshNestedRepoRoots` catch block:
  - `apps/ptah-electron/src/services/git-watcher.service.ts:728`
    `[catch-return-sentinel]` — the `catch (err) { ...; return; }` block
    (`:728-742`) is flagged because the tool's `isErrorCall` check only
    recognizes a `.error(...)` call as "handled" (`check-degradation.ts:186-192`);
    this catch calls `this.logger.warn(...)`, not `.error(...)`, so structurally
    it looks like a swallowed error to the detector even though it is
    genuinely reported (once, via the `worktreeListFailureLogged` latch).
  - `apps/ptah-electron/src/services/git-watcher.service.ts:731`
    `[orphaned-suppression]` — a `// degradation-audit: optional-capability - ...`
    comment DOES exist (`:731-732`), but it sits inside the nested
    `if (!this.worktreeListFailureLogged) {` block, several lines below the
    catch clause's own opening brace at `:728`. The tool's Zone 2 for a
    `CatchClause` only accepts comment lines starting IMMEDIATELY after
    `catch (...) {` opens (`check-degradation.ts:508-514`,
    `commentBlockBelow(sourceLines, openBraceLine + 1)`); Zone 1 requires the
    comment directly above the `catch` line, which here is
    `worktrees = await this.gitInfo.getWorktrees(workspaceRoot);` — not a
    comment. Neither zone reaches the marker's actual position, so it never
    attaches to the catch and is reported as orphaned in addition to the
    catch itself being flagged.
- Impact: this is not a runtime defect (the catch genuinely reports, once, via
  `logger.warn`) but it is a currently-failing, PR-blocking CI gate directly
  caused by code in this batch's file, and the "fix" pass that touched
  surrounding lines in this same function (moving `getGitInfo` →
  `refreshGitInfo`, updating the log-arg casts) did not notice or resolve it.
- Fix: move the `// degradation-audit: optional-capability - ...` comment to be
  the first line(s) immediately after `catch (err) {` (before the
  `if (!this.worktreeListFailureLogged)` check), so it lands in the tool's
  Zone 2. Two-line change, no logic change.

### Delta verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: `degradation-audit:lint` fails today for `apps/ptah-electron`
  (6 vs baseline 4) because of a misplaced suppression comment on the
  `refreshNestedRepoRoots` catch (`git-watcher.service.ts:728-732`) — a small,
  mechanical fix, but it will fail CI as committed.
- Fixes verified correct: Fix 1 (storm-safe `.git` marker handling, proven
  zero-call by a real spy), Fix 2 (atomic snapshot swap, proven by the
  mid-rebuild-visibility and dispose-during-storm specs), Fix 3 (queued
  rebuild survives a failed rebuild ahead of it, proven by the three-call
  `discoverWorkspacePaths` assertion), Fix 4 (casts removed, `Logger.warn`
  confirmed to accept `unknown[]`, no behaviour change).
- Outstanding, none blocking merge on their own: (1) relocate the orphaned
  `degradation-audit` marker at `git-watcher.service.ts:731` — this one DOES
  block merge via CI; (2) the "Four content debounce windows" comment
  (`:236-238`) is a net-new minor inaccuracy from the fix pass, worth a
  one-line correction; (3) CLAUDE.md's new storm-rebuild bullet
  (`workspace-intelligence/CLAUDE.md:127-138`) should scope its
  never-see-a-half-built-index claim to the rebuild case specifically, since
  the first-build readiness gap for direct `search()` callers (base review's
  Moderate-1) remains open and unmentioned; (4) the storm-exit-coincides-with-
  `stop()` interleaving for `gitMarkerSeenDuringStorm` has no dedicated test,
  though it is provably safe by construction (a subsequent `start()` always
  re-seeds from a fresh `git worktree list`).
