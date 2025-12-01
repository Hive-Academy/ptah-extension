import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ToolCallHeaderComponent } from './tool-call-header.component';
import { ToolInputDisplayComponent } from './tool-input-display.component';
import { ToolOutputDisplayComponent } from './tool-output-display.component';
import { PermissionRequestCardComponent } from './permission-request-card.component';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

/**
 * ToolCallItemComponent - Compact tool execution display (REFACTORED)
 *
 * Complexity Level: 2 (Molecule orchestrator)
 * Patterns: Composition-based architecture (REDUCED from 702 lines to ~80 lines)
 *
 * Features:
 * - Compose ToolCallHeaderComponent, ToolInputDisplayComponent, ToolOutputDisplayComponent
 * - Manage collapse state (default: collapsed)
 * - Toggle collapse on header click
 * - Pass ExecutionNode to all child components
 * - Preserve <ng-content /> slot for nested execution nodes
 *
 * Architecture:
 * - ALL rendering logic delegated to specialized child components
 * - ALL tool-specific logic extracted to atoms/molecules
 * - ZERO duplication (all logic lives in single location)
 * - Simple orchestrator with collapse state management only
 *
 * Composition Hierarchy:
 * ToolCallItemComponent (this component)
 *   ├─ ToolCallHeaderComponent
 *   │    ├─ ToolIconComponent (icon + color)
 *   │    ├─ FilePathLinkComponent (clickable file paths)
 *   │    └─ DurationBadgeComponent (duration display)
 *   ├─ ToolInputDisplayComponent
 *   │    └─ ExpandableContentComponent (large content expand/collapse)
 *   └─ ToolOutputDisplayComponent
 *        ├─ TodoListDisplayComponent (TodoWrite specialized display)
 *        ├─ CodeOutputComponent (syntax-highlighted code)
 *        └─ ErrorAlertComponent (error display)
 */
@Component({
  selector: 'ptah-tool-call-item',
  standalone: true,
  imports: [
    ToolCallHeaderComponent,
    ToolInputDisplayComponent,
    ToolOutputDisplayComponent,
    PermissionRequestCardComponent,
  ],
  template: `
    <div class="bg-base-200/30 rounded my-0.5 border border-base-300/50">
      <!-- Header (clickable to toggle) -->
      <ptah-tool-call-header
        [node]="node()"
        [isCollapsed]="isCollapsed()"
        (toggleClicked)="toggleCollapse()"
      />

      <!-- Collapsible content -->
      @if (!isCollapsed()) {
      <div
        class="px-2 pb-2 pt-0 border-t border-base-300/30"
        [attr.id]="'tool-' + node().id"
      >
        <!-- Input parameters -->
        <ptah-tool-input-display [node]="node()" />

        <!-- Output section -->
        <ptah-tool-output-display [node]="node()" />

        <!-- Permission request section (if tool requires permission) -->
        @if (permission()) {
        <div class="mt-2 pt-2 border-t border-base-300/30">
          <ptah-permission-request-card
            [request]="permission()!"
            (responded)="handlePermissionResponse($event)"
          />
        </div>
        }

        <!-- Nested children (rendered by parent ExecutionNode) -->
        <ng-content />
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallItemComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  /**
   * Permission request for this tool (if any)
   */
  readonly permission = input<PermissionRequest | undefined>();

  /**
   * Emits when user responds to permission request
   */
  readonly permissionResponded = output<PermissionResponse>();

  /**
   * Toggle collapse state
   */
  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }

  /**
   * Handle permission response from embedded card
   * Bubbles response up to parent for ChatStore handling
   */
  protected handlePermissionResponse(response: PermissionResponse): void {
    this.permissionResponded.emit(response);
  }
}
