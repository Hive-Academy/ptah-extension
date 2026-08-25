# Test Report — TASK_2026_299 (Batches 5/6/7 — spec deliverables + verification)

## Scope of this pass

This report covers the two missing spec deliverables (Task 5.3, Task 6.5), the
Batch 7 verification matrix, and a best-effort headless manual exercise
(Task 7.3). It also incorporates the Batch 8 `code-logic-review.md` findings,
which landed mid-session: per explicit coordinator instruction, the specs
below encode the **correct** behavior per `context.md`/`tasks.md`, not the
current (defective) behavior, for the three confirmed defects. Three test
cases are therefore **deliberately failing (EXPECTED RED)** — this is
intended, not a mistake, and the production source was **not** touched by
this pass.

No production code was modified. Diff is spec-file-only (verified via
`git status --porcelain`):

```
M  libs/backend/platform-vscode/src/implementations/vscode-diagnostics.spec.ts
M  libs/backend/platform-vscode/src/implementations/vscode-file-system.spec.ts
M  libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts
?? apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts
?? libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts
?? libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts
```

---

## Job 1 — Task 5.3: `TypeScriptDiagnosticsProvider` spec — PASS (with 2 intentional RED cases)

**File created**: `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`

Approach: the SUT reads tsconfig content and source files via `require('fs')`
/ `ts.sys` directly (not through the injected `IFileSystemProvider`), so an
in-memory mock filesystem cannot back real TS compilation. Real on-disk
fixtures are written to the OS temp dir per test (`fs.mkdtempSync`) and
removed in `afterEach`. Only tsconfig _discovery_ is mocked
(`IFileSystemProvider.findFiles` returns the exact paths each fixture wrote).

All 10 required cases from the brief are covered, plus the shared
`runDiagnosticsProviderContract` harness (no-root path):

| Case                                                                                          | Result                                          |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Clean project → available, `[]`                                                               | PASS                                            |
| Error project → available, correct file/line/severity/code (`2322`)                           | PASS                                            |
| Project references traversed once, deduped, no cycle hang                                     | **EXPECTED RED** — see Batch 8 finding #1 below |
| Malformed tsconfig → unavailable, no throw                                                    | PASS                                            |
| No tsconfig under root → unavailable, reason `"No tsconfig.json found under workspace root."` | PASS                                            |
| No workspace root (`undefined` and `''`) → unavailable, `findFiles` never called              | PASS (`it.each`)                                |
| Dedup: same diagnostic via two discovered tsconfigs → appears once                            | PASS                                            |
| Workspace switch: two sequential calls, different roots, no caching                           | PASS                                            |
| Windows paths: backslash temp dir → forward-slash-normalized `file` output                    | PASS                                            |
| Root filtering: diagnostic from file outside root excluded                                    | PASS                                            |
| Zero programs + zero errors → unavailable (not a false "clean")                               | **EXPECTED RED** — see Batch 8 finding #2 below |

Run: `npx nx test workspace-intelligence --testPathPattern="type-script-diagnostics-provider"` → **2 failed, 18 passed, 20 total** (this file only); full-suite run in the Job 3 matrix below confirms no other file regressed.

### EXPECTED RED — Batch 8 finding #1 (dead traversal code)

- **Spec**: `TypeScriptDiagnosticsProvider › EXPECTED RED (Batch 8 finding #1) — solution-style root traverses referenced child projects once and collects their diagnostics`
- **File**: `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts:~150-186`
- **Root cause** (`type-script-diagnostics-provider.ts:129`): `if (rootFileNames.length === 0) return;` fires **before** `program.getProjectReferences()` traversal (line ~148) is ever reached. A solution-style root tsconfig (`"files": []`, `"include": []`, `"references": [...]`) — the dominant shape in this monorepo, e.g. `libs/backend/workspace-intelligence/tsconfig.json` — never traverses its referenced children.
- **Output excerpt**:
  ```
  expect(childEntry).toBeDefined()
  Received: undefined
  ```
- **Fix owner**: backend-developer, next step per coordinator. Do not weaken this assertion.

### EXPECTED RED — Batch 8 finding #2 (false "clean")

- **Spec**: `TypeScriptDiagnosticsProvider › EXPECTED RED (Batch 8 finding #2) — configs discovered but zero programs built and zero errors -> unavailable, not a false clean`
- **File**: `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts:~188-207`
- **Root cause** (`type-script-diagnostics-provider.ts:167`): guard is `if (visitedPrograms.size === 0 && errors.length > 0)`. When a config is discovered but `collectFromConfig` returns early with an empty `rootFileNames` (no error pushed), both `visitedPrograms.size === 0` and `errors.length === 0` — the guard doesn't fire, and execution falls through to `{ status: 'available', diagnostics: [] }`, which the formatter renders as "No issues found." This is the single worst outcome the whole task exists to prevent (an honest-unavailable contract regressing into a silent false-clean one layer deeper).
- **Output excerpt**:
  ```
  expect(result.status).toBe('unavailable')
  Expected: "unavailable"
  Received: "available"
  ```
- **Fix owner**: backend-developer, next step per coordinator. Do not weaken this assertion.

---

## Job 2 — Task 6.5: DI-override specs — PASS

Checked first: `platform-electron/src/implementations/electron-diagnostics.spec.ts` and
`platform-cli/src/implementations/cli-diagnostics-provider.spec.ts` **already**
cover the Phase 0 placeholder returning `{ status: 'unavailable', source:
'electron-phase0' | 'cli-phase0', reason }` end-to-end via
`runDiagnosticsProviderContract` plus dedicated assertions — not duplicated.

**Files created**:

- `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`
- `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts`

**Why not import `registerPhase2Libraries` / `CliDIContainer.setup()` directly**: confirmed empirically that both are too heavy to bootstrap in Jest.

- `require('apps/ptah-electron/src/di/phase-2-libraries')` alone **throws** at module-evaluation time (transitively pulls `persistence-sqlite`/better-sqlite3, `memory-curator`, `messaging-gateway`, `voice-providers`, etc. — none load cleanly under Jest). Verified with a throwaway import-check spec, then deleted.
- `CliDIContainer.setup()` is a single ~600-line static method with the same transitive weight; the repo's own `with-engine.spec.ts` already documents mocking the bootstrap "so tests do not pay the real container cost" rather than calling it for real — this spec follows that exact precedent (also followed by the pre-existing `container.smoke.spec.ts`, which hand-builds a minimal container rather than calling `registerPhase2Libraries`/`registerPhase4Handlers` end-to-end).

**Approach taken** (both specs): call the REAL, exported `registerWorkspaceIntelligenceServices(container, logger)` against a minimal child container (its only two preconditions per `workspace-intelligence/src/di/register.ts:67-78` are `TOKENS.LOGGER` and `TOKENS.FILE_SYSTEM_MANAGER`), then execute the override lines **mirrored verbatim** from `phase-2-libraries.ts:170-178` / `container.ts:528-536`. A DRIFT CAVEAT is documented in both files' header comments: because the override is mirrored rather than imported, these specs cannot detect a future edit to the override snippet without a matching manual update.

**Assertions, both files**:

1. Before the override: `container.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)` is the Phase 0 placeholder (`ElectronDiagnosticsProvider` / `CliDiagnosticsProvider`), not `TypeScriptDiagnosticsProvider`.
2. After `registerWorkspaceIntelligenceServices` + the mirrored override: resolves to `TypeScriptDiagnosticsProvider`, `not.toBeInstanceOf` the placeholder class, `not.toBe` the original placeholder instance, and `toBe` the exact constructed `tsDiagsProvider`.

Run: `npx nx test ptah-electron --testPathPattern="phase-2-diagnostics-override"` → 2/2 passed (full electron suite: 255 passed, 4 skipped, 0 failed, 259 total).
Run: `npx nx test cli-engine --testPathPattern="container-diagnostics-override"` → 2/2 passed (full cli-engine suite: 145 passed, 0 failed, 145 total).

### Bonus coverage added (non-blocking, per coordinator's note)

The Batch 8 review flagged two additional gaps. Investigated and handled:

- **`VscodeDiagnosticsProvider` (review's "Serious Issue 5")**: the review's claim of **zero** coverage is a **false positive** — `libs/backend/platform-vscode/src/implementations/vscode-diagnostics.spec.ts` already exists and runs the shared contract plus 4 behavioural cases (the reviewer searched for `vscode-diagnostics-provider.spec.ts`, but the actual filename is `vscode-diagnostics.spec.ts`). The **real** gap inside that file was root-filtering — untested. Added 3 cases: filters to files within `workspaceRoot`, returns everything unfiltered when no root is given, and preserves zero-based line numbers. All PASS (platform-vscode suite: 183 total, 180 passed, 3 todo, 0 failed).
- **`VscodeFileSystemProvider.findFiles` cwd/RelativePattern (Task 2.5 / review's "Moderate Issue 10")**: genuinely untested. Added 3 cases to `vscode-file-system.spec.ts`: wraps in `vscode.RelativePattern(cwd, pattern)` when `cwd` given, passes the bare glob string when `cwd` is undefined, and returns absolute `fsPath` values regardless. All PASS.

### EXPECTED RED — Batch 8 finding #3 (`getRelevantFiles` swallows `{ success: false }`)

Added to the existing spec rather than a new file, next to the sibling
thrown-error case it complements.

- **Spec**: `buildSearchNamespace › EXPECTED RED (Batch 8 finding #3) — getRelevantFiles() rejects when contextOrchestration resolves { success: false } (does NOT swallow to [])`
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts:~407-427`
- **Root cause** (`core-namespace.builders.ts:162`): `(result.files || [])...` reads `result.files` unconditionally without checking `result.success`. A **resolved** `{ success: false, error }` (as opposed to a thrown/rejected failure — already correctly covered by the adjacent test) silently degrades to `[]`. context.md explicitly requires propagating both "thrown and `{ success: false }` failures."
- **Output excerpt**:
  ```
  expect(received).rejects.toThrow()
  Received promise resolved instead of rejected
  Resolved to value: []
  ```
- **Fix owner**: backend-developer, next step per coordinator. Do not weaken this assertion.

---

## Job 3 — Batch 7 verification matrix

### 1. Typecheck — PASS (9/9)

```
npx nx run-many -t typecheck -p platform-core,platform-vscode,platform-electron,platform-cli,workspace-intelligence,vscode-lm-tools,cli-engine,ptah-electron,ptah-cli
```

Result: **Successfully ran target typecheck for 9 projects.** No errors.

### 2. Jest — PASS except the 3 EXPECTED RED cases above (no unexpected failures)

```
npx nx run-many -t test -p platform-core,platform-vscode,platform-electron,platform-cli,workspace-intelligence,vscode-lm-tools,cli-engine
```

| Project                | Suites                  | Tests                  | Failed                      | Notes                                                 |
| ---------------------- | ----------------------- | ---------------------- | --------------------------- | ----------------------------------------------------- |
| platform-core          | 29 passed               | 522 (518 pass, 4 todo) | 0                           |                                                       |
| platform-cli           | 12 passed               | 200 (197 pass, 3 todo) | 0                           |                                                       |
| platform-electron      | 15 passed               | 245 (242 pass, 3 todo) | 0                           |                                                       |
| cli-engine             | 15 passed               | 145 pass               | 0                           | includes new `container-diagnostics-override.spec.ts` |
| platform-vscode        | 16 passed               | 183 (180 pass, 3 todo) | 0                           | includes 6 new bonus cases                            |
| vscode-lm-tools        | 41 passed, **1 failed** | 816 (815 pass)         | **1 (EXPECTED RED #3)**     | `core-namespace.builders.spec.ts`                     |
| workspace-intelligence | 35 passed, **1 failed** | 886 (884 pass)         | **2 (EXPECTED RED #1, #2)** | `type-script-diagnostics-provider.spec.ts`            |

Additionally (outside the literal Job 3 command list, since the new Electron
spec lives under the app, not a lib): `npx nx test ptah-electron
--testPathPattern="phase-2-diagnostics-override"` → full suite 255 passed, 4
skipped, **0 failed**, 259 total.

**Zero unexpected failures across the entire matrix.** Every red test is one
of the 3 documented EXPECTED RED cases.

### 3. Builds — PASS, `typescript` confirmed external + shipped dependency

```
npx nx build ptah-electron
```

Result: **Successfully ran target build.** Verified:

- `apps/ptah-electron/project.json:88` — `"typescript"` present in the `external` array.
- `apps/ptah-electron/package.json:48` — `"typescript": "^5.9.0"` in `dependencies`.
- `dist/apps/ptah-electron/package.json` generated `dependencies.typescript === "^5.9.0"`.

```
npx nx build ptah-cli
```

Result: **Successfully ran target build.** Verified:

- `apps/ptah-cli/project.json:71` — `"typescript"` present in the `external` array.
- `apps/ptah-cli/package.json:80` — `"typescript": "^5.9.0"` in `dependencies`.
- `dist/apps/ptah-cli/package.json` generated `dependencies.typescript === "^5.9.0"`.

Both builds show pre-existing, unrelated `"import.meta" is not available with
the "cjs" output format` warnings from `workspace-intelligence/src/ast/wasm-bundle-dir.ts`
— not caused by this task, not fatal (build succeeds), not investigated
further (out of scope).

---

## Job 4 — Task 7.3: manual exercise (best effort, headless)

A live MCP tool call requires a running agent session inside VS Code,
Electron, or a CLI JSON-RPC session — none of which can be launched headlessly
by this subagent (GUI launch is out of scope; CLI agent delegation is
explicitly disabled for this task). As a substitute, I wrote a throwaway
`ts-node` script that imports and calls the **real, unmodified production
functions** (`buildSearchNamespace` from `core-namespace.builders.ts` and
`TypeScriptDiagnosticsProvider`) directly — not through Jest, not through
mocks beyond the one filesystem-discovery seam that also isn't mocked in
production (VS Code's own `IFileSystemProvider.findFiles` implementation) —
against real on-disk fixtures and a real recursive-walk + `picomatch` glob
(the same library `workspace-intelligence` itself depends on). The script and
its `vscode`-shim register hook were deleted after use; nothing was committed.

### `ptah_search_files` (via real `buildSearchNamespace`)

| Case                                                    | Result                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**/*diagnostic*.ts` under `workspace-intelligence/src` | Real matches: `diagnostics/type-script-diagnostics-provider.spec.ts`, `diagnostics/type-script-diagnostics-provider.ts`                                                                                                                                                                                                       |
| No-match glob `**/nonexistent-xyz-*.ts`                 | `[]` (0 files) — success, not error                                                                                                                                                                                                                                                                                           |
| `fileSystemProvider.findFiles` throws                   | Error propagated as a thrown rejection (`"simulated filesystem error"`) — confirmed NOT swallowed to `[]`; would surface as `isError: true` at the dispatcher's existing outer catch (verified by inspection: `protocol-dispatcher.ts` wraps every case, per `code-logic-review.md`'s independently-traced data-flow diagram) |

### `ptah_get_diagnostics` (via real `TypeScriptDiagnosticsProvider`)

| Case                                           | Result                                                                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean fixture                                  | `{"status":"available","source":"typescript-compiler","diagnostics":[]}`                                                                                                                                                    |
| Broken fixture (`const bad: number = "nope";`) | `{"status":"available","source":"typescript-compiler","diagnostics":[{"file":".../src/index.ts","diagnostics":[{"message":"Type 'string' is not assignable to type 'number'.","line":0,"severity":"error","code":2322}]}]}` |
| Directory with no tsconfig                     | `{"status":"unavailable","source":"typescript-compiler","reason":"No tsconfig.json found under workspace root."}` — explicit reason, NOT "No issues found."                                                                 |

### Explicitly NOT exercised (stating this rather than claiming pass)

- **VS Code's `vscode-languages` source** — requires a live extension host with the language server populated; there is no headless way to get `vscode.languages.getDiagnostics()` to return real data outside a running VS Code instance. Covered instead by `vscode-diagnostics.spec.ts`'s unit specs (mocked `vscode` module), including the root-filtering cases added in this pass.
- **The full MCP wire round-trip** — `protocol-dispatcher.ts`'s `ptah_search_files` / `ptah_get_diagnostics` cases and `formatDiagnostics`'s exact rendered strings (`"Found: N files"`, `"No issues found."`) were not independently re-verified by this manual exercise; they're covered by the existing dispatcher/formatter unit specs (Batch 3), which this pass did not re-run in isolation beyond the full-suite run in Job 3.
- **A genuine live agent/session invocation** of the tools as an LLM would call them (through the Code Execution MCP server) — would require launching Electron or a CLI agent session, both out of scope per this task's constraints.

---

## Summary

| Job                           | Status                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Task 5.3 spec              | PASS — 10/10 required cases present; 2 intentionally RED (Batch 8 #1, #2)                                                                                                                                   |
| 2. Task 6.5 DI-override specs | PASS — both hosts proven; 1 bonus case intentionally RED (Batch 8 #3); 6 bonus non-blocking cases added (VscodeDiagnosticsProvider root filtering, VscodeFileSystemProvider cwd/RelativePattern), all green |
| 3. Verification matrix        | PASS — typecheck 9/9, builds 2/2 with `typescript` external+shipped confirmed, Jest all green except the 3 documented EXPECTED RED                                                                          |
| 4. Manual exercise            | Best-effort PASS via real production functions outside Jest; VS Code source path and full MCP wire round-trip explicitly not exercisable headlessly (stated, not claimed)                                   |

No production code was changed by this pass. The 3 EXPECTED RED specs are the
red baseline for the next backend-developer fix pass per the coordinator's
explicit instruction; do not soften them to green without fixing the
underlying source defects in `type-script-diagnostics-provider.ts` (findings
#1, #2) and `core-namespace.builders.ts` (finding #3).

VERDICT: PASS — all four jobs complete; 3 tests are intentionally RED (documented, expected, not regressions) and 0 tests are unexpectedly failing.
