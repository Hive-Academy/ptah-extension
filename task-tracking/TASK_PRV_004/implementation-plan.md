# Implementation Plan - TASK_PRV_004

## Architecture Overview

### Design Decisions

- **Pattern**: Hexagonal-style claude-domain boundary with event-driven adapters. Claude-specific CLI logic is encapsulated in services that expose ports (launcher, permissions, session, detector) consumed by the extension and `ai-providers-core`. This isolates platform nuances and follows MONSTER Week 5 guidance.
- **SOLID Compliance**:
  - _Single Responsibility_: Separate modules for permissions, session, launcher, detector, and events keep behavior focused.
  - _Open/Closed_: New CLI features (additional flags, permission strategies) extend services without modifying consumers.
  - _Liskov_: Replacement of the claude provider with alternative implementations preserves contracts defined in `ai-providers-core`.
  - _Interface Segregation_: Consumers import only needed sub-modules; no monolithic service class.
  - _Dependency Inversion_: Extension references claude-domain abstractions instead of concrete legacy services.
- **Type/Schema Reuse**: Reuse existing branded identifiers, strict chat payloads, and provider health schemas from `libs/shared`. New Claude-specific types will extend shared modules to maintain single source of truth.

### Component Diagram

```
ProviderFactory (apps/.../ai-providers)
   └─> ClaudeCliProviderAdapter
          ├─> ClaudeDomainLauncher (cli)
          │       ├─> SessionManager
          │       ├─> PermissionService
          │       └─> ProcessManager + JSONL Parser
          └─> ClaudeDomainEvents → EventBus (vscode-core) → Webview handlers/UI
          └─> Detector provides path + health information to launcher/provider manager
```

## Type/Schema Strategy

### Existing Types to Reuse

Search completed with results:

- `SessionId` from `libs/shared/src/lib/types/branded.types.ts` – branded session IDs used for CLI process tracking and resume flags.
- `StrictChatMessage` and `MessageResponse` from `libs/shared/src/lib/types/message.types.ts` – maintain streaming message parity between extension and webview.
- `ProviderHealth` & `AISessionConfig` from `libs/shared/src/lib/types/ai-provider.types.ts` – reuse for health reporting and session configuration (with optional model pass-through).

### New Types Required

- `ClaudePermissionRule` in `libs/shared/src/lib/types/claude-domain.types.ts` – describes YOLO toggle, command glob, argument constraints, and scope metadata.
- `ClaudePermissionDecision` in the same file – `'allow' | 'deny' | 'always_allow'` plus provenance (user, rule, YOLO) and timestamp.
- `ClaudeToolEvent` union (start/progress/result) for typed tool lifecycle events emitted to the event bus.

**No Duplication**: Verified `libs/shared/src/lib/types/` for existing permission/tool schemas; no overlaps found, so new definitions extend the shared types package for reuse across extension and webview.

## File Changes

### Files to Modify (Updated for MONSTER Integration)

1. **`libs/backend/vscode-core/src/di/tokens.ts`**

   - Purpose: Add DI tokens for claude-domain services.
   - Scope: Export new symbols for CLAUDE_CLI_DETECTOR, CLAUDE_CLI_LAUNCHER, CLAUDE_SESSION_MANAGER, CLAUDE_PERMISSION_SERVICE.
   - Estimated LOC: ~20.

2. **`libs/backend/vscode-core/src/di/container.ts`**

   - Purpose: Register claude-domain services with TSyringe DI container.
   - Scope: Add singleton registrations in DIContainer.setup() method.
   - Estimated LOC: ~30.

3. **`libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts`**

   - Purpose: Inject claude-domain services via constructor instead of direct instantiation.
   - Scope: Add @injectable decorator, constructor injection, delegate to launcher/detector.
   - Estimated LOC: ~80.

4. **`libs/backend/vscode-core/src/messaging/event-bus.ts`** (optional enhancement)

   - Purpose: Add helper methods for claude-domain event topics.
   - Scope: Type-safe publish/subscribe for CONTENT_CHUNK, TOOL_START, PERMISSION_REQUESTED.
   - Estimated LOC: ~20.

5. **`libs/shared/src/index.ts`**
   - Purpose: Export new claude-domain shared types.
   - Scope: Append export statements.
   - Estimated LOC: <10.

**Note**: Legacy services in `apps/ptah-extension-vscode/src/services/` are NOT modified. They will be deprecated in a future task after MONSTER Week 6 multi-provider manager is complete.

### Files to Create

1. **`libs/shared/src/lib/types/claude-domain.types.ts`**

   - Purpose: Central shared schemas for permissions and tool events.
   - Content: Interfaces, zod schemas, helper builders; exported via `libs/shared/src/index.ts`.
   - Estimated LOC: ~120.

2. **`libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`**

   - Purpose: Spawn CLI processes with WSL-aware path resolution and flag management.
   - Content: Class `ClaudeCliLauncher` exposing `spawnTurn`, hooking into permissions + session manager.
   - Estimated LOC: ~160.

3. **`libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`**

   - Purpose: Parse JSONL stream chunks into typed events with error handling.
   - Content: Parser class with callbacks for content/thinking/tool/permission messages.
   - Estimated LOC: ~140.

4. **`libs/backend/claude-domain/src/cli/process-manager.ts`**

   - Purpose: Manage child processes per session turn, cleanup, abort.
   - Content: Map of SessionId → ChildProcess metadata and lifecycle hooks.
   - Estimated LOC: ~120.

5. **`libs/backend/claude-domain/src/session/session-manager.ts`**

   - Purpose: Track session state, resume tokens, attach metadata for CLI calls.
   - Content: Class storing session info, providing create/resume/end methods.
   - Estimated LOC: ~140.

6. **`libs/backend/claude-domain/src/permissions/permission-service.ts`**

   - Purpose: YOLO toggle, always-allow rules, prompt dispatch via event bus.
   - Content: Methods `requestDecision`, `setRule`, `revokeRule`, internal caching.
   - Estimated LOC: ~180.

7. **`libs/backend/claude-domain/src/permissions/permission-rules.store.ts`**

   - Purpose: Abstract persistence (workspace storage) for permission rules.
   - Content: Interface + default file-system backed implementation.
   - Estimated LOC: ~120.

8. **`libs/backend/claude-domain/src/detector/claude-cli-detector.ts`**

   - Purpose: Cross-platform CLI detection, WSL path translation, health checks.
   - Content: Class `ClaudeCliDetector` with `findExecutable`, `verifyInstallation`, `performHealthCheck`.
   - Estimated LOC: ~160.

9. **`libs/backend/claude-domain/src/events/claude-domain.events.ts`**

   - Purpose: Typed event topics + publisher helpers bridging to EventBus.
   - Content: Constants, payload factories, `emit*` helpers.
   - Estimated LOC: ~110.

10. **`libs/backend/claude-domain/src/index.ts`**

    - Purpose: Barrel exports for launcher, detector, session, permissions, events, types.
    - Content: Export statements, DI tokens.
    - Estimated LOC: ~60.

11. **Unit test files** (e.g., `permission-service.spec.ts`, `jsonl-stream-parser.spec.ts`, etc.).

    - Purpose: Ensure ≥80% coverage for new modules.
    - Estimated LOC: ~250 total.

12. **Testing helpers** (`testing/mock-permission-store.ts`, etc.)
    - Purpose: Provide mocks for unit tests.
    - Estimated LOC: ~80.

## Integration Points

### Dependencies

- **Internal**: `libs/backend/ai-providers-core`, `libs/backend/vscode-core` (EventBus), `libs/shared` types, existing settings services.
- **External**: Node `child_process`, `path`, `os`. Reuse existing WSL helpers—no new npm dependencies expected.

### Breaking Changes

- [x] None - backwards compatible
- [ ] API changes
- [ ] Config changes

Existing provider APIs remain unchanged; claude-domain replaces internal implementation only.

## Implementation Steps

### Step 1: Foundation Work

- Files: `claude-cli-detector.ts`, `session-manager.ts`, `jsonl-stream-parser.ts`, associated tests.
- Task: Port detection, session state, and streaming parser logic with unit coverage.
- Validation: Run targeted Jest suites (`npm run test:all -- claude-domain`) and ensure typecheck passes.

### Step 2: Core Functionality

- Files: `claude-cli-launcher.ts`, `process-manager.ts`, `permission-service.ts`, `permission-rules.store.ts`, shared type additions.
- Task: Implement launcher pipeline integrating permissions, WSL options, model flag, tool/permission events.
- Validation: Unit tests for permission decisions and launcher flows (mock ChildProcess), plus lint.

### Step 3: DI Container Integration (MONSTER Week 5)

- Files: `vscode-core/di/tokens.ts`, `vscode-core/di/container.ts`, `ai-providers-core` adapters, event wiring.
- Task: Register claude-domain services with TSyringe DI container, wire into NEW provider system (not legacy shim).
- Validation: Services resolve correctly via DI, events flow through RxJS EventBus, typecheck passes.

**Approach**:

- Add DI tokens for claude-domain services (CLAUDE_CLI_DETECTOR, CLAUDE_SESSION_MANAGER, etc.)
- Register services in DIContainer.setup()
- Update ai-providers-core to inject claude-domain via constructor
- Wire claude-domain events to EventBus for webview consumption
- NO modifications to legacy `apps/ptah-extension-vscode/src/services/` (will be deprecated separately)

### Step 4: Testing Setup & Smoke Validation

- Files: All new spec files, optional integration spec, manual test notes.
- Task: Achieve ≥80% coverage, run `npm run test:all` and `npm run build:extension`. Launch Extension Development Host to verify streaming, permissions, resume.
- Validation: Manual checklist completion + build success.

## Timeline & Scope

### Current Scope (This Task)

- **Estimated Time**: 3 days.
- **Core Deliverable**: Claude-domain library with extracted services, YOLO/WSL/model enhancements, integrated with provider factory.
- **Quality Threshold**: Lint/typecheck/build green; ≥80% unit coverage for new modules; manual smoke tests completed.

### Future Work (Registry Tasks)

No new registry entries required (slash commands, MCP UI, checkpoints already captured in TASK_PRV_002/TASK_PRV_005).

## Risk Mitigation

### Technical Risks

- **Risk**: Legacy services have hidden calls from other modules.
  - **Mitigation**: Maintain temporary shim exporting original interface; run repository-wide search before removal.
  - **Contingency**: If unexpected dependency discovered, wrap claude-domain call while planning follow-up refactor.
- **Risk**: Permission persistence failures could block tool execution.
  - **Mitigation**: Default to prompting user; log warning via EventBus.
  - **Contingency**: Provide in-memory fallback store.

### Performance Considerations

- **Concern**: Additional event publication overhead during streaming.
  - **Strategy**: Emit minimal payloads, batch progress events where possible.
  - **Measurement**: Compare response time metrics captured in ProviderHealth updates pre/post change (<5% regression acceptable).

## Testing Strategy

### Unit Tests Required

- `libs/backend/claude-domain/src/permissions/permission-service.spec.ts`: YOLO toggle, always-allow pattern matching, persistence failure fallback.
- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.spec.ts`: Partial chunk handling, malformed JSON recovery, tool event detection.
- `libs/backend/claude-domain/src/detector/claude-cli-detector.spec.ts`: Windows/macOS/Linux detection, WSL translation, health timing.
- `libs/backend/claude-domain/src/session/session-manager.spec.ts`: Create/resume/end flows, invalid resume handling.
- Coverage target: ≥80% per module.

### Integration Tests Required

- `libs/backend/claude-domain/src/cli/claude-cli-launcher.integration.spec.ts`: Mock ChildProcess verifying permission flow, event emission, resume flag usage.

### Manual Testing

- [ ] Stream a lengthy Claude CLI conversation ensuring chunk, thinking, and tool events render in webview.
- [ ] Trigger a permission request; validate YOLO toggle, always-allow rule persistence, and denial path.
- [ ] Resume a previous session (`--resume`) to confirm conversation continuity.
- [ ] Execute on Windows with WSL enabled verifying health check and path resolution succeed.
