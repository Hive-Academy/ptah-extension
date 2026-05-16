/**
 * Permission Prompt Service
 *
 * Manages permission requests for MCP approval_prompt tool integration.
 * Responsibilities:
 * - Create and track pending permission requests
 * - Apply "Always Allow" rules for automatic approval
 * - Block indefinitely until user responds or session cleanup resolves
 * - Persist permission rules to workspace state
 *
 * Permission requests block indefinitely until the user responds or cleanup
 * resolves them (matching Claude Code CLI behavior).
 */

import { injectable, inject } from 'tsyringe';
import { minimatch } from 'minimatch';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isReadToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';
import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
} from '@ptah-extension/shared';
import type { ApprovalPromptParams } from '../code-execution/types';

/**
 * Storage key for permission rules in workspace state
 */
const RULES_STORAGE_KEY = 'ptah.permission.rules';

/**
 * Pending request state with Promise resolver
 */
interface PendingRequest {
  /** Promise resolver for the request */
  resolve: (response: PermissionResponse) => void;

  /** Original request data for rule creation */
  request: PermissionRequest;
}

@injectable()
export class PermissionPromptService {
  /**
   * Map of pending permission requests by request ID
   * Each request has a Promise resolver for the pending response
   */
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private readonly workspaceState: IStateStorage,
  ) {}

  /**
   * Check if a tool execution is pre-authorized by permission rules
   *
   * @param toolName - Name of the tool (e.g., "Bash", "Write", "Read")
   * @param toolInput - Tool input parameters
   * @returns 'allow' if pre-authorized, 'deny' if blocked, 'ask' if no matching rule
   */
  checkRules(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): 'allow' | 'deny' | 'ask' {
    const rules = this.getRules();

    // Build pattern match string: "ToolName:JSON"
    const matchString = `${toolName}:${JSON.stringify(toolInput)}`;

    for (const rule of rules) {
      // Only check rules for matching tool name
      if (rule.toolName !== toolName) {
        continue;
      }

      // Use minimatch for pattern matching
      if (minimatch(matchString, rule.pattern)) {
        this.logger.debug('Permission rule matched', {
          toolName,
          pattern: rule.pattern,
          action: rule.action,
        });
        return rule.action;
      }
    }

    // No matching rule found
    return 'ask';
  }

  /**
   * Create a new permission request
   *
   * @param params - Approval prompt parameters from Claude CLI
   * @returns Permission request with unique ID (blocks indefinitely until user responds)
   */
  createRequest(params: ApprovalPromptParams): PermissionRequest {
    const requestId = crypto.randomUUID();
    const timestamp = Date.now();

    // Build human-readable description
    const description = this.buildDescription(
      params.tool_name,
      params.input as Record<string, unknown>,
    );

    const request: PermissionRequest = {
      id: requestId,
      toolName: params.tool_name,
      toolInput: params.input as Record<string, unknown>,
      toolUseId: params.tool_use_id,
      timestamp,
      description,
      timeoutAt: 0,
    };

    this.logger.info('Permission request created', {
      id: requestId,
      toolName: params.tool_name,
    });

    return request;
  }

  /**
   * Store a pending request resolver for later resolution
   *
   * Called by MCP server after creating request and sending to webview.
   * The resolver will be invoked when the user responds or cleanup resolves it.
   * Blocks indefinitely -- there is no timeout.
   *
   * @param id - Request ID
   * @param resolve - Promise resolver function
   * @param request - Original request data for rule creation
   */
  setPendingResolver(
    id: string,
    resolve: (response: PermissionResponse) => void,
    request: PermissionRequest,
  ): void {
    // Store resolver (no timeout -- blocks until user responds or cleanup)
    this.pendingRequests.set(id, { resolve, request });

    this.logger.debug('Pending resolver stored (blocks indefinitely)', { id });
  }

  /**
   * Remove a pending resolver without resolving it.
   *
   * Used for cleanup when a request times out or is cancelled
   * before the user responds. Prevents stale entries from
   * accumulating in the pending map.
   *
   * @param id - Request ID to remove
   * @returns true if the entry was found and removed, false if not found
   */
  removePendingResolver(id: string): boolean {
    const existed = this.pendingRequests.has(id);
    if (existed) {
      this.pendingRequests.delete(id);
      this.logger.debug('Pending resolver removed (cleanup)', { id });
    }
    return existed;
  }

  /**
   * Resolve a pending permission request with user response
   *
   * Called when the webview sends back the user's decision.
   * Removes from pending map and resolves the Promise.
   *
   * @param response - User's permission decision
   * @returns true if request was found and resolved, false if not found
   */
  resolveRequest(response: PermissionResponse): boolean {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      this.logger.warn('No pending request found for response', {
        id: response.id,
      });
      return false;
    }

    // Remove from pending map
    this.pendingRequests.delete(response.id);

    // If "always_allow", create a permission rule
    if (response.decision === 'always_allow') {
      this.createRuleFromRequest(pending.request);
      this.logger.info('Created "Always Allow" rule from request', {
        id: response.id,
        toolName: pending.request.toolName,
      });
    }

    // Resolve the Promise
    pending.resolve(response);

    this.logger.info('Permission request resolved', {
      id: response.id,
      decision: response.decision,
    });

    return true;
  }

  /**
   * Add a new permission rule for automatic approval
   *
   * @param rule - Rule data (without id and createdAt)
   * @returns Complete rule with generated id and timestamp
   */
  addRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>): PermissionRule {
    const completeRule: PermissionRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    // Get existing rules
    const rules = this.getRules();

    // Add new rule
    rules.push(completeRule);

    // Save to workspace state
    this.saveRules(rules);

    this.logger.info('Permission rule added', {
      id: completeRule.id,
      pattern: completeRule.pattern,
      toolName: completeRule.toolName,
      action: completeRule.action,
    });

    return completeRule;
  }

  /**
   * Get all permission rules from workspace state
   *
   * @returns Array of permission rules (empty array if none exist)
   */
  getRules(): PermissionRule[] {
    return this.workspaceState.get<PermissionRule[]>(RULES_STORAGE_KEY) ?? [];
  }

  /**
   * Delete a permission rule by ID
   *
   * @param ruleId - Rule ID to delete
   * @returns true if rule was found and deleted, false otherwise
   */
  deleteRule(ruleId: string): boolean {
    const rules = this.getRules();
    const filteredRules = rules.filter((r) => r.id !== ruleId);

    if (filteredRules.length === rules.length) {
      this.logger.warn('Rule not found for deletion', { ruleId });
      return false;
    }

    this.saveRules(filteredRules);

    this.logger.info('Permission rule deleted', { ruleId });
    return true;
  }

  /**
   * Clear all permission rules
   */
  clearRules(): void {
    this.saveRules([]);
    this.logger.info('All permission rules cleared');
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  /**
   * Save permission rules to workspace state
   *
   * @param rules - Rules array to persist
   */
  private saveRules(rules: PermissionRule[]): void {
    this.workspaceState.update(RULES_STORAGE_KEY, rules);
  }

  /**
   * Create a permission rule from a request (for "Always Allow")
   *
   * Generates a pattern that matches the exact tool and input structure.
   *
   * @param request - Original permission request
   */
  private createRuleFromRequest(request: PermissionRequest): void {
    // Build pattern: "ToolName:*" for broad match
    // For more specific matching, could use JSON.stringify(request.toolInput)
    const pattern = `${request.toolName}:*`;

    this.addRule({
      pattern,
      toolName: request.toolName,
      action: 'allow',
      description: `Auto-generated from request at ${new Date(
        request.timestamp,
      ).toISOString()}`,
    });
  }

  /**
   * Build human-readable description from tool name and input
   *
   * @param toolName - Tool name
   * @param toolInput - Tool input parameters
   * @returns Human-readable description
   */
  private buildDescription(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string {
    // Extract key parameters for common tools
    switch (toolName) {
      case 'Bash': {
        if (isBashToolInput(toolInput)) {
          return `Execute bash command: ${toolInput.command}`;
        }
        return `Execute bash command: unknown`;
      }
      case 'Write': {
        if (isWriteToolInput(toolInput)) {
          return `Write file: ${toolInput.file_path}`;
        }
        return `Write file: unknown`;
      }
      case 'Read': {
        if (isReadToolInput(toolInput)) {
          return `Read file: ${toolInput.file_path}`;
        }
        return `Read file: unknown`;
      }
      case 'Edit': {
        if (isEditToolInput(toolInput)) {
          return `Edit file: ${toolInput.file_path}`;
        }
        return `Edit file: unknown`;
      }
      case 'Glob': {
        if (isGlobToolInput(toolInput)) {
          return `Search files: ${toolInput.pattern}`;
        }
        return `Search files: unknown`;
      }
      case 'Grep': {
        if (isGrepToolInput(toolInput)) {
          return `Search content: ${toolInput.pattern}`;
        }
        return `Search content: unknown`;
      }
      default:
        // Generic description for unknown tools
        return `Execute ${toolName} with ${
          Object.keys(toolInput).length
        } parameters`;
    }
  }
}
