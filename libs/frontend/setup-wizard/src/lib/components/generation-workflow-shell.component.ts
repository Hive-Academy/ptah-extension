import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  SessionEmbedComponent,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';

@Component({
  selector: 'ptah-generation-workflow-shell',
  standalone: true,
  imports: [SessionEmbedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (binding(); as current) {
      <section
        class="flex h-full min-h-0 flex-col"
        aria-label="Generation workflow"
      >
        <div class="sr-only" role="status">{{ store.state() }}</div>
        @if (store.isBound()) {
          <div
            class="flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2"
          >
            <p class="text-sm" role="status">
              Finish or stop generation before sending a message.
            </p>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              (click)="store.stop()"
            >
              Stop generation
            </button>
          </div>
        }
        <ptah-session-embed
          class="min-h-0 flex-1"
          [tabId]="current.tabId"
          [startGuard]="startGuard"
          [stopHandler]="stopHandler"
        />
      </section>
    } @else {
      <p role="alert">This generation tab is unavailable in this workspace.</p>
    }
  `,
})
export class GenerationWorkflowShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly tabs = inject(TabManagerService);
  readonly store = inject(GenerationWorkflowStore);
  readonly binding = computed(() => {
    this.tabs.tabs();
    const workspacePath = this.tabs.activeWorkspacePath$();
    const tabId = this.route.snapshot.paramMap.get('tabId');
    const workflow = this.route.snapshot.paramMap.get('workflow');
    if (
      !workspacePath ||
      !tabId ||
      (workflow !== 'setup-agent-generation' &&
        workflow !== 'setup-project-prompt')
    )
      return null;
    const tab = this.tabs
      .getWorkspaceTabs(workspacePath)
      .find(
        (candidate) =>
          candidate.id === tabId && candidate.workflow === workflow,
      );
    return tab
      ? { tabId, workspacePath, workflow: workflow as SetupGenerationWorkflow }
      : null;
  });
  readonly startGuard = () =>
    this.store.isBound()
      ? 'Finish or stop generation before sending a message.'
      : null;
  readonly stopHandler: SessionStopHandler = (tabId) => {
    if (this.binding()?.tabId !== tabId || !this.store.isBound())
      return 'not-handled';
    this.store.stop();
    return 'handled';
  };

  constructor() {
    effect(() => {
      const binding = this.binding();
      if (binding) this.store.bind(binding);
      else this.store.unbind();
    });
  }
}
