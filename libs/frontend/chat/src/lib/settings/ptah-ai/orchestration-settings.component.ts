import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, afterRenderEffect, computed, inject, input, output,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { CliOrchestrationMatrixComponent } from './cli-orchestration-matrix.component';
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
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Agent Orchestration tab (TASK_2026_555, plan :695-701, design-spec §1.2). Opens the shared state itself, because a
 * user can land on this tab first.
 *
 * Order: the policy bar (Batch 33), the CLI matrix (Batch 30), then the background roles in a `<details>` that is
 * closed by default (deviation 4: the §1.2 fold budget) and opened by the background-role deep links. The old Ptah CLI
 * instance manager stays below until Batch 34 retires it (D14).
 */
@Component({
  selector: 'ptah-orchestration-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule, AgentOrchestrationConfigComponent, CliOrchestrationMatrixComponent, ProviderConsumerAssignmentsComponent,
    PtahCliConfigComponent,
  ],
  template: `
    <div class="space-y-2.5 font-sans text-sm text-base-content">
      <ptah-agent-orchestration-config />

      <!-- Deferred (own chunk; the eager bundle is at its budget) behind a same-footprint placeholder. -->
      @defer (on immediate) {
        <ptah-cli-orchestration-matrix />
      } @placeholder {
        <div class="min-h-[22rem] rounded-xl border border-base-300 bg-base-200/40" aria-busy="true" data-testid="cli-matrix-placeholder"></div>
      }

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

      <!-- Deviation 4: closed by default; the background-role deep links open it (focusTarget). -->
      <details class="group rounded-xl border border-base-300 bg-base-200" data-testid="background-roles-details">
        <summary [class]="'flex cursor-pointer list-none items-center gap-2 scroll-mt-2 rounded-xl px-3 py-2 select-none [&::-webkit-details-marker]:hidden ' + focusRing"
          data-testid="background-roles-summary">
          <lucide-angular [img]="ChevronIcon" class="block h-3.5 w-3.5 shrink-0 text-info transition-transform group-open:rotate-90" aria-hidden="true" />
          <span class="text-xs font-bold uppercase tracking-wider text-base-content">Background Model Roles</span>
          <span class="badge badge-outline badge-xs whitespace-nowrap border-info/30 bg-info/10 font-medium text-base-content">{{ roleCount }} roles</span>
          <span class="ml-auto hidden min-w-0 truncate text-[10px] text-base-content-muted sm:block">Memory curator, archaeologist, synthesis, judge, replay, judging</span>
        </summary>
        <section data-focus="background-models" tabindex="-1" aria-label="Background models" class="scroll-mt-4 border-t border-base-300 p-3">
          <ptah-provider-consumer-assignments [disabled]="saving()" [initialEditingConsumerId]="consumerTarget()"
            (setupProviderRequested)="providerSetupRequested.emit($event)" (assignmentSaved)="state.refresh()"
            (timeoutSaved)="state.refreshJudging()" />
        </section>
      </details>

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
  protected readonly focusRing = FOCUS;
  protected readonly ChevronIcon = ChevronRight;
  protected readonly roleCount = BACKGROUND_CONSUMERS.length;
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
      const host = this.element.nativeElement;
      if (target !== 'cli-agents') {
        // A background-role deep link opens the roles before focusing them (a closed <details> hides its content).
        const details = host.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]');
        if (details) details.open = true;
      }
      const section = target === 'cli-agents' ? 'cli-agents' : 'background-models';
      const node = host.querySelector<HTMLElement>(`[data-focus="${section}"]`);
      if (node) { node.focus(); this.focusedTarget = target; }
    });
  }

  ngOnInit(): void { void this.state.open(); }
}
