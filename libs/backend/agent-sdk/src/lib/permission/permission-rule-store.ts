/**
 * Permission Rule Store — owns the in-memory `permissionRules` map.
 *
 * Extracted from `sdk-permission-handler.ts` as part of TASK_2025_291 Wave C7a.
 *
 * This is a plain class composed internally by `SdkPermissionHandler` — no DI
 * token and no `@injectable()` decorator. A future wave can add persistence
 * (save/load to disk) without touching the decision path or UI bridge.
 *
 * Library-internal; not re-exported.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { PermissionRule } from '@ptah-extension/shared';

export class PermissionRuleStore {
  /**
   * Stored "Always Allow" permission rules
   * Maps toolName → PermissionRule (auto-approve matching tools)
   */
  private readonly rules = new Map<string, PermissionRule>();

  constructor(private readonly logger: Logger) {}

  setRule(toolName: string, rule: PermissionRule): void {
    this.rules.set(toolName, rule);
  }

  getRule(toolName: string): PermissionRule | null {
    return this.rules.get(toolName) ?? null;
  }

  hasRule(toolName: string): boolean {
    return this.rules.has(toolName);
  }

  clearRule(toolName: string): boolean {
    const deleted = this.rules.delete(toolName);
    if (deleted) {
      this.logger.info(
        `[SdkPermissionHandler] Cleared permission rule for tool: ${toolName}`,
      );
    }
    return deleted;
  }

  clearAll(): void {
    const count = this.rules.size;
    this.rules.clear();
    this.logger.info(
      `[SdkPermissionHandler] Cleared all ${count} permission rules`,
    );
  }

  listRules(): PermissionRule[] {
    return Array.from(this.rules.values());
  }

  get size(): number {
    return this.rules.size;
  }
}
