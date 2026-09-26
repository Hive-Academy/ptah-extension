# Batch 20 Tasks 20.1 & 20.3 Executor Report — Lane D (Evals First)

## Scope & Implementation Overview

Implemented Batch 20 Tasks 20.1 and 20.3 for TASK_2026_559_8ca9 (Lane D, "evals first") in worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-d` on branch `fix/task-559-lane-d`:
- **Task 20.1**: Generated fixture workspace builder (`fixture-workspace.ts`) and verification spec (`fixture-workspace.spec.ts`) in `@ptah-extension/workspace-intelligence`.
- **Task 20.3**: Comprehensive reducer benchmark (`reducers.bench.spec.ts`) in `@ptah-extension/tool-output-reducers` table-driven across all 5 content kinds under the default tool result budget (2000 tokens / 8000 chars), asserting size ceilings (tokens and pinned reduction ratio with date 2026-09-26) and preserved content.

---

## 1. Files Created

1. `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts`
   - Exports `createMcpContractFixture(options?: McpContractFixtureOptions): McpContractFixture`.
   - Returns `{ root, knownSymbols, knownEdges, cleanup }`.
2. `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts`
   - Tests fixture determinism across two independent builds, matching of `knownSymbols` and `knownEdges` against files on disk, and root cleanup.
3. `libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts`
   - Reducer benchmark suite with table-driven tests over all content kinds (`html`, `json`, `log`, `code` via outliner, `code` via fallback, `markdown`).
   - Self-contained fixtures generated inside the spec (`type:util` compliant, no imports from `workspace-intelligence`).

No existing files were modified (deliberate break changes were fully reverted; `git diff --stat` is clean).

---

## 2. Task 20.1: Fixture Workspace Summary

### Monorepo Structure Generated at Test Time
- **Root configuration**:
  - `nx.json`: declared `npmScope: 'mcp-contract-fixture'` with apps/libs layout.
  - `package.json`: mixed root dependencies (`react: '^18.3.1'` and `'@angular/core': '^18.2.0'`) and devDependencies (`nx`, `typescript`).
  - `tsconfig.base.json`: compiler configuration with path aliases.
  - **No root `angular.json`**: explicitly omitted to verify monorepo project type detection.
- **Projects with their own `project.json`**:
  - `apps/web-app/project.json`: `@angular-devkit/build-angular:application`
  - `apps/react-client/project.json`: `@nx/vite:build` (plus `apps/react-client/package.json` with React dependency)
  - `apps/api-service/project.json`: `@nx/js:node`
  - `libs/shared-core/project.json`: `@nx/js:tsc`
- **500-file flat directory**:
  - `flat-directory/flat-entry-000.ts` through `flat-directory/flat-entry-499.ts` (500 files total).
- **TS/TSX sources with known exported symbols, import edges, and camelCase identifiers**:
  - `libs/shared-core/src/token-utils.ts`: `generateSecureToken`, `parseBearerToken`, `defaultTokenEntropyBits`
  - `libs/shared-core/src/auth-session.ts`: `SessionUserCredentials`, `AuthSessionService`, `verifySessionValidity`, `defaultSessionTimeoutMs`
  - `apps/react-client/src/navigation-bar.tsx` (TSX): `NavigationBarProps`, `NavigationBarWidget`, `NavigationStateManager`
  - `apps/react-client/src/client-layout.tsx` (TSX): `ClientAppLayoutView`
  - `apps/web-app/src/main-controller.ts`: `MainWebController`, `initializeApplicationHost`
  - `apps/api-service/src/data-processor.service.ts`: `MetricRecordData`, `ProcessingBatchSummary`, `PipelineConfigurationOptions`, `BatchMetricPipelineManager`, `computeAverageMetricScore`, `formatProcessingStatusMessage`, `validatePayloadIntegrity`, `defaultPipelineConfig`.
- **Exactly 300-line TS file**:
  - `apps/api-service/src/data-processor.service.ts` has exactly 300 lines (`lines.length === 300`).
- **Seeded determinism**:
  - Uses a pure Mulberry32 PRNG seeded deterministically (`seed = 20260926`). No `Math.random()` or `Date.now()`.
- **Cleanup**:
  - `cleanup()` removes the temporary directory (`fs.rmSync(root, { recursive: true, force: true })`).
- **Build / barrel exclusion inspection**:
  - `libs/backend/workspace-intelligence/src/index.ts` does NOT export anything under `src/testing`.
  - Inspection of `libs/backend/workspace-intelligence/tsconfig.lib.json` found that it currently specifies `"exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"]`. Unlike `libs/backend/platform-core/tsconfig.lib.json` (which explicitly specifies `"src/testing/**/*"` in exclude), `workspace-intelligence` does not yet explicitly exclude `src/testing/**/*`. Because the testing code is not exported from the barrel, production consumers cannot reach it.

---

## 3. Task 20.3: Reducer Benchmark Measurements and Pinned Ratios

Measured at HEAD on 2026-09-26 at the default tool budget (`budgetTokens: 2000`, `budgetChars: 8000`):

| Content Kind | Input Description | Raw Tokens | Returned Tokens | Measured Ratio | Pinned Ratio (+Headroom) | Budget Check (≤ 2000) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **HTML** | Nav + Article + Footer (~200 KB) | 75,442 | 391 | 0.0052 | **0.0060** (+15%) | ✅ 391 ≤ 2000 |
| **JSON** | Pretty JSON (300 objects) | 11,402 | 1,815 | 0.1592 | **0.1760** (+10.5%) | ✅ 1,815 ≤ 2000 |
| **Log** | Jest log (~5,000 lines, 3 failures) | 78,945 | 1,876 | 0.0238 | **0.0270** (+13%) | ✅ 1,876 ≤ 2000 |
| **Code (outliner)** | 300-line TS via fake outliner | 3,356 | 596 | 0.1776 | **0.1980** (+11.5%) | ✅ 596 ≤ 2000 |
| **Code (fallback)** | 300-line TS via no-outliner fallback | 3,356 | 1,833 | 0.5462 | **0.6050** (+10.8%) | ✅ 1,833 ≤ 2000 |
| **Markdown** | 30-section Markdown doc | 3,606 | 1,677 | 0.4651 | **0.5150** (+10.7%) | ✅ 1,677 ≤ 2000 |

All returned tokens are strictly within the default 2000 token budget, and all ratios satisfy the pinned ceilings.

---

## 4. Preserved-Content Assertions Per Kind

The benchmark verifies preserved semantic content for every kind:
- **HTML**:
  - All 4 article headings (`Understanding Token Budgets`, `Why Budgets Matter in Coding Orchestras`, `Measuring Tokens Piecewise`, `Reducing Output Deterministically`) and all 4 article paragraphs are preserved verbatim.
  - Page chrome and boilerplate (`<nav>`, `<footer>`, JSON-LD, scripts, styles) are stripped.
- **JSON**:
  - Every non-empty scalar in all 300 kept rows (`id: 1..300`, `s: s1..s300`) is present in the rendered pipe table.
  - Empty fields (`emptyNote: null`, `blankDetail: ''`, `emptyTags: []`) are completely pruned.
- **Log**:
  - All 3 failure blocks with context lines (`[setup-context]`, `FAIL ...`, `● ...`, `AssertionError ...`, `at ...`, `[teardown-context]`) and the summary line (`Test Suites: 3 failed, 497 passed, 500 total`) are preserved.
- **Code (outliner)**:
  - Focus symbol declaration header and complete body (`const scaledMultiplier = inputValue * 42;`, `const normalizedMetricResult = scaledMultiplier + 100;`, `return normalizedMetricResult;`) are preserved verbatim.
  - Auxiliary function bodies are replaced by omission markers.
- **Code (no-outliner fallback)**:
  - Falls back to `log-reduced`, preserving the head region containing the focus symbol declaration and body.
- **Markdown**:
  - All 31 headings (document title + 30 section headings `## Section 1: Architecture Domain Pillar 1` through `## Section 30: Architecture Domain Pillar 30`) are preserved in document order.

---

## 5. Deliberate-Break Regression Proof

### Break 1: Reducer Benchmark (`log.reducer.ts`)
- **Change introduced**:
  - In `libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`, set `const ERROR_CONTEXT = 0;` (line 46) and commented out `selection.growRegions();` (line 241) to drop context lines around failures.
- **Failing assertion output**:
  ```
  FAIL tool-output-reducers libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
  ● Reducers Benchmark (TASK_2026_559 Batch 20 Task 20.3) › Log reducer › reduces 5,000-line log below budget and pinned ratio while preserving all 3 failure blocks and summary line

    expect(received).toContain(expected) // indexOf

    Expected substring: "[setup-context] preparing user token authentication request"
    at Object.<anonymous> (src/lib/reducers.bench.spec.ts:489:31)

  ● Reducers Benchmark (TASK_2026_559 Batch 20 Task 20.3) › Table-driven sweep over all kinds › Jest log (~5,000 lines, 3 failures) satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content

    expect(received).toContain(expected) // indexOf

    Expected substring: "[setup-context] preparing user token authentication request"
    at assertContent (src/lib/reducers.bench.spec.ts:623:32)
    at src/lib/reducers.bench.spec.ts:706:9
  ```
- **Restoration**: Restored `ERROR_CONTEXT = 3` and `selection.growRegions();`.
- **Restoration proof**: `git diff --stat` showed 0 changes to `log.reducer.ts`. Suite returned to green.

### Break 2: Fixture Workspace (`fixture-workspace.ts`)
- **Change introduced**:
  - In `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts`, set `const targetLines = 280;` instead of `300`.
- **Failing assertion output**:
  ```
  FAIL workspace-intelligence libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts
  ● createMcpContractFixture › creates an Nx-shaped monorepo with mixed root deps, no angular.json, 500-file directory, and 300-line TS file

    expect(received).toBe(expected) // Object.is equality

    Expected: 300
    Received: 280

      at Object.<anonymous> (src/testing/mcp-contract/fixture-workspace.spec.ts:67:28)
  ```
- **Restoration**: Restored `targetLines = 300;`. Suite returned to green (4 passed).

---

## 6. Execution Times

- `libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts`: **2.34 s** (well under the 10 s ceiling)
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts`: **2.19 s** (500 files written, verified, cleaned up)

---

## 7. Verification Evidence

1. **Test, Lint, Typecheck**:
   ```
   node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers --skip-nx-cache
   ```
   Output:
   ```
   √ nx run @ptah-extension/workspace-intelligence:typecheck
   √ nx run @ptah-extension/workspace-intelligence:lint
   √ nx run @ptah-extension/tool-output-reducers:test
   √ nx run @ptah-extension/workspace-intelligence:test
   √ nx run @ptah-extension/tool-output-reducers:lint
   √ nx run @ptah-extension/tool-output-reducers:typecheck

   NX Successfully ran targets test, lint, typecheck for 2 projects
   ```
2. **Degradation Audit**:
   ```
   node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache
   ```
   Output:
   ```
   degradation-audit: TOTAL 300 unsuppressed site(s)
   NX Successfully ran target lint for project degradation-audit
   ```
3. **Electron Dependency Validation**:
   ```
   node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache
   ```
   Output:
   ```
   ✅ All external imports are covered by package.json dependencies.
   NX Successfully ran target validate-deps for project ptah-electron and 1 task it depends on
   ```
4. **Prettier Check**:
   ```
   npx prettier --check libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts
   ```
   Output:
   ```
   Checking formatting...
   All matched files use Prettier code style!
   ```
5. **Git Status**:
   ```
   git status --short
   ?? libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
   ?? libs/backend/workspace-intelligence/src/testing/
   ```

---

## 8. Deviations

None.

---

## 9. Revision Round 1 (r1 REVISE 7/10)

Addressed cross-side code logic review findings from `.ptah/specs/TASK_2026_559_8ca9/reviews/batch-20a-code-logic-review-r1.md`:

### 1. Dynamic Symbol Line Number Computation (Serious Issue)
- **Problem**: In files with leading import statements (`auth-session.ts`, `client-layout.tsx`, `main-controller.ts`), `KnownSymbol.line` values were hardcoded and off-by-2 because the leading import statements and empty separator lines were not counted.
- **Fix**: Derived all symbol line numbers dynamically from array lengths (`line: lines.length + 1`) at generation time across `token-utils.ts`, `auth-session.ts`, `navigation-bar.tsx`, `client-layout.tsx`, and `main-controller.ts`.
- **Pre-Fix Failure Capture**: Added exact-line verification in `fixture-workspace.spec.ts` (`expect(fileContent.split('\n')[sym.line - 1]).toContain(sym.name)`). Running against the old fixture produced the exact reported failure:
  ```
  FAIL workspace-intelligence libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts
  ● createMcpContractFixture › matches knownSymbols and knownEdges with the files written to disk

    expect(received).toContain(expected) // indexOf

    Expected substring: "SessionUserCredentials"
    Received string: "import { generateSecureToken, defaultTokenEntropyBits } from './token-utils';"

      144 |         const declarationLine = lines[(sym.line as number) - 1];
      145 |         expect(declarationLine).toBeDefined();
    > 146 |         expect(declarationLine).toContain(sym.name);
  ```
- **Post-Fix Verification**: With dynamic line generation, all symbols in all files match their declaration line exactly.

### 2. Seeded PRNG Wired into Flat Directory (Moderate Issue)
- **Problem**: `seed` parameter in `createMcpContractFixture` was dead code (`createSeededRng(seed)` was called but its returned generator was unused).
- **Fix**: Wired `const rng = createSeededRng(seed);` into the 500 flat-directory file generator, producing pseudorandom values:
  ```typescript
  const randVal = Math.floor(rng() * 1_000_000);
  const flatCode = [
    `export const flatConstantValue${padded} = "item-payload-${padded}-${randVal}";`,
    `export function getFlatItemNumber${padded}(): number {`,
    `  return ${randVal};`,
    `}`,
    '',
  ].join('\n');
  ```
- **Verification**: Added `it('proves seed sensitivity: different seeds produce different contents in flat directory files')` to `fixture-workspace.spec.ts`. Confirmed `createMcpContractFixture({ seed: 12345 })` vs `createMcpContractFixture({ seed: 67890 })` yields differing file contents for `flat-directory/flat-entry-000.ts`.

### 3. Path Separator Normalization (Minor Issue)
- **Problem**: `abs()` produced OS-native backslashes on Windows while `fixture.root` used forward slashes (`toForwardSlash`).
- **Fix**: Updated `abs` to wrap `path.join` in `toForwardSlash`, ensuring all `absolutePath`, `fromPath`, and `toPath` fields share forward-slash prefixes with `fixture.root`.
- **Verification**: Added assertions to `fixture-workspace.spec.ts`:
  ```typescript
  expect(sym.absolutePath.startsWith(fixture.root)).toBe(true);
  expect(edge.fromPath.startsWith(fixture.root)).toBe(true);
  expect(edge.toPath.startsWith(fixture.root)).toBe(true);
  ```

### 4. JSON Table Row Unit Assertion (Minor Issue)
- **Problem**: `toContain(String(row.id))` and `toContain(row.s)` in `reducers.bench.spec.ts` checked isolated substrings rather than the cohesive table row.
- **Fix**: Replaced with table row unit check `expect(result.text).toContain(\`|\${row.id}|\${row.s}|\`)` in the JSON reducer test and `|1|s1|`, `|300|s300|` in the table-driven sweep.

### 5. Default Budget Guard Note (Minor Issue)
- **Problem**: Spec hardcodes local `DEFAULT_BUDGET` (2000 tokens / 8000 chars) since production `DEFAULT_TOOL_RESULT_BUDGET_TOKENS` lives in `vscode-lm-tools` (`type:util` boundary prevents cross-import).
- **Fix**: Added explicit code comment at `DEFAULT_BUDGET` documenting that Batch 21.1 (`vscode-lm-tools` contract sweep) guards the production default.

### 6. Revision 1 Verification Run Evidence
1. **Fixture Workspace Jest Spec**:
   ```
   npx jest --config libs/backend/workspace-intelligence/jest.config.ts libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts
   PASS workspace-intelligence libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts
     createMcpContractFixture
       √ creates an Nx-shaped monorepo with mixed root deps, no angular.json, 500-file directory, and 300-line TS file (227 ms)
       √ proves determinism: two independent builds produce identical file lists and identical contents (531 ms)
       √ proves seed sensitivity: different seeds produce different contents in flat directory files (455 ms)
       √ matches knownSymbols and knownEdges with the files written to disk (233 ms)
       √ removes the root directory completely upon cleanup (203 ms)

   Test Suites: 1 passed, 1 total
   Tests:       5 passed, 5 total
   Time:        2.866 s
   ```
2. **Reducers Benchmark Jest Spec**:
   ```
   npx jest --config libs/backend/tool-output-reducers/jest.config.ts libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
   PASS tool-output-reducers libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
     Reducers Benchmark (TASK_2026_559 Batch 20 Task 20.3)
       √ reports measured reduction metrics at HEAD (222 ms)
       HTML reducer
         √ reduces ~200 KB HTML below budget and pinned ratio while preserving article headings and paragraphs (32 ms)
       JSON compactor
         √ compacts ~300 objects pretty JSON below budget and pinned ratio while preserving every non-empty scalar (17 ms)
       Log reducer
         √ reduces 5,000-line log below budget and pinned ratio while preserving all 3 failure blocks and summary line (102 ms)
       Code reducer
         √ reduces 300-line TS source via fake outliner below budget and pinned ratio while preserving focus symbol body (2 ms)
         √ reduces 300-line TS source via no-outliner fallback below budget and pinned ratio while preserving focus symbol (5 ms)
       Markdown outline reducer
         √ reduces 30-section Markdown doc below budget and pinned ratio while preserving every section heading (5 ms)
       Table-driven sweep over all kinds
         √ HTML page (~200 KB) satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (32 ms)
         √ Pretty JSON (~300 objects) satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (9 ms)
         √ Jest log (~5,000 lines, 3 failures) satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (102 ms)
         √ 300-line TS via outliner satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (2 ms)
         √ 300-line TS via no-outliner fallback satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (5 ms)
         √ 30-section Markdown doc satisfies size budget (tokens <= 2000), pinned ratio, and preserves key content (4 ms)

   Test Suites: 1 passed, 1 total
   Tests:       13 passed, 13 total
   Time:        2.297 s
   ```
3. **Full Nx Test, Lint, Typecheck**:
   ```
   node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers --skip-nx-cache
   √ nx run @ptah-extension/workspace-intelligence:typecheck
   √ nx run @ptah-extension/workspace-intelligence:lint
   √ nx run @ptah-extension/tool-output-reducers:test
   √ nx run @ptah-extension/tool-output-reducers:lint
   √ nx run @ptah-extension/tool-output-reducers:typecheck
   √ nx run @ptah-extension/workspace-intelligence:test
   NX Successfully ran targets test, lint, typecheck for 2 projects (1m 7s)
   ```
4. **Degradation Audit Baseline Check**:
   ```
   node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache
   degradation-audit: TOTAL 300 unsuppressed site(s)
   NX Successfully ran target lint for project degradation-audit
   ```
5. **Ptah-Electron Dependency Scanner**:
   ```
   node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache
   ✅ All external imports are covered by package.json dependencies.
   NX Successfully ran target validate-deps for project ptah-electron and 1 task it depends on
   ```
6. **Prettier Check**:
   ```
   npx prettier --check libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
   Checking formatting...
   All matched files use Prettier code style!
   ```
7. **Clean Production Tree**:
   `git diff --stat` is empty; 0 modifications to tracked production code.

---

## 10. Revision Round 2 (r2 REVISE 8/10)

Addressed cross-side code logic review findings from `.ptah/specs/TASK_2026_559_8ca9/reviews/batch-20a-code-logic-review-r2.md`:

### 1. Flake Risk Elimination: Single Disk Write + In-Memory Verification
- **Root Cause**: `fixture-workspace.spec.ts` in r1 built the full fixture 4 separate times on disk (each generating 500+ files and directories on Windows followed by recursive cleanup). This heavy I/O load occasionally competed with other async tasks in the 46-suite `@ptah-extension/workspace-intelligence` project, causing an intermittent single-suite flake under load.
- **Architectural Solution**:
  - Extracted in-memory planning into `generateMcpContractFixturePlan(root: string, options?: McpContractFixtureOptions): McpContractFixturePlan` in `fixture-workspace.ts`. It builds the full workspace tree (`{ files: McpFixtureFile[], knownSymbols: KnownSymbol[], knownEdges: KnownEdge[] }`) entirely in-memory with 0 disk I/O.
  - Implemented `createMcpContractFixture` on top of `generateMcpContractFixturePlan` with cached `createdDirs` to avoid 500 redundant `fs.mkdirSync` operations on Windows.
  - Restructured `fixture-workspace.spec.ts`:
    - Full fixture is written to disk at most **ONCE** using `beforeAll` and cleaned up in `afterAll`.
    - Determinism (`proves determinism via in-memory plan`) compares two in-memory plans from `generateMcpContractFixturePlan` across all 500+ files, symbols, and edges with zero disk writes.
    - Seed sensitivity (`proves seed sensitivity via in-memory plan`) compares two in-memory plans generated with different seeds with zero disk writes.
    - Disk assertions (monorepo structure, 500 flat directory files, 300-line TS file, symbol exact-line checks, and import edges) evaluate the shared `fixture` on disk.
    - Directory cleanup is verified using a lightweight minimal fixture (`flatFileCount: 0`, ~10 files).
- **Runtime Measurement Comparison**:
  - **Before (r1)**: `Time: 4.253 s` (individual tests: 271 ms, 667 ms, 544 ms, 268 ms, 252 ms = 2,002 ms test execution time)
  - **After (r2)**: `Time: 2.161 s` (individual tests: 16 ms, 12 ms, 2 ms, 15 ms, 12 ms = 57 ms test execution time)
  - **Result**: Test execution time improved by **35x** (57 ms vs 2,002 ms) and runner duration dropped by 49%.
- **Repeated Stability Verification (3 consecutive runs)**:
  Ran `node_modules/.bin/nx test @ptah-extension/workspace-intelligence --skip-nx-cache` 3 times in a row:
  - **Run 1**: `Test Suites: 46 passed, 46 total`, `Tests: 1239 passed, 1239 total` (Run duration: 59.6s)
  - **Run 2**: `Test Suites: 46 passed, 46 total`, `Tests: 1239 passed, 1239 total` (Run duration: 47.8s)
  - **Run 3**: `Test Suites: 46 passed, 46 total`, `Tests: 1239 passed, 1239 total` (Run duration: 1m 5s)
  All 3 consecutive runs passed with 100% success (0 failures, 0 flaky tasks).

### 2. Library Tsconfig Exclude (`src/testing/**/*`)
- Followed `platform-core`'s established pattern from `libs/backend/platform-core/tsconfig.lib.json`:
  ```json
  "exclude": [
    "jest.config.ts",
    "src/**/*.spec.ts",
    "src/**/*.test.ts",
    "src/**/__mocks__/**/*",
    "src/testing/**/*"
  ]
  ```
- Updated `libs/backend/workspace-intelligence/tsconfig.lib.json` to exclude `"src/testing/**/*"`.
- Verified typechecking:
  `node_modules/.bin/nx run @ptah-extension/workspace-intelligence:typecheck` runs `tsc --noEmit --project libs/backend/workspace-intelligence/tsconfig.lib.json` and passes with 0 errors in 6.9s.

### 3. Verification Suite Evidence
1. **Workspace Intelligence & Tool Output Reducers (test, lint, typecheck)**:
   ```
   node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers --skip-nx-cache
   √ nx run @ptah-extension/workspace-intelligence:typecheck
   √ nx run @ptah-extension/workspace-intelligence:lint
   √ nx run @ptah-extension/tool-output-reducers:test
   √ nx run @ptah-extension/tool-output-reducers:lint
   √ nx run @ptah-extension/tool-output-reducers:typecheck
   √ nx run @ptah-extension/workspace-intelligence:test
   NX Successfully ran targets test, lint, typecheck for 2 projects (1m 46s)
   ```
2. **Dependent Project Typechecks**:
   ```
   node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache
   √ nx run ptah-electron:typecheck
   √ nx run ptah-cli:typecheck
   NX Successfully ran target typecheck for 2 projects (24.0s)
   ```
3. **Degradation Audit Baseline Check**:
   ```
   node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache
   degradation-audit: TOTAL 300 unsuppressed site(s)
   NX Successfully ran target lint for project degradation-audit (4.6s)
   ```
4. **Prettier Check**:
   ```
   npx prettier --check libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts libs/backend/workspace-intelligence/tsconfig.lib.json libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
   Checking formatting...
   All matched files use Prettier code style!
   ```
5. **Git Status**:
   `git status --short`:
   ```
   M libs/backend/workspace-intelligence/tsconfig.lib.json
   ?? .ptah/specs/TASK_2026_559_8ca9/batch-20a-executor-report.md
   ?? libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts
   ?? libs/backend/workspace-intelligence/src/testing/
   ```


