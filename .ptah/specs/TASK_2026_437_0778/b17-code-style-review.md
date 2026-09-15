# Code Style Review — `TASK_2026_437_0778` Batch 17

## Summary

| Metric          | Value                                       |
| --------------- | ------------------------------------------- |
| Overall score   | 8/10                                        |
| Assessment      | APPROVED                                    |
| Blocking issues | 0                                           |
| Serious issues  | 1                                           |
| Minor issues    | 3                                           |
| Files reviewed  | 15 (9 production + 6 spec/CLAUDE.md groups) |

Scope: FU-11b file-index facade split (`folder-index-snapshot.ts`, `folder-index-live-sync.ts`

- spec, `workspace-file-index.service.ts` + spec) and the four Batch 17 governor adopters
  (`code-symbol-indexer.service.ts` + spec, `plugin-activation.ts` + spec, `coalesced-job.ts` +
  spec, `backup.service.ts` + spec, `editor-launcher-detection.ts` + spec), plus
  `code-namespace.builder.ts` (the `userInitiated` caller) and the five touched CLAUDE.md files.
  Read-only; `npx eslint` and `npx prettier --check` run clean except one pre-existing warning
  noted below; no nx/test run performed.

## Five style questions

### 1. What breaks in six months?

A fifth governor-consuming collaborator will very likely write a fifth private
`Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>` alias instead of importing one shared
type, because that is what all four of this batch's adopters did:
`FolderRebuildGovernor` (`folder-index-live-sync.ts:92-95`), `SymbolIndexingGovernor`
(`code-symbol-indexer.service.ts:58-61`), `BackupGovernor` (`backup.service.ts:74-77`),
`UserLayerGovernor` (`plugin-activation.ts:151`) are four textually identical declarations. None
of them is wrong on its own, but nothing points a fifth author at reusing one of them, and a
future change to `whenClear`'s signature (an added option, a renamed field) has to be applied
identically four times with no compiler check that a fifth copy was not missed.

### 2. What would a new team member misread?

`plugin-activation.ts`'s `resolveUserLayerGovernor` (`:154-172`) resolves the governor through
raw `container.isRegistered`/`container.resolve` calls rather than `@inject(...,
{ isOptional: true })`, which is the pattern the other three adopters use. A reader who has just
read `code-symbol-indexer.service.ts`'s constructor could read this as an inconsistency in how
the batch adopted the governor. It is not: `plugin-activation.ts` is a module of free functions
operating on a raw `DependencyContainer`, not a `tsyringe` class, and `resolveAgentSyncGate`
three lines above (`:295-301`, pre-existing) already uses the identical
`isRegistered`-then-`resolve` shape for a different optional dependency. The style difference is
inherited from the file's established idiom, not invented for the governor.

### 3. What does this cost to maintain?

Low, and mostly well-controlled. The FU-11b split delivers what Batch 11's review asked for:
`workspace-file-index.service.ts` is down to 709 raw lines (from 1296) and reads as one story —
folder lifecycle, eviction, queries — with the live-watch mechanism cleanly gone to
`folder-index-live-sync.ts` (535 lines) and the shared snapshot shape to
`folder-index-snapshot.ts` (249 lines). Each of the four governor adopters is a small,
independently-documented addition (a `Pick` type, a lane constant, a wait method) that mirrors
Batch 16's own `internal-query-concurrency-gate.ts` shape closely enough that reading one
teaches you the other three. The recurring cost is the Serious finding above: four near-copies
of one seven-line type alias.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally beyond the Serious finding. `GOVERNED_USER_LAYER_REASONS`
(`plugin-activation.ts:144-146`) and `GOVERNED_BACKGROUND_LANES`
(`internal-query-concurrency-gate.ts:56-59`) look like the same idea under two names, but they
are not the same shape reused twice: one is an allow-list of coalescer _trigger reasons_
(`activation`, `content-download-complete`, …), the other an allow-list of internal-query
_lanes_ (`memory-curator`, `skill-synthesis`). Each is colocated with the mechanism it gates
(the coalescer's `admit` callback vs. the concurrency gate's admission check), each is an
exported `ReadonlySet<string>` with an explicit "add a new one here" doc comment, and each has a
spec asserting the set's exact membership (`plugin-activation.spec.ts:612`,
`internal-query-concurrency-gate.spec.ts:281`). The naming difference (`REASONS` vs. `LANES`)
correctly reflects the domain difference; this is not a defect.

### 5. What would you have done differently?

Add `WhenClearCapableSignal` (or similar) to `vscode-core`'s `background-work-governor.ts`
alongside the existing `BackgroundWorkSignal`, defined once as
`Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>`, exported from `diagnostics/index.ts` and
`src/index.ts` the same way `BackgroundWorkSignal` already is. Then `FolderRebuildGovernor`,
`SymbolIndexingGovernor`, `BackupGovernor` and `UserLayerGovernor` become four local type
aliases of the one shared type (kept for their descriptive, lane-specific names at each call
site) rather than four independent structural definitions. This is a pure, low-risk follow-up —
none of the four files' logic changes — and it closes the drift risk named in question 1 before
a fifth adopter arrives.

## Blocking issues

None.

## Serious issues

### Four independent copies of one `Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>` type

- File: `libs/backend/workspace-intelligence/src/file-indexing/folder-index-live-sync.ts:92-95`
  (`FolderRebuildGovernor`), `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:58-61`
  (`SymbolIndexingGovernor`), `libs/backend/persistence-sqlite/src/lib/backup.service.ts:74-77`
  (`BackupGovernor`), `apps/ptah-electron/src/activation/plugin-activation.ts:151`
  (`UserLayerGovernor`)
- Problem: all four are `Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>`, character for
  character, each declared in a different library. `vscode-core` already exports one shared
  narrow-read type for this exact purpose, `BackgroundWorkSignal` (`isClear` + `onChange`,
  `background-work-governor.ts:103-107`), used by Batch 16's `internal-query-concurrency-gate.ts`
  — but `BackgroundWorkSignal` deliberately omits `whenClear` (the gate manages its own queue and
  timing), so none of this batch's four adopters, which all need `whenClear`, could reuse it as
  written. Nothing analogous exists for the "isClear + whenClear" shape they DO need, so each
  adopter defined its own.
- Tradeoff: today the duplication is inert — four identical seven-line type aliases cost nothing
  to read correctly, each is well-documented at its declaration, and each is proven correct by
  its own governor-behavior spec. The cost is entirely forward-looking: a `whenClear` signature
  change (e.g. a new option field) has no single point of update, and the next adopter (there
  will be one — `whenClear` adopters are explicitly named as a growing list in vscode-core's
  CLAUDE.md) has no existing type to reach for and will most likely write a fifth copy.
- Recommendation: add one exported type alongside `BackgroundWorkSignal` in
  `background-work-governor.ts` (e.g. `WhenClearCapableSignal = Pick<BackgroundWorkGovernor,
'isClear' | 'whenClear'>`), re-export it from `diagnostics/index.ts` and `src/index.ts`, and
  have the four local aliases become `type FolderRebuildGovernor = WhenClearCapableSignal` (etc.)
  rather than independent `Pick`s. Non-blocking: the current code is correct and well-tested: this
  is a low-risk follow-up, not a defect in the batch as delivered.

## Minor issues

- `apps/ptah-electron/src/activation/plugin-activation.ts:1` imports `path` but never calls it —
  `npx eslint` confirms (`'path' is defined but never used`). Pre-existing (confirmed via `git
show HEAD:...` — the import was already dead before this batch's diff), not introduced by
  Batch 17, but the batch's own diff to this file (105 lines added) was an opportunity to remove
  it while already touching the top of the file.
- `libs/backend/platform-core/src/utils/editor-launcher-detection.ts`'s `EditorTargetCache` is
  exported from the public barrel (`src/index.ts:240`) and documented in `CLAUDE.md`, but nothing
  outside this file and its own spec constructs one (`grep -r "EditorTargetCache"` across the
  whole repo returns only the two files that already had it) — no `platform-{cli,electron,vscode}`
  adapter injects a custom cache via `options.cache`; every real caller relies on the default
  process-lifetime cache. That is a defensible extensibility point (the same shape as
  `options.stat` for tests), not a defect, but it is public surface with zero current consumers
  beyond its own test.
- `code-symbol-indexer.service.ts`'s `SymbolIndexingGovernor` and its sibling constants
  (`GOVERNOR_LANE`) sit above the unrelated `CodeSymbolIndexerProgress`/`IndexingStats`
  interfaces (`:58-71`), interleaving the new governor plumbing with the pre-existing progress
  types rather than grouping the governor-related declarations together above the class. Purely
  a readability nit; the code itself is unaffected.

## File-by-file

### `libs/backend/workspace-intelligence/src/file-indexing/folder-index-snapshot.ts` (new)

Score 9/10 — 0/0/0. Exactly what the facade rule asks for: pure data shape plus pure writers
(`toIndexKey`, `addFileEntry`, `addAncestorDirectories`), no I/O, no class. `toIndexKey`'s
normalization (separator, trailing-slash, drive-letter case) is documented with the concrete
walk-vs-watcher spelling mismatch it exists to fix, and is exercised from both
`workspace-file-index.service.ts` and `folder-index-live-sync.ts` without either file
re-implementing it.

### `libs/backend/workspace-intelligence/src/file-indexing/folder-index-live-sync.ts` (new)

Score 9/10 — 0/0/0. `FolderIndexLiveSync` is exactly the collaborator the facade rule
prescribes: it holds no folders of its own, every method takes the `FolderIndex` it acts on, and
every write is generation-gated (`:254`, `:317`, `:394`, `:411/413`). The name passes the
nameability test (not `helpers`/`utils`), and the governed-rebuild logic
(`requestRebuild`/`startRebuildWhenClear`/`runOverflowRebuild`) is a clean, well-commented state
machine consistent with the governed-rebuild shape in `backup.service.ts` and
`internal-query-concurrency-gate.ts`. Constructed inside `WorkspaceFileIndexService`'s
constructor rather than DI-registered — correctly justified in both files' doc comments as "it
is this service's collaborator and nothing else resolves it," the same reasoning the Batch 16
review accepted for the inline `TurnStateForegroundSource` object before that class grew real
logic of its own; here the collaborator already has real logic, but a second DI registration
would only let something else construct a live-watch mechanism for a folder the service does not
own, which nothing needs.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts`

Score 8/10 — 0/0/0 (the type-duplication issue is counted once, under `folder-index-live-sync.ts`
above). Down to 709 lines from the 1296 the Batch 11 delta review flagged; the remaining code is
one coherent story (activation, eviction, queries) with the doc comment's "ROOT MODEL" section
still accurate against the code beneath it. `queryable`/`active` getters, `evictOverflow`'s soft
cap and `teardownEntry`'s generation bump are all unchanged in behavior from Batch 11 and still
match this lib's CLAUDE.md description word for word.

### `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`

Score 8/10 — 0/0/1 (declaration grouping, see Minor). `yieldToForeground` is the same
isClear-first, whenClear-with-signal, AbortError-rethrow shape used by the other three adopters,
and the spec (`code-symbol-indexer.service.spec.ts:284`) directly pins "waits before the first
batch and again before each later one," matching this lib's CLAUDE.md claim exactly.
`userInitiated` bypasses the wait entirely rather than merely raising a priority, which is the
right call for a tool invoked from inside a generating turn.

### `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`

Score 9/10 — 0/0/0. `reindex`'s `{ userInitiated: true }` call (`:186-189`) is the one production
caller for the `ptah.code.reindex` MCP tool, with a one-line comment stating exactly why a
governed run here would deadlock (an agent tool call runs inside the generating turn a governed
wait would be waiting on). Naming matches `CodeSymbolIndexerOptions.userInitiated` exactly — no
second name for the same concept.

### `apps/ptah-electron/src/activation/coalesced-job.ts`

Score 9/10 — 0/0/0. The `admit` gate is optional, fails open on a throwing gate (`admitBatch`'s
catch reports and forces `'run'`), and re-asks when a new reason joins a held batch
(`existing.admission?.abort()` at `:262`) rather than caching a stale verdict — the one property
that makes `GOVERNED_USER_LAYER_REASONS`'s "a non-listed reason releases a held batch at once"
guarantee true. Well isolated from the pre-existing coalescing logic; the diff reads as a clean
addition, not a rewrite.

### `apps/ptah-electron/src/activation/plugin-activation.ts`

Score 7/10 — 0/1/1 (type duplication counted above; dead `path` import counted above, pre-existing
not newly introduced). `GOVERNED_USER_LAYER_REASONS` correctly excludes `activation` and
`harness-propagation` with reasoning that matches this app's own CLAUDE.md
("A user-layer pass whose reasons are ALL in `GOVERNED_USER_LAYER_REASONS`... waits...
`activation` is never deferred, and neither is `harness-propagation`"). `resolveUserLayerGovernor`
correctly follows this file's own pre-existing `resolveAgentSyncGate` idiom rather than the
`@inject` pattern used in class-based adopters (see style question 2) — that is the right call
for a free-function module, not an inconsistency.

### `libs/backend/persistence-sqlite/src/lib/backup.service.ts`

Score 9/10 — 0/0/0. `GOVERNED_KINDS` correctly contains only `'daily'`, with the same
"never governed" reasoning for `pre-migration` (boot path) and `reset` (user click) that this
lib's CLAUDE.md states. `waitForBackgroundClear` runs BEFORE the call joins the serialization
queue (`:272-278`), which is the specific ordering this lib's CLAUDE.md calls out as necessary so
a held `daily` backup never blocks a `pre-migration` backup queued behind it — verified against
the code, not just the doc.

### `libs/backend/platform-core/src/utils/editor-launcher-detection.ts`

Score 8/10 — 0/0/1 (unused-export minor above). `EDITOR_PROBE_CONCURRENCY` bounded fan-out
(`visitWithConcurrency`) and the conclusive/inconclusive distinction in `runProbePass` are
carefully reasoned and directly tested (`editor-launcher-detection.spec.ts:185-205`,
`:282-334`). `EditorTargetCache`'s three-tier caching rule (process cache when no `stat`
injected, `options.cache` when given, none for `cache: null`) is implemented exactly as
documented and matches this lib's CLAUDE.md description almost verbatim.

### CLAUDE.md files (workspace-intelligence, vscode-core, ptah-electron, persistence-sqlite, platform-core)

Score 9/10 — 0/0/0. Every numeric and behavioral claim checked against this batch's code
(governed-kinds set, `EDITOR_PROBE_CONCURRENCY` value, the FU-11b facade split description, the
"whenClear adopters (Batch 17)" list in vscode-core's CLAUDE.md) matches the shipped code
exactly, including the four adopters named by class (`CodeSymbolIndexer`, `FolderIndexLiveSync`,
`SqliteBackupService`, "the Electron user-layer coalescer") rather than by file, which stays
accurate through the FU-11b rename of the file the second one lives in.

## Pattern compliance

| Repository rule or nearby convention                                                             | Status  | Evidence                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FU-11b facade rule: public class keeps name/token/signatures; collaborator is nameable, injected | PASS    | `workspace-file-index.service.ts:218-224` constructs `FolderIndexLiveSync`; class name/DI token/methods unchanged from Batch 11                          |
| No file under ~150 lines created just to satisfy the cap                                         | PASS    | `folder-index-snapshot.ts` 249 lines, `folder-index-live-sync.ts` 535 lines — both substantial, nameable units                                           |
| File size soft ceiling (700 lines)                                                               | PASS    | `workspace-file-index.service.ts` 709 raw lines (well under with eslint's skip-blank/skip-comment counting, per Batch 11 delta's own measurement method) |
| Governor injection style: optional `@inject(..., {isOptional:true})` for classes                 | PASS    | `code-symbol-indexer.service.ts:182-183`, `backup.service.ts:210-211`, `workspace-file-index.service.ts:215-216` (constructing `FolderIndexLiveSync`)    |
| Governor resolution style: `container.resolve` for free-function modules                         | PASS    | `plugin-activation.ts:154-172`, matching the file's own pre-existing `resolveAgentSyncGate`                                                              |
| Shared narrow interface (`BackgroundWorkSignal`) reused where sufficient                         | FAIL    | Four adopters each declare an identical local `Pick<BackgroundWorkGovernor,'isClear'\|'whenClear'>` instead of one shared type (Serious issue)           |
| `userInitiated` naming consistent across the batch and its caller                                | PASS    | `code-symbol-indexer.service.ts:51`, `code-namespace.builder.ts:188`                                                                                     |
| `GOVERNED_*` allow-list pattern (exported `ReadonlySet<string>`, spec pins membership)           | PASS    | `plugin-activation.ts:144-146` + `plugin-activation.spec.ts:612`; consistent with `GOVERNED_BACKGROUND_LANES` (Batch 16)                                 |
| `catch (error: unknown)` with `instanceof Error` narrowing                                       | PASS    | all five production files, spot-checked                                                                                                                  |
| Degradation events use string-literal `code`, not interpolated                                   | PASS    | `backup.service.ts:118-119`, both literals                                                                                                               |
| CLAUDE.md accuracy against shipped code                                                          | PASS    | cross-checked governed-kinds set, probe concurrency, facade description                                                                                  |
| ESLint / Prettier clean on touched files                                                         | PARTIAL | one pre-existing unused-import warning in `plugin-activation.ts` (Minor); Prettier clean on all                                                          |

## Maintenance debt

- Introduced: two new well-scoped files (`folder-index-snapshot.ts`, `folder-index-live-sync.ts`)
  completing the FU-11b split Batch 11 deferred; four small, well-tested governor-wait additions
  across independent libraries; four duplicate type aliases carrying the same shape.
- Retired: the 1172→1296-line single-file version of `WorkspaceFileIndexService` that Batch 11's
  review flagged as a facade-rule candidate.
- Net: positive. The file-size debt named in the last two reviews is closed cleanly; the new debt
  (four duplicate `Pick` aliases) is small, well-contained, and cheap to consolidate later.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the four independent `Pick<BackgroundWorkGovernor, 'isClear' | 'whenClear'>`
  aliases are a real, named drift risk for the next `whenClear` adopter, but every adopter in
  this batch is otherwise correct, consistently shaped, and thoroughly spec'd against fake-clock
  governors — nothing here blocks or needs a second pass.
- What a 10/10 version would do differently: export one shared `WhenClearCapableSignal` type
  from `vscode-core` alongside `BackgroundWorkSignal` and point all four local aliases at it;
  remove the pre-existing dead `path` import in `plugin-activation.ts` while the file was already
  open; group `code-symbol-indexer.service.ts`'s new governor declarations together rather than
  interleaving them with the pre-existing progress types.
