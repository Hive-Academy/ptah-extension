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
} from 'lucide-angular';
import { AuthConfigComponent } from './auth/auth-config.component';
import { ProviderModelSelectorComponent } from './auth/provider-model-selector.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { AgentOrchestrationConfigComponent } from './ptah-ai/agent-orchestration-config.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
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
    AgentOrchestrationConfigComponent,
    LucideAngularModule,
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);

  // TASK_2025_133 Batch 2: Centralized auth state from AuthStateService
  readonly authState = inject(AuthStateService);

  // TASK_2025_142: Use ChatStore's licenseStatus to avoid duplicate RPC calls
  private readonly chatStore = inject(ChatStore);

  // viewChild for cross-component communication (LLM providers → agent re-detect)
  readonly agentOrchestrationConfig = viewChild(
    AgentOrchestrationConfigComponent
  );

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;
  readonly KeyIcon = Key;
  readonly CpuIcon = Cpu;

  // Tab state for settings page (3-tab layout)
  readonly activeSettingsTab = signal<
    'claude-auth' | 'pro-features' | 'ptah-ai'
  >('claude-auth');

  // License status computed signals (kept in parent for header badge + tab gating)
  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null
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
    () => !this.authState.isLoading() && this.authState.hasAnyCredential()
  );

  /**
   * Computed: Whether to show premium-only sections
   * Requires: authenticated + premium license
   */
  readonly showPremiumSections = computed(
    () => this.isAuthenticated() && this.isPremium()
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
  setActiveTab(tab: 'claude-auth' | 'pro-features' | 'ptah-ai'): void {
    this.activeSettingsTab.set(tab);
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
}
