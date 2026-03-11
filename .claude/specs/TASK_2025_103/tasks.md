# Development Tasks - TASK_2025_103

**Total Tasks**: 14 | **Batches**: 4 | **Status**: ALL BATCHES COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- SDK resume parameter `resume: string` exists in SdkQueryOptions - VERIFIED (sdk-query-options-builder.ts:59,173)
- AgentSessionWatcherService emits 'agent-start' events - VERIFIED (agent-session-watcher.service.ts:234)
- SubagentHookHandler exists for start/stop hooks - VERIFIED (sdk-query-options-builder.ts:108)
- SessionLifecycleManager.endSession handles abort - VERIFIED (session-lifecycle-manager.ts)
- agentId is stable across hook and SDK messages - VERIFIED (TASK_2025_099)

### Risks Identified

| Risk                                    | Severity | Mitigation                                                          |
| --------------------------------------- | -------- | ------------------------------------------------------------------- |
| SubagentStop hook doesn't fire on abort | HIGH     | Task 2.2: Mark all running subagents as interrupted in endSession() |
| toolCallId vs toolUseId naming mismatch | LOW      | Documented - same field with different naming convention            |
| 24h TTL may expire mid-session          | LOW      | UI shows "Resume" only if within TTL                                |

### Edge Cases to Handle

- [ ] Multiple agents interrupted simultaneously -> Batch update in registry (Task 1.2)
- [ ] Resume while another agent is running -> SDK handles via abort controller (no extra handling needed)
- [ ] Session deleted after interruption -> Remove from registry in deleteSession (Task 2.3)

---

## Batch 1: Backend Types and SubagentRegistry Foundation - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Status**: COMPLETE
**Commit**: c35a9fb

### Task 1.1: Create subagent-registry.types.ts

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\subagent-registry.types.ts
**Spec Reference**: implementation-plan.md:42-85
**Pattern to Follow**: D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts

**Quality Requirements**:

- Export SubagentRecord interface with all fields from spec
- Export SubagentStatus type: 'running' | 'completed' | 'interrupted'
- Export query/result types for RPC methods
- Use branded types where appropriate (SessionId)

**Validation Notes**:

- toolCallId uses string type (matches ExecutionNode.toolCallId pattern)
- sessionId is the SUBAGENT's session ID (for resume), NOT parent session

**Implementation Details**:

```typescript
export interface SubagentRecord {
  toolCallId: string; // From SDK hook SubagentStart event
  sessionId: string; // Subagent's own session ID for resume
  agentType: string; // 'Explore', 'Plan', etc.
  status: SubagentStatus; // Lifecycle state
  startedAt: number; // Timestamp
  interruptedAt?: number; // Set when session aborted
}

export type SubagentStatus = 'running' | 'completed' | 'interrupted';

export interface SubagentResumeParams {
  toolCallId: string;
}
export interface SubagentResumeResult {
  success: boolean;
  error?: string;
}
export interface SubagentQueryParams {
  sessionId?: string;
  toolCallId?: string;
}
export interface SubagentQueryResult {
  subagents: SubagentRecord[];
}
```

---

### Task 1.2: Export subagent-registry.types from shared index

**File**: D:\projects\ptah-extension\libs\shared\src\index.ts
**Spec Reference**: implementation-plan.md:86-90
**Pattern to Follow**: Line 9 `export * from './lib/types/permission.types';`

**Quality Requirements**:

- Add export statement for subagent-registry.types
- Maintain alphabetical ordering of exports

**Implementation Details**:

```typescript
export * from './lib/types/subagent-registry.types';
```

---

### Task 1.3: Create SubagentRegistryService

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts
**Spec Reference**: implementation-plan.md:92-180
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts

**Quality Requirements**:

- Injectable service with tsyringe decorators
- In-memory Map<string, SubagentRecord> keyed by toolCallId
- 24h TTL cleanup on get/query operations
- Thread-safe operations
- Emit events for UI updates (optional - can use signal updates via RPC)

**Validation Notes**:

- TTL cleanup is lazy (on access), not timer-based, to avoid memory leaks
- markAllInterrupted() MUST be called from SessionLifecycleManager.endSession()

**Implementation Details**:

```typescript
@injectable()
export class SubagentRegistryService {
  private readonly registry = new Map<string, SubagentRecord>();
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  register(record: SubagentRecord): void;
  update(toolCallId: string, updates: Partial<SubagentRecord>): void;
  get(toolCallId: string): SubagentRecord | null;
  getResumable(): SubagentRecord[]; // status === 'interrupted' within TTL
  markAllInterrupted(sessionId: string): void; // Called on session abort
  remove(toolCallId: string): void;
  removeBySessionId(parentSessionId: string): void; // Called on session delete
  private cleanupExpired(): void; // Lazy TTL cleanup
}
```

---

### Task 1.4: Add SUBAGENT_REGISTRY_SERVICE token and export

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts
**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts
**Spec Reference**: implementation-plan.md:182-200
**Pattern to Follow**: TOKENS.AGENT_SESSION_WATCHER_SERVICE pattern in tokens.ts

**Quality Requirements**:

- Add SUBAGENT_REGISTRY_SERVICE to TOKENS namespace
- Export SubagentRegistryService from vscode-core index.ts

**Implementation Details**:

```typescript
// In tokens.ts
SUBAGENT_REGISTRY_SERVICE: Symbol.for('SubagentRegistryService'),

// In index.ts
export { SubagentRegistryService } from './services/subagent-registry.service';
```

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared && npx nx build vscode-core`
- Types exported correctly from @ptah-extension/shared
- Service exported correctly from @ptah-extension/vscode-core
- No circular dependencies

---

## Batch 2: Backend Integration (SDK + RPC) - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete
**Status**: COMPLETE
**Commit**: 073092c

### Task 2.1: Hook SubagentRegistryService into SubagentHookHandler

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts
**Spec Reference**: implementation-plan.md:202-260
**Pattern to Follow**: Existing SubagentStart/SubagentStop hook handling

**Quality Requirements**:

- Inject SubagentRegistryService via DI
- On SubagentStart: register new SubagentRecord with status='running'
- On SubagentStop: update status to 'completed'
- Use toolCallId from hook event as registry key

**Validation Notes**:

- SubagentStart provides: toolUseId (=toolCallId), agentType, sessionId (subagent session)
- Hook fires BEFORE agent_start stream event

**Implementation Details**:

```typescript
// In SubagentStart hook callback:
this.subagentRegistry.register({
  toolCallId: event.toolUseId,
  sessionId: event.sessionId, // Subagent's own session ID
  agentType: event.agentType,
  status: 'running',
  startedAt: Date.now(),
});

// In SubagentStop hook callback:
this.subagentRegistry.update(event.toolUseId, { status: 'completed' });
```

---

### Task 2.2: Mark subagents as interrupted on session abort

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
**Spec Reference**: implementation-plan.md:262-300
**Pattern to Follow**: Existing permissionHandler.cleanupPendingPermissions() call

**Quality Requirements**:

- Inject SubagentRegistryService via DI
- In endSession(): call subagentRegistry.markAllInterrupted(sessionId)
- Call AFTER permission cleanup but BEFORE session removal

**Validation Notes**:

- RISK MITIGATION: This is the key fix for subagent interrupt detection
- endSession is called for both normal completion and abort
- Check session.aborted flag to distinguish abort from completion

**Implementation Details**:

```typescript
// In endSession() method, after permission cleanup:
if (session.aborted) {
  this.subagentRegistry.markAllInterrupted(sessionId);
}
```

---

### Task 2.3: Create SubagentRpcHandlers class

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\subagent-rpc.handlers.ts
**Spec Reference**: implementation-plan.md:302-380
**Pattern to Follow**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts

**Quality Requirements**:

- Register subagent:resume RPC method
- Register subagent:query RPC method
- Use type-safe params/results from shared types
- subagent:resume calls sdkAdapter.resumeSubagent()

**Validation Notes**:

- resumeSubagent method will be added in Task 2.4

**Implementation Details**:

```typescript
@injectable()
export class SubagentRpcHandlers {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler, @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE) private readonly registry: SubagentRegistryService, @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter) {}

  register(): void {
    this.registerSubagentResume();
    this.registerSubagentQuery();
  }

  private registerSubagentResume(): void {
    this.rpcHandler.registerMethod<SubagentResumeParams, SubagentResumeResult>('subagent:resume', async (params) => {
      const record = this.registry.get(params.toolCallId);
      if (!record || record.status !== 'interrupted') {
        return { success: false, error: 'Subagent not found or not resumable' };
      }
      return this.sdkAdapter.resumeSubagent(record);
    });
  }

  private registerSubagentQuery(): void {
    this.rpcHandler.registerMethod<SubagentQueryParams, SubagentQueryResult>('subagent:query', async (params) => {
      if (params.toolCallId) {
        const record = this.registry.get(params.toolCallId);
        return { subagents: record ? [record] : [] };
      }
      return { subagents: this.registry.getResumable() };
    });
  }
}
```

---

### Task 2.4: Add resumeSubagent method to SdkAgentAdapter

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Spec Reference**: implementation-plan.md:382-440
**Pattern to Follow**: Existing resumeSession() method

**Quality Requirements**:

- Create new resumeSubagent(record: SubagentRecord) method
- Use SDK query() with resume: record.sessionId
- Return stream for frontend consumption

**Validation Notes**:

- Uses subagent's sessionId, NOT parent session
- SDK resume option already verified to exist

**Implementation Details**:

```typescript
async resumeSubagent(record: SubagentRecord): Promise<AsyncIterable<FlatStreamEventUnion>> {
  const { sessionId, agentType } = record;

  this.logger.info('[SdkAgentAdapter] Resuming interrupted subagent', {
    toolCallId: record.toolCallId,
    sessionId,
    agentType,
  });

  // Build query options with resume parameter
  const queryConfig = await this.queryOptionsBuilder.build({
    userMessageStream: this.createEmptyMessageStream(),
    abortController: new AbortController(),
    sessionConfig: { ... },
    resumeSessionId: sessionId,  // KEY: Resume the subagent's session
  });

  // Start SDK query
  const stream = await this.sdk.query(queryConfig);
  return this.streamTransformer.transformToFlatEvents(stream);
}
```

---

**Batch 2 Verification**:

- Build passes: `npx nx build agent-sdk`
- SubagentHookHandler registers/updates subagents correctly
- SessionLifecycleManager marks interrupted on abort
- SubagentRpcHandlers compiles without errors
- SdkAgentAdapter.resumeSubagent method exists

---

## Batch 3: Backend DI Registration and RPC Integration - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2 complete
**Status**: COMPLETE
**Commit**: bbeb5f8

### Task 3.1: Register SubagentRegistryService and RpcHandlers in DI container

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts
**Spec Reference**: implementation-plan.md:442-480
**Pattern to Follow**: ChatRpcHandlers registration pattern (line 130-131)

**Quality Requirements**:

- Register SubagentRegistryService as singleton with TOKENS.SUBAGENT_REGISTRY_SERVICE
- Register SubagentRpcHandlers as singleton
- Add SubagentRpcHandlers to RpcMethodRegistrationService factory

**Implementation Details**:

```typescript
// In PHASE 1.5 (after vscode-core registration):
container.registerSingleton(TOKENS.SUBAGENT_REGISTRY_SERVICE, SubagentRegistryService);

// In PHASE 1.6 (RPC Domain Handlers):
container.registerSingleton(SubagentRpcHandlers);

// In RpcMethodRegistrationService factory:
// Add c.resolve(SubagentRpcHandlers) to constructor args
```

---

### Task 3.2: Integrate SubagentRpcHandlers into RpcMethodRegistrationService

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan.md:482-520
**Pattern to Follow**: ChatRpcHandlers injection and registration (line 71, 96)

**Quality Requirements**:

- Add SubagentRpcHandlers as constructor dependency
- Call subagentHandlers.register() in registerAll()
- Add to debug log of registered methods

**Implementation Details**:

```typescript
// Add constructor parameter:
private readonly subagentHandlers: SubagentRpcHandlers,

// In registerAll():
this.subagentHandlers.register();

// Update methods array in log:
methods: ['chat:start', ..., 'subagent:resume', 'subagent:query']
```

---

**Batch 3 Verification**:

- Build passes: `npx nx build ptah-extension-vscode`
- SubagentRegistryService resolves from container
- SubagentRpcHandlers registers methods
- RPC methods 'subagent:resume' and 'subagent:query' are callable

---

## Batch 4: Frontend Integration - COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3 complete
**Status**: COMPLETE
**Commit**: 9f5a305

### Task 4.1: Add subagent RPC methods to ClaudeRpcService

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\claude-rpc.service.ts
**Spec Reference**: implementation-plan.md:522-560
**Pattern to Follow**: deleteSession() method (line 246-258)

**Quality Requirements**:

- Add resumeSubagent(toolCallId: string) method
- Add querySubagents() method
- Use proper TypeScript types from @ptah-extension/shared

**Implementation Details**:

```typescript
async resumeSubagent(toolCallId: string): Promise<RpcResult<SubagentResumeResult>> {
  return this.call('subagent:resume', { toolCallId });
}

async querySubagents(): Promise<RpcResult<SubagentQueryResult>> {
  return this.call('subagent:query', {});
}
```

---

### Task 4.2: Add resumableSubagents signal to ChatStore

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: implementation-plan.md:562-620
**Pattern to Follow**: sessions signal pattern (line 130)

**Quality Requirements**:

- Add private \_resumableSubagents signal
- Add public resumableSubagents readonly signal
- Add refreshResumableSubagents() method that calls RPC
- Add handleSubagentResume(toolCallId) method

**Implementation Details**:

```typescript
// Private mutable signal
private readonly _resumableSubagents = signal<SubagentRecord[]>([]);

// Public readonly
readonly resumableSubagents = this._resumableSubagents.asReadonly();

async refreshResumableSubagents(): Promise<void> {
  const result = await this._claudeRpcService.querySubagents();
  if (result.isSuccess()) {
    this._resumableSubagents.set(result.data.subagents);
  }
}

async handleSubagentResume(toolCallId: string): Promise<void> {
  const result = await this._claudeRpcService.resumeSubagent(toolCallId);
  if (result.isSuccess()) {
    await this.refreshResumableSubagents();
  }
}
```

---

### Task 4.3: Add Resume button to InlineAgentBubbleComponent

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts
**Spec Reference**: implementation-plan.md:622-700
**Pattern to Follow**: Existing badge display logic (line 98-115)

**Quality Requirements**:

- Add isResumable() computed signal based on node().status === 'interrupted'
- Add "Resume" button in header next to badges
- Emit resumeRequested event when clicked
- Style consistently with existing badges

**Validation Notes**:

- Button should only show when node is resumable (interrupted status)
- Use lucide-angular PlayCircle icon

**Implementation Details**:

```typescript
// Add imports
import { PlayCircle } from 'lucide-angular';

// Add to component class
readonly PlayCircleIcon = PlayCircle;
readonly isResumable = computed(() => this.node().status === 'interrupted');
readonly resumeRequested = output<string>(); // Emits toolCallId

// In template, after badges:
@if (isResumable()) {
  <button
    type="button"
    class="btn btn-xs btn-primary gap-1"
    (click)="onResumeClick($event)"
  >
    <lucide-angular [img]="PlayCircleIcon" class="w-3 h-3" />
    <span class="text-[9px]">Resume</span>
  </button>
}

// Handler
protected onResumeClick(event: Event): void {
  event.stopPropagation();
  const toolCallId = this.node().toolCallId;
  if (toolCallId) {
    this.resumeRequested.emit(toolCallId);
  }
}
```

---

### Task 4.4: Create ResumeNotificationBanner component

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\resume-notification-banner.component.ts
**Spec Reference**: implementation-plan.md:702-780
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts

**Quality Requirements**:

- Standalone Angular component with OnPush change detection
- Input: resumableSubagents signal
- Displays count of resumable agents with "Resume All" option
- Dismissable banner
- Uses DaisyUI alert styling

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-resume-notification-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resumableSubagents().length > 0 && !dismissed()) {
    <div class="alert alert-info shadow-lg mb-4">
      <lucide-angular [img]="PlayCircleIcon" class="w-5 h-5" />
      <div>
        <h3 class="font-bold text-sm">Interrupted Agents</h3>
        <p class="text-xs">{{ resumableSubagents().length }} agent(s) can be resumed</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-primary" (click)="resumeAll()">Resume All</button>
        <button class="btn btn-sm btn-ghost" (click)="dismiss()">Dismiss</button>
      </div>
    </div>
    }
  `,
})
export class ResumeNotificationBannerComponent {
  readonly resumableSubagents = input.required<SubagentRecord[]>();
  readonly resumeAllRequested = output<void>();

  readonly dismissed = signal(false);
  readonly PlayCircleIcon = PlayCircle;

  protected resumeAll(): void {
    this.resumeAllRequested.emit();
  }

  protected dismiss(): void {
    this.dismissed.set(true);
  }
}
```

---

**Batch 4 Verification**:

- Build passes: `npx nx build core && npx nx build chat`
- ClaudeRpcService methods compile without errors
- ChatStore signals work correctly
- InlineAgentBubbleComponent shows Resume button for interrupted nodes
- ResumeNotificationBanner displays when resumable subagents exist
- Lint passes: `npx nx lint chat`

---

## Summary

| Batch | Name                        | Developer          | Tasks | Status   | Commit  |
| ----- | --------------------------- | ------------------ | ----- | -------- | ------- |
| 1     | Types & Registry Foundation | backend-developer  | 4     | COMPLETE | c35a9fb |
| 2     | SDK + RPC Integration       | backend-developer  | 4     | COMPLETE | 073092c |
| 3     | DI Registration             | backend-developer  | 2     | COMPLETE | bbeb5f8 |
| 4     | Frontend Integration        | frontend-developer | 4     | COMPLETE | 9f5a305 |

**Critical Path**: Batch 1 -> Batch 2 -> Batch 3 -> Batch 4 (ALL COMPLETE)

**Risk Mitigation Built Into Tasks**:

- Task 2.2: Addresses SubagentStop not firing on abort
- Task 1.3: TTL cleanup prevents stale data
- Task 4.4: Dismissable banner prevents UI clutter
