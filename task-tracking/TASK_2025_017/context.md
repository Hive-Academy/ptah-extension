# TASK_2025_017: Template System & LLM Tools Integration

## User Intent

Fix and integrate the new libraries (llm-abstraction and template-generation) with the Ptah extension:

1. **Fix template-generation dependencies** - Replace non-existent services with correct ones
2. **Create LLM tools in vscode-lm-tools** - Add tools that utilize llm-abstraction (NOT a separate MCP server)
3. **Implement template deployment system** - Backend for ptah-template-system-architecture.md

## Background Context

### Previous Work (TASK_2025_015)

- Migrated 28 files from roocode-generator
- Created two new libraries:
  - `@ptah-extension/llm-abstraction` - Multi-provider LLM abstraction (Anthropic, OpenAI, GoogleGenAI, OpenRouter)
  - `@ptah-extension/template-generation` - Template generation system
- Libraries scaffolded but NOT integrated

### Current State

- **template-generation**: Has compilation errors due to wrong dependencies

  - Using non-existent `FileSystemService` (should use `FileSystemManager`)
  - Using non-existent `WorkspaceAnalyzerService` methods (should use `WorkspaceService`)
  - Barrel export paths incorrect (`./interfaces` should be `./lib/interfaces`)

- **llm-abstraction**: Has type errors but structure is good

  - 4 providers implemented (Anthropic, OpenAI, GoogleGenAI, OpenRouter)
  - LlmService facade for provider management
  - Result<T, E> pattern for error handling

- **vscode-lm-tools**: Already has MCP server infrastructure
  - CodeExecutionMCP service (TASK_2025_016 pattern)
  - HTTP MCP server on localhost
  - Needs NEW tools that use llm-abstraction

### Architecture Clarification

**CORRECTED Understanding** (from user):

1. **llm-abstraction** → Backend library used BY vscode-lm-tools

   - NOT a separate MCP server
   - Provides Langchain/OpenRouter abstraction
   - Used by new tools in vscode-lm-tools

2. **vscode-lm-tools** → Single MCP server with multiple tools

   - Existing: `execute_code` tool
   - NEW: LLM-related tools that call llm-abstraction
   - Pattern: One MCP server, many tools

3. **template-generation** → Extension feature (NOT MCP tool)
   - Implements ptah-template-system-architecture.md
   - Command: `ptah.enableSuperpowers`
   - Deploys .claude templates to workspace

## Key Deliverables

### 1. Fix template-generation Dependencies

- Replace `FileSystemService` → `FileSystemManager`
- Replace `WorkspaceAnalyzerService` → `WorkspaceService`
- Fix barrel export paths in index.ts
- Fix all TypeScript compilation errors

### 2. Create LLM Tools in vscode-lm-tools

- Design: Which tools? (langchain_call, generate_with_openrouter, etc.)
- Implement tools that use llm-abstraction services
- Register tools in existing CodeExecutionMCP server
- Handle API key configuration (VS Code secrets)

### 3. Implement Template Deployment System

- Follow ptah-template-system-architecture.md design
- Services: TemplateManagerService, DeploymentService, ConflictResolverService
- Workflow: Workspace analysis → Conflict detection → User confirmation → Deployment
- Command: `ptah.enableSuperpowers` to deploy templates

## Technical Constraints

- Must follow existing MCP pattern (TASK_2025_016)
- Must use existing DI container registration
- Must respect layered architecture
- Must use Result<T, E> pattern for error handling
- No separate MCP server for llm-abstraction

## Files to Reference

- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` - MCP pattern
- `libs/backend/template-generation/src/` - Services to fix
- `libs/backend/llm-abstraction/src/` - LLM providers
- `docs/ptah-template-system-architecture.md` - Template system design
- `D:/projects/roocode-generator/src/memory-bank/` - Reference patterns

## Success Criteria

1. ✅ template-generation builds without errors
2. ✅ New LLM tools registered in vscode-lm-tools MCP server
3. ✅ `ptah.enableSuperpowers` command deploys templates
4. ✅ Claude CLI can call LLM tools via MCP
5. ✅ Template deployment workflow works end-to-end

## Date Created

2025-11-23
