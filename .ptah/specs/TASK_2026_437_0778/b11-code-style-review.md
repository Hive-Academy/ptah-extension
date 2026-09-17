# Code Style Review — `TASK_2026_437_0778` Batch 11

## Summary

| Metric          | Value                      |
| --------------- | -------------------------- |
| Overall score   | 7/10                       |
| Assessment      | NEEDS_REVISION             |
| Blocking issues | 0                          |
| Serious issues  | 2                          |
| Minor issues    | 3                          |
| Files reviewed  | 11 (10 diffed + CLAUDE.md) |

## Five style questions

### 1. What breaks in six months?

`workspace-file-index.service.ts` (1172 lines, `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts`) mixes two responsibilities the file itself already documents as distinct — the folder-lifecycle/eviction/LRU side (`:326-670`) and the live-watch/batch-patch side (`:697-1001`: `subscribe`, `onBatch`, `addCreatedPaths`, `rebuildAfterOverflow`, `runOverflowRebuild`, `deleteLivePath`, `deleteLiveDescendants`, `addFileEntry`+helpers). The next person adding a third watcher behavior (Batch 17's governor adoption, per the batch's own follow-up note) has to read and touch all 1172 lines to find where it belongs, and a merge conflict between an eviction change and a watch-mechanism change becomes likely because they share one file with no seam.

### 2. What would a new team member misread?

In `eslint.config.mjs`, the `RECURSIVE_WATCH_ALLOWED` filter blocks (`:493-524` in the new file) apply three different `no-restricted-syntax` option sets depending on file extension and `apps/`/`libs/` prefix, layered after the base rules. A reader has to trace which of four blocks last touched a given file's rule options to know what's actually enforced there — correct, but easy to misread as "these files are exempt from everything" when only the watch selectors are lifted.

### 3. What does this cost to maintain?

Two independent local fakes for the same port (`FakeWorkspaceWatcher` in `apps/ptah-electron/src/services/git-watcher.service.spec.ts:78-112` and `FakeWatcher` in `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.spec.ts:24-60`) implement the same `deliver`/spread-defaults/dispose-tracking shape by hand. Every other port in `platform-core` has exactly one shared mock in `src/testing/mocks/` (`file-system-provider.mock.ts`, `workspace-provider.mock.ts`, etc.) that every consumer spec imports. `IWorkspaceWatcher` is the one port in this batch without one, so the next adapter-consumer spec (there will be more — `platform-vscode`'s `VscodeWorkspaceWatcher` already exists, and Batch 17 touches this file again) either copies one of these two forks or writes a third.

### 4. Where is this inconsistent with the rest of the repository?

`eslint.config.mjs`'s own top-of-file comment on `MESSAGE_LITERAL_SELECTORS` states the exact hazard this batch's `IN_MAIN_RECURSIVE_WATCH_SELECTORS` reproduces: "flat config replaces (rather than merges) a rule's options per file match, so [a lib config that narrows `no-restricted-syntax`] would otherwise silently drop these two selectors." `libs/backend/skill-synthesis/eslint.config.mjs` and `libs/web/members/eslint.config.mjs` both import and re-spread `MESSAGE_LITERAL_SELECTORS` for exactly this reason — but neither imports or re-spreads `IN_MAIN_RECURSIVE_WATCH_SELECTORS`, so `.ts` files in those two libs are silently exempt from the new rule. The task's own review brief flagged this as something to check; it is a real gap, not a hypothetical one.

### 5. What would you have done differently?

Extract the live-watch mechanism (`subscribe` through `addAncestorDirectories`) out of `WorkspaceFileIndexService` into a named collaborator (e.g. `FolderIndexWatchCoordinator`) under the facade rule already used for `SkillSynthesisService`/`StageHandlersService` — same public class, same token, same method signatures, the mechanism becomes an injected collaborator. Add a shared `workspace-watcher.mock.ts` to `platform-core/src/testing/mocks/` and have both specs (and any future one) use it. Export and re-spread `IN_MAIN_RECURSIVE_WATCH_SELECTORS` in the two lib configs that already carry the `MESSAGE_LITERAL_SELECTORS` re-spread pattern.

## Blocking issues

None.

## Serious issues

### `IN_MAIN_RECURSIVE_WATCH_SELECTORS` silently dropped in two lib eslint configs

- File: `libs/backend/skill-synthesis/eslint.config.mjs` (imports only `MESSAGE_LITERAL_SELECTORS`), `libs/web/members/eslint.config.mjs` (same)
- Problem: `eslint.config.mjs`'s own comment on `MESSAGE_LITERAL_SELECTORS` (new lines around `:4-13`) documents that flat config REPLACES `no-restricted-syntax` options per file match rather than merging them, and names `libs/web/members/eslint.config.mjs` specifically as a config that would otherwise drop the selectors. `IN_MAIN_RECURSIVE_WATCH_SELECTORS` is new in this batch, is not exported for this purpose the way `MESSAGE_LITERAL_SELECTORS` is (it is exported, but neither downstream config imports it), and both of these libs' `**/*.ts` blocks set `no-restricted-syntax` with only `MESSAGE_LITERAL_SELECTORS` (+ their own selectors). INV-1's lint gate does not reach `.ts` files in these two libs.
- Tradeoff: today neither lib plausibly imports `chokidar` or calls a recursive `fs.watch`, so the practical exposure is low — but that is exactly the condition under which a rule silently not applying goes unnoticed until it matters, which is the same story that motivated `IN_MAIN_RECURSIVE_WATCH_SELECTORS` itself (a workspace-wide incident from unenforced discipline). The fix is mechanical and low-risk.
- Recommendation: fix now. Add `IN_MAIN_RECURSIVE_WATCH_SELECTORS` to each lib config's import from the root config and spread it alongside `MESSAGE_LITERAL_SELECTORS` in the `**/*.ts` `no-restricted-syntax` array, mirroring the existing pattern exactly.

### `WorkspaceFileIndexService` at 1172 lines mixes two file-size-ceiling-worthy concerns with no collaborator split

- File: `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts` (1172 lines total; grew from before this batch via the `subscribe`/`onBatch`/`addCreatedPaths`/`rebuildAfterOverflow`/`runOverflowRebuild`/`deleteLivePath`/`deleteLiveDescendants`/`addFileEntry`+helpers block at `:697-1001`, plus the eviction/LRU block at `:520-670`)
- Problem: this is well past the 700-line soft ceiling and past the 1000-line "deliberate look" marker CLAUDE.md sets, and unlike a "contract barrel or exhaustive type union," this file is imperative logic with a documented internal seam: the folder-lifecycle side (start/build/evict) and the live-watch/batch-patch side are already described as separate concerns in the file's own doc comments (`:558-596` "no per-event work: one synchronous pass per batch" vs. the eviction doc block above it).
- Tradeoff: a facade-rule split (extracting the watch/batch-patch mechanism as an injected collaborator, keeping `WorkspaceFileIndexService`'s public name/token/methods) would pass the repo's own nameability test (`FolderIndexWatchCoordinator` or similar, not `helpers`/`utils`) and land well under 700 lines on each side, matching the `SkillSynthesisService`/`StageHandlersService` precedent CLAUDE.md cites.
- Recommendation: split under the facade rule in a follow-up (Batch 17 already touches this file per D8/FU-4c, so folding the split into that batch avoids a second churn pass). Not blocking this batch's correctness.

## Minor issues

- `apps/ptah-electron/src/services/git-watcher.service.ts` is 927 lines — under the 1000-line "deliberate look" marker but still nearly a third over the 700 soft ceiling. It reads as cohesive (git-dir watching, workspace-batch handling, and debounce/burst bookkeeping for three channels are one story), so no split is recommended now, but it is worth a look alongside the file-index split above if Batch 17 touches this file too.
- `eslint.config.mjs`: `RECURSIVE_WATCH_ALLOWED`'s Playwright-spec entry (`apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts`) is documented as a temporary allowance with a named follow-up ("reported as a Batch 11 follow-up") but that follow-up does not appear in `batches.md`'s Batch 11 deferred-follow-ups (none is recorded in the diff reviewed). Confirm it is tracked somewhere before this batch closes, or add it as an explicit FU line in the outcome.
- `git-watcher.service.spec.ts` and `workspace-file-index.service.spec.ts` each restate the same "spread defaults over a `Partial<WorkspaceChangeBatch>`" fake-delivery helper almost verbatim (`deliver`, `fire*` conveniences). Once a shared mock exists (Serious issue above), these should both consume it rather than keep parallel copies.

## File-by-file

### `apps/ptah-electron/src/activation/boot-heavy-services.ts`

Score 9/10 — 0/0/0. Minimal, correct: resolves `PLATFORM_TOKENS.WORKSPACE_WATCHER` at the construction site where `GitWatcherService` is built, matching how other services in this file receive their dependencies, with a comment explaining why the token is resolved here rather than given `GitWatcherService` its own DI token.

### `apps/ptah-electron/src/services/git-watcher.service.ts`

Score 8/10 — 0/0/1 (size, see Minor). Clean migration off recursive `fs.watch`: the class doc block explains the incident, the port contract, and what changed, in proportion to the code. `armGeneration` gating, `subscribeWorkspace`'s "new before old" ordering, and `onWorkspaceOverflow`'s idempotent-fold behavior are all documented at the point of use, not just in the header. No leftover storm/echo/unattributed-change state — verified absent by grep.

### `apps/ptah-electron/src/services/git-watcher.service.spec.ts`

Score 7/10 — 0/0/1 (shared fake, counted under the Serious finding above). Rewrite against the fake `IWorkspaceWatcher` reads clearly and the top-of-file strategy note is accurate about what moved to the host vs. what stays here.

### `apps/ptah-electron/src/services/git-watcher.stress.harness.ts` / `git-watcher.stress.spec.ts`

Score 8/10 — 0/0/0. The switch to the real `ElectronWorkspaceWatcher` over the built `workspace-watch-host.mjs` bundle (via a `child_process.fork` stand-in for `utilityProcess`) is well-reasoned and documented, including the explicit statement of what changed about ST-1b's guarantees now that the storm-cancel-on-entry behavior moved to a process this rig cannot see into. `WORKSPACE_WATCH_HOST_BUNDLE`'s missing-bundle error message names the exact build command, consistent with `build-artifact-gate.ts`'s "fail loudly, name the fix" convention documented in `apps/ptah-electron/CLAUDE.md`.

### `eslint.config.mjs`

Score 7/10 — 0/1/0 (the lib-config gap counted above; no other issues). `IN_MAIN_RECURSIVE_WATCH_SELECTORS` follows `MESSAGE_LITERAL_SELECTORS`'s established shape (exported const, doc comment naming the incident, `RECURSIVE_WATCH_ALLOWED` with a reason comment per entry) closely enough that the omission of the same re-spread step in the two lib configs reads as an oversight rather than a different design choice.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts`

Score 6/10 — 0/1/0 (size/facade, counted above). The migration itself is correct and matches CLAUDE.md's description precisely (verified `onNestedRepoRoots` wiring at `:498-499,659,709,868,1118`). The file's size is the only real complaint.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.spec.ts`

Score 7/10 — 0/0/1 (shared fake, counted above). Well-organized rewrite; the `FakeWatcher` class itself is clean and well-commented, the objection is purely to it existing as a second copy of the same double.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts` / `.spec.ts`

Score 9/10 — 0/0/0. `discoverFilesOutsideNestedRepos`, `findNestedRepoRoots`, `holdsGitEntry` are named for what they answer, not how; the depth-leveled, concurrency-bounded `.git` probe is documented with a measured cost figure (30 ms beside a 95 ms walk on this repo), and `discoverFiles` stays a one-line wrapper so every existing caller (the picker, `indexWorkspace*`, `getFileCount`) inherits the exclusion for free — confirmed by grep that all three call sites go through `discoverFiles`.

### `libs/backend/workspace-intelligence/CLAUDE.md`

Score 9/10 — 0/0/0. The "File index" section's rewrite accurately reflects the new `IWorkspaceWatcher`-based mechanism and the new "Nested repositories never enter the index" bullet correctly names `discoverFiles` (the caller-facing method every consumer uses) even though the new logic lives in the private `discoverFilesOutsideNestedRepos` — accurate from the reader's vantage point, since `discoverFiles`'s behavior is what changed.

## Pattern compliance

| Repository rule or nearby convention                                                                     | Status  | Evidence                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hexagonal rule: backend depends on `platform-core` port, not an adapter                                  | PASS    | `workspace-file-index.service.ts:337` `@inject(PLATFORM_TOKENS.WORKSPACE_WATCHER)`; `boot-heavy-services.ts` resolves the same token, no `platform-electron` import in either |
| DI injection style matches siblings (`@injectable()` + `@inject` constructor params)                     | PASS    | `workspace-file-index.service.ts:301-337`                                                                                                                                     |
| No dead storm/echo/null-filename code left behind                                                        | PASS    | grep for `stormBreaker`/`isStorming`/`stormTimer`/`UNATTRIBUTED`/`OWN_REFRESH_ECHO` returns nothing in either service or its spec                                             |
| `EventStormBreaker` still has a real consumer (the coalescer)                                            | PASS    | `libs/backend/platform-core/src/utils/workspace-change-coalescer.ts:42-175` constructs it; not dead                                                                           |
| File size soft ceiling (700 lines, warn-level) + facade rule                                             | FAIL    | `workspace-file-index.service.ts` 1172 lines, no collaborator split (Serious issue above)                                                                                     |
| ESLint custom-selector structure matches `MESSAGE_LITERAL_SELECTORS` precedent                           | PARTIAL | Selector/allowlist shape matches; re-spread step in dependent lib configs missing (Serious issue above)                                                                       |
| Naming: `discoverFilesOutsideNestedRepos`, `findNestedRepoRoots`, `onNestedRepoRoots`, `addCreatedPaths` | PASS    | Domain-named, read at call sites without needing the doc comment                                                                                                              |
| Stress harness/spec readability after switching to the real adapter                                      | PASS    | `git-watcher.stress.harness.ts`/`.spec.ts`, File-by-file above                                                                                                                |
| Shared fake `IWorkspaceWatcher` reused across specs                                                      | FAIL    | Two independent local fakes; no `platform-core/testing/mocks/workspace-watcher.mock.ts` exists (Serious issue above)                                                          |
| CLAUDE.md "File index" accuracy                                                                          | PASS    | Cross-checked against `workspace-file-index.service.ts` wiring                                                                                                                |
| Comment density matches surrounding code                                                                 | PASS    | Consistent "why, not what" doc-comment style across all files in this batch                                                                                                   |

## Maintenance debt

- Introduced: one 1172-line file carrying two service-shaped concerns with no collaborator seam; two divergent local test fakes for one port; a lint rule invisibly inert in two libs.
- Retired: ~1250 lines of in-process recursive-watch, storm-breaker, echo-filter and unattributed-change machinery duplicated across `GitWatcherService` and `WorkspaceFileIndexService` (per `git-watcher.service.ts` diff stat and FU-4a's stated goal); the ad-hoc D4 half-coverage (static excludes reaching four consumers but not the initial walk).
- Net: strongly positive on correctness and duplication removed at the mechanism level, offset by new duplication at the test-fake level and a file that grew past where the facade rule says it should have split.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the ESLint gap (INV-1 not enforced in `skill-synthesis`/`members`) is a real, cheap-to-fix miss on the exact thing this batch's rule exists to prevent recurring; the file-index size is a real but non-blocking debt item best folded into the Batch 17 touch already planned for this file.
- What a 10/10 version would do differently: re-spread `IN_MAIN_RECURSIVE_WATCH_SELECTORS` in both dependent lib configs; extract the live-watch mechanism from `WorkspaceFileIndexService` into a named, injected collaborator under the facade rule; add one shared `IWorkspaceWatcher` mock to `platform-core/src/testing/mocks/` and point both specs at it.

---

## Delta review (review fixes)

Scope: the four items assigned back to the executor, plus the new structure the fixes introduced (`eslint.config.mjs` selector split, the coalescer's leading-edge hold, `git-watcher.service.ts`'s `WORKSPACE_BATCH_INTERVAL_MS`, the new `WorkspaceFileIndexService` members, `worktreeListingSeq`, the three spec-timing updates, and `libs/backend/workspace-intelligence/CLAUDE.md`). Read-only; `npx eslint` and `npx prettier --check` run clean on every file touched by this delta (confirmed above); no nx/test run performed.

### Item 1 — ESLint gap (Serious, prior review) — FIXED

`libs/backend/skill-synthesis/eslint.config.mjs:2,89` and `libs/web/members/eslint.config.mjs:3,144` now import `IN_MAIN_RECURSIVE_WATCH_SELECTORS` alongside `MESSAGE_LITERAL_SELECTORS` and spread both into their `no-restricted-syntax` array, with a doc comment naming both selector sets as re-stated for the same replace-not-merge reason. Verified by grep and by reading both files. Closed.

### Item 2 — `WorkspaceFileIndexService` size (Serious, prior review) — RECORDED, DEFERRED

The file is now 1296 raw lines (`libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts`), up from 1172 — `npx eslint` reports 740 lines under the ceiling's own `skipBlankLines`/`skipComments` counting, a `max-lines` warning (non-blocking by design, per `eslint.config.mjs`'s own comment on why this rule stays `warn`). The new additions in this delta (`toIndexKey`, `queryable`, `DIRECTORY_DELETE_SWEEP_LIMIT`, `requestRebuild`, `retrySubscribeIfDue`) land inside the same watch/batch-patch region already named in the base review as the facade-split candidate, so the growth confirms rather than changes that assessment. Per the orchestrator's decision this is deferred to Batch 17, which already touches this file (D8/FU-4c) — recorded here, not re-raised as a new blocker. No regression: the new code is well-scoped and clearly named (see below), it is simply more of what was already oversized.

### Item 3 — e2e spec follow-up naming (Minor, prior review) — FIXED

`eslint.config.mjs`'s `RECURSIVE_FS_WATCH_ALLOWED_APP_TS` entry for `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` now opens its reason comment with "FU-11 e2e git-watcher spec" and closes it "(orchestrator follow-up FU-11)" — a stable, greppable name rather than the prior unnamed "reported as a Batch 11 follow-up." Confirmed present in the current `eslint.config.mjs` (`:127-134`). Closed as far as this review's scope goes; whether FU-11 itself is listed in `batches.md`'s Batch 11 outcome once the batch closes is outside what this file can prove and is the team-leader's bookkeeping, not a style defect.

### Item 4 — shared `IWorkspaceWatcher` mock (Minor, prior review) — FIXED, follows the sibling pattern

`libs/backend/platform-core/src/testing/mocks/workspace-watcher.mock.ts` (new) matches the shape of its neighbours in the same directory: a `create*` factory returning a `jest.Mocked<IWorkspaceWatcher> & { readonly __state: ... }` (same convention as `createMockWorkspaceProvider`, `createMockSecretStorage`, `createMockStateStorage`), a state object exposing `subscriptions`/`live()`/`latest()` in the same spirit as those mocks' `__state.seed`/`__state.fireChange`, and a doc comment stating what it does and does NOT cover (no coalescing, no timers, no exclusion — pushed to `WorkspaceChangeCoalescer`'s own spec and the shared contract runner). Exported from `mocks/index.ts` in the same list-of-named-exports style as every other mock. Both `apps/ptah-electron/src/services/git-watcher.service.spec.ts:27,110` and `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.spec.ts:10,151` now import and use `createMockWorkspaceWatcher` in place of their former local fakes — confirmed by grep; no local `FakeWorkspaceWatcher`/`FakeWatcher` class remains in either spec. `mock-coverage.spec.ts` does not exercise the new mock, but that file is a selective branch-coverage supplement (it also omits several older mocks, e.g. auth-provider, editor-provider, diagnostics-provider), so the omission is consistent with existing practice, not a new gap. Closed.

### New structure introduced by the fixes

**`eslint.config.mjs` selector split (`RECURSIVE_FS_WATCH_SELECTORS` / `CHOKIDAR_LOAD_SELECTORS`, `:65-109`)** — reads well. Each half has its own exported const, its own message constants (`RECURSIVE_FS_WATCH_MESSAGE`, `RENAMED_FS_WATCH_MESSAGE`, `CHOKIDAR_MESSAGE`) instead of the inline message strings the base review saw, and the doc comment at `:38-51` states plainly why the split exists ("so an exemption can lift one without the other") and names its own limit (a syntax rule cannot see through an aliased options object or a re-exported `watch`). The renamed-import selectors (`:78-87`, catching `import { watch as w }` and `const { watch: w } = require('fs')`) are a genuine hardening the base review's version did not have. Each of the four allowlist groups (`CHOKIDAR_ALLOWED`, `FS_WATCH_AND_CHOKIDAR_ALLOWED`, `RECURSIVE_FS_WATCH_ALLOWED_APP_TS`, `RECURSIVE_FS_WATCH_ALLOWED_JS`) carries its own reason comment and lifts only the half its name says it lifts (`:514-545`), which is the readability property the coordinator asked about — confirmed correct by reading the four corresponding rule blocks, not just the lists.

**`workspace-change-coalescer.ts:372` leading-edge hold** — this closes a real gap the base review's evidence pointed at without naming it: the stress spec's own comment ("The port does not tell a consumer a storm has started... nothing on this side of the port can [cancel the debounce]") described exactly the race this hold now prevents. The implementation (`scheduleFlush`, holding the first post-quiet change for the full `minBatchIntervalMs` rather than flushing at once) is documented in three places consistently — the coalescer's own doc comment (citing `@parcel/watcher`'s `src/Debounce.cc` `notifyIfReady`/`MAX_WAIT_TIME` by name), `workspace-watcher.interface.ts`'s `minBatchIntervalMs` doc and the port's own "Guarantees" list, and `platform-core/CLAUDE.md` — the same fact stated at the same level of detail in all three, which is what keeps a doc from drifting from its code.

**`git-watcher.service.ts:242` `WORKSPACE_BATCH_INTERVAL_MS`** — the name and the adjoining comment are consistent with the file's other `*_MS` constants (each carries a "why this number" comment) and additionally cites a measured number (a delete's lone first event led its flood by ~470 ms on Windows) to justify doubling that gap to 1000 ms, plus an explicit statement of the cost (up to 1 s extra latency on a lone change after quiet). This is the right level of justification for a magic number that trades latency for correctness.

**`workspace-file-index.service.ts` new members** — `toIndexKey` (`:296`) is a well-isolated, well-named normalization function with a clear doc comment on the three things it normalizes (separators, trailing slash, drive-letter case); `queryable` (`:489`) is a precise, minimal gate that closes the FU-4c "search before first build" gap named in the base review, and is documented against `active` so the distinction between "the folder in use" and "the folder safe to read" is explicit; `DIRECTORY_DELETE_SWEEP_LIMIT` (`:158`) plus its use in `onBatch` gives a bounded worst case for a batch-time sweep and folds cleanly into the existing `requestRebuild` path rather than adding a new one; `requestRebuild` (`:953`) is a sensible consolidation point for what was three separate overflow/rebuild call patterns; `retrySubscribeIfDue` (`:811`) is documented with its own no-timer rationale ("a folder nobody queries stays static until it is queried") consistent with the file's existing lazy-activation philosophy. None of these is a "helpers/utils" grab-bag name; each names what it answers.

**`git-watcher.service.ts` `worktreeListingSeq` (`:177`, used at `:663,684`)** — correctly closes an out-of-order-resolution race between two overlapping `refreshNestedRepoRoots` calls (the existing `armGeneration` check alone does not order two listings started under the same generation). The comment at the check site ("a listing started after this one owns the answer") is minimal but sufficient given the surrounding method already explains the failure/degradation story in detail.

**`libs/backend/workspace-intelligence/CLAUDE.md`** — the "Live updates" bullet's cross-reference to the leading-edge hold is accurate and consistent with the other two doc sites (interface + platform-core CLAUDE.md); no drift found between the doc's description and `onBatch`'s current behavior (`requestRebuild` replacing the old direct overflow calls is a rename the doc did not need to change, since it was already describing behavior, not method names).

### New minor finding from this delta

**Spec-timing magic number `250`/`300` without a named constant, inconsistently commented.** `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.spec.ts` (9 call sites) and `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.spec.ts` (5 call sites) changed every `clock.advance(0)` to `clock.advance(250)` with no comment at any site explaining why 250 specifically (it is `WORKSPACE_WATCH_LIMITS.minBatchIntervalMs`'s default, exported from `workspace-change-coalescer.ts:51`, but neither spec imports or references that constant — the literal is asserted, not derived). `libs/backend/platform-electron/src/workspace-watch/in-process-workspace-watch-host.spec.ts:67` does the same thing but with a one-line comment ("The coalescer holds the first batch after quiet for the 250 ms interval.") and a `300` ms wait for margin. The inconsistency — one of three touched spec files explains the number, two don't, and none reference the named constant they're implicitly asserting — is a minor readability gap: a future change to the default floor would need to be hunted down as 14 scattered literals rather than caught by a constant reference. Not blocking; recommend a follow-up (or fold into Batch 17) to import `WORKSPACE_WATCH_LIMITS.minBatchIntervalMs` in both files and add the one-line comment `in-process-workspace-watch-host.spec.ts` already has.

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Rationale: all three fixable items (ESLint gap, e2e follow-up naming, shared mock) are correctly and idiomatically fixed, verified by direct inspection and clean `eslint`/`prettier --check` runs. The deferred file-size item is correctly recorded rather than re-blocked, matching the orchestrator's decision. The one new finding (magic-number spec timing) is minor and does not change the overall assessment — it is the kind of thing worth a one-line fix whenever the file is next touched, not a reason to hold this batch.
- Outstanding: none blocking. Optional cleanup — reference `WORKSPACE_WATCH_LIMITS.minBatchIntervalMs` in the two spec files that hardcode `250`; carry the facade-split of `WorkspaceFileIndexService` into Batch 17 as already agreed.
