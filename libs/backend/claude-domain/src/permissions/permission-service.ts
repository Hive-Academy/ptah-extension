/**
 * Permission Service - YOLO mode, always-allow rules, and permission prompts
 * SOLID: Single Responsibility - Only manages permission decisions
 */

import { minimatch } from 'minimatch';
import {
  ClaudePermissionRule,
  ClaudePermissionRequest,
  ClaudePermissionResponse,
  PermissionDecision,
} from '@ptah-extension/shared';
import { IPermissionRulesStore } from './permission-rules.store';

export interface PermissionServiceConfig {
  readonly yoloMode: boolean;
  readonly defaultScope: 'workspace' | 'user' | 'session';
}

/**
 * Manages Claude CLI tool execution permissions
 */
export class PermissionService {
  private yoloMode: boolean;
  private rules: ClaudePermissionRule[] = [];
  private pendingRequests = new Map<string, ClaudePermissionRequest>();

  constructor(
    private readonly store: IPermissionRulesStore,
    private readonly config: PermissionServiceConfig
  ) {
    this.yoloMode = config.yoloMode;
  }

  /**
   * Initialize service and load persisted rules
   */
  async initialize(): Promise<void> {
    this.rules = await this.store.loadRules();
    this.cleanupExpiredRules();
  }

  /**
   * Request permission decision for a tool execution
   * Returns immediate decision if YOLO or matching rule exists,
   * otherwise returns 'deny' and caller should prompt user
   */
  async requestDecision(
    request: ClaudePermissionRequest
  ): Promise<ClaudePermissionResponse> {
    const timestamp = Date.now();

    // YOLO mode: auto-allow everything
    if (this.yoloMode) {
      return {
        toolCallId: request.toolCallId,
        decision: 'allow',
        provenance: 'yolo',
        timestamp,
      };
    }

    // Check for matching always-allow rule
    const matchingRule = this.findMatchingRule(request);
    if (matchingRule) {
      return {
        toolCallId: request.toolCallId,
        decision: 'always_allow',
        provenance: 'rule',
        timestamp,
      };
    }

    // Store pending request for later user response
    this.pendingRequests.set(request.toolCallId, request);

    // Return deny - caller should prompt user
    return {
      toolCallId: request.toolCallId,
      decision: 'deny',
      provenance: 'user', // Will be updated when user responds
      timestamp,
    };
  }

  /**
   * Process user's manual decision
   */
  async processUserDecision(
    toolCallId: string,
    decision: PermissionDecision,
    createRule = false
  ): Promise<ClaudePermissionResponse> {
    const request = this.pendingRequests.get(toolCallId);
    if (!request) {
      throw new Error(`No pending request for tool call ${toolCallId}`);
    }

    // If user chose "always allow", create a rule
    if (decision === 'always_allow' || createRule) {
      await this.createAlwaysAllowRule(request);
    }

    this.pendingRequests.delete(toolCallId);

    return {
      toolCallId,
      decision,
      provenance: 'user',
      timestamp: Date.now(),
    };
  }

  /**
   * Create an always-allow rule for a tool pattern
   */
  private async createAlwaysAllowRule(
    request: ClaudePermissionRequest
  ): Promise<void> {
    const rule: ClaudePermissionRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      pattern: this.generatePattern(request),
      scope: this.config.defaultScope,
      createdAt: Date.now(),
    };

    await this.store.saveRule(rule);
    this.rules.push(rule);
  }

  /**
   * Generate glob pattern from tool request
   */
  private generatePattern(request: ClaudePermissionRequest): string {
    // Simple pattern: tool_name (could be enhanced with arg matching)
    return request.tool;
  }

  /**
   * Find matching always-allow rule
   */
  private findMatchingRule(
    request: ClaudePermissionRequest
  ): ClaudePermissionRule | undefined {
    const now = Date.now();

    for (const rule of this.rules) {
      // Skip expired rules
      if (rule.expiresAt && rule.expiresAt < now) {
        continue;
      }

      // Match pattern against tool name
      if (minimatch(request.tool, rule.pattern)) {
        return rule;
      }
    }

    return undefined;
  }

  /**
   * Remove expired rules from memory and storage
   */
  private async cleanupExpiredRules(): Promise<void> {
    const now = Date.now();
    const expiredRules = this.rules.filter(
      (rule) => rule.expiresAt && rule.expiresAt < now
    );

    for (const rule of expiredRules) {
      await this.store.deleteRule(rule.id);
    }

    this.rules = this.rules.filter(
      (rule) => !rule.expiresAt || rule.expiresAt >= now
    );
  }

  /**
   * Enable/disable YOLO mode
   */
  setYoloMode(enabled: boolean): void {
    this.yoloMode = enabled;
  }

  /**
   * Check if YOLO mode is enabled
   */
  isYoloMode(): boolean {
    return this.yoloMode;
  }

  /**
   * Get all permission rules
   */
  getRules(): ClaudePermissionRule[] {
    return [...this.rules];
  }

  /**
   * Revoke a specific rule
   */
  async revokeRule(ruleId: string): Promise<boolean> {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index === -1) {
      return false;
    }

    await this.store.deleteRule(ruleId);
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * Clear all rules
   */
  async clearAllRules(): Promise<void> {
    await this.store.clearAll();
    this.rules = [];
  }

  /**
   * Get pending permission requests
   */
  getPendingRequests(): ClaudePermissionRequest[] {
    return Array.from(this.pendingRequests.values());
  }
}
