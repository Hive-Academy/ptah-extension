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
  Download,
  Upload,
  ArrowLeftRight,
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
import { VoiceConfigComponent } from './ptah-ai/voice-config.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
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
  private readonly chatStore = inject(ChatStore);
  readonly agentOrchestrationConfig = viewChild(
    AgentOrchestrationConfigComponent,
  );
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;
  readonly KeyIcon = Key;
  readonly CpuIcon = Cpu;
  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly ArrowLeftRightIcon = ArrowLeftRight;
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);
  readonly activeSettingsTab = signal<
    'claude-auth' | 'orchestration' | 'pro-features'
  >('claude-auth');

  readonly isElectron = this.vscodeService.isElectron;

  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false,
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null,
  );

  /**
   * Computed: Whether provider model mapping section should be shown
   * Delegates to AuthStateService which checks authMethod + hasProviderKey
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
   * Initialize: Load auth status on component mount.
   * Auth status is loaded via AuthStateService; license status comes from
   * ChatStore (already fetched at app init).
   */
  async ngOnInit(): Promise<void> {
    await this.authState.loadAuthStatus();
  }

  /**
   * Switch active settings tab
   */
  setActiveTab(tab: 'claude-auth' | 'orchestration' | 'pro-features'): void {
    this.activeSettingsTab.set(tab);
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
