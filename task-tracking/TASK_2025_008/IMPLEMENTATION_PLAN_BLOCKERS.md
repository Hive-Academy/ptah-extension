# Implementation Plan Blockers - Phase 1-6 Feature Analysis

**Analysis Date**: 2025-01-20
**Planned Features**: 6 major features from implementation plan
**Architectural Blockers Identified**: 18 critical gaps preventing implementation

---

## Executive Summary

**CRITICAL FINDING**: The implementation plan proposed 6 major features (@ mentions, model selection, MCP status, analytics, cost tracking, session management). However, **4 out of 6 features** (67%) are **BLOCKED by architectural gaps**:

- **READY TO IMPLEMENT**: 2/6 features (33%)

  - Session Management UI (backend complete)
  - Analytics Dashboard (backend exists, needs wiring)

- **NEEDS MINOR CHANGES**: 1/6 features (17%)

  - Model Selection UI (backend partial, frontend exists but broken)

- **NEEDS MAJOR REFACTORING**: 2/6 features (33%)

  - @ Mention Autocomplete (frontend component missing integration)
  - MCP Server Status (no backend implementation)

- **BLOCKED BY ARCHITECTURE**: 1/6 features (17%)
  - Cost Tracking (no cost data in message protocol)

**Estimated Total Effort**: 32-42 hours (before addressing blockers)

---

## Feature 1: @ Mention Autocomplete for File Context

### Architecture Requirements

**Backend**:

- ✅ **READY**: workspace-intelligence library (WorkspaceIndexer, FileRelevanceScorer)

  - File: `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
  - Capability: Indexes workspace files, scores relevance

- ✅ **READY**: ContextOrchestrationService

  - File: `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts`
  - Methods: searchFiles(), getFileSuggestions()

- ✅ **READY**: Message Protocol
  - Types: CONTEXT_MESSAGE_TYPES.SEARCH_FILES, CONTEXT_MESSAGE_TYPES.GET_FILE_SUGGESTIONS
  - File: `D:/projects/ptah-extension/libs/shared/src/lib/constants/message-types.ts` (lines 99-102)

**Frontend**:

- ⚠️ **EXISTS BUT NOT INTEGRATED**: FileSuggestionsDropdownComponent

  - File: `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/file-suggestions-dropdown/file-suggestions-dropdown.component.ts`
  - **BLOCKER**: NOT imported in ChatInputAreaComponent

- ✅ **READY**: FilePickerService

  - File: `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/file-picker.service.ts`
  - Methods: searchFiles(), getFileSuggestions()

- ⚠️ **PARTIAL**: FileTagComponent
  - File: `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/file-tag/file-tag.component.ts`
  - **BLOCKER**: Component exists but NOT rendered in ChatInputAreaComponent

### Blockers

#### BLOCKER 1.1: FileSuggestionsDropdownComponent Not Integrated

**Current State**:

- ChatInputAreaComponent has NO import of FileSuggestionsDropdownComponent
- No @ mention detection logic in textarea
- No trigger to show dropdown on "@" character

**Required Changes**:

```typescript
// In ChatInputAreaComponent:
import { FileSuggestionsDropdownComponent } from '../file-suggestions-dropdown/file-suggestions-dropdown.component';

@Component({
  imports: [
    CommonModule,
    FormsModule,
    FileSuggestionsDropdownComponent, // ADD
  ],
})
export class ChatInputAreaComponent {
  showFileSuggestions = signal(false);
  searchQuery = signal('');

  onTextareaInput(event: Event): void {
    const input = (event.target as HTMLTextAreaElement).value;
    const cursorPos = (event.target as HTMLTextAreaElement).selectionStart;

    // Detect @ mention
    const textBeforeCursor = input.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      this.searchQuery.set(atMatch[1]);
      this.showFileSuggestions.set(true);
    } else {
      this.showFileSuggestions.set(false);
    }
  }
}
```

**Effort**: MEDIUM (3-4 hours)

- Add @ detection logic: 1 hour
- Wire FileSuggestionsDropdownComponent: 1 hour
- Handle file selection → insert into message: 1 hour
- Test autocomplete UX: 1 hour

#### BLOCKER 1.2: File Context Not Sent to Backend

**Current State**:

- ChatComponent.sendMessage() calls `chat.sendMessage(content, agent)` (line 467)
- **NO `files` parameter** passed to backend

**Required Changes**:

```typescript
// In ChatComponent:
sendMessage(): void {
  const content = this.chatState.currentMessage().trim();
  const selectedFiles = this.chatState.selectedFiles(); // ADD signal
  this.chat.sendMessage(content, selectedFiles); // Pass files array
}

// In ChatService.sendMessage():
async sendMessage(content: string, files?: string[]): Promise<void> {
  await this.vscode.postStrictMessage('chat:sendMessage', {
    content,
    files, // Include in payload
    correlationId: CorrelationId.create()
  });
}
```

**Effort**: SMALL (1-2 hours)

- Add selectedFiles signal to ChatStateManagerService: 30min
- Wire to ChatComponent: 30min
- Test file attachment in backend: 1 hour

### Refactoring Effort

**Backend**: SMALL (1 hour) - Already implemented, just needs testing
**Frontend**: LARGE (4-6 hours) - Major UI integration work
**Integration**: SMALL (1 hour) - Wire EventBus messages
**Total**: **6-8 hours**

### Dependencies

**Must Complete Before**: None - can start immediately

**Enables**: File context awareness, smarter Claude responses

---

## Feature 2: Model Selection UI with Persistence

### Architecture Requirements

**Backend**:

- ⚠️ **PARTIAL**: ProviderOrchestrationService

  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/provider/provider-orchestration.service.ts`
  - Has: switchProvider() ✅
  - **MISSING**: switchModel() or setPreferredModel()

- ❌ **NOT IMPLEMENTED**: Model persistence
  - No backend API to save user's preferred model per session
  - No message type for model selection

**Frontend**:

- ✅ **EXISTS**: Model selection dropdown in ChatInputAreaComponent
- ❌ **BROKEN**: Selection doesn't persist or send to backend
  - Evidence: ChatComponent.onAgentChange() only updates local signal (line 481-484)

**Message Protocol**:

- ❌ **MISSING**: No `providers:selectModel` or `config:setPreferredModel` message type

### Blockers

#### BLOCKER 2.1: No Backend API for Model Selection

**Current State**:

- Frontend has dropdown, user selects model
- Frontend updates `chatState.selectedAgent()` signal
- **Backend NEVER receives model selection**
- On webview reload, selection resets to default

**Required Changes**:

```typescript
// 1. Add message type to message-types.ts:
export const PROVIDER_MESSAGE_TYPES = {
  // ...existing types
  SELECT_MODEL: 'providers:selectModel', // ADD
};

// 2. Add payload type to message.types.ts:
export interface ProviderSelectModelPayload {
  readonly providerId: string;
  readonly modelId: string;
  readonly persist: boolean; // Save as default for provider
}

// 3. Implement in ProviderOrchestrationService:
async selectModel(request: { providerId: string; modelId: string; persist: boolean }): Promise<{
  success: boolean;
  model?: string;
  error?: string;
}> {
  // Save to config if persist=true
  if (request.persist) {
    await this.configService.set(`providers.${request.providerId}.defaultModel`, request.modelId);
  }

  // Update current provider's active model
  this.currentModel = request.modelId;

  return { success: true, model: request.modelId };
}

// 4. Wire frontend:
// In ChatComponent.onAgentChange():
onAgentChange(option: DropdownOption): void {
  this.chatState.updateSelectedAgent(option.value);

  // ADD: Send to backend
  this.vscode.postStrictMessage('providers:selectModel', {
    providerId: 'claude-cli', // or current provider ID
    modelId: option.value,
    persist: true
  });
}
```

**Effort**: MEDIUM (3-4 hours)

- Add message type + payload: 30min
- Implement backend selectModel(): 1 hour
- Wire frontend to send message: 1 hour
- Add persistence to config: 1 hour
- Test model selection persists: 30min

#### BLOCKER 2.2: Model Options Hardcoded in Frontend

**Current State**:

- ChatStateManagerService has hardcoded agent options (workflow-orchestrator, researcher, etc.)
- **These are NOT Claude models**, they're custom agents
- Real Claude models (Claude 3.5 Sonnet, Claude 3 Opus, etc.) not exposed

**Required Changes**:

```typescript
// Backend should provide available models via provider capabilities:
interface ProviderInfo {
  id: string;
  name: string;
  status: 'available' | 'unavailable';
  capabilities: {
    models: Array<{
      id: string; // 'claude-3.5-sonnet'
      name: string; // 'Claude 3.5 Sonnet'
      contextWindow: number; // 200000
      costPer1kTokens: { input: number; output: number };
    }>;
  };
}

// Frontend fetches models from provider:
this.providerService.currentProvider().subscribe((provider) => {
  this.availableModels.set(provider.capabilities.models);
});
```

**Effort**: MEDIUM (2-3 hours)

- Extend ProviderInfo type with models: 30min
- Backend: Add model detection to ProviderOrchestrationService: 1 hour
- Frontend: Replace hardcoded agents with dynamic models: 1 hour
- Test model list updates: 30min

### Refactoring Effort

**Backend**: MEDIUM (3-4 hours) - New API endpoint + persistence
**Frontend**: SMALL (1-2 hours) - Wire existing dropdown to backend
**Integration**: SMALL (1 hour) - Add message type
**Total**: **5-7 hours**

### Dependencies

**Must Complete Before**: None

**Blocks**: Cost tracking (need model ID to calculate cost per token)

---

## Feature 3: MCP Server Status & Health Monitoring

### Architecture Requirements

**Backend**:

- ❌ **NOT IMPLEMENTED**: No MCP server integration in codebase
- ❌ **MISSING**: No MCP server detection, health check, or connection management
- ⚠️ **PARTIAL**: ProviderOrchestrationService has health monitoring for AI providers, but NOT MCP servers

**Frontend**:

- ❌ **NOT IMPLEMENTED**: No MCP status UI components
- ⚠️ **CAN EXTEND**: ProviderCardComponent could show MCP server status if backend provides data

**Message Protocol**:

- ❌ **MISSING**: No MCP-specific message types (mcp:status, mcp:connect, mcp:disconnect)

### Blockers

#### BLOCKER 3.1: No MCP Server Backend Integration

**Current State**:

- PTAH has NO MCP server support
- Claude CLI supports MCP servers, but PTAH doesn't expose this

**Required Changes**:

```typescript
// 1. Create new library: libs/backend/mcp-integration/

// 2. Implement MCPServerManager:
interface MCPServer {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools: string[]; // Available tools from this server
  healthCheck: {
    lastPing: number;
    responseTime: number;
    uptime: number;
  };
}

@injectable()
export class MCPServerManager {
  private servers = new Map<string, MCPServer>();

  async discoverServers(): Promise<MCPServer[]> {
    // Scan for MCP servers in workspace
    // Check Claude CLI config for MCP server list
    return [];
  }

  async connectToServer(serverId: string): Promise<boolean> {
    // Establish connection to MCP server
    // Register event listeners for server status
    return false;
  }

  getServerHealth(serverId: string): MCPServer['healthCheck'] {
    // Return health metrics
    return { lastPing: 0, responseTime: 0, uptime: 0 };
  }
}

// 3. Expose via message protocol:
export const MCP_MESSAGE_TYPES = {
  GET_SERVERS: 'mcp:getServers',
  CONNECT_SERVER: 'mcp:connectServer',
  DISCONNECT_SERVER: 'mcp:disconnectServer',
  SERVER_STATUS_CHANGED: 'mcp:serverStatusChanged',
  GET_SERVER_TOOLS: 'mcp:getServerTools',
} as const;

// 4. Create frontend UI:
// MCPServerStatusComponent shows list of MCP servers + health status
```

**Effort**: LARGE (10-12 hours)

- Create mcp-integration library: 1 hour
- Implement MCPServerManager: 4 hours
- Add message protocol: 1 hour
- Wire to message handler: 1 hour
- Create frontend UI components: 3 hours
- Test MCP server discovery + connection: 2 hours

#### BLOCKER 3.2: No MCP Tool Execution Tracking

**Current State**:

- ToolTimelineComponent exists and works for Claude CLI tools ✅
- BUT: Can't distinguish MCP server tools from built-in tools
- No indication of which MCP server provided which tool

**Required Changes**:

```typescript
// Extend ToolExecution interface (chat.service.ts, line 50):
interface ToolExecution {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  // ADD:
  mcpServer?: {
    id: string;
    name: string;
  };
  // ...
}

// When backend publishes TOOL_START event, include MCP server info:
this.eventBus.publish(CHAT_MESSAGE_TYPES.TOOL_START, {
  tool: 'read_file',
  mcpServer: { id: 'filesystem-mcp', name: 'Filesystem MCP' }, // ADD
  // ...
});

// Frontend ToolTimelineComponent displays MCP server badge next to tool name
```

**Effort**: MEDIUM (2-3 hours)

- Extend ToolExecution interface: 30min
- Backend: Include MCP server in tool events: 1 hour
- Frontend: Display MCP server badge: 1 hour
- Test tool attribution: 30min

### Refactoring Effort

**Backend**: LARGE (12-15 hours) - New MCP integration library
**Frontend**: MEDIUM (3-4 hours) - New status UI components
**Integration**: MEDIUM (2-3 hours) - Wire message protocol
**Total**: **17-22 hours**

### Dependencies

**Must Complete Before**: None

**Blocks**: MCP tool usage analytics (need MCP server tracking first)

---

## Feature 4: Usage Analytics Dashboard

### Architecture Requirements

**Backend**:

- ✅ **READY**: AnalyticsOrchestrationService exists

  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts`
  - Has methods: trackEvent(), getData()

- ⚠️ **PARTIAL**: No persistent analytics storage (currently in-memory only)

**Frontend**:

- ✅ **READY**: AnalyticsComponent exists and renders ✅
- ❌ **DISPLAYS FAKE DATA**: getStatsData() returns hardcoded zeros
  - File: `D:/projects/ptah-extension/libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts`

**Message Protocol**:

- ✅ **READY**: ANALYTICS_MESSAGE_TYPES.GET_DATA exists

### Blockers

#### BLOCKER 4.1: Frontend Doesn't Fetch Real Analytics Data

**Current State**:

```typescript
// AnalyticsComponent.getStatsData() (analytics.component.ts):
getStatsData() {
  return {
    chatSessions: { value: 0, label: 'Chat Sessions', icon: MessageSquareIcon },
    messagesSent: { value: 0, label: 'Messages Sent', icon: SendIcon },
    tokensUsed: { value: 0, label: 'Tokens Used', icon: ZapIcon }
  };
  // HARDCODED ZEROS - NOT FETCHED FROM BACKEND
}
```

**Required Changes**:

```typescript
// In AnalyticsComponent:
export class AnalyticsComponent implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  readonly statsData = signal({
    chatSessions: { value: 0, label: 'Chat Sessions', icon: MessageSquareIcon },
    messagesSent: { value: 0, label: 'Messages Sent', icon: SendIcon },
    tokensUsed: { value: 0, label: 'Tokens Used', icon: ZapIcon }
  });

  async ngOnInit(): Promise<void> {
    const data = await this.analyticsService.fetchAnalyticsData();
    this.statsData.set({
      chatSessions: { value: data.totalSessions, label: 'Chat Sessions', icon: MessageSquareIcon },
      messagesSent: { value: data.totalMessages, label: 'Messages Sent', icon: SendIcon },
      tokensUsed: { value: data.totalTokens, label: 'Tokens Used', icon: ZapIcon }
    });
  }
}

// In AnalyticsService (frontend/core):
async fetchAnalyticsData(): Promise<{ totalSessions; totalMessages; totalTokens }> {
  const response = await this.vscode.postStrictMessage('analytics:getData', {});
  return response.data;
}
```

**Effort**: SMALL (1-2 hours)

- Add fetchAnalyticsData() to AnalyticsService: 30min
- Wire AnalyticsComponent.ngOnInit(): 30min
- Test data display: 30min

#### BLOCKER 4.2: Backend Analytics Storage is In-Memory Only

**Current State**:

- AnalyticsOrchestrationService tracks events in memory
- **Lost on extension reload** ❌
- No persistence to VS Code workspace state or file

**Required Changes**:

```typescript
// In AnalyticsOrchestrationService:
@injectable()
export class AnalyticsOrchestrationService {
  private analytics: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    events: AnalyticsEvent[];
  } = { totalSessions: 0, totalMessages: 0, totalTokens: 0, events: [] };

  constructor(
    @inject(TOKENS.STORAGE_SERVICE) private readonly storage: IStorageService // ADD
  ) {
    this.loadAnalytics(); // Load from storage on init
  }

  private async loadAnalytics(): Promise<void> {
    const saved = this.storage.get<typeof this.analytics>('ptah.analytics');
    if (saved) {
      this.analytics = saved;
    }
  }

  async trackEvent(event: AnalyticsEvent): Promise<void> {
    this.analytics.events.push(event);
    // Update counters
    if (event.type === 'session_created') this.analytics.totalSessions++;
    if (event.type === 'message_sent') this.analytics.totalMessages++;

    // Save to storage
    await this.storage.set('ptah.analytics', this.analytics);
  }
}
```

**Effort**: SMALL (1 hour)

- Add storage service injection: 15min
- Implement load/save methods: 30min
- Test persistence across reloads: 15min

### Refactoring Effort

**Backend**: SMALL (1 hour) - Add persistence
**Frontend**: SMALL (1-2 hours) - Wire to backend data
**Integration**: SMALL (0 hours) - Message protocol exists
**Total**: **2-3 hours**

### Dependencies

**Must Complete Before**: None - analytics standalone

**Enables**: Usage insights, cost tracking input data

---

## Feature 5: Cost Tracking & Token Budgets

### Architecture Requirements

**Backend**:

- ❌ **NOT IMPLEMENTED**: No cost calculation logic
- ⚠️ **PARTIAL**: SessionManager tracks token usage, but NOT cost
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Has: tokenUsage.input, tokenUsage.output ✅
  - **MISSING**: cost.input, cost.output

**Frontend**:

- ❌ **NOT IMPLEMENTED**: No cost display UI
- ⚠️ **CAN EXTEND**: ChatTokenUsageComponent could show cost alongside tokens

**Message Protocol**:

- ❌ **MISSING**: No cost data in SESSION_UPDATED or TOKEN_USAGE_UPDATED payloads

### Blockers

#### BLOCKER 5.1: No Cost Data in Message Protocol

**Current State**:

```typescript
// ChatTokenUsageUpdatedPayload (message.types.ts, line 142):
export interface ChatTokenUsageUpdatedPayload {
  readonly sessionId: SessionId;
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly percentage: number;
    readonly maxTokens: number;
  };
  // NO COST DATA
}
```

**Required Changes**:

```typescript
// Extend payload to include cost:
export interface ChatTokenUsageUpdatedPayload {
  readonly sessionId: SessionId;
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly percentage: number;
    readonly maxTokens: number;
    // ADD:
    readonly cost: {
      readonly input: number; // USD
      readonly output: number; // USD
      readonly total: number; // USD
    };
  };
}
```

**Effort**: SMALL (30min - 1 hour)

- Extend message payload: 15min
- Update all type references: 15min
- Test type safety: 30min

#### BLOCKER 5.2: Backend Doesn't Calculate Cost

**Current State**:

- SessionManager.addMessage() calculates tokens (line 424)
- **Doesn't calculate cost** ❌

**Required Changes**:

```typescript
// In SessionManager.addMessage():
async addMessage(options: AddMessageOptions): Promise<MessageId> {
  // ...existing token calculation

  // ADD: Calculate cost based on model pricing
  const modelPricing = this.getModelPricing(session.model || 'claude-3.5-sonnet');
  const cost = {
    input: (session.tokenUsage.input / 1000) * modelPricing.inputPer1k,
    output: (session.tokenUsage.output / 1000) * modelPricing.outputPer1k,
    total: 0
  };
  cost.total = cost.input + cost.output;

  // Publish cost alongside token usage
  this.eventBus.publish(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED, {
    sessionId: session.id,
    tokenUsage: {
      ...session.tokenUsage,
      cost // ADD
    }
  });
}

private getModelPricing(model: string): { inputPer1k: number; outputPer1k: number } {
  const pricing = {
    'claude-3.5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
    'claude-3-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 }
  };
  return pricing[model] || pricing['claude-3.5-sonnet'];
}
```

**Effort**: MEDIUM (2-3 hours)

- Add pricing database: 1 hour
- Implement cost calculation: 1 hour
- Test accuracy: 1 hour

#### BLOCKER 5.3: No Model ID Tracking

**Current State**:

- SessionManager doesn't store which Claude model is being used
- **Can't calculate accurate cost without model ID**

**Required Changes**:

```typescript
// Extend StrictChatSession (message.types.ts):
export interface StrictChatSession {
  readonly id: SessionId;
  readonly name: string;
  readonly messages: readonly StrictChatMessage[];
  // ADD:
  readonly model?: string; // 'claude-3.5-sonnet'
  // ...
}

// Update session when model is selected:
// SessionManager.setSessionModel():
async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  this.mutateSession(session, { model });
  await this.saveSessions();
}
```

**Effort**: MEDIUM (2-3 hours)

- Extend session type: 30min
- Add model tracking to SessionManager: 1 hour
- Wire model selection to session update: 1 hour
- Test model persistence: 30min

### Refactoring Effort

**Backend**: MEDIUM (4-6 hours) - Cost calculation + model tracking
**Frontend**: SMALL (1-2 hours) - Display cost in ChatTokenUsageComponent
**Integration**: SMALL (1 hour) - Extend message payload
**Total**: **6-9 hours**

### Dependencies

**Must Complete Before**: Feature 2 (Model Selection) - need model ID to calculate cost

**Blocks**: Budget alerts, cost reporting

---

## Feature 6: Advanced Session Management

### Architecture Requirements

**Backend**:

- ✅ **READY**: SessionManager has full CRUD operations ✅
  - create, switch, delete, rename, bulk delete all implemented

**Frontend**:

- ⚠️ **EXISTS BUT UNUSED**: SessionManagerComponent

  - File: `D:/projects/ptah-extension/libs/frontend/session/src/lib/containers/session-manager/session-manager.component.ts`
  - **BLOCKER**: NOT imported/rendered anywhere

- ✅ **PARTIAL**: SessionSelectorComponent provides basic session switching

### Blockers

#### BLOCKER 6.1: SessionManagerComponent Not Rendered

**Current State**:

- SessionManagerComponent exists with:
  - Bulk delete sessions
  - Search/filter sessions
  - Export sessions
- **BUT**: NOT imported in App component or ChatComponent
- **User can't access advanced session features**

**Required Changes**:

```typescript
// Option A: Add SessionManagerComponent as separate view in App
// In app.ts:
@switch (appState.currentView()) {
  @case ('chat') { <ptah-chat /> }
  @case ('analytics') { <ptah-analytics /> }
  @case ('settings') { <ptah-settings-view /> }
  @case ('sessions') { <ptah-session-manager /> } // ADD
}

// Option B: Show SessionManagerComponent as modal/drawer from SessionSelector
// In SessionSelectorComponent:
@if (showSessionManager()) {
  <ptah-session-manager
    [sessions]="sessions()"
    (close)="closeSessionManager()"
  />
}
```

**Effort**: SMALL (1-2 hours)

- Add navigation case to App (Option A): 30min
- OR add modal logic to SessionSelectorComponent (Option B): 1 hour
- Wire close/navigation: 30min

#### BLOCKER 6.2: No Session Export Backend

**Current State**:

- SessionManager has exportSession() method signature
- **NOT IMPLEMENTED** - throws NotImplementedError

**Required Changes**:

```typescript
// In SessionManager:
async exportSession(sessionId: SessionId, format: 'json' | 'markdown'): Promise<string> {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  if (format === 'json') {
    return JSON.stringify(session, null, 2);
  }

  // Markdown format:
  let markdown = `# ${session.name}\n\n`;
  markdown += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n`;

  for (const message of session.messages) {
    markdown += `## ${message.type === 'user' ? 'User' : 'Assistant'}\n\n`;
    markdown += `${message.content}\n\n`;
    markdown += `---\n\n`;
  }

  return markdown;
}
```

**Effort**: SMALL (1-2 hours)

- Implement JSON export: 30min
- Implement Markdown export: 1 hour
- Test exports: 30min

### Refactoring Effort

**Backend**: SMALL (1-2 hours) - Implement export
**Frontend**: SMALL (1-2 hours) - Wire SessionManagerComponent
**Integration**: SMALL (0 hours) - No new protocol needed
**Total**: **2-4 hours**

### Dependencies

**Must Complete Before**: None

**Enables**: Power user session management

---

## Summary: Feature Readiness & Effort

| Feature                      | Backend | Frontend | Protocol | Total Effort  | Blockers        | Priority |
| ---------------------------- | ------- | -------- | -------- | ------------- | --------------- | -------- |
| 1. @ Mention Autocomplete    | ✅      | ⚠️       | ✅       | 6-8 hours     | UI integration  | HIGH     |
| 2. Model Selection UI        | ⚠️      | ⚠️       | ❌       | 5-7 hours     | Backend API     | HIGH     |
| 3. MCP Server Status         | ❌      | ❌       | ❌       | 17-22 hours   | No MCP support  | MEDIUM   |
| 4. Usage Analytics Dashboard | ✅      | ❌       | ✅       | 2-3 hours     | Wire frontend   | MEDIUM   |
| 5. Cost Tracking             | ❌      | ❌       | ❌       | 6-9 hours     | Model tracking  | MEDIUM   |
| 6. Advanced Session Mgmt     | ✅      | ⚠️       | ✅       | 2-4 hours     | UI not rendered | LOW      |
| **TOTAL**                    |         |          |          | **38-53 hrs** | **18 blockers** |          |

---

## Critical Findings

### 1. **ONLY 2/6 FEATURES READY TO IMPLEMENT** (33%)

**Ready**:

- Analytics Dashboard (2-3 hours - just wire frontend)
- Session Management (2-4 hours - render existing component)

**Needs Work**:

- @ Mention Autocomplete (6-8 hours - UI integration)
- Model Selection (5-7 hours - backend API)
- MCP Server Status (17-22 hours - NO IMPLEMENTATION)
- Cost Tracking (6-9 hours - depends on model selection)

### 2. **MCP Server Support is MAJOR BLOCKER** (17-22 hours)

**Impact**: Phase 3 (MCP Server Status) requires:

- New backend library (mcp-integration)
- New message protocol category
- Frontend UI components
- MCP server discovery, connection, health monitoring

**Recommendation**: **DEPRIORITIZE** MCP Server Status to Phase 6 or later

### 3. **Cost Tracking DEPENDS on Model Selection** (dependency chain)

**Chain**:

1. Implement Model Selection UI (Feature 2) - 5-7 hours
2. Add model ID tracking to sessions - 2-3 hours
3. **THEN** implement cost tracking (Feature 5) - 6-9 hours

**Total Chain**: 13-19 hours

**Recommendation**: Complete Feature 2 BEFORE starting Feature 5

### 4. **Quick Wins Available** (4-7 hours total)

**Priority Order**:

1. **Analytics Dashboard** (2-3 hours) - HIGH user value, LOW effort
2. **Session Management UI** (2-4 hours) - Feature exists, just expose it

**Impact**: Show measurable progress quickly

---

## Recommended Implementation Order

### Phase 1 (Week 1): Quick Wins & Foundations

**Total**: 9-14 hours

1. **Analytics Dashboard** (2-3 hours)

   - Wire AnalyticsComponent to backend
   - Add persistence to AnalyticsOrchestrationService
   - **USER VALUE**: Real usage statistics visible

2. **Session Management UI** (2-4 hours)

   - Render SessionManagerComponent
   - Add navigation or modal trigger
   - **USER VALUE**: Bulk operations, export sessions

3. **@ Mention Autocomplete** (5-7 hours)
   - Integrate FileSuggestionsDropdownComponent
   - Wire file selection to backend
   - **USER VALUE**: Easy file attachment, better context

### Phase 2 (Week 2): Model Selection & Cost Prep

**Total**: 7-10 hours

4. **Model Selection UI** (5-7 hours)

   - Add backend selectModel() API
   - Persist model preference
   - Wire frontend dropdown to backend
   - **USER VALUE**: Choose preferred Claude model

5. **Model Tracking in Sessions** (2-3 hours)
   - Extend StrictChatSession with model ID
   - Track model per session
   - **ENABLES**: Cost tracking in Phase 3

### Phase 3 (Week 3): Cost Tracking

**Total**: 6-9 hours

6. **Cost Tracking** (6-9 hours)
   - Add cost calculation to SessionManager
   - Extend TOKEN_USAGE_UPDATED payload
   - Display cost in ChatTokenUsageComponent
   - **USER VALUE**: See API costs in real-time

### Phase 4+ (Future): MCP Server Support

**Total**: 17-22 hours

7. **MCP Server Status** (17-22 hours)
   - Create mcp-integration library
   - Implement server discovery, health monitoring
   - Build frontend status UI
   - **USER VALUE**: Monitor MCP server health

---

## Blockers Summary Table

| Blocker ID | Feature         | Description                                     | Effort | Priority |
| ---------- | --------------- | ----------------------------------------------- | ------ | -------- |
| 1.1        | @ Autocomplete  | FileSuggestionsDropdownComponent not integrated | 3-4h   | HIGH     |
| 1.2        | @ Autocomplete  | File context not sent to backend                | 1-2h   | HIGH     |
| 2.1        | Model Selection | No backend API for model selection              | 3-4h   | HIGH     |
| 2.2        | Model Selection | Model options hardcoded in frontend             | 2-3h   | MEDIUM   |
| 3.1        | MCP Status      | No MCP server backend integration               | 10-12h | LOW      |
| 3.2        | MCP Status      | No MCP tool execution tracking                  | 2-3h   | LOW      |
| 4.1        | Analytics       | Frontend doesn't fetch real data                | 1-2h   | HIGH     |
| 4.2        | Analytics       | Backend storage is in-memory only               | 1h     | MEDIUM   |
| 5.1        | Cost Tracking   | No cost data in message protocol                | 1h     | MEDIUM   |
| 5.2        | Cost Tracking   | Backend doesn't calculate cost                  | 2-3h   | MEDIUM   |
| 5.3        | Cost Tracking   | No model ID tracking                            | 2-3h   | HIGH     |
| 6.1        | Session Mgmt    | SessionManagerComponent not rendered            | 1-2h   | MEDIUM   |
| 6.2        | Session Mgmt    | No session export backend                       | 1-2h   | LOW      |

**Total Blockers**: 13 blockers across 6 features

---

**Conclusion**: Implementation plan is **PARTIALLY ACHIEVABLE** with current architecture. **2 out of 6 features** (Analytics, Session Mgmt) can be completed in 4-7 hours. **3 features** (@ Autocomplete, Model Selection, Cost Tracking) require 17-26 hours of refactoring. **1 feature** (MCP Server Status) requires 17-22 hours of NEW implementation and should be deprioritized. **Recommended approach**: Start with quick wins (Analytics + Session Mgmt), then tackle Model Selection + @ Autocomplete, defer MCP Server Status to later phase.
