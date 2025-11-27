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
      // Initialize new assistant message
      const messageId = this.treeBuilder.generateId();
      const tree = this.treeBuilder.createMessageTree(messageId);

      return {
        tree,
        streamComplete: false,
        newMessageStarted: true,
        messageId,
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
      tree = this.treeBuilder.createMessageTree(messageId);
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
            // Register as agent immediately so nested messages can find it
            const agentInfo: AgentSpawnInfo = {
              toolUseId: block.id,
              subagentType: inputObj['subagent_type'] as string,
              description: inputObj['description'] as string,
              prompt: inputObj['prompt'] as string,
              model: inputObj['model'] as string,
            };

            tree = this.treeBuilder.appendAgent(tree, agentInfo);

            // Find the agent node we just added and register it
            if (block.id) {
              const agentNode = this.findAgentNodeInTree(tree, block.id);
              if (agentNode) {
                this.sessionManager.registerAgent(block.id, agentNode);
                console.log(
                  '[JsonlMessageProcessor] Registered agent from tool_use block:',
                  block.id,
                  agentInfo.subagentType
                );
              }
            }
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
    };
  }

  /**
   * Handle assistant messages that are nested inside an agent's execution context.
   * These come with parent_tool_use_id pointing to the Task tool that spawned the agent.
   */
  private handleNestedAssistantMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null,
    parentToolUseId: string
  ): ProcessingResult {
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

    // If we don't have a tree yet (can happen when continuing a session mid-agent),
    // create one now and attach the parent agent to it
    let tree = currentTree;
    let newMessageStarted = false;
    let messageId: string | undefined;

    if (!tree) {
      messageId = this.treeBuilder.generateId();
      tree = this.treeBuilder.createMessageTree(messageId);
      newMessageStarted = true;

      // Add the parent agent to the new tree so updates can be applied
      tree = {
        ...tree,
        children: [...tree.children, parentAgent],
      };

      console.log(
        '[JsonlMessageProcessor] Created message tree for continued session, attached agent:',
        parentToolUseId
      );
    }

    // Add text content to the agent's children
    if (chunk.message?.content) {
      for (const block of chunk.message.content) {
        if (block.type === 'text' && block.text) {
          const textNode = createExecutionNode({
            id: this.treeBuilder.generateId(),
            type: 'text',
            status: 'complete',
            content: block.text,
          });

          const updatedAgent: ExecutionNode = {
            ...parentAgent,
            children: [...parentAgent.children, textNode],
          };

          this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

          // Update tree
          if (tree) {
            tree = this.treeBuilder.replaceNode(
              tree,
              parentToolUseId,
              updatedAgent
            );
          }

          // Update reference for next iteration
          parentAgent = updatedAgent;
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

          const updatedAgent: ExecutionNode = {
            ...parentAgent,
            children: [...parentAgent.children, toolNode],
          };

          this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

          if (tree) {
            tree = this.treeBuilder.replaceNode(
              tree,
              parentToolUseId,
              updatedAgent
            );
          }

          parentAgent = updatedAgent;
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

        const updatedAgent: ExecutionNode = {
          ...parentAgent,
          children: [...parentAgent.children.slice(0, -1), updatedChild],
        };

        this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

        if (tree) {
          tree = this.treeBuilder.replaceNode(
            tree,
            parentToolUseId,
            updatedAgent
          );
        }
      } else {
        // Create new streaming text node
        const textNode = createExecutionNode({
          id: this.treeBuilder.generateId(),
          type: 'text',
          status: 'streaming',
          content: chunk.delta,
        });

        const updatedAgent: ExecutionNode = {
          ...parentAgent,
          children: [...parentAgent.children, textNode],
        };

        this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

        if (tree) {
          tree = this.treeBuilder.replaceNode(
            tree,
            parentToolUseId,
            updatedAgent
          );
        }
      }
    }

    return { tree, streamComplete: false, newMessageStarted, messageId };
  }

  private handleToolMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    let tree = currentTree;
    let newMessageStarted = false;
    let messageId: string | undefined;

    const toolUseId = chunk.tool_use_id;
    const parentToolUseId = chunk.parent_tool_use_id;

    // If we don't have a tree but this is a nested tool message, create one
    if (!tree && parentToolUseId) {
      const parentAgent = this.sessionManager.getAgent(parentToolUseId);
      if (parentAgent) {
        messageId = this.treeBuilder.generateId();
        tree = this.treeBuilder.createMessageTree(messageId);
        newMessageStarted = true;

        // Add the parent agent to the new tree
        tree = {
          ...tree,
          children: [...tree.children, parentAgent],
        };

        console.log(
          '[JsonlMessageProcessor] Created message tree for nested tool, attached agent:',
          parentToolUseId
        );
      }
    }

    // Still no tree? Can't process tool messages without one
    if (!tree) {
      return { tree, streamComplete: false, newMessageStarted: false };
    }

    // Check if this is a Task tool (agent spawn)
    if (chunk.tool === 'Task' && toolUseId) {
      tree = this.handleAgentSpawn(tree, chunk, toolUseId);
      return { tree, streamComplete: false, newMessageStarted, messageId };
    }
    // Check if this is nested under an agent
    else if (parentToolUseId) {
      tree = this.handleNestedTool(tree, chunk, parentToolUseId);
      return { tree, streamComplete: false, newMessageStarted, messageId };
    }
    // Regular tool execution
    else if (toolUseId) {
      tree = this.handleToolExecution(tree, chunk, toolUseId);
      return { tree, streamComplete: false, newMessageStarted, messageId };
    }

    return { tree, streamComplete: false, newMessageStarted, messageId };
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
   */
  private handleUserMessage(
    chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // If no content, nothing to process
    if (!chunk.message?.content || !currentTree) {
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

          // Update tree
          tree = this.treeBuilder.replaceNode(
            tree,
            block.tool_use_id,
            updatedTool
          );

          // If this is nested under an agent, update the agent's children too
          if (parentToolUseId) {
            const parentAgent = this.sessionManager.getAgent(parentToolUseId);
            if (parentAgent) {
              // Find and update the tool in the agent's children
              const updatedChildren = parentAgent.children.map((child) =>
                child.id === block.tool_use_id ? updatedTool : child
              );

              const updatedAgent: ExecutionNode = {
                ...parentAgent,
                children: updatedChildren,
              };

              this.sessionManager.registerAgent(parentToolUseId, updatedAgent);
              tree = this.treeBuilder.replaceNode(
                tree,
                parentToolUseId,
                updatedAgent
              );
            }
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

    return { tree, streamComplete: false, newMessageStarted: false };
  }

  private handleResultMessage(
    _chunk: JSONLMessage,
    currentTree: ExecutionNode | null
  ): ProcessingResult {
    // Finalize current message (chunk contains final metrics, stored in message if needed)
    return {
      tree: currentTree,
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

  private handleNestedTool(
    tree: ExecutionNode,
    chunk: JSONLMessage,
    parentToolUseId: string
  ): ExecutionNode {
    const parentAgent = this.sessionManager.getAgent(parentToolUseId);

    // Parent agent should exist from either:
    // 1. handleAgentSpawn during current streaming session
    // 2. SessionManager.setNodeMaps when loading a session
    if (!parentAgent) {
      console.warn(
        '[JsonlMessageProcessor] Parent agent not found for nested tool:',
        parentToolUseId,
        '- Message may be dropped. This can happen if resuming a session that was interrupted mid-agent.'
      );
      return tree;
    }

    // Clean CLI-specific formatting from tool output
    const toolOutput = this.cleanToolOutput(chunk.output);

    const toolNode = createExecutionNode({
      id: chunk.tool_use_id || this.treeBuilder.generateId(),
      type: 'tool',
      status: chunk.subtype === 'start' ? 'streaming' : 'complete',
      toolName: chunk.tool,
      toolInput: chunk.args,
      toolOutput,
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
    this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

    // Store for potential nested agents within this tool
    if (chunk.tool_use_id) {
      this.sessionManager.registerTool(chunk.tool_use_id, toolNode);
    }

    // Update the execution tree with the updated agent
    return this.treeBuilder.replaceNode(tree, parentToolUseId, updatedAgent);
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
