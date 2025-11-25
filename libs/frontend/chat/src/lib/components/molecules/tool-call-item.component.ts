import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ToolCallItemComponent - Collapsible tool execution with input/output
 *
 * Complexity Level: 2 (Molecule with internal state)
 * Patterns: Composition, Tool-specific formatting
 *
 * Displays tool name badge, brief description, and collapsible input/output.
 * Supports nested children (for recursive tool results).
 */
@Component({
  selector: 'ptah-tool-call-item',
  standalone: true,
  imports: [MarkdownModule, DurationBadgeComponent],
  template: `
    <div
      class="collapse collapse-arrow bg-base-200/50 rounded-md my-1 border border-base-300"
    >
      <input
        type="checkbox"
        [checked]="!isCollapsed()"
        (change)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'tool-' + node().id"
      />

      <div
        class="collapse-title min-h-0 py-2 px-2.5 text-xs flex items-center gap-2"
      >
        <!-- Tool name badge -->
        <span
          class="badge badge-sm font-mono"
          [class.badge-success]="node().status === 'complete'"
          [class.badge-info]="node().status === 'streaming'"
          [class.badge-error]="node().status === 'error'"
          [class.badge-ghost]="node().status === 'pending'"
        >
          {{ node().toolName }}
        </span>

        <!-- Brief description -->
        <span class="text-base-content/60 truncate flex-1 text-xs">
          {{ getToolDescription() }}
        </span>

        <!-- Duration -->
        @if (node().duration) {
        <ptah-duration-badge [durationMs]="node().duration!" />
        }
      </div>

      <div class="collapse-content px-2.5 pb-2" [attr.id]="'tool-' + node().id">
        <!-- Tool input -->
        @if (node().toolInput) {
        <div class="mb-2">
          <div class="text-xs font-semibold text-base-content/70 mb-1">
            Input:
          </div>
          <pre
            class="bg-base-300 rounded p-2 text-xs overflow-x-auto font-mono"
            >{{ formatJson(node().toolInput) }}</pre
          >
        </div>
        }

        <!-- Tool output -->
        @if (node().toolOutput) {
        <div>
          <div class="text-xs font-semibold text-base-content/70 mb-1">
            Output:
          </div>
          <div class="bg-base-300 rounded p-2 text-xs">
            <markdown
              [data]="formatToolOutput()"
              class="prose prose-xs prose-invert max-w-none"
            />
          </div>
        </div>
        }

        <!-- Error -->
        @if (node().error) {
        <div class="alert alert-error text-xs mt-2">
          <span>{{ node().error }}</span>
        </div>
        }

        <!-- Nested children (rendered by parent ExecutionNode) -->
        <ng-content />
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolCallItemComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }

  protected getToolDescription(): string {
    const node = this.node();
    const toolName = node.toolName!;
    const input = node.toolInput;

    switch (toolName) {
      case 'Read':
        return (input?.['file_path'] as string) || 'Reading file...';
      case 'Write':
        return (input?.['file_path'] as string) || 'Writing file...';
      case 'Bash':
        const cmd = input?.['command'] as string;
        return cmd
          ? cmd.length > 50
            ? cmd.substring(0, 50) + '...'
            : cmd
          : 'Running command...';
      case 'Grep':
        return `Pattern: ${input?.['pattern'] || '...'}`;
      case 'Edit':
        return (input?.['file_path'] as string) || 'Editing file...';
      case 'Glob':
        return `Pattern: ${input?.['pattern'] || '...'}`;
      default:
        return `${toolName} execution`;
    }
  }

  protected formatToolOutput(): string {
    const output = this.node().toolOutput;
    if (typeof output === 'string') return output;
    return JSON.stringify(output, null, 2);
  }

  protected formatJson(obj: Record<string, unknown>): string {
    return JSON.stringify(obj, null, 2);
  }
}
