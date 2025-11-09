# Task Requirements - TASK_CMD_002

## User's Request

**Original Request**: "Continue implementing the MONSTER_EXTENSION_REFACTOR_PLAN - specifically Week 2: Type-Safe DI Container & Messaging"
**Core Need**: Implement the core infrastructure components for the Ptah extension refactor, specifically the DI container setup and RxJS-based event bus system as defined in Week 2 of the plan.

## Requirements Analysis

### Requirement 1: Type-Safe Dependency Injection Container

**User Story**: As a Ptah extension developer, I want a type-safe dependency injection container using TSyringe, so that services can be registered and resolved with compile-time type safety and no string-based tokens.

**Acceptance Criteria**:

- WHEN the DI container is initialized THEN it provides Symbol-based tokens for all service types
- WHEN services are registered THEN they use type-safe Symbol tokens instead of strings
- WHEN the extension context is provided THEN it is properly registered in the container
- WHEN the event bus is initialized THEN it is registered as a singleton service
- WHEN services are injected THEN TypeScript provides full type safety with no 'any' types

### Requirement 2: RxJS Event Bus Implementation

**User Story**: As a Ptah extension developer, I want an RxJS-based event bus system, so that extension components can communicate using type-safe, reactive messaging with Angular compatibility.

**Acceptance Criteria**:

- WHEN messages are published THEN they use the existing StrictMessageType system from @ptah-extension/shared
- WHEN components subscribe to messages THEN they receive RxJS Observables with proper typing
- WHEN request-response patterns are needed THEN the event bus provides async request/response functionality
- WHEN messages flow between components THEN they include proper correlation IDs and timestamps
- WHEN Angular components consume events THEN they work seamlessly with Angular's reactive patterns

### Requirement 3: VS Code API Abstraction Components

**User Story**: As a Ptah extension developer, I want abstracted VS Code API wrappers, so that core VS Code functionality is encapsulated with proper dependency injection and event handling.

**Acceptance Criteria**:

- WHEN commands are registered THEN they use the CommandManager with proper event emission
- WHEN webviews are created THEN they use the WebviewManager with message routing
- WHEN VS Code APIs are called THEN they go through abstracted wrappers instead of direct calls
- WHEN events occur in VS Code wrappers THEN they emit appropriate events to the event bus
- WHEN errors occur THEN they are properly handled and emitted as error events

## Success Metrics

- DI container successfully initializes with all Symbol-based tokens defined
- Event bus handles all message types from the existing MessagePayloadMap without type errors
- CommandManager and WebviewManager successfully wrap VS Code APIs with event integration
- All components can be instantiated through dependency injection
- TypeScript compilation passes with strict mode and zero 'any' types
- Integration tests demonstrate proper message flow between components

## Implementation Scope

**Files to Create/Modify**:

- `libs/backend/vscode-core/src/di/container.ts` - DI container setup with Symbol tokens
- `libs/backend/vscode-core/src/messaging/event-bus.ts` - RxJS event bus implementation
- `libs/backend/vscode-core/src/api-wrappers/command-manager.ts` - VS Code command abstraction
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` - VS Code webview abstraction
- `libs/backend/vscode-core/src/index.ts` - Export all new components

**Dependencies**:

- TSyringe (already installed)
- RxJS (already installed)
- EventEmitter3 (already installed)
- @ptah-extension/shared types (already available)

**Timeline Estimate**: 2-3 days
**Complexity**: Medium - Well-defined architecture from the plan, but requires careful integration with existing type system

## Dependencies & Constraints

**Technical Constraints**:

- Must use existing MessagePayloadMap from @ptah-extension/shared
- Must maintain compatibility with Angular webview components
- Must follow strict TypeScript typing (no 'any' types)
- Must integrate with existing VS Code extension lifecycle

**Prerequisites**:

- Nx libraries already generated (completed)
- Required packages already installed (completed)
- Shared type system already implemented (completed)

**Integration Points**:

- Extension activation/deactivation lifecycle
- Webview message passing system
- Angular component reactive patterns
- Existing chat and session management

## Next Agent Decision

**Recommendation**: software-architect
**Rationale**: The requirements are clearly defined in the MONSTER_EXTENSION_REFACTOR_PLAN with detailed code examples. No additional research is needed since the architecture, patterns, and integration points are already specified. The software-architect can proceed directly to creating the implementation plan and detailed design.

**Key Context for Next Agent**:

- Week 2 implementation focuses on core infrastructure (DI + messaging)
- Detailed code examples are provided in the plan (lines 165-420)
- Must integrate with existing @ptah-extension/shared type system
- Timeline target is 2-3 days for Week 2 components
- This sets foundation for Week 3 VS Code API wrappers (already planned)
