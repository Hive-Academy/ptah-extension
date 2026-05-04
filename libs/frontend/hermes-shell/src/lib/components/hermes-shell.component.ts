import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, RadioTower } from 'lucide-angular';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MemoryCuratorTabComponent } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisTabComponent } from '@ptah-extension/skill-synthesis-ui';
import { CronSchedulerTabComponent } from '@ptah-extension/cron-scheduler-ui';
import { MessagingGatewayTabComponent } from '@ptah-extension/messaging-gateway-ui';

/** Tab identifiers for the Hermes hub. */
export type HermesActiveTabId = 'memory' | 'skills' | 'cron' | 'gateway';

interface HermesTabSpec {
  readonly id: HermesActiveTabId;
  readonly label: string;
  /** When true, this tab requires the Electron desktop platform. */
  readonly electronOnly: boolean;
}

/**
 * HermesShellComponent — the four-tab hub for the agentic platform features
 * (Memory, Skills, Schedules, Messaging). Tab switching is signal-based and
 * persists across navigations via {@link AppStateManager.hermesActiveTab}.
 *
 * Cron and Gateway tabs are Electron-only. When running inside the VS Code
 * webview, they render an "Open in Ptah desktop app" placeholder. The actual
 * tab content components are wired in batches B1–B4.
 */
@Component({
  selector: 'ptah-hermes-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucideAngularModule,
    MemoryCuratorTabComponent,
    SkillSynthesisTabComponent,
    CronSchedulerTabComponent,
    MessagingGatewayTabComponent,
  ],
  template: `
    <div class="flex h-full w-full flex-col bg-base-100">
      <header
        class="flex items-center gap-2 border-b border-base-300 px-4 py-3"
      >
        <lucide-angular [img]="RadioTowerIcon" class="h-5 w-5 text-primary" />
        <h1 class="text-base font-semibold text-base-content">Hermes</h1>
        <span class="text-xs text-base-content/60">
          Memory · Skills · Schedules · Messaging
        </span>
      </header>

      <div
        role="tablist"
        aria-label="Hermes feature tabs"
        class="tabs tabs-bordered px-4 pt-2"
      >
        @for (tab of visibleTabs(); track tab.id) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab-active]="activeTab() === tab.id"
            [attr.aria-selected]="activeTab() === tab.id"
            [attr.aria-controls]="'hermes-panel-' + tab.id"
            [id]="'hermes-tab-' + tab.id"
            (click)="selectTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        }
      </div>

      <section
        class="flex-1 overflow-auto p-4"
        role="tabpanel"
        [id]="'hermes-panel-' + activeTab()"
        [attr.aria-labelledby]="'hermes-tab-' + activeTab()"
      >
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
      </section>
    </div>
  `,
})
export class HermesShellComponent {
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);

  protected readonly RadioTowerIcon = RadioTower;

  /** All four tabs and their platform requirements. */
  protected readonly tabs: readonly HermesTabSpec[] = [
    { id: 'memory', label: 'Memory', electronOnly: false },
    { id: 'skills', label: 'Skills', electronOnly: false },
    { id: 'cron', label: 'Schedules', electronOnly: true },
    { id: 'gateway', label: 'Messaging', electronOnly: true },
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

  /** Active tab signal sourced from {@link AppStateManager.hermesActiveTab}. */
  public readonly activeTab = this.appState.hermesActiveTab;

  /** Switch to a different tab. */
  public selectTab(tabId: HermesActiveTabId): void {
    this.appState.setHermesActiveTab(tabId);
  }
}
