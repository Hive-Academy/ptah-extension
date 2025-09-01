# Implementation Plan - TASK_CMD_002

## Original User Request

**User Asked For**: "Continue implementing the MONSTER_EXTENSION_REFACTOR_PLAN - specifically Week 2: Type-Safe DI Container & Messaging"

## Research Evidence Integration

**Critical Findings Addressed**: 
- Type-safe dependency injection using TSyringe with Symbol-based tokens
- RxJS-based event bus system compatible with Angular reactive patterns
- VS Code API abstraction with proper event handling

**High Priority Findings**: 
- Integration with existing MessagePayloadMap from @ptah-extension/shared
- Elimination of string-based tokens in favor of Symbol-based typing
- Request-response messaging patterns with correlation IDs

**Evidence Source**: 
- task-description.md requirements analysis
- MONSTER_EXTENSION_REFACTOR_PLAN lines 165-420 (detailed code examples)
- Existing shared type system in libs/shared/src/lib/types/message.types.ts

## Architecture Approach

**Design Pattern**: Service Locator with Dependency Injection using TSyringe
**Implementation Timeline**: 2-3 days with phased implementation

The architecture leverages the existing comprehensive type system from @ptah-extension/shared and builds the DI container and messaging infrastructure on top of it. This approach ensures type safety throughout the extension while maintaining compatibility with Angular webview components.

## Phase 1: Core DI Container Setup (Day 1)

### Task 1.1: Type-Safe DI Container Implementation

**Complexity**: MEDIUM
**Files to Modify**: 
- `libs/backend/vscode-core/src/di/container.ts` (create)
- `libs/backend/vscode-core/src/di/tokens.ts` (create)
- `libs/backend/vscode-core/src/index.ts` (update exports)

**Expected Outcome**: Symbol-based DI container with type-safe service registration
**Developer Assignment**: backend-developer

**Implementation Details**:
- Create TOKENS constant with Symbol-based tokens for all service types
- Implement DIContainer class with setup utility method
- Register VS Code extension context and core services
- Export all DI-related components for consumption

### Task 1.2: RxJS Event Bus Core Implementation

**Complexity**: HIGH
**Files to Modify**: 
- `libs/backend/vscode-core/src/messaging/event-bus.ts` (create)
- `libs/backend/vscode-core/src/messaging/index.ts` (create)

**Expected Outcome**: RxJS-based event bus with type-safe message handling using existing MessagePayloadMap
**Developer Assignment**: backend-developer

**Implementation Details**:
- Implement EventBus service with publish/subscribe methods
- Create TypedEvent interface extending MessagePayloadMap types
- Implement request-response pattern with correlation IDs and timeouts
- Ensure full compatibility with existing StrictMessageType system

## Phase 2: VS Code API Wrappers (Day 2-3)

### Task 2.1: Command Manager Implementation

**Complexity**: MEDIUM
**Files to Modify**: 
- `libs/backend/vscode-core/src/api-wrappers/command-manager.ts` (create)
- `libs/backend/vscode-core/src/api-wrappers/index.ts` (create)

**Expected Outcome**: Type-safe VS Code command registration with event integration
**Developer Assignment**: backend-developer

**Implementation Details**:
- Create CommandDefinition interface for type-safe command definitions
- Implement CommandManager service with DI integration
- Add event emission for command execution and errors
- Support bulk command registration

### Task 2.2: Webview Manager Implementation

**Complexity**: MEDIUM
**Files to Modify**: 
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` (create)

**Expected Outcome**: Enhanced webview management with message routing and event bus integration
**Developer Assignment**: backend-developer

**Implementation Details**:
- Create WebviewManager service with DI integration
- Implement webview panel creation with initial data support
- Set up message routing to event bus
- Add cleanup handling for webview disposal

### Task 2.3: Integration and Testing

**Complexity**: MEDIUM
**Files to Modify**: 
- `libs/backend/vscode-core/src/index.ts` (update all exports)
- `libs/backend/vscode-core/src/lib/vscode-core.ts` (integration point)

**Expected Outcome**: All components properly exported and integrated
**Developer Assignment**: backend-developer

**Implementation Details**:
- Export all new services from library entry point
- Create integration example in main library file
- Ensure TypeScript compilation passes with strict mode
- Validate no 'any' types are introduced

## Future Work Moved to Registry

**Large Scope Items Added to registry.md**:
- Week 3: Enhanced VS Code API wrappers (OutputManager, StatusBarManager)  
- Week 4: Provider system core infrastructure
- Week 5: Provider UI components and Angular integration
- Week 6: Provider testing and optimization
- Phase 2: Complete provider system implementation (Weeks 4-6)

## Technical Implementation Notes

### Dependencies Already Available
- TSyringe: Already installed for dependency injection
- RxJS: Already installed for reactive programming
- EventEmitter3: Already installed for event handling
- @ptah-extension/shared: Comprehensive type system already implemented

### Integration Points
- **MessagePayloadMap**: All message types must use existing comprehensive mapping
- **StrictMessageType**: All events must conform to existing strict typing
- **Extension Lifecycle**: DI container initialization during extension activation
- **Angular Compatibility**: Event bus observables must work with Angular reactive patterns

### Type Safety Requirements
- Zero 'any' types - all services must use strict typing
- Symbol-based tokens instead of string identifiers
- Runtime validation using existing Zod schemas where applicable
- Comprehensive error handling with structured error types

## Developer Handoff

**Next Agent**: backend-developer
**Priority Order**: 
1. Task 1.1: DI Container Setup (start immediately)
2. Task 1.2: Event Bus Implementation (dependent on DI container)
3. Task 2.1: Command Manager (can run parallel with 2.2)
4. Task 2.2: Webview Manager (can run parallel with 2.1)
5. Task 2.3: Integration and testing (final validation)

**Success Criteria**:
- All TypeScript compilation passes with strict mode enabled
- DI container successfully initializes with Symbol-based tokens
- Event bus handles all MessagePayloadMap types without type errors
- Command and Webview managers integrate properly with VS Code APIs
- Zero 'any' types throughout the implementation
- Integration tests demonstrate proper message flow between components

**Files Structure Created**:
```
libs/backend/vscode-core/src/
├── di/
│   ├── container.ts          # Main DI container with Symbol tokens
│   └── tokens.ts             # Exported Symbol constants
├── messaging/
│   ├── event-bus.ts          # RxJS event bus implementation
│   └── index.ts              # Messaging exports
├── api-wrappers/
│   ├── command-manager.ts    # VS Code command abstraction
│   ├── webview-manager.ts    # VS Code webview abstraction  
│   └── index.ts              # API wrapper exports
└── index.ts                  # Main library exports
```