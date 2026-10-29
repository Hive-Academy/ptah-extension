import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import {
  AppStateManager,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { CliOrchestrationMatrixComponent } from '../ptah-ai/cli-orchestration-matrix.component';
import { ProviderConsumerAssignmentsComponent } from './provider-consumer-assignments.component';
import {
  BACKGROUND_ROLE_IDS,
  PROVIDER_CONSUMER_IDS,
  type ProviderConsumerId,
} from './provider-consumer-rows';

/**
 * Deep-link sections this part of the Providers tab owns. The Decision model row has no deep link (core's
 * `PendingSettingsTab.section` names none); `background-models` reaches it.
 */
export type AgentsRoutingFocusTarget =
  'background-models' | 'cli-agents' | ProviderConsumerId;

const CONTROL =
  'btn btn-outline btn-sm border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Agents routing on the Providers tab, below the Main agent and Connections sections: the CLI matrix (with the read
 * states of its three sources), then the background model roles in a `<details>` that is closed by default and
 * opened by the background-role deep links. The `cli-agents` deep link focuses the matrix table
 * (`[data-testid="cli-matrix"]`).
 *
 * The Providers page beside it opens the shared state, so this component does not (`open()` re-reads every
 * section). Save outcomes for the matrix and the roles show in the Settings page toast
 * (`SettingsSaveFeedbackService`), like every other save on the page.
 *
 * A deep link is consumed once applied (the section focused and, for a role, its popover open): `focusTargetConsumed`
 * lets Settings clear the target, so the same link raised again while on this tab applies again (Gate V 36, M-1).
 */
@Component({
  selector: 'ptah-agents-routing-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    CliOrchestrationMatrixComponent,
    ProviderConsumerAssignmentsComponent,
  ],
  template: `
    <div class="flex flex-col gap-8 font-sans text-sm text-base-content">
      <!-- Deferred (own chunk; the eager bundle is at its budget) behind a same-footprint placeholder. -->
      @defer (on immediate) {
        <ptah-cli-orchestration-matrix #cliMatrix />
      } @placeholder {
        <div
          class="min-h-[22rem] border-b border-base-content/10"
          aria-busy="true"
          data-testid="cli-matrix-placeholder"
        ></div>
      }

      @for (section of readStates(); track section.id) {
        @if (section.state.status === 'error') {
          <div
            role="alert"
            class="rounded-lg border border-base-content/10 p-4 space-y-2"
            [attr.data-read-error]="section.id"
          >
            <p>
              {{ section.label }} could not be loaded. Your saved settings have
              not changed.
            </p>
            <button type="button" [class]="control" (click)="section.retry()">
              Retry {{ section.label }}
            </button>
          </div>
        } @else if (
          section.state.status === 'loading' ||
          section.state.status === 'unloaded'
        ) {
          <p
            role="status"
            aria-live="polite"
            [attr.data-read-loading]="section.id"
          >
            Loading {{ section.label }}…
          </p>
        }
      }

      <!-- Closed by default; the background-role deep links open it (focusTarget). -->
      <section class="border-t border-base-content/10 pt-6">
        <details class="group" data-testid="background-roles-details">
          <summary
            [class]="
              'flex cursor-pointer list-none items-center gap-2 scroll-mt-2 rounded-lg py-1 select-none [&::-webkit-details-marker]:hidden ' +
              focusRing
            "
            data-testid="background-roles-summary"
          >
            <!-- Points right (›) closed, down (⌄) open. The turn sits on this wrapper: lucide-angular copies its host class onto
               the inner <svg>, so a rotate class on the icon would apply twice (180°, pointing left). -->
            <span
              class="inline-flex shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
              data-testid="background-roles-chevron"
            >
              <lucide-angular
                [img]="ChevronIcon"
                class="block h-4 w-4 text-info"
                aria-hidden="true"
              />
            </span>
            <span
              class="text-sm font-semibold text-base-content"
              >Background Model Roles</span
            >
            <span
              class="badge badge-outline badge-sm whitespace-nowrap border-info/30 bg-info/10 text-xs font-medium text-base-content"
              >{{ roleCount }} roles</span
            >
            <!-- Secondary helper text uses the theme's contrast-tested muted-content token. -->
            <span
              class="ml-auto hidden min-w-0 truncate text-xs text-base-content-muted sm:block"
              data-testid="background-roles-list"
              >Memory curator, enhancement, decision</span
            >
          </summary>
          <section
            data-focus="background-models"
            tabindex="-1"
            aria-label="Background models"
            class="mt-2 scroll-mt-4 border-t border-base-content/10 pt-2"
          >
            <ptah-provider-consumer-assignments
              [disabled]="saving()"
              [initialEditingConsumerId]="consumerTarget()"
              (setupProviderRequested)="openProviderSetup($event)"
              (deepLinkOpened)="onRoleOpened($event)"
              (assignmentSaved)="state.refresh()"
              (timeoutSaved)="state.refreshEnhancement()"
            />
          </section>
        </details>
      </section>
    </div>
  `,
})
export class AgentsRoutingSettingsComponent {
  readonly focusTarget = input<AgentsRoutingFocusTarget | null>(null);
  /** The current `focusTarget` has been applied; the host clears it (Settings' `agentsRoutingTarget`). */
  readonly focusTargetConsumed = output<void>();
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly appState = inject(AppStateManager);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly control = CONTROL;
  protected readonly focusRing = FOCUS;
  protected readonly ChevronIcon = ChevronRight;
  protected readonly roleCount = BACKGROUND_ROLE_IDS.length;
  protected readonly saving = computed(
    () => this.state.commit().status === 'saving',
  );
  protected readonly consumerTarget = computed<ProviderConsumerId | null>(
    () => {
      const target = this.focusTarget();
      return PROVIDER_CONSUMER_IDS.find((id) => id === target) ?? null;
    },
  );
  protected readonly readStates = computed(() => [
    {
      id: 'cli',
      label: 'CLI agents',
      state: this.state.cliAgents(),
      retry: () => this.state.refreshCliAgents(),
    },
    {
      id: 'cli-models',
      label: 'CLI instance models',
      state: this.state.cliModels(),
      retry: () => this.state.refreshCliModels(),
    },
    {
      id: 'orchestration',
      label: 'delegated CLI models',
      state: this.state.orchestration(),
      retry: () => this.state.refreshOrchestration(),
    },
  ]);
  /**
   * The deferred matrix's host, by template ref: a class query would make the matrix an eager dependency. It resolves
   * once the deferred block renders, which re-runs the focus effect for a `cli-agents` deep link that arrived first.
   */
  private readonly cliMatrix = viewChild<string, ElementRef<HTMLElement>>(
    'cliMatrix',
    { read: ElementRef },
  );
  private focusedTarget: AgentsRoutingFocusTarget | null = null;
  /** The role whose popover the roles table opened for the current deep link. */
  private openedRole: ProviderConsumerId | null = null;

  constructor() {
    afterRenderEffect(() => {
      const target = this.focusTarget();
      if (!target) {
        this.focusedTarget = null;
        this.openedRole = null;
        return;
      }
      if (target === this.focusedTarget) return;
      const node =
        target === 'cli-agents'
          ? this.matrixTable()
          : this.openBackgroundRoles();
      if (node) {
        node.focus();
        this.focusedTarget = target;
        this.consumeWhenApplied();
      }
    });
  }

  /** The roles table opened the deep-linked role's popover (it may land before or after the section focus). */
  protected onRoleOpened(id: ProviderConsumerId): void {
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

  /**
   * A background role asked to set up a provider: the existing deep-link path opens the setup wizard for that
   * provider on this same Providers tab.
   */
  protected openProviderSetup(providerId: string): void {
    this.appState.requestSettingsTab({ tab: 'providers', providerId });
  }

  /** The matrix table; null until the deferred matrix has rendered. */
  private matrixTable(): HTMLElement | null {
    return (
      this.cliMatrix()?.nativeElement.querySelector<HTMLElement>(
        '[data-testid="cli-matrix"]',
      ) ?? null
    );
  }

  /** A background-role deep link opens the roles before focusing them (a closed <details> hides its content). */
  private openBackgroundRoles(): HTMLElement | null {
    const host = this.element.nativeElement;
    const details = host.querySelector<HTMLDetailsElement>(
      '[data-testid="background-roles-details"]',
    );
    if (details) details.open = true;
    return host.querySelector<HTMLElement>('[data-focus="background-models"]');
  }
}
