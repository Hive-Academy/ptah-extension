# Development Tasks - TASK_2025_069

**Total Tasks**: 11 | **Batches**: 4 | **Status**: 0/4 complete

---

## Overview

Integration of Agent Generation Setup Wizard with Chat Empty State. Creates a visible entry point for users to discover and launch the agent configuration wizard, while displaying current agent setup status.

### Key Components

1. **SetupStatusService** (Backend) - Detects agent configuration via AgentDiscoveryService
2. **ptah.setupAgents Command** - VS Code Command Palette integration
3. **SetupStatusWidgetComponent** (Frontend) - Angular widget with DaisyUI styling
4. **Chat View Integration** - Embed widget in empty state
5. **RPC Message Handlers** - Wire frontend/backend communication

### Dependencies

- AgentDiscoveryService (workspace-intelligence) - EXISTS
- SetupWizardService (agent-generation) - EXISTS
- CommandManager (vscode-core) - EXISTS
- VSCodeService (frontend/core) - EXISTS

---

## Batch 1: Backend Status Service IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Estimated Time**: 2.5 hours

### Task 1.1: Create SetupStatusService IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-status.service.ts

**Spec Reference**: implementation-plan.md:94-173

**Pattern to Follow**:

- Injectable service: setup-wizard.service.ts:62
- Result type: setup-wizard.service.ts:118
- DI pattern: setup-wizard.service.ts:92-100

**Quality Requirements**:

- MUST use AgentDiscoveryService to count agents (project + user scope)
- MUST return SetupStatus interface with isConfigured, agentCount, lastModified, projectAgents, userAgents
- MUST handle missing workspace gracefully (return sensible defaults)
- MUST implement basic caching (5 second TTL) to reduce file system checks
- MUST follow Result&lt;T, Error&gt; pattern for all public methods

**Implementation Details**:

```typescript
// Interface to implement
interface SetupStatus {
  isConfigured: boolean; // True if any agents exist
  agentCount: number; // Total project + user agents
  lastModified: string | null; // ISO timestamp of last change
  projectAgents: string[]; // Agent names from .claude/agents/
  userAgents: string[]; // Agent names from ~/.claude/agents/
}

// Service signature
@injectable()
export class SetupStatusService {
  async getStatus(workspaceUri: vscode.Uri): Promise<Result<SetupStatus, Error>>;
}
```

**Dependencies**:

- @inject(TOKENS.AGENT_DISCOVERY_SERVICE) - AgentDiscoveryService
- @inject(TOKENS.EXTENSION_CONTEXT) - vscode.ExtensionContext
- @inject(TOKENS.LOGGER) - Logger

**Acceptance Criteria**:

- [ ] Service implements getStatus() method returning SetupStatus
- [ ] Uses AgentDiscoveryService.searchAgents() to discover agents
- [ ] Distinguishes between project scope and user scope agents
- [ ] Returns lastModified timestamp from .claude/agents/ directory stat
- [ ] Implements 5-second cache to prevent excessive file system calls
- [ ] Handles workspace unavailable scenario without throwing
- [ ] Returns Result&lt;SetupStatus, Error&gt; for error handling

---

### Task 1.2: Add DI Token for SetupStatusService IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts

**Dependencies**: Task 1.1

**Spec Reference**: implementation-plan.md:170-172

**Pattern to Follow**: tokens.ts:19-27 (existing tokens)

**Quality Requirements**:

- MUST use Symbol.for() for cross-module DI support
- MUST add token to AGENT_GENERATION_TOKENS registry
- MUST include JSDoc comment explaining service responsibility

**Implementation Details**:

```typescript
// Add after SETUP_WIZARD_SERVICE (line ~19)
/**
 * SetupStatusService - Agent configuration status detection
 * Responsibilities: Check agent existence, count agents, return last modified timestamp
 */
export const SETUP_STATUS_SERVICE = Symbol.for('SetupStatusService');

// Add to AGENT_GENERATION_TOKENS registry (line ~115)
export const AGENT_GENERATION_TOKENS = {
  // Core Orchestration
  SETUP_WIZARD_SERVICE,
  SETUP_STATUS_SERVICE, // ADD THIS LINE
  AGENT_GENERATION_ORCHESTRATOR,
  // ... rest
} as const;
```

**Acceptance Criteria**:

- [ ] SETUP_STATUS_SERVICE token created using Symbol.for()
- [ ] Token added to AGENT_GENERATION_TOKENS registry
- [ ] JSDoc comment documents service responsibility
- [ ] Token follows naming convention (UPPER_SNAKE_CASE)

---

### Task 1.3: Export SetupStatusService from library IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts

**Dependencies**: Task 1.1, Task 1.2

**Spec Reference**: implementation-plan.md:173

**Pattern to Follow**: Check existing exports in index.ts

**Quality Requirements**:

- MUST export SetupStatusService class
- MUST maintain alphabetical ordering of exports (if pattern exists)
- MUST export from correct path

**Implementation Details**:

```typescript
// Add to service exports section
export { SetupStatusService } from './lib/services/setup-status.service';
```

**Acceptance Criteria**:

- [ ] SetupStatusService exported from index.ts
- [ ] Export path is correct (./lib/services/setup-status.service)
- [ ] No build errors after export addition

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build agent-generation`
- No TypeScript errors
- SetupStatusService is importable from @ptah-extension/agent-generation

---

## Batch 2: Command Registration IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Estimated Time**: 1.5 hours

### Task 2.1: Register ptah.setupAgents command in package.json IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json

**Spec Reference**: implementation-plan.md:175-240

**Pattern to Follow**: package.json:59-65 (existing ptah.openFullPanel command)

**Quality Requirements**:

- MUST add command to contributes.commands array
- MUST use "Ptah" category for consistency
- MUST use clear, user-friendly title
- MUST make command available in Command Palette

**Implementation Details**:

```json
// Add to "contributes.commands" array (after line 65)
{
  "command": "ptah.setupAgents",
  "title": "Setup Claude Agents",
  "category": "Ptah",
  "icon": "$(tools)"
}
```

**Acceptance Criteria**:

- [ ] Command added to contributes.commands array
- [ ] Command ID is "ptah.setupAgents"
- [ ] Title is "Setup Claude Agents"
- [ ] Category is "Ptah"
- [ ] Icon uses VSCode codicon ($(tools))
- [ ] JSON syntax is valid (no trailing commas)

---

### Task 2.2: Implement command handler in RPC registration IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts

**Dependencies**: Task 2.1, Batch 1

**Spec Reference**: implementation-plan.md:189-218

**Pattern to Follow**: Look for command registration in main.ts or similar

**Quality Requirements**:

- MUST use CommandManager.registerCommand() pattern
- MUST validate workspace exists before calling SetupWizardService
- MUST show error notification if workspace unavailable
- MUST call SetupWizardService.launchWizard() on success
- MUST handle errors gracefully with user-friendly messages

**Implementation Details**:

```typescript
// Add new private method to RpcMethodRegistrationService class
private registerSetupAgentsCommand(): void {
  const commandManager = // resolve from DI
  const wizardService = // resolve AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE

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

      const result = await wizardService.launchWizard(workspaceUri);

      if (result.isErr()) {
        vscode.window.showErrorMessage(`Failed to launch setup wizard: ${result.error.message}`);
      }
    },
  });
}

// Call from constructor or registerAll() method
```

**Dependencies**:

- @inject(TOKENS.COMMAND_MANAGER) - CommandManager
- DIContainer.resolve(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE)

**Acceptance Criteria**:

- [ ] registerSetupAgentsCommand() method created
- [ ] Method called during service initialization
- [ ] Validates workspace exists before proceeding
- [ ] Shows clear error if workspace missing
- [ ] Calls SetupWizardService.launchWizard() correctly
- [ ] Handles Result.isErr() case with error notification
- [ ] Command appears in Command Palette (Ctrl+Shift+P)
- [ ] Command launches wizard when executed

---

**Batch 2 Verification**:

- Command appears in Command Palette when typing "Setup Claude Agents"
- Command shows error notification when no workspace open
- Command launches wizard webview when workspace exists
- No console errors during command execution

---

## Batch 3: Frontend Widget Component IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (needs RPC handlers from Batch 4)
**Estimated Time**: 3 hours

### Task 3.1: Create SetupStatusWidgetComponent IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-status-widget.component.ts

**Spec Reference**: implementation-plan.md:242-388

**Pattern to Follow**:

- Standalone component: chat-view.component.ts:41-54
- Signal-based state: chat-view.component.ts:68-69
- DaisyUI styling: chat-view.component.html:67-101
- RPC messaging: VSCodeService.postMessage() pattern

**Quality Requirements**:

- MUST be standalone Angular component
- MUST use signal() for all reactive state (no RxJS)
- MUST use ChangeDetectionStrategy.OnPush
- MUST use DaisyUI card and button classes for consistency
- MUST handle 3 states: loading, error, success
- MUST show skeleton during loading
- MUST disable button during launch operation
- MUST format timestamps as relative time ("2 hours ago")

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-setup-status-widget',
  standalone: true,
  imports: [],
  template: `
    <div class="card bg-base-200 border border-base-300 mb-4">
      <div class="card-body p-4">
        @if (loading()) {
        <!-- DaisyUI skeleton loader -->
        } @else if (error()) {
        <!-- Error alert -->
        } @else if (status()) {
        <!-- Status display + button -->
        <button class="btn btn-primary btn-sm" [disabled]="launching()" (click)="launchWizard()">
          {{ status()!.isConfigured ? 'Update' : 'Configure' }}
        </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupStatusWidgetComponent implements OnInit {
  // Signal-based state
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly launching = signal(false);
  readonly status = signal<SetupStatus | null>(null);

  ngOnInit(): void {
    this.fetchStatus();
  }

  private fetchStatus(): void {
    // Send RPC: setup-status:get-status
  }

  launchWizard(): void {
    // Send RPC: setup-wizard:launch
  }
}
```

**RPC Messages**:

- Send: `setup-status:get-status` (on init)
- Send: `setup-wizard:launch` (on button click)
- Receive: Response for get-status (update status signal)

**Acceptance Criteria**:

- [ ] Component is standalone with imports array
- [ ] All state uses signal() (loading, error, launching, status)
- [ ] Uses ChangeDetectionStrategy.OnPush
- [ ] Loading state shows DaisyUI skeleton
- [ ] Error state shows DaisyUI alert
- [ ] Success state shows agent count and last modified
- [ ] Button text is "Configure" when isConfigured=false
- [ ] Button text is "Update" when isConfigured=true
- [ ] Button disabled during launching state
- [ ] Calls VSCodeService.postMessage() for RPC
- [ ] Template uses @if control flow (not \*ngIf)
- [ ] DaisyUI classes match existing chat components

---

### Task 3.2: Add RPC response handler in SetupStatusWidgetComponent IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-status-widget.component.ts

**Dependencies**: Task 3.1

**Spec Reference**: implementation-plan.md:350-368

**Pattern to Follow**: VSCodeService message listener setup

**Quality Requirements**:

- MUST listen for RPC responses
- MUST update status signal when response received
- MUST handle error responses
- MUST set loading=false after response

**Implementation Details**:

```typescript
// In SetupStatusWidgetComponent
private setupRpcListener(): void {
  // Subscribe to VSCodeService messages
  // Filter for 'setup-status:get-status' responses
  // Update status() signal
  // Handle errors
}

// Call from ngOnInit()
ngOnInit(): void {
  this.setupRpcListener();
  this.fetchStatus();
}
```

**Acceptance Criteria**:

- [ ] Component listens for RPC responses
- [ ] status() signal updated on successful response
- [ ] error() signal set on error response
- [ ] loading() signal set to false after response
- [ ] Proper cleanup on component destroy

---

### Task 3.3: Export SetupStatusWidgetComponent from library IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\index.ts

**Dependencies**: Task 3.1

**Spec Reference**: implementation-plan.md:414

**Pattern to Follow**: Check existing component exports in index.ts

**Quality Requirements**:

- MUST export SetupStatusWidgetComponent class
- MUST maintain consistent export structure

**Implementation Details**:

```typescript
// Add to component exports
export { SetupStatusWidgetComponent } from './lib/components/molecules/setup-status-widget.component';
```

**Acceptance Criteria**:

- [ ] SetupStatusWidgetComponent exported from index.ts
- [ ] Export path is correct
- [ ] No build errors after export addition
- [ ] Component is importable from @ptah-extension/chat

---

**Batch 3 Verification**:

- Component builds without errors: `npx nx build chat`
- Component is importable from @ptah-extension/chat
- TypeScript compilation passes
- No lint errors in component file

---

## Batch 4: Integration & RPC Wiring IMPLEMENTED

**Developer**: frontend-developer (Tasks 4.1-4.2), backend-developer (Task 4.3)
**Tasks**: 3 | **Dependencies**: Batch 3, Batch 1
**Estimated Time**: 2 hours

### Task 4.1: Import widget in ChatViewComponent IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts

**Dependencies**: Batch 3

**Spec Reference**: implementation-plan.md:416-446

**Pattern to Follow**: chat-view.component.ts:43-50 (existing imports)

**Quality Requirements**:

- MUST add SetupStatusWidgetComponent to imports array
- MUST maintain alphabetical ordering (if pattern exists)
- MUST not break existing functionality

**Implementation Details**:

```typescript
// Add import statement
import { SetupStatusWidgetComponent } from '../molecules/setup-status-widget.component';

// Add to @Component imports array
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [
    // ... existing imports
    SetupStatusWidgetComponent, // ADD THIS
  ],
  // ... rest
})
```

**Acceptance Criteria**:

- [ ] SetupStatusWidgetComponent imported at top of file
- [ ] Component added to @Component imports array
- [ ] No TypeScript errors
- [ ] Existing chat view functionality unchanged

---

### Task 4.2: Add widget to chat empty state template IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html

**Dependencies**: Task 4.1

**Spec Reference**: implementation-plan.md:449-480

**Pattern to Follow**: chat-view.component.html:53-101 (empty state structure)

**Quality Requirements**:

- MUST position widget above Vibe/Spec mode cards
- MUST maintain responsive layout (max-w-2xl container)
- MUST use consistent spacing (mb-6 between sections)
- MUST only show in empty state (when messages.length === 0)
- MUST not disrupt existing empty state layout

**Implementation Details**:

```html
<!-- Insert after "Plan, search, or build anything" paragraph (around line 64) -->
<!-- BEFORE the Mode Selection Cards -->

<!-- Agent Setup Status Widget -->
<div class="w-full max-w-2xl mb-6">
  <ptah-setup-status-widget />
</div>

<!-- Mode Selection Cards (existing) -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl mb-6">
  <!-- Vibe/Spec cards remain unchanged -->
</div>
```

**Acceptance Criteria**:

- [ ] Widget added inside empty state @if block
- [ ] Widget positioned ABOVE mode selection cards
- [ ] Widget uses max-w-2xl container for consistency
- [ ] Widget has mb-6 spacing
- [ ] Existing empty state layout unchanged
- [ ] Widget only visible when no messages exist
- [ ] Responsive layout maintained on mobile/desktop

---

### Task 4.3: Register RPC message handlers for setup status IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts

**Dependencies**: Batch 1, Task 3.1

**Spec Reference**: implementation-plan.md:502-590

**Pattern to Follow**: rpc-method-registration.service.ts:523-569 (existing RPC handlers)

**Quality Requirements**:

- MUST register handler for `setup-status:get-status`
- MUST register handler for `setup-wizard:launch`
- MUST validate workspace exists before calling services
- MUST return proper error messages
- MUST handle async operations correctly
- MUST follow existing RPC registration patterns

**Implementation Details**:

```typescript
// Add new private method to RpcMethodRegistrationService
private registerSetupStatusHandlers(): void {
  const setupStatusService = DIContainer.resolve(
    AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE
  );
  const setupWizardService = DIContainer.resolve(
    AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
  );

  // Handler 1: Get status
  this.rpcHandler.register('setup-status:get-status', async (payload) => {
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

  // Handler 2: Launch wizard
  this.rpcHandler.register('setup-wizard:launch', async (payload) => {
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

// Call from registerAll() method (or constructor)
registerAll(): void {
  // ... existing registrations
  this.registerSetupStatusHandlers(); // ADD THIS
}
```

**Acceptance Criteria**:

- [ ] registerSetupStatusHandlers() method created
- [ ] Handler registered for 'setup-status:get-status'
- [ ] Handler registered for 'setup-wizard:launch'
- [ ] Both handlers validate workspace exists
- [ ] Both handlers return proper error objects
- [ ] get-status handler returns SetupStatus data on success
- [ ] launch handler returns success:true on success
- [ ] Method called during RPC registration initialization
- [ ] No TypeScript errors
- [ ] RPC messages work end-to-end

---

**Batch 4 Verification**:

- Widget appears in chat empty state
- Widget shows loading skeleton on initial load
- Widget displays accurate agent count
- "Configure" button appears when no agents exist
- "Update" button appears when agents exist
- Button click launches wizard webview
- Command Palette command works independently
- No console errors during widget lifecycle
- All RPC messages transmit and respond correctly

---

## Final Verification Checklist

### End-to-End Flow Testing

- [ ] Open Ptah extension with empty chat
- [ ] Verify SetupStatusWidgetComponent renders in empty state
- [ ] Verify loading state appears briefly
- [ ] Verify status displays correctly (agent count, timestamp)
- [ ] Click "Configure"/"Update" button
- [ ] Verify wizard webview opens
- [ ] Verify button shows loading state during launch
- [ ] Test Command Palette: Ctrl+Shift+P → "Setup Claude Agents"
- [ ] Verify command launches wizard
- [ ] Test error handling: Close workspace, verify error messages

### Code Quality

- [ ] All files use proper TypeScript types (no `any`)
- [ ] All services follow injectable pattern
- [ ] All components use standalone + signals
- [ ] All RPC handlers follow error handling pattern
- [ ] All DaisyUI classes are valid and consistent
- [ ] No console errors or warnings
- [ ] No lint errors
- [ ] Build passes: `npx nx build agent-generation chat`

### Documentation

- [ ] All new services have JSDoc comments
- [ ] All DI tokens have responsibility comments
- [ ] Complex logic has inline comments
- [ ] Type interfaces are well-documented

---

## Files Affected Summary

### Created (5 files)

**Backend**:

- D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-status.service.ts

**Frontend**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-status-widget.component.ts

**Tests** (Optional, not in critical path):

- D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-status.service.spec.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-status-widget.component.spec.ts

### Modified (6 files)

**Backend**:

- D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts
- D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts
- D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts
- D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json

**Frontend**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
- D:\projects\ptah-extension\libs\frontend\chat\src\index.ts

---

## Success Metrics

### Performance

- Status check completes in < 100ms
- Widget renders without blocking chat UI
- RPC round-trip < 200ms

### User Experience

- Agent status visible immediately on chat open
- Button text clearly indicates action
- Error messages are actionable
- Loading states provide feedback

### Code Quality

- All batches pass code-logic-reviewer
- TypeScript strict mode passes
- No lint warnings
- Build succeeds for both libraries

---

## Notes for Developers

### Backend Developer (Batches 1, 2, 4.3)

**Key Patterns**:

- Use Result&lt;T, Error&gt; for all service methods
- Use @injectable() decorator for all services
- Use Symbol.for() for DI tokens
- Follow AgentDiscoveryService.searchAgents() pattern

**Critical Dependencies**:

- AgentDiscoveryService from workspace-intelligence
- SetupWizardService already exists (use launchWizard method)
- CommandManager from vscode-core

**Testing Approach**:

- Unit test SetupStatusService.getStatus()
- Manual test: Create .claude/agents/ with sample agents
- Verify status reflects actual file system state

### Frontend Developer (Batches 3, 4.1-4.2)

**Key Patterns**:

- Use signal() for all state (NOT RxJS)
- Use standalone components with imports
- Use ChangeDetectionStrategy.OnPush
- Use DaisyUI classes for styling
- Use @if/@for control flow (NOT *ngIf/*ngFor)

**Critical Dependencies**:

- VSCodeService.postMessage() for RPC
- DaisyUI card/button/skeleton classes

**Testing Approach**:

- Test all 3 states: loading, error, success
- Test button states: enabled, disabled (launching)
- Test RPC message flow
- Verify DaisyUI styling matches existing components

### Integration Testing

After all batches complete:

1. Test empty state shows widget
2. Test widget shows accurate status
3. Test button launches wizard
4. Test Command Palette launches wizard
5. Test error handling (no workspace)
6. Test with 0 agents (Configure button)
7. Test with N agents (Update button)

---

## Deployment Checklist

Before marking task complete:

- [ ] All batches marked COMPLETE
- [ ] All verification checkpoints passed
- [ ] End-to-end flow tested manually
- [ ] No console errors or warnings
- [ ] Build passes for both libraries
- [ ] Git commits created for each batch
- [ ] Code reviewed (code-logic-reviewer + code-style-reviewer)
