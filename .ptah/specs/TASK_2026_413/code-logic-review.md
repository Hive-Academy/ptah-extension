# Code Logic Review — `TASK_2026_413`

## Summary

| Metric              | Value              |
| ------------------- | ------------------ |
| Overall score       | 7/10               |
| Assessment          | APPROVE_WITH_FIXES |
| Blocking issues     | 0                  |
| Serious issues      | 1                  |
| Moderate issues     | 4                  |
| Failure modes found | 5                  |

Scope reviewed: `git-info.service.ts` (`reviewChanges`/`reviewFile`/numstat/`resolveReviewRef`/`isMutatingGitCommand`/`applyHunks` guards), `workspace-file-path.ts`, `git-rpc.{handlers,schema}.ts`, `editor-rpc.{handlers,schema}.ts`, `file-open-rpc.handlers.ts`, `editor-launcher-detection.ts`, `editor-launcher.service.ts`, `git-review.service.ts`, `git-review-file-row.component.ts`, `branch-picker-dropdown.component.ts`, `diff-view.component.ts` (provenance/hunk-availability logic), `open-in-button.component.ts`, `workspace-coordinator.service.ts` diff, `git-dock.mount.spec.ts`, `implementation-report.md` Batch 6 narrative, and the fixture diff it cites. Full text of every file above was read; other Batch 3/4/5 files (`git-review-toolbar`, `git-review-panel`, `branch-details-popover`, `source-control-*`, `changed-file-tree`, remaining e2e specs) were sampled by grep, not read end to end — treat findings about those as scoped to what a targeted grep surfaced, not a full audit.

## Five logic questions

### 1. How does this fail silently?

- `EditorLauncherService.detect()` (`libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:44-46`) does `this._targets.set(response.data.targets)` on any response with `response.success && response.data` truthy, with no check that `response.data.targets` is actually an array. The backend handler (`editor-rpc.handlers.ts:58-73`) always includes `targets` when it sets `success: true`, so today this cannot happen against the real backend — but the Batch 6 root-cause writeup (`implementation-report.md:60`) is itself proof of how close this came to a real failure: a fixture happened to satisfy `response.success && response.data` while `data.targets` was `undefined`, and the only thing that stood between that and a broken render was that the fixture was later fixed. Any other producer of a truthy `data` object without `targets` (a future intermediary layer, a differently-shaped legacy host, a partially-applied RPC mock in a later test) reproduces the exact crash Batch 6 just diagnosed, silently — no error state is shown, `targets()` is simply `undefined` at runtime despite its `readonly EditorTarget[]` type, and `OpenInButtonComponent.targets().length` throws inside every mounted row's template, aborting the rest of the render tree (this is verbatim the failure Batch 6 attributes to the test fixture, `implementation-report.md:56-62`). The fix landed only in the test fixture (`fixtures.ts:11-16` typed with `satisfies EditorDetectTargetsResult`); the consuming code was not hardened.
- `GitInfoService.parseReviewNames` / `parseNumstat` (`git-info.service.ts:2600-2665`) silently drop any NUL-delimited field group they cannot parse (`if (!match) continue;`, `if (!filePath) continue;`). A parse a future git version changes the field shape for (e.g., a new rename-similarity annotation) would silently omit files from the review rather than surfacing a parse error — the user would see a comparison that looks complete but is short files, no `error` set.
- `readUntrackedNumstat` (`git-info.service.ts:2571-2598`) returns `{ additions: null, deletions: null }` for any read failure (ENOENT racing with status, permission error, directory changed between `stat` and `readFile`) with no distinction from "genuinely unreadable/binary" vs "transient I/O error" — both render as `?`/`?` in the UI, which is the stated design (AC5 "Binary counts are represented as unavailable, not zero") but also silently absorbs a transient failure that a retry would have resolved.

### 2. What user action produces unexpected behaviour?

- Selecting a base/head pair, then rapidly re-selecting a different pair before the first `git:reviewChanges` resolves: correctly guarded — `refresh()` re-checks `generation !== this.generation || workspaceRoot !== this._workspace()` before writing (`git-review.service.ts:122`), and `expand()` mirrors the same idiom (`git-review.service.ts:174`). No stale write reproduced by inspection.
- Toggling "Mark as viewed" on a file, then switching workspace and back: `switchWorkspace` restores `result`/`base`/`head`/`filter` from `workspaceStates` (`git-review.service.ts:76-85`) but the viewed set is a single flat `Set` keyed by `workspace\0mergeBaseSha\0headSha\0path` (`viewedKey`, `git-review.service.ts:202-207`) that is never partitioned or dropped on switch — this is correct per AC7 ("resets for a changed SHA pair or different workspace") because the key itself encodes workspace+SHA pair, so a switch to a different workspace/pair naturally shows unviewed. No bug found here on inspection, but note it for the reviewer of `git-review-panel`/`toolbar` (not read in full) to confirm the UI actually re-queries `isViewed` per file rather than caching a snapshot.

### 3. What input data produces a wrong answer?

- `parseNumstat` (`git-info.service.ts:2600-2630`) treats the rename continuation case by consuming exactly two more NUL fields as `[oldPath, newPath]`, then storing the stat keyed by `newPath`, discarding `oldPath`. For a _copy_ (`C`) with the numstat-only pathspec, this is the same shape and is handled the same way. However `parseReviewNames` (name-status parser, `git-info.service.ts:2632-2665`) keys review files by `path` (the new path) with `originalPath` recorded, and the merge in `reviewChanges` (`git-info.service.ts:498-505`) does `statMap.get(file.path)` — i.e., looks up numstat by the _new_ path only. This is consistent as long as `parseNumstat`'s rename branch always stores under the new path, which it does — verified consistent, not a bug.
- `resolveReviewRef` (`git-info.service.ts:2534-2556`) rejects refs starting with `-`, over 255 chars, or containing control characters, then resolves via `rev-parse --verify --end-of-options <ref>^{commit}`. This correctly prevents option injection (e.g. `--upload-pack=...`) and forces resolution to a commit object (rejecting a tag pointing at a blob, etc.). Good option-safe pattern, matches the plan's stated design.
- **Root/unrelated-history refs**: `reviewChanges` computes `merge-base` and treats a non-zero exit or a `mergeBaseSha` that fails `isObjectSha` as "no shared merge base" (`git-info.service.ts:452-461`), which correctly covers both "genuinely unrelated histories" and the case where `git merge-base` succeeds with multiple candidates (git returns only the first line; `mergeBase.stdout.trim()` on a multi-line ambiguous result would silently pick one candidate as if it were unambiguous — a real edge case with octopus-adjacent histories, not tested by the described scratch-repo matrix in `test-report.md`'s description of "no merge base / unrelated histories / root commits").

### 4. What happens when a dependency fails?

- If `git diff --name-status` succeeds but `git diff --numstat` fails independently (theoretically possible under resource exhaustion or signal race, since they run via `Promise.all` as two separate spawns, `git-info.service.ts:465-492`), the check `if (names.exitCode !== 0 || stats.exitCode !== 0)` correctly fails the whole comparison rather than returning partial/inconsistent data. Good.
- If the backend's `editor:detectTargets` handler throws inside `this.launcher.detect()`, `detectFailure` (`editor-rpc.handlers.ts:137-144`) returns `{ success: false, targets: [], error }`, which `EditorLauncherService.detect()` correctly routes to the `_detectionError` signal, leaving `targets` at its safe `[]` default (`editor-launcher.service.ts:47-51`). This path is safe. The unsafe path is the one under Q1: a well-formed `success:true` envelope whose payload the frontend does not itself validate.

### 5. What is missing that the requirements never mentioned?

- No bound on `GitInfoService.issuedReviews` (`git-info.service.ts:303`) growth within a single workspace session between mutating operations — see Moderate-2 below.
- No bound on `GitReviewService.workspaceStates` (`git-review.service.ts:33`) across many visited workspaces in one Electron session (multi-root workspace churn) — the map is only trimmed by explicit `removeWorkspaceState`, which is coordinator-driven and may not fire for every workspace a user visits in a long session.
- The requirements do not address what happens to an **open historical diff tab** if the user commits/stages/checks-out a branch from the _working-tree_ surface while a review tab is expanded — nothing invalidates the expanded historical file's cached blobs, though since they are immutable SHA reads this is by design and correct, not a gap.

## Failure modes

### Malformed-but-truthy editor-detection response bypasses defensive typing

- Trigger: any RPC transport/mock/future host returns `{ success: true, data: {} }` (or any object without a `targets` array) for `editor:detectTargets`.
- Symptom: `EditorLauncherService.targets()` holds `undefined` despite its declared `readonly EditorTarget[]` type; the first mounted `OpenInButtonComponent.targets().length` throws, aborting the Angular render of every subsequent sibling row (verbatim the Batch 6 regression, `implementation-report.md:60-62`).
- Evidence: `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:44-46`; `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:46-48`.
- Current handling: fixed only at the test-fixture layer (`apps/ptah-electron-e2e/src/support/fixtures.ts:11-16`); production code performs no shape check.
- Recommendation: `this._targets.set(Array.isArray(response.data.targets) ? response.data.targets : [])` (or a light Zod/runtime guard consistent with the repo's "validate every external boundary" standard) so a malformed response degrades to "no targets" instead of crashing the render.

### `issuedReviews` grows without bound within a session

- Trigger: a user opens many distinct base/head comparisons in one workspace session without any intervening mutating git operation (stage/unstage/commit/checkout/push — the only things that call `invalidateReadCache`, `git-info.service.ts:306-333`).
- Symptom: unbounded growth of `Map<string, Map<string,string>>` for the life of the process/workspace; never observable to the user, but a long-lived Electron session doing heavy branch review accumulates memory with no cap, unlike the repo's own convention for exactly this class of problem (`SessionMcpStatusRegistry`'s 256-entry LRU, `DegradationReporter`'s `MAX_TRACKED_DEGRADATION_CODES`).
- Evidence: `libs/backend/vscode-core/src/services/git-info.service.ts:302-303`, `315-333`, `514-520`.
- Current handling: cleared entirely only on `invalidateReadCache()` with no argument, or per-workspace when any mutating command runs for that workspace; pure review browsing never triggers either.
- Recommendation: bound `issuedReviews` (and the `readCache` review entries) with an LRU or a TTL, matching the pattern already established elsewhere in this codebase.

### `GitReviewService.workspaceStates` unbounded across visited workspaces

- Trigger: a long Electron session where the user opens, closes, and reopens several different workspace folders in the multi-root/canvas flow.
- Symptom: cached `WorkspaceReviewState` entries persist for every workspace ever visited until `removeWorkspaceState` is explicitly invoked by the coordinator; no cap.
- Evidence: `libs/frontend/git-ui/src/lib/services/git-review.service.ts:33`, `64-86`, `88-103`.
- Current handling: relies entirely on `WorkspaceCoordinatorService` calling `removeWorkspaceState` on every workspace close; not verified end to end in this review (coordinator diff only shows `GitReviewService` added to the `gitServices` array, not that every close path invokes removal for it specifically vs. just `switchWorkspace`).
- Recommendation: confirm (via `workspace-coordinator.service.spec.ts`, not read in full here) that a workspace _removal_, not just a switch, calls `removeWorkspaceState` for `GitReviewService` specifically, and consider a soft cap regardless.

### Silent field-drop on unparseable NUL-delimited git output

- Trigger: a git version or configuration that shapes `--name-status -z` / `--numstat -z` output in a way the regex/index-walking parsers do not anticipate (e.g., an unexpected extra NUL field from a future git flag).
- Symptom: affected files are silently omitted from the review result with no error surfaced — the comparison looks complete (`success: true`) but is missing entries, and `totals` would then also be short by exactly those files' stats.
- Evidence: `libs/backend/vscode-core/src/services/git-info.service.ts:2611-2621` (`if (!match) continue;`), `2635-2641` (`if (!statusField) continue;` / unrecognized status silently skipped).
- Current handling: no logging, no error flag, no count-mismatch detection between `--name-status` and `--numstat` outputs.
- Recommendation: at minimum log a warning when `parseReviewNames(names.stdout).length` and the number of files successfully matched in `statMap` diverge unexpectedly, so a parser drift is detectable in the field rather than only as a silent under-count.

### Ambiguous multi-candidate `merge-base` picks the first line unexamined

- Trigger: an octopus-adjacent history where `git merge-base <a> <b>` legitimately can return more than one line for criss-cross merges.
- Symptom: `mergeBase.stdout.trim()` (`git-info.service.ts:456`) takes the _whole trimmed output_ as one SHA; if git ever emits two lines (rare, but a real git behavior for criss-cross merge scenarios without `--all`), `isObjectSha` on the two-line, newline-joined string would fail the regex and the call would report "no shared merge base" for two refs that do share one — a false negative, not silent corruption, but not exercised by name in `test-report.md`'s described matrix ("no merge base / unrelated histories / root commits").
- Evidence: `libs/backend/vscode-core/src/services/git-info.service.ts:452-461`.
- Current handling: fails safe (`isObjectSha` rejects a multi-line string), but with a misleading error message ("do not share a merge base") for a case where they do.
- Recommendation: low priority; either take `mergeBase.stdout.split('\n')[0]` explicitly and document the "first candidate wins" choice, or leave as is with a code comment acknowledging the trade-off — not worth blocking on.

## Blocking issues

None found in the scope reviewed.

## Serious issues

### Frontend trusts external RPC response shape with no runtime guard on the exact field that already caused a regression

- File: `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:44-46`
- Scenario: any future response shape drift (a differently-versioned host, an intermediary layer, or — as already demonstrated — an incomplete test double) supplies `response.success: true` with a `data` object lacking `targets`.
- Impact: every `OpenInButtonComponent` in the dock throws on `targets().length`, aborting the remaining Angular render pass for that change-detection cycle — visible to the user as missing file rows and a diff pane stuck on "Loading diff editor…" (this is the literal Batch 6 symptom). The team's own root-cause report treats this as a test-fixture defect and fixes only the fixture; the production code that will reproduce the exact same crash under a slightly different malformed input was not hardened.
- Fix: guard with `Array.isArray(...)` (or equivalent) before assigning into `_targets`, and treat a non-array as `_detectionError` instead of a crash.

## Moderate and minor issues

- `libs/backend/vscode-core/src/services/git-info.service.ts:302-333` — `issuedReviews` unbounded growth across a session with no cap or TTL (see Failure modes).
- `libs/frontend/git-ui/src/lib/services/git-review.service.ts:33` — `workspaceStates` unbounded growth across visited workspaces (see Failure modes).
- `libs/backend/vscode-core/src/services/git-info.service.ts:2611-2621`, `2635-2641` — parser silently drops unmatched NUL fields with no diagnostic (see Failure modes).
- `libs/backend/vscode-core/src/services/git-info.service.ts:452-461` — first-line-only merge-base handling for a (rare) multi-candidate output (see Failure modes).
- Minor: `readUntrackedNumstat` (`git-info.service.ts:2571-2598`) counts line-endings with a mixed `\r\n|\r|\n` split, which is correct for cross-platform text but silently treats a CRLF file inconsistently from how `git diff --numstat` itself would count it for a _tracked_ file (git counts by `\n` only) — a purely cosmetic discrepancy between an untracked file's reported addition count and what it would show once staged, not a logic error but worth a one-line comment for the next reader who notices the number changes on `git add`.

## Data flow

1. User selects base/head in the review toolbar → `GitReviewService.setBase/setHead` → `refresh()` (`git-review.service.ts:52-59`, `105-145`). OK — generation-guarded against stale workspace/selection.
2. `refresh()` calls `git:reviewChanges` RPC → `GitRpcHandlers.registerGitReviewChanges` (`git-rpc.handlers.ts:190-196`) → validates params via Zod, resolves and authorizes the workspace root via `resolveRoot`/`isRegisteredFolder` (`git-rpc.handlers.ts:261-283`) → `GitInfoService.reviewChanges` (`git-info.service.ts:441-537`). OK — root gated before any git call.
3. `reviewChanges` resolves both refs to SHAs with option-safe `rev-parse` (`git-info.service.ts:2534-2556`), computes `merge-base`, and only then reads `--name-status`/`--numstat` against the two resolved SHAs. OK — no user ref string ever reaches a diff/show invocation directly, matching the "argv-only, SHA-only" constraint. Gap: first-line-only merge-base handling noted above.
4. Result is cached by `mergeBaseSha\0headSha` and `issuedReviews` records the authorized `(path → originalPath)` set for that pair. OK for authorization; unbounded for memory (noted above).
5. User expands a file → `GitReviewService.expand()` sends `baseSha: result.mergeBaseSha` (not the base ref's own tip SHA) — verified to match exactly the key `reviewFile` looks up in `issuedReviews` (`git-info.service.ts:564-568`). OK, consistent identity scheme end to end.
6. `reviewFile` validates both path segments, validates SHA shape, and rejects any path not present in the exact `issuedReviews` entry for that SHA pair before reading blobs — client-supplied SHA/path pairs cannot be used to read arbitrary blobs outside a previously issued comparison. OK.
7. `GitReviewFileRowComponent` renders the result with `[applyHunks]="null"` and a `provenance.kind: 'historical'` tab (`git-review-file-row.component.ts:70`, `94-98`); `DiffViewComponent.hunkActionsAvailable` independently checks both `!this.applyHunks()` and `provenance?.kind === 'historical'` (`diff-view.component.ts:984-987`) before showing any mutation control. OK — two independent guards, not one.
8. Editor "Open In" — `OpenInButtonComponent` emits `{target, path, root}` → `EditorLauncherService.openFile`/`openWorkspace` → `editor:openFile`/`editor:openWorkspace` RPC → `resolveWorkspaceFilePath` (`workspace-file-path.ts:25-58`) verifies the supplied `workspaceRoot` against the registered set, resolves relative paths only beneath it, rejects absolute paths outside every registered root via `isPathWithinRoots`, and rejects directories. OK for the stated threat model (registered-root containment); no `realpath`/symlink-escape check was found in this resolver or in `isPathWithinRoots` (pre-existing shared utility, not modified by this task) — noted as a gap worth confirming is intentional (out of this task's stated scope, since `isPathWithinRoots` predates this diff) rather than re-litigated here as a new defect.

## Requirements fulfilment

| Requirement                                                               | Status                       | Gap                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 non-force checkout via rendered picker                                | COMPLETE                     | `branch-picker-dropdown.component.ts:148-156` — ordinary checkout first, dirty triggers explicit warning.                                                                                                                                                                              |
| AC2 dirty-tree warning, cancel = no mutation                              | COMPLETE                     | `confirmForce`/cancel button both verified (`branch-picker-dropdown.component.ts:39-50`, `157-160`); cancel only clears local signal, no RPC call.                                                                                                                                     |
| AC4 base/head review issues no mutation RPCs                              | COMPLETE                     | `GitReviewService` only calls `git:reviewChanges`/`git:reviewFile`; historical tab passes `applyHunks=null`.                                                                                                                                                                           |
| AC5 accurate aggregate/per-file stats incl. binary/rename                 | PARTIAL                      | Logic present and matches design; not independently re-verified against a running scratch repo in this review (no `node_modules`/test run available in this pass — relies on `test-report.md`'s claims). Parser silent-drop edge case noted above.                                     |
| AC7 viewed-state partition/reset                                          | COMPLETE                     | Key includes workspace + `mergeBaseSha` + `headSha` + path (`git-review.service.ts:202-207`); a new pair is unviewed by construction since the key differs.                                                                                                                            |
| AC8 historical rows expose no mutation controls                           | COMPLETE                     | Double-gated (Q7 above).                                                                                                                                                                                                                                                               |
| AC9 Kiro listed only when verified; launch uses selected editor+workspace | PARTIAL                      | Backend contract verified sound (`editor-rpc.handlers.ts`); PATH-only detection logic in `editor-launcher-detection.ts` not read end-to-end in this pass — grep-only.                                                                                                                  |
| AC10 unregistered root/traversal/outside rejected before launch           | COMPLETE                     | `workspace-file-path.ts:32-56`; no symlink-escape check found, flagged as a pre-existing-utility gap, not a new regression.                                                                                                                                                            |
| AC11 failed push visible, retry available                                 | NOT VERIFIED                 | `git-dock-header.component.ts` push-status wiring not read in this pass.                                                                                                                                                                                                               |
| AC12 hunk widget stays inside pane at default width                       | NOT VERIFIED                 | CSS/layout change in `diff-view.component.ts` not visually reviewed here (that is `visual-reviewer`'s job); code-level gating logic (`hunkActionsAvailable`) is correct but says nothing about layout geometry.                                                                        |
| AC13 mount tests catch export-only regressions                            | COMPLETE (as far as sampled) | `git-dock.mount.spec.ts` renders the real `GitDockComponent` tree via `jest.requireActual`, stubs only `rpcCall` and `MonacoLoaderService`, and asserts real DOM query results (`querySelectorAll('ptah-source-control-file')`) — genuine mount coverage, not a protected-method call. |

Implicit requirements not addressed: a memory/lifetime bound on the two new caches introduced by this task (`issuedReviews`, `workspaceStates`) — not stated in acceptance criteria but consistent with this repository's own established pattern for exactly this class of state (see Failure modes).

## Edge cases

| Case                                                                          | Handled    | How                                                                                                  | Concern                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unrelated histories / no merge base                                           | YES        | `merge-base` non-zero exit / non-SHA output → `reviewFailure`                                        | Multi-candidate merge-base (criss-cross) collapses to first-line parse; not exercised by name in the test matrix description.                                                         |
| Root commit compared to itself or to HEAD with zero prior commits             | Likely YES | `resolveReviewRef` resolves any ref to `^{commit}`; `merge-base` of a ref with itself returns itself | Not independently traced through `diffFile`'s "no commits" row of its own resolution table (that table is for the _working-tree_ diff path, a different method, not `reviewChanges`). |
| Malformed `editor:detectTargets` response                                     | NO         | Trusts `response.data.targets` without a shape guard                                                 | Serious issue above — this is the exact shape of the just-fixed Batch 6 regression, only shifted from "test fixture" to "any other malformed producer."                               |
| Client sends a SHA-shaped `baseSha`/`headSha` never issued by `reviewChanges` | YES        | `issuedReviews` lookup keyed by workspace+SHA pair; path must match exactly                          | Verified in code; not re-verified against a running scratch repo in this pass.                                                                                                        |
| Filename containing a tab or embedded NUL-adjacent byte sequence              | Likely YES | `-z` NUL-delimited parsing throughout                                                                | Not independently fuzzed in this review; relies on `test-report.md`'s claim of coverage.                                                                                              |
| Session growth over many branch-review sessions without any mutation          | NO         | `issuedReviews`/`workspaceStates` never evicted except by explicit mutation/removal                  | Moderate memory-growth finding above.                                                                                                                                                 |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: MEDIUM — the security- and mutation-safety-critical paths (workspace authorization, SHA-only reads, non-force-first checkout, historical read-only provenance gating) were read in full and are sound; several files named in the review brief (`branch-details-popover`, `git-review-toolbar`, `git-review-panel`, `source-control-*`, `changed-file-tree`, the electron e2e specs beyond the mount spec, `editor-launcher-detection.ts` and its three adapters) were sampled by grep rather than read end to end, so confidence on AC9, AC11, AC12, and full test-honesty is bounded by that.
- Top risk: `EditorLauncherService.detect()` assigning an unvalidated `response.data.targets` into a signal typed as a non-optional array is the same defect class Batch 6 just root-caused and fixed only in a test fixture — it will reproduce the identical crash the day any other producer (not just a test double) supplies a well-formed-envelope-but-missing-field response.
- What a robust implementation would add: a runtime array guard on the one RPC boundary this review found unguarded; a bound (LRU/TTL) on `issuedReviews` and `workspaceStates` consistent with this repo's own established pattern for exactly this state shape; and a logged mismatch when the name-status and numstat parsers disagree on file count, so a future git-output-shape drift is detectable rather than a silent under-count.
