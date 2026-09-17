# Code Logic Review — `TASK_2026_437_0778` Batch 11

Scope reviewed: `apps/ptah-electron/src/activation/boot-heavy-services.ts`,
`apps/ptah-electron/src/services/git-watcher.service.ts` (+ `.spec.ts`),
`apps/ptah-electron/src/services/git-watcher.stress.{harness,spec}.ts`,
`eslint.config.mjs`, `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts`
(+ `.spec.ts`), `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
(+ `.spec.ts`), `libs/backend/workspace-intelligence/CLAUDE.md`. Read in full, not by diff hunk.
Cross-checked against `handoff.md` §4/§6, `batches.md` Batch 4/6/8/9/11 outcomes,
`implementation-plan.md` C10/INV-1/INV-2/INV-5/INV-6/AC-1/AC-2, `test-report-b6.md`, the
`IWorkspaceWatcher` port and `WorkspaceChangeCoalescer` contract. Read-only; no code changed, no
git run beyond `git diff`.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 4              |
| Failure modes found | 4              |

## Five logic questions

### 1. How does this fail silently?

- `WorkspaceFileIndexService.subscribe` (`workspace-file-index.service.ts:697-723`): when
  `workspaceWatcher.watch()` throws, the catch logs `'watcher unavailable (index will not stay
live)'` at `warn` and returns. There is no retry, no periodic re-arm attempt, and no field a
  caller can read to learn the folder went static (`ready` still becomes `true` from `doStart`,
  `hasIndexFor` still reports `true`). From that point the `@` picker for that folder silently
  serves an ever-staler snapshot — new files never appear, deleted files never disappear — with
  the only trace a one-time warn line nobody reads. This is the same failure shape the file's own
  docblock (`workspace-file-index.service.ts:1-87`) says the redesign exists to prevent for
  cross-folder contamination, left open here for "the watcher never came up".
- `GitWatcherService.subscribeWorkspace` (`git-watcher.service.ts:465-476`) does the same thing
  for the same reason, but it degrades more gracefully: the `.git` file watchers keep git status
  live, so the failure mode is "content-change pushes and non-git-triggered refreshes stop", not
  "everything stops". Still no retry and no user-visible signal.
- `refreshNestedRepoRoots` (`git-watcher.service.ts:638-684`) on a `getWorktrees` failure logs once
  and keeps the current subscription — correctly documented as a degrade, not silent, but the
  degrade is permanent for the life of the arm: nothing re-attempts the listing later on its own:
  the next attempt is a `.git/worktrees` filesystem event, which for a repo that starts life with
  no `worktrees` directory can never fire on its own (`start()` only watches `worktreesDir` when
  `fs.existsSync(worktreesDir)` was true at arm time, `git-watcher.service.ts:289-294`).

### 2. What user action produces unexpected behaviour?

- Two `.git/worktrees` events arriving close together race `refreshNestedRepoRoots` calls with no
  ordering token beyond `armGeneration` (which both calls share, since neither `start()` nor
  `stop()` ran between them). If the first `getWorktrees()` call resolves AFTER the second (a
  plausible ordering under process load — `git worktree list` is a spawn through the same
  `GitProcessGate`/spawn-worker pool this task also touches, `implementation-plan.md` C11/C12), the
  STALE list is applied last and `subscribeWorkspace` resubscribes with the older nested-root set —
  silently reverting a just-added worktree back into the watched tree until the next
  `.git/worktrees` event repeats the race. `sameRoots` dedup (`:924-927`) does not help; it compares
  the applied set to `subscribedNestedRoots`, not to "the freshest known list".
- A user who deletes a directory that both contains files AND is itself excluded (nested repo,
  `node_modules`, etc.) sees the file index's `deleteLiveDescendants` walk the WHOLE active index
  (see Moderate-1 below) even though nothing under an excluded tree was ever indexed — the sweep
  cost is paid regardless of whether the delete touched anything relevant.

### 3. What input data produces a wrong answer?

- Drive-letter case divergence between `entry.root` (the spelling `ensureReadyFor`/`start` were
  called with) and the spelling a native watch engine reports for a delete. Files are keyed by
  `path.normalize(absPath)` (`workspace-file-index.service.ts:940`, `:757`); directories are keyed
  by `path.join(entry.root, ...segments)` built at walk time (`:984`). Neither call folds case.
  `path.normalize`/`path.join` fix the separator-style mismatch the docblock (`:238-241`) claims to
  fix (`D:/` from fast-glob vs `D:\` from the watcher), but a drive letter reported in a different
  case by the OS (`d:\proj\foo` vs the entry's `D:\proj\foo`) still produces two different map
  keys. A delete under that spelling silently fails to remove the stale entry: the `@` picker keeps
  offering a file that no longer exists. Low probability on a single local drive, higher on
  network/UNC-mounted workspaces; not exercised by any spec in this diff.
- `WorkspaceFileIndexService.search()`/`getAll()`/`searchDirectories()` read `this.active` with no
  gate on `entry.ready` (`:1016-1069`). A caller that races `ensureReadyFor()` — calls `search()`
  before the returned promise settles, using the synchronously-assigned `activeKey` the docblock
  advertises (`:364-366`) — reads `entry.files`/`entry.directories` while `build()` is still
  populating them (`build` clears then fills the SAME maps for a first build,
  `workspace-file-index.service.ts:471-472`, `entry` not `into`). The query does not throw and does
  not return "not ready"; it returns a PARTIAL result set for the folder, indistinguishable from a
  small workspace. This is exactly FU-4c ("first-build readiness gap … Close in Batch 11",
  `batches.md:289`), and nothing in this diff touches `search`/`getAll`/`searchDirectories`,
  `ensureReadyFor`, or adds an `isReady`/ready gate to them. Batch 11 does not close FU-4c.

### 4. What happens when a dependency fails?

- `IWorkspaceWatcher.watch()` throwing synchronously: both consumers catch, warn, and keep the app
  running (`git-watcher.service.ts:465-476`; pinned by
  `git-watcher.service.spec.ts:198-214`, `'a failing watch() is logged and does not break start()'`,
  which also confirms the `.git` watchers stay armed and the app still boots). Good coverage; this
  answers the "subscription failure path" item in the request directly.
- An `overflow`/`truncated` batch (host restart, degraded adapter, storm) is handled by both
  consumers with a bounded, idempotent response — `onWorkspaceOverflow`
  (`git-watcher.service.ts:600-608`) and `rebuildAfterOverflow`/`runOverflowRebuild`
  (`workspace-file-index.service.ts:835-889`, the latter proven not to stack rebuilds by
  `workspace-file-index.service.spec.ts:1341` `'overflows during a rebuild queue exactly one more…'`
  — this directly answers the FU-8b degraded-cadence question: rebuilds do not stack).
- What is NOT handled: the coalescer has no way to tell a consumer "a storm has started", so a
  consumer's own independent debounce (`GitWatcherService.scheduleUpdate`, 2 s) can fire BEFORE the
  eventual `overflow` arrives for the same incident. See "ST-1b decision" below — this is the
  measured, reproducible cause of AC-2's "exactly 1" becoming "at most 2" in the P2 code, and it is
  a dependency-shape gap (the port's guarantees section, `workspace-watcher.interface.ts:139-160`,
  promises "one loss-of-events incident … yields one overflow batch", not "one refresh").

### 5. What is missing that the requirements never mentioned?

- No requirement anywhere states what happens to `WorkspaceFileIndexService.search()` results
  during the FIRST build's yielding walk if a caller bypasses `ensureReadyFor` and calls `search`
  directly (only `ensureReady`/`ensureReadyFor` are documented entry points). FU-4c names this gap
  and Batch 11 was assigned to close it; it remains open.
- User decision Q1 ("nested repos/worktrees excluded from every consumer including the `@`
  picker") is implemented literally — `getFileCount`, `indexWorkspace`, `indexWorkspaceStream` and
  `discoverWorkspacePaths` all now go through `discoverFilesOutsideNestedRepos`
  (`workspace-indexer.service.ts:600-661`) — but nothing in this batch or the plan documents the
  DOWNSTREAM effect on `getFileCount`'s other callers (`code-symbol-indexer.service.ts`,
  `code-quality-assessment.service.ts`, the two `vscode-lm-tools` namespace builders,
  `boot-thoth-runtime.ts`). Those consumers will now silently symbol-index, quality-assess and
  report smaller counts for workspaces with nested repos/worktrees, which is presumably intended
  under "every consumer" but is not called out anywhere as a confirmed, reviewed consequence beyond
  the `@` picker. Not a defect; a confirmation gap worth one line in `context.md` or the plan.

## Failure modes

### Stale `@`-picker index after a watch-host failure

- Trigger: `IWorkspaceWatcher.watch()` throws for a folder (host never starts, permission denied on
  the watch root, etc.).
- Symptom: the folder's index is built once and then frozen; new/renamed/deleted files never
  appear or disappear from `@` mentions, with no user-facing indicator.
- Evidence: `workspace-file-index.service.ts:715-722` (catch, warn, no retry, no state flag).
- Current handling: one `warn` log line.
- Recommendation: at minimum, flip a `live: boolean` on the entry and surface it through
  `hasIndexFor`/a diagnostic RPC so a caller (or a later background retry, per the P3 governor) can
  tell "cached and live" apart from "cached and abandoned".

### Nested-root listing race on rapid `.git/worktrees` churn

- Trigger: two `.git/worktrees` directory events close enough together that both
  `refreshNestedRepoRoots` calls are in flight, and the `getWorktrees()` spawn for the FIRST event
  resolves after the SECOND's.
- Symptom: the watcher resubscribes with the stale (first-event) worktree list, silently re-including
  a worktree the user just added to the watched tree — or the reverse, briefly re-watching a
  worktree the user just removed — until the next `.git/worktrees` event repeats the race.
- Evidence: `git-watcher.service.ts:638-684`; no per-call sequence token beyond `armGeneration`
  (unchanged across both calls).
- Current handling: none — `sameRoots` only guards against redundant resubscribes of the SAME
  answer, not against applying an OUT-OF-ORDER one.
- Recommendation: stamp each `refreshNestedRepoRoots` call with a local monotonic counter and drop
  a resolution that is not the latest, the same pattern `entry.generation` already uses in
  `WorkspaceFileIndexService`.

### AC-2 (P2) "exactly 1 refresh" is not met; the spec was rewritten to match, not to flag it

See "ST-1b decision" below — filed as its own section because it is the item the batch explicitly
asks to be judged.

### FU-4c not closed

- Trigger: a caller invokes `search`/`getAll`/`searchDirectories` before the promise
  `ensureReadyFor` returned has settled, using `indexedRoot`/`activeKey`'s synchronous assignment
  as the "it's safe now" signal the docblock documents.
- Symptom: a partial result set from a folder whose walk is still running, returned with no
  indication it is incomplete.
- Evidence: `workspace-file-index.service.ts:1016-1069` (no `ready` gate); `batches.md:289`
  ("Close in Batch 11"); no touch to these methods in this diff.
- Current handling: none.
- Recommendation: either gate the three query methods on `active.ready` (returning `[]` or the
  previous snapshot instead of a partial one) or explicitly re-defer FU-4c in `batches.md` instead
  of letting it read as closed by omission.

## ST-1b decision — evaluate options, recommend one

**What ST-1b actually measures**: `@parcel/watcher` delivers the tree delete as ONE lone event
~80-110 ms in, then the remaining ~8,810 events in a single native callback once the delete itself
finishes. The lone event is below the storm threshold, so `WorkspaceChangeCoalescer` flushes it at
once as a normal one-path batch (`workspace-change-coalescer.ts:353-364`: `scheduleFlush`'s delay
is `0` whenever `lastEmitAt` is `undefined` OR more than `minBatchIntervalMs` in the past — this is
not "first ever batch only", it is "leading edge of every burst that starts after a quiet gap",
confirmed by reading `scheduleFlush`). `GitWatcherService.onWorkspaceBatch` reacts to that normal
batch by arming its own 2 s `WORKSPACE_DEBOUNCE_MS` debounce (`git-watcher.service.ts:581`). The
flood then enters a storm inside the coalescer and exits ~4.0-4.3 s in, emitting one `overflow`
batch (`onStormTimer` → `foldPendingIntoOverflow`, `workspace-change-coalescer.ts:324-340`). Because
the service's 2 s debounce started at ~0.1 s, it fires at ~2.1 s — BEFORE the storm's overflow
arrives at ~4.0-4.3 s — so two independent `fetchAndPush()` calls happen: one from the ordinary
debounce, one from `onWorkspaceOverflow`'s immediate call (`:600-608`). The coalescer has no
"a storm has started" signal a consumer can use to cancel its own pending debounce; P1's in-process
watcher had exactly that (it cancelled the pending debounce on storm entry), and Batch 11's port
migration lost it because the port never carried it.

The executor's response was to rewrite the ST-1b assertions in
`git-watcher.stress.spec.ts:132-165` to accept "at most one refresh before the rescan, plus exactly
one from the rescan" instead of the plan's `implementation-plan.md:794` P2 row: "storm entered
once, exactly 1 status refresh + 1 truncated content push". That is a real, measured, reproducible
behavioural gap against a written, reviewed acceptance criterion, and it was closed by loosening
the test rather than by fixing the code or by taking the deviation back to the plan as a recorded,
approved change. The rewritten spec is a defensible DESCRIPTION of the current mechanism (it does
correctly bound the extra refresh to at most one, and still catches an unbounded storm), but as
delivered it silently redefines what "AC-2 holds" means without updating
`implementation-plan.md`'s AC-2 text, which still reads "exactly 1" for P2. That gap between what
the plan promises and what the code (and now the test) delivers is the reason this review is
NEEDS_REVISION rather than a clean pass with a follow-up noted.

**Options, evaluated**:

- **(A) Accept 2 refreshes as the P2 contract, update AC-2's text.** Cheapest, but it is a
  unilateral downgrade of a written, reviewed invariant by the same batch that hit it, decided by
  rewriting a test rather than by a recorded decision. Even taken as correct on the merits, it still
  needs the `implementation-plan.md:794` row edited and `handoff.md`/`batches.md` to say so
  explicitly — right now nothing outside the spec's own comment records the change.
- **(B) Coalescer holds the leading edge of a batch briefly (recommended).** Checked: the
  coalescer's leading-edge behaviour today is `delay = 0` whenever more than `minBatchIntervalMs`
  has elapsed since the last emit (`workspace-change-coalescer.ts:356-359`) — there is currently NO
  hold at all on a cold-start batch, so this is a real gap, not a tuning knob. A fixed hold (the
  existing `minBatchIntervalMs` floor of 250 ms already gives one path to it; raising the specific
  `GitWatcherService` workspace subscription to 500 ms, which the port already supports as a
  per-subscription option and which `git-watcher.service.ts:453-463` does not currently set) would
  very likely absorb the measured 80-110 ms gap with margin, and is a change to ONE component
  (`WorkspaceChangeCoalescer.scheduleFlush`) that benefits all three adapters and both consumers
  uniformly, without touching the port's wire contract. Cost: a bounded, one-time latency add
  (≤500 ms) at the start of any burst that follows a quiet period — invisible against the existing
  2 s/8 s consumer-side debounces for git decorations and the `@` index's batch-patch cadence, and
  still within INV-1's "≤4 batches/s" ceiling. Risk: it is a heuristic against a measured gap from
  ONE environment (three probe runs on Windows); a slower or faster machine could still occasionally
  split lone-event-then-storm across the hold. It reduces the failure's likelihood without
  eliminating it structurally, so the rewritten "at most 2" assertion likely still needs to stay as
  a defensive bound even after this fix, but the common case gets to exactly 1.
- **(C) Add a `stormStarted` signal to the port.** Structurally the most correct fix (it lets a
  consumer cancel its own debounce the instant a storm begins, restoring the P1 behaviour exactly),
  but it is a CONTRACT change across the Electron host, the CLI host, and the VS Code adapter (three
  implementations), plus the shared contract suite (`runWorkspaceWatcherContract`) and every
  consumer spec that stubs `IWorkspaceWatcher`. That is Batch-15-sized scope creep for a Batch 11
  follow-up and reopens a port that has already shipped through Batches 7-10 with real users
  (Batch 8/9 adapters).
- **(D) Consumer-side delay-and-cancel.** Rejected on the numbers already in the batch: overflow
  only arrives after the storm's exit, itself gated on 2 s of quiet
  (`event-storm-breaker`'s poll cadence via `msUntilNextPoll`), so a delay long enough to reliably
  wait for a possible overflow (N > storm duration, which is unbounded for a storm that keeps
  re-entering) directly fights the WORKSPACE_MAX_WAIT_MS ceiling that batch 4's own doc comment
  (`git-watcher.service.ts:183-195`) says exists BECAUSE waiting longer starved decorations
  outright on a real monorepo. This option reintroduces the exact defect Batch 4 fixed, to avoid a
  bounded extra refresh Option B already shrinks.

**Recommendation: (B)**, with (A) as the explicit fallback ONLY if B is measured and still does not
close the gap — and either way, `implementation-plan.md:794`'s AC-2 P2 row must be updated to match
whatever the code delivers, rather than left to silently disagree with the shipped test. Cost of B:
one function (`scheduleFlush`'s cold-start branch) plus a `minBatchIntervalMs: 500` option on the
`GitWatcherService` subscription plus a contract-suite case for "a batch after a quiet gap is held
for `minBatchIntervalMs`" plus a re-run of ST-1b to confirm the two-refresh window closes or
shrinks to a documented residual rate.

## Blocking issues

None found in the scope reviewed.

## Serious issues

### AC-2 (P2) contract silently weakened

- File: `apps/ptah-electron/src/services/git-watcher.stress.spec.ts:132-165`;
  `.ptah/specs/TASK_2026_437_0778/implementation-plan.md:794`.
- Scenario: any tree-delete storm outside the excluded set, on the shipped P2 code path.
- Impact: `implementation-plan.md` still states "exactly 1" for P2; the code delivers "at most 2";
  the test that is supposed to gate this was changed to match the code instead of flagging the gap
  to the plan owner. A reader trusting the plan's AC-2 row is misled.
- Fix: apply the ST-1b decision above; update the plan text to match whatever ships, explicitly and
  visibly (not just in a spec docblock).

### FU-4c assigned to Batch 11, not closed

- File: `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts:1016-1069`;
  `.ptah/specs/TASK_2026_437_0778/batches.md:289`.
- Scenario: a direct `search()`/`getAll()`/`searchDirectories()` call racing an in-flight first
  build for the same root.
- Impact: silently partial autocomplete results during the (multi-second, per the file's own
  measured 8-15 s baseline) first walk of a large workspace — exactly the readiness gap FU-4c named.
- Fix: gate the three query methods on `entry.ready`, or move FU-4c explicitly to a later batch in
  `batches.md` instead of letting Batch 11 read as having closed it.

## Moderate and minor issues

- **Moderate** — `deleteLiveDescendants` (`workspace-file-index.service.ts:904-926`) is an
  unconditional, synchronous, non-yielding pass over EVERY entry in the active folder's `files` and
  `directories` maps (doubled when a rebuild is staging, `liveSnapshots`), triggered by ANY batch
  that contains one or more directory deletes — not bounded by the number of deletes, but still
  O(index size × depth) per qualifying batch with no yield point, unlike `build()`'s explicit
  `yieldToEventLoop()`. On the file's own cited largest captured folder (15,249 files / 4,935
  directories) this is likely low-single-digit milliseconds; on a much larger monorepo repeatedly
  hit by directory-delete batches (a build tool cleaning `dist/`, for instance) it is a
  main-thread cost this task otherwise goes to great lengths to eliminate elsewhere. Not tested at
  scale in this diff.
- **Moderate** — ESLint `IN_MAIN_RECURSIVE_WATCH_SELECTORS` (`eslint.config.mjs:47-84`) is an
  AST-shape rule and is easy to defeat without intending to: an options object built in a variable
  (`const opts = { recursive: true }; fs.watch(dir, opts, cb)`) or an aliased import
  (`import { watch as w } from 'node:fs'`) is invisible to it, because the selectors require a
  literal `ObjectExpression` argument / the literal identifier name `watch`. `batches.md:735`'s
  "Done when: INV-1 is enforced by lint" overstates what a selector-based rule can guarantee; worth
  one line acknowledging the rule is a strong hint, not a closed enforcement, given INV-1 is framed
  as a hard invariant elsewhere in the plan (`implementation-plan.md:101`).
- **Moderate** — directory keys built at walk time (`path.join(entry.root, ...segments)`,
  `workspace-file-index.service.ts:984`) are never run through the same `path.normalize` file keys
  get (`:940`, `:757`). Both currently collapse separator style identically on the platforms this
  ships to, so this is not observed to diverge today, but the two code paths constructing what is
  documented as "the same key space" (`:238-241`) use two different normalization calls; a future
  edit to either one can silently break the pairing. Worth unifying on one helper.
- **Minor** — `RECURSIVE_WATCH_ALLOWED`'s catch-all block (`eslint.config.mjs:` final block,
  `files: RECURSIVE_WATCH_ALLOWED.filter((file) => !file.endsWith('.ts'))`) sets
  `'no-restricted-syntax': 'off'` entirely for `apps/ptah-electron/scripts/watch-renderer.js`,
  dropping `MESSAGE_LITERAL_SELECTORS` too, not just the watch selectors. Low risk (a dev-only build
  script), but broader than the stated intent.
- **Minor** — `holdsGitEntry` (`workspace-indexer.service.ts:729-744`) treats a probe failure as
  "not a nested repo" (returns `false`), so a `.git` entry behind a transient permission error or
  lock is silently indexed instead of excluded for that pass — consistent with the file's own
  documented philosophy for this class of error elsewhere, but worth confirming this is the intended
  fail-open direction for the D4 exclusion specifically (a false negative here means a worktree's
  files briefly appear in the `@` picker, not that real files go missing).

## Data flow

1. `GitWatcherService.start` → `subscribeWorkspace(root, [])` (static exclusion rules only) — OK,
   matches the plan's "subscribed at once with the static rules" sequencing.
2. `refreshNestedRepoRoots` lists worktrees asynchronously, then resubscribes with the discovered
   nested roots if the set changed — OK for the single-caller case; races under overlapping calls
   (see Failure mode above).
3. `WorkspaceChangeCoalescer` batches raw engine events per subscription: exclusion, storm-breaking,
   nested-repo detection all happen here, off main-thread-critical-path work per Batch 8/9 — OK,
   verified against the port's own contract suite claim (not re-run in this review, but its
   existence and Batch 7/8/9 sign-off are on record).
4. `onWorkspaceBatch` (git) / `onBatch` (file index) receive at most one call per
   `minBatchIntervalMs` — OK mechanically, but the leading-edge gap (ST-1b decision) means a
   cold-start batch can precede a storm the consumer cannot yet see coming.
5. `onWorkspaceOverflow` / `rebuildAfterOverflow` fold an incomplete batch into exactly one
   corrective action each, both idempotent against a pending debounce/build — OK, pinned by specs
   for both consumers.
6. File-index `addCreatedPaths` stats new paths with bounded concurrency (32) in slices — OK, no
   unbounded thread-pool fan-out for a 500-path batch.
7. File-index deletes: `deleteLivePath` (O(1) per key) is fine; `deleteLiveDescendants` (O(index
   size), see Moderate finding) is the one unbounded step in an otherwise bounded pipeline.
8. `WorkspaceIndexerService.discoverFilesOutsideNestedRepos` (D4): walk → per-directory `.git`
   existence probes, shallowest-first, bounded concurrency (64) — OK, matches the file's own
   measured overhead (30 ms beside a 95 ms walk) and correctly excludes the root itself and handles
   both `.git` file (worktree) and directory (repo) shapes.

## Requirements fulfilment

| Requirement                                                                     | Status                | Gap                                                                                                                                                             |
| ------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 11.1 — `GitWatcherService` onto `IWorkspaceWatcher`, delete recursive path | COMPLETE              | none found; `.git` watchers correctly unchanged                                                                                                                 |
| Task 11.2 — `WorkspaceFileIndexService` onto the port                           | COMPLETE (with a gap) | FU-4c readiness gate not added despite plan text assigning it here                                                                                              |
| Task 11.3 — nested repo/worktree exclusion in the initial walk (D4)             | COMPLETE              | consumer-impact-beyond-`@`-picker not explicitly confirmed in the docs                                                                                          |
| Task 11.4 — ESLint rule against in-main recursive watching                      | PARTIAL               | rule ships and is proven against the fixture files present, but has known blind spots (aliased import, indirect options object) not called out as residual risk |
| AC-1 (ST-1)                                                                     | COMPLETE              | 0 refreshes/pushes confirmed by spec, matches plan                                                                                                              |
| AC-2 (P2, "exactly 1")                                                          | PARTIAL               | measured and accepted as "at most 2" without a plan-text update — see ST-1b decision                                                                            |
| FU-4a (delete duplicated storm-exit loops)                                      | COMPLETE              | both loops removed; coalescer is the one implementation now                                                                                                     |
| FU-4d (port/replace unattributed + own-refresh echo filters)                    | COMPLETE              | `@parcel/watcher` does not report the NTFS echo the old `fs.watch` path did; ST-1b's `directoryUpdates=0` assertion pins it                                     |
| FU-8b (degraded rescans must not stack rebuilds)                                | COMPLETE              | pinned by `'overflows during a rebuild queue exactly one more…'`                                                                                                |

Implicit requirements not addressed: a signal or retry path for "the watcher subscription failed
and will never come back" (see Failure mode 1); ordering protection for concurrent
`refreshNestedRepoRoots` calls.

## Edge cases

| Case                                                      | Handled | How                                                                    | Concern                                                       |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `watch()` throws at subscribe time                        | YES     | catch + warn, previous/no subscription kept, app still boots           | no retry, no live/dead signal (Failure mode 1)                |
| Overflow arrives mid-rebuild (file index)                 | YES     | `rebuildQueued` runs exactly one more after the current finishes       | none — well covered                                           |
| Storm then quiet, lone leading event before it (ST-1b)    | PARTIAL | at most one extra refresh, bounded                                     | not "exactly 1" as the plan states — ST-1b decision           |
| Rapid worktree add/remove                                 | PARTIAL | debounced re-listing, resubscribe only on a changed set                | listing resolution order not enforced — race (Failure mode 2) |
| 500-path batch, all newly created                         | YES     | bounded-concurrency (32) stat slices                                   | none                                                          |
| Batch containing directory deletes on a very large index  | YES     | full sweep removes all descendants correctly                           | unbounded, non-yielding synchronous cost (Moderate-1)         |
| Nested repo detected mid-session via a new `.git`         | YES     | coalescer's `onNestedRepoRoot` hook feeds the host's native ignore set | —                                                             |
| Query (`search`) racing the first build                   | NO      | none — FU-4c                                                           | partial results returned as if complete (Serious-2)           |
| Root spelled with a different drive-letter case on delete | NO      | none                                                                   | stale entries never pruned (low probability, Moderate-3)      |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `implementation-plan.md`'s AC-2 P2 row ("exactly 1 status refresh") no longer matches
  the shipped behaviour, and the mismatch was resolved by loosening the regression test rather than
  by fixing the code or recording an approved plan change — the next person to read the plan will
  be misled about what P2 guarantees under a storm.
- What a robust implementation would add: (1) the Option B coalescer leading-edge hold, re-measured
  against ST-1b, with the plan's AC-2 text updated to match whatever the measurement shows; (2) an
  `entry.ready` gate on `WorkspaceFileIndexService`'s three query methods, closing FU-4c as the plan
  says Batch 11 does; (3) a sequence token on `refreshNestedRepoRoots` so an out-of-order
  `getWorktrees()` resolution cannot silently apply a stale worktree list; (4) a live/dead flag (or
  bounded retry) on a folder whose watch subscription failed to arm, so a permanently static `@`
  index is discoverable instead of silent.

---

## Delta review (review fixes)

Scope: the fix pass over the base review above, verified on disk (no nx/stress runs; a single
`workspace-change-coalescer.spec.ts` read plus source reads for everything else). All eight
items the coordinator asked about are addressed below; every claim is checked against the actual
diff, not the executor's description of it.

### 1. ST-1b Option B — leading-edge hold (`workspace-change-coalescer.ts:356-385`)

Verified: `scheduleFlush` now computes `delay = sinceEmit >= minBatchIntervalMs ? minBatchIntervalMs
: minBatchIntervalMs - sinceEmit`, i.e. a batch that starts a burst after any quiet gap is always
held for the full interval, not just clamped to what remains of an active cadence as before. This
is a correct, general fix at the shared coalescer, not a `GitWatcherService`-only patch — every
consumer (`WorkspaceFileIndexService`, the VS Code adapter, any future one) inherits it through
`minBatchIntervalMs`.

- **(a) Latency, single isolated edit, computed end to end.**
  - Git decoration refresh (P1 baseline: raw `fs.watch` event → `scheduleUpdate`'s 2000 ms debounce
    only, so ~2000 ms worst case): now hold (1000 ms, `WORKSPACE_BATCH_INTERVAL_MS`,
    `git-watcher.service.ts:242`) + `WORKSPACE_DEBOUNCE_MS` (2000 ms) = **~3000 ms worst case**, a
    ~50% increase the file's own comment (`:239-240`) states explicitly ("at most one second of
    extra latency … inside the 2 s status debounce").
  - `file:content-changed` for an open diff tab (P1 baseline: raw event → `CONTENT_CHANGE_DEBOUNCE_MS`
    500 ms only, so ~500 ms worst case): now hold (1000 ms) + `armContentChange`'s 500 ms debounce =
    **~1500 ms worst case**, a 3x increase in absolute terms even though the code comment frames the
    trade-off only against the 2000 ms status channel. Still comfortably sub-2s and unlikely to be
    perceptible for "another process touched a file I have open", but the comment's framing
    understates the content-push case; worth a one-line addition there for the next reader who
    checks this trade-off against a content-latency complaint rather than a decoration one.
  - File index `@`-picker freshness: unaffected by this batch's new constant (kept at the coalescer
    default, 250 ms, per the coordinator's note) — the SAME leading-edge-hold code path now adds up
    to 250 ms to the first patch after a quiet gap, versus 0 ms before. Negligible next to the
    picker's existing async stat round-trip.
  - Net: real, bounded, and consistent with what the code comments now say — a legitimate,
    disclosed trade, not a hidden regression. Moderate-severity documentation gap only (the content-
    push arithmetic), not a functional defect.
- **(b) Robustness across platforms/slow hosts.** Confirmed directly from
  `node_modules/@parcel/watcher/src/Debounce.hh`: `MIN_WAIT_TIME 50` / `MAX_WAIT_TIME 500` are
  defined once and consumed by the single `Debounce` class (`Debounce.cc`), which every backend
  (`windows/WindowsBackend.cc`, `linux/InotifyBackend.cc`, `macos/FSEventsBackend.cc`,
  `kqueue/KqueueBackend.cc`, `watchman/WatchmanBackend.cc`) shares through `Debounce::getShared()` —
  this is not a Windows-specific constant, so the theoretical native worst case is 550 ms
  everywhere `@parcel/watcher` runs. A 1000 ms hold gives ~450 ms of margin over that, which should
  absorb ordinary scheduling jitter on a loaded CI runner or VM. It is still a timing heuristic
  against a shared native constant, not a structural guarantee (extreme host starvation that delays
  the coalescer's own `setTimeout` past the native window, or a native thread itself starved past
  550 ms, could still in principle split a burst) — the residual risk from the base review's Option
  B writeup is real but now precisely bounded rather than unquantified. Acceptable.
- **(c) Interaction checks, verified in code (not just the integration spec):**
  - `maxPathsPerBatch` truncation: unaffected — truncation happens inside `push()` independent of
    `scheduleFlush`'s timing (`workspace-change-coalescer.ts:211-260` region, unchanged by this
    diff); pinned by the pre-existing cap/truncation specs, now re-timed with `clock.advance(HOLD)`
    instead of `advance(0)` and still green.
  - Dispose during a hold: `dispose()` (unchanged) clears `flushTimer` unconditionally and clears
    `pending`; no code path reads `flushTimer` after `disposed` is set. No emit after dispose,
    including mid-hold.
  - Storm entry during the hold: `enterStorm()` (unchanged) clears `flushTimer` whenever one is
    armed (unless it is the forced-storm-refresh timer) and folds `pending` into the storm's
    dropped count, so a leading-edge batch held but not yet flushed is correctly absorbed rather
    than flushed first. This is now pinned directly at the unit level, not only inferred from the
    integration stress spec: `workspace-change-coalescer.spec.ts` adds `'a lone leading event
followed by a burst within the hold is folded into the storm overflow (ST-1b)'`, which pushes
    one delete, advances 480 ms (inside the 1000 ms hold), fires 8,810 more deletes, and asserts
    exactly one `overflow` batch with `droppedCount: 8_811`. This is exactly the ST-1b shape and it
    is now a fast, deterministic unit test rather than only a slow real-watcher integration spec.
  - Degraded 60 s overflow cadence: unaffected — `foldPendingIntoOverflow`/`scheduleFlush` are
    unchanged apart from the leading-edge delay computation itself, and a degraded adapter's
    periodic `signalOverflow` still folds through the same path.
- **(d) Contract suite expectations.** `'never calls the listener synchronously inside push'`
  (`workspace-change-coalescer.spec.ts:101`) and `'signalOverflow never emits synchronously'`
  (`:640`) are both untouched by this diff and still assert through the timer-based `flush()` path,
  which the leading-edge change does not bypass (it only changes the computed `delay`, never `0`
  synchronously). Cadence ("at most one batch per `minBatchIntervalMs`") is re-asserted with the
  new hold-aware timings and still holds.

**Verdict on item 1: correctly implemented, well-verified (unit + integration), and honestly
costed.** Only a documentation nit (the content-push latency ratio deserves its own line next to
the status-push one).

### 2. FU-4c — `queryable` gate (`workspace-file-index.service.ts:478-497`)

Verified: `queryable` returns `active` only when `active.ready` is `true`; `search`/`getAll`/
`searchDirectories` (`:1136,1157,1179`) all read `this.queryable` instead of `this.active`.
`entry.ready` is set exactly once, in `doStart` after the FIRST `build()` resolves
(`:499-521`), and is reset only in `teardownEntry` (folder closed/evicted) — **never** by
`requestRebuild`/`runOverflowRebuild` (`:953-1010`, read in full). During a later overflow rebuild
the entry stays `ready: true` throughout, so `queryable` keeps returning the entry and its (still
being served) live maps; the rebuild fills a separate `rebuildStaging` snapshot and swaps it in
atomically on success (`entry.files = staging.files`, etc.), exactly as the pre-existing atomic-
swap design required. **Regression check passes**: a query during a rebuild of an ALREADY-BUILT
folder is never starved to empty — it keeps serving the previous snapshot, as required. Only the
FIRST build of a folder can make `queryable` return `undefined`, which is precisely FU-4c's fix
target. `ContextService`'s three call sites (`context.service.ts:503,536,589,607`) are the only
production caller, matching the file's own claim; a caller that bypasses `ensureIndexFor`/
`assertIndexServes` would now get an empty result during the first build instead of a partial one —
correctly closes the base review's Serious-2 finding.

### 3. `DIRECTORY_DELETE_SWEEP_LIMIT = 5_000` (`:158,872-884`)

Verified: `onBatch` now checks `entry.files.size + entry.directories.size > DIRECTORY_DELETE_SWEEP_LIMIT`
before running the synchronous `deleteLiveDescendants` sweep; above the limit it calls
`requestRebuild` instead (folding the batch's creates into the rebuild too) and returns without
sweeping. This directly closes the base review's Moderate-1 finding (unbounded, non-yielding
main-thread sweep) by capping the SYNCHRONOUS path to ≤5,000 entries and routing anything larger
through the already-yielding, already-coalesced rebuild path (`build()`'s `for await` with
`yieldToEventLoop()` between batches). `requestRebuild` itself is coalesced exactly like the
overflow path: `if (entry.rebuildStaging) { entry.rebuildQueued = true; return; }`
(`:958-961`), so multiple directory-delete batches that land WHILE one rebuild is in flight cost
one rebuild, not one each — this bounds the cost within a single storm/overlap window, confirmed
by reading the same coalescing code the FU-8b test already pins.

**What is not bounded, and is worth flagging rather than blocking on:** the coalescing is per
IN-FLIGHT rebuild, not per unit of time. Two `rm -rf dist`-shaped deletes spaced further apart than
one rebuild's own duration (each already resolved before the next starts) each cost an independent
full path-only walk of the whole folder, once the entry has grown past 5,000 files — which is true
of this repository's own workspace by a wide margin. A `dist`-cleaning loop across many Nx projects
(this repo's own `npx nx run-many -t build`, named in `handoff.md` §9's manual load test) would now
pay one full re-walk per clean cycle for any folder over the limit, where before this fix it would
have paid one O(index) synchronous sweep per cycle (worse for the main loop, better for total
walk I/O) and before Batch 11 at all, an unbounded main-thread callback burst. Strictly safer for
the main loop than either prior state — the goal this whole task exists for — but the manual
load-test script in `handoff.md` §9 (which explicitly exercises `nx run-many -t build` alongside the
git panel) is the right place to confirm this new walk frequency does not itself become the next
"decorations feel laggy during a build" complaint. Moderate, not blocking: recommend noting it as a
follow-up to re-run that manual scenario, not a code change.

### 4. `toIndexKey` (`:287-306`)

Verified: normalizes separators/dedupes trailing separator/upper-cases a lower-case drive letter
via `path.normalize` + a trim loop + a regex-gated single-character uppercase. This directly closes
the base review's Moderate-3 finding (drive-letter case divergence between file keys and directory
keys) — both `files` and `directories` now go through the SAME exported function
(`:1054` `into.files.set(toIndexKey(absPath), …)`; `:1099` `const key = toIndexKey(absDir)`), so the
"two different normalization calls for one key space" gap from the base review is closed too.

**Returned-path spelling** (the coordinator's specific question): `toIndexKey` is used ONLY as the
Map key; every stored `IndexEntry.path`/`relativePath`/`fileName` is built from the ORIGINAL
`absPath`/`absDir` argument as reported by the walk or the watcher (`:1054-1063` region, `path:
absPath` unchanged; ancestor directories built from `path.join(entry.root, ...soFar)` using the
entry's own root spelling, not the uppercased key). `FileSearchResult.path` — what a consumer
(search UI, `@` picker, `vscode-lm-tools`) actually receives — is therefore the walk's/watcher's
original spelling, never the uppercased key. A VS Code `uri.fsPath`-shaped lower-case-drive
consumer that compares a RETURNED path string against its own lower-case expectation could still
see a case mismatch (e.g. `D:\proj\x` returned vs `d:\proj\x` expected) — same as before this
change, not introduced by it, and out of scope for a key-space fix. No regression; the key fix
does exactly what it claims (internal lookup consistency) without touching output spelling.

### 5. ESLint split (`eslint.config.mjs:57-139`)

Verified against the actual selectors:

- `RECURSIVE_FS_WATCH_SELECTORS` now has FOUR entries, not two: the original member/bare-call
  selectors, plus two new ones added specifically for the base review's Moderate-2 finding —
  `ImportDeclaration[source.value=/^(node:)?fs(\/promises)?$/] > ImportSpecifier[imported.name='watch'][local.name!='watch']`
  (catches `import { watch as w } from 'node:fs'`) and the equivalent `VariableDeclarator`/
  `ObjectPattern` selector for `const { watch: w } = require('fs')`. Both aliasing gaps named in the
  base review are now closed. The docblock (`:47-51`) now explicitly and honestly states the
  remaining limit — an options object built through a variable, or `const w = fs.watch` — rather
  than letting `batches.md`'s "INV-1 is enforced by lint" stand unqualified. This is exactly the
  base review's requested fix (close what's closable, disclose what is not).
- No new false-positive surface found: the selectors still key on `callee.property.name==='watch'`
  or `callee.name==='watch'` plus a literal `recursive` property in a literal object argument
  directly on the call; `vscode.workspace.createFileSystemWatcher` and similar non-`watch`-named
  APIs do not match. `chokidar` mentioned only in a comment or string literal does not match
  `ImportDeclaration`/`ImportExpression`/`require()` selectors (spot-checked three of the fifteen
  files matching a bare grep for the word "chokidar" in the base review; all three were comments).
- The narrowed exemption blocks (`CHOKIDAR_ALLOWED`, `FS_WATCH_AND_CHOKIDAR_ALLOWED`,
  `RECURSIVE_FS_WATCH_ALLOWED_APP_TS`, `RECURSIVE_FS_WATCH_ALLOWED_JS`) each lift only the specific
  selector half a file needs (`eslint.config.mjs:514-546`) — `watch-renderer.js` now keeps
  `CHOKIDAR_LOAD_SELECTORS` active instead of the previous blanket `'no-restricted-syntax': 'off'`.
  This directly closes the base review's Minor finding about that file's over-broad exemption.

**Verdict on item 5: both prior findings (aliasing gap, over-broad exemption) are closed, cleanly
and without introducing new false positives found in this review.**

### 6. `retrySubscribeIfDue` (`:804-822`)

Verified: gated on `entry.ready && !entry.subscription && entry.subscribeRetryAt !== undefined &&
Date.now() >= entry.subscribeRetryAt`; called from `ensureReadyFor` only on the "already building or
built" branch (`:437-439`, `if (entry.buildPromise) { this.retrySubscribeIfDue(entry); return
entry.buildPromise; }`), so a query-driven caller (not a timer) is what re-arms a dead subscription,
matching the docblock's "no timer: a folder nobody queries stays static until it is queried."
`subscribe()`'s catch branch sets `subscribeRetryAt = Date.now() + SUBSCRIBE_RETRY_INTERVAL_MS`
(`60_000`, `:165,789`) and logs at `warn` only on the FIRST failure of a streak, `debug` on repeats
(`:790-800`) — matches "warn once per streak." On a successful retry, `requestRebuild` runs once
(`:816-821`) so the snapshot a dead watcher left stale is refreshed — matches "rebuild once on
success." This closes the base review's Failure-mode-1 finding (permanently silent, un-retriable
static index) correctly: the index now self-heals the next time anyone asks for it, bounded to once
a minute, with a real snapshot refresh rather than just resubscribing over stale data.

One residual gap, Minor: a folder that is `ready` but never queried again (a closed tab, a
background folder nobody switches back to) never retries — by design, per the docblock — but also
never evicted for staying subscribed-dead, so a permanently-failing watch host on one folder is
invisible until that folder is queried or closed. Acceptable given the cap (`MAX_CACHED_FOLDERS`)
and closed-folder eviction already bound the cost; not a new problem introduced here.

### 7. `worktreeListingSeq` (`git-watcher.service.ts:172-177,663,684`)

Verified: `refreshNestedRepoRoots` stamps `const seq = ++this.worktreeListingSeq` before awaiting
`getWorktrees`, and after the await checks `if (seq !== this.worktreeListingSeq) return;`
(`:684`) in addition to the pre-existing `armGeneration`/`isDisposed` check. This directly closes
the base review's "Nested-root listing race on rapid `.git/worktrees` churn" failure mode: two
overlapping listings started at different times can now only have the LATEST one apply its result,
regardless of resolution order, because a listing whose `seq` was superseded by a later `++` bails
out before touching `subscribedNestedRoots`/`subscribeWorkspace`. Correct and minimal — the same
pattern `entry.generation` already used for the file index, applied here as the base review
recommended.

### 8. `createMockWorkspaceWatcher` (`libs/backend/platform-core/src/testing/mocks/workspace-watcher.mock.ts`)

Read in full: a recording `jest.Mocked<IWorkspaceWatcher>` whose `watch()` returns a
`MockWorkspaceSubscription` capturing `root`/`options`/`listener`, counting `disposeCount`, and
exposing `deliver(batch)`/`fire(kind, ...paths)` helpers. Explicitly documented as NOT
re-implementing coalescing/timers/exclusion ("that's the coalescer's job, pinned by its own spec");
its purpose is a shared double for CONSUMER specs. Exported from
`libs/backend/platform-core/src/testing/mocks/index.ts` (the `+7` line in that file's diff) —
correctly makes it importable as a shared test util rather than each consumer spec hand-rolling its
own fake, which is exactly the kind of duplication this repository's own conventions ask to avoid.
No logic concerns; this is test infrastructure, not behaviour.

### Delta summary

All eight items were verified on disk against the described fix, not merely against the executor's
narrative. Every finding raised in the base review that this fix pass targeted is closed:
AC-2/ST-1b (Option B, correctly implemented and now unit-pinned), FU-4c (closed via `queryable`,
regression-checked against the rebuild-atomic-swap path), the directory-delete sweep bound (capped
and coalesced, with one disclosed residual cost), the `toIndexKey` normalization split, both ESLint
gaps (aliasing, over-broad exemption), the silent-dead-watcher failure mode (`retrySubscribeIfDue`),
and the nested-root listing race (`worktreeListingSeq`). No new blocking or serious defect was found
in the fix code itself. Two items remain worth a follow-up note rather than another revision cycle:
the content-push latency arithmetic deserves its own line in the `WORKSPACE_BATCH_INTERVAL_MS`
comment, and the `DIRECTORY_DELETE_SWEEP_LIMIT` rebuild-frequency cost against this repository's own
build habits is worth confirming against the manual load test in `handoff.md` §9 rather than only
in unit specs. The file split (`workspace-file-index.service.ts` now 1,296 lines) is correctly
deferred to Batch 17 per the facade rule in `CLAUDE.md` and is not re-litigated here.

- **Delta verdict: APPROVE**
- **Confidence: HIGH**
