import {
  Component,
  input,
  output,
  signal,
  effect,
  computed,
  ChangeDetectionStrategy,
  viewChild,
} from '@angular/core';
import {
  ToolCallHeaderComponent,
  ToolInputDisplayComponent,
  ToolOutputDisplayComponent,
  PermissionRequestCardComponent,
} from '@ptah-extension/chat-ui';
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
 * - Escape inside the expanded item collapses it and refocuses the header
 *   toggle; a pending permission keeps it open (decisions #120(b), #121(b))
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
 *   │    ├─ DurationBadgeComponent (duration display)
 *   │    └─ CopyTextButtonComponent ("Copy command")
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
  host: { '(keydown.escape)': 'onEscape($event)' },
  imports: [
    ToolCallHeaderComponent,
    ToolInputDisplayComponent,
    ToolOutputDisplayComponent,
    PermissionRequestCardComponent,
  ],
  template: `
    <div [class]="containerClass()">
      <!-- Header (clickable to toggle) -->
      <ptah-tool-call-header
        #headerRef
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

    <!-- Separator between tool cards -->
    <div
      class="flex items-center gap-2 my-1.5 px-1 before:flex-1 before:border-t before:border-base-300/40 after:flex-1 after:border-t after:border-base-300/40"
    >
      <div class="w-1 h-1 rounded-full bg-base-300/60"></div>
    </div>
  `,
  // `.ptah-gold-border` is defined once globally in
  // apps/ptah-extension-webview/src/styles.css, keyed off the theme-aware
  // `--ptah-gold` token. Do not re-add a local copy.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallItemComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  private readonly headerRef = viewChild<ToolCallHeaderComponent>('headerRef');

  /**
   * Dynamic container class: gold border for Ptah MCP tools, default otherwise
   */
  readonly containerClass = computed(() => {
    const toolName = this.node().toolName || '';
    const base = 'bg-surface-1 rounded my-0.5 border border-surface-border';
    if (toolName.startsWith('mcp__ptah')) {
      return base + ' ptah-gold-border';
    }
    return base;
  });

  /**
   * Permission request for this tool (if any)
   */
  readonly permission = input<PermissionRequest | undefined>();

  constructor() {
    effect(() => {
      if (this.permission()) {
        this.isCollapsed.set(false);
      }
    });
  }

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
   * Escape, innermost first: an inner expandable (code-output) that already
   * handled the key marks it `defaultPrevented`, and the item then leaves it
   * alone. While a permission request is pending the item stays open (the
   * auto-expand rule wins) but still claims the key, so no enclosing Escape
   * action (the chat view's overlay close) runs. Otherwise an expanded item
   * collapses, returns focus to its header toggle and claims the key. A
   * collapsed item lets the event bubble.
   */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented) return;
    if (this.permission()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.isCollapsed()) return;
    this.isCollapsed.set(true);
    this.headerRef()?.focusToggle();
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Handle permission response from embedded card
   * Bubbles response up to parent for ChatStore handling
   */
  protected handlePermissionResponse(response: PermissionResponse): void {
    this.permissionResponded.emit(response);
  }
}
