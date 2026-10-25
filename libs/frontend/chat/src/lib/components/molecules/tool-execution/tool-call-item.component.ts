import {
  Component,
  input,
  output,
  signal,
  effect,
  computed,
  ChangeDetectionStrategy,
  viewChild,
  inject,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  ArtifactCardComponent,
  ToolCallHeaderComponent,
  ToolInputDisplayComponent,
  ToolOutputDisplayComponent,
  PermissionRequestCardComponent,
  isPtahMcpToolName,
  toolStatusPresentation,
} from '@ptah-extension/chat-ui';
import { ArtifactStore } from '../../../services/artifact.store';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { DisplaySheetState } from '../../organisms/display-sheet/display-sheet.state';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ToolCallItemComponent - One tool call as a quiet log line with a status rail
 *
 * Complexity Level: 2 (Molecule orchestrator)
 * Patterns: Composition of header, input and output molecules
 *
 * Features:
 * - Compose ToolCallHeaderComponent, ToolInputDisplayComponent, ToolOutputDisplayComponent
 * - No card box or separator; a 3px left rail carries the state colour from
 *   `toolStatusPresentation` (success, error, pulsing info while running,
 *   warning when interrupted or awaiting permission, info when resumed,
 *   neutral while pending). The header reads the same state out in words
 * - A pending permission request outranks the status (it can arrive with
 *   `status: 'error'`): warning rail, "Awaiting permission"
 * - Ptah MCP calls keep a status-coloured rail (state outranks identity, a
 *   deviation from Direction C's gold rail); the header's gold "Ptah" chip
 *   and the expanded body's gold left border carry the identity
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
 *   ├─ ToolCallHeaderComponent (tool name, primary, chips, duration)
 *   ├─ ToolInputDisplayComponent (Command / Content / Prompt, Arguments)
 *   └─ ToolOutputDisplayComponent
 *        ├─ TodoListDisplayComponent (TodoWrite specialized display)
 *        ├─ DiffDisplayComponent (Edit diff)
 *        └─ CodeOutputComponent (Result / Error block)
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
    ArtifactCardComponent,
  ],
  template: `
    <div class="relative pl-2.5 my-0.5" data-glass-surface="tile">
      <!-- Status rail: colour only; the header names the status in words -->
      <span
        [class]="railClass()"
        aria-hidden="true"
        data-testid="tool-rail"
      ></span>

      <!-- Header (clickable to toggle) -->
      <ptah-tool-call-header
        #headerRef
        [node]="node()"
        [isCollapsed]="isCollapsed()"
        [awaitingPermission]="awaitingPermission()"
        (toggleClicked)="toggleCollapse()"
      />

      @if (canOpenArtifacts && artifact(); as record) {
        <ptah-artifact-card [artifact]="record" (open)="openArtifact($event)" (fullscreen)="openArtifact($event, true)" />
      } @else if (publishedArtifact(); as published) {
        <article class="flex flex-col gap-1 rounded-box border border-base-content/15 bg-base-200/40 p-3" data-testid="artifact-card">
          <p class="truncate text-sm font-semibold" data-testid="artifact-card-title">{{ published.title }}</p>
          <p class="text-xs text-base-content-muted" data-testid="artifact-card-status">
            {{ artifact() ? 'Preview not available here' : 'Not loaded yet' }}
          </p>
        </article>
      }

      <!-- Collapsible content -->
      @if (!isCollapsed()) {
        <div [class]="bodyClass()" [attr.id]="'tool-' + node().id">
          <!-- Input: Command / Content / Prompt, Arguments -->
          <ptah-tool-input-display [node]="node()" />

          <!-- Output: Result / Diff / Tasks / Error -->
          <ptah-tool-output-display
            [node]="node()"
            [awaitingPermission]="awaitingPermission()"
          />

          <!-- Permission request section (if tool requires permission) -->
          @if (permission()) {
            <div class="pt-1.5 border-t border-surface-border">
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
  // `.ptah-gold-border` is defined once globally in
  // apps/ptah-extension-webview/src/styles.css, keyed off the theme-aware
  // `--ptah-gold` token. Do not re-add a local copy.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallItemComponent {
  private readonly artifacts = inject(ArtifactStore);
  // Optional: only a session chat view provides the Display dock and sheet
  // (and VS Code provides a null dock). A subagent or CLI lane renders the
  // same tool rows without them; there the artifact shows as a read-only
  // card instead of offering Open / Full screen actions that cannot work.
  private readonly dock = inject(DisplayDockState, { optional: true });
  private readonly sheet = inject(DisplaySheetState, { optional: true });
  protected readonly canOpenArtifacts = this.dock !== null;
  private readonly tabs = inject(TabManagerService);
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  private readonly headerRef = viewChild<ToolCallHeaderComponent>('headerRef');

  protected readonly publishedArtifact = computed((): { id: string; title: string } | null => {
    const node = this.node();
    if (node.isError || node.status !== 'complete' || !/^(?:mcp__ptah__)?ptah_artifact_publish$/.test(node.toolName ?? '')) return null;
    const output = node.toolOutput;
    const content = Array.isArray(output) ? output : isRecord(output) ? output['content'] : null;
    const part = Array.isArray(content)
      ? content.find((entry: unknown) => isRecord(entry) && entry['type'] === 'text')
      : null;
    const text = typeof output === 'string' ? output : isRecord(part) ? part['text'] : null;
    if (typeof text !== 'string') return null;
    try {
      const result: unknown = JSON.parse(text);
      return isRecord(result) && typeof result['id'] === 'string'
        ? { id: result['id'], title: typeof result['title'] === 'string' ? result['title'] : 'Artifact' } : null;
    } catch { return null; }
  });
  protected readonly artifact = computed(() => {
    const published = this.publishedArtifact();
    return published ? this.artifacts.recordById(published.id) : null;
  });

  protected openArtifact(id: string, full = false): void {
    const tabId = this.tabs.activeTabId();
    if (!tabId || !this.dock) return;
    this.dock.openArtifact(tabId, id);
    if (full) {
      this.dock.requestFullscreenArtifact(tabId, id);
      this.sheet?.setMode(tabId, 'full');
    }
  }

  /** A permission request for this call is waiting on the user. */
  protected readonly awaitingPermission = computed(() => !!this.permission());

  /**
   * Rail colour from `toolStatusPresentation` (shared with the header's
   * label), as one class string: a `[class.x]` binding cannot carry the
   * `motion-reduce:` variant. Existing tokens only.
   */
  readonly railClass = computed(() => {
    const { railClass } = toolStatusPresentation(this.node().status, {
      command: false,
      awaitingPermission: this.awaitingPermission(),
    });
    return `absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${railClass}`;
  });

  /**
   * Expanded body: no box. Ptah MCP calls get a gold left border
   * (`.ptah-gold-border`, keyed off the theme-aware `--ptah-gold`).
   */
  readonly bodyClass = computed(() => {
    const base = 'pb-1.5 space-y-1.5';
    return isPtahMcpToolName(this.node().toolName || '')
      ? `${base} ml-1 pl-2 border-l ptah-gold-border`
      : `${base} pl-1`;
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
