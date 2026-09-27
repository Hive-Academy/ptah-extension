# Batch 25a executor report — Diagnostics contract + language-aware provider (Lane H)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`, branch `fix/task-559-lane-h`, base HEAD
`eec17be89`. No git state was changed (no stage/commit/stash/reset/restore/checkout). Fails-before (FB) runs used
`git show HEAD:<file> > <file>` on a copy, then restored the edited file byte for byte.

## Tasks completed

- Task 25a.1 — contract amendment (`coverage` + `notChecked` on both arms; floor rule governs type-check claims only;
  contract case "syntax-only is not a type-check claim")
- Task 25a.2 — `LanguageAwareDiagnosticsProvider`, wrapped once at `registerTypeScriptDiagnosticsProvider` (name kept)
- Carried criteria (User Decision 23): R5-B1 and R5-M1 — see "R5-B1 / R5-M1 are fixed" below

## Files

- MODIFIED `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts` — `DiagnosticsCoverageFields`
  (`coverage?: LanguageCoverage`, `notChecked?: NotCheckedFiles[]`) on both arms; `NotCheckedFiles`,
  `MAX_NOT_CHECKED_FILES_LISTED` (10); floor-rule amendment in the `DiagnosticsScope` doc
- MODIFIED `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts` — `SyntaxOnlyFixture`,
  `syntaxOnly?` setup hook, pure `syntaxOnlyClaimViolations(result, language?)`, two cases: invariant on any answer, and
  "syntax-only is not a type-check claim" (mkdtemp fixture, broken + clean file, `checks:'syntax-only'`, `analyzed:2`,
  error only on the broken file)
- MODIFIED `libs/backend/platform-core/src/testing/contracts/index.ts`, `.../run-diagnostics-provider-contract.self.spec.ts`
  (syntax-only fake proving the case is satisfiable; 5 negative/positive cases for the violation helper)
- MODIFIED `libs/backend/platform-core/src/index.ts` — barrel: new diagnostics types/constant, `searchRootError`
- CREATED `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
- CREATED `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts` (28 cases,
  real Python/Go/C# grammars + scripted parser; contract run included)
- MODIFIED `libs/backend/workspace-intelligence/src/di/register.ts` — registers
  `LanguageAwareDiagnosticsProvider(new TypeScriptDiagnosticsProvider(fs), fs, TREE_SITTER_PARSER_SERVICE)`
- MODIFIED `libs/backend/workspace-intelligence/src/index.ts` — exports the provider + `SyntaxParser` (25b's e2e drives
  the real provider over a fake inner one; D8)
- R5 fixes: MODIFIED `libs/backend/platform-core/src/utils/bounded-glob-walk.ts` (+ spec),
  `libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts` (+ spec),
  `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts` (+ `electron-file-system.spec.ts`),
  `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.spec.ts` (indexer-level pin)

## Provider behaviour (as built)

- **Scoped.** Requested files are resolved, kept inside the root (`isPathWithinRoots`, as the TS provider) and
  de-duplicated by the Batch 23a identity (`graphPathIdentity`, case-folded on win32). TS/JS/TSX → the inner TS provider
  with only those files (its lanes, cache, `withBudget` untouched). Python/Go/C# (`syntaxDiagnostics`) → in-process
  tree-sitter query `(ERROR)` + `(MISSING)` via `queryMulti`: ≤ 50 files (51+ `omittedByCap`), ≤ 1 MiB (stat and
  re-checked after read → `too-large`), ≤ 20 errors listed + an `info` "more not listed" entry; unreadable → `read`;
  parser start failure → `grammar-unavailable`. Others → `unsupported` (by language) / `unrecognised`; non-source never
  qualifies. `checks`: `type-check` / `syntax-only` / `mixed`; `<id>:syntax-only` approximations via
  `limitApproximations`; `analyzed:null` whenever the type check ran (floor: it may cover more than requested).
  A requested TS file whose check is unavailable makes the whole answer `unavailable` (reason leads with the TS reason,
  then what else was not checked and how many syntax errors the syntax pass found). Nothing checkable → `unavailable`,
  never an empty `available`.
- **Unscoped.** Inner TS provider type-checks as before (called with no scope). No syntax scan. Census: one bounded
  `findFiles` (recognised-extension any-case glob, `DEFAULT_WORKSPACE_EXCLUDES` + the nine vendor globs, limit 50,001),
  cached per root 60 s (LRU 8), single-flight, dropped by `invalidate(root)` / `invalidate()`, never cached when unknown,
  raced against a 10 s budget (discovery keeps running). Syntax-capable files → `unchecked` + "pass `files`";
  other languages → `unsupported`; truncated → `census:'truncated'`, `censusLimit`; discovery failure/timeout →
  `census:'unknown'`, null counts (never clean). No tsconfig → `unavailable` with coverage + notChecked.
- **Tier 0.** Nothing spawned (spec mocks every `child_process` start function and asserts none was called).
- Key order in every answer: `status, source, coverage, notChecked, diagnostics|reason`.

## Fails-before evidence

| Spec | Base | After |
| --- | --- | --- |
| Contract "syntax-only is not a type-check claim" run against the BASE registration (`TypeScriptDiagnosticsProvider`) — temporary probe spec, deleted after | FAIL (`Received: undefined` coverage; answer is "No tsconfig owns…") | PASS against `LanguageAwareDiagnosticsProvider` |
| Edge "unscoped Python → unchecked" (same probe) | FAIL (`coverage` / `notChecked` undefined) | PASS (`unchecked:2`, reason names "pass `files`") |
| Edge "51 files → 1 omittedByCap" (same probe) | FAIL (`omittedByCap` undefined) | PASS |
| Registration case, `register.ts` swapped to HEAD | FAIL (`Expected LanguageAwareDiagnosticsProvider, Received TypeScriptDiagnosticsProvider`) | PASS |
| Walker "a root lost after its first stat" (3 rename patterns + root `opendir` ENOENT), walker swapped to HEAD | 4 FAIL, 1 control PASS | 5 PASS |
| CLI adapter "without maxResults" (missing root, root is a file, root lost during search), adapter swapped to HEAD | 3 FAIL, 1 control PASS | 4 PASS |
| Electron adapter, same cases, adapter swapped to HEAD | 3 FAIL, 1 control PASS | 4 PASS |

The indexer-level spec ("rejects with the search failure … never an empty index") pins the indexer's half (it must
propagate the adapter's rejection); it passes on base as well, because the defect was in the adapters. The real
indexer + real adapters are proven by the r5 probe below.

## R5-B1 / R5-M1 are fixed

**Fix.** One root rule for every `findFiles` path: `searchRootFailure(cwd)` (stat; not a directory → `ENOTDIR`; any
error → its code) in `bounded-glob-walk.ts`.
- R5-B1: both adapters' unlimited (fast-glob) branch now calls `searchRootError(root, [])` before the search and
  `searchRootError(root, matches)` after it (a root lost while fast-glob ran), throwing `IncompleteFileSearchError`.
  `indexWorkspace` (and `getFileCount`, context templates) therefore reject instead of returning a zero-file index.
  A missing literal file under an existing root still answers `[]` (pinned, both adapters, with and without a limit).
- R5-M1: in the bounded walker, ENOENT on opening/reading `cwd` itself is always a root failure; any other ENOENT
  re-checks the root (reported once), so a root renamed after the first stat — including below a static prefix
  (`src/**/*.ts`) or on the literal-path branch — is reported. Descendant ENOENT under a live root stays benign.

**r5 probes, unchanged scripts** (`%TEMP%/task559-23b-r5-callers.cjs`, `%TEMP%/task559-23b-r5-race.cjs`; for the
callers probe a copy that catches the now-rejecting `indexWorkspace`, `task559-25a-r5-callers-caught.cjs`, so the
remaining cases run; logs `%TEMP%/task559-25a-r5-*-before.log` / `-after.log`):

| Probe case (CLI and Electron identical) | Before (base) | After |
| --- | --- | --- |
| adapter, missing root, limit 20 | rejects ENOENT 1 | rejects ENOENT 1 |
| adapter, missing root, **unlimited** | `[]` | rejects `IncompleteFileSearchError` (ENOENT 1) |
| real `indexWorkspace`, missing root | `{files:[],totalFiles:0,totalSize:0}` | rejects `IncompleteFileSearchError` (ENOENT 1) |
| root `opendir` ENOENT after a successful stat → graph | `clean:true, census:'complete'` | `unreadable:{ENOENT:1}` → `clean:false, reasons:['census?'], census:'unknown'` |
| race: root renamed right after its stat → graph (`renamed:true, rootExists:false`) | `clean:true, census:'complete'` | `unreadable:{ENOENT:1}` → `clean:false, reasons:['census?'], census:'unknown'` |

## Stack observed

- Node/TS Nx monorepo; DI via tsyringe (`register.ts` override pattern, `TOKENS.TREE_SITTER_PARSER_SERVICE`
  in `vscode-core/src/di/tokens.ts:77`); boundaries in `eslint.config.mjs:256-400` (platform libs never import WI).
- Parser: `TreeSitterParserService.queryMulti` (`tree-sitter-parser.service.ts:584`) — `(ERROR)`/`(MISSING)` queries
  verified against the shipped WASM grammars (web-tree-sitter 0.27) by a throwaway probe before use.
- Real-grammar Jest shims copied from `ast/csharp-grammar.integration.spec.ts`.

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence
  @ptah-extension/platform-cli @ptah-extension/platform-electron --skip-nx-cache --parallel=2` → 11/12 tasks pass;
  `platform-electron:test` fails only in `workspace-watch-host.stress.spec.ts` (3 tests: AC-7 ×2, ST-2 — the known
  missing stress-bundle flake); 651 passed. All new/changed specs pass.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron @ptah-extension/vscode-lm-tools --skip-nx-cache` → pass
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered"
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300 (new catches marked `degradation-audit: reported`)
- `prettier --check` on every changed file → clean
- `ptah-core-prompt.ts` / `NATIVE_AGENT_TOOL_POLICY` untouched; no tool description edited
- `git status --short`: the 14 modified + 2 new source files above, plus this report (and a pre-existing untracked
  `code-logic-review.md` not written by this batch)

## Plan deviations

1. **Census source.** The plan says "census from the graph build if present, else one bounded discovery". The graph's
   `GraphCoverageReport.languages` keys unsupported files by language (not extension) and folds all but 8 languages
   into `other`, so it cannot separate `.py` (syntax-checkable) from `.pyi` (not) or name a syntax language past the
   top 8. The provider always uses its own bounded discovery (cached per root, dropped by `invalidate`) — documented in
   the provider header.
2. **Discovery location.** `discoverSourceFiles` lives in vscode-lm-tools, which WI cannot import; the provider runs
   the same bounded `findFiles` shape itself and carries a copy of the nine vendor globs (`CENSUS_VENDOR_EXCLUDES`,
   comment names the twin `GRAPH_VENDOR_EXCLUDES`).
3. **TTL + budget on the census** (60 s, 10 s) beyond "cached per root, dropped by invalidate": without them a shell-
   created file is never counted in a long session, and a slow walk would outlast the TS 45 s budget.
4. **Contract shape.** `notChecked` (grouped, ≤ 10 paths/group) added next to `coverage` so the answer says WHICH files
   were not checked and why; both optional, so the VS Code and stub providers stay compliant unchanged.
5. Files outside the batch list touched for R5 (Decision 23): walker, both adapters, their specs, indexer spec, and the
   platform-core barrel.

## Out-of-scope observations (for 25b and later)

- **25a → 25b window:** `core-namespace.builders.ts` does not forward `coverage`/`notChecked` yet (25b). Until 25b
  merges, a scoped request for a syntax-clean Python file renders as a bare "No issues found" (previously "No tsconfig
  owns the requested files"). Recommend merging 25a and 25b in the same window.
- **`compactCoverage` drops `checks`/`approximations` on a clean block** (`{clean:true, analyzed}`): a clean
  syntax-only answer would lose "syntax-only" in its compact form. 25b's formatter must render the check kind next to
  the compact block (or the 22c serializer keep `checks` when it is not `type-check`).
- `GRAPH_VENDOR_EXCLUDES` + `anyCaseExtensionPattern` now exist twice (vscode-lm-tools and this provider); hoisting
  them into WI (e.g. `workspace-default-excludes.ts`) in a batch that owns both files removes the drift risk.
- Unlimited `findFiles` callers (`WorkspaceIndexerService`, `ContextService.applyProjectTemplate`) now reject on a lost
  root; their callers propagate the rejection (no swallowing found), but UI callers of indexing may surface a new error
  message where they used to show an empty index.

## Revision round 1 (review r1)

Source: `reviews/batch-25a-code-logic-review-r1.md`, findings B25A-R1-S1 and B25A-R1-M1. No other behaviour changed;
no existing test was edited or weakened. Files: `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
and its `.spec.ts`.

### B25A-R1-S1 (Serious) - mixed scoped request: type-check rejection observed from the start

- **Change** (`language-aware-diagnostics-provider.ts:527-532`): the type check is still started first (`:519-524`), then
  `const [syntax, typed] = await Promise.all([this.syntaxCheck(checked), typeCheck])` replaces the sequential
  `await syntaxCheck` / `await typeCheck`. Both suboperations get a handler at once; a type-check rejection during the parse
  rejects the call, and a syntax failure no longer leaves a later type-check rejection orphaned (Promise.all keeps a
  handler on every input). A RESOLVED `unavailable` inner result is handled exactly as before (`typed` has the same
  `DiagnosticsResult | undefined` type; the code after it is unchanged).
- **Spec** (`.spec.ts:503-603`, `describe('when the type check rejects')`): the inner provider returns a hand-held
  `WatchedPromise` (a `Promise` subclass recording whether `then` was called).
  1. Type check rejected while the first parse is held open: asserts the call rejects with that error AND the
     promise was already observed while parsing.
  2. Parse rejects first, type check rejects afterwards: asserts the call rejects with the parse error AND the type
     check was observed before its own rejection.
- **Deviation from the brief (process listener)**: a `process.on('unhandledRejection')` listener was written first and
  did NOT fail case 1 against the unfixed code: Jest's sandbox `process` object never receives Node's event (the
  unfixed case-1 run passed; case 2 failed only through Jest's own never-handled-rejection reporting). The listener was
  therefore replaced by the direct precondition Node uses (no handler at rejection time), which is deterministic.
- **FB evidence** (source reverted to sequential awaits, spec unchanged):
  `nx test @ptah-extension/workspace-intelligence --testPathPatterns=language-aware-diagnostics` ->
  `Tests: 2 failed, 31 passed` - both cases `Expected: true, Received: false` (case 2 additionally reported by Jest as the
  unhandled `type-check worker crashed`). With the fix: `Tests: 33 passed, 33 total`.

### B25A-R1-M1 (Moderate) - in-flight census separated from the TTL/LRU cache

- **Change**:
  - `:225-238` `CachedCensus { settledAt, census: Census }` (settled value) and `PendingCensus { census: Promise, stale }`
    replace `CensusEntry { at, census: Promise }`.
  - `:382-390` two maps: `censusCache` (settled, LRU, capped at 8) and `censusInFlight` (at most one walk per root; never
    expired, never evicted; entry removed in `.finally` when the walk settles, `:888-892`).
  - `:866-908` `census()`: in-flight walk first (shared across any number of TTL periods); else a settled census younger
    than 60 s counted from `settledAt` (set at completion, `:884`); else a new walk. An `unknown` census is still never
    cached. `cacheCensus` (`:899-908`) applies LRU eviction to settled values only.
  - `:420-438` `invalidate` semantics (pinned): drops the settled census; a walk still in flight is NOT cancelled and
    stays shared (so an invalidate storm cannot start parallel walks of one root), but it is marked `stale` and its
    result is not cached, so the first call after it settles walks again. `invalidate()` with no root does this for every
    root. Module doc (`:32-35`) updated to "shared while it runs, cached for CENSUS_TTL_MS after it settles".
- **Spec** (`.spec.ts:873-975`, `describe('a discovery still running')`, fake timers for the TTL case):
  1. Three calls at t=0, 60 001, 120 002 with the walk pending -> `findFiles` called once (each answer `census: unknown`
     via the 10 s budget); walk settles -> next call is `complete`; +59 999 ms -> still one walk; +1 ms -> exactly one
     re-walk shared by two concurrent calls (`findFiles` = 2).
  2. Held root pending while 8 other roots settle (cap overflow) -> the held root is not re-walked (9 walks, not 10).
  3. Pending walk, `invalidate(root)`, call again -> joins the same walk (1); after it settles the next call walks
     again (2).
- **FB evidence** (census/invalidate code reverted to the reviewed version, spec unchanged): `Tests: 3 failed, 30 passed` -
  case 1 `Expected 1, Received 3` (the reviewer's 3-walk probe), case 2 `Expected 9, Received 10`, case 3 `Expected 1,
  Received 2` (the old `invalidate` dropped the pending promise, so the next call started a parallel walk). With the fix:
  `Tests: 33 passed, 33 total`.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p platform-core platform-cli platform-electron workspace-intelligence --skip-nx-cache`
  -> header "for 4 projects"; 11 of 12 tasks succeeded; only failed task `@ptah-extension/platform-electron:test`:
  `Test Suites: 1 failed ... Tests: 3 failed, 651 passed` - the single failing suite is the known
  `workspace-watch-host.stress.spec.ts` flake (`dist/apps/ptah-electron/workspace-watch-host.mjs is missing`).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` -> "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` -> "Successfully ran target validate-deps".
- `nx run degradation-audit:lint --skip-nx-cache` -> "degradation-audit: TOTAL 300 unsuppressed site(s)", success.
- No `as any` / `@ts-ignore` added; `catch (error: unknown)` untouched; spec fixtures remain `mkdtemp` roots removed in
  the file-level `afterEach`.

## Revision round 2 (review r2)

Source: `reviews/batch-25a-code-logic-review-r2.md`, finding R2-B1 (Blocking). The only source change is to
`language-aware-diagnostics-provider.ts`. Its spec was extended.

### R2-B1 - a walk overtaken by `invalidate` is never served as current

- **Design chosen: the stale walk answers `census: 'unknown'` (never clean). No fresh walk is started.**
  - Why: a fresh post-invalidate walk would run beside the stale one. A burst of invalidates during a slow walk (the
    watcher-driven `DiagnosticsCacheInvalidator` calls `invalidate` on file changes) would then start a parallel walk
    per invalidate, which reopens M1.
  - With this design each root has one walk at a time, and an answer is never a false clean. The cost is that answers
    say `census?` until a walk completes with no invalidate in between.
- **Change** (`:885-892`): in the pending entry's settle handler, `if (entry.stale) return UNKNOWN_CENSUS;` runs before
  any caching.
  - Every caller of an overtaken walk gets an unknown census. That includes callers that joined after the invalidate
    and callers that were already waiting before it.
  - The result is not stored, and the in-flight entry is still removed in `.finally`.
  - `invalidate` itself is unchanged: it deletes the root's settled census and marks the pending walk stale; with no
    argument it does this for every root.
- **Doc comments** updated: `invalidate` (`:420-431`) and `PendingCensus.stale` (`:235-238`).
- **M1 guarantees kept:** the TTL case (1 walk across 3 retries, TTL counted from settlement, 1 re-walk) and the
  LRU case (pending root not evicted, 9 walks) are unchanged and pass.
- **Pinned invalidate spec updated** (`.spec.ts:954-981`):
  - All previous assertions are kept: one shared walk after invalidate (`findFiles` 1), then a re-walk (`findFiles` 2).
  - Added: both answers from the overtaken walk (`first`, requested before the invalidate, and `joined`, requested
    after it) are `{ clean: false, census: 'unknown' }`. Previously they carried the stale `complete` census.
  - Why the change: serving that census is exactly the R2-B1 false clean.
- **New regression** (`.spec.ts:983-1022`, `it.each` over `root` and `global` invalidate), the reviewer's probe:
  1. Start from a mkdtemp root with `a.ts` and hold the walk. Call invalidate, write `b.py`, call again.
  2. Settle the held walk with the pre-change list `[a.ts]`.
  3. Both answers are `{ clean: false, census: 'unknown' }`, with 1 walk.
  4. The next call walks again (2 walks) and answers `census: 'complete', unchecked: 1, clean: false`.
- **FB evidence** (spec run against the round-1 source, before this fix): `Tests: 3 failed, 32 passed, 35 total`.
  - Pinned case: `census: "complete"` was received where `"unknown"` was expected.
  - Root and global probes: `clean: true, census: "complete"` was received (the false clean).
  - After the fix: the provider spec passes 35/35.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` -> "Successfully ran
  targets test, lint, typecheck". Full suite: `Test Suites: 49 passed, 49 total; Tests: 1 skipped, 1531 passed`.
- `nx run degradation-audit:lint --skip-nx-cache` -> "degradation-audit: TOTAL 300 unsuppressed site(s)".
- No `as any` or `@ts-ignore` was added. The new spec writes only inside its `mkdtemp` fixture root, which the
  file-level `afterEach` removes.

## Bounded correction (review r3)

Source: `reviews/batch-25a-code-logic-review-r3.md`, finding R3-B1 (Blocking). Files changed:
`language-aware-diagnostics-provider.ts` and its `.spec.ts`. Both files were also run through Prettier.

### R3-B1: census validity fence carried to final answer assembly

- **Design: an invalidation generation per root, plus a global one.**
  - Every `invalidate` takes the next number from `invalidations` (`:407`).
  - A root invalidate records that number for the root's identity. A global invalidate records it as
    `globalInvalidatedAt` and clears the per-root map, so the map only holds roots invalidated since the last global
    invalidate.
  - `generationOf(key)` (`:467`) is the larger of the root's number and the global one. It changes whenever an
    invalidate covers that root. Helpers: `invalidate` `:452`, `censusKey` right after `generationOf`.
- **What carries the generation:**
  - A walk records the generation it started under (`PendingCensus.generation`). A settled cache entry keeps the same
    value (`CachedCensus.generation`).
  - `census()` (`:910`) returns `{ census, generation }`.
  - A caller that joins a walk still in flight, from any generation, gets the walk's start generation, not the
    current one. This keeps single flight: there is still one walk per root.
  - `censusWithinBudget` returns `ObtainedCensus { census, generation }` (`:242`).
- **The fence:** `censusValidNow` (`:962`) runs in `getUnscoped` at `:679`, immediately after the only await (the
  `Promise.all` of the type check and the census). If the root's generation has moved on, the census used to build
  the answer is `UNKNOWN_CENSUS`, so the answer is never clean. The coverage then says `census?` and the
  `notChecked` groups built from the census are dropped.
  - Scenario (a), invalidate between acceptance and cleanup: the post-invalidate caller joins the accepted promise
    and still gets the old generation, so the fence trips.
  - Scenario (b), invalidate while the type check is still pending: the fence runs after the type check returns, so
    it trips.
- **Settle-time check** (`:936`): it now compares generations instead of the old `stale` flag, which is removed. A walk
  overtaken by an invalidate is still never cached and returns unknown.
- **Earlier guarantees kept:**
  - S1: `Promise.all` in the scoped path is unchanged.
  - M1: one walk across TTL retries, TTL counted from settlement, pending walks never evicted. All M1 specs pass
    unchanged.
  - R2-B1: the invalidate spec from round 2 and the root/global probes pass unchanged.
  - Continuous invalidation gives a disclosed `unknown` census, which the review accepts.
- **Regression specs** (`.spec.ts:1027-1090`), each run for both `root` and `global` invalidate:
  - Scenario (a): for each of 0 to 6 microtask turns after releasing the held walk, the test adds `new.py`,
    invalidates and calls again. It asserts the post-invalidate answer is `clean: false`, and if the census is not
    unknown (a new walk ran), that `unchecked: 1`.
  - Scenario (b): the type check is held, the walk settles (one `setImmediate`), then `new.py` is added, then
    invalidate, then the type check resolves. It asserts `{ clean: false, census: 'unknown' }`.
- **FB evidence** (new specs run against the round-2 source): `Tests: 4 failed, 35 passed, 39 total`.
  - Scenario (a), root and global: failed at `turns: 4` with `clean: true`. That is the window in this harness; the
    reviewer saw it at two turns with a plain `findFiles`, and the extra turns here come from the async `jest.fn`
    wrapper.
  - Scenario (b), root and global: received `census: "complete", clean: true`.
  - With the fix: `Tests: 39 passed, 39 total`.

### Verification (worktree root)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: "Successfully ran
  targets test, lint, typecheck".
- `nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)".
- No `as any` or `@ts-ignore` was added. The new specs write only inside `mkdtemp` fixture roots, which the file-level
  `afterEach` removes.
