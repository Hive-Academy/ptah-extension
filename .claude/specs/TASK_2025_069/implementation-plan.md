# Implementation Plan - TASK_2025_069

## Codebase Investigation Summary

### Libraries Discovered

- **agent-generation** (libs/backend/agent-generation): Backend orchestration for agent generation

  - Key exports: SetupWizardService, AgentGenerationOrchestratorService
  - Documentation: Not discovered (library exists, no CLAUDE.md found)
  - Usage examples: SetupWizardService.launchWizard() method available

- **workspace-intelligence** (libs/backend/workspace-intelligence): File system analysis

  - Key exports: AgentDiscoveryService
  - Documentation: D:\projects\ptah-extension\libs\backend\workspace-intelligence\CLAUDE.md
  - Usage: Discovers agents from .claude/agents/ directories

- **vscode-core** (libs/backend/vscode-core): Infrastructure services

  - Key exports: CommandManager, WebviewManager, TOKENS
  - Documentation: Multiple CLAUDE.md files in library
  - Usage: Command registration via CommandManager.registerCommand()

- **frontend/core** (libs/frontend/core): Frontend services

  - Key exports: VSCodeService
  - Documentation: D:\projects\ptah-extension\libs\frontend\core\CLAUDE.md
  - Usage: RPC communication via VSCodeService.postMessage()

- **frontend/chat** (libs/frontend/chat): Chat UI components
  - Key exports: ChatViewComponent
  - Documentation: D:\projects\ptah-extension\libs\frontend\chat\CLAUDE.md
  - Usage: Empty state in chat-view.component.html (lines 53-124)

### Patterns Identified

- **Command Registration Pattern**: CommandManager.registerCommand()

  - Evidence: D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\command-manager.ts:50-91
  - Components: CommandDefinition interface (id, title, handler, category)
  - Conventions: `ptah.{commandName}` format, async handlers

- **RPC Message Pattern**: VSCodeService.postMessage() + backend message handler

  - Evidence: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts:161-169
  - Components: Message type routing in VSCodeService.setupMessageListener()
  - Conventions: `{namespace}:{action}` message type format

- **Webview Panel Pattern**: WebviewManager.createWebviewPanel()

  - Evidence: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts:168-179
  - Components: viewType, title, showOptions, webviewOptions
  - Conventions: `ptah.{viewName}` viewType format

- **Agent Discovery Pattern**: AgentDiscoveryService.searchAgents()
  - Evidence: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts:0-99
  - Components: Scans .claude/agents/ for .md files, parses YAML frontmatter
  - Conventions: Project scope (.claude/agents/) + User scope (~/.claude/agents/)

### Integration Points

- **SetupWizardService.launchWizard()**:

  - Location: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts:118-220
  - Interface: `async launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>>`
  - Usage: Creates webview panel with viewType `ptah.setupWizard`

- **AgentDiscoveryService.discoverAllAgents()**:

  - Location: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts
  - Interface: Returns `AgentInfo[]` with name, description, scope, filePath
  - Usage: Real-time discovery of configured agents

- **CommandManager**:

  - Location: D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\command-manager.ts
  - Interface: `registerCommand(definition: CommandDefinition): void`
  - Usage: Register VS Code commands in package.json + handler

- **VSCodeService**:
  - Location: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts
  - Interface: `postMessage(message: unknown): void`
  - Usage: Send RPC messages from Angular to VS Code extension

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: RPC-based Widget Integration with Command Trigger

**Rationale**:

- Matches existing pattern: ChatInputComponent uses RPC messages for backend operations
- Aligns with codebase: CommandManager pattern already established for VS Code commands
- Evidence: SetupWizardService already has RPC message handlers (lines 191-207)
- Separation of concerns: Widget (frontend) + Status Service (backend) + Command (trigger)

**Evidence**:

- Similar pattern: chat-view.component.ts uses ChatStore signals for reactive state
- Command pattern: package.json only has `ptah.openFullPanel` command currently
- RPC pattern: VSCodeService routes messages to appropriate services

### Component Specifications

#### Component 1: SetupStatusService (Backend)

**Purpose**: Provide agent configuration status information to frontend via RPC

**Pattern**: Backend RPC Service (similar to existing RPC handlers)

**Evidence**: SetupWizardService already has RPC handlers (setup-wizard.service.ts:191-207)

**Responsibilities**:

- Check if .claude/agents/ directory exists and has .md files
- Count configured agents using AgentDiscoveryService
- Return last modified timestamp of .claude/agents/ directory
- Handle RPC message `setup-status:get-status`

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:191-207
// Verified imports from: agent-generation library + workspace-intelligence
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { Result } from '@ptah-extension/shared';
import * as vscode from 'vscode';

// Setup status response type
interface SetupStatus {
  isConfigured: boolean; // True if .claude/agents/ exists with agents
  agentCount: number; // Number of configured agents
  lastModified: string | null; // ISO timestamp of last .claude/agents/ change
  projectAgents: string[]; // List of project agent names
  userAgents: string[]; // List of user agent names
}

@injectable()
export class SetupStatusService {
  constructor(@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext, @inject(TOKENS.AGENT_DISCOVERY_SERVICE) private agentDiscovery: AgentDiscoveryService, @inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Get current agent setup status for workspace
   */
  async getStatus(workspaceUri: vscode.Uri): Promise<Result<SetupStatus, Error>> {
    // Implementation details omitted - pattern shown
  }

  /**
   * Register RPC message handler
   */
  registerRpcHandler(webview: vscode.Webview): void {
    // Handle 'setup-status:get-status' messages
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Must detect .claude/agents/ directory existence
- Must count total agents (project + user scope)
- Must return last modified timestamp
- Must distinguish between project and user agents

**Non-Functional Requirements**:

- Performance: Status check < 100ms (file system check + agent discovery)
- Caching: Cache status for 5 seconds to avoid repeated file system checks
- Error handling: Return sensible defaults if workspace not available

**Pattern Compliance**:

- Must follow injectable service pattern (verified at vscode-core patterns)
- Must use Result<T, Error> return type (verified in setup-wizard.service.ts)
- Must use TOKENS for dependency injection (verified in vscode-core)

**Files Affected**:

- libs/backend/agent-generation/src/lib/services/setup-status.service.ts (CREATE)
- libs/backend/agent-generation/src/lib/di/tokens.ts (MODIFY - add SETUP_STATUS_SERVICE token)
- libs/backend/agent-generation/src/index.ts (MODIFY - export SetupStatusService)

#### Component 2: ptah.setupAgents Command

**Purpose**: Launch setup wizard from Command Palette or code

**Pattern**: Command Registration (CommandManager pattern)

**Evidence**: package.json commands array (lines 58-65), CommandManager.registerCommand (command-manager.ts:50-91)

**Responsibilities**:

- Get current workspace URI
- Call SetupWizardService.launchWizard()
- Show error notification if workspace not available
- Available in Command Palette

**Implementation Pattern**:

```typescript
// Pattern source: main.ts command registration flow
// Verified: CommandManager from vscode-core:command-manager.ts:50-91

// In RpcMethodRegistrationService or new CommandRegistrationService
import { TOKENS } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

// Register command during extension activation
commandManager.registerCommand({
  id: 'ptah.setupAgents',
  title: 'Setup Claude Agents',
  category: 'Ptah',
  handler: async () => {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!workspaceUri) {
      vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
      return;
    }

    const wizardService = DIContainer.resolve(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE);
    const result = await wizardService.launchWizard(workspaceUri);

    if (result.isErr()) {
      vscode.window.showErrorMessage(`Failed to launch setup wizard: ${result.error.message}`);
    }
  },
});
```

**Quality Requirements**:

**Functional Requirements**:

- Must launch SetupWizardService.launchWizard()
- Must validate workspace exists
- Must show error notifications for failures

**Non-Functional Requirements**:

- Must appear in Command Palette
- Must have clear category ("Ptah")
- Must have descriptive title

**Pattern Compliance**:

- Must follow CommandDefinition interface (verified: command-manager.ts:14-20)
- Must use async handler pattern (verified: command-manager.ts:57-77)

**Files Affected**:

- apps/ptah-extension-vscode/package.json (MODIFY - add command to contributes.commands)
- apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts (MODIFY - add command registration)

#### Component 3: SetupStatusWidgetComponent (Frontend)

**Purpose**: Display agent configuration status in chat empty state

**Pattern**: Angular Standalone Component with Signal-based State

**Evidence**: chat-view.component.ts uses signal-based state (lines 68-69), DaisyUI card styling

**Responsibilities**:

- Fetch setup status via RPC on component init
- Display agent count and last modified date
- Show "Configure Agents" or "Update Configuration" button based on status
- Trigger wizard via RPC message when button clicked
- Show loading state during RPC calls
- Show error state if RPC fails

**Implementation Pattern**:

```typescript
// Pattern source: chat-view.component.ts signal-based reactivity
// Verified: VSCodeService.postMessage() at vscode.service.ts:161-169

import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';

interface SetupStatus {
  isConfigured: boolean;
  agentCount: number;
  lastModified: string | null;
  projectAgents: string[];
  userAgents: string[];
}

@Component({
  selector: 'ptah-setup-status-widget',
  standalone: true,
  imports: [],
  template: `
    <div class="card bg-base-200 border border-base-300 mb-4">
      <div class="card-body p-4">
        @if (loading()) {
        <!-- Loading skeleton -->
        <div class="flex items-center gap-3">
          <div class="skeleton w-10 h-10 rounded-full shrink-0"></div>
          <div class="flex-1">
            <div class="skeleton h-4 w-32 mb-2"></div>
            <div class="skeleton h-3 w-48"></div>
          </div>
        </div>
        } @else if (error()) {
        <!-- Error state -->
        <div class="alert alert-error">
          <span>Failed to load agent setup status</span>
        </div>
        } @else if (status()) {
        <!-- Agent Status Display -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="avatar placeholder">
              <div class="bg-primary text-primary-content rounded-full w-10">
                <span class="text-lg">🤖</span>
              </div>
            </div>
            <div>
              <h4 class="font-semibold text-sm">Claude Agents</h4>
              @if (status()!.isConfigured) {
              <p class="text-xs text-base-content/70">
                {{ status()!.agentCount }} agent{{ status()!.agentCount !== 1 ? 's' : '' }} configured @if (status()!.lastModified) { • Updated {{ formatDate(status()!.lastModified) }}
                }
              </p>
              } @else {
              <p class="text-xs text-base-content/70">No agents configured yet</p>
              }
            </div>
          </div>
          <button class="btn btn-primary btn-sm" [disabled]="launching()" (click)="launchWizard()" type="button">
            @if (launching()) {
            <span class="loading loading-spinner loading-xs"></span>
            Launching... } @else {
            {{ status()!.isConfigured ? 'Update' : 'Configure' }}
            }
          </button>
        </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupStatusWidgetComponent implements OnInit {
  private readonly vscodeService = inject(VSCodeService);

  // Reactive state
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly launching = signal(false);
  readonly status = signal<SetupStatus | null>(null);

  ngOnInit(): void {
    this.fetchStatus();
  }

  private async fetchStatus(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);

    try {
      // Send RPC message to backend
      this.vscodeService.postMessage({
        type: 'setup-status:get-status',
        payload: {},
      });

      // Listen for response (simplified - actual implementation needs proper RPC correlation)
      // Pattern: Similar to existing RPC handlers in VSCodeService
    } catch (err) {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  launchWizard(): void {
    this.launching.set(true);

    // Send RPC message to launch wizard
    this.vscodeService.postMessage({
      type: 'setup-wizard:launch',
      payload: {},
    });

    // Note: Wizard will open in separate webview panel, no response needed
    setTimeout(() => this.launching.set(false), 500);
  }

  formatDate(isoString: string): string {
    // Relative time formatting (e.g., "2 hours ago")
    // Implementation details omitted
    return 'recently';
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Must fetch status on component initialization
- Must display agent count and last modified time
- Must show appropriate button text ("Configure" vs "Update")
- Must disable button during launch operation
- Must handle loading and error states

**Non-Functional Requirements**:

- Must use DaisyUI card styling for consistency
- Must use signal-based reactivity (no RxJS)
- Must support ChangeDetectionStrategy.OnPush
- Loading skeleton must match design system

**Pattern Compliance**:

- Must use standalone component pattern (verified: chat-view.component.ts:41-54)
- Must use signal() for reactive state (verified: chat-view.component.ts:68-69)
- Must use VSCodeService.postMessage() for RPC (verified: vscode.service.ts:161-169)

**Files Affected**:

- libs/frontend/chat/src/lib/components/molecules/setup-status-widget.component.ts (CREATE)
- libs/frontend/chat/src/index.ts (MODIFY - export SetupStatusWidgetComponent)

#### Component 4: Chat View Integration

**Purpose**: Integrate SetupStatusWidgetComponent into ChatViewComponent empty state

**Pattern**: Component composition in Angular template

**Evidence**: chat-view.component.html empty state (lines 53-124)

**Responsibilities**:

- Add SetupStatusWidgetComponent above Vibe/Spec mode cards
- Import component in ChatViewComponent
- Maintain existing empty state functionality

**Implementation Pattern**:

```typescript
// File: chat-view.component.ts
// Pattern source: existing component imports (lines 43-50)

import { SetupStatusWidgetComponent } from '../molecules/setup-status-widget.component';

@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [
    // ... existing imports
    SetupStatusWidgetComponent, // Add widget
  ],
  // ... rest of component
})
export class ChatViewComponent {
  // No changes to component logic needed
}
```

```html
<!-- File: chat-view.component.html -->
<!-- Insert after empty state header (after line 64) -->

<!-- Empty state - "Let's build" welcome screen -->
@if (chatStore.messages().length === 0) {
<div class="flex flex-col items-center justify-center h-full text-center px-6 py-8">
  <!-- Icon -->
  <div class="text-6xl mb-4">✨</div>

  <!-- Header -->
  <h2 class="text-3xl font-bold mb-2">Let's build</h2>
  <p class="text-base text-base-content/70 mb-8">Plan, search, or build anything</p>

  <!-- NEW: Agent Setup Status Widget -->
  <div class="w-full max-w-2xl mb-6">
    <ptah-setup-status-widget />
  </div>

  <!-- Mode Selection Cards (existing) -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl mb-6">
    <!-- ... existing Vibe/Spec cards ... -->
  </div>

  <!-- ... rest of empty state ... -->
</div>
}
```

**Quality Requirements**:

**Functional Requirements**:

- Must appear in empty state only (when messages.length === 0)
- Must be positioned above Vibe/Spec mode cards
- Must maintain responsive layout (max-w-2xl container)

**Non-Functional Requirements**:

- Must not affect existing empty state behavior
- Must maintain vertical spacing consistency

**Pattern Compliance**:

- Must use @if control flow syntax (verified: chat-view.component.html uses @if)
- Must maintain DaisyUI responsive classes

**Files Affected**:

- libs/frontend/chat/src/lib/components/templates/chat-view.component.ts (MODIFY - add import)
- libs/frontend/chat/src/lib/components/templates/chat-view.component.html (MODIFY - add widget)

#### Component 5: RPC Message Handlers

**Purpose**: Wire backend SetupStatusService and wizard launch to RPC messages

**Pattern**: RPC Handler Registration (similar to existing handlers)

**Evidence**: main.ts RPC registration (lines 28-35), VSCodeService message routing (lines 171-199)

**Responsibilities**:

- Register `setup-status:get-status` RPC handler
- Register `setup-wizard:launch` RPC handler
- Route messages to appropriate services
- Handle correlation IDs for async responses

**Implementation Pattern**:

```typescript
// Pattern source: main.ts RPC registration flow
// File: rpc-method-registration.service.ts

import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

// In RpcMethodRegistrationService.registerAll()
export class RpcMethodRegistrationService {
  registerAll(): void {
    // ... existing registrations

    // Register setup status RPC handlers
    this.registerSetupStatusHandlers();
  }

  private registerSetupStatusHandlers(): void {
    const setupStatusService = DIContainer.resolve(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE);
    const setupWizardService = DIContainer.resolve(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE);

    // Register handlers with webview message listener
    // Pattern: Similar to existing RPC handler registration
    this.rpcBridge.register('setup-status:get-status', async (payload) => {
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceUri) {
        return { error: 'No workspace folder open' };
      }

      const result = await setupStatusService.getStatus(workspaceUri);
      if (result.isErr()) {
        return { error: result.error.message };
      }

      return { data: result.value };
    });

    this.rpcBridge.register('setup-wizard:launch', async (payload) => {
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceUri) {
        return { error: 'No workspace folder open' };
      }

      const result = await setupWizardService.launchWizard(workspaceUri);
      if (result.isErr()) {
        return { error: result.error.message };
      }

      return { success: true };
    });
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Must register both RPC message types
- Must validate workspace exists before calling services
- Must return appropriate error messages
- Must handle async operations properly

**Non-Functional Requirements**:

- Must follow existing RPC registration patterns
- Must not block extension activation

**Pattern Compliance**:

- Must use DIContainer.resolve() for service resolution (verified: main.ts pattern)
- Must use AGENT_GENERATION_TOKENS for DI tokens

**Files Affected**:

- apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts (MODIFY - add handlers)
- libs/backend/agent-generation/src/lib/di/tokens.ts (MODIFY - add SETUP_STATUS_SERVICE token)

## Integration Architecture

### Integration Points

- **Backend → Frontend Status Flow**:

  - Pattern: RPC request/response
  - Implementation: SetupStatusWidgetComponent → VSCodeService.postMessage → SetupStatusService → RPC response
  - Evidence: Similar pattern in existing chat RPC handlers

- **Frontend → Backend Launch Flow**:

  - Pattern: RPC command message
  - Implementation: SetupStatusWidgetComponent.launchWizard() → VSCodeService.postMessage → SetupWizardService.launchWizard()
  - Evidence: Existing wizard launch mechanism (setup-wizard.service.ts:118-220)

- **Command Palette Integration**:
  - Pattern: VS Code command registration
  - Implementation: package.json command definition + CommandManager.registerCommand()
  - Evidence: Existing `ptah.openFullPanel` command pattern

### Data Flow

```
User Interaction Flow:
1. User opens chat (empty state)
2. ChatViewComponent renders SetupStatusWidgetComponent
3. Widget ngOnInit() → fetchStatus()
4. VSCodeService.postMessage('setup-status:get-status')
5. Backend: SetupStatusService.getStatus() → AgentDiscoveryService
6. Backend: RPC response with SetupStatus
7. Widget displays agent count + button
8. User clicks "Configure"/"Update" button
9. VSCodeService.postMessage('setup-wizard:launch')
10. Backend: SetupWizardService.launchWizard()
11. Wizard webview opens in new panel
```

```
Command Palette Flow:
1. User opens Command Palette (Ctrl+Shift+P)
2. User types "Setup Claude Agents"
3. Command executes → CommandManager handler
4. SetupWizardService.launchWizard()
5. Wizard webview opens in new panel
```

### Dependencies

**External dependencies**: None (all services already exist in codebase)

**Internal dependencies**:

- SetupStatusService depends on:

  - AgentDiscoveryService (workspace-intelligence library)
  - TOKENS.EXTENSION_CONTEXT (vscode-core)
  - TOKENS.LOGGER (vscode-core)

- SetupStatusWidgetComponent depends on:

  - VSCodeService (frontend/core library)
  - Angular core APIs (signals, OnInit, ChangeDetectionStrategy)

- Command registration depends on:
  - CommandManager (vscode-core)
  - SetupWizardService (agent-generation library)

## Quality Requirements (Architecture-Level)

### Functional Requirements

- System must display accurate agent configuration status
- System must support both "first time" and "update" flows
- System must handle workspace-less scenarios gracefully
- System must launch wizard on button click or command invocation
- System must show loading/error states appropriately

### Non-Functional Requirements

- **Performance**:

  - Status check must complete in < 100ms
  - Widget rendering must not block chat UI
  - RPC message round-trip < 200ms

- **Usability**:

  - Button text must be clear ("Configure" vs "Update")
  - Error messages must be actionable
  - Loading states must be visible

- **Maintainability**:

  - Widget must be reusable (could be used in other views)
  - Status service must be mockable for testing
  - RPC handlers must follow existing patterns

- **Reliability**:
  - Widget must handle missing workspace gracefully
  - Status service must handle file system errors
  - Command must show error notifications on failure

### Pattern Compliance

- **Injectable Services**: All backend services use @injectable() decorator (verified: setup-wizard.service.ts:62)
- **Standalone Components**: All frontend components use standalone: true (verified: chat-view.component.ts:42)
- **Signal-based State**: All reactive state uses signal() (verified: chat-view.component.ts:68-69)
- **Result Type**: All backend operations return Result<T, Error> (verified: setup-wizard.service.ts:118)
- **DaisyUI Styling**: All UI uses DaisyUI classes (verified: chat-view.component.html)

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **both** (frontend-developer AND backend-developer)

**Rationale**: This task requires coordinated frontend and backend work

- **Backend work** (50%):

  - Create SetupStatusService (NestJS-style injectable service)
  - Register RPC message handlers
  - Add VS Code command registration
  - Update DI tokens

- **Frontend work** (50%):
  - Create SetupStatusWidgetComponent (Angular standalone component)
  - Integrate widget into ChatViewComponent
  - Handle RPC communication via VSCodeService
  - Implement loading/error states with signals

**Execution Strategy**: Backend-first approach recommended

1. Backend-developer implements SetupStatusService + RPC handlers + command
2. Frontend-developer implements SetupStatusWidgetComponent
3. Frontend-developer integrates widget into ChatViewComponent
4. Both verify end-to-end flow

### Complexity Assessment

**Complexity**: MEDIUM

**Estimated Effort**: 6-8 hours total (3-4 hours backend + 3-4 hours frontend)

**Breakdown**:

- SetupStatusService implementation: 2 hours
- RPC handler registration: 1 hour
- Command registration: 1 hour
- SetupStatusWidgetComponent implementation: 2-3 hours
- Chat view integration: 1 hour
- Testing and verification: 1 hour

### Files Affected Summary

**CREATE** (Backend):

- libs/backend/agent-generation/src/lib/services/setup-status.service.ts
- libs/backend/agent-generation/src/lib/services/setup-status.service.spec.ts (tests)

**CREATE** (Frontend):

- libs/frontend/chat/src/lib/components/molecules/setup-status-widget.component.ts
- libs/frontend/chat/src/lib/components/molecules/setup-status-widget.component.spec.ts (tests)

**MODIFY** (Backend):

- libs/backend/agent-generation/src/lib/di/tokens.ts (add SETUP_STATUS_SERVICE token)
- libs/backend/agent-generation/src/index.ts (export SetupStatusService)
- apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts (register handlers)
- apps/ptah-extension-vscode/package.json (add ptah.setupAgents command)

**MODIFY** (Frontend):

- libs/frontend/chat/src/lib/components/templates/chat-view.component.ts (import widget)
- libs/frontend/chat/src/lib/components/templates/chat-view.component.html (add widget)
- libs/frontend/chat/src/index.ts (export SetupStatusWidgetComponent)

**MODIFY** (Shared):

- libs/backend/agent-generation/src/lib/di/container.ts (register SetupStatusService if DI setup exists)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - AgentDiscoveryService from @ptah-extension/workspace-intelligence (verified: workspace-intelligence/src/autocomplete/agent-discovery.service.ts)
   - CommandManager from @ptah-extension/vscode-core (verified: vscode-core/src/api-wrappers/command-manager.ts)
   - VSCodeService from @ptah-extension/core (verified: frontend/core/src/lib/services/vscode.service.ts)
   - SetupWizardService from @ptah-extension/agent-generation (verified: agent-generation/src/lib/services/setup-wizard.service.ts)

2. **All patterns verified from examples**:

   - Command registration: CommandManager.registerCommand() (command-manager.ts:50-91)
   - RPC message handling: VSCodeService.postMessage() (vscode.service.ts:161-169)
   - Signal-based state: signal() usage (chat-view.component.ts:68-69)
   - Injectable services: @injectable() decorator (setup-wizard.service.ts:62)

3. **Library documentation consulted**:

   - workspace-intelligence/CLAUDE.md (agent discovery patterns)
   - vscode-core library (command manager, DI tokens)
   - frontend/core library (RPC communication)

4. **No hallucinated APIs**:
   - All services verified as existing: SetupWizardService, AgentDiscoveryService, CommandManager, VSCodeService
   - All methods verified: launchWizard(), searchAgents(), registerCommand(), postMessage()
   - All DI tokens verified: TOKENS.EXTENSION_CONTEXT, TOKENS.LOGGER, TOKENS.AGENT_DISCOVERY_SERVICE

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)

### Additional Notes

**UI/UX Considerations**:

- Widget should blend seamlessly with empty state design
- DaisyUI card styling ensures consistency
- Loading skeleton matches existing patterns in chat view
- Button states provide clear feedback

**Performance Considerations**:

- Status check is cached for 5 seconds to avoid file system churn
- Widget only renders in empty state (conditional rendering)
- RPC messages are async and non-blocking

**Future Enhancements** (Not in Scope):

- Real-time status updates via file watcher
- Agent list preview in widget (expand/collapse)
- Quick action: "Open .claude/agents/ folder"
- Onboarding tooltip for first-time users
