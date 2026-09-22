import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  OnInit,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Sparkles,
  Key,
  Cpu,
  Download,
  Upload,
  ArrowLeftRight,
  Globe,
} from 'lucide-angular';
import { ProvidersSettingsComponent, type ProvidersSettingsFocusTarget } from './providers/providers-settings.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { WorkflowsConfigComponent } from './pro-features/workflows-config.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';
import { AgentOrchestrationConfigComponent } from './ptah-ai/agent-orchestration-config.component';
import { WebSearchConfigComponent } from './ptah-ai/web-search-config.component';
import { VoiceConfigComponent } from './ptah-ai/voice-config.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
  VSCodeService,
} from '@ptah-extension/core';

/**
 * SettingsComponent - Main settings page container
 *
 * Complexity Level: 2 (Container with visibility logic based on auth status)
 * Patterns: conditional rendering
 *
 * Reached as the `settings` ROUTE (`apps/ptah-extension-webview/src/app/app.routes.ts`),
 * eagerly rather than lazily: `initialView: 'settings'` is startup-reachable
 * and the boot auth check navigates here when no credential is configured.
 * Its own "back" button goes through `AppStateManager.setCurrentView('chat')`,
 * which is a Router navigation (TASK_2026_524 batch 1 — the old
 * "signal-based navigation" this comment described is gone).
 *
 * Responsibilities:
 * - Display settings page header with back navigation
 * - Container for settings sections (authentication, model selection, autopilot)
 * - Navigate back to chat view on back button click
 * - Conditional visibility: Show additional sections only after auth configured
 *
 * Child Components:
 * - LicenseStatusCardComponent: Membership status, user profile, actions
 * - EnhancedPromptsConfigComponent: System prompt mode, preview, regenerate
 * - AgentOrchestrationConfigComponent: CLI detection, model selectors, concurrency
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [
    ProvidersSettingsComponent,
    LicenseStatusCardComponent,
    EnhancedPromptsConfigComponent,
    VscodeLmConfigComponent,
    McpPortConfigComponent,
    WorkflowsConfigComponent,
    OutputStyleConfigComponent,
    AgentOrchestrationConfigComponent,
    WebSearchConfigComponent,
    VoiceConfigComponent,
    LucideAngularModule,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  readonly authState = inject(AuthStateService);
  readonly agentOrchestrationConfig = viewChild(
    AgentOrchestrationConfigComponent,
  );
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly KeyIcon = Key;
  readonly CpuIcon = Cpu;
  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly ArrowLeftRightIcon = ArrowLeftRight;
  readonly GlobeIcon = Globe;
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);
  readonly activeSettingsTab = signal<
    'providers' | 'claude-auth' | 'orchestration' | 'pro-features' | 'tools'
  >('claude-auth');

  /**
   * Provider id carried by a deep-link into the settings page (e.g. the
   * tribunal panel's "Configure" action). Forwarded to PtahCliConfigComponent
   * so it auto-opens the add form pre-selected to that provider.
   */
  readonly providersTarget = signal<ProvidersSettingsFocusTarget | null>(null);



  readonly requestedProviderId = signal<string | undefined>(undefined);

  readonly isElectron = this.vscodeService.isElectron;

  /**
   * Initialize: Load auth status on component mount.
   * Auth status is loaded via AuthStateService.
   */
  async ngOnInit(): Promise<void> {
    const pending = this.appState.consumePendingSettingsTab();
    if (pending) {
      this.setActiveTab(pending.providerId || pending.section ? 'providers' : pending.tab);
      this.providersTarget.set(pending.section ?? (pending.tab === 'orchestration' && pending.providerId ? 'cli-agents' : 'main-agent'));
      this.requestedProviderId.set(pending.providerId);
    }
    await this.authState.loadAuthStatus();
  }

  /**
   * Switch active settings tab
   */
  setActiveTab(
    tab: 'providers' | 'claude-auth' | 'orchestration' | 'pro-features' | 'tools',
  ): void {
    this.activeSettingsTab.set(tab === 'providers' ? 'claude-auth' : tab);
  }

  /**
   * Export settings to a JSON file.
   * Uses platform-aware RPC: command:execute for VS Code, settings:export for Electron.
   */
  async exportSettings(): Promise<void> {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        await this.rpcService.call('settings:export' as never, {} as never);
      } else {
        await this.rpcService.call('command:execute', {
          command: 'ptah.exportSettings',
        });
      }
    } finally {
      this.isExporting.set(false);
    }
  }

  /**
   * Import settings from a JSON file.
   * Uses platform-aware RPC: command:execute for VS Code, settings:import for Electron.
   */
  async importSettings(): Promise<void> {
    if (this.isImporting()) return;
    this.isImporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        await this.rpcService.call('settings:import' as never, {} as never);
      } else {
        await this.rpcService.call('command:execute', {
          command: 'ptah.importSettings',
        });
      }
    } finally {
      this.isImporting.set(false);
    }
  }

  /**
   * Navigate back to chat view
   */
  backToChat(): void {
    this.appState.setCurrentView('chat');
  }

  /**
   * Open an external page (Ptah Builders / community) in the browser.
   * Uses the `command:execute` RPC to run the host `ptah.openPricing` command;
   * the target URL is resolved host-side. Reused by the Builders promotion card.
   */
  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  /**
   * Called when LLM providers config emits modelChanged.
   * Delegates to AgentOrchestrationConfigComponent to re-detect CLIs.
   */
  onModelChanged(): void {
    this.agentOrchestrationConfig()?.redetectClis();
  }

}
