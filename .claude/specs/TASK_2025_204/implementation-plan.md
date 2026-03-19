# Implementation Plan - TASK_2025_204: Enhanced Prompt Engineering Overhaul

## Overview

Restructure the assembled system prompt (~7,000 tokens) to fix 8 identified issues: conflicting tool routing, execute_code misframing, token budget inversion, primacy/recency misalignment, cache staleness, no conditional loading, cognitive fragmentation, and project guidance truncation.

---

## 1. New Prompt Architecture

### Target Section Ordering (Primacy/Recency Optimized)

The assembled prompt follows this structure when `buildCombinedPrompt()` runs:

```
[PRIMACY ZONE — highest attention]
  1. Identity & Environment (compact)           ~150 tokens
  2. Unified Tool Routing Hierarchy             ~600 tokens
  3. Project-Specific Guidance (LLM-generated)  ~3,300 tokens

[MIDDLE ZONE — reference material]
  4. Task Execution & Code Discipline           ~500 tokens
  5. Orchestration & Agent Delegation            ~450 tokens

[RECENCY ZONE — high attention]
  6. Behavioral Rules (compact)                 ~350 tokens
  7. Git & PR Workflow (compressed)             ~350 tokens
  8. Output Formatting                          ~300 tokens

TOTAL                                          ~7,000 tokens
```

### Token Budget Comparison

| Section                                 | Current    | Target              | Change                                  |
| --------------------------------------- | ---------- | ------------------- | --------------------------------------- |
| Identity/Environment/Tone               | ~480       | ~150                | -330                                    |
| Tool Routing (3 conflicting layers)     | ~950       | ~600                | -350 (unified)                          |
| AskUserQuestion                         | ~460       | ~0                  | -460 (move to tool description)         |
| Task Execution                          | ~500       | ~500                | 0                                       |
| Orchestration/Delegation                | ~700       | ~450                | -250 (compress)                         |
| Git (safety + commit + PR)              | ~750       | ~350                | -400 (compress)                         |
| Code References + Formatting            | ~300       | ~300                | 0                                       |
| Professional Objectivity + No Time Est. | ~250       | ~0                  | -250 (merge into behavioral)            |
| **Project Guidance (LLM-generated)**    | **~1,509** | **~3,300**          | **+1,791**                              |
| MCP Tool Docs (PTAH_SYSTEM_PROMPT)      | ~1,823     | ~0 in system prompt | -1,823 (move to execute_code tool desc) |
| **Total**                               | **~7,000** | **~7,000**          | **net zero**                            |

### Key Architectural Decisions

**Decision 1: Move PTAH_SYSTEM_PROMPT entirely out of the system prompt.**
The MCP tool documentation (~1,823 tokens) already appears in the `execute_code` tool description via `buildExecuteCodeDescription()`. Having it in both places is pure duplication. Remove it from `buildCombinedPrompt()` and keep it only in tool descriptions where Claude sees it on-demand when the tool is available.

**Decision 2: Move AskUserQuestion to tool description.**
The AskUserQuestion section (~460 tokens) is only relevant when the tool is called. Move the schema and rules into the `AskUserQuestion` tool's `description` field in the SDK configuration. The system prompt keeps a single line: "Use the AskUserQuestion tool for ALL user choices."

**Decision 3: Unify tool routing into a single hierarchy.**
Merge the three conflicting layers (PTAH_CORE "Tool Usage Policy", PTAH_CORE "MCP Tool Preference", PTAH_SYSTEM_PROMPT "Required Substitutions") into one section with clear priority rules.

**Decision 4: Reframe execute_code as "IDE Access Tool".**
Rename "Advanced: execute_code Tool" to "IDE Access via execute_code" and position it within the unified tool routing section, not buried as a "power-user fallback."

**Decision 5: Project guidance moves to position 3 (primacy zone).**
The premium, LLM-generated project-specific guidance is the most unique and valuable content. It moves right after tool routing so it lands in the primacy zone where attention is highest.

---

## 2. File-by-File Changes

### File 1: `ptah-core-prompt.ts`

**Path**: `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`

**Action**: Rewrite PTAH_CORE_SYSTEM_PROMPT from ~3,665 tokens down to ~2,500 tokens.

**New structure** (in order):

#### Section 1: Identity & Environment (~150 tokens)

Replace the current 4-bullet "Environment Context" and 5-line "Tone and Style" with:

```
# Ptah Extension - AI Assistant for VS Code

You are an AI assistant in the Ptah VS Code Extension. You help developers through a rich webview with enhanced markdown rendering.

**Rules:** No emojis unless asked. Keep responses concise using GitHub-flavored markdown. Never create files unnecessarily — prefer editing. Use tools for tasks; output text for communication. Never use a colon before tool calls.
```

This replaces: "Environment Context" (4 bullets), "Tone and Style" (5 bullets). Savings: ~330 tokens.

#### Section 2: Unified Tool Routing (~600 tokens)

Replace three conflicting sections with one. This section merges:

- PTAH_CORE lines 184-203 ("Tool Usage Policy" + "Ptah MCP Tool Preference")
- All of PTAH_SYSTEM_PROMPT's "Required Substitutions" table

New content:

```
## Tool Routing

### Priority 1: Ptah MCP Tools (when available)
When ptah_* tools are in your tool list, ALWAYS prefer them:
| Task | Tool |
|------|------|
| Workspace overview | ptah_workspace_analyze |
| Find files | ptah_search_files |
| TS/JS errors | ptah_get_diagnostics |
| Symbol references | ptah_lsp_references |
| Go to definition | ptah_lsp_definitions |
| Unsaved files | ptah_get_dirty_files |
| File token count | ptah_count_tokens |
| Web search | ptah_web_search |

### IDE Access via execute_code
Use execute_code with the ptah global object for operations only available through the IDE:
- **Code structure**: ptah.ast.analyze(file) — functions/classes/imports without reading full files (40-60% token savings)
- **Dependencies**: ptah.dependencies.getDependencies(file) / getDependents(file)
- **Structural summaries**: ptah.context.enrichFile(file) — import signatures + class outlines
- **LSP actions**: ptah.ide.actions.organizeImports(file), ptah.ide.actions.rename(file, line, col, newName)
- **AI delegation**: ptah.ai.invokeAgent(agentPath, task, model) — delegate to cheap models
- **Self-docs**: ptah.help() / ptah.help('namespace')

### Priority 2: Built-in Tools
Use Read, Edit, Write, Bash, Grep, Glob, Task when:
- Writing files (ptah.files is read-only)
- Running build/test commands (npm, nx, git)
- Ptah tools unavailable or erroring

### Priority 3: Task Tool (Subagents)
Use Task tool with specialized agents for context-heavy exploration or multi-file implementation work.
Parallelize independent tool calls. Use Task with subagent_type=Explore for codebase exploration.
```

This eliminates the "file search -> Task tool" vs "file search -> ptah.search.findFiles()" vs "file search -> ptah_search_files" conflict by establishing a clear 3-tier priority.

#### Section 3: AskUserQuestion (compressed, ~50 tokens)

Replace the 460-token AskUserQuestion section with:

```
## User Decisions
Use the AskUserQuestion tool for ALL situations requiring user choices. Never present options as plain text. Include AskUserQuestion instructions when spawning subagents via Task.
```

The full schema, WRONG/CORRECT examples, and 4 rules move to the AskUserQuestion tool description (handled in SDK configuration, not in these 6 files — note in handoff).

#### Section 4: Task Execution (~500 tokens)

Keep the "Doing Tasks" section mostly as-is. Merge "Professional Objectivity" and "No Time Estimates" into it as compact rules:

```
## Doing Tasks

Prioritize technical accuracy over validation. Disagree when necessary. Never give time estimates.

[Keep existing bullet points for: read before proposing, security, avoid over-engineering, no backwards-compat hacks]
```

This saves ~250 tokens by eliminating two standalone sections with their headers and horizontal rules.

#### Section 5: Orchestration & Delegation (~450 tokens)

Compress the current ~700-token orchestration section:

**Keep**: Task Type Detection table, Workflow Depth table (compress to single-line per row), agent table.
**Remove**: "Orchestration Rules" numbered list (5 items, ~200 tokens). Replace with:

```
**Rules:** You orchestrate, not implement. Announce your plan. Validate Full workflows with user before coding. Verify after. Parallelize independent agents.
```

**Remove**: "When NOT to Orchestrate" (redundant — the Workflow Depth table's "Minimal" row covers it).

#### Section 6: Git & PR (compressed, ~350 tokens)

Replace 750 tokens across Git Safety Protocol + Commit Workflow + Important Git Notes + PR Workflow + PR Format with:

```
## Git & PR

**Safety:** Never update git config. Never force push, reset --hard, checkout ., or skip hooks unless explicitly asked. Always create NEW commits (never amend unless asked). Stage specific files, not git add -A. Only commit when explicitly asked.

**Commit workflow:** git status + git diff in parallel, follow repo's commit message style, draft "why" not "what", use HEREDOC, verify with git status after.

**PRs:** Use gh CLI. Check all branch commits (not just latest). Title under 70 chars. Format: ## Summary + ## Test plan.
```

#### Section 7: Output Formatting (~300 tokens)

Keep "Code References" and "Rich Formatting Guidelines" as-is — they're already compact and high-value for the webview rendering.

**Remove**: All `---` horizontal rule separators between sections (they consume tokens and add no value for the model). Total savings: ~50 tokens from 11 separators.

### File 2: `ptah-system-prompt.constant.ts`

**Path**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`

**Action**: Restructure PTAH_SYSTEM_PROMPT. Since it is no longer included in the system prompt (moved to tool descriptions only), optimize it for that context.

**Changes**:

1. **Remove "Required Substitutions" table** (lines 14-29). This routing is now handled by the unified tool routing section in PTAH_CORE. The remaining PTAH_SYSTEM_PROMPT content focuses purely on MCP tool reference docs.

2. **Remove "DO NOT use Bash, Grep, or Glob" block** (lines 29-34). Redundant with unified routing.

3. **Remove "Workflow: Start Every Task With Ptah"** (lines 104-111). This is redundant with tool routing and adds 100+ tokens of noise.

4. **Remove the ptah.ast and ptah.context sections** (lines 64-93). These are now documented in the unified tool routing in PTAH_CORE and in the execute_code tool description.

5. **Rename "Advanced: execute_code Tool" to "IDE Access via execute_code"** (line 94). Update the description to match the new framing: "For operations that require IDE integration or combine multiple API calls" instead of "power-user fallback."

6. **Keep**: Tool Quick Reference (ptah_workspace_analyze through ptah_web_search), Multi-Agent Delegation section.

7. **Estimated result**: ~1,200 tokens (down from ~1,823). This only appears in tool descriptions now, not the system prompt, so the system prompt savings are the full ~1,823 tokens.

### File 3: `enhanced-prompts.service.ts`

**Path**: `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`

**Action**: Modify `buildCombinedPrompt()` and add prompt version hashing.

#### Change 3a: Remove PTAH_SYSTEM_PROMPT from buildCombinedPrompt()

In `buildCombinedPrompt()` (line 1242), remove the block that conditionally adds PTAH_SYSTEM_PROMPT:

```typescript
// REMOVE this block (lines 1252-1261):
if (sdkConfig?.isPremium && sdkConfig?.mcpServerRunning) {
  sections.push('\n' + PTAH_SYSTEM_PROMPT);
  ...
}
```

The MCP documentation is now only delivered via tool descriptions (execute*code tool description and individual ptah*\* tool descriptions). This eliminates duplication.

#### Change 3b: Move project guidance to position 2 (after PTAH_CORE)

The `buildCombinedPrompt()` currently appends project guidance at the end. Restructure so project guidance comes immediately after PTAH_CORE_SYSTEM_PROMPT:

```typescript
private buildCombinedPrompt(
  output: PromptDesignerOutput,
  sdkConfig?: EnhancedPromptsSdkConfig
): string {
  const sections: string[] = [];

  // 1. Core system prompt (identity, tool routing, tasks, git)
  sections.push(PTAH_CORE_SYSTEM_PROMPT);

  // 2. Project-specific guidance (primacy zone — right after core)
  sections.push('\n## Project-Specific Guidance\n');
  if (output.projectContext) {
    sections.push(`### Project Context\n${output.projectContext}\n`);
  }
  if (output.frameworkGuidelines) {
    sections.push(`### Framework Guidelines\n${output.frameworkGuidelines}\n`);
  }
  if (output.codingStandards) {
    sections.push(`### Coding Standards\n${output.codingStandards}\n`);
  }
  if (output.architectureNotes) {
    sections.push(`### Architecture Notes\n${output.architectureNotes}\n`);
  }

  return sections.join('\n');
}
```

#### Change 3c: Add prompt version to cache dependency hash

Add a `PROMPT_VERSION` constant that changes whenever PTAH_CORE_SYSTEM_PROMPT is modified. Include it in the dependency hash to invalidate cached prompts when prompt constants change.

In `enhanced-prompts.service.ts`, after the imports, add:

```typescript
import { PTAH_CORE_SYSTEM_PROMPT_TOKENS } from '../ptah-core-prompt';
```

Modify the `computeDependencyHash` call in `runWizard()` to include prompt tokens as a version signal. Specifically, when computing the configHash (line 466), append the prompt token count:

```typescript
// Step 6: Compute dependency hash for cache validation
// Include prompt token count as version signal — if PTAH_CORE_SYSTEM_PROMPT changes,
// the token count changes, invalidating the cache
const baseHash = await this.cacheService.computeDependencyHash(workspacePath);
const configHash = baseHash ? `${baseHash}:pt${PTAH_CORE_SYSTEM_PROMPT_TOKENS}` : null;
```

This is lightweight — no new hashing infrastructure needed. If the prompt constant is edited, the token count estimate changes, which changes the composite hash, which invalidates the cache.

#### Change 3d: Remove PTAH_SYSTEM_PROMPT import

Remove `import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';` (line 53) since it is no longer used in this file.

### File 4: `enhanced-prompts.types.ts`

**Path**: `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts`

**Action**: Increase maxTokens default.

Change `DEFAULT_ENHANCED_PROMPTS_CONFIG`:

```typescript
export const DEFAULT_ENHANCED_PROMPTS_CONFIG: EnhancedPromptsConfig = {
  includeStyleGuidelines: true,
  includeTerminology: true,
  includeArchitecturePatterns: true,
  includeTestingGuidelines: true,
  maxTokens: 4000, // was 2000 — increased to fill reclaimed budget
};
```

Rationale: The compressed PTAH_CORE saves ~1,165 tokens. The removed PTAH_SYSTEM_PROMPT from the system prompt saves ~1,823 tokens. The project guidance budget expands from ~1,509 to ~3,300. Setting maxTokens to 4000 gives the LLM generator room to produce up to 4000 tokens, with the final assembled prompt still fitting within ~7,000 total (PTAH_CORE ~2,500 + guidance ~4,000 = ~6,500, with headroom).

### File 5: `tool-description.builder.ts`

**Path**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`

**Action**: Update `buildExecuteCodeDescription()` to reflect the restructured PTAH_SYSTEM_PROMPT.

The function at line 496 currently embeds the full `PTAH_SYSTEM_PROMPT` in the execute_code tool description. After the PTAH_SYSTEM_PROMPT restructuring (File 2 changes), this will automatically pick up the leaner version (~1,200 tokens instead of ~1,823).

**Additional change**: Update the framing text at line 497:

Replace:

```
Execute TypeScript/JavaScript code with access to VS Code extension APIs via the global "ptah" object.
```

With:

```
IDE access tool — execute TypeScript/JavaScript code with access to VS Code APIs via the global "ptah" object. Use this for code structure analysis (AST), dependency graphs, LSP operations, and multi-step API workflows.
```

This aligns with the "IDE Access" reframing (Issue 2).

### File 6: `system-namespace.builders.ts`

**Path**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`

**Action**: Update HELP_DOCS overview to match new framing.

In `HELP_DOCS.overview` (line 40), update:

Replace:

```
Ptah MCP Server - 16 Namespaces:
```

With:

```
Ptah IDE Access - 17 Namespaces:
```

No other changes needed to this file. The HELP_DOCS entries are self-documentation for `ptah.help()` and are already well-structured.

---

## 3. Cache Invalidation Fix (Issue 5)

### Problem

`PTAH_SYSTEM_PROMPT` and `PTAH_CORE_SYSTEM_PROMPT` are hard-concatenated into the cached `generatedPrompt` string in `buildCombinedPrompt()`. The cache key is `computeDependencyHash()` which only hashes `package.json` contents. When a developer updates the prompt constants and rebuilds, existing cached prompts still contain the old constant text.

### Solution: Composite Hash with Prompt Token Count

**Approach**: Include `PTAH_CORE_SYSTEM_PROMPT_TOKENS` in the cache key computation.

**Why token count instead of a full hash**: The `PTAH_CORE_SYSTEM_PROMPT_TOKENS` constant is already computed at module load time (`Math.ceil(PTAH_CORE_SYSTEM_PROMPT.length / 4)`). Any meaningful change to the prompt will change its character count, which changes the token estimate. This avoids importing a crypto hash function.

**Implementation** (in `enhanced-prompts.service.ts`):

```typescript
// In runWizard(), replace line 466:
const configHash = await this.cacheService.computeDependencyHash(workspacePath);

// With:
const baseHash = await this.cacheService.computeDependencyHash(workspacePath);
const configHash = baseHash ? `${baseHash}:pt${PTAH_CORE_SYSTEM_PROMPT_TOKENS}` : null;
```

**Why this works**:

- If `PTAH_CORE_SYSTEM_PROMPT` changes, `PTAH_CORE_SYSTEM_PROMPT_TOKENS` changes (it's derived from `.length`).
- The composite hash `"<pkg-hash>:pt<token-count>"` will differ from the stored `configHash`.
- `getStatus()` compares `state.configHash === dependencyHash` — the mismatch triggers "Project configuration changed".
- No changes needed to `PromptCacheService` itself.

**PTAH_SYSTEM_PROMPT staleness is automatically resolved**: After Change 3a, `PTAH_SYSTEM_PROMPT` is no longer concatenated into the cached prompt. It is only used in tool descriptions which are not cached.

### Also: Bump CACHE_CONFIG_VERSION

In `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/cache-invalidation.ts`, bump:

```typescript
export const CACHE_CONFIG_VERSION = '2.0.0'; // was '1.0.0'
```

This forces a full cache clear for all users on upgrade, ensuring no one runs with stale prompts after this restructuring.

---

## 4. Config Changes

### enhanced-prompts.types.ts

| Field       | Old Value | New Value | Rationale                                                                                   |
| ----------- | --------- | --------- | ------------------------------------------------------------------------------------------- |
| `maxTokens` | 2000      | 4000      | Reclaimed ~1,800 tokens from PTAH_SYSTEM_PROMPT removal + ~1,165 from PTAH_CORE compression |

### cache-invalidation.ts

| Field                  | Old Value | New Value | Rationale                                         |
| ---------------------- | --------- | --------- | ------------------------------------------------- |
| `CACHE_CONFIG_VERSION` | `'1.0.0'` | `'2.0.0'` | Force cache invalidation for all users on upgrade |

### No new config fields needed.

The conditional loading strategy (Issue 6) is achieved through architectural changes (moving content to tool descriptions) rather than new configuration — keeping it simple.

---

## 5. Risk Assessment

### What Could Break

| Risk                                                                                                | Severity | Mitigation                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claude stops using ptah MCP tools** because routing moved from system prompt to tool descriptions | HIGH     | The unified tool routing section in PTAH_CORE still contains the ptah tool preference table. The tool descriptions themselves contain detailed API docs. Test by running a session and verifying ptah_search_files is preferred over Glob. |
| **AskUserQuestion stops being used** because schema removed from system prompt                      | MEDIUM   | Keep a one-line reminder in system prompt. The SDK already puts tool schemas in the tool list. Test by asking Claude to make a choice and verifying it uses the tool.                                                                      |
| **Cached prompts become stale for existing users**                                                  | LOW      | CACHE_CONFIG_VERSION bump forces full cache invalidation. Users will auto-regenerate on next session.                                                                                                                                      |
| **Project guidance truncation persists** if LLM generator doesn't use the new 4000-token budget     | LOW      | The PromptDesignerAgent receives `tokenBudget` from config. Increasing maxTokens to 4000 is sufficient. Verify by checking generated prompt length after regeneration.                                                                     |
| **execute_code tool description becomes too long** with full PTAH_SYSTEM_PROMPT embedded            | LOW      | After PTAH_SYSTEM_PROMPT compression (File 2), it drops from ~1,823 to ~1,200 tokens. The tool description was already long; this makes it shorter.                                                                                        |
| **getProjectGuidanceContent() extraction breaks** because project guidance moves position           | LOW      | The method searches for `'## Project-Specific Guidance'` marker (line 650). This marker is preserved in the new structure. No change needed.                                                                                               |

### Verification Checklist

1. **Token counts**: After changes, measure actual token counts of PTAH_CORE_SYSTEM_PROMPT and a full assembled prompt. Verify PTAH_CORE is ~2,500 tokens and total is ~6,500-7,000.
2. **Tool routing**: Start a new session with MCP enabled. Ask "find all TypeScript files." Verify Claude uses ptah_search_files, not Glob or Bash find.
3. **execute_code framing**: Ask Claude to analyze a file's structure. Verify it uses `execute_code` with `ptah.ast.analyze()` without hesitation.
4. **Cache invalidation**: Edit PTAH_CORE_SYSTEM_PROMPT (add a comment). Verify the next session detects cache staleness.
5. **Project guidance**: Run the setup wizard. Verify the generated prompt's project guidance section is longer than before (~3,000+ tokens vs ~1,500).
6. **AskUserQuestion**: Ask Claude a question that requires a choice. Verify it uses the AskUserQuestion tool.
7. **getProjectGuidanceContent()**: Verify CLI agent delegation still extracts project guidance correctly (used by ptah_agent_spawn to pass project context to CLI agents).

---

## 6. Header Count Reduction (Issue 7)

### Current State

59 markdown headers across the assembled prompt (1 header every ~8 lines).

### Target

Reduce to ~25 headers by:

1. **Eliminating standalone 2-line sections**: "Professional Objectivity", "No Time Estimates" become bullet points under "Doing Tasks". (-2 headers)
2. **Removing horizontal rules**: 11 `---` separators between sections removed. These serve no purpose for the model. (-0 headers, but reduces visual fragmentation)
3. **Merging Git subsections**: "Git Safety Protocol", "Commit Workflow", "Important Git Notes", "PR Workflow", "PR Format" become a single "Git & PR" section. (-4 headers)
4. **Removing AskUserQuestion subsections**: "Tool Schema", "WRONG", "CORRECT", "Rules" all move to tool description. (-4 headers)
5. **Merging Tool Usage subsections**: "Tool Usage Policy", "Ptah MCP Tool Preference" merge into unified "Tool Routing". (-1 header)
6. **Removing PTAH_SYSTEM_PROMPT from system prompt**: Eliminates ~15 headers from MCP docs. (-15 headers)
7. **Compressing Orchestration subsections**: "Task Type Detection", "Workflow Depth Selection", "Delegation to Specialist Agents", "Orchestration Rules", "When NOT to Orchestrate" become a single "Orchestration" section with inline tables. (-4 headers)

**Estimated result**: ~25-30 headers (down from 59).

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: All 6 files are TypeScript constants and services in backend libraries. No UI/frontend work. The changes are primarily string constant rewrites and service method modifications.

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Files**: 6 files modified, 0 created

### Critical Verification Points

1. `PTAH_CORE_SYSTEM_PROMPT` token count must be verified after rewrite (~2,500 target)
2. `buildCombinedPrompt()` must preserve the `## Project-Specific Guidance` marker for `getProjectGuidanceContent()` extraction
3. `buildExecuteCodeDescription()` must still embed PTAH_SYSTEM_PROMPT (now leaner)
4. The PTAH_SYSTEM_PROMPT import must be removed from `enhanced-prompts.service.ts` but NOT from `tool-description.builder.ts` or `sdk-query-options-builder.ts`
5. `sdk-query-options-builder.ts` also imports PTAH_SYSTEM_PROMPT — check if it needs updates (it may inject PTAH_SYSTEM_PROMPT for non-enhanced-prompt sessions; if so, that injection point should also be reviewed for the same architectural changes)

### Files Affected Summary

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` (rewrite constant)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` (restructure constant)
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` (modify buildCombinedPrompt, add version hash)
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts` (increase maxTokens)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (update framing text)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` (update help overview)
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/cache-invalidation.ts` (bump version)

### Dependency Note: sdk-query-options-builder.ts

The file `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` imports both `PTAH_CORE_SYSTEM_PROMPT` (line 48) and `PTAH_SYSTEM_PROMPT` (line 49). This file builds query options for NON-enhanced-prompt sessions (when the user hasn't run the setup wizard). It likely concatenates these same constants for the base case. The developer should verify this file's behavior and ensure:

- Non-enhanced sessions also benefit from the restructured prompts
- PTAH_SYSTEM_PROMPT is NOT concatenated into the system prompt in this path either (it should only appear in tool descriptions)
- If this file does concatenate PTAH_SYSTEM_PROMPT into system prompt, apply the same removal pattern
