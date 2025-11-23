# Requirements Document - TASK_2025_017

## Introduction

This task addresses the integration and completion of two new backend libraries (llm-abstraction and template-generation) that were scaffolded in TASK_2025_015. The business value is to enable Ptah extension users to leverage LLM capabilities within VS Code and deploy template-based project scaffolding through a unified interface. This integration transforms Ptah from a CLI wrapper into an intelligent project assistant with LLM-powered features and template deployment capabilities.

## Requirements

### Requirement 1: Template-Generation Library Dependency Fixes

**User Story:** As a developer integrating the template-generation library, I want all TypeScript compilation errors resolved, so that the library can be built and imported without errors.

#### Acceptance Criteria

1. WHEN the template-generation library is compiled THEN it SHALL build successfully with zero TypeScript errors
2. WHEN FileSystemService is referenced THEN it SHALL be replaced with FileSystemManager from @ptah-extension/vscode-core
3. WHEN WorkspaceAnalyzerService is referenced THEN it SHALL be replaced with WorkspaceService methods from @ptah-extension/workspace-intelligence
4. WHEN barrel exports are processed THEN paths SHALL be corrected from './interfaces' to './lib/interfaces'
5. WHEN all fixes are applied THEN nx build vscode-lm-tools SHALL execute without errors

**Technical Details:**

- Files affected:
  - `libs/backend/template-generation/src/lib/services/template-file-manager.service.ts` (line 4, 16)
  - `libs/backend/template-generation/src/lib/services/template-manager.service.ts` (line 4, 19)
  - `libs/backend/template-generation/src/lib/services/template-generator.service.ts` (line 4, 22-23)
  - `libs/backend/template-generation/src/index.ts` (line 7)
- Import corrections:
  - Replace: `FileSystemService` from @ptah-extension/vscode-core
  - Use: `FileSystemManager` from @ptah-extension/vscode-core
  - Replace: `WorkspaceAnalyzerService` from @ptah-extension/workspace-intelligence
  - Use: `WorkspaceService` methods (getWorkspaceRoot, analyzeWorkspace)

### Requirement 2: LLM Tools Design and Implementation in vscode-lm-tools

**User Story:** As a Claude CLI user, I want access to LLM provider tools through the vscode-lm-tools MCP server, so that I can generate LLM completions using various providers (Anthropic, OpenAI, GoogleGenAI, OpenRouter) directly from Claude CLI.

#### Acceptance Criteria

1. WHEN Claude CLI calls tools/list on vscode-lm-tools MCP server THEN it SHALL return both execute_code AND new LLM tools
2. WHEN a tool is invoked with provider configuration THEN it SHALL initialize the llm-abstraction LlmService with the specified provider
3. WHEN a completion request is made THEN it SHALL use LlmService.getCompletion() and return the result via MCP protocol
4. WHEN a structured completion request is made THEN it SHALL use LlmService.getStructuredCompletion() with Zod schema and return parsed result
5. WHEN API keys are required THEN they SHALL be retrieved from VS Code secrets storage (SecretStorage API)

**Proposed Tool Design (requires validation):**

**Option A: Provider-Specific Tools (Recommended)**

- `llm_completion_anthropic`: Text completion via Anthropic provider
- `llm_completion_openai`: Text completion via OpenAI provider
- `llm_completion_openrouter`: Text completion via OpenRouter provider
- `llm_completion_google`: Text completion via Google GenAI provider
- `llm_structured_completion`: Structured output with Zod schema (auto-detects provider)

**Benefits:**

- Clear tool naming (Claude CLI users know which provider)
- Explicit provider selection
- Separate rate limiting per provider
- Easy to add provider-specific features

**Option B: Generic Tool with Provider Parameter**

- `llm_completion`: Single tool with provider parameter (anthropic|openai|openrouter|google-genai)
- `llm_structured_completion`: Single structured tool with provider parameter

**Benefits:**

- Fewer tools to maintain
- Uniform interface
- Dynamic provider switching

**Tool Input Schema (for all LLM tools):**

```typescript
{
  systemPrompt: string;           // System-level instruction
  userPrompt: string;             // User's actual prompt
  model?: string;                 // Optional model override (e.g., "gpt-4", "claude-3-5-sonnet-20241022")
  temperature?: number;           // 0-1, defaults to 0.7
  maxTokens?: number;            // Output token limit
  // For structured completion only:
  schema?: object;               // Zod schema as JSON (for llm_structured_completion)
}
```

### Requirement 3: Template Deployment System Implementation

**User Story:** As a Ptah extension user, I want to deploy Ptah templates to my workspace via `ptah.enableSuperpowers` command, so that I have access to Ptah's agent system and orchestration workflows in my project.

#### Acceptance Criteria

1. WHEN user executes `ptah.enableSuperpowers` command THEN the system SHALL analyze the workspace for existing .claude setup
2. WHEN existing .claude files are detected THEN the system SHALL identify potential conflicts with ptah-\* namespace
3. WHEN conflicts are identified THEN the system SHALL present a deployment preview to the user with conflict resolution options
4. WHEN user confirms deployment THEN the system SHALL deploy templates atomically with rollback capability
5. WHEN deployment completes THEN the system SHALL validate that all ptah-\* files are present and CLAUDE.md is updated
6. WHEN deployment fails THEN the system SHALL rollback changes and report errors to the user

**Template Deployment Architecture (based on ptah-template-system-architecture.md):**

**Services to Implement:**

1. **TemplateManagerService**

   - Load templates from extension bundle (`src/templates/claude-templates/`)
   - Validate template structure
   - Provide template registry for discovery

2. **DeploymentService**

   - Orchestrate deployment workflow (analysis → preview → deploy → validate)
   - Implement atomic deployment with rollback
   - Handle file copy operations via FileSystemManager

3. **ConflictResolverService**
   - Detect existing .claude setup in workspace
   - Identify namespace conflicts (ptah-\* vs existing files)
   - Implement CLAUDE.md smart merging (append Ptah section)
   - Provide conflict resolution strategies

**Deployment Workflow:**

```
Phase 1: Workspace Analysis
  - Detect workspace root
  - Check for existing .claude directory
  - Identify existing agents, commands, docs

Phase 2: Conflict Detection
  - Compare existing files vs ptah-* templates
  - Analyze CLAUDE.md for Ptah section
  - Build conflict resolution plan

Phase 3: User Confirmation
  - Show deployment preview (files to create, files to merge)
  - Display conflict resolution strategy
  - Get user approval

Phase 4: Atomic Deployment
  - Create .claude directory structure if missing
  - Copy ptah-* agents to .claude/agents/
  - Copy ptah-* commands to .claude/commands/
  - Merge or create CLAUDE.md with Ptah section
  - Store rollback data (backup of modified files)

Phase 5: Validation
  - Verify all template files deployed
  - Validate CLAUDE.md contains Ptah section
  - Test ptah-* commands accessibility
  - Report deployment summary
```

**Template Bundle Structure:**

```
src/templates/claude-templates/
├── agents/
│   ├── ptah-manager.md
│   ├── ptah-developer.md
│   ├── ptah-architect.md
│   ├── ptah-tester.md
│   ├── ptah-reviewer.md
│   └── ptah-researcher.md
├── commands/
│   ├── ptah-orchestrate.md
│   ├── ptah-review-code.md
│   ├── ptah-analyze.md
│   └── ptah-help.md
└── docs/
    └── ptah-framework.md
```

## Non-Functional Requirements

### Performance Requirements

- **LLM Tool Response Time**: 95% of LLM completion requests under 5000ms (excluding LLM API latency), 99% under 10000ms
- **Template Deployment Time**: 95% of deployments under 2000ms for workspaces with <50 existing files
- **Build Time**: template-generation library build time < 10 seconds
- **Memory Usage**: LLM tools memory overhead < 50MB per active provider instance

### Security Requirements

- **API Key Storage**: ALL LLM provider API keys SHALL be stored in VS Code SecretStorage (never in plaintext)
- **API Key Transmission**: API keys SHALL be transmitted only to configured LLM provider endpoints
- **Template Validation**: Deployed templates SHALL be validated for malicious content before deployment
- **Rollback Safety**: Deployment rollback SHALL preserve user data and not delete user-created files

### Reliability Requirements

- **Error Handling**: ALL LLM provider errors SHALL use Result<T, E> pattern for type-safe error handling
- **Template Deployment Rollback**: 100% of failed deployments SHALL rollback to pre-deployment state
- **MCP Server Availability**: vscode-lm-tools MCP server SHALL maintain 99% uptime during extension session
- **Provider Failover**: LLM tools SHALL gracefully handle provider API failures with clear error messages

### Scalability Requirements

- **Multiple Providers**: System SHALL support 4+ concurrent LLM provider instances (one per provider type)
- **Template Capacity**: Template system SHALL support 100+ template files without performance degradation
- **Concurrent Requests**: MCP server SHALL handle 10+ concurrent LLM tool requests

## Integration Points

### vscode-core Integration

- **FileSystemManager**: Used by template-generation for file operations (read, write, copy)
- **Logger**: Used by all services for structured logging
- **DI Container**: All services registered via tsyringe tokens
- **SecretStorage**: Used by LLM tools to retrieve API keys

### workspace-intelligence Integration

- **WorkspaceService**: Used by template-generation for workspace analysis
  - `getWorkspaceRoot()`: Get workspace root path
  - `analyzeWorkspace()`: Get project context for template generation

### llm-abstraction Integration

- **LlmService**: Facade for LLM operations
  - `setProvider(name, apiKey, model)`: Initialize provider
  - `getCompletion(systemPrompt, userPrompt)`: Text completion
  - `getStructuredCompletion(prompt, schema, config)`: Structured output
- **ProviderRegistry**: Creates provider instances (Anthropic, OpenAI, GoogleGenAI, OpenRouter)

### vscode-lm-tools MCP Server Integration

- **CodeExecutionMCP Service**: HTTP MCP server infrastructure
  - Extend `handleToolsList()` to include new LLM tools
  - Add new handlers for LLM tool invocations
  - Use existing MCP JSON-RPC 2.0 protocol

### VS Code Extension Integration

- **Command Registration**: `ptah.enableSuperpowers` command handler
- **Webview Communication**: Deployment preview UI (optional in future phase)
- **Status Bar**: Deployment progress indicator (optional in future phase)

## Acceptance Criteria

### Phase 1: Dependency Fixes (template-generation)

- [ ] All TypeScript compilation errors resolved in template-generation library
- [ ] `nx build template-generation` executes successfully
- [ ] All tests pass: `nx test template-generation`
- [ ] No import errors when template-generation is imported by other libraries

### Phase 2: LLM Tools Implementation (vscode-lm-tools)

- [ ] LLM tools appear in `tools/list` MCP response
- [ ] Tool invocations successfully call llm-abstraction LlmService
- [ ] API keys retrieved from VS Code SecretStorage
- [ ] Text completions return valid MCP responses
- [ ] Structured completions return parsed Zod schema results
- [ ] Error handling uses Result<T, E> pattern
- [ ] All tests pass: `nx test vscode-lm-tools`

### Phase 3: Template Deployment System

- [ ] TemplateManagerService loads templates from extension bundle
- [ ] DeploymentService successfully deploys templates to workspace
- [ ] ConflictResolverService detects existing .claude setup
- [ ] `ptah.enableSuperpowers` command triggers deployment workflow
- [ ] User sees deployment preview before confirmation
- [ ] Atomic deployment with rollback capability
- [ ] All ptah-\* files deployed to .claude/ directory
- [ ] CLAUDE.md updated with Ptah section (or created if missing)
- [ ] Deployment validation confirms success
- [ ] All tests pass for new services

## Constraints

### Technical Constraints

- Must follow existing MCP pattern from TASK_2025_016 (CodeExecutionMCP service)
- Must use existing DI container (tsyringe) for service registration
- Must respect layered architecture (vscode-lm-tools → llm-abstraction → langchain providers)
- Must use Result<T, E> pattern for all error handling
- No separate MCP server for llm-abstraction (it's a library, not a server)
- Must use FileSystemManager (not FileSystemService) from vscode-core
- Must use WorkspaceService (not WorkspaceAnalyzerService) from workspace-intelligence

### Dependency Constraints

- llm-abstraction depends on: @langchain/core, @langchain/anthropic, @langchain/openai, @langchain/google-genai, zod
- template-generation depends on: vscode-core, workspace-intelligence, shared
- vscode-lm-tools depends on: vscode-core, llm-abstraction (new dependency to add)

### Performance Constraints

- Template deployment must complete in <2s for typical workspaces
- LLM tools must not block MCP server (async execution required)
- Memory overhead for LLM providers must be <50MB per provider

### Security Constraints

- API keys NEVER stored in plaintext (VS Code SecretStorage only)
- Templates validated before deployment (no malicious content)
- Rollback must preserve user data (no destructive operations without backup)

## Out of Scope

### Explicitly NOT Included in This Task

- **UI Components**: No Angular webview components for template management (future enhancement)
- **Template Updates**: No mechanism to update deployed templates (future enhancement)
- **MCP Configuration Management**: No .mcp.json editing UI (future enhancement)
- **Multi-Workspace Support**: Only single workspace deployment (future enhancement)
- **Template Customization**: No user-editable template variables (future enhancement)
- **Provider Auto-Discovery**: No automatic provider detection based on available API keys
- **Streaming Completions**: No streaming support for LLM tools (future enhancement)
- **Token Counting Tools**: No dedicated tools for token counting (available via LlmService but not exposed as MCP tool)
- **Model Listing Tools**: No tools to list available models per provider (future enhancement)

## Dependencies

### Upstream Dependencies (must exist before this task)

- ✅ @ptah-extension/shared - Type system and Result<T, E> pattern
- ✅ @ptah-extension/vscode-core - FileSystemManager, Logger, DI container
- ✅ @ptah-extension/workspace-intelligence - WorkspaceService
- ✅ @ptah-extension/llm-abstraction - LlmService, ProviderRegistry
- ✅ @ptah-extension/template-generation - Scaffolded services (needs fixes)
- ✅ @ptah-extension/vscode-lm-tools - CodeExecutionMCP service infrastructure

### Downstream Dependencies (will depend on this task)

- Future: Angular webview components for template management UI
- Future: Template update mechanism
- Future: MCP configuration management UI

## Success Metrics

### Code Quality Metrics

- **Type Safety**: Zero `any` types in new code
- **Test Coverage**: Minimum 80% code coverage for new services
- **Build Success**: All libraries build without errors
- **Lint Success**: Zero ESLint violations in new code

### Functional Metrics

- **Template Deployment Success Rate**: 95% of deployments succeed on first attempt
- **LLM Tool Success Rate**: 90% of LLM tool invocations succeed (excluding provider API failures)
- **Rollback Success Rate**: 100% of failed deployments rollback successfully

### Performance Metrics

- **Template Deployment Time**: <2s for 90% of typical workspaces
- **LLM Tool Response Time**: <100ms overhead (excluding LLM API latency)
- **Build Time**: <10s for template-generation library

## Risk Assessment

### Technical Risks

| Risk                                          | Probability | Impact   | Mitigation Strategy                                                                                      |
| --------------------------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------- |
| LLM provider API rate limits exceeded         | Medium      | High     | Implement exponential backoff, cache completions when possible, provide clear error messages             |
| Template deployment conflicts with user files | High        | Critical | ConflictResolverService with preview + user confirmation, atomic rollback capability                     |
| API key security compromise                   | Low         | Critical | Use VS Code SecretStorage exclusively, never log API keys, validate all API calls                        |
| Memory leaks from multiple provider instances | Medium      | Medium   | Implement provider disposal, monitor memory usage, limit concurrent providers to 4                       |
| FileSystemManager API changes                 | Low         | High     | Pin vscode-core version, comprehensive integration tests, fallback to legacy FileSystemService if needed |

### Business Risks

| Risk                                     | Probability | Impact   | Mitigation Strategy                                                                       |
| ---------------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------- |
| User confusion about LLM tool usage      | Medium      | Medium   | Provide clear tool descriptions in MCP schema, add documentation to CLAUDE.md             |
| Template deployment overwrites user work | Low         | Critical | Mandatory user confirmation, rollback capability, backup of modified files                |
| Dependency on external LLM providers     | High        | Medium   | Support multiple providers for redundancy, graceful degradation with clear error messages |

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder          | Impact Level | Involvement      | Success Criteria                                              |
| -------------------- | ------------ | ---------------- | ------------------------------------------------------------- |
| Ptah Extension Users | High         | Testing/Feedback | Successful template deployment, functional LLM tools          |
| Claude CLI Users     | High         | MCP Tool Usage   | LLM tools accessible via Claude CLI, clear tool documentation |
| Development Team     | High         | Implementation   | Clean architecture, maintainable code, comprehensive tests    |

### Secondary Stakeholders

| Stakeholder            | Impact Level | Involvement         | Success Criteria                                       |
| ---------------------- | ------------ | ------------------- | ------------------------------------------------------ |
| VS Code Extension Host | Medium       | Runtime Environment | No performance degradation, stable extension operation |
| LLM Provider APIs      | Medium       | External Dependency | Successful API integrations, proper error handling     |

## Open Questions for Validation

1. **LLM Tool Design**: Should we use Option A (provider-specific tools) or Option B (generic tool with provider parameter)?
2. **API Key Management**: Should API keys be configured per-workspace or globally (user-level)?
3. **Template Deployment Scope**: Should deployment be workspace-scoped only, or support multi-root workspaces?
4. **Conflict Resolution Strategy**: For CLAUDE.md conflicts, should we append Ptah section or offer merge options?
5. **Rollback Granularity**: Should rollback be all-or-nothing, or allow partial rollback of individual files?

## Implementation Notes

### Recommended Implementation Order

1. **Phase 1**: Fix template-generation dependencies (1-2 hours)
2. **Phase 2**: Implement LLM tools in vscode-lm-tools (4-6 hours)
3. **Phase 3**: Implement template deployment system (8-12 hours)

### Testing Strategy

- **Unit Tests**: All services with 80%+ coverage
- **Integration Tests**: MCP server with LLM tools
- **E2E Tests**: Template deployment workflow in test workspace

### Documentation Requirements

- Update vscode-lm-tools CLAUDE.md with LLM tool documentation
- Update template-generation CLAUDE.md with deployment workflow
- Add user guide for ptah.enableSuperpowers command
