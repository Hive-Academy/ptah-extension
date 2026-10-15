import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { isWorkflowKind, type WorkflowKind } from '@ptah-extension/chat-types';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (label(); as text) {
    <span
      class="badge badge-ghost badge-xs max-w-full shrink-0 whitespace-nowrap border-base-content/20 text-base-content"
      [attr.aria-label]="'Workflow: ' + text"
      >{{ text }}</span
    >
  }`,
})
export class WorkflowBadgeComponent {
  readonly workflow = input<WorkflowKind | null | undefined>();
  readonly label = computed(() => {
    const workflow = this.workflow();
    return isWorkflowKind(workflow) ? labels[workflow] : null;
  });
}
