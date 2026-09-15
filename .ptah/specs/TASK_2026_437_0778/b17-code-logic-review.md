# Code Logic Review — `TASK_2026_437_0778` Batch 17

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 3              |
| Failure modes found | 4              |

Scope reviewed: `libs/backend/workspace-intelligence/src/file-indexing/{folder-index-snapshot.ts, folder-index-live-sync.ts(+spec), workspace-file-index.service.ts(+spec)}`, `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts(+spec)`, `libs/backend/vscode-lm-tools/.../code-namespace.builder.ts`, `apps/ptah-electron/src/activation/{coalesced-job.ts(+spec), plugin-activation.ts(+spec)}`, `libs/backend/persistence-sqlite/src/lib/backup.service.ts(+spec)`, `libs/backend/platform-core/src/utils/editor-launcher-detection.ts(+spec)`, the four touched `CLAUDE.md` files, plus the callers reached from each adopter (`boot-thoth-runtime.ts`, `skill-repropagation.ts`, `skill-enhancer.service.ts`, `skill-promotion.service.ts`). Batch 18 files (`memory-curator/**`, `memory-contracts/**`, `skill-synthesis` network-backoff files) were intentionally not reviewed.

## Five logic questions

### 1. How does this fail silently?

- **File index serves a stale snapshot for up to 10 minutes with no signal to the caller.** When an overflow/truncated batch triggers `requestRebuild` and the governor is not clear, `startRebuildWhenClear` (`libs/backend/workspace-intelligence/src/file-indexing/folder-index-live-sync.ts:385-429`) parks the rebuild behind `governor.whenClear()` (default ceiling 10 min, `DEFAULT_MAX_DEFER_MS`). Meanwhile `search`/`getAll`/`searchDirectories` (`workspace-file-index.service.ts:576-635`) keep answering from the pre-overflow snapshot via `queryable`. The new spec at `workspace-file-index.service.spec.ts:1328-1364` proves this directly: a file created after the overflow is invisible to `search()` until the deferred rebuild finally runs. Nothing in the `FileSearchResult` shape or the RPC surface tells the `@`-picker "this list may be incomplete."
- **A non-`AbortError` rejection from `governor.whenClear()` is swallowed at `debug` in the file-index rebuild path and the rebuild is simply abandoned**, whereas the analogous backup path treats the same class of failure as fail-open-with-a-warning. See Serious #2 below for detail (`folder-index-live-sync.ts:416-428` vs `backup.service.ts:303-324`).
- **`admit` returning `'skip'`** (`coalesced-job.ts:233-236`) settles every requester's promise with no error and no signal that the pass never ran. This is deliberate (shutdown), but every caller of `refreshUserLayer`/`propagateHarness` gets an indistinguishable resolved promise whether the pass ran or was skipped.

### 2. What user action produces unexpected behaviour?

- **Clicking "start indexing" can silently wait behind the governor.** `indexing:start` → `IndexingControlService` → `runDeps.runSymbols` → `symbolIndexer.indexWorkspace(wsRoot, { signal })` in `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:479-499` never sets `userInitiated: true`. Batch 16b's stated rule is "user-initiated work is never governed," and Task 17.1's own option exists precisely so a user-facing action can opt out (`code-symbol-indexer.service.ts:43-52`), but this call site does not use it. A user who explicitly starts indexing while a turn is generating or the main loop lags gets a run that can pause for up to 10 minutes with no explanation (`onProgress` never fires while parked in `yieldToForeground`, so the UI progress bar just sits at 0). This is the same gap the executor flagged as an open question (below); I confirm it is live in the code, not merely theoretical.
- **A workspace switch during a busy period leaves the `@`-mention picker showing a stale file list** for as long as 10 minutes (see #1), which will read to a user as "my new file doesn't show up in `@`."

### 3. What input data produces a wrong answer rather than an error?

- **A transient, non-`ENOENT`/`ENOTDIR` `stat` failure on ANY one editor definition evicts the cached result for EVERY editor**, not just the flaky one. `runDetection` (`editor-launcher-detection.ts:312-367`) folds `onPath.conclusive && installed.conclusive` into one boolean for the whole call, and `EditorTargetCache.resolve` (`:399-420`) keys on that single flag. A single `EBUSY` on, say, a `cursor` PATH entry (a network-mapped `PATH` directory hiccuping) drops the whole cache entry, so `vscode`, `antigravity`, `zed` and `kiro` — all cleanly resolved in the same pass — are re-probed on the very next call too. This never produces a WRONG editor target (the "keep it uncached rather than trust it" rule is safe), but it is coarser than the stated per-result caching contract implies and costs a full PATH walk more often than the design suggests.
- Not a correctness defect, but worth naming: `toIndexKey` (`folder-index-snapshot.ts:122-132`) is unchanged from the pre-split code, and Batch 17 does not touch it — confirmed no drift there (see "Data flow" below).

### 4. What happens when a dependency fails?

- **Governor absent (bare container/tests): every adopter fails open correctly.** `code-symbol-indexer.service.ts:320-321`, `folder-index-live-sync.ts:396-397`, `backup.service.ts:304-305`, `plugin-activation.ts:194-195` all check `governor === null` first and run at once. Verified by spec in each file.
- **Governor `whenClear()` rejects with `AbortError` (disposed at shutdown): handled consistently** — indexer maps it to the caller's own `DOMException('Aborted','AbortError')`, live-sync cancels the deferred rebuild (keeps previous snapshot), backup returns `null` with an `info` log, and the user-layer gate resolves `'skip'`.
- **Governor `whenClear()` rejects with anything else (a bug in the governor, not a designed shutdown): inconsistent handling across the four adopters.**
  - `backup.service.ts:309-324` distinguishes: non-`AbortError` → `logger.warn(...)`, **fails open (returns `true`, the backup still runs)**.
  - `folder-index-live-sync.ts:416-428` does **not** distinguish: any rejection (Abort or not) is treated the same — `logger.debug(...)`, the rebuild is abandoned, the previous (possibly overflow-stale) snapshot is kept. A defect in the governor itself would silently and permanently suppress that one rebuild attempt at a severity nobody monitors, while the equivalent backup path would at least warn and still complete the safety-critical operation.
  - `code-symbol-indexer.service.ts:327-336` re-throws anything that is not `AbortError`, so a broken governor surfaces as an indexing failure (caught non-fatally by both callers) rather than a silent no-op — a third, different behaviour again.
    This is not a hypothetical: `BackgroundWorkGovernor.whenClear` is documented (vscode-core CLAUDE.md) to only ever reject with `AbortError`, so today this is latent. But three different failure disciplines for "the same dependency behaved unexpectedly" is real drift, and the file-index one is the quietest of the three for a rebuild whose absence has real user impact (#1).

### 5. What is missing that the requirements never mentioned?

- No progress signal distinguishing "waiting for the governor to clear" from "genuinely running" for the symbol indexer (`onProgress` is silent during the wait).
- No path for an `ensureReadyFor`-driven active query to expedite a deferred overflow rebuild for the folder it is actively serving (see Serious #1 recommendation).
- `IUserLayerRefresher`/`HarnessPropagationService.propagate` carries no origin/reason distinguishing an RPC-click-driven propagation from a background-pipeline-driven one, which is what lets Serious #2 (below) happen. The executor already recorded this as an open question; I confirm it is the root cause of a real governance gap, not merely a naming nicety.

## Failure modes

### Deferred file-index rebuild leaves the `@`-picker stale for up to 10 minutes

- Trigger: an overflow/truncated batch arrives while `BackgroundWorkGovernor` is not clear (main-loop lag or a generating turn).
- Symptom: `@`-mention autocomplete omits newly created files or still offers deleted ones, indistinguishably from a correct result, for up to `DEFAULT_MAX_DEFER_MS` (10 min).
- Evidence: `folder-index-live-sync.ts:360-429`; proven directly by `workspace-file-index.service.spec.ts:1328-1364`.
- Current handling: queries serve the previous snapshot; live batches keep patching it; nothing expedites the rebuild even if the folder is the one actively being queried.
- Recommendation: when `ensureReadyFor`/a query lands on a folder with `entry.rebuildDeferral` set, treat that as a signal to abort the deferred wait and run the rebuild immediately (the same "user is looking at this now" logic Batch 16b already applies to RPC clicks). At minimum, shorten the ceiling for the ACTIVE folder specifically, or surface a `stale: true` flag on `FileSearchResult`/`getStatus` so the UI can say "still indexing."

### Background skill re-propagation bypasses the governor through the "click" allow-list

- Trigger: `SkillEnhancerService`/`SkillPromotionService` auto-enhance or auto-promote a candidate from a **background** lane (not a user RPC), then call `ElectronSkillRepropagation.repropagate` (`apps/ptah-electron/src/activation/skill-repropagation.ts:47-58`), which calls `HarnessPropagationService.propagate(workspaceRoot, 'skill-repropagation:${kind}')` → internally `IUserLayerRefresher.refresh` → `refreshUserLayer(container, root, 'harness-propagation')`.
- Symptom: `'harness-propagation'` is NOT in `GOVERNED_USER_LAYER_REASONS` (`plugin-activation.ts:144-146`) by explicit design, on the stated premise that "most of those are awaited by an RPC handler answering a click." But `skill-enhancer.service.ts:523,654,684` and `skill-promotion.service.ts:344` call `repropagate` from inside the background enhancement/promotion pipeline itself, not from an RPC handler waiting on a reply. Each call is a directory walk + hash compare + file copy pass that now runs un-governed regardless of main-loop lag, directly contradicting INV-7 ("background LLM lanes... do not start a unit while... lag is above threshold") for this one surface.
- Evidence: `plugin-activation.ts:124-146` (docstring's own stated assumption that harness-propagation callers are click-driven); `skill-repropagation.ts:47`; call sites in `skill-enhancer.service.ts` and `skill-promotion.service.ts`.
- Current handling: none — the reason string is the only classifier, and it is the same for both the RPC-driven and the pipeline-driven callers, so there is no way to govern one without also holding up the other.
- Recommendation: thread an origin (`userInitiated: boolean` or similar) from the RPC-answering call sites through to `refreshUserLayer`, the same pattern Batch 16b already established for `InternalQueryConcurrencyGate`/lane classification, and add the background-triggered `harness-propagation` calls to a governed set while leaving the click-driven ones ungoverned. This is the fix implied by the executor's own open question ("`IUserLayerRefresher` lacks a reason/origin") — I am elevating it from "open question" to "material finding" because it is a concrete, demonstrable INV-7 gap on a currently-live code path, not a hypothetical future one.

### Manual "start indexing" waits behind the governor like background work

- Trigger: a user (or the `indexing:start`/`indexing:resume` RPC) starts symbol indexing while another turn is generating or the main loop is lagging.
- Symptom: the indexing run can pause at any batch boundary — including the first — for up to 10 minutes, with `onProgress` frozen and no user-visible reason.
- Evidence: `boot-thoth-runtime.ts:479-499` (`runSymbols` never passes `userInitiated: true`); contrast with `code-namespace.builder.ts:184-189`, which correctly does for the agent-tool `ptah.code.reindex` path.
- Current handling: none; recorded by the executor as an open question, not yet resolved in code.
- Recommendation: either pass `userInitiated: true` from the RPC-driven manual start (the only caller a human can trigger directly), or explicitly decide "manual start is deliberately governed" and say so in the CLAUDE.md line that currently states the opposite generalization ("user- or agent-initiated work never waits").

### Inconsistent treatment of an unexpected (non-`AbortError`) governor rejection

- Trigger: `governor.whenClear()` rejects with something other than `AbortError` (currently only reachable through a defect in `BackgroundWorkGovernor` itself, per its documented contract).
- Symptom: the file-index rebuild silently no-ops at `debug` (previous, possibly stale, snapshot kept indefinitely until the next overflow); the daily backup fails open with a `warn` and still runs; the symbol indexer surfaces the error up the stack.
- Evidence: `folder-index-live-sync.ts:416-428` vs `backup.service.ts:303-324` vs `code-symbol-indexer.service.ts:327-336`.
- Current handling: three different disciplines for the same dependency-failure class.
- Recommendation: standardize on "any rejection other than a name:`AbortError` is a bug — log at `warn`/`error` (not `debug`) and fail open (run the unit) exactly as `backup.service.ts` already does," since a rebuild silently abandoned at `debug` is the worst of the three outcomes for a cache whose staleness is otherwise invisible.

## Blocking issues

None found. Nothing in this batch causes data loss, corruption, or a crash; every adopter fails open when the governor is absent, and cancellation is mapped to one consistent `AbortError`/`DOMException` shape everywhere a caller was checked.

## Serious issues

### Background skill re-propagation is exempt from the governor by construction

- File: `apps/ptah-electron/src/activation/plugin-activation.ts:124-146`, `apps/ptah-electron/src/activation/skill-repropagation.ts:47-58`
- Scenario: skill-synthesis auto-promotes or auto-enhances several candidates in one background pass while the user is mid-turn or the loop is lagging.
- Impact: each promotion/enhancement fires an un-governed directory walk + reconcile + copy on the shared user layer, exactly the class of work INV-7 exists to hold back. Contradicts the batch's own stated rationale for exempting `harness-propagation` (that it is "mostly RPC-click-driven").
- Fix: see "Failure modes" above — add an origin/reason channel from `IUserLayerRefresher.refresh` down to `admitUserLayerPass` so background-triggered propagations are governed while click-driven ones are not.

### File-index rebuild swallows an unexpected governor rejection more quietly than every sibling adopter

- File: `libs/backend/workspace-intelligence/src/file-indexing/folder-index-live-sync.ts:416-428`
- Scenario: `governor.whenClear()` rejects with a non-`AbortError` (a governor bug).
- Impact: the folder's stale-after-overflow index is never rebuilt for this incident, logged at `debug`, and nobody is told the safety net (the rebuild) did not fire — worse than the equivalent backup path, which fails open and warns.
- Fix: mirror `backup.service.ts`'s discipline: distinguish `AbortError` (skip, low severity) from anything else (warn, fail open and rebuild anyway).

## Moderate and minor issues

- Manual "start indexing" (`indexing:start`) does not pass `userInitiated: true` and can be deferred like background work, contrary to the stated "user-initiated work is never governed" principle — `boot-thoth-runtime.ts:479-499` (Moderate; recorded as an open question by the executor, confirmed live here).
- No mechanism lets an actively-queried folder's deferred overflow rebuild jump the governor queue — `folder-index-live-sync.ts:385-429`, `workspace-file-index.service.ts:255-290` (Moderate; explicit ask in the batch scope, recommendation above).
- `EditorTargetCache` evicts the WHOLE detection outcome (every editor) on one inconclusive probe for any single editor, rather than per-editor — `editor-launcher-detection.ts:293-303,399-420` (Minor: safe-side, but coarser than the per-key doc implies; costs extra PATH walks on a flaky probe).
- `FolderIndexLiveSync.requestRebuild` logs only the FIRST trigger's reason/`droppedCount` for a folder; every later overflow that arrives while a rebuild is deferred or running is coalesced silently with no log line of its own — `folder-index-live-sync.ts:365-383` (Minor: observability only, correctness unaffected — coalescing itself is correct and tested).

## Data flow

1. Watch host delivers a batch → `FolderIndexLiveSync.onBatch` (`folder-index-live-sync.ts:249-297`) — OK: generation-gated, overflow/truncated routed to `requestRebuild`.
2. Non-overflow batch: deletes swept, creates filtered by `isExcluded`, then `addCreatedPaths` stats survivors with bounded concurrency (`STAT_CONCURRENCY`=32) and re-checks generation before writing — OK, matches the pre-existing (pure-move) contract; unchanged by this batch (confirmed by the 43-line spec diff, not a rewrite).
3. Overflow batch → `requestRebuild` → `startRebuildWhenClear` — NEW in this batch: governor gate inserted here. `governor===null || isClear()` → immediate `runOverflowRebuild`; else parks behind `whenClear` — OK for the happy/timeout/abort paths (see Failure modes for the non-Abort-rejection gap).
4. `runOverflowRebuild` walks into a `staging` snapshot while `entry`/queries keep serving the previous one, then swaps all five snapshot fields in one synchronous block gated on generation — OK, no torn reads possible (single synchronous swap).
5. `WorkspaceFileIndexService.ensureReadyFor`/`search`/`getAll`/`searchDirectories` read only `entry` (never `rebuildStaging`) via `queryable` — OK, but see Failure mode #1: this is precisely the window that stays stale during a deferred rebuild.
6. `CodeSymbolIndexer.indexWorkspace` batch loop calls `yieldToForeground` before every batch (including the first) when `governed` — OK, matches design; abort mapping to one `DOMException` shape verified against both real callers (`boot-thoth-runtime.ts`, `code-namespace.builder.ts`), both of which treat it as a clean stop.
7. `CoalescedJob.request` → `admitBatch` (`coalesced-job.ts:189-252`) — OK: batch stays in `pending` while admission is awaited, so late joiners attach to the same batch and re-abort the wait; verified race-free because JS's single-threaded execution makes the "verdict decided, still-aborted-check" window atomic (no `await` between them).
8. `admitUserLayerPass` → gates only reason sets that are a SUBSET of `GOVERNED_USER_LAYER_REASONS` — OK internally, but see Serious #1: the set itself is under-inclusive for background-originated `harness-propagation` calls.
9. `SqliteBackupService.backup('daily')` waits on the governor BEFORE joining the serialization queue, so a held daily backup never blocks `pre-migration`/`reset` — OK, and the 10-min ceiling resolving `'timeout'` still runs the backup (confirmed: only `AbortError` returns `false`), so daily backups cannot be starved indefinitely by continuous foreground load.
10. `editor-launcher-detection.ts` — bounded-concurrency PATH/install probes preserve "first match in PATH order" in the final result even though probes can complete out of order; `EditorTargetCache` shares in-flight detections and evicts non-conclusive ones — OK, with the granularity caveat noted above.

## Requirements fulfilment

| Requirement                                                                        | Status   | Gap                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17.1 Symbol indexer yields before each batch incl. first; `userInitiated` opt-out  | COMPLETE | Opt-out exists but the one manual-start caller doesn't use it (Moderate above)                                                                                                                                          |
| 17.2 User-layer refresh defers non-activation reasons; `activation` never deferred | PARTIAL  | Correct for the reasons it lists, but the allow-list is too narrow for background `harness-propagation` callers (Serious above)                                                                                         |
| 17.3 Backup start + file-index overflow rebuild governed                           | PARTIAL  | Backup: COMPLETE and well-hardened. File index: governed correctly, but the deferral has no expedite path and swallows unexpected rejections too quietly                                                                |
| 17.4 `editor:detectTargets` bounded concurrency + cache                            | COMPLETE | PATH order preserved, cache correctly scoped and race-free; only the eviction-granularity note above                                                                                                                    |
| FU-11b split of `workspace-file-index.service.ts` under the facade rule            | COMPLETE | Confirmed via the file sizes (709/249/535 lines) and the 43-line spec diff — behaviour preserved, no hidden change in ordering, `queryable` gate, retry-subscribe, sweep threshold, rebuild coalescing, or `toIndexKey` |

Implicit requirements not addressed: a visible "index may be stale" signal to the `@`-picker UI during a deferred rebuild; an origin/reason channel on `IUserLayerRefresher` (explicitly named by the executor as an open question, and shown here to have a live consequence).

## Edge cases

| Case                                                        | Handled | How                                                                                          | Concern                                                                                                                           |
| ----------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Live batches patch the snapshot while a rebuild is deferred | YES     | `onBatch` continues writing directly to `entry` during deferral                              | Patches only cover events seen AFTER the overflow; events lost IN the storm are not recovered until the rebuild finally runs (#1) |
| Teardown/dispose while a rebuild is deferred                | YES     | `release()` aborts the `AbortController`; reject handler checks identity before clearing     | None — spec-covered                                                                                                               |
| A queued rebuild behind a running one                       | YES     | `rebuildQueued` flag re-enters `startRebuildWhenClear` in `.finally()`                       | None — spec-covered, also re-waits on the governor                                                                                |
| Governor disposed mid-wait (host shutdown)                  | YES     | `AbortError` → debug log, snapshot kept (file index); `'skip'` (user-layer); `null` (backup) | Consistent across all three                                                                                                       |
| Symbol indexer aborted mid-run by the caller's own `signal` | YES     | Batch-boundary check throws the same `DOMException` shape                                    | None                                                                                                                              |
| Manual "start indexing" during a busy period                | NO      | Runs as governed background work                                                             | Contradicts "user-initiated never governed" (Moderate)                                                                            |
| Active `@`-picker query during a deferred overflow rebuild  | NO      | No expedite path                                                                             | Up to 10 min of stale results (Serious/Moderate, see recommendation)                                                              |
| Background-driven `harness-propagation`                     | NO      | Same un-governed reason as click-driven propagation                                          | Serious #1                                                                                                                        |
| One flaky editor probe among several conclusive ones        | Partial | Whole cache entry evicted, not just the flaky editor                                         | Minor — safe-side only                                                                                                            |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `harness-propagation` is exempt from the background-work governor on the stated assumption that it is always a click-driven, RPC-awaited pass — but background skill-synthesis auto-enhancement/auto-promotion reaches the exact same code path, so a live INV-7 gap exists on a currently-reachable trigger, not a hypothetical one.
- What a robust implementation would add: (1) an origin/reason channel on `IUserLayerRefresher`/`propagate` so background-triggered harness propagation can be governed independently of click-driven propagation; (2) a way for an actively-queried folder to expedite its own deferred overflow rebuild rather than waiting out the full governor ceiling; (3) one consistent failure discipline (warn + fail-open) for an unexpected, non-`AbortError` governor rejection across all four adopters, matching what `SqliteBackupService` already does; (4) `userInitiated: true` on the manual `indexing:start` path, or an explicit, documented decision that manual reindex is deliberately governed.

---

## Delta review (review fixes)

Scope: the four fixes reported for the original findings, re-verified against the current (still uncommitted) tree in `D:\projects\ptah-437`. Read-only; no build/test run beyond what evidence below cites. Batch 18 files (`libs/backend/agent-sdk/**` network-backoff, `memory-curator/**`, `memory-contracts/**`, `skill-synthesis/**`) were out of scope and not re-verified except where a Batch 17 file references their public surface (the `SkillRepropagationPort` interface itself, which lives in `skill-synthesis` — checked only at the boundary, not internally).

### Serious 1 (background skill re-propagation) — confirmed NOT fixed, deferred by design

`libs/backend/skill-synthesis/src/lib/skill-repropagation.port.ts` still declares `repropagate(kind, slug, workspaceRoot): Promise<void>` with no origin/reason parameter — verified unchanged. `apps/ptah-electron/src/activation/skill-repropagation.ts:47-58` still forwards every call through `HarnessPropagationService.propagate(workspaceRoot, `skill-repropagation:${kind}`)`, which still resolves to the fixed literal reason `'harness-propagation'` inside `IUserLayerRefresher.refresh` (`plugin-activation.ts:540-544`), still absent from `GOVERNED_USER_LAYER_REASONS` (`plugin-activation.ts:144-146`). `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:558,689,719` (in-scope boundary only — the port call, not the internal lane logic) confirms both a promotion path (`:558`) and a click-adjacent enhancement path (`:689,719`) reach the same `repropagate` call with nothing distinguishing origin. This is consistent with the executor's call-site analysis as far as it can be checked from this side of the port; the two cited background triggers (`skill-curator.service.ts:681`, `skill-invocation-tracker.ts:80`) are inside excluded Batch 18 scope and were not independently re-verified, but nothing in the in-scope files contradicts the claim, and the port's signature is the load-bearing fact for "is this fixed" — it is unchanged. Treating this as an accepted, explicitly tracked deferral (Batch 17b, after Batch 18 commits) rather than a silent gap is reasonable; the plan described (optional `{ userInitiated? }` on the port, Electron mapping it to ungoverned `harness-propagation` vs. governed `skill-repropagation`, `IUserLayerRefresher.refresh` growing an optional reason) matches the shape of every other fix in this batch and closes the finding cleanly if implemented as described.

### Serious 2 (non-AbortError governor rejections) — fixed, and now consistent

Verified in all three previously-inconsistent adopters, alongside the one (`backup.service.ts`) that already had this discipline:

- `folder-index-live-sync.ts:393-436`: `startRebuildWhenClear`'s reject handler now branches on `error.name === 'AbortError'` (debug, cancel) vs. anything else (`governorFailureWarned` latch at `:108`, warn once, `runOverflowRebuild` anyway — fail open). Directly pinned by `folder-index-live-sync.spec.ts` "a governor rejection that is NOT an abort warns once and rebuilds anyway (fail open)" (two separate defects in sequence produce exactly one warning and two rebuilds — latch and fail-open both proven).
- `code-symbol-indexer.service.ts:311-335`: same shape, latch at `:159`. This is a genuine behaviour change from the version I reviewed first (which re-threw any non-`AbortError`, aborting the whole `indexWorkspace` run) — confirmed by re-reading the file; the spec suite was updated accordingly (no spec now expects a rethrow for a generic governor rejection).
- `plugin-activation.ts:184-219` (`admitUserLayerPass`): `if (request.signal.aborted) return 'run';` first (the coalescer's own re-ask signal, unrelated to governor health), then `AbortError` → `'skip'`, then anything else → `console.warn` + `'run'`.

On (a) — can fail-open cause a tight loop or a double run: no. Each adopter's fail-open path calls its rebuild/run function exactly once per failed wait and does not re-enter the wait; nothing self-schedules a retry, so repeated failures only rebuild once per triggering event (proven by the "second defect" half of the live-sync spec: two independent overflows before/after a defect produce two rebuilds, not a loop). In practice nothing in the shipped `BackgroundWorkGovernor.whenClear` (`background-work-governor.ts:281-330,382-396`) rejects with anything but `abortError(...)` (name `'AbortError'`) — confirmed by reading every `reject(...)` call site in that file. So this branch is a hardening measure against a non-conforming implementation (a test double, or a future adopter/subclass), not a path reachable with the shipped governor today.

On (b) — does any caller now proceed with indexing where it previously stopped: yes, but only under the same non-conforming-governor precondition as above, which is not reachable via the real class. `dispose()` (`background-work-governor.ts:382-396`) rejects every pending waiter with `abortError(DISPOSED_MESSAGE)` unconditionally, so shutdown is always the `AbortError` branch in all four adopters — confirmed the fix does not weaken the shutdown/dispose behaviour anywhere; it only changes what happens for a rejection shape the real governor cannot produce.

### Moderate 3 (thoth `userInitiated` only on click paths) — fixed and correctly scoped

`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:479-491` sets `userInitiated: true` on the `runSymbols` closure, with a comment stating the `runDeps` object is handed only to `IndexingRpcHandlers`. Verified: `runDeps` (and therefore `runSymbols`) has exactly one consumer, `indexingRpcHandlers.setRunDeps(runDeps)`, and `IndexingRpcHandlers` exposes it only through `indexing:start`/`indexing:resume` (`libs/backend/rpc-handlers/src/lib/handlers/indexing-rpc.handlers.ts`), which the frontend calls only from `WorkspaceIndexingComponent.onStart()`/`.onResume()` (`libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.ts:95-110`) — genuine click handlers, not a background trigger. Confirmed the VS Code host's OWN boot-time indexing call, `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:207` (`symbolIndexer.indexWorkspace(workspaceRoot)`, no options), passes no `userInitiated` and stays governed, so this fix did not accidentally widen the opt-out to boot-time indexing on that host.

### Moderate 4 (`expediteDeferredRebuild`) — mechanically race-safe, but reaches further than the picker

**Race safety, verified by both code and spec:**

- Resolve/reject-after-expedite: `expediteDeferredRebuild` (`folder-index-live-sync.ts:444-455`) clears `entry.rebuildDeferral` and calls `.abort()` _before_ starting the new rebuild, so the original `whenClear().then(...)`'s identity check (`if (entry.rebuildDeferral !== deferral) return;`, both the resolve arm at `:409` and the reject arm at `:415`) finds a mismatch and no-ops — proven directly by `folder-index-live-sync.spec.ts` "expediteDeferredRebuild starts a held rebuild at once and releases the governor wait" (asserts exactly one `build` call after `await flush()` following the expedite).
- Expedite + teardown: not raced at the instruction level — neither `release()` nor `expediteDeferredRebuild()` contains an `await`, so one fully completes before the other can run (JS's single-threaded execution); whichever runs first leaves `rebuildDeferral` cleared for the second, which then reads it as absent and no-ops (for `expediteDeferredRebuild`) or is itself a no-op for an entry with no deferral (for `release`). No spec exercises this exact interleaving, but the code-level argument is sound given both functions are synchronous top to bottom.
- Repeated `ensureReadyFor` calls: idempotent by construction — `expediteDeferredRebuild` is a no-op once `entry.rebuildDeferral` is `undefined`, which it is immediately after the first call clears it; proven by the "no-op for a folder with no held rebuild" spec (though that spec exercises the "never had a deferral" case, not "already expedited," the same guard covers both).
- Expedite while a rebuild is RUNNING with one QUEUED behind it: `entry.rebuildDeferral` is only ever set while WAITING on the governor, never while `rebuildStaging` is populated (running) or while merely `rebuildQueued` (queued-behind-running, no wait yet) — so `expediteDeferredRebuild` correctly no-ops in that state and does not disturb the in-flight rebuild or double-schedule the queued one. Not directly spec'd as a named scenario, but follows from the same guard verified above.

**New finding — `expediteDeferredRebuild` is wired to every `ensureReadyFor` caller, not only the `@`-picker:**

`workspace-file-index.service.ts:289-292` calls `this.liveSync.expediteDeferredRebuild(entry)` unconditionally whenever `ensureReadyFor` is called on an already-built entry, regardless of who called `ensureReadyFor`. Tracing the real call graph:

- `apps/ptah-electron`'s `workspace:switch` RPC handler (`workspace-rpc.handlers.ts:456-477`) — a literal user action. Correct target for expedite.
- `ContextService.ensureIndexFor` (`context.service.ts:445-450`), reached by `searchFiles`/`getAllFiles`/`getFileSuggestions` — but one of ITS callers is `libs/backend/vscode-lm-tools/.../namespace-builders/core-namespace.builders.ts:161`, which is an `execute_code` **agent tool** (`ptah.context.*`-style), i.e. code the LLM invokes autonomously **during a generating turn**. `WorkspaceAnalyzerService.getAllFiles` is reached the same way through `analysis-namespace.builders.ts` and `workspace-analyzer.service.ts:287`.

Because the governor's own foreground signal is "a session is `generating`" (vscode-core CLAUDE.md, `TurnStateForegroundSource`), an agent tool call made _during that very turn_ is exactly the condition most likely to have a rebuild deferred — and this wiring now forces that rebuild to run immediately anyway, un-governed, at the moment the whole mechanism exists to protect. This over-generalizes "a caller needs this folder now, and user-initiated work is never governed" (a Batch 16b principle scoped to literal user actions/RPC clicks) to "any caller that happens to ask for this folder, including the LLM's own tool call inside the turn the governor is deferring for." This is not a correctness bug (no data race, no crash) but it is a real, demonstrable narrowing of INV-7's protection for exactly the same class of caller Serious #1 already flags for `harness-propagation` — the fix for Moderate #4 reintroduces a version of the same category of gap it was meant to close. Recommend: gate `expediteDeferredRebuild` on an explicit "this is a literal user/RPC action" signal (mirroring the `userInitiated` pattern used for the symbol indexer and thoth), rather than firing it for every `ensureReadyFor` caller.

**Minor — test coverage:** `folder-index-live-sync.spec.ts` unit-tests `expediteDeferredRebuild` directly and thoroughly; no spec exercises the wiring one level up (`WorkspaceFileIndexService.ensureReadyFor` on a real entry with a governor actually invoking expedite end-to-end). The wiring is a single line and low-risk, but the exact behaviour this fix was meant to add (a second `ensureReadyFor` call un-sticking a deferred rebuild) is unverified at the level a regression would most likely appear.

### Style: `BackgroundWorkAdmission` consolidation — clean

The four bespoke `Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>` aliases (`FolderRebuildGovernor`, `SymbolIndexingGovernor`, `BackupGovernor`, a local type in `plugin-activation.ts`) are gone; all four adopters now depend on one shared `BackgroundWorkAdmission` interface (`background-work-governor.ts:126-137`), exported from both `diagnostics/index.ts:50` and the library barrel (`vscode-core/src/index.ts:154`), and documented in `vscode-core/CLAUDE.md:33,222` with the fail-open contract stated on the interface's own doc comment. Naming is consistent with the sibling `BackgroundWorkSignal` (the non-waiting half); no drift found between the doc comment's claims and the four implementations. The unused `path` import removal and `GOVERNOR_LANE` placement in the indexer were confirmed as claimed (cosmetic only, no logic change). Nothing here duplicates code-style-reviewer's territory beyond this brief pass, per the coordinator's request to keep it light.

### Delta verdict

- Assessment: APPROVE_WITH_FIXES
- Confidence: HIGH
- What changed since the base review: Serious 2 and Moderate 3 are cleanly fixed and consistent with the rest of the codebase's patterns. Serious 1 is knowingly deferred to a follow-up batch with a concrete, sufficient design already agreed — acceptable as tracked debt, not a silent gap. Moderate 4's mechanism is race-safe, but its wiring point (every `ensureReadyFor`, not just literal user actions) reproduces a narrower version of the same "governor bypassed by a non-click caller" pattern Serious 1 was raised for, on a code path proven live (`core-namespace.builders.ts:161`, `analysis-namespace.builders.ts` → `WorkspaceAnalyzerService`) rather than hypothetical.
- Outstanding before this can be scored APPROVE: (1) land the planned Batch 17b fix for Serious 1; (2) either scope `expediteDeferredRebuild` to literal user/RPC-driven `ensureReadyFor` calls, or make an explicit, documented decision that an agent-tool-triggered file/context query is also allowed to force an un-governed rebuild (and say why that is acceptable given INV-7).
