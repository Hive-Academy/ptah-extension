import {
  Component,
  input,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Workflow, PanelRightOpen } from 'lucide-angular';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * WorkflowCardComponent — compact "Workflow launched" chip for the chat
 * transcript.
 *
 * Complexity Level: 1 (simple presentational chip + one action)
 *
 * The SDK `Workflow` tool spawns a background orchestration whose progress is
 * watched in the Agents monitor panel (NOT inline in the transcript — see the
 * Claude Code `/workflows` view parity). This chip therefore renders only a
 * label + the workflow name and a button that opens that panel. It deliberately
 * does NOT build an inline phase/agent tree.
 *
 * It injects {@link AgentMonitorStore} to open the panel, so it lives in `chat`
 * (a stateful organism) rather than the stateless `chat-ui` library.
 */
@Component({
  selector: 'ptah-workflow-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center gap-2 my-1.5 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5"
    >
      <lucide-angular
        [img]="WorkflowIcon"
        class="w-4 h-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div class="flex flex-col min-w-0 flex-1">
        <span class="text-xs font-semibold text-base-content/80">
          Workflow launched
        </span>
        @if (workflowName(); as name) {
          <span
            class="text-[11px] text-base-content/50 truncate"
            [title]="name"
          >
            {{ name }}
          </span>
        }
      </div>
      <button
        type="button"
        class="btn btn-xs btn-ghost gap-1 text-primary shrink-0"
        (click)="openMonitor()"
        title="Watch this workflow in the Agents panel"
      >
        <lucide-angular
          [img]="PanelRightOpenIcon"
          class="w-3.5 h-3.5"
          aria-hidden="true"
        />
        <span>Agents</span>
      </button>
    </div>
  `,
})
export class WorkflowCardComponent {
  private readonly store = inject(AgentMonitorStore);

  readonly node = input.required<ExecutionNode>();

  readonly WorkflowIcon = Workflow;
  readonly PanelRightOpenIcon = PanelRightOpen;

  /**
   * Workflow display name, sourced from the Workflow tool_use input (trying the
   * likely arg keys) and falling back to the node content. Undefined when the
   * SDK has not surfaced a name yet.
   */
  readonly workflowName = computed<string | undefined>(() => {
    const node = this.node();
    const input = node.toolInput ?? {};
    const candidate =
      input['workflowName'] ?? input['name'] ?? input['workflow'];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
    const content = node.content;
    return content && content.trim().length > 0 ? content : undefined;
  });

  openMonitor(): void {
    this.store.requestPanelOpen();
  }
}
