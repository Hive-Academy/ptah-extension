import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Sparkles,
  Lock,
  Key,
  Cpu,
  Puzzle,
  ScanSearch,
  Download,
  Upload,
  ArrowLeftRight,
  Database,
} from 'lucide-angular';
import { AuthConfigComponent } from './auth/auth-config.component';
import { ProviderModelSelectorComponent } from './auth/provider-model-selector.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { AgentOrchestrationConfigComponent } from './ptah-ai/agent-orchestration-config.component';
import { PtahCliConfigComponent } from './ptah-ai/ptah-cli-config.component';
import { WebSearchConfigComponent } from './ptah-ai/web-search-config.component';
import { WorkspaceIndexingComponent } from './workspace-indexing/workspace-indexing.component';
import {
  PluginStatusWidgetComponent,
  PluginBrowserModalComponent,
  SetupStatusWidgetComponent,
  SkillShBrowserComponent,
  McpDirectoryBrowserComponent,
} from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
  CommandDiscoveryFacade,
  VSCodeService,
} from '@ptah-extension/core';
import { ChatStore } from '../services/chat.store';

/**
 * SettingsComponent - Main settings page container
 *
 * Complexity Level: 2 (Container with visibility logic based on auth and license status)
 * Patterns: Signal-based navigation, conditional rendering
 *
 * Responsibilities:
 * - Display settings page header with back navigation
 * - Container for settings sections (authentication, model selection, autopilot)
 * - Navigate back to chat view on back button click
 * - Conditional visibility: Show additional sections only after auth configured
 * - Premium gating: Show MCP port and LLM settings only for premium users
 *
 * Child Components:
 * - LicenseStatusCardComponent: License tier, trial status, user profile, actions
 * - EnhancedPromptsConfigComponent: System prompt mode, preview, regenerate
 * - AgentOrchestrationConfigComponent: CLI detection, model selectors, concurrency
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [
    AuthConfigComponent,
    ProviderModelSelectorComponent,
    LicenseStatusCardComponent,
    EnhancedPromptsConfigComponent,
    VscodeLmConfigComponent,
    McpPortConfigComponent,
    AgentOrchestrationConfigComponent,
    PtahCliConfigComponent,
    WebSearchConfigComponent,
    PluginStatusWidgetComponent,
    PluginBrowserModalComponent,
    SetupStatusWidgetComponent,
    SkillShBrowserComponent,
    McpDirectoryBrowserComponent,
    WorkspaceIndexingComponent,
    LucideAngularModule,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);
  private readonly vscodeService = inject(VSCodeService);

  // TASK_2025_133 Batch 2: Centralized auth state from AuthStateService
  readonly authState = inject(AuthStateService);

  // TASK_2025_142: Use ChatStore's licenseStatus to avoid duplicate RPC calls
  private readonly chatStore = inject(ChatStore);

  // viewChild for cross-component communication (LLM providers → agent re-detect)
  readonly agentOrchestrationConfig = viewChild(
    AgentOrchestrationConfigComponent,
  );

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;
  readonly KeyIcon = Key;
  readonly CpuIcon = Cpu;
  readonly PuzzleIcon = Puzzle;
  readonly ScanSearchIcon = ScanSearch;
  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly ArrowLeftRightIcon = ArrowLeftRight;
  readonly DatabaseIcon = Database;

  // Loading states for export/import actions
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);

  // Tab state for settings page (5-tab layout; Pro content merged into Ptah AI sub-tabs;
  // 'workspace-indexing' added by TASK_2026_114 — free top-level tab, no premium gate.)
  readonly activeSettingsTab = signal<
    | 'claude-auth'
    | 'ptah-ai'
    | 'ptah-skills'
    | 'workspace-indexing'
    | 'project-setup'
  >('claude-auth');

  // Sub-tab state for Ptah AI tab
  readonly activePtahAiSubTab = signal<'orchestration' | 'pro-features'>(
    'orchestration',
  );

  /** Whether the plugin browser modal is open */
  readonly isPluginBrowserOpen = signal(false);

  /** Counter incremented on plugin config save to trigger skill-sh-browser refresh */
  readonly skillRefreshTrigger = signal(0);

  // License status computed signals (kept in parent for header badge + tab gating)
  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false,
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null,
  );

  /**
   * Computed: Whether provider model mapping section should be shown
   * Delegates to AuthStateService which checks authMethod + hasProviderKey (TASK_2025_133)
   */
  readonly showProviderModels = this.authState.showProviderModels;

  /**
   * Computed: Whether the user is fully authenticated (has credential + not loading)
   */
  readonly isAuthenticated = computed(
    () => !this.authState.isLoading() && this.authState.hasAnyCredential(),
  );

  /**
   * Computed: Whether to show premium-only sections
   * Requires: authenticated + premium license
   */
  readonly showPremiumSections = computed(
    () => this.isAuthenticated() && this.isPremium(),
  );

  /**
   * Initialize: Load auth status on component mount
   * TASK_2025_133: Auth status now loaded via AuthStateService
   * TASK_2025_142: License status now comes from ChatStore (already fetched at app init)
   */
  async ngOnInit(): Promise<void> {
    await this.authState.loadAuthStatus();
  }

  /**
   * Switch active settings tab
   */
  setActiveTab(
    tab:
      | 'claude-auth'
      | 'ptah-ai'
      | 'ptah-skills'
      | 'workspace-indexing'
      | 'project-setup',
  ): void {
    this.activeSettingsTab.set(tab);
  }

  /**
   * Switch active Ptah AI sub-tab
   */
  setPtahAiSubTab(subTab: 'orchestration' | 'pro-features'): void {
    this.activePtahAiSubTab.set(subTab);
  }

  /** Open the plugin browser modal */
  openPluginBrowser(): void {
    this.isPluginBrowserOpen.set(true);
  }

  /** Close the plugin browser modal */
  closePluginBrowser(): void {
    this.isPluginBrowserOpen.set(false);
  }

  /** Handle plugins saved event from modal */
  onPluginsSaved(_enabledIds: string[]): void {
    this.isPluginBrowserOpen.set(false);
    this.commandDiscovery.clearCache();
    // Trigger skill-sh-browser to reload installed skills list
    this.skillRefreshTrigger.update((n) => n + 1);
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
   * Open pricing page in browser (used by upsell sections)
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

  /**
   * Called when Ptah CLI config (custom agents) changes (create/update/delete).
   * Refreshes the Agent Orchestration panel to reflect new CLI agents.
   */
  onPtahCliChanged(): void {
    this.agentOrchestrationConfig()?.loadAgentConfig();
  }
}
