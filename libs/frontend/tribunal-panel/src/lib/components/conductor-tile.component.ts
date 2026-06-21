import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  OnDestroy,
  OnInit,
  computed,
  createEnvironmentInjector,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  LucideAngularModule,
  Gavel,
  Maximize2,
  Minimize2,
} from 'lucide-angular';
import { ChatViewComponent, SESSION_CONTEXT } from '@ptah-extension/chat';
import {
  SessionLivenessRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { EffortStateService, ModelStateService } from '@ptah-extension/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TribunalStateService } from '../services/tribunal-state.service';

@Component({
  selector: 'ptah-conductor-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, LucideAngularModule],
  template: `
    <section
      class="flex h-full min-h-0 w-full flex-col bg-base-200/40"
      data-testid="tribunal-conductor-column"
      aria-label="Tribunal conductor"
    >
      <header
        class="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-3"
      >
        <lucide-angular
          [img]="GavelIcon"
          class="h-4 w-4 text-primary"
          aria-hidden="true"
        />
        <span class="text-sm font-semibold text-base-content">Conductor</span>
        @if (agentCount() > 0) {
          <span
            class="flex items-center gap-1 rounded-full bg-base-200/60 px-1.5 py-0.5 text-[10px] font-medium"
            [class.text-info]="hasRunningAgents()"
            [class.text-base-content/50]="!hasRunningAgents()"
            [attr.title]="agentSummary()"
            data-testid="tribunal-conductor-agent-badge"
          >
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              [class.bg-info]="hasRunningAgents()"
              [class.animate-pulse]="hasRunningAgents()"
              [class.bg-base-content/40]="!hasRunningAgents()"
            ></span>
            <span>{{ agentCount() }}</span>
          </span>
        }
        <span
          class="ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-base-content/60"
        >
          <span
            class="h-2 w-2 rounded-full"
            [class.bg-info]="isStreaming()"
            [class.animate-pulse]="isStreaming()"
            [class.bg-base-content]="!isStreaming()"
            [class.opacity-40]="!isStreaming()"
            aria-hidden="true"
          ></span>
          {{ isStreaming() ? 'Running' : 'Idle' }}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square text-base-content/60"
          [title]="
            isCompactMode() ? 'Switch to full view' : 'Switch to compact view'
          "
          [attr.aria-label]="
            isCompactMode() ? 'Switch to full view' : 'Switch to compact view'
          "
          data-testid="tribunal-conductor-view-toggle"
          (click)="onToggleViewMode()"
        >
          <lucide-angular
            [img]="isCompactMode() ? MaximizeIcon : MinimizeIcon"
            class="h-3 w-3"
          />
        </button>
      </header>

      @if (childInjector(); as injector) {
        <div class="min-h-0 flex-1 overflow-hidden">
          <ng-container
            [ngComponentOutlet]="chatViewComponent"
            [ngComponentOutletInjector]="injector"
          />
        </div>
      } @else {
        <p
          class="px-3 py-3 text-xs text-base-content/50"
          data-testid="tribunal-conductor-empty"
        >
          Waiting for the conductor to convene the panel…
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class ConductorTileComponent implements OnInit, OnDestroy {
  private readonly tribunalState = inject(TribunalStateService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly tabManager = inject(TabManagerService);
  private readonly effortState = inject(EffortStateService);
  private readonly modelState = inject(ModelStateService);
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly parentEnvInjector = inject(EnvironmentInjector);

  protected readonly GavelIcon = Gavel;
  protected readonly MinimizeIcon = Minimize2;
  protected readonly MaximizeIcon = Maximize2;
  protected readonly chatViewComponent = ChatViewComponent;

  private readonly _childInjector = signal<EnvironmentInjector | null>(null);
  protected readonly childInjector = this._childInjector.asReadonly();

  protected readonly isStreaming = computed(() => {
    const sessionId = this.tribunalState.tribunalSessionId();
    if (!sessionId) return false;
    return this.liveness.statuses().get(sessionId) === 'streaming';
  });

  private readonly conductorAgents = computed(() => {
    const sessionId = this.tribunalState.tribunalSessionId();
    if (!sessionId) return [];
    return this.agentMonitor.agentsForSession(sessionId);
  });

  protected readonly agentCount = computed(() => this.conductorAgents().length);

  protected readonly hasRunningAgents = computed(() =>
    this.conductorAgents().some((a) => a.status === 'running'),
  );

  protected readonly agentSummary = computed(() => {
    const count = this.agentCount();
    const running = this.conductorAgents().filter(
      (a) => a.status === 'running',
    ).length;
    let summary = `${count} panelist${count !== 1 ? 's' : ''}`;
    if (running > 0) summary += `, ${running} running`;
    return summary;
  });

  protected readonly isCompactMode = computed(() => {
    const tabId = this.tribunalState.correlationId();
    return tabId ? this.tabManager.getTabViewMode(tabId) === 'compact' : false;
  });

  private readonly _freezeEffort = effect(() => {
    if (!this.effortState.isLoaded()) return;
    untracked(() => {
      const id = this.tribunalState.correlationId();
      if (!id) return;
      const tab = this.tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideEffort === undefined) {
        this.tabManager.setOverrideEffort(
          id,
          this.effortState.currentEffort() ?? null,
        );
      }
    });
  });

  private readonly _freezeModel = effect(() => {
    if (!this.modelState.isLoaded()) return;
    untracked(() => {
      const id = this.tribunalState.correlationId();
      if (!id) return;
      const tab = this.tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideModel === undefined) {
        const current = this.modelState.currentModel();
        if (current) {
          this.tabManager.setOverrideModel(id, current);
        }
      }
    });
  });

  ngOnInit(): void {
    const tabIdSignal = computed<string | null>(() =>
      this.tribunalState.correlationId(),
    );

    this._childInjector.set(
      createEnvironmentInjector(
        [{ provide: SESSION_CONTEXT, useValue: tabIdSignal }],
        this.parentEnvInjector,
      ),
    );

    const tabId = this.tribunalState.correlationId();
    if (tabId) {
      this.tabManager.registerVisibleTab(tabId);
    }
  }

  ngOnDestroy(): void {
    const tabId = this.tribunalState.correlationId();
    if (tabId) {
      this.tabManager.unregisterVisibleTab(tabId);
    }
    this.childInjector()?.destroy();
  }

  protected onToggleViewMode(): void {
    const tabId = this.tribunalState.correlationId();
    if (tabId) {
      this.tabManager.toggleTabViewMode(tabId);
    }
  }
}
