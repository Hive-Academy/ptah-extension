# Task Context for TASK_2025_020

## User Intent

Remove provider abstraction layer (multi-provider support) while preserving and redesigning model selection to work directly with Claude CLI's native `--model` flag. Execute in two systematic phases:

1. **Phase 1**: Model Selection Redesign - Implement direct Claude CLI model management
2. **Phase 2**: Provider Abstraction Removal - Clean up multi-provider infrastructure

## Conversation Summary

### Key Decisions Made

1. **Provider Abstraction is Obsolete**:

   - Frontend hardcoded to Claude CLI only
   - VS Code LM API used internally as MCP tool (not user-facing provider)
   - Multi-provider UI/backend adds unnecessary complexity
   - ~35+ files, ~3000 lines of code to remove

2. **Model Selection Must Be Preserved**:

   - Claude CLI natively supports `--model` flag (per-session)
   - Current implementation WRONG: Goes through provider abstraction
   - Correct architecture: Direct model configuration + CLI flag
   - Must support both current session and future session defaults

3. **Current Architecture Problems**:

   ```
   WRONG: User → PROVIDER_MESSAGE_TYPES.SELECT_MODEL → ProviderOrchestrationService → provider.getAvailableModels()
   RIGHT: User → CLAUDE_MESSAGE_TYPES.SET_MODEL → ClaudeModelService → config storage + --model flag
   ```

4. **Evidence from Validation**:
   - Claude CLI: `claude --model sonnet` (supports aliases and full names)
   - Session metadata already tracks model: `ClaudeSessionInfo { model: string }`
   - CLI launcher already implements: `args.push('--model', model)` at line 191
   - TASK_2025_012 Batch 4 becomes obsolete (provider-based model selection removed)

### Technical Constraints

1. **No Multi-Provider UI**: Users should never see provider selection
2. **Model Selection Per-Session**: Each session can have different model
3. **Default Model Config**: Store preference for future sessions
4. **Available Models**: Hardcoded list (Claude CLI doesn't expose API)
5. **Git Compliance**: Follow commitlint rules (type, scope, subject format)

### Referenced Files and Components

**Frontend (To Remove)**:

- `libs/frontend/providers/` - Entire library (5 components, settings panel)
- `libs/frontend/core/src/lib/services/provider.service.ts` - 550 lines

**Backend (To Modify/Remove)**:

- `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts` - 800 lines to remove
- `libs/backend/ai-providers-core/` - Simplify (keep Claude CLI adapter only)
- `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:191` - Already supports --model flag

**Shared (To Modify)**:

- `libs/shared/src/lib/constants/message-types.ts` - Remove PROVIDER_MESSAGE_TYPES, add CLAUDE_MESSAGE_TYPES
- `libs/shared/src/lib/types/message.types.ts` - Remove provider payloads (~200 lines)

**Apps (To Update)**:

- `apps/ptah-extension-webview/src/app/app.ts` - Remove ProviderService initialization
- `apps/ptah-extension-vscode/src/di/container.ts` - Remove provider DI registration

## Technical Context

- **Branch**: feature/TASK_2025_020
- **Created**: 2025-11-23
- **Task Type**: REFACTORING (architecture simplification)
- **Complexity**: Complex (multi-library changes, message protocol redesign)
- **Estimated Duration**: 12-16 hours

## Execution Strategy

**Strategy 3: REFACTORING (Focused)** with modifications:

```
Phase 1: software-architect → Creates implementation-plan.md
         (Covers BOTH Phase 1 and Phase 2 in detail)
         ↓
         USER VALIDATION ✋ (Ask: "APPROVED ✅ or provide feedback")
         ↓
Phase 2a: team-leader MODE 1 (DECOMPOSITION) → Creates tasks.md
         (Breaks into Phase 1 tasks THEN Phase 2 tasks)
         ↓
Phase 2b: team-leader MODE 2 (ITERATIVE LOOP) → For each task:
         - Assigns task to appropriate developer (backend/frontend)
         - Developer implements, commits git
         - team-leader verifies git commit + files + tasks.md
         - Repeat for next task
         ↓
Phase 2c: team-leader MODE 3 (COMPLETION) → Final verification
         ↓
         USER CHOICE ✋ (Ask: "tester (regression), reviewer, both, or skip?")
         ↓
Phase 3: [USER CHOICE] senior-tester (regression) and/or code-reviewer
         ↓
Phase 4: USER handles git (branch, commit, push, PR)
         ↓
Phase 5: modernization-detector → Creates future-enhancements.md, updates registry
```

## Phase Breakdown

### Phase 1: Model Selection Redesign (NEW Implementation)

**Objective**: Direct Claude CLI model management without provider abstraction

**Key Deliverables**:

1. `ClaudeModelService` - Backend model preference management
2. `CLAUDE_MESSAGE_TYPES` - New message types (getAvailableModels, getCurrentModel, setModel, modelChanged)
3. `ModelSelectorDropdownComponent` - Frontend UI component
4. Message handlers for model operations
5. Integration in chat UI header

**Success Criteria**:

- Model selector dropdown visible in chat header
- User can select model (sonnet, opus, haiku)
- Selection persists to config for future sessions
- Current session uses selected model on next message
- No provider abstraction involved

### Phase 2: Provider Abstraction Removal (Cleanup)

**Objective**: Remove all multi-provider infrastructure

**Key Deletions**:

1. `libs/frontend/providers/` - Entire library
2. `ProviderService` from frontend core
3. `ProviderOrchestrationService` from backend
4. Multi-provider manager, strategies from `ai-providers-core`
5. `PROVIDER_MESSAGE_TYPES` (14 message types)
6. Provider payload interfaces (~200 lines)

**Success Criteria**:

- No provider UI visible
- All provider message types removed
- TypeScript builds with 0 errors
- Extension launches without provider errors
- Chat works with Claude CLI only
- Model selection works independently

## Quality Gates

1. **Type Safety**: All TypeScript builds pass
2. **Runtime Verification**: Extension launches without errors
3. **Functional Testing**: Model selection works end-to-end
4. **Regression Testing**: Chat functionality unchanged
5. **Git Standards**: All commits follow commitlint rules

## Notes

- **CRITICAL**: Phase 1 must complete BEFORE Phase 2 to avoid breaking model selection
- **Evidence-Based**: All changes validated against Claude CLI capabilities
- **User Approval Required**: Architecture plan needs user validation before implementation
- **Regression Risk**: Minimal - removing unused abstraction layer
