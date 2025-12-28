# Requirements Document - TASK_2025_035

## Introduction

The ChatInputComponent currently has UI controls for model selection (dropdown with Claude Opus 4.0, Sonnet 4.0, Haiku 3.5) and autopilot toggle, but these controls are not connected to the backend. This task implements the full integration to enable users to dynamically switch AI models and control permission behavior during chat sessions.

### Business Context

Model selection and autopilot features are core UX enhancements that provide:

- **User Control**: Direct control over AI model cost/performance tradeoffs
- **Workflow Flexibility**: Ability to enable autopilot for rapid iteration workflows
- **Production Parity**: Matching Claude CLI's model and permission features in the VS Code UI

## Requirements

### Requirement 1: Model Selection Integration

**User Story:** As a user chatting with Claude, I want to select which AI model to use (Opus, Sonnet, or Haiku), so that I can balance cost, speed, and capability based on my task needs.

#### Acceptance Criteria

1. WHEN user selects a model from the dropdown THEN the selection SHALL persist in the frontend state and be visually reflected in the UI
2. WHEN user sends a new message with a non-default model selected THEN the ClaudeProcess SHALL be spawned with the `--model` CLI flag set to the selected model
3. WHEN model selection changes THEN the new model SHALL be stored in workspace configuration and persist across webview reloads
4. WHEN user switches between sessions THEN each session SHALL maintain its own model selection independently
5. WHEN ClaudeProcess starts THEN it SHALL use `--model opus` for Opus, `--model haiku` for Haiku, and omit flag for Sonnet (default)

### Requirement 2: Autopilot Toggle Integration

**User Story:** As a user working on repetitive tasks, I want to enable autopilot mode, so that Claude can execute file edits and commands without requiring manual approval for each action.

#### Acceptance Criteria

1. WHEN user toggles autopilot ON THEN the autopilot state SHALL be stored in frontend state and synced with backend
2. WHEN autopilot is enabled THEN subsequent ClaudeProcess invocations SHALL include appropriate permission flags based on the permission level
3. WHEN user sends a message with autopilot OFF THEN ClaudeProcess SHALL use default permission behavior (ask for confirmation)
4. WHEN user sends a message with autopilot ON (auto-edit level) THEN ClaudeProcess SHALL include `--allowedTools Edit,Write` flag
5. WHEN user sends a message with autopilot ON (yolo level) THEN ClaudeProcess SHALL include `--dangerously-skip-permissions` flag
6. WHEN autopilot state changes THEN the toggle UI SHALL immediately reflect the new state

### Requirement 3: Frontend State Management

**User Story:** As a developer, I want frontend services to manage model and autopilot state with Angular signals, so that state changes are reactive and type-safe across the application.

#### Acceptance Criteria

1. WHEN ModelStateService is created THEN it SHALL provide signal-based state for `currentModel` and `availableModels`
2. WHEN AutopilotStateService is created THEN it SHALL provide signal-based state for `enabled` and `permissionLevel`
3. WHEN ChatInputComponent mounts THEN it SHALL inject both state services and bind UI controls to their signals
4. WHEN model or autopilot state changes THEN all dependent components SHALL reactively update via signal subscription
5. WHEN state services initialize THEN they SHALL load persisted state from workspace configuration (if available)

### Requirement 4: Backend RPC Handlers

**User Story:** As a system integrator, I want RPC handlers for model and autopilot operations, so that frontend state changes can be persisted and applied to CLI invocations.

#### Acceptance Criteria

1. WHEN frontend calls `model:switch` RPC THEN backend SHALL validate model name against allowed values (`opus`, `sonnet`, `haiku`)
2. WHEN `model:switch` validation passes THEN backend SHALL store model preference in workspace configuration
3. WHEN frontend calls `autopilot:toggle` RPC THEN backend SHALL validate permission level against allowed values (`ask`, `auto-edit`, `yolo`)
4. WHEN `autopilot:toggle` validation passes THEN backend SHALL store autopilot preference in workspace configuration
5. WHEN RPC handlers fail validation THEN they SHALL return structured error responses with clear error messages

### Requirement 5: ClaudeProcess Integration

**User Story:** As a backend developer, I want ClaudeProcess to respect model and autopilot configuration, so that CLI invocations match user preferences.

#### Acceptance Criteria

1. WHEN `chat:start` or `chat:continue` RPC is called THEN backend SHALL read current model and autopilot settings from workspace configuration
2. WHEN building ClaudeProcess arguments THEN backend SHALL add `--model <model>` flag if model is not default (sonnet)
3. WHEN building ClaudeProcess arguments with autopilot enabled (auto-edit) THEN backend SHALL add `--allowedTools Edit,Write` flag
4. WHEN building ClaudeProcess arguments with autopilot enabled (yolo) THEN backend SHALL add `--dangerously-skip-permissions` flag
5. WHEN ClaudeProcess spawns THEN it SHALL log the full command with flags for debugging purposes

## Non-Functional Requirements

### Performance Requirements

- **State Update Latency**: Model/autopilot state changes must reflect in UI within 50ms
- **RPC Response Time**: `model:switch` and `autopilot:toggle` RPC calls must complete within 100ms
- **Memory Footprint**: State services must use < 1MB of heap memory

### Security Requirements

- **Input Validation**: All RPC handlers MUST validate model and permission level inputs against whitelists
- **Permission Escalation**: Autopilot "yolo" mode MUST be clearly documented as dangerous and require explicit user opt-in
- **Configuration Isolation**: Workspace configuration MUST be isolated per workspace to prevent cross-contamination

### Reliability Requirements

- **State Persistence**: Model and autopilot preferences MUST survive webview reloads and VS Code restarts
- **Graceful Degradation**: If workspace configuration fails to load, system SHALL fall back to safe defaults (sonnet model, ask permission level)
- **Error Handling**: All RPC errors MUST be caught, logged, and returned to frontend with user-friendly messages

### Maintainability Requirements

- **Service Pattern Consistency**: New state services MUST follow existing patterns from `AppStateService` (signal-based, readonly signal exposure)
- **RPC Handler Consistency**: New RPC handlers MUST follow existing patterns from `rpc-method-registration.service.ts` (try-catch, structured responses)
- **Type Safety**: All model and permission level values MUST use TypeScript literal types, not strings

## Stakeholder Analysis

### Primary Stakeholders

- **End Users**: Need intuitive controls for model selection and autopilot without technical knowledge of CLI flags
  - Success Criteria: Can switch models and toggle autopilot with 1-2 clicks, see immediate visual feedback
- **Frontend Developers**: Need clean, reactive state management with Angular signals
  - Success Criteria: State services follow established patterns, zero RxJS complexity, full TypeScript safety
- **Backend Developers**: Need to extend ClaudeProcess with new CLI flags without breaking existing chat functionality
  - Success Criteria: Changes isolated to argument building logic, comprehensive logging, backward compatible

### Secondary Stakeholders

- **QA/Testing**: Need to verify model and autopilot settings are correctly applied to CLI invocations
  - Success Criteria: Clear logging of CLI commands with flags, ability to test each permission level independently
- **Documentation Team**: Need to document autopilot permission levels and their risks
  - Success Criteria: Clear documentation of "yolo" mode risks, permission level comparison table

## Risk Analysis

### Technical Risks

| Risk                                                | Probability | Impact | Score | Mitigation Strategy                                                                              |
| --------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------ |
| Model flag syntax incompatibility with Claude CLI   | Low         | High   | 4     | Verify `--model` flag syntax against Claude CLI 0.7.x documentation; add integration test        |
| Autopilot permission flags break existing chat flow | Medium      | High   | 6     | Isolate permission flag logic in ClaudeProcess.buildArgs(); add feature flag for gradual rollout |
| Workspace configuration corruption                  | Low         | Medium | 3     | Use VS Code's Memento API with automatic fallback to defaults; add configuration validation      |
| State services introduce memory leaks               | Low         | Medium | 3     | Use Angular signal cleanup on component destroy; add memory profiling test                       |

### Business Risks

- **User Confusion Risk**: Users may not understand autopilot permission levels
  - Mitigation: Add tooltip explanations to UI, documentation link, confirmation dialog for "yolo" mode
- **Cost Risk**: Users may unknowingly use expensive Opus model
  - Mitigation: Display model cost indicator in UI, show warning when switching to Opus
- **Security Risk**: "Yolo" autopilot mode bypasses all safety checks
  - Mitigation: Require explicit opt-in, show warning banner when enabled, log all actions taken

### Integration Risks

| Risk                                                     | Probability | Impact   | Score | Mitigation Strategy                                                                         |
| -------------------------------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------------------------------- |
| Breaking existing chat:start/chat:continue RPC           | Medium      | Critical | 8     | Add optional parameters with backward-compatible defaults; comprehensive regression testing |
| Model/autopilot state not syncing across webview reloads | Medium      | Medium   | 4     | Use VS Code workspace state API for persistence; add state restoration test                 |
| Race condition between UI state and backend config       | Low         | High     | 5     | Use correlation IDs for RPC calls; implement optimistic UI updates with rollback            |

## Dependencies

### Internal Dependencies

- **ClaudeProcess** (`libs/backend/claude-domain/src/cli/claude-process.ts`): Requires modification to buildArgs() method to accept model and permission options
- **RPC Method Registration** (`libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts`): Requires new RPC handlers for `model:switch` and `autopilot:toggle`
- **ChatInputComponent** (`libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`): Requires wiring to new state services
- **Shared Types** (`libs/shared/src/lib/types/`): May require new types for ClaudeModel and PermissionLevel

### External Dependencies

- **Claude CLI**: Must support `--model <model>`, `--allowedTools <tools>`, and `--dangerously-skip-permissions` flags (verified in v0.7.x)
- **VS Code Memento API**: Required for workspace configuration persistence
- **Angular Signals**: Required for reactive state management (already in use)

### Technical Constraints

- **No Breaking Changes**: Must maintain backward compatibility with existing chat functionality
- **No New Libraries**: Must use existing Angular, VS Code, and Node.js APIs only
- **Performance Budget**: State updates must not introduce > 10ms latency to chat message sending

## Out of Scope

The following features are explicitly NOT included in this task:

1. **Per-Message Model Selection**: Switching model mid-conversation (each session uses one model)
2. **Model Cost Calculation**: Displaying token costs or price estimates
3. **Custom Permission Rules**: Fine-grained control over which tools to allow (only three preset levels)
4. **Model Auto-Selection**: AI-driven model recommendation based on task complexity
5. **Autopilot History**: Logging or auditing of actions taken in autopilot mode
6. **Multi-Model Conversations**: Using different models for different turns in same session

## Success Metrics

### Functional Success Metrics

- **Model Selection**: User can switch between all three models and see selection persist
- **Autopilot Toggle**: User can enable/disable autopilot and see state reflected in CLI behavior
- **State Persistence**: Model and autopilot preferences survive webview reload
- **RPC Reliability**: 100% of valid RPC calls succeed with < 100ms response time

### Quality Metrics

- **Test Coverage**: Minimum 80% coverage for new state services and RPC handlers
- **Type Safety**: Zero `any` types in new code, all model/permission values use literal types
- **Error Handling**: All RPC handlers have try-catch blocks with structured error responses
- **Logging**: All CLI invocations log full command with flags for debugging

### User Experience Metrics

- **Discoverability**: Model selector and autopilot toggle visible without scrolling in default viewport
- **Feedback Latency**: UI reflects state changes within 50ms of user interaction
- **Error Clarity**: RPC errors display user-friendly messages (not stack traces)

## Implementation Notes

### Model Name Mapping

| UI Display Name   | Internal Value | CLI Flag              |
| ----------------- | -------------- | --------------------- |
| Claude Opus 4.0   | `opus`         | `--model opus`        |
| Claude Sonnet 4.0 | `sonnet`       | (omit flag - default) |
| Claude Haiku 3.5  | `haiku`        | `--model haiku`       |

### Permission Level Mapping

| UI Label         | Internal Value | CLI Flags                        |
| ---------------- | -------------- | -------------------------------- |
| Manual (default) | `ask`          | (none - default behavior)        |
| Auto-edit        | `auto-edit`    | `--allowedTools Edit,Write`      |
| Full Auto (YOLO) | `yolo`         | `--dangerously-skip-permissions` |

### State Service Pattern

Both state services should follow this pattern:

```typescript
@Injectable({ providedIn: 'root' })
export class ModelStateService {
  private readonly _currentModel = signal<ClaudeModel>('sonnet');
  readonly currentModel = this._currentModel.asReadonly();

  constructor(private readonly rpc: ClaudeRpcService) {
    this.loadPersistedState();
  }

  async switchModel(model: ClaudeModel): Promise<void> {
    const result = await this.rpc.call('model:switch', { model });
    if (result.isSuccess()) {
      this._currentModel.set(model);
    }
  }

  private async loadPersistedState(): Promise<void> {
    // Load from RPC or use default
  }
}
```

### RPC Handler Pattern

```typescript
this.rpcHandler.registerMethod('model:switch', async (params: any) => {
  try {
    const { model } = params;
    if (!['opus', 'sonnet', 'haiku'].includes(model)) {
      throw new Error(`Invalid model: ${model}`);
    }
    // Store in workspace configuration
    return { success: true };
  } catch (error) {
    this.logger.error('RPC: model:switch failed', error);
    return { success: false, error: error.message };
  }
});
```

## Validation Criteria

Before delegation to architect, verify:

- [x] All requirements follow SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
- [x] Acceptance criteria use WHEN/THEN/SHALL format (BDD-style)
- [x] Stakeholder analysis identifies all affected parties with success criteria
- [x] Risk assessment includes technical, business, and integration risks with mitigation strategies
- [x] Dependencies clearly identify internal code dependencies and external API dependencies
- [x] Out of scope section prevents scope creep
- [x] Non-functional requirements specify performance, security, reliability targets
- [x] Success metrics provide measurable validation criteria

## Related Documentation

- **Context**: `task-tracking/TASK_2025_035/context.md`
- **Future Work Reference**: `docs/future-enhancements/TASK_2025_023_FUTURE_WORK.md` (Category 2)
- **ClaudeProcess Implementation**: `libs/backend/claude-domain/src/cli/claude-process.ts`
- **RPC Handler Reference**: `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts`
- **State Service Pattern**: `libs/frontend/core/src/lib/services/app-state.service.ts`
