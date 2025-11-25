import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import {
  ExecutionChatMessage,
  ChatSessionSummary,
  ExecutionNode,
  JSONLMessage,
  createExecutionChatMessage,
  createExecutionNode,
} from '@ptah-extension/shared';

// Type for VSCodeService to avoid static import
interface VSCodeServiceType {
  config(): { workspaceRoot: string };
  setChatStore(chatStore: any): void;
}

// Type for ClaudeRpcService to avoid circular dependency
interface ClaudeRpcServiceType {
  call<T>(
    method: string,
    params: unknown,
    options?: any
  ): Promise<{ success: boolean; data?: T; error?: string }>;
}

/**
 * ChatStore - Signal-based reactive store for chat state
 *
 * Responsibilities:
 * - Maintain chat sessions list
 * - Track current session
 * - Manage message list for current session
 * - Process JSONL chunks into ExecutionNode tree
 * - Handle streaming state
 * - Wire to RPC for backend communication
 *
 * Architecture:
 * - Core signals (_sessions, _currentSessionId, _messages, _isStreaming)
 * - Derived computed signals (currentSession, messageCount)
 * - Async actions (loadSessions, switchSession, sendMessage)
 * - JSONL processor (maps raw JSONL to ExecutionNode tree)
 * - RPC integration (calls backend via ClaudeRpcService)
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly injector = inject(Injector);

  // Service references (eagerly initialized in constructor)
  private _vscodeService: VSCodeServiceType | null = null;
  private _claudeRpcService: ClaudeRpcServiceType | null = null;

  // Signal to track service initialization state
  private readonly _servicesReady = signal(false);
  readonly servicesReady = this._servicesReady.asReadonly();

  constructor() {
    console.log('[ChatStore] Initializing...');
    // Eagerly initialize services to avoid race conditions
    this.initializeServices();
  }

  /**
   * Eagerly initialize services via dynamic import
   * This runs async but updates servicesReady signal when complete
   */
  private async initializeServices(): Promise<void> {
    try {
      // Import the core module (breaks circular dependency via dynamic import)
      const coreModule = await import('@ptah-extension/core');

      // Get service instances from injector
      this._vscodeService = this.injector.get(
        coreModule.VSCodeService
      ) as VSCodeServiceType;
      this._claudeRpcService = this.injector.get(
        coreModule.ClaudeRpcService
      ) as ClaudeRpcServiceType;

      // Register ChatStore with VSCodeService for message routing
      this._vscodeService?.setChatStore(this);

      // Mark services as ready
      this._servicesReady.set(true);
      console.log('[ChatStore] Services initialized and ready');
    } catch (error) {
      console.error('[ChatStore] Failed to initialize services:', error);
      // Services remain null, servicesReady stays false
    }
  }

  /**
   * Helper to get VSCodeService (with null check)
   */
  private get vscodeService(): VSCodeServiceType | null {
    return this._vscodeService;
  }

  /**
   * Helper to get ClaudeRpcService (with null check)
   */
  private get claudeRpcService(): ClaudeRpcServiceType | null {
    return this._claudeRpcService;
  }

  // ============================================================================
  // CORE SIGNALS
  // ============================================================================

  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);
  private readonly _currentSessionId = signal<string | null>(null);
  private readonly _messages = signal<readonly ExecutionChatMessage[]>([]);
  private readonly _isStreaming = signal(false);

  // Current execution tree being built (for streaming assistant messages)
  private readonly _currentExecutionTree = signal<ExecutionNode | null>(null);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();
  readonly currentSessionId = this._currentSessionId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();
  readonly currentExecutionTree = this._currentExecutionTree.asReadonly();

  // ============================================================================
  // DERIVED COMPUTED SIGNALS
  // ============================================================================

  readonly currentSession = computed(() => {
    const sessionId = this._currentSessionId();
    return this._sessions().find((s) => s.id === sessionId) ?? null;
  });

  readonly messageCount = computed(() => this._messages().length);

  // ============================================================================
  // STREAMING STATE TRACKING
  // ============================================================================

  // Track currently building message
  private currentMessageId: string | null = null;

  // Map tool_use_id → ExecutionNode for linking tool results
  private toolNodeMap = new Map<string, ExecutionNode>();

  // Map parent_tool_use_id → AgentNode for nested tool routing
  private agentNodeMap = new Map<string, ExecutionNode>();

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Load all sessions from backend via RPC
   */
  async loadSessions(): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] loadSessions: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      const result = await this.claudeRpcService.call<ChatSessionSummary[]>(
        'session:list',
        { workspacePath }
      );

      if (result.success && result.data) {
        this._sessions.set(result.data);
        console.log('[ChatStore] Loaded sessions:', result.data.length);
      } else {
        console.error('[ChatStore] Failed to load sessions:', result.error);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to load sessions:', error);
    }
  }

  /**
   * Switch to a different session and load its messages via RPC
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] switchSession: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      this._currentSessionId.set(sessionId);

      // Load messages for this session via RPC
      const result = await this.claudeRpcService.call<{
        sessionId: string;
        messages: JSONLMessage[];
      }>('session:load', { sessionId, workspacePath });

      if (result.success && result.data) {
        // Process all JSONL messages to rebuild chat history
        // For now, just clear messages (full replay implementation in Batch 7)
        this._messages.set([]);
        console.log(
          '[ChatStore] Loaded session messages:',
          result.data.messages.length
        );
      } else {
        console.error('[ChatStore] Failed to load session:', result.error);
        this._messages.set([]);
      }

      // Clear streaming state
      this._isStreaming.set(false);
      this._currentExecutionTree.set(null);
      this.currentMessageId = null;
      this.toolNodeMap.clear();
      this.agentNodeMap.clear();
    } catch (error) {
      console.error('[ChatStore] Failed to switch session:', error);
    }
  }

  /**
   * Send a new message to Claude via RPC (starts streaming)
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] sendMessage: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      // Generate or use existing session ID
      let sessionId = this._currentSessionId();
      if (!sessionId) {
        sessionId = this.generateId();
        this._currentSessionId.set(sessionId);
      }

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      this._messages.update((msgs) => [...msgs, userMessage]);

      // Start streaming
      this._isStreaming.set(true);

      // Call RPC to start chat (backend will stream JSONL chunks via chat:chunk messages)
      const result = await this.claudeRpcService.call<{ sessionId: string }>(
        'chat:start',
        {
          prompt: content,
          sessionId,
          workspacePath,
          options: files ? { files } : undefined,
        }
      );

      if (!result.success) {
        console.error('[ChatStore] Failed to start chat:', result.error);
        this._isStreaming.set(false);
      } else {
        console.log('[ChatStore] Chat started:', result.data);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to send message:', error);
      this._isStreaming.set(false);
    }
  }

  /**
   * Abort current streaming message via RPC
   */
  async abortCurrentMessage(): Promise<void> {
    try {
      if (!this.claudeRpcService) {
        console.warn('[ChatStore] RPC service not initialized');
        return;
      }

      const sessionId = this._currentSessionId();
      if (!sessionId) {
        console.warn('[ChatStore] No active session to abort');
        return;
      }

      // Call RPC to abort
      const result = await this.claudeRpcService.call<void>('chat:abort', {
        sessionId,
      });

      if (result.success) {
        console.log('[ChatStore] Chat aborted successfully');
      } else {
        console.error('[ChatStore] Failed to abort chat:', result.error);
      }

      // Finalize current message regardless of RPC result
      this._isStreaming.set(false);
      this.finalizeCurrentMessage();
    } catch (error) {
      console.error('[ChatStore] Failed to abort message:', error);
      this._isStreaming.set(false);
    }
  }

  // ============================================================================
  // JSONL PROCESSING (Core Innovation)
  // ============================================================================

  /**
   * Process a JSONL chunk from Claude CLI
   *
   * Maps raw JSONL message types to ExecutionNode tree structure:
   * - system → Initialize new assistant message
   * - assistant → Add text/thinking/tool_use content
   * - tool → Add tool execution (nested if parent_tool_use_id present)
   * - result → Finalize message
   */
  processJsonlChunk(chunk: JSONLMessage): void {
    try {
      switch (chunk.type) {
        case 'system':
          this.handleSystemMessage(chunk);
          break;

        case 'assistant':
          this.handleAssistantMessage(chunk);
          break;

        case 'tool':
          this.handleToolMessage(chunk);
          break;

        case 'result':
          this.handleResultMessage(chunk);
          break;

        default:
          console.warn('[ChatStore] Unknown JSONL type:', chunk.type);
      }
    } catch (error) {
      console.error('[ChatStore] Error processing JSONL chunk:', error, chunk);
    }
  }

  // ============================================================================
  // JSONL HANDLERS
  // ============================================================================

  private handleSystemMessage(chunk: JSONLMessage): void {
    if (chunk.subtype === 'init') {
      // Initialize new assistant message
      this.startNewAssistantMessage();
    }
  }

  private handleAssistantMessage(chunk: JSONLMessage): void {
    // Ensure we have a message tree
    if (!this._currentExecutionTree()) {
      this.startNewAssistantMessage();
    }

    let tree = this._currentExecutionTree();
    if (!tree) return;

    // Handle thinking block
    if (chunk.thinking) {
      tree = this.appendThinkingNode(tree, chunk.thinking);
    }

    // Handle text delta (streaming)
    if (chunk.delta) {
      tree = this.appendTextDelta(tree, chunk.delta);
    }

    // Handle content blocks (tool_use, text)
    if (chunk.message?.content) {
      for (const block of chunk.message.content) {
        if (block.type === 'text' && block.text) {
          tree = this.appendTextNode(tree, block.text);
        } else if (block.type === 'tool_use' && block.name) {
          tree = this.appendToolUseNode(tree, block);
        }
      }
    }

    // Update tree signal with new immutable tree
    this._currentExecutionTree.set(tree);
  }

  private handleToolMessage(chunk: JSONLMessage): void {
    let tree = this._currentExecutionTree();
    if (!tree) return;

    const toolUseId = chunk.tool_use_id;
    const parentToolUseId = chunk.parent_tool_use_id;

    // Check if this is a Task tool (agent spawn)
    if (chunk.tool === 'Task' && toolUseId) {
      tree = this.handleAgentSpawn(tree, chunk, toolUseId);
      this._currentExecutionTree.set(tree);
    }
    // Check if this is nested under an agent
    else if (parentToolUseId) {
      // handleNestedTool updates the tree signal internally
      this.handleNestedTool(chunk, parentToolUseId);
    }
    // Regular tool execution
    else if (toolUseId) {
      // handleToolExecution updates the tree signal internally
      this.handleToolExecution(chunk, toolUseId);
    }
  }

  private handleResultMessage(_chunk: JSONLMessage): void {
    // Finalize current message (chunk contains final metrics, stored in message if needed)
    this.finalizeCurrentMessage();
  }

  // ============================================================================
  // TREE BUILDING HELPERS
  // ============================================================================

  private startNewAssistantMessage(): void {
    const messageId = this.generateId();
    this.currentMessageId = messageId;

    // Create root message node
    const rootNode = createExecutionNode({
      id: messageId,
      type: 'message',
      status: 'streaming',
    });

    this._currentExecutionTree.set(rootNode);
    this.toolNodeMap.clear();
    this.agentNodeMap.clear();
  }

  private appendThinkingNode(
    tree: ExecutionNode,
    content: string
  ): ExecutionNode {
    const thinkingNode = createExecutionNode({
      id: this.generateId(),
      type: 'thinking',
      status: 'complete',
      content,
      isCollapsed: true, // Collapsed by default
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, thinkingNode],
    };
  }

  private appendTextNode(tree: ExecutionNode, content: string): ExecutionNode {
    const textNode = createExecutionNode({
      id: this.generateId(),
      type: 'text',
      status: 'complete',
      content,
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, textNode],
    };
  }

  private appendTextDelta(tree: ExecutionNode, delta: string): ExecutionNode {
    // Find or create streaming text node
    const lastChild = tree.children[tree.children.length - 1];

    if (
      lastChild &&
      lastChild.type === 'text' &&
      lastChild.status === 'streaming'
    ) {
      // Append to existing streaming text node
      const updatedChild: ExecutionNode = {
        ...lastChild,
        content: (lastChild.content ?? '') + delta,
      };

      // Return new tree with updated last child (immutable)
      return {
        ...tree,
        children: [...tree.children.slice(0, -1), updatedChild],
      };
    } else {
      // Create new streaming text node
      const textNode = createExecutionNode({
        id: this.generateId(),
        type: 'text',
        status: 'streaming',
        content: delta,
      });

      // Return new tree with appended child (immutable)
      return {
        ...tree,
        children: [...tree.children, textNode],
      };
    }
  }

  private appendToolUseNode(tree: ExecutionNode, block: any): ExecutionNode {
    const toolNode = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'tool',
      status: 'pending',
      toolName: block.name,
      toolInput: block.input,
      toolCallId: block.id,
      isCollapsed: true, // Collapsed by default
    });

    // Store in map for later result linking
    if (block.id) {
      this.toolNodeMap.set(block.id, toolNode);
    }

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, toolNode],
    };
  }

  private handleAgentSpawn(
    tree: ExecutionNode,
    chunk: JSONLMessage,
    toolUseId: string
  ): ExecutionNode {
    const agentNode = createExecutionNode({
      id: toolUseId,
      type: 'agent',
      status: chunk.subtype === 'start' ? 'streaming' : 'complete',
      agentType: chunk.args?.['subagent_type'] as string,
      agentModel: chunk.args?.['model'] as string,
      agentDescription: chunk.args?.['description'] as string,
      agentPrompt: chunk.args?.['prompt'] as string,
      toolCallId: toolUseId,
      startTime: Date.now(),
      isCollapsed: false, // Expanded by default (show nested execution)
    });

    // Store in agent map for nested tool routing
    this.agentNodeMap.set(toolUseId, agentNode);

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, agentNode],
    };
  }

  private handleNestedTool(chunk: JSONLMessage, parentToolUseId: string): void {
    const parentAgent = this.agentNodeMap.get(parentToolUseId);
    if (!parentAgent) {
      console.warn(
        '[ChatStore] Parent agent not found for nested tool:',
        parentToolUseId
      );
      return;
    }

    const toolNode = createExecutionNode({
      id: chunk.tool_use_id || this.generateId(),
      type: 'tool',
      status: chunk.subtype === 'start' ? 'streaming' : 'complete',
      toolName: chunk.tool,
      toolInput: chunk.args,
      toolOutput: chunk.output,
      toolCallId: chunk.tool_use_id,
      error: chunk.error,
      isCollapsed: true,
    });

    // Create updated agent with new child (immutable)
    const updatedAgent: ExecutionNode = {
      ...parentAgent,
      children: [...parentAgent.children, toolNode],
    };

    // Update the agent map with the new reference
    this.agentNodeMap.set(parentToolUseId, updatedAgent);

    // Store for potential nested agents within this tool
    if (chunk.tool_use_id) {
      this.toolNodeMap.set(chunk.tool_use_id, toolNode);
    }

    // Update the execution tree with the updated agent
    const tree = this._currentExecutionTree();
    if (tree) {
      const updatedTree = this.replaceNodeInTree(
        tree,
        parentToolUseId,
        updatedAgent
      );
      this._currentExecutionTree.set(updatedTree);
    }
  }

  private handleToolExecution(chunk: JSONLMessage, toolUseId: string): void {
    const toolNode = this.toolNodeMap.get(toolUseId);
    if (!toolNode) {
      console.warn('[ChatStore] Tool node not found:', toolUseId);
      return;
    }

    // Update tool node with result
    const updatedNode: ExecutionNode = {
      ...toolNode,
      status: chunk.error ? 'error' : 'complete',
      toolOutput: chunk.output,
      error: chunk.error,
      endTime: Date.now(),
      duration: toolNode.startTime
        ? Date.now() - toolNode.startTime
        : undefined,
    };

    // Replace in parent's children array (immutable update)
    const tree = this._currentExecutionTree();
    if (tree) {
      const updatedTree = this.replaceNodeInTree(tree, toolUseId, updatedNode);
      this._currentExecutionTree.set(updatedTree);
    }
  }

  private replaceNodeInTree(
    tree: ExecutionNode,
    nodeId: string,
    updatedNode: ExecutionNode
  ): ExecutionNode {
    // Recursively search and replace, returning a new tree
    const replaceInChildren = (
      children: readonly ExecutionNode[]
    ): readonly ExecutionNode[] => {
      return children.map((child) => {
        if (child.id === nodeId) {
          return updatedNode;
        }
        if (child.children.length > 0) {
          return {
            ...child,
            children: replaceInChildren(child.children),
          };
        }
        return child;
      });
    };

    // Return a new tree with updated children (immutable)
    return {
      ...tree,
      children: replaceInChildren(tree.children),
    };
  }

  private finalizeCurrentMessage(): void {
    const tree = this._currentExecutionTree();
    if (!tree || !this.currentMessageId) return;

    // Mark all streaming nodes as complete
    const finalizeNode = (node: ExecutionNode): ExecutionNode => ({
      ...node,
      status: node.status === 'streaming' ? 'complete' : node.status,
      children: node.children.map(finalizeNode),
    });

    const finalTree = finalizeNode(tree);

    // Create chat message with execution tree
    const assistantMessage = createExecutionChatMessage({
      id: this.currentMessageId,
      role: 'assistant',
      executionTree: finalTree,
      sessionId: this._currentSessionId() ?? undefined,
    });

    // Add to messages list
    this._messages.update((msgs) => [...msgs, assistantMessage]);

    // Clear streaming state
    this._isStreaming.set(false);
    this._currentExecutionTree.set(null);
    this.currentMessageId = null;
    this.toolNodeMap.clear();
    this.agentNodeMap.clear();
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wait for services to be ready with timeout
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise resolving to true if ready, false if timeout
   */
  private async waitForServices(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();

    // Poll servicesReady signal with short intervals
    while (!this._servicesReady()) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }

      // Wait 50ms before next check
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return true;
  }
}
