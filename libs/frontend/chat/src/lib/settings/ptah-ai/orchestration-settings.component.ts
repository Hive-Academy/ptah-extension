import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, afterRenderEffect, computed, inject, input, output,
} from '@angular/core';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { PtahCliConfigComponent } from './ptah-cli-config.component';
import {
  ProviderConsumerAssignmentsComponent, type BackgroundConsumerId,
} from '../providers/provider-consumer-assignments.component';

/** Deep-link sections the Orchestration tab owns (plan Component 10). */
export type OrchestrationSettingsFocusTarget = 'background-models' | 'cli-agents' | BackgroundConsumerId;

const BACKGROUND_CONSUMERS: readonly BackgroundConsumerId[] = [
  'memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement',
];

const CONTROL = 'btn btn-outline btn-sm min-h-9 min-w-6 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Agent Orchestration tab, interim form (TASK_2026_555 S5, plan :559-579, D14).
 *
 * Mounts the existing orchestration policy, the background-role assignments and the Ptah CLI
 * instance manager unchanged, moved here from the Providers page in one change so no capability
 * is ever unmounted. Opens the shared state itself, because a user can land on this tab first.
 * S6 replaces the contents (CLI matrix, policy bar, roles `<details>`).
 */
@Component({
  selector: 'ptah-orchestration-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgentOrchestrationConfigComponent, ProviderConsumerAssignmentsComponent, PtahCliConfigComponent],
  template: `
    <div class="space-y-4 font-sans text-sm text-base-content">
      <ptah-agent-orchestration-config />

      @for (section of readStates(); track section.id) {
        @if (section.state.status === 'error') {
          <div role="alert" class="rounded-md border border-base-content-muted bg-base-100 p-3 space-y-2" [attr.data-read-error]="section.id">
            <p>{{ section.label }} could not be loaded. Your saved settings have not changed.</p>
            <button type="button" [class]="control" (click)="section.retry()">Retry {{ section.label }}</button>
          </div>
        } @else if (section.state.status === 'loading' || section.state.status === 'unloaded') {
          <p role="status" aria-live="polite" [attr.data-read-loading]="section.id">Loading {{ section.label }}…</p>
        }
      }

      <section data-focus="background-models" tabindex="-1" aria-label="Background models" class="scroll-mt-4">
        <ptah-provider-consumer-assignments [disabled]="saving()" [initialEditingConsumerId]="consumerTarget()"
          (setupProviderRequested)="providerSetupRequested.emit($event)" (assignmentSaved)="state.refresh()"
          (timeoutSaved)="state.refreshJudging()" />
      </section>

      <ptah-cli-config />

      @if (state.commit().status !== 'idle') {
        <div role="status" class="rounded-md bg-base-100 p-3 space-y-1 break-words" data-testid="providers-commit-feedback">
          @if (saving()) { <p>Saving…</p> }
          @if (state.commit().saved.length) { <p>Saved: {{ state.commit().saved.join(', ') }}.</p> }
          @if (state.commit().unsaved.length) { <p>Not saved: {{ state.commit().unsaved.join(', ') }}.</p> }
          @if (state.commit().unconfirmed.length) { <p>Save not confirmed: {{ state.commit().unconfirmed.join(', ') }}. Check effective values before retrying.</p> }
          <p>{{ state.commit().message }}</p>
        </div>
      }
    </div>
  `,
})
export class OrchestrationSettingsComponent implements OnInit {
  readonly focusTarget = input<OrchestrationSettingsFocusTarget | null>(null);
  /** A background role asked to set up a provider: the setup wizard lives on the Providers tab. */
  readonly providerSetupRequested = output<string>();
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly control = CONTROL;
  protected readonly saving = computed(() => this.state.commit().status === 'saving');
  protected readonly consumerTarget = computed(() => {
    const target = this.focusTarget();
    return BACKGROUND_CONSUMERS.find((id) => id === target) ?? null;
  });
  protected readonly readStates = computed(() => [
    { id: 'cli', label: 'CLI agents', state: this.state.cliAgents(), retry: () => this.state.refreshCliAgents() },
    { id: 'cli-models', label: 'CLI instance models', state: this.state.cliModels(), retry: () => this.state.refreshCliModels() },
    { id: 'orchestration', label: 'delegated CLI models', state: this.state.orchestration(), retry: () => this.state.refreshOrchestration() },
  ]);
  private focusedTarget: OrchestrationSettingsFocusTarget | null = null;

  constructor() {
    afterRenderEffect(() => {
      const target = this.focusTarget();
      if (!target) { this.focusedTarget = null; return; }
      if (target === this.focusedTarget) return;
      const section = target === 'cli-agents' ? 'cli-agents' : 'background-models';
      const node = this.element.nativeElement.querySelector<HTMLElement>(`[data-focus="${section}"]`);
      if (node) { node.focus(); this.focusedTarget = target; }
    });
  }

  ngOnInit(): void { void this.state.open(); }
}
