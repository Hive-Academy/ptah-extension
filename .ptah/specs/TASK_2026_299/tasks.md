# Development Tasks - TASK_2026_299

**Total Tasks**: 22 | **Batches**: 8 | **Status**: 0/8 complete

Repair two internal MCP tools across runtimes: `ptah_search_files` (true glob)
and `ptah_get_diagnostics` (honest available/unavailable contract + real TS
compiler provider for Electron/CLI). Sub-agents only — NO CLI delegation.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `IDiagnosticsProvider.getDiagnostics` is currently SYNC and returns
  `Array<{ file; diagnostics: Array<{ message; line; severity }> }>`. Making it
  async + capability-aware is a clean break — no callers rely on sync semantics
  beyond `buildDiagnosticsNamespace` and the contract test, both in scope.
  VERIFIED in `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts`.
- `PtahAPIBuilder` already injects `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`
  (line 342) and passes it into `systemDeps`/`astDeps`, but NOT into `coreDeps`.
  `buildSearchNamespace` receives `coreDeps` only. Routing true glob through
  `buildSearchNamespace` requires adding `fileSystemProvider` to `coreDeps` (or
  a dedicated `searchDeps` bag). VERIFIED in
  `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:464-468`.
- `VscodeFileSystemProvider.findFiles` already accepts `cwd?: string` in its
  signature (line 153) but ignores it (`_cwd`). The watcher at line 179 already
  uses `vscode.RelativePattern(options.cwd, pattern)` — so the fix is to mirror
  that pattern in `findFiles`. VERIFIED.
- `protocol-dispatcher.ts` wraps every tool case in an outer try/catch that
  emits `isError: true` on thrown errors (lines 1579, 1693). Removing the
  catch-to-`[]` in `buildSearchNamespace.findFiles` will let errors propagate
  to the dispatcher's existing error handler — no new error plumbing needed.
  VERIFIED at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`.
- Electron Phase 0 registers `ElectronDiagnosticsProvider` at
  `platform-electron/src/registration.ts:151`. Phase 2 calls
  `registerWorkspaceIntelligenceServices` at
  `apps/ptah-electron/src/di/phase-2-libraries.ts:163`. Override point is
  immediately after line 163. VERIFIED.
- CLI Phase 0 registers `CliDiagnosticsProvider` at
  `platform-cli/src/registration.ts:101`. Phase 2 calls
  `registerWorkspaceIntelligenceServices` at
  `libs/backend/cli-engine/src/lib/container.ts:521`. Override point is
  immediately after line 521. VERIFIED.
- Neither `apps/ptah-electron/package.json` nor `apps/ptah-cli/package.json`
  declares `typescript` as a dependency. Neither `project.json` external list
  includes `typescript`. Both must be added. VERIFIED.

### Risks Identified

| Risk                                                                                                                                                   | Severity | Mitigation                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DiagnosticsNamespace` return shape change ripples into `protocol-dispatcher.ts` `ptah_get_diagnostics` case + `formatDiagnostics`                     | HIGH     | Batch 3 updates the namespace, dispatcher case, and formatter in one coupled batch.                                            |
| `coreDeps` bag is shared by `buildWorkspaceNamespace` + `buildSearchNamespace`; adding `fileSystemProvider` must not break the workspace builder       | MED      | `buildWorkspaceNamespace` ignores the extra field; verify via its existing spec.                                               |
| TS compiler API against large monorepos can be slow / memory-heavy                                                                                     | MED      | `TypeScriptDiagnosticsProvider` must dedup, traverse project references once, and not cache (per plan). No Nx/shell execution. |
| Windows path normalization in TS compiler diagnostics (backslashes)                                                                                    | MED      | Batch 5 must normalize path separators to forward slashes for dedup keys and output.                                           |
| `formatDiagnostics` receives `unknown` today; distinguishing unavailable-vs-clean requires the namespace to pass a structured object, not a flat array | MED      | Batch 3 changes the namespace return to `{ status, source, diagnostics }` and the formatter to branch on `status`.             |

### Edge Cases to Handle

- [ ] No workspace root resolved (`resolveRootPerCall` returns `undefined`) → glob uses process-global root; diagnostics provider returns unavailable. Handled in Batches 2, 5.
- [ ] Glob pattern matches nothing → return `[]` with "Found: 0 files" (success, not error). Handled in Batch 2.
- [ ] `findFiles` throws (filesystem error) → propagate to dispatcher `isError: true`, do NOT swallow to `[]`. Handled in Batch 2.
- [ ] No `tsconfig*.json` under root → `TypeScriptDiagnosticsProvider` returns `{ status: 'unavailable', reason }`, does NOT throw. Handled in Batch 5.
- [ ] Malformed `tsconfig.json` → return unavailable with reason, do NOT throw. Handled in Batch 5.
- [ ] `typescript` package not resolvable at runtime → return unavailable. Handled in Batch 5.
- [ ] Project references cycle → traverse once, dedup by file/start/code/message. Handled in Batch 5.
- [ ] Diagnostics from files outside the requested root → filter out. Handled in Batches 4, 5.
- [ ] Zero diagnostics from an available source → "No issues found." (NOT unavailable). Handled in Batch 3.
- [ ] Workspace switch mid-session → no caching; provider re-reads per call. Handled in Batch 5.

### Scope Guardrails (enforced)

- No frontend changes.
- No long-lived language server or Monaco bridge.
- No Nx/shell process execution (`tsc --noEmit` subprocess forbidden — use TS compiler API in-process).
- No redesign of fuzzy relevance tools (`getRelevantFiles` stays fuzzy) or the live file index.

---

## Batch 1: Honest diagnostics contract (platform-core) ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester (if backend-developer unavailable)
**Execution Mode**: sequential
**Rationale**: Foundation batch — every downstream batch depends on these types. Single owner, contract-dependent, no parallelism.
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Extract diagnostic types + make `IDiagnosticsProvider` async + capability-aware ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\diagnostics-provider.interface.ts
**Spec Reference**: context.md §"2. Honest diagnostics contract"
**Pattern to Follow**: Existing interface file (currently sync, `Array<{ file; diagnostics: Array<{ message; line; severity }> }>`)

**Quality Requirements**:

- Define named types: `DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'`, `DiagnosticEntry = { message: string; line: number; severity: DiagnosticSeverity; code?: string | number }`, `FileDiagnostics = { file: string; diagnostics: DiagnosticEntry[] }`.
- Define `DiagnosticsResult` discriminated union:
  - `{ status: 'available'; source: string; diagnostics: FileDiagnostics[] }`
  - `{ status: 'unavailable'; source: string; reason: string }`
- Change `getDiagnostics(workspaceRoot?: string)` to `Promise<DiagnosticsResult>` (async, accepts optional root).
- Keep the interface a pure type definition (no imports beyond `type`).

**Validation Notes**:

- This is a breaking change to the port. All three adapter implementations and the mock will fail to compile until Batches 4, 5, 6 update them. That is expected — the contract test and mock are updated in this same batch to keep `platform-core` self-consistent.
- `workspaceRoot` is optional; VS Code ignores it for the VS Code API call but uses it for filtering (Batch 4). Electron/CLI use it as the TS compiler root (Batch 5).

**Implementation Details**:

- Export the new types from the interface file.
- Update `src/index.ts` to re-export `DiagnosticSeverity`, `DiagnosticEntry`, `FileDiagnostics`, `DiagnosticsResult` (alongside existing `IDiagnosticsProvider` export at line 29).

### Task 1.2: Update the diagnostics provider mock to be async + capability-aware ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-core\src\testing\mocks\diagnostics-provider.mock.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- `getDiagnostics` becomes a `jest.fn` returning `Promise<DiagnosticsResult>`.
- Default: returns `{ status: 'available', source: 'mock', diagnostics: [...] }` from the seeded array.
- Allow overrides to return `{ status: 'unavailable', source: 'mock', reason: '...' }`.
- `MockDiagnosticsProviderState.setDiagnostics` still works for seeding the available path.
- Add a `setUnavailable(reason: string)` helper on the state for the unavailable path.

### Task 1.3: Update the adapter contract test runner for the new async + status shape ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-core\src\testing\contracts\run-diagnostics-provider-contract.ts
**File**: D:\projects\ptah-extension\libs\backend\platform-core\src\testing\contracts\run-diagnostics-provider-contract.self.spec.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- All assertions `await` the `getDiagnostics()` call.
- Contract asserts: result has `status` (`'available' | 'unavailable'`), `source` (string).
- When `status === 'available'`: `diagnostics` is an array; each entry has `file: string`, `diagnostics: array`; each diagnostic has `message: string`, `line: number`, `severity` in the allowed set.
- When `status === 'unavailable'`: `reason: string` present; `diagnostics` absent.
- Permit an unavailable result as valid even with seeded fixtures (Electron/CLI may be unavailable if no tsconfig).
- Update the self-spec to exercise both paths.

### Task 1.4: Verify platform-core typecheck + Jest ⏸️ PENDING

**File**: (no file change — verification only)
**Dependencies**: Tasks 1.1-1.3

**Quality Requirements**:

- Run `npx nx typecheck platform-core` — must pass.
- Run `npx nx test platform-core` — must pass.
- Confirm the barrel `src/index.ts` exports the new types.

**Batch 1 Verification**:

- `npx nx typecheck platform-core` passes.
- `npx nx test platform-core` passes.
- New types exported from `@ptah-extension/platform-core`.
- Mock + contract test reflect the async + status shape.

---

## Batch 2: True glob search in `ptah_search_files` ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Coupled changes across the builder, the API builder deps bag, the VS Code filesystem adapter, tool/help wording, and their specs. Single owner, file-disjoint but semantically coupled.
**Tasks**: 5 | **Dependencies**: None (independent of Batch 1 — could run in parallel, but kept sequential per sub-agents-only preference)

### Task 2.1: Make `VscodeFileSystemProvider.findFiles` honor `cwd` via `RelativePattern` ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-file-system-provider.ts
**Spec Reference**: context.md §"1. True glob search" — "Update `VscodeFileSystemProvider.findFiles()` to honor `cwd` with `vscode.RelativePattern`, matching its watcher implementation."
**Pattern to Follow**: `createFileWatcher` at lines 172-222 of the same file (already uses `vscode.RelativePattern(options.cwd, pattern)`).

**Quality Requirements**:

- When `cwd` is provided, call `vscode.workspace.findFiles(new vscode.RelativePattern(cwd, pattern), excludeGlob, maxResults)`.
- When `cwd` is undefined, keep the current bare-glob behavior.
- Return absolute `fsPath` values (unchanged).
- Update the existing spec to cover the `cwd`-scoped path.

**Validation Notes**:

- Risk: `coreDeps` adding `fileSystemProvider` — this adapter method is the one `buildSearchNamespace` will call. Confirm the `RelativePattern` approach matches the watcher's (it does — line 179).

### Task 2.2: Rewrite `buildSearchNamespace.findFiles` to use `IFileSystemProvider.findFiles` (true glob) ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts
**Spec Reference**: context.md §"1. True glob search" — "inject `IFileSystemProvider`, resolve the session root per call, invoke `findFiles()` with `DEFAULT_WORKSPACE_EXCLUDES`, and return normalized workspace-relative paths."
**Pattern to Follow**: `resolveRootPerCall` at line 54 of the same file.

**Quality Requirements**:

- `CoreNamespaceDependencies` gains a `fileSystemProvider: IFileSystemProvider` field.
- `findFiles(pattern, limit)`:
  - Resolve root via `resolveRootPerCall(workspaceProvider)`.
  - Call `fileSystemProvider.findFiles(pattern, DEFAULT_WORKSPACE_EXCLUDES, limit, root)`.
  - Normalize results to workspace-relative paths (strip the root prefix, forward slashes).
  - REMOVE the `try/catch → []` swallow — let errors propagate to the MCP dispatcher's `isError: true` handler.
- `getRelevantFiles(query, maxFiles)`: KEEP the fuzzy `contextOrchestration.getFileSuggestions` path, but propagate thrown and `{ success: false }` failures instead of swallowing to `[]`.
- Import `DEFAULT_WORKSPACE_EXCLUDES` from `@ptah-extension/workspace-intelligence` (it is exported from `src/file-indexing/workspace-default-excludes.ts`; confirm it is re-exported from the lib barrel — if not, add the re-export).

**Validation Notes**:

- Risk: adding `fileSystemProvider` to `coreDeps` — `buildWorkspaceNamespace` receives the same bag and must ignore the extra field. Verify via its existing spec.
- Edge case: no root → `findFiles` called with `cwd=undefined` → adapter uses process-global workspace root. Acceptable fallback per plan.
- Edge case: zero matches → `findFiles` resolves `[]` → return `[]` (success, not error).

### Task 2.3: Pass `fileSystemProvider` through `PtahAPIBuilder.coreDeps` ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts
**Spec Reference**: context.md §"1. True glob search" — "Pass the filesystem provider through `PtahAPIBuilder`'s `coreDeps`."
**Pattern to Follow**: `systemDeps` at line 470 already includes `fileSystemProvider: this.fileSystemProvider`.

**Quality Requirements**:

- Add `fileSystemProvider: this.fileSystemProvider` to the `coreDeps` object (line 464-468).
- Do NOT remove it from `systemDeps` or `astDeps` (they still use it).
- The `buildSearchNamespace(coreDeps)` call at line 508 now receives the provider.

**Validation Notes**:

- `this.fileSystemProvider` is already injected at line 342-343 (`@inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)`). No new injection needed.

### Task 2.4: Update tool description + system-prompt wording for `ptah_search_files` ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts
**Spec Reference**: context.md §"1. True glob search" — "Update focused tool/help wording."

**Quality Requirements**:

- `buildSearchFilesTool()` description: change from "gitignore-aware, workspace-indexed" to accurate glob wording: "Find files in the workspace by glob pattern. Searches the real filesystem (not a fuzzy index). Returns workspace-relative paths. Respects default workspace excludes (node_modules, dist, .git, etc.)."
- System prompt `ptah_search_files` line: update to "Find files by glob pattern. True filesystem glob — not a fuzzy index. Returns workspace-relative paths."
- Do NOT change `getRelevantFiles` wording (it stays fuzzy).

### Task 2.5: Update / add specs for true glob behavior ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.spec.ts
**File**: D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-file-system-provider.spec.ts (if exists; otherwise add a focused spec)
**Dependencies**: Tasks 2.1-2.4

**Quality Requirements**:

- Prove wildcard delegation: `findFiles('**/*.ts')` calls `fileSystemProvider.findFiles` with the pattern (not `contextOrchestration.searchFiles`).
- Prove session-root use: the `cwd` passed to `fileSystemProvider.findFiles` equals `resolveRootPerCall` output.
- Prove relative output: absolute paths from the provider are normalized to workspace-relative.
- Prove true no-match: zero matches returns `[]` (not an error).
- Prove explicit errors: when `fileSystemProvider.findFiles` throws, `findFiles` re-throws (does NOT swallow to `[]`).
- Prove `getRelevantFiles` still routes to `contextOrchestration.getFileSuggestions` (fuzzy unchanged) but propagates failures.
- Prove `VscodeFileSystemProvider.findFiles` with `cwd` uses `RelativePattern`.

**Batch 2 Verification**:

- `npx nx typecheck vscode-lm-tools platform-vscode` passes.
- `npx nx test vscode-lm-tools platform-vscode` passes.
- `findFiles` is a true glob; `getRelevantFiles` remains fuzzy; errors propagate.

---

## Batch 3: DiagnosticsNamespace + formatter + help/system-prompt wording ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Coupled change — the namespace return shape, the dispatcher case, and the formatter must all change together or nothing compiles. Depends on Batch 1 types.
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 3.1: Rewrite `buildDiagnosticsNamespace` to preserve status/source/reason with flattened diagnostics ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts
**Spec Reference**: context.md §"2. Honest diagnostics contract" — "Update `DiagnosticsNamespace` to preserve status/source/reason with flattened diagnostics."
**Dependencies**: Batch 1 (new `DiagnosticsResult` type)

**Quality Requirements**:

- `DiagnosticsNamespace` methods (`getErrors`, `getWarnings`, `getAll`) return `Promise<DiagnosticsPayload>` where `DiagnosticsPayload` carries:
  - `status: 'available' | 'unavailable'`
  - `source: string`
  - `reason?: string`
  - `diagnostics: DiagnosticInfo[]` (flattened, severity-filtered for `getErrors`/`getWarnings`)
- `buildDiagnosticsNamespace(diagnosticsProvider, workspaceProvider)`:
  - Accept the session-aware `IWorkspaceProvider` (add to signature) so it can resolve the root per call and pass it to `getDiagnostics(root)`.
  - `await diagnosticsProvider.getDiagnostics(root)`.
  - When `status === 'unavailable'`: return `{ status, source, reason, diagnostics: [] }`.
  - When `status === 'available'`: flatten `FileDiagnostics[]` into `DiagnosticInfo[]` (file, message, line, severity, optional code), filter by severity for `getErrors`/`getWarnings`.
- Update `DiagnosticInfo` in `types.ts` to include optional `code?: string | number` and `source?: string`.
- Update `PtahAPIBuilder.build()` call site (line 511) to pass `this.workspaceProvider` (the session-aware one) into `buildDiagnosticsNamespace`.

**Validation Notes**:

- Risk: the dispatcher case at `protocol-dispatcher.ts:509-524` calls `getErrors`/`getWarnings`/`getAll` and passes the result to `formatDiagnostics`. Both must be updated in this batch.

### Task 3.2: Update `protocol-dispatcher.ts` `ptah_get_diagnostics` case for the new payload shape ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts
**Dependencies**: Task 3.1

**Quality Requirements**:

- The case at line 509-524: `result` is now `DiagnosticsPayload` (status/source/reason/diagnostics).
- Pass the whole payload to `formatDiagnostics(result)` (not just the flat array).
- Keep the `severity` arg routing (`getErrors`/`getWarnings`/`getAll`).

### Task 3.3: Rewrite `formatDiagnostics` so unavailable is explicit and "No issues found" only for available + zero ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts
**Spec Reference**: context.md §"2. Honest diagnostics contract" — "Update `formatDiagnostics()` so unavailable is explicit and 'No issues found' appears only for an available source with zero diagnostics."
**Dependencies**: Task 3.1

**Quality Requirements**:

- `formatDiagnostics(payload: unknown)`:
  - If `payload.status === 'unavailable'`: render `{ h2: 'Diagnostics' }` + `{ p: '**Source:** <source> — Unavailable. <reason>' }`. Do NOT say "No issues found."
  - If `payload.status === 'available'` and `diagnostics.length === 0`: render "Errors: 0 | Warnings: 0 — No issues found." (current behavior, but only here).
  - If `payload.status === 'available'` and `diagnostics.length > 0`: current table/list rendering, with `source` shown in the header line.
- Update the existing formatter spec to cover all three branches.

### Task 3.4: Update tool description + system-prompt wording for `ptah_get_diagnostics` ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts
**Dependencies**: Task 3.1

**Quality Requirements**:

- `buildGetDiagnosticsTool()` description: drop "from VS Code diagnostics" (runtime-agnostic now). Use: "Get TypeScript/JavaScript errors and warnings from the workspace diagnostics provider. Returns an honest available/unavailable result with source, status, and flattened diagnostics. Each diagnostic includes file path, line number, severity, and message."
- System prompt `ptah_get_diagnostics` line: "Get TypeScript/JS errors and warnings. Returns status (available/unavailable), source, and diagnostics. severity: \"error\" | \"warning\" | \"all\" (default: \"all\")."

**Batch 3 Verification**:

- `npx nx typecheck vscode-lm-tools` passes.
- `npx nx test vscode-lm-tools` passes (formatter spec covers unavailable/available-empty/available-populated).
- Dispatcher routes the new payload shape correctly.

---

## Batch 4: VS Code diagnostics adapter (async available result, root filtering) ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Single adapter file + spec, depends on Batch 1 contract. Straightforward but must preserve VS Code severity mapping + zero-based lines.
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 4.1: Rewrite `VscodeDiagnosticsProvider.getDiagnostics` as async + capability-aware + root-filtered ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-diagnostics-provider.ts
**Spec Reference**: context.md §"3. Runtime diagnostics — VS Code"
**Dependencies**: Batch 1 (new interface)

**Quality Requirements**:

- `async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult>`.
- Return `{ status: 'available', source: 'vscode-languages', diagnostics }` always (VS Code always has the language API).
- Call `vscode.languages.getDiagnostics()` (no filter arg — the API returns all).
- When `workspaceRoot` is provided: filter out entries whose `uri.fsPath` is NOT within the root (use `path.relative` + startsWith, or the existing `isPathWithinRoots` helper from `platform-core`).
- Preserve severity mapping (`Error→'error'`, `Warning→'warning'`, `Information→'info'`, `Hint→'hint'`).
- Preserve zero-based line numbers (`d.range.start.line` — do NOT add 1).
- Skip entries with zero diagnostics (current behavior).

**Validation Notes**:

- Edge case: `workspaceRoot` outside any open folder → `vscode.languages.getDiagnostics()` still returns all; filtering may yield `[]`. That is a valid available-empty result.

### Task 4.2: Update the VS Code diagnostics spec for async + filtering ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-diagnostics-provider.spec.ts (if exists; otherwise add one)
**Dependencies**: Task 4.1

**Quality Requirements**:

- Spec proves: `await getDiagnostics()` returns `{ status: 'available', source: 'vscode-languages', diagnostics: [...] }`.
- Spec proves: `await getDiagnostics(root)` filters to only entries within `root`.
- Spec proves: severity mapping + zero-based line numbers preserved.
- Spec proves: empty diagnostics (no errors) → available with `diagnostics: []`.

**Batch 4 Verification**:

- `npx nx typecheck platform-vscode` passes.
- `npx nx test platform-vscode` passes.
- Adapter returns the new `DiagnosticsResult` shape.

---

## Batch 5: Shared `TypeScriptDiagnosticsProvider` in workspace-intelligence ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Heaviest batch — TS compiler API, tsconfig discovery, project-reference traversal, dedup, Windows paths, unavailable-vs-throw semantics. Single owner, deeply coupled logic, must not be parallelized.
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 5.1: Create `TypeScriptDiagnosticsProvider` ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\diagnostics\type-script-diagnostics-provider.ts
**Spec Reference**: context.md §"3. Runtime diagnostics — Electron and CLI"
**Dependencies**: Batch 1 (new interface + types)

**Quality Requirements**:

- `export class TypeScriptDiagnosticsProvider implements IDiagnosticsProvider`.
- `async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult>`.
- Source string: `'typescript-compiler'`.
- When `workspaceRoot` is undefined/empty → return `{ status: 'unavailable', source, reason: 'No workspace root resolved.' }`.
- Discover non-ignored `tsconfig*.json` files under the root using `IFileSystemProvider.findFiles('**/tsconfig*.json', DEFAULT_WORKSPACE_EXCLUDES, ...)`. Exclude generated/vendor trees (node_modules, dist, .git, build output).
- If no tsconfig found → return `{ status: 'unavailable', source, reason: 'No tsconfig.json found under workspace root.' }`.
- Try to `require('typescript')` lazily inside the method. If it throws → return `{ status: 'unavailable', source, reason: 'TypeScript compiler not available.' }`.
- For each tsconfig: parse with `ts.parseJsonConfigFileContent` (or `ts.readConfigFile`), then create a program with `ts.createProgram` using the parsed file names + compiler options.
- Collect `getPreEmitDiagnostics()` (covers config, syntactic, options, global, semantic diagnostics).
- Traverse project references ONCE (`program.getProjectReferences()`), create child programs, collect their diagnostics. Guard against cycles with a visited set.
- Deduplicate by `file:startLine:code:messageCategory`.
- Flatten message chains (`diagnostic.next`).
- Map severity: `ts.DiagnosticCategory.Error → 'error'`, `Warning → 'warning'`, `Suggestion → 'info'`, `Message → 'hint'`.
- Calculate source lines from `diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)` — zero-based.
- Filter diagnostics to files within the requested root (ignore diagnostics from files outside the root).
- Return `{ status: 'available', source, diagnostics: FileDiagnostics[] }`.
- THROW only for genuine execution failures (e.g. filesystem read error that is not "not found"). Do NOT throw for no-config / no-compiler / no-root.
- Windows paths: normalize backslashes to forward slashes in dedup keys and in the output `file` field.
- No caching. Re-read per call (workspace-switch correctness).

**Validation Notes**:

- Risk: large monorepo → many tsconfigs. Mitigate by traversing project references once and deduplicating.
- Risk: `require('typescript')` in a bundled context. The `typescript` package is added as a real dependency in Batch 6, and added to the external bundle lists so esbuild does not try to bundle it.
- Edge case: malformed tsconfig → `ts.parseJsonConfigFileContent` may throw. Catch per-config and return unavailable for that config, do NOT fail the whole call. If ALL configs fail, return unavailable with the aggregate reason.
- Do NOT spawn `tsc` or any shell command. In-process TS compiler API only.

**Implementation Details**:

- Constructor: `constructor(@inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) private readonly fs: IFileSystemProvider)` — or accept it as a constructor arg if not using decorators. Check how other workspace-intelligence services inject `IFileSystemProvider` (the lib already depends on `platform-core`).
- Import `DEFAULT_WORKSPACE_EXCLUDES` from `../file-indexing/workspace-default-excludes`.
- Register in DI: add to `src/di/register.ts` as a singleton under a new token (e.g. `TYPE_SCRIPT_DIAGNOSTICS_PROVIDER = Symbol.for('PtahTypeScriptDiagnosticsProvider')`), OR register it directly in the Electron/CLI composition (Batch 6). Prefer registering in the lib's `register.ts` so both hosts can resolve it, but do NOT auto-bind it to `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` here — the host composition overrides the token (Batch 6).

### Task 5.2: Export `TypeScriptDiagnosticsProvider` + its token from the lib barrel ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts
**File**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\index.ts
**Dependencies**: Task 5.1

**Quality Requirements**:

- Export `TypeScriptDiagnosticsProvider` from the public barrel.
- Export the DI token (if a dedicated token is added) from `src/di/index.ts`.
- Do NOT export `DEFAULT_WORKSPACE_EXCLUDES` from the public barrel unless Batch 2 needs it (if Batch 2 could not find it re-exported, add the re-export here too — coordinate with Batch 2).

### Task 5.3: Add specs covering clean/error projects, project references, malformed/no config, dedup, workspace switching, Windows paths ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\diagnostics\type-script-diagnostics-provider.spec.ts
**Dependencies**: Task 5.1

**Quality Requirements**:

- Use a mock `IFileSystemProvider` backed by an in-memory file tree.
- Use the real `typescript` package (devDependency — it is already a transitive dep of the monorepo; confirm `npx nx typecheck workspace-intelligence` can resolve it).
- Cases:
  - Clean project (valid tsconfig, no errors) → available, `diagnostics: []`.
  - Error project (valid tsconfig, a TS file with a type error) → available, diagnostics include the error with correct file/line/severity.
  - Project references (root tsconfig references child tsconfigs) → traverses once, dedup, no cycle.
  - Malformed tsconfig (invalid JSON) → unavailable with reason, no throw.
  - No tsconfig under root → unavailable with reason.
  - No workspace root → unavailable with reason.
  - `typescript` unresolvable (mock `require` to throw) → unavailable with reason.
  - Dedup: same diagnostic from two program paths → appears once.
  - Workspace switch: two sequential calls with different roots → each sees only its own tsconfigs.
  - Windows paths: backslash paths in TS compiler output → normalized to forward slashes in dedup keys + output.
  - Root filtering: a diagnostic from a file outside the root → excluded.

**Batch 5 Verification**:

- `npx nx typecheck workspace-intelligence` passes.
- `npx nx test workspace-intelligence` passes (all spec cases above).
- Provider returns unavailable (not throw) for no-root / no-config / no-compiler.
- Provider throws only for genuine execution failures.

---

## Batch 6: Electron/CLI runtime composition + packaging ⏸️ PENDING

**Recommended Executor**: backend-developer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Couples Phase 0 placeholder changes, Phase 2 token overrides, and packaging (package.json + external bundle lists) across two apps. Must be sequential — the override must land after workspace-intelligence registration in each host.
**Tasks**: 5 | **Dependencies**: Batches 1, 4, 5

### Task 6.1: Change Electron/CLI Phase 0 diagnostics placeholders from `[]` to explicit unavailable ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-diagnostics-provider.ts
**File**: D:\projects\ptah-extension\libs\backend\platform-cli\src\implementations\cli-diagnostics-provider.ts
**Dependencies**: Batch 1 (new interface)

**Quality Requirements**:

- `ElectronDiagnosticsProvider.getDiagnostics()` → `async getDiagnostics(): Promise<DiagnosticsResult>` returning `{ status: 'unavailable', source: 'electron-phase0', reason: 'Diagnostics not configured for this Electron runtime.' }`.
- `CliDiagnosticsProvider.getDiagnostics()` → `async getDiagnostics(): Promise<DiagnosticsResult>` returning `{ status: 'unavailable', source: 'cli-phase0', reason: 'Diagnostics not configured for this CLI runtime.' }`.
- These are the FALLBACK registrations. They get overridden in Tasks 6.2/6.3 after workspace-intelligence registers the real provider.

### Task 6.2: Override `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` after workspace-intelligence registration in Electron ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts
**Dependencies**: Tasks 5.2, 6.1

**Quality Requirements**:

- Immediately after `registerWorkspaceIntelligenceServices(container, logger)` (line 163), register the `TypeScriptDiagnosticsProvider` (resolve it from the workspace-intelligence registration) and override `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` to use it.
- Use `container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, { useValue: <TypeScriptDiagnosticsProvider instance> })` OR `useFactory` that resolves the provider from the container.
- The override must come AFTER workspace-intelligence so the provider's dependencies (`IFileSystemProvider`) are already registered.
- Add a log line confirming the override.

**Validation Notes**:

- Risk: `PtahAPIBuilder` injects `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` at construction (line 346). The override must happen BEFORE `PtahAPIBuilder` is resolved. In Electron, `PtahAPIBuilder` is resolved during `registerVsCodeLmToolsServices` (Phase 4 equivalent) — which runs after Phase 2. So the override in Phase 2 is safe. VERIFY the Electron Phase ordering: `registerVsCodeLmToolsServices` is called after `registerPhase2Libraries`.

### Task 6.3: Override `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` after workspace-intelligence registration in CLI ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\container.ts
**Dependencies**: Tasks 5.2, 6.1

**Quality Requirements**:

- Immediately after `registerWorkspaceIntelligenceServices(container, logger)` (line 521), register/override `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` with the `TypeScriptDiagnosticsProvider`.
- Same pattern as Task 6.2.
- `registerVsCodeLmToolsServices` is called at line 685 (Phase 4, full mode) — after the override. Safe.

### Task 6.4: Add `typescript` to Electron + CLI `package.json` dependencies and external bundle lists ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-electron\package.json
**File**: D:\projects\ptah-extension\apps\ptah-cli\package.json
**File**: D:\projects\ptah-extension\apps\ptah-electron\project.json
**File**: D:\projects\ptah-extension\apps\ptah-cli\project.json
**Dependencies**: Task 5.1

**Quality Requirements**:

- Add `"typescript": "^5.9.0"` (or the version the monorepo already uses — check root `package.json` for the exact version) to `dependencies` in both `apps/ptah-electron/package.json` and `apps/ptah-cli/package.json`.
- Add `"typescript"` to the `external` array in both `apps/ptah-electron/project.json` (line 37-88) and `apps/ptah-cli/project.json` (line 32-71), so esbuild does NOT bundle it (it must stay external for `require('typescript')` at runtime).
- Do NOT add it to the webview or any frontend bundle.

### Task 6.5: Specs for full-runtime DI replacement + placeholder unavailability ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.spec.ts (if exists; otherwise add a focused spec or extend an existing one)
**File**: D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\container.spec.ts (if exists; otherwise add one)
**Dependencies**: Tasks 6.2, 6.3

**Quality Requirements**:

- Spec proves: after Phase 2 registration in Electron, `container.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)` returns a `TypeScriptDiagnosticsProvider` (not the Phase 0 stub).
- Spec proves: after Phase 2 registration in CLI, same.
- Spec proves: the Phase 0 placeholder (before workspace-intelligence registration) returns `{ status: 'unavailable', ... }`.
- If a full container spec is too heavy, write a focused spec that calls the registration function directly with a child container and asserts the resolved token.

**Batch 6 Verification**:

- `npx nx typecheck platform-electron platform-cli cli-engine ptah-electron ptah-cli` passes.
- `npx nx test platform-electron platform-cli cli-engine` passes.
- `npx nx build ptah-electron` passes (typescript is external, not bundled).
- `npx nx build ptah-cli` passes (typescript is external, not bundled).
- Resolved `DIAGNOSTICS_PROVIDER` in Electron + CLI is the `TypeScriptDiagnosticsProvider`.

---

## Batch 7: Verification (typechecks + Jest + builds + manual exercise) ⏸️ PENDING

**Recommended Executor**: senior-tester
**Fallback Executor**: backend-developer
**Execution Mode**: sequential
**Rationale**: Pure verification batch — no implementation. Senior-tester runs the affected matrices and exercises the tools per the plan's phase 4.
**Tasks**: 3 | **Dependencies**: Batches 1-6

### Task 7.1: Run affected typechecks + Jest suites ⏸️ PENDING

**Files**: (no file changes — verification only)
**Dependencies**: Batches 1-6

**Quality Requirements**:

- `npx nx typecheck platform-core platform-vscode platform-electron platform-cli workspace-intelligence vscode-lm-tools cli-engine ptah-electron ptah-cli` — all pass.
- `npx nx test platform-core platform-vscode platform-electron platform-cli workspace-intelligence vscode-lm-tools cli-engine` — all pass.
- Report any failures with the failing spec + file.

### Task 7.2: Run Electron + CLI builds ⏸️ PENDING

**Files**: (no file changes — verification only)
**Dependencies**: Task 7.1

**Quality Requirements**:

- `npx nx build ptah-electron` — passes; `typescript` is in the external list (not bundled).
- `npx nx build ptah-cli` — passes; `typescript` is in the external list.
- Confirm the generated `dist/apps/ptah-electron/package.json` and `dist/apps/ptah-cli/package.json` include `typescript` in `dependencies`.

### Task 7.3: Manual exercise of `ptah_search_files` + diagnostics per plan phase 4 ⏸️ PENDING

**Files**: (no file changes — verification only)
**Dependencies**: Task 7.2

**Quality Requirements**:

- Exercise `ptah_search_files`:
  - `**/*diagnostic*.ts` → returns real filesystem matches (workspace-relative).
  - A no-match glob (e.g. `**/nonexistent-xyz-*.ts`) → returns `[]` with "Found: 0 files" (success, not error).
  - An error/no-root case (e.g. invalid pattern or no workspace) → returns `isError: true` (not swallowed to `[]`).
- Exercise `ptah_get_diagnostics`:
  - Against a clean fixture (valid TS, no errors) → `status: 'available'`, "No issues found."
  - Against an intentionally broken fixture (a TS file with a type error) → `status: 'available'`, diagnostics include the error.
  - Against a directory with no tsconfig → `status: 'unavailable'`, explicit reason, NOT "No issues found."
  - In VS Code (if possible) → `source: 'vscode-languages'`; in Electron/CLI → `source: 'typescript-compiler'`.
- Document the results in the verification report.

**Batch 7 Verification**:

- All typechecks + Jest suites pass.
- Both builds pass.
- Manual exercise confirms honest status wording + true glob behavior.

---

## Batch 8: code-logic-reviewer pass ⏸️ PENDING

**Recommended Executor**: code-logic-reviewer
**Fallback Executor**: senior-tester
**Execution Mode**: sequential
**Rationale**: Final logic gate focused on the four risk areas the plan calls out. Independent reviewer catches semantic issues the implementer normalized.
**Tasks**: 1 | **Dependencies**: Batches 1-7

### Task 8.1: Logic review focused on session-root containment, project-reference traversal, deduplication, unavailable-vs-clean semantics ⏸️ PENDING

**Files** (review targets):

- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\diagnostics\type-script-diagnostics-provider.ts
- D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts
- D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts
- D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-diagnostics-provider.ts
- D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts
- D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\container.ts
  **Dependencies**: Batch 7

**Quality Requirements** (rejection criteria):

- Session-root containment: does `TypeScriptDiagnosticsProvider` filter diagnostics to files within the requested root? Does `VscodeDiagnosticsProvider`? Does `buildSearchNamespace` pass the session root (not a cached/build-time root) to `findFiles`?
- Project-reference traversal: does it traverse references ONCE, guard against cycles, and dedup by `file/start/code/message`?
- Deduplication: are message chains flattened before dedup? Are Windows backslash paths normalized before dedup keys are formed?
- Unavailable-vs-clean semantics: does `formatDiagnostics` say "No issues found" ONLY for `status: 'available'` with zero diagnostics? Does it say "Unavailable" for `status: 'unavailable'`? Does the provider THROW only for genuine execution failures (not no-root/no-config/no-compiler)?
- No `// TODO`, `// PLACEHOLDER`, `// STUB`, empty method bodies, hardcoded mock data, or `console.log` without real logic.
- No Nx/shell process execution (no `tsc` subprocess — TS compiler API in-process only).

**Batch 8 Verification**:

- code-logic-reviewer returns APPROVED or REJECTED with specific findings.
- If REJECTED, orchestrator re-spawns backend-developer with the findings; team-leader re-verifies.

---

## NEXT BATCH ASSIGNED: Batch 1 / backend-developer / sequential
