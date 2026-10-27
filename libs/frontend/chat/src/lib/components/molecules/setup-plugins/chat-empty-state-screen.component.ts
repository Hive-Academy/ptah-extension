import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import {
  PlanRingComponent,
  PromptLaunchersComponent,
  ReadinessRingComponent,
  SpendBarsComponent,
  StatCellComponent,
  StatRowComponent,
  StatValueComponent,
  buildLaunchers,
  planRingCaption,
  type ReadinessCheck,
} from '@ptah-extension/chat-ui/vitals';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  CircleDollarSign,
  Cpu,
  Gauge,
  History,
  LucideAngularModule,
} from 'lucide-angular';
import { ChatVitalsStore } from '../../../services/vitals/chat-vitals.store';
import { formatUsd } from '../../../services/vitals/usage-vitals.model';

@Component({
  selector: 'ptah-chat-empty-state-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    PlanRingComponent,
    PromptLaunchersComponent,
    ReadinessRingComponent,
    SpendBarsComponent,
    StatCellComponent,
    StatRowComponent,
    StatValueComponent,
  ],
  providers: [ChatVitalsStore],
  styleUrl: './chat-empty-state.component.css',
  template: `
    <section class="empty-chat" aria-label="New conversation">
      <div class="empty-chat__stage">
        <img
          [src]="ptahIconUri"
          alt=""
          aria-hidden="true"
          width="48"
          height="48"
        />
        <h1>Orchestrator ready</h1>
        <ptah-stat-row density="compact">
          <ptah-stat-cell
            label="Context"
            [icon]="contextIcon"
            [state]="contextPercent() === null ? 'empty' : 'ready'"
            [caption]="contextCaption()"
          >
            <ptah-stat-value
              size="md"
              [text]="contextPercent() === null ? '—' : contextPercent() + '%'"
            >
              <span class="empty-chat__meter" aria-hidden="true"
                ><i [style.width.%]="contextPercent() ?? 0"></i
              ></span>
            </ptah-stat-value>
          </ptah-stat-cell>
          <ptah-stat-cell
            label="Plan"
            [icon]="planIcon"
            [state]="vitals.planRing().status"
            [caption]="planCaption()"
          >
            <ptah-plan-ring [ring]="plan()" />
          </ptah-stat-cell>
          <ptah-stat-cell
            label="Spend 7d"
            [icon]="spendIcon"
            [state]="spend().state"
            caption="last 7 days"
          >
            <ptah-stat-value size="md" [text]="spend().text">
              <ptah-spend-bars
                [values]="spend().bars"
                ariaLabel="Spend over the last seven days"
              />
            </ptah-stat-value>
          </ptah-stat-cell>
        </ptah-stat-row>
        <ptah-prompt-launchers
          [launchers]="launchers"
          (launch)="promptSelected.emit($event)"
        />
        @if (isElectron && vitals.resume(); as session) {
          <button
            class="empty-chat__resume"
            type="button"
            (click)="resumeRequested.emit(session.id)"
          >
            <lucide-angular
              [img]="historyIcon"
              [size]="17"
              aria-hidden="true"
            />
            <span
              >Resume
              <strong>{{ session.name || 'Previous session' }}</strong></span
            >
          </button>
        }
        @if (showReadiness() && !setup.allReady()) {
          <ptah-readiness-ring
            [checks]="checks()"
            [action]="readinessAction()"
            (actionRequested)="runReadinessAction($event)"
          />
          @if (setup.error() || setup.scanError()) {
            <div role="status" class="empty-chat__notice">
              Readiness unavailable
              <button type="button" (click)="setup.retry()">Retry</button>
            </div>
          }
          @if (setup.launchError()) {
            <p role="alert" class="empty-chat__notice">
              Could not start setup. Please try again.
            </p>
          }
        }
      </div>
    </section>
  `,
})
export class ChatEmptyStateViewComponent {
  private readonly tabs = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  protected readonly vitals = inject(ChatVitalsStore);
  protected readonly setup = inject(SetupStatusStore);
  private readonly vscodeService = inject(VSCodeService);
  protected readonly isElectron = this.vscodeService.isElectron;
  protected readonly ptahIconUri = this.vscodeService.getPtahIconUri();
  readonly tabId = input<string | null>(null);
  readonly showReadiness = input(false);
  readonly promptSelected = output<string>();
  readonly resumeRequested = output<string>();
  protected readonly contextIcon = Cpu;
  protected readonly planIcon = Gauge;
  protected readonly spendIcon = CircleDollarSign;
  protected readonly historyIcon = History;
  protected readonly launchers = buildLaunchers();
  private readonly tab = computed(() => {
    const id = this.tabId();
    return id === null
      ? null
      : (this.tabs.findTabByIdAcrossWorkspaces(id)?.tab ?? null);
  });
  protected readonly contextPercent = computed(() => {
    const context = this.vitals.context();
    const percent = context?.percent;
    return context?.known &&
      percent !== null &&
      percent !== undefined &&
      Number.isFinite(percent)
      ? Math.round(Math.max(0, Math.min(100, percent)))
      : null;
  });
  protected readonly contextCaption = computed(
    () => this.vitals.model() ?? 'Model unavailable',
  );
  protected readonly plan = computed(() => {
    const load = this.vitals.planRing();
    return load.status === 'ready' ? load.value : null;
  });
  protected readonly planCaption = computed(() => {
    const plan = this.plan();
    return plan ? planRingCaption(plan) : 'no plan window';
  });
  protected readonly spend = computed(() => {
    const load = this.vitals.spend7();
    if (load.status === 'empty')
      return {
        state: 'ready' as const,
        text: formatUsd(0),
        bars: [0, 0, 0, 0, 0, 0, 0],
      };
    if (load.status !== 'ready')
      return { state: load.status, text: '', bars: [] };
    const cost = load.value.totals.costUsd;
    return cost === null
      ? { state: 'empty' as const, text: '', bars: [] }
      : {
          state: 'ready' as const,
          text: formatUsd(cost),
          bars: load.value.days,
        };
  });
  protected readonly checks = computed<readonly ReadinessCheck[]>(() => [
    { id: 'skills', label: 'Skills', ready: this.setup.skillsReady() },
    { id: 'scan', label: 'Project scan', ready: this.setup.scanReady() },
    { id: 'agents', label: 'Agents', ready: this.setup.agentsReady() },
  ]);
  protected readonly readinessAction = computed(() => {
    const id = this.setup.nextAction();
    if (id === null) return null;
    const labels = {
      'open-library': 'Enable skills',
      'run-setup': 'Set up workspace',
      'generate-agents': 'Generate agents',
    };
    return { id, label: labels[id] };
  });

  constructor() {
    this.vitals.bind({
      tab: this.tab,
      sessionId: () => this.tab()?.claudeSessionId ?? null,
      workspacePath: () => {
        const id = this.tabId();
        return id === null
          ? (this.tabs.activeWorkspacePath ?? null)
          : (this.tabs.findTabByIdAcrossWorkspaces(id)?.workspacePath ?? null);
      },
    });
  }

  protected async runReadinessAction(id: string): Promise<void> {
    if (id === 'open-library')
      this.appState.openMarketplace({ page: 'skills', source: 'ptah-plugins' });
    else if (id === 'run-setup') await this.setup.launchWizard();
    else if (id === 'generate-agents')
      await this.setup.launchGeneration('setup-agent-generation');
  }
}
