# Development Tasks - TASK_2025_207

**Total Tasks**: 16 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `buildCommandsNamespace()` uses `vscode.commands.*` directly (no deps parameter): VERIFIED
- `commandManager` in `SystemNamespaceDependencies` is unused by `buildAINamespace` and `buildFilesNamespace`: VERIFIED -- only defined in interface line 31, never referenced elsewhere
- `import * as vscode from 'vscode'` still needed in `core-namespace.builders.ts` after removal: VERIFIED -- `buildDiagnosticsNamespace` uses it
- `import * as vscode from 'vscode'` still needed in `system-namespace.builders.ts` after removal: VERIFIED -- `buildAINamespace` uses it
- `ptah-system-prompt.constant.ts` does not reference the 3 namespaces: VERIFIED per plan

### Risks Identified

| Risk                                                                                                                               | Severity | Mitigation                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| CommandManager cleanup cascade -- removing from SystemNamespaceDependencies and PtahAPIBuilder constructor may affect DI container | LOW      | Verify no other code passes commandManager through systemDeps. Grep confirmed only usage is interface definition. |
| Namespace count inconsistency -- plan mentions various counts (11, 15, 16, 17) across different files                              | MED      | Task 1.5 and 2.1 handle count updates. Batch 3 includes grep audit for stale counts.                              |

### Edge Cases to Handle

- [x] `ptah.help('symbols')` / `ptah.help('git')` / `ptah.help('commands')` calls will now return "Topic not found" -- this is correct behavior per plan
- [x] `commandManager` field must be removed from both `SystemNamespaceDependencies` interface AND `PtahAPIBuilder` constructor + systemDeps object

---

## Batch 1: Core Backend Removal (Phase 1 + Phase 2) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None

### Task 1.1: Remove redundant interfaces and properties from types.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
**Spec Reference**: implementation-plan.md: Phase 1, section 1.1

**Quality Requirements**:

- Remove `SymbolsNamespace` interface entirely
- Remove `GitNamespace` interface entirely
- Remove `GitStatus` interface entirely
- Remove `CommandsNamespace` interface entirely
- Remove `symbols: SymbolsNamespace;` from `PtahAPI` interface
- Remove `git: GitNamespace;` from `PtahAPI` interface
- Remove `commands: CommandsNamespace;` from `PtahAPI` interface
- Update file header comment: "11 namespaces" to "14 namespaces" (line 5)
- Update PtahAPI JSDoc: "Provides 15 namespaces" to "Provides 14 namespaces" (around line 36)

**Validation Notes**:

- Do NOT remove the `import * as vscode from 'vscode'` -- still needed for DiagnosticsNamespace

**Implementation Details**:

- Pure deletion of interface blocks and property lines
- Count update in comments/JSDoc

---

### Task 1.2: Remove builder functions from core-namespace.builders.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts`
**Spec Reference**: implementation-plan.md: Phase 1, section 1.2
**Dependencies**: Task 1.1

**Quality Requirements**:

- Remove `buildSymbolsNamespace()` function entirely
- Remove `buildGitNamespace()` function entirely
- Remove `parseSymbolKind()` helper function (only used by buildSymbolsNamespace)
- Remove `GIT_STATUS_UNTRACKED` constant
- Remove `GitChange` interface
- Remove imports no longer needed: `SymbolsNamespace`, `GitNamespace`, `GitStatus` from `../types`
- Update file header comment: remove references to "symbol search" and "git status"
- Update APPROVED EXCEPTION comment: remove mention of `buildSymbolsNamespace()` and `buildGitNamespace()`. Only `buildDiagnosticsNamespace()` needs vscode import now.

**Validation Notes**:

- Do NOT remove `import * as vscode from 'vscode'` -- still needed for `buildDiagnosticsNamespace()`

---

### Task 1.3: Remove builder function from system-namespace.builders.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts`
**Spec Reference**: implementation-plan.md: Phase 1, section 1.3
**Dependencies**: Task 1.1

**Quality Requirements**:

- Remove `buildCommandsNamespace()` function entirely
- Remove `ALLOWED_MCP_COMMAND_PREFIXES` constant
- Remove HELP_DOCS entries for keys: `symbols`, `git`, `commands`
- Update HELP_DOCS `overview` entry: "17 Namespaces" to "14 Namespaces"
- Update HELP_DOCS `overview` WORKSPACE line: remove `symbols`, `git`, `commands` from the list
- Remove `CommandsNamespace` import from `../types`
- Remove `commandManager: CommandManager;` from `SystemNamespaceDependencies` interface (line 31) -- VERIFIED unused by remaining builders
- Remove `CommandManager` import from `@ptah-extension/vscode-core` if only used by the interface
- Update file header comment: remove mention of `buildCommandsNamespace()` and "command execution"
- Update APPROVED EXCEPTION comment: remove mention of `buildCommandsNamespace()` using `vscode.commands.*`

**Validation Notes**:

- Do NOT remove `import * as vscode from 'vscode'` -- still needed for `buildAINamespace()`
- `commandManager` is ONLY in the `SystemNamespaceDependencies` interface, never accessed by `buildAINamespace` or `buildFilesNamespace`

---

### Task 1.4: Update barrel exports in index.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts`
**Spec Reference**: implementation-plan.md: Phase 1, section 1.4
**Dependencies**: Tasks 1.2 and 1.3

**Quality Requirements**:

- Remove `buildSymbolsNamespace` from core-namespace.builders re-export
- Remove `buildGitNamespace` from core-namespace.builders re-export
- Remove `buildCommandsNamespace` from system-namespace.builders re-export
- Update comments to reflect remaining namespaces

---

### Task 1.5: Update PtahAPIBuilder service -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
**Spec Reference**: implementation-plan.md: Phase 1, section 1.5
**Dependencies**: Tasks 1.2, 1.3, and 1.4

**Quality Requirements**:

- Remove imports: `buildSymbolsNamespace`, `buildGitNamespace`, `buildCommandsNamespace`
- Remove from `build()` return object: `symbols`, `git`, `commands` properties
- Remove `@inject(TOKENS.COMMAND_MANAGER) private readonly commandManager: CommandManager` from constructor
- Remove `CommandManager` import from `@ptah-extension/vscode-core`
- Remove `commandManager: this.commandManager` from `systemDeps` object
- Update log message: "17 namespaces" to "14 namespaces"
- Update JSDoc: "17 namespaces" to "14 namespaces"
- Update file header comment: remove `symbols`, `git`, `commands` from namespace listing

**Validation Notes**:

- `commandManager` is confirmed unused by any remaining namespace builder
- After removal, `systemDeps` should only contain `fileSystemManager`, `workspaceProvider`, `fileSystemProvider`

---

### Task 1.6: Update tool description builder -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`
**Spec Reference**: implementation-plan.md: Phase 2, section 2.1
**Dependencies**: None (string-only changes)

**Quality Requirements**:

- Change "with 17 namespaces" to "with 14 namespaces"
- Change IIFE example from `ptah.git.getStatus()` to `ptah.workspace.getInfo()`
- Change "Top Namespaces (17 total" to "Top Namespaces (14 total"
- Remove `### ptah.git - Repository Status` section
- Remove `ptah.symbols.*` and `ptah.commands.*` from "Other Namespaces" list

---

**Batch 1 Verification**:

- All 6 files modified at specified paths
- Build passes: `npm run compile` or `nx build vscode-lm-tools`
- code-logic-reviewer approved
- No stale references to removed namespaces in modified files

---

## Batch 2: Documentation + Frontend + Agent Generation Cleanup (Phase 3 + Phase 4) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 8 | **Dependencies**: Batch 1 complete

### Task 2.1: Update vscode-lm-tools CLAUDE.md -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.1

**Quality Requirements**:

- Remove `ptah.symbols` from architecture diagram
- Remove `ptah.git` from architecture diagram
- Remove `ptah.commands` from architecture diagram
- Remove entire `### ptah.symbols - Code Symbol Extraction` section
- Remove entire `### ptah.git - Git Operations` section
- Remove entire `### ptah.commands - VS Code Command Execution` section
- Update all namespace counts in the file
- Remove `ptah.symbols.extract('/src/app.ts')` usage example
- Remove `CommandManager for ptah.commands namespace` reference
- Update tool description example text listing namespaces

---

### Task 2.2: Update MCP_GUIDE.md -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\MCP_GUIDE.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.2

**Quality Requirements**:

- Update namespace count in intro
- Remove `ptah.symbols` row from table
- Remove `ptah.git` row from table
- Remove `ptah.commands` row from table
- Remove `ptah.symbols.find` example in "Finding Implementations" section

---

### Task 2.3: Update root README.md -- COMPLETE

**File**: `D:\projects\ptah-extension\README.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.3

**Quality Requirements**:

- Update "16 ptah._ APIs" to "14 ptah._ APIs" (or correct count)
- Update "### 16 API Namespaces" heading
- Remove `ptah.symbols`, `ptah.git`, `ptah.commands` from the namespace grid
- Reformat grid to be balanced after removal

---

### Task 2.4: Update agent rules -- COMPLETE

**File**: `D:\projects\ptah-extension\.agent\rules\vscode-lm.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.4

**Quality Requirements**:

- Remove entire `**ptah.symbols**` section
- Remove entire `**ptah.git**` section
- Remove entire `**ptah.commands**` section

---

### Task 2.5: Update content strategy doc -- COMPLETE

**File**: `D:\projects\ptah-extension\docs\CONTENT_STRATEGY.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.5

**Quality Requirements**:

- Remove `ptah.symbols` line
- Remove `ptah.git` line
- Remove `ptah.commands` line

---

### Task 2.6: Update blog post -- COMPLETE

**File**: `D:\projects\ptah-extension\docs\content\BLOG_POST_MCP_SUPERPOWERS.md`
**Spec Reference**: implementation-plan.md: Phase 3, section 3.6

**Quality Requirements**:

- Remove `ptah.symbols;`, `ptah.git;`, `ptah.commands;` from namespace listing
- Remove entire sections: "ptah.symbols - Code Structure Understanding", "ptah.git - Version Control Access", "ptah.commands - VS Code Control"
- Remove/update `ptah.symbols.extract()` reference
- Renumber remaining sections

---

### Task 2.7: Update video script and landing page doc -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\docs\content\VIDEO_SCRIPT_HIDDEN_FEATURES.md`
- `D:\projects\ptah-extension\docs\content\LANDING_PAGE.md`
  **Spec Reference**: implementation-plan.md: Phase 3, sections 3.7 and 3.8

**Quality Requirements**:

- VIDEO_SCRIPT: Remove namespace listings, demo section, production schedule entries, shot list entries for the 3 namespaces
- LANDING_PAGE: Remove `ptah.symbols.extract` reference

---

### Task 2.8: Update frontend component and wizard prompts -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\docs\sections\mcp-server-section.component.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.ts`
  **Spec Reference**: implementation-plan.md: Phase 4, sections 4.1 and 4.2

**Quality Requirements**:

- mcp-server-section.component.ts: Remove 3 entries from `apiNamespaces` array, update title count "16 API Namespaces" to "14 API Namespaces"
- multi-phase-prompts.ts: Replace `ptah.symbols.extract(...)` with `ptah.ast.analyze(...)`, replace `ptah.help('symbols')` with `ptah.help('ast')`

---

**Batch 2 Verification**:

- All 10 files modified at specified paths
- code-logic-reviewer approved
- No stale namespace references in documentation

---

## Batch 3: Verification -- COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2 complete

### Task 3.1: Build and lint verification -- COMPLETE

**Quality Requirements**:

- Run `npm run compile` -- must pass with zero errors
- Run `npm run lint:all` -- must pass
- Run `npm run typecheck:all` -- must pass

---

### Task 3.2: Stale reference audit -- COMPLETE

**Quality Requirements**:

- Grep for old namespace counts: `17 namespace`, `17 total`, `16 API`, `16 namespace`, `17 API` across libs/, apps/, README.md, docs/ -- should return 0 results (excluding task specs)
- Grep for stale references: `ptah.git.`, `ptah.commands.`, `ptah.symbols.`, `buildGitNamespace`, `buildCommandsNamespace`, `buildSymbolsNamespace`, `GitNamespace`, `CommandsNamespace`, `SymbolsNamespace` across libs/, apps/, docs/, README.md, .agent/ -- should return 0 results (excluding task specs and git history)

---

**Batch 3 Verification**:

- All builds pass
- All grep audits clean
- Task complete
