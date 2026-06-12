import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
  ChevronDown,
  LucideAngularModule,
  MessagesSquare,
  RadioTower,
  Sparkles,
  type LucideIconData,
} from 'lucide-angular';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { ThothStatusCardComponent } from '@ptah-extension/dashboard';
import { MemoryCuratorTabComponent } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisTabComponent } from '@ptah-extension/skill-synthesis-ui';
import { CronSchedulerTabComponent } from '@ptah-extension/cron-scheduler-ui';
import { MessagingGatewayTabComponent } from '@ptah-extension/messaging-gateway-ui';

/** Tab identifiers for the Thoth hub. */
export type ThothActiveTabId = 'memory' | 'skills' | 'cron' | 'gateway';

interface ThothTabSpec {
  readonly id: ThothActiveTabId;
  readonly label: string;
  readonly icon: LucideIconData;
  /** When true, this tab requires the Electron desktop platform. */
  readonly electronOnly: boolean;
}

/**
 * ThothShellComponent — the standalone Thoth page hosting the agentic
 * platform features (Memory, Skills, Schedules, Messaging). Renders a left
 * navigation rail on wide layouts that collapses to a horizontal strip on
 * narrow ones (VS Code sidebar). Tab switching is signal-based and persists
 * across navigations via {@link AppStateManager.thothActiveTab}.
 */
@Component({
  selector: 'ptah-thoth-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucideAngularModule,
    ThothStatusCardComponent,
    MemoryCuratorTabComponent,
    SkillSynthesisTabComponent,
    CronSchedulerTabComponent,
    MessagingGatewayTabComponent,
  ],
  template: `
    <div class="flex h-full w-full flex-col bg-base-100 lg:flex-row">
      <aside
        class="flex shrink-0 flex-col border-b border-base-300 bg-base-200/40 lg:w-56 lg:border-b-0 lg:border-r"
      >
        <div class="flex items-center gap-2 px-3 pb-3 pt-4 lg:px-4">
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Back to chat"
            (click)="goBack()"
          >
            <lucide-angular
              [img]="ArrowLeftIcon"
              class="size-4"
              aria-hidden="true"
            />
          </button>
          <lucide-angular
            [img]="RadioTowerIcon"
            class="size-4 text-secondary"
            aria-hidden="true"
          />
          <div class="leading-tight">
            <h1 class="text-sm font-semibold text-base-content">Thoth</h1>
            <p class="text-[11px] text-base-content/50">Agentic platform</p>
          </div>
        </div>

        <nav
          role="tablist"
          aria-label="Thoth feature tabs"
          class="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-4"
        >
          @for (tab of visibleTabs(); track tab.id) {
            <button
              type="button"
              role="tab"
              class="flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150"
              [class.bg-base-300/70]="activeTab() === tab.id"
              [class.font-medium]="activeTab() === tab.id"
              [class.text-base-content]="activeTab() === tab.id"
              [class.text-base-content/65]="activeTab() !== tab.id"
              [class.hover:bg-base-300/40]="activeTab() !== tab.id"
              [class.hover:text-base-content]="activeTab() !== tab.id"
              [attr.aria-selected]="activeTab() === tab.id"
              [attr.aria-controls]="'thoth-panel-' + tab.id"
              [id]="'thoth-tab-' + tab.id"
              (click)="selectTab(tab.id)"
            >
              <lucide-angular
                [img]="tab.icon"
                class="size-4 shrink-0"
                [class.text-secondary]="activeTab() === tab.id"
                [class.text-base-content/40]="activeTab() !== tab.id"
                aria-hidden="true"
              />
              {{ tab.label }}
            </button>
          }
        </nav>
      </aside>

      <section
        class="flex-1 overflow-y-auto"
        role="tabpanel"
        [id]="'thoth-panel-' + activeTab()"
        [attr.aria-labelledby]="'thoth-tab-' + activeTab()"
      >
        <div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div class="mb-6">
            <button
              type="button"
              class="mb-2 flex items-center gap-1.5 text-xs font-medium text-base-content/60 transition-colors hover:text-base-content"
              [attr.aria-expanded]="statusExpanded()"
              aria-controls="thoth-status-region"
              (click)="toggleStatus()"
            >
              <lucide-angular
                [img]="ChevronDownIcon"
                class="size-3.5 transition-transform duration-150"
                [class.-rotate-90]="!statusExpanded()"
                aria-hidden="true"
              />
              Status
            </button>
            @if (statusExpanded()) {
              <div id="thoth-status-region">
                <ptah-thoth-status-card class="block" />
              </div>
            }
          </div>

          @switch (activeTab()) {
            @case ('memory') {
              <ptah-memory-curator-tab />
            }
            @case ('skills') {
              <ptah-skill-synthesis-tab />
            }
            @case ('cron') {
              <ptah-cron-scheduler-tab />
            }
            @case ('gateway') {
              <ptah-messaging-gateway-tab />
            }
          }
        </div>
      </section>
    </div>
  `,
})
export class ThothShellComponent {
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);

  protected readonly RadioTowerIcon = RadioTower;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ChevronDownIcon = ChevronDown;

  /** Whether the pillar status row is expanded. Defaults to open. */
  protected readonly statusExpanded = signal(true);

  /** Toggle the pillar status row open/closed. */
  protected toggleStatus(): void {
    this.statusExpanded.update((open) => !open);
  }

  /**
   * All four tabs and their platform requirements. Memory and Skill-Synthesis
   * depend on better-sqlite3 (native) + the embedder-worker, so they are
   * Electron-only alongside Cron and Gateway. Each tab component owns its own
   * desktop-only placeholder, mirroring the cron/gateway pattern.
   */
  protected readonly tabs: readonly ThothTabSpec[] = [
    { id: 'memory', label: 'Memory', icon: Brain, electronOnly: true },
    { id: 'skills', label: 'Skills', icon: Sparkles, electronOnly: true },
    { id: 'cron', label: 'Schedules', icon: CalendarClock, electronOnly: true },
    {
      id: 'gateway',
      label: 'Messaging',
      icon: MessagesSquare,
      electronOnly: true,
    },
  ];

  /** Whether the webview is running inside the Electron desktop app. */
  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  /**
   * Tabs visible in the current platform. Cron and Gateway tabs render in
   * both VS Code and Electron, but show a placeholder when not on Electron.
   * Keeping them visible (rather than hiding) preserves a stable tab order.
   */
  public readonly visibleTabs = computed(() => this.tabs);

  /** Active tab signal sourced from {@link AppStateManager.thothActiveTab}. */
  public readonly activeTab = this.appState.thothActiveTab;

  /** Switch to a different tab. */
  public selectTab(tabId: ThothActiveTabId): void {
    this.appState.setThothActiveTab(tabId);
  }

  /** Leave Thoth and return to the chat view. */
  public goBack(): void {
    this.appState.setCurrentView('chat');
  }
}
