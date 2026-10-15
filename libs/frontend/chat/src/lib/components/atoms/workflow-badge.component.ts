import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { isWorkflowKind, type WorkflowKind } from '@ptah-extension/chat-types';
import { LucideAngularModule, Workflow } from 'lucide-angular';

const labels: Record<WorkflowKind, string> = {
  'harness-configure': 'Configure Harness',
  'harness-new-project': 'New Project',
  'setup-wizard-phase': 'Setup',
  'setup-agent-generation': 'Agent Generation',
  'setup-project-prompt': 'Project Prompt',
};

@Component({
  selector: 'ptah-workflow-badge',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (label(); as text) {
    @if (variant() === 'compact') {
      <span
        class="inline-flex w-4 shrink-0 items-center justify-center"
        [attr.title]="text"
      >
        <span class="sr-only">Workflow: {{ text }}</span>
        <lucide-angular
          [img]="WorkflowIcon"
          class="h-3 w-3"
          aria-hidden="true"
        />
      </span>
    } @else {
      <span
        class="badge badge-ghost badge-sm max-w-full shrink-0 whitespace-nowrap border-base-content/20 text-base-content"
        ><span class="sr-only">Workflow: </span>{{ text }}</span
      >
    }
  }`,
})
export class WorkflowBadgeComponent {
  readonly workflow = input<WorkflowKind | null | undefined>();
  readonly variant = input<'full' | 'compact'>('full');
  readonly WorkflowIcon = Workflow;
  readonly label = computed(() => {
    const workflow = this.workflow();
    return isWorkflowKind(workflow) ? labels[workflow] : null;
  });
}
