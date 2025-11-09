/**
 * Permission Rules Store - Persistence for "always allow" patterns
 * SOLID: Interface Segregation - Abstract persistence layer
 */

import { ClaudePermissionRule } from '@ptah-extension/shared';

/**
 * Abstract storage interface for permission rules
 */
export interface IPermissionRulesStore {
  /**
   * Load all permission rules
   */
  loadRules(): Promise<ClaudePermissionRule[]>;

  /**
   * Save a new rule
   */
  saveRule(rule: ClaudePermissionRule): Promise<void>;

  /**
   * Delete a rule by ID
   */
  deleteRule(ruleId: string): Promise<void>;

  /**
   * Clear all rules
   */
  clearAll(): Promise<void>;
}

/**
 * In-memory store for permission rules (default implementation)
 * Production implementations could use workspace storage or filesystem
 */
export class InMemoryPermissionRulesStore implements IPermissionRulesStore {
  private rules = new Map<string, ClaudePermissionRule>();

  async loadRules(): Promise<ClaudePermissionRule[]> {
    return Array.from(this.rules.values());
  }

  async saveRule(rule: ClaudePermissionRule): Promise<void> {
    this.rules.set(rule.id, rule);
  }

  async deleteRule(ruleId: string): Promise<void> {
    this.rules.delete(ruleId);
  }

  async clearAll(): Promise<void> {
    this.rules.clear();
  }

  /**
   * Get rule by ID (helper method)
   */
  getRule(ruleId: string): ClaudePermissionRule | undefined {
    return this.rules.get(ruleId);
  }
}
