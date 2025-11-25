import { Injectable, signal, computed, inject } from '@angular/core';
import {
  ExecutionChatMessage,
  ChatSessionSummary,
  ExecutionNode,
  JSONLMessage,
  createExecutionChatMessage,
  createExecutionNode,
} from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';

/**
 * ChatStore - Signal-based reactive store for chat state
 *
 * Responsibilities:
 * - Maintain chat sessions list
 * - Track current session
 * - Manage message list for current session
 * - Process JSONL chunks into ExecutionNode tree
 * - Handle streaming state
 *
 * Architecture:
 * - Core signals (_sessions, _currentSessionId, _messages, _isStreaming)
 * - Derived computed signals (currentSession, messageCount)
 * - Async actions (loadSessions, switchSession, sendMessage)
 * - JSONL processor (maps raw JSONL to ExecutionNode tree)
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly vscodeService = inject(VSCodeService);

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
   * Load all sessions from backend
   */
  async loadSessions(): Promise<void> {
    try {
      // TODO: Call RPC to get session list
      // For now, stub with empty array
      this._sessions.set([]);
    } catch (error) {
      console.error('[ChatStore] Failed to load sessions:', error);
    }
  }

  /**
   * Switch to a different session
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      this._currentSessionId.set(sessionId);

      // TODO: Load messages for this session via RPC
      this._messages.set([]);

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
   * Send a new message to Claude
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    try {
      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId: this._currentSessionId() ?? undefined,
      });

      this._messages.update((msgs) => [...msgs, userMessage]);

      // Start streaming
      this._isStreaming.set(true);

      // TODO: Call RPC to send message
      // Backend will stream JSONL chunks back via processJsonlChunk()
    } catch (error) {
      console.error('[ChatStore] Failed to send message:', error);
      this._isStreaming.set(false);
    }
  }

  /**
   * Abort current streaming message
   */
  async abortCurrentMessage(): Promise<void> {
    try {
      // TODO: Call RPC to abort
      this._isStreaming.set(false);
      this.finalizeCurrentMessage();
    } catch (error) {
      console.error('[ChatStore] Failed to abort message:', error);
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

    const tree = this._currentExecutionTree();
    if (!tree) return;

    // Handle thinking block
    if (chunk.thinking) {
      this.appendThinkingNode(tree, chunk.thinking);
    }

    // Handle text delta (streaming)
    if (chunk.delta) {
      this.appendTextDelta(tree, chunk.delta);
    }

    // Handle content blocks (tool_use, text)
    if (chunk.message?.content) {
      chunk.message.content.forEach((block) => {
        if (block.type === 'text' && block.text) {
          this.appendTextNode(tree, block.text);
        } else if (block.type === 'tool_use' && block.name) {
          this.appendToolUseNode(tree, block);
        }
      });
    }

    // Update tree signal
    this._currentExecutionTree.set({ ...tree });
  }

  private handleToolMessage(chunk: JSONLMessage): void {
    const tree = this._currentExecutionTree();
    if (!tree) return;

    const toolUseId = chunk.tool_use_id;
    const parentToolUseId = chunk.parent_tool_use_id;

    // Check if this is a Task tool (agent spawn)
    if (chunk.tool === 'Task' && toolUseId) {
      this.handleAgentSpawn(tree, chunk, toolUseId);
    }
    // Check if this is nested under an agent
    else if (parentToolUseId) {
      this.handleNestedTool(chunk, parentToolUseId);
    }
    // Regular tool execution
    else if (toolUseId) {
      this.handleToolExecution(chunk, toolUseId);
    }

    // Update tree signal
    this._currentExecutionTree.set({ ...tree });
  }

  private handleResultMessage(chunk: JSONLMessage): void {
    // Finalize current message
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

  private appendThinkingNode(tree: ExecutionNode, content: string): void {
    const thinkingNode = createExecutionNode({
      id: this.generateId(),
      type: 'thinking',
      status: 'complete',
      content,
      isCollapsed: true, // Collapsed by default
    });

    tree.children = [...tree.children, thinkingNode];
  }

  private appendTextNode(tree: ExecutionNode, content: string): void {
    const textNode = createExecutionNode({
      id: this.generateId(),
      type: 'text',
      status: 'complete',
      content,
    });

    tree.children = [...tree.children, textNode];
  }

  private appendTextDelta(tree: ExecutionNode, delta: string): void {
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

      tree.children = [...tree.children.slice(0, -1), updatedChild];
    } else {
      // Create new streaming text node
      const textNode = createExecutionNode({
        id: this.generateId(),
        type: 'text',
        status: 'streaming',
        content: delta,
      });

      tree.children = [...tree.children, textNode];
    }
  }

  private appendToolUseNode(tree: ExecutionNode, block: any): void {
    const toolNode = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'tool',
      status: 'pending',
      toolName: block.name,
      toolInput: block.input,
      toolCallId: block.id,
      isCollapsed: true, // Collapsed by default
    });

    tree.children = [...tree.children, toolNode];

    // Store in map for later result linking
    if (block.id) {
      this.toolNodeMap.set(block.id, toolNode);
    }
  }

  private handleAgentSpawn(
    tree: ExecutionNode,
    chunk: JSONLMessage,
    toolUseId: string
  ): void {
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

    tree.children = [...tree.children, agentNode];

    // Store in agent map for nested tool routing
    this.agentNodeMap.set(toolUseId, agentNode);
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

    parentAgent.children = [...parentAgent.children, toolNode];

    // Store for potential nested agents within this tool
    if (chunk.tool_use_id) {
      this.toolNodeMap.set(chunk.tool_use_id, toolNode);
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

    // Replace in parent's children array
    const tree = this._currentExecutionTree();
    if (tree) {
      this.replaceNodeInTree(tree, toolUseId, updatedNode);
    }
  }

  private replaceNodeInTree(
    tree: ExecutionNode,
    nodeId: string,
    updatedNode: ExecutionNode
  ): void {
    // Recursively search and replace
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

    tree.children = replaceInChildren(tree.children);
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
}
