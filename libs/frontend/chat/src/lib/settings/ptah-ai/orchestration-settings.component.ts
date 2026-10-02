import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, afterRenderEffect, computed, inject, input, output, viewChild,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { AppStateManager, ProvidersSettingsStateService } from '@ptah-extension/core';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { CliOrchestrationMatrixComponent } from './cli-orchestration-matrix.component';
import { ProviderConsumerAssignmentsComponent } from '../providers/provider-consumer-assignments.component';
import type { BackgroundConsumerId } from '../providers/provider-consumer-rows';

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
 * closed by default (deviation 4: the §1.2 fold budget) and opened by the background-role deep links. The `cli-agents`
 * deep link focuses the matrix table (`[data-testid="cli-matrix"]`); Batch 34 retired the old Ptah CLI instance manager,
 * whose capabilities live in the matrix, its add-instance and tier modals, and its popovers (D14).
 *
 * A deep link is consumed once applied (the section focused and, for a role, its popover open): `focusTargetConsumed`
 * lets Settings clear the target, so the same link raised again while on this tab applies again (Gate V 36, M-1).
 */
@Component({
  selector: 'ptah-orchestration-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule, AgentOrchestrationConfigComponent, CliOrchestrationMatrixComponent, ProviderConsumerAssignmentsComponent,
  ],
  template: `
    <div class="space-y-2.5 font-sans text-sm text-base-content">
      <ptah-agent-orchestration-config />

      <!-- Deferred (own chunk; the eager bundle is at its budget) behind a same-footprint placeholder. -->
      @defer (on immediate) {
        <ptah-cli-orchestration-matrix #cliMatrix />
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
          <!-- Points right (›) closed, down (⌄) open. The turn sits on this wrapper: lucide-angular copies its host class onto
               the inner <svg>, so a rotate class on the icon would apply twice (180°, pointing left). -->
          <span class="inline-flex shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" data-testid="background-roles-chevron">
            <lucide-angular [img]="ChevronIcon" class="block h-3.5 w-3.5 text-info" aria-hidden="true" />
          </span>
          <span class="text-xs font-bold uppercase tracking-wider text-base-content">Background Model Roles</span>
          <span class="badge badge-outline badge-xs whitespace-nowrap border-info/30 bg-info/10 font-medium text-base-content">{{ roleCount }} roles</span>
          <!-- text-base-content: the light theme's rose-tinted muted grey read as coloured words (deviation 6). 12 px helper
               text (Gate V 36, V36-2). -->
          <span class="ml-auto hidden min-w-0 truncate text-xs text-base-content sm:block" data-testid="background-roles-list">Memory curator, archaeologist, synthesis, judge, replay, judging</span>
        </summary>
        <section data-focus="background-models" tabindex="-1" aria-label="Background models" class="scroll-mt-4 border-t border-base-300 p-3">
          <ptah-provider-consumer-assignments [disabled]="saving()" [initialEditingConsumerId]="consumerTarget()"
            (setupProviderRequested)="openProviderSetup($event)" (deepLinkOpened)="onRoleOpened($event)" (assignmentSaved)="state.refresh()"
            (timeoutSaved)="state.refreshJudging()" />
        </section>
      </details>

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
  /** The current `focusTarget` has been applied; the host clears it (Settings' `orchestrationTarget`). */
  readonly focusTargetConsumed = output<void>();
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly appState = inject(AppStateManager);
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
  /**
   * The deferred matrix's host, by template ref: a class query would make the matrix an eager dependency. It resolves
   * once the deferred block renders, which re-runs the focus effect for a `cli-agents` deep link that arrived first.
   */
  private readonly cliMatrix = viewChild<string, ElementRef<HTMLElement>>('cliMatrix', { read: ElementRef });
  private focusedTarget: OrchestrationSettingsFocusTarget | null = null;
  /** The role whose popover the roles table opened for the current deep link. */
  private openedRole: BackgroundConsumerId | null = null;

  constructor() {
    afterRenderEffect(() => {
      const target = this.focusTarget();
      if (!target) { this.focusedTarget = null; this.openedRole = null; return; }
      if (target === this.focusedTarget) return;
      const node = target === 'cli-agents' ? this.matrixTable() : this.openBackgroundRoles();
      if (node) { node.focus(); this.focusedTarget = target; this.consumeWhenApplied(); }
    });
  }

  /** The roles table opened the deep-linked role's popover (it may land before or after the section focus). */
  protected onRoleOpened(id: BackgroundConsumerId): void {
    this.openedRole = id;
    this.consumeWhenApplied();
  }

  /** Done once the section is focused and, for a role, its popover is open; a later normal visit has no target. */
  private consumeWhenApplied(): void {
    const target = this.focusTarget();
    if (!target || this.focusedTarget !== target) return;
    const role = this.consumerTarget();
    if (role !== null && this.openedRole !== role) return;
    this.focusTargetConsumed.emit();
  }

  ngOnInit(): void { void this.state.open(); }

  /**
   * A background role asked to set up a provider (plan :772-774): the existing deep-link path switches Settings to
   * Providers and opens the setup wizard for that provider.
   */
  protected openProviderSetup(providerId: string): void {
    this.appState.requestSettingsTab({ tab: 'providers', providerId });
  }

  /** The matrix table; null until the deferred matrix has rendered. */
  private matrixTable(): HTMLElement | null {
    return this.cliMatrix()?.nativeElement.querySelector<HTMLElement>('[data-testid="cli-matrix"]') ?? null;
  }

  /** A background-role deep link opens the roles before focusing them (a closed <details> hides its content). */
  private openBackgroundRoles(): HTMLElement | null {
    const host = this.element.nativeElement;
    const details = host.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]');
    if (details) details.open = true;
    return host.querySelector<HTMLElement>('[data-focus="background-models"]');
  }
}
