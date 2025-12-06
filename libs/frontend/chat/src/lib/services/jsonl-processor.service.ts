import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  JSONLMessage,
  createExecutionNode,
} from '@ptah-extension/shared';
import { ExecutionTreeBuilder, AgentSpawnInfo } from './tree-builder.service';
import { SessionManager } from './session-manager.service';

/**
 * Result from processing a JSONL chunk
 */
export interface ProcessingResult {
  /** Updated execution tree (if changed) */
  tree: ExecutionNode | null;
  /** Whether streaming should be marked as complete */
  streamComplete: boolean;
  /** Whether a new message tree was started */
  newMessageStarted: boolean;
  /** ID of the new message (if newMessageStarted is true) */
  messageId?: string;
  /** Model ID from the init message (e.g., 'claude-opus-4-5-20251101') */
  model?: string;
}

/**
 * JsonlMessageProcessor - Processes JSONL chunks from Claude CLI
 *
 * Single Responsibility: Parse and route JSONL messages
 *
 * This service processes incoming JSONL chunks and delegates to appropriate handlers.
 * It routes messages by type (system, assistant, tool, result, user) and by context
 * (main thread vs agent - using parent_tool_use_id).
 *
 * Coordinates with:
 * - SessionManager for node lookups (agents, tools)
 * - ExecutionTreeBuilder for tree operations
 *
 * Does NOT own:
 * - State signals (that's ChatStore)
 * - Node maps (that's SessionManager)
 * - Tree storage (that's ChatStore's _currentExecutionTree)
 *
 * Architecture Pattern: Stateless Service (pure functions)
 * Complexity Level: 2 (Medium - coordination between services, message routing)
 *
 * Key Design Decision:
 * The processor does NOT directly modify signals. Instead, it:
 * 1. Takes the current tree as input
 * 2. Returns a ProcessingResult with the updated tree
 * 3. Lets ChatStore handle setting signals based on the result
 *
 * This keeps the processor pure and testable.
 *
 * @example
 * ```typescript
 * // Process a chunk and get the result
 * const result = processor.processChunk(jsonlChunk, currentTree);
 *
 * // Update state based on result
 * if (result.newMessageStarted) {
 *   this._isStreaming.set(true);
 *   this._currentMessageId = result.messageId;
 * }
 * if (result.tree !== currentTree) {
 *   this._currentExecutionTree.set(result.tree);
 * }
 * if (result.streamComplete) {
 *   this.finalizeCurrentMessage();
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class JsonlMessageProcessor {
  private readonly treeBuilder = inject(ExecutionTreeBuilder);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Track the current model for the active session.
   * Set from init messages and used when creating trees without init.
   */
  private currentModel?: string;

  /**
   * Process a JSONL chunk and return tree updates
   *
   * Maps raw JSONL message types to ExecutionNode tree structure:
   * - system → Initialize new assistant message
   * - assistant → Add text/thinking/tool_use content
   * - tool → Add tool execution (nested if parent_tool_use_id present)
   * - result → Finalize message
   * - user → Ignored during streaming (echoed by CLI for logging)
   *
   * @param chunk - Raw JSONL message from Claude CLI
   * @param currentTree - Current execution tree (or null)
   * @returns Object with updated tree and any actions to take
   *
   * @example
   * ```typescript
   * const result = processor.processChunk(chunk, currentTree);
   * if (result.tree !== currentTree) {
   *   this._currentExecutionTree.set(result.tree);
   * }
   * ```
   */
  processChunk(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // Log all incoming JSONL chunks for debugging agent behavior
    this.logChunk(chunk);

    try {
      switch (chunk.type) {
        case 'system':
          return this.handleSystemMessage(chunk, currentTree);

        case 'assistant':
          return this.handleAssistantMessage(chunk, currentTree);

        case 'user':
          // User messages may contain tool_result blocks that we need to process.
          // During streaming, the CLI sends tool results as user messages with
          // content[].type === 'tool_result'. These contain the output from tools
          // like Read, Bash, Glob, etc. We need to extract these and update
          // the corresponding tool nodes.
          return this.handleUserMessage(chunk, currentTree);

        case 'tool':
          return this.handleToolMessage(chunk, currentTree);

        case 'result':
          return this.handleResultMessage(chunk, currentTree);

        default:
          console.warn(
            '[JsonlMessageProcessor] Unknown JSONL type:',
            chunk.type
          );
          return {
            tree: currentTree,
            streamComplete: false,
            newMessageStarted: false,
          };
      }
    } catch (error) {
      console.error(
        '[JsonlMessageProcessor] Error processing JSONL chunk:',
        error,
        chunk
      );
      return {
        tree: currentTree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }
  }

  // ============================================================================
  // JSONL HANDLERS
  // ============================================================================

  private handleSystemMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    if (chunk.subtype === 'init') {
      // Initialize new assistant message with model from init chunk
      const messageId = this.treeBuilder.generateId();
      const model = chunk.model; // Extract model from init message

      // Store current model for use in subsequent messages
      this.currentModel = model;

      const tree = this.treeBuilder.createMessageTree(messageId, model);

      return {
        tree,
        streamComplete: false,
        newMessageStarted: true,
        messageId,
        model, // Pass model to caller for cost calculation
      };
    }

    return {
      tree: currentTree,
      streamComplete: false,
      newMessageStarted: false,
    };
  }

  private handleAssistantMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // Check if this is a nested message from an agent (has parent_tool_use_id)
    const parentToolUseId = (chunk as any).parent_tool_use_id;
    if (parentToolUseId) {
      // Route to agent's context
      return this.handleNestedAssistantMessage(
        chunk,
        currentTree,
        parentToolUseId
      );
    }

    // Ensure we have a message tree
    let tree = currentTree;
    let newMessageStarted = false;
    let messageId: string | undefined;

    if (!tree) {
      messageId = this.treeBuilder.generateId();
      // Use stored model from most recent init message
      tree = this.treeBuilder.createMessageTree(messageId, this.currentModel);
      newMessageStarted = true;
    }

    // Handle thinking block
    if (chunk.thinking) {
      tree = this.treeBuilder.appendThinking(tree, chunk.thinking);
    }

    // Handle text delta (streaming)
    if (chunk.delta) {
      tree = this.treeBuilder.appendTextDelta(tree, chunk.delta);
    }

    // Handle content blocks (tool_use, text)
    if (chunk.message?.content) {
      for (const block of chunk.message.content) {
        if (block.type === 'text' && block.text) {
          tree = this.treeBuilder.appendText(tree, block.text);
        } else if (block.type === 'tool_use' && block.name) {
          // Check if this is a Task tool (agent spawn)
          // Task tools have input.subagent_type which identifies the agent type
          const inputObj = block.input as Record<string, unknown> | undefined;
          if (
            block.name === 'Task' &&
            inputObj?.['subagent_type'] &&
            block.id
          ) {
            // Create agent node and add to tree (nested inside main response)
            const agentNode = createExecutionNode({
              id: block.id,
              type: 'agent',
              status: 'streaming',
              agentType: inputObj['subagent_type'] as string,
              agentDescription: inputObj['description'] as string,
              agentModel: inputObj['model'] as string,
              toolCallId: block.id,
            });

            // Add agent node to tree
            tree = {
              ...tree,
              children: [...tree.children, agentNode],
            };

            // Register agent in SessionManager for nested message routing
            this.sessionManager.registerAgent(block.id, agentNode);

            console.log(
              '[JsonlMessageProcessor] Agent spawn detected, added to tree:',
              block.id,
              inputObj['subagent_type']
            );
          } else {
            // Regular tool use
            tree = this.treeBuilder.appendToolUse(tree, block);

            // Register tool in SessionManager for later result linking
            if (block.id) {
              const toolNode = this.findToolNodeInTree(tree, block.id);
              if (toolNode) {
                this.sessionManager.registerTool(block.id, toolNode);
              }
            }
          }
        }
      }
    }

    return {
      tree,
      streamComplete: false,
      newMessageStarted,
      messageId,
      model: newMessageStarted ? this.currentModel : undefined,
    };
  }

  /**
   * Handle assistant messages that are nested inside an agent's execution context.
   * These come with parent_tool_use_id pointing to the Task tool that spawned the agent.
   *
   * BEHAVIOR: Updates the agent node within the main tree.
   * The agent is displayed inline (nested) in the main response using InlineAgentBubbleComponent.
   */
  private handleNestedAssistantMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null,
    parentToolUseId: string
  ): ProcessingResult {
    if (!currentTree) {
      console.warn(
        '[JsonlMessageProcessor] No current tree for nested assistant message'
      );
      return {
        tree: currentTree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }

    let parentAgent = this.sessionManager.getAgent(parentToolUseId);

    // Parent agent should exist from either:
    // 1. handleAgentSpawn during current streaming session
    // 2. SessionManager.setNodeMaps when loading a session
    if (!parentAgent) {
      console.warn(
        '[JsonlMessageProcessor] Parent agent not found for nested assistant message:',
        parentToolUseId,
        '- Message may be dropped. This can happen if resuming a session that was interrupted mid-agent.'
      );
      return {
        tree: currentTree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }

    // Add text content to the agent's children (this becomes the summary)
    if (chunk.message?.content) {
      for (const block of chunk.message.content) {
        if (block.type === 'text' && block.text) {
          const textNode = createExecutionNode({
            id: this.treeBuilder.generateId(),
            type: 'text',
            status: 'complete',
            content: block.text,
          });

          parentAgent = {
            ...parentAgent,
            children: [...parentAgent.children, textNode],
          };
        } else if (block.type === 'tool_use' && block.name) {
          const toolNode = createExecutionNode({
            id: block.id || this.treeBuilder.generateId(),
            type: 'tool',
            status: 'pending',
            toolName: block.name,
            toolInput: block.input,
            toolCallId: block.id,
            isCollapsed: true,
          });

          if (block.id) {
            this.sessionManager.registerTool(block.id, toolNode);
          }

          parentAgent = {
            ...parentAgent,
            children: [...parentAgent.children, toolNode],
          };
        }
      }
    }

    // Handle text delta for streaming
    if (chunk.delta) {
      const lastChild = parentAgent.children[parentAgent.children.length - 1];

      if (
        lastChild &&
        lastChild.type === 'text' &&
        lastChild.status === 'streaming'
      ) {
        const updatedChild: ExecutionNode = {
          ...lastChild,
          content: (lastChild.content ?? '') + chunk.delta,
        };

        parentAgent = {
          ...parentAgent,
          children: [...parentAgent.children.slice(0, -1), updatedChild],
        };
      } else {
        // Create new streaming text node
        const textNode = createExecutionNode({
          id: this.treeBuilder.generateId(),
          type: 'text',
          status: 'streaming',
          content: chunk.delta,
        });

        parentAgent = {
          ...parentAgent,
          children: [...parentAgent.children, textNode],
        };
      }
    }

    // Update the agent in SessionManager
    this.sessionManager.registerAgent(parentToolUseId, parentAgent);

    // Update the agent node in the main tree
    const updatedTree = this.replaceNodeInTree(
      currentTree,
      parentToolUseId,
      parentAgent
    );

    return {
      tree: updatedTree,
      streamComplete: false,
      newMessageStarted: false,
    };
  }

  /**
   * Recursively replace a node in the tree by ID
   */
  private replaceNodeInTree(
    tree: ExecutionNode,
    nodeId: string,
    replacement: ExecutionNode
  ): ExecutionNode {
    if (tree.id === nodeId) {
      return replacement;
    }

    if (tree.children.length === 0) {
      return tree;
    }

    const updatedChildren = tree.children.map((child) =>
      this.replaceNodeInTree(child, nodeId, replacement)
    );

    // Only create new object if children actually changed
    const hasChanges = updatedChildren.some(
      (child, i) => child !== tree.children[i]
    );

    return hasChanges ? { ...tree, children: updatedChildren } : tree;
  }

  private handleToolMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    let tree = currentTree;
    const newMessageStarted = false;
    const messageId: string | undefined = undefined;

    const toolUseId = chunk.tool_use_id;
    const parentToolUseId = chunk.parent_tool_use_id;

    // Check if this is a Task tool (agent spawn) from tool type message
    if (chunk.tool === 'Task' && toolUseId && tree) {
      // Create agent node and add to tree (nested inside main response)
      const agentNode = createExecutionNode({
        id: toolUseId,
        type: 'agent',
        status: 'streaming',
        agentType: chunk.args?.['subagent_type'] as string,
        agentDescription: chunk.args?.['description'] as string,
        agentModel: chunk.args?.['model'] as string,
        toolCallId: toolUseId,
      });

      // Add agent node to tree
      tree = {
        ...tree,
        children: [...tree.children, agentNode],
      };

      // Register agent in SessionManager for nested message routing
      this.sessionManager.registerAgent(toolUseId, agentNode);

      console.log(
        '[JsonlMessageProcessor] Agent spawn from tool message, added to tree:',
        toolUseId,
        chunk.args?.['subagent_type']
      );

      return {
        tree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }

    // Check if this is nested under an agent
    if (parentToolUseId && tree) {
      // Handle nested tool - update agent in tree
      tree = this.handleNestedToolInTree(chunk, tree, parentToolUseId);
      return {
        tree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }

    // Regular tool execution (not nested under agent)
    if (!tree) {
      return { tree, streamComplete: false, newMessageStarted: false };
    }

    if (toolUseId) {
      tree = this.handleToolExecution(tree, chunk, toolUseId);
      return { tree, streamComplete: false, newMessageStarted, messageId };
    }

    return { tree, streamComplete: false, newMessageStarted, messageId };
  }

  /**
   * Handle tool execution that is nested inside an agent.
   * Updates the agent's children and replaces the agent node in the main tree.
   */
  private handleNestedToolInTree(
    chunk: JSONLMessage,
    currentTree: ExecutionNode,
    parentToolUseId: string
  ): ExecutionNode {
    const parentAgent = this.sessionManager.getAgent(parentToolUseId);
    if (!parentAgent) {
      console.warn(
        '[JsonlMessageProcessor] Parent agent not found for nested tool:',
        parentToolUseId
      );
      return currentTree;
    }

    const toolUseId = chunk.tool_use_id;
    if (!toolUseId) {
      return currentTree;
    }

    // Find or create the tool node in the agent's children
    let toolNode = parentAgent.children.find(
      (c) => c.toolCallId === toolUseId || c.id === toolUseId
    );

    if (toolNode) {
      // Update existing tool node
      toolNode = this.updateToolNode(toolNode, chunk);
    } else {
      // Create new tool node
      toolNode = createExecutionNode({
        id: toolUseId,
        type: 'tool',
        status: 'streaming',
        toolName: chunk.tool,
        toolInput: chunk.args,
        toolCallId: toolUseId,
        isCollapsed: true,
      });
      this.sessionManager.registerTool(toolUseId, toolNode);
    }

    // Update agent with new/updated tool node
    const updatedChildren = toolNode
      ? parentAgent.children.some(
          (c) => c.toolCallId === toolUseId || c.id === toolUseId
        )
        ? parentAgent.children.map((c) =>
            c.toolCallId === toolUseId || c.id === toolUseId ? toolNode! : c
          )
        : [...parentAgent.children, toolNode]
      : parentAgent.children;

    const updatedAgent: ExecutionNode = {
      ...parentAgent,
      children: updatedChildren,
    };

    this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

    // Replace agent in tree
    return this.replaceNodeInTree(currentTree, parentToolUseId, updatedAgent);
  }

  /**
   * Update an existing tool node with chunk data
   */
  private updateToolNode(
    toolNode: ExecutionNode,
    chunk: JSONLMessage
  ): ExecutionNode {
    return {
      ...toolNode,
      status: chunk.error ? 'error' : 'streaming',
      toolOutput: chunk.output ?? toolNode.toolOutput,
      error: chunk.error ?? toolNode.error,
    };
  }

  /**
   * Strip system-reminder tags from content.
   * Claude CLI adds these tags to tool results but they should not be displayed.
   */
  private stripSystemReminders(content: string): string {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  }

  /**
   * Strip Claude CLI line number prefixes from Read tool output.
   * Claude CLI formats Read output as "     N→content" where N is the line number.
   * We strip these for cleaner display in the UI.
   */
  private stripLineNumbers(content: string): string {
    return content
      .split('\n')
      .map((line) => {
        // Pattern: optional whitespace, one or more digits, arrow character (→)
        const match = line.match(/^\s*\d+→(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');
  }

  /**
   * Clean tool output by removing CLI-specific formatting.
   */
  private cleanToolOutput(output: unknown): unknown {
    if (typeof output !== 'string') return output;
    let cleaned = this.stripSystemReminders(output);
    cleaned = this.stripLineNumbers(cleaned);
    return cleaned;
  }

  /**
   * Handle user messages which may contain tool_result blocks.
   *
   * During streaming, tool results come as user messages with:
   * - type: 'user'
   * - message.content[].type === 'tool_result'
   * - message.content[].tool_use_id linking to the original tool call
   * - message.content[].content containing the tool output
   *
   * These need to be extracted and used to update the corresponding tool nodes.
   *
   * BEHAVIOR: Updates agent and tool nodes within the main tree.
   * Agent completion marks the agent node as complete and updates it in the tree.
   * Tool results for nested tools update the agent's children and replace in tree.
   */
  private handleUserMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // If no content, nothing to process
    if (!chunk.message?.content) {
      return {
        tree: currentTree,
        streamComplete: false,
        newMessageStarted: false,
      };
    }

    const parentToolUseId = (chunk as any).parent_tool_use_id;
    let tree = currentTree;

    for (const block of chunk.message.content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        // Extract tool output from the tool_result block
        // Clean CLI-specific formatting (system-reminder tags, line numbers)
        const toolOutput = this.cleanToolOutput(block.content);
        const isError = block.is_error === true;

        // Detect permission requests (error message contains "permission")
        const outputStr = typeof toolOutput === 'string' ? toolOutput : '';
        const isPermissionRequest =
          isError && outputStr.toLowerCase().includes('permission');

        // Check if this is a result for a Task (agent) tool
        const agentNode = this.sessionManager.getAgent(block.tool_use_id);
        if (agentNode) {
          // This is the result for a Task (agent) tool - agent has completed
          // Update agent status to complete
          const completedAgent: ExecutionNode = {
            ...agentNode,
            status: 'complete',
          };
          this.sessionManager.registerAgent(block.tool_use_id, completedAgent);

          // Update agent in the main tree
          if (tree) {
            tree = this.replaceNodeInTree(
              tree,
              block.tool_use_id,
              completedAgent
            );
          }

          console.log(
            '[JsonlMessageProcessor] Agent completed:',
            block.tool_use_id
          );
          continue; // Skip normal tool processing
        }

        // Find and update the tool node
        const toolNode = this.sessionManager.getTool(block.tool_use_id);

        if (toolNode) {
          const updatedTool: ExecutionNode = {
            ...toolNode,
            status: isError ? 'error' : 'complete',
            toolOutput: toolOutput,
            error: isError ? String(toolOutput) : undefined,
            isPermissionRequest,
            endTime: Date.now(),
            duration: toolNode.startTime
              ? Date.now() - toolNode.startTime
              : undefined,
          };

          // Update in session manager
          this.sessionManager.registerTool(block.tool_use_id, updatedTool);

          // If this is nested under an agent, update agent's children and replace in tree
          if (parentToolUseId) {
            const parentAgent = this.sessionManager.getAgent(parentToolUseId);
            if (parentAgent && tree) {
              // Find and update the tool in the agent's children
              const updatedChildren = parentAgent.children.map((child) =>
                child.id === block.tool_use_id ||
                child.toolCallId === block.tool_use_id
                  ? updatedTool
                  : child
              );

              const updatedAgent: ExecutionNode = {
                ...parentAgent,
                children: updatedChildren,
              };

              this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

              // Replace agent in main tree
              tree = this.replaceNodeInTree(
                tree,
                parentToolUseId,
                updatedAgent
              );
            }
          } else if (tree) {
            // Update tree for non-nested tools
            tree = this.treeBuilder.replaceNode(
              tree,
              block.tool_use_id,
              updatedTool
            );
          }
        } else {
          // Tool not found - this can happen for nested tools that weren't registered yet
          console.warn(
            '[JsonlMessageProcessor] Tool not found for result:',
            block.tool_use_id
          );
        }
      }
    }

    return {
      tree,
      streamComplete: false,
      newMessageStarted: false,
    };
  }

  private handleResultMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // Finalize current message and extract token usage/duration
    let updatedTree = currentTree;

    if (currentTree && chunk.usage) {
      // Extract token usage from result message
      const tokenUsage = {
        input: chunk.usage.input_tokens ?? 0,
        output: chunk.usage.output_tokens ?? 0,
      };

      // Create updated tree with token usage and duration (immutable update)
      updatedTree = {
        ...currentTree,
        tokenUsage,
        duration: chunk.duration,
      };
    } else if (currentTree && !chunk.usage) {
      // Log warning if usage data is missing (graceful degradation)
      console.warn('[JsonlProcessor] Result message missing usage data', {
        chunkType: chunk.type,
        hasTree: !!currentTree,
      });
    }

    return {
      tree: updatedTree,
      streamComplete: true,
      newMessageStarted: false,
    };
  }

  // ============================================================================
  // TREE BUILDING HELPERS
  // ============================================================================

  private handleAgentSpawn(
    tree: ExecutionNode,
    chunk: JSONLMessage,
    toolUseId: string
  ): ExecutionNode {
    const agentInfo: AgentSpawnInfo = {
      toolUseId,
      subagentType: chunk.args?.['subagent_type'] as string,
      description: chunk.args?.['description'] as string,
      prompt: chunk.args?.['prompt'] as string,
      model: chunk.args?.['model'] as string,
    };

    const updatedTree = this.treeBuilder.appendAgent(tree, agentInfo);

    // Find the agent node we just added and register it
    const agentNode = this.findAgentNodeInTree(updatedTree, toolUseId);
    if (agentNode) {
      this.sessionManager.registerAgent(toolUseId, agentNode);
    }

    return updatedTree;
  }

  private handleToolExecution(
    tree: ExecutionNode,
    chunk: JSONLMessage,
    toolUseId: string
  ): ExecutionNode {
    const toolNode = this.sessionManager.getTool(toolUseId);
    if (!toolNode) {
      console.warn('[JsonlMessageProcessor] Tool node not found:', toolUseId);
      return tree;
    }

    // Clean CLI-specific formatting from tool output
    const toolOutput = this.cleanToolOutput(chunk.output);

    // Update tool node with result
    const updatedNode: ExecutionNode = {
      ...toolNode,
      status: chunk.error ? 'error' : 'complete',
      toolOutput,
      error: chunk.error,
      endTime: Date.now(),
      duration: toolNode.startTime
        ? Date.now() - toolNode.startTime
        : undefined,
    };

    // Replace in parent's children array (immutable update)
    return this.treeBuilder.replaceNode(tree, toolUseId, updatedNode);
  }

  // ============================================================================
  // HELPER UTILITIES
  // ============================================================================

  private logChunk(chunk: JSONLMessage): void {
    const rawChunk = chunk as any;
    const logInfo: Record<string, unknown> = {
      type: chunk.type,
      subtype: chunk.subtype,
    };

    // Add agent-related fields if present
    if (rawChunk.agentId) logInfo['agentId'] = rawChunk.agentId;
    if (rawChunk.slug) logInfo['slug'] = rawChunk.slug;
    if (rawChunk.isSidechain !== undefined)
      logInfo['isSidechain'] = rawChunk.isSidechain;
    if (rawChunk.parent_tool_use_id)
      logInfo['parent_tool_use_id'] = rawChunk.parent_tool_use_id;
    if (rawChunk.tool_use_id) logInfo['tool_use_id'] = rawChunk.tool_use_id;
    if (rawChunk.tool) logInfo['tool'] = rawChunk.tool;

    // Add message content summary if present
    if (chunk.message?.content) {
      const contentTypes = Array.isArray(chunk.message.content)
        ? chunk.message.content.map((c: any) => c.type || 'unknown')
        : ['string'];
      logInfo['contentTypes'] = contentTypes;

      // If there's a Task tool_use, log the agent details
      if (Array.isArray(chunk.message.content)) {
        for (const block of chunk.message.content) {
          if (block.type === 'tool_use' && block.name === 'Task') {
            logInfo['Task'] = {
              id: block.id,
              subagent_type: block.input?.subagent_type,
              description: block.input?.description,
            };
          }
        }
      }
    }

    console.log('[JsonlMessageProcessor] 📥 JSONL chunk:', logInfo);
  }

  /**
   * Find a tool node in the tree by its ID
   * (Used after adding a tool to register it in SessionManager)
   */
  private findToolNodeInTree(
    tree: ExecutionNode,
    toolId: string
  ): ExecutionNode | undefined {
    if (tree.id === toolId && tree.type === 'tool') {
      return tree;
    }

    for (const child of tree.children) {
      const found = this.findToolNodeInTree(child, toolId);
      if (found) return found;
    }

    return undefined;
  }

  /**
   * Find an agent node in the tree by its ID
   * (Used after spawning an agent to register it in SessionManager)
   */
  private findAgentNodeInTree(
    tree: ExecutionNode,
    agentId: string
  ): ExecutionNode | undefined {
    if (tree.id === agentId && tree.type === 'agent') {
      return tree;
    }

    for (const child of tree.children) {
      const found = this.findAgentNodeInTree(child, agentId);
      if (found) return found;
    }

    return undefined;
  }
}
