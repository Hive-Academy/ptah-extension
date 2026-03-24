# Implementation Plan - TASK_2025_207

## Remove Redundant MCP Namespaces: ptah.git, ptah.commands, ptah.symbols

### Summary

Remove 3 redundant MCP namespaces from the Ptah MCP tools system:

- **ptah.git** (1 method: `getStatus()`) -- CLI `git status` is superior
- **ptah.commands** (2 methods: `execute()`, `list()`) -- No use case for CLI agents; `ptah.ide.actions` covers useful ops
- **ptah.symbols** (1 method: `find()`) -- Subsumed by `ptah.ast.queryFunctions/queryClasses` + `ptah.ide.lsp.getReferences/getDefinition`

After removal: 17 namespaces becomes **14 namespaces** (workspace, search, diagnostics, ai, files, context, project, relevance, ast, ide, llm, orchestration, agent, dependencies) + webSearch + help.

**Counting note**: The `ptah` object currently has 17 named namespace properties + `help()` method + optional `webSearch`. The "17 namespaces" count in code includes: workspace, search, symbols, diagnostics, git, ai, files, commands, context, project, relevance, dependencies, ast, ide, llm, orchestration, agent. Removing 3 yields **14 namespaces**. Some docs say "16" (pre-dependencies addition). All must be updated to **14**.

---

## Codebase Investigation Summary

### Files Affected (19 files total)

All paths are absolute Windows paths with drive letters.

---

## Phase 1: Core Backend Removal (5 files)

These are the runtime source files. Order matters -- types first, then builders, then assembly.

### 1.1 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`

**What to change**:

- Remove `SymbolsNamespace` interface (lines 159-167)
- Remove `GitNamespace` interface (lines 214-220)
- Remove `GitStatus` interface (lines 225-237)
- Remove `CommandsNamespace` interface (lines 518-532)
- Remove `symbols: SymbolsNamespace;` from `PtahAPI` interface (line 44)
- Remove `git: GitNamespace;` from `PtahAPI` interface (line 46)
- Remove `commands: CommandsNamespace;` from `PtahAPI` interface (line 49)
- Remove imports of `GitStatus`, `GitNamespace` if used only internally (they are -- `SymbolsNamespace`, `GitNamespace`, `GitStatus` are imported in `core-namespace.builders.ts`; `CommandsNamespace` in `system-namespace.builders.ts`)
- Update file header comment: "11 namespaces" or similar count reference (line 6 says "11 namespaces" -- update to "14 namespaces" to match actual)
- Update `PtahAPI` JSDoc: "Provides 15 namespaces" (line 38) to "Provides 14 namespaces" -- actually it says different things in different places, just remove the 3 properties

### 1.2 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts`

**What to change**:

- Remove `buildSymbolsNamespace()` function (lines 116-130)
- Remove `buildGitNamespace()` function (lines 175-215)
- Remove `parseSymbolKind()` helper function (lines 224-233) -- only used by `buildSymbolsNamespace`
- Remove `GIT_STATUS_UNTRACKED` constant (line 163)
- Remove `GitChange` interface (lines 166-169)
- Remove imports no longer needed: `SymbolsNamespace`, `GitNamespace`, `GitStatus` from `../types`
- Update file header comment (lines 1-14): Remove references to "symbol search" and "git status"
- Check if `import * as vscode from 'vscode'` is still needed: YES -- `buildDiagnosticsNamespace()` still uses `vscode.languages.getDiagnostics()`, `vscode.DiagnosticSeverity`, etc. Keep the vscode import.
- Update the APPROVED EXCEPTION comment (lines 7-13): Remove mention of `buildSymbolsNamespace()` and `buildGitNamespace()`. Only `buildDiagnosticsNamespace()` needs the vscode import now.

### 1.3 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts`

**What to change**:

- Remove `buildCommandsNamespace()` function (lines 1140-1160)
- Remove `ALLOWED_MCP_COMMAND_PREFIXES` constant (lines 1128-1134)
- Remove HELP_DOCS entries for keys: `symbols` (lines 252-257), `git` (lines 269-271), `commands` (lines 279-282)
- Update HELP_DOCS `overview` entry (line 40): Change "17 Namespaces" to "14 Namespaces"
- Update HELP_DOCS `overview` WORKSPACE line (line 42): Remove `symbols`, `git`, `commands` from the list. Currently: `"WORKSPACE: workspace, search, symbols, files, diagnostics, git, commands"` -- change to `"WORKSPACE: workspace, search, files, diagnostics"`
- Remove `CommandsNamespace` import from `../types` if it exists (check -- it's imported via the types)
- Update file header comment (lines 1-14): Remove mention of `buildCommandsNamespace()` and "command execution"
- Update the APPROVED EXCEPTION comment: Remove mention of `buildCommandsNamespace()` using `vscode.commands.*`. Check if `import * as vscode from 'vscode'` is still needed: YES -- `buildAINamespace()` uses `vscode.lm.*`, `vscode.LanguageModelChatMessage`, `vscode.CancellationTokenSource`. Keep vscode import.

### 1.4 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts`

**What to change**:

- Remove `buildSymbolsNamespace` from the core-namespace.builders re-export (line 26)
- Remove `buildGitNamespace` from the core-namespace.builders re-export (line 28)
- Remove `buildCommandsNamespace` from the system-namespace.builders re-export (line 36)
- Update comments: "Core namespaces (workspace, search, diagnostics)" and "System namespaces (ai, files) + help method"

### 1.5 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`

**What to change**:

- Remove imports: `buildSymbolsNamespace`, `buildGitNamespace`, `buildCommandsNamespace` (lines 63, 65, 69)
- Remove from `build()` return object:
  - `symbols: buildSymbolsNamespace(),` (line 270)
  - `git: buildGitNamespace(),` (line 272)
  - `commands: buildCommandsNamespace(),` (line 277)
- Update log message: `'PtahAPIBuilder initialized with 17 namespaces'` -> `'PtahAPIBuilder initialized with 14 namespaces'` (line 211)
- Update JSDoc: `'Build the complete Ptah API object with all 17 namespaces'` -> `'...14 namespaces'` (line 215)
- Update file header comment (lines 1-28): Remove `symbols`, `git`, `commands` from the namespace listing
- Check if `CommandManager` import from `@ptah-extension/vscode-core` is still needed (line 36): Check if any remaining code uses `this.commandManager`. Search the file... `commandManager` is passed in `systemDeps` (line 228) and `systemDeps` is used by `buildAINamespace(systemDeps)` and `buildFilesNamespace(systemDeps)`. Check if those builders actually use `commandManager`... The `SystemNamespaceDependencies` interface likely includes it. Since `buildCommandsNamespace()` is being removed but `commandManager` might still be needed by other system namespace builders -- **VERIFY**: If `commandManager` is only used by `buildCommandsNamespace()`, remove the constructor injection too. If used elsewhere, keep it.
- **Action**: Check `SystemNamespaceDependencies` interface. If `commandManager` is only consumed by `buildCommandsNamespace`, remove the `@inject(TOKENS.COMMAND_MANAGER)` constructor parameter and the `commandManager` field from `systemDeps`.

---

## Phase 2: Tool Description & System Prompt (2 files)

### 2.1 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`

**What to change**:

- Line 24: Change `'with 17 namespaces'` to `'with 14 namespaces'`
- Line 28: Change IIFE example from `ptah.git.getStatus()` to a non-removed namespace example, e.g., `ptah.workspace.getInfo()`
- Line 501: Change `"## Top Namespaces (17 total"` to `"## Top Namespaces (14 total"`
- Lines 518-519: Remove entire `### ptah.git - Repository Status` section (lines 518-519)
- Lines 567-568: Remove from "Other Namespaces" list:
  - `- ptah.symbols.* - Code symbol search` (line 567)
  - `- ptah.commands.* - VS Code command execution` (line 568)

### 2.2 VERIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`

**What to change**: This file does NOT reference ptah.git, ptah.commands, or ptah.symbols directly in its current content (verified -- it references ptah_workspace_analyze, ptah_search_files, ptah_get_diagnostics, ptah_lsp_references, etc. as standalone MCP tools, not the execute_code namespaces). **No changes needed.**

---

## Phase 3: Documentation Updates (7 files)

### 3.1 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md`

**What to change**:

- Remove `ptah.symbols` from architecture diagram (line 42)
- Remove `ptah.git` from architecture diagram (line 44)
- Remove `ptah.commands` from architecture diagram (line 47)
- Remove entire `### ptah.symbols - Code Symbol Extraction` section (lines 259-274)
- Remove entire `### ptah.git - Git Operations` section (lines 299-317)
- Remove entire `### ptah.commands - VS Code Command Execution` section (lines 363-375)
- Update any namespace counts in the file
- Remove `ptah.symbols.extract('/src/app.ts')` usage example (line 514)
- Remove `CommandManager for ptah.commands namespace` reference (line 681)
- Update tool description example text that lists "symbols, diagnostics, git, ai, files, commands"

### 3.2 MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\MCP_GUIDE.md`

**What to change**:

- Line 5: Update "11 API namespaces" (or whatever count) to reflect removal
- Remove `ptah.symbols` row from "Code & Diagnostics" table (line 30)
- Remove `ptah.git` row from "Code & Diagnostics" table (line 32)
- Remove `ptah.commands` row from "VS Code Integration" table (line 45)
- Lines 91-94: Remove the `ptah.symbols.find` example in "Finding Implementations" section

### 3.3 MODIFY: `D:\projects\ptah-extension\README.md`

**What to change**:

- Line 250: Change `"16 ptah.* APIs"` to `"13 ptah.* APIs"` (or `"14"` depending on how webSearch is counted)
- Line 252: Change `"### 16 API Namespaces"` to `"### 14 API Namespaces"` (counting: 14 without webSearch, keeping consistency)
- Lines 257-262: Remove the 3 namespaces from the grid:
  - Remove `ptah.symbols      — code symbols` (line 257)
  - Remove `ptah.git          — git status` (line 259)
  - Remove `ptah.commands     — VS Code commands` (line 262)
- Reformat the grid to be balanced (7 rows of 2 becomes ~5.5 rows -- reorganize)

### 3.4 MODIFY: `D:\projects\ptah-extension\.agent\rules\vscode-lm.md`

**What to change**:

- Remove entire `**ptah.symbols**` section (lines 121-129)
- Remove entire `**ptah.git**` section (lines 140-148)
- Remove entire `**ptah.commands**` section (lines 175-181)

### 3.5 MODIFY: `D:\projects\ptah-extension\docs\CONTENT_STRATEGY.md`

**What to change**:

- Remove `- ptah.symbols - Extract code symbols, find definitions/references` (line 54)
- Remove `- ptah.git - Get status, history, diffs` (line 56)
- Remove `- ptah.commands - Execute VS Code commands` (line 59)

### 3.6 MODIFY: `D:\projects\ptah-extension\docs\content\BLOG_POST_MCP_SUPERPOWERS.md`

**What to change**:

- Remove `ptah.symbols;` from namespace listing (line 61)
- Remove `ptah.git;` from namespace listing (line 63)
- Remove `ptah.commands;` from namespace listing (line 66)
- Remove entire `#### 3. ptah.symbols - Code Structure Understanding` section (lines 113-129)
- Remove entire `#### 5. ptah.git - Version Control Access` section (lines 151-162)
- Remove entire `#### 8. ptah.commands - VS Code Control` section (lines 195-203)
- Remove/update the `ptah.symbols.extract()` reference (line 261)
- Renumber remaining sections

### 3.7 MODIFY: `D:\projects\ptah-extension\docs\content\VIDEO_SCRIPT_HIDDEN_FEATURES.md`

**What to change**:

- Remove `ptah.symbols;` from namespace listing (line 242)
- Remove `ptah.git;` from namespace listing (line 244)
- Remove `ptah.commands;` from namespace listing (line 247)
- Remove/rework the `ptah.commands` demo section (lines 252, 266-268)
- Remove `ptah.commands` from production schedule table (line 396)
- Remove from shot list (line 422)

### 3.8 MODIFY: `D:\projects\ptah-extension\docs\content\LANDING_PAGE.md`

**What to change**:

- Remove `ptah.symbols.extract` reference (line 106)

---

## Phase 4: Frontend & Agent Generation Updates (2 files)

### 4.1 MODIFY: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\docs\sections\mcp-server-section.component.ts`

**What to change**:

- Remove from `apiNamespaces` array (lines 329-346):
  - `{ name: 'ptah.symbols', hint: 'code symbols' },` (line 332)
  - `{ name: 'ptah.git', hint: 'git status' },` (line 334)
  - `{ name: 'ptah.commands', hint: 'VS Code cmds' },` (line 337)
- Line 168: Update `title="16 API Namespaces"` to `title="14 API Namespaces"` (or adjust to match new count -- currently 16 items in array minus 3 = 13 visual items, but the section title should match the backend count)

### 4.2 MODIFY: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.ts`

**What to change**:

- Line 177: Replace `ptah.symbols.extract('/path/to/file.ts')` with `ptah.ast.analyze('/path/to/file.ts')` (ast is the replacement)
- Line 181: Remove `ptah.help('symbols')` reference, replace with `ptah.help('ast')`
- Line 288: Replace `ptah.symbols.extract('/path/to/file.ts')` with `ptah.ast.analyze('/path/to/file.ts')`

---

## Phase 5: Verification

### 5.1 Build verification

```bash
npm run compile
# OR
nx build vscode-lm-tools
```

Verify no TypeScript compilation errors from removed types/functions.

### 5.2 Namespace count audit

After changes, grep for stale namespace counts:

```bash
# Should return 0 results for old counts
grep -rn "17 namespace\|17 total\|16 API\|16 namespace\|17 API" --include="*.ts" --include="*.md" libs/ apps/ README.md docs/
```

### 5.3 Stale reference audit

```bash
# Should return 0 results (only in task specs and git history)
grep -rn "ptah\.git\.\|ptah\.commands\.\|ptah\.symbols\.\|buildGitNamespace\|buildCommandsNamespace\|buildSymbolsNamespace\|GitNamespace\|CommandsNamespace\|SymbolsNamespace" --include="*.ts" --include="*.md" libs/ apps/ docs/ README.md .agent/
```

### 5.4 Lint check

```bash
npm run lint:all
npm run typecheck:all
```

---

## Files Affected Summary

**MODIFY (19 files)**:

| #   | File                                                                                                                             | Category                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`                                        | Core types                      |
| 2   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts`   | Core builder                    |
| 3   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts` | System builder                  |
| 4   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts`                     | Barrel exports                  |
| 5   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`                     | API assembly                    |
| 6   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`        | Tool description                |
| 7   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md`                                                              | Lib docs                        |
| 8   | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\MCP_GUIDE.md`                                                           | MCP guide                       |
| 9   | `D:\projects\ptah-extension\README.md`                                                                                           | Root readme                     |
| 10  | `D:\projects\ptah-extension\.agent\rules\vscode-lm.md`                                                                           | Agent rules                     |
| 11  | `D:\projects\ptah-extension\docs\CONTENT_STRATEGY.md`                                                                            | Content docs                    |
| 12  | `D:\projects\ptah-extension\docs\content\BLOG_POST_MCP_SUPERPOWERS.md`                                                           | Blog post                       |
| 13  | `D:\projects\ptah-extension\docs\content\VIDEO_SCRIPT_HIDDEN_FEATURES.md`                                                        | Video script                    |
| 14  | `D:\projects\ptah-extension\docs\content\LANDING_PAGE.md`                                                                        | Landing page docs               |
| 15  | `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\docs\sections\mcp-server-section.component.ts`                  | Landing page UI                 |
| 16  | `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.ts`                        | Wizard prompts                  |
| 17  | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts`                  | VERIFY ONLY (no changes needed) |

**NO CHANGES NEEDED**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts` -- does not reference the 3 namespaces

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: This is primarily a removal/cleanup task across TypeScript backend source files and documentation. No Angular component logic changes (only array element removal in the landing page component). A backend developer familiar with the vscode-lm-tools library structure is ideal.

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- Phase 1 (Core backend): 45 min -- careful removal of types, functions, exports, and assembly
- Phase 2 (Tool description): 15 min -- string updates
- Phase 3 (Documentation): 45 min -- 8 doc files, mostly section removals
- Phase 4 (Frontend/agent-gen): 15 min -- array element removal and string replacement
- Phase 5 (Verification): 30 min -- build, lint, grep audit

### Critical Verification Points

1. **CommandManager dependency**: After removing `buildCommandsNamespace`, verify whether `CommandManager` (injected at ptah-api-builder.service.ts line 149-150) is still needed by any remaining namespace builder. If not, remove the constructor injection to avoid unused dependency warnings.

2. **vscode import in core-namespace.builders.ts**: After removing `buildSymbolsNamespace` and `buildGitNamespace`, the `import * as vscode from 'vscode'` is still needed for `buildDiagnosticsNamespace()`. Do NOT remove it.

3. **vscode import in system-namespace.builders.ts**: After removing `buildCommandsNamespace`, the vscode import is still needed for `buildAINamespace()`. Do NOT remove it.

4. **Namespace count consistency**: Every occurrence of "17", "16", or similar namespace counts must be updated to "14" across all files. Run the grep audit in Phase 5.

5. **HELP_DOCS keys**: After removing `symbols`, `git`, `commands` entries, verify the `buildHelpMethod()` still works -- it falls through to "Topic not found" for removed topics, which is correct behavior.

### Architecture Delivery Checklist

- [x] All 19 affected files identified with absolute Windows paths
- [x] All changes specified per file (remove/update)
- [x] Order of operations defined (types -> builders -> assembly -> descriptions -> docs -> frontend)
- [x] Verification steps defined (build, lint, grep audit)
- [x] No new files created (pure removal task)
- [x] No backward compatibility layers (direct removal)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 2-3 hours)
