import { Injectable } from '@angular/core';
import {
  AGENT_ICON_MAP,
  AGENT_COLOR_MAP,
  TOOL_ICON_MAP,
  DEFAULT_ICON,
  DEFAULT_TOOL_ICON,
} from '../constants/agent-icons.constants';

/**
 * Service for resolving agent and tool icons with semantic colors
 *
 * Provides icon and color mappings for:
 * - 16 agent types (general-purpose, Explore, Plan, etc.)
 * - 8 tool types (Bash, Read, Edit, Write, Grep, Glob, WebFetch, WebSearch)
 * - Fallback icons for unknown types
 *
 * ARCHITECTURE:
 * - Injectable service with providedIn: 'root' (singleton)
 * - Simple lookup service (no state management)
 * - Returns lucide-angular icon component classes
 * - Returns VS Code CSS variable strings for colors
 *
 * USAGE:
 * ```typescript
 * @Component({
 *   selector: 'app-agent-card',
 *   imports: [agentIconService.getAgentIcon('backend-developer')],
 * })
 * export class AgentCardComponent {
 *   readonly iconService = inject(AgentIconService);
 *
 *   getAgentIconComponent(type: string) {
 *     return this.iconService.getAgentIcon(type);
 *   }
 *
 *   getAgentColor(type: string): string {
 *     return this.iconService.getAgentColor(type);
 *   }
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class AgentIconService {
  /**
   * Get lucide-angular icon component for agent type
   *
   * Returns the appropriate icon component class for dynamic rendering.
   * Falls back to CircleDotIcon if agent type is unknown.
   *
   * @param subagentType - Agent type string (e.g., "backend-developer", "Explore")
   * @returns Icon component class (lucide-angular)
   *
   * @example
   * ```typescript
   * const iconClass = iconService.getAgentIcon('frontend-developer');
   * // Returns PaintBucketIcon
   *
   * const unknownIcon = iconService.getAgentIcon('unknown-agent');
   * // Returns CircleDotIcon (fallback)
   * ```
   */
  getAgentIcon(subagentType: string) {
    return AGENT_ICON_MAP[subagentType] ?? DEFAULT_ICON;
  }

  /**
   * Get VS Code semantic color variable for agent type
   *
   * Returns the CSS variable string for styling the agent icon/badge.
   * Falls back to default foreground color if agent type is unknown.
   *
   * @param subagentType - Agent type string
   * @returns CSS variable string (e.g., "var(--vscode-symbolIcon-functionForeground)")
   *
   * @example
   * ```typescript
   * const color = iconService.getAgentColor('backend-developer');
   * // Returns "var(--vscode-symbolIcon-functionForeground)"
   *
   * // Use in component template:
   * <div [style.color]="iconService.getAgentColor(agent.subagentType)">
   *   ...
   * </div>
   * ```
   */
  getAgentColor(subagentType: string): string {
    return AGENT_COLOR_MAP[subagentType] ?? 'var(--vscode-editor-foreground)';
  }

  /**
   * Get lucide-angular icon component for tool name
   *
   * Returns the appropriate icon component class for tool activity display.
   * Falls back to WrenchIcon if tool name is unknown.
   *
   * @param toolName - Tool name string (e.g., "Bash", "Read", "Edit")
   * @returns Icon component class (lucide-angular)
   *
   * @example
   * ```typescript
   * const iconClass = iconService.getToolIcon('Bash');
   * // Returns TerminalIcon
   *
   * const unknownIcon = iconService.getToolIcon('UnknownTool');
   * // Returns WrenchIcon (fallback)
   * ```
   */
  getToolIcon(toolName: string) {
    return TOOL_ICON_MAP[toolName] ?? DEFAULT_TOOL_ICON;
  }
}
