import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Sparkles,
  Lock,
  Shield,
  Clock,
  CreditCard,
  UserPlus,
  Key,
  ExternalLink,
  AlertTriangle,
  Cpu,
} from 'lucide-angular';
import { AuthConfigComponent } from './auth-config.component';
import { ProviderModelSelectorComponent } from './provider-model-selector.component';
import { LlmProvidersConfigComponent } from './llm-providers-config.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
} from '@ptah-extension/core';
import { TRIAL_DURATION_DAYS } from '@ptah-extension/shared';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { ChatStore } from '../services/chat.store';
import { MarkdownBlockComponent } from '../components/atoms/markdown-block.component';

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
 * SOLID Principles:
 * - Single Responsibility: Settings page layout and navigation
 * - Composition: Uses AuthConfigComponent for authentication section
 *
 * TASK_2025_079: Added auth status and license status for conditional visibility
 * TASK_2025_142: Refactored to use ChatStore.licenseStatus to avoid duplicate RPC calls
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [
    AuthConfigComponent,
    ProviderModelSelectorComponent,
    LlmProvidersConfigComponent,
    LucideAngularModule,
    MarkdownBlockComponent,
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

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;
  readonly SparklesIcon = Sparkles;
  readonly LockIcon = Lock;
  readonly ShieldIcon = Shield;
  readonly ClockIcon = Clock;
  readonly CreditCardIcon = CreditCard;
  readonly UserPlusIcon = UserPlus;
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly CpuIcon = Cpu;

  // Tab state for settings page (3-tab layout)
  readonly activeSettingsTab = signal<
    'claude-auth' | 'pro-features' | 'ptah-ai'
  >('claude-auth');

  // ============================================================
  // Enhanced Prompts state signals (TASK_2025_151)
  // ============================================================

  readonly enhancedPromptsStatus =
    signal<EnhancedPromptsGetStatusResponse | null>(null);
  readonly enhancedPromptsLoading = signal(false);
  readonly enhancedPromptsError = signal<string | null>(null);
  readonly isRegenerating = signal(false);
  readonly promptPreviewContent = signal<string | null>(null);
  readonly promptPreviewExpanded = signal(false);
  readonly isDownloading = signal(false);

  // ============================================================
  // License status computed signals (derived from ChatStore)
  // TASK_2025_142: All license data now flows from ChatStore.licenseStatus
  // ============================================================

  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false
  );

  readonly licenseTier = computed(
    () => this.chatStore.licenseStatus()?.tier ?? 'expired'
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null
  );

  readonly licenseValid = computed(
    () => this.chatStore.licenseStatus()?.valid ?? false
  );

  readonly trialActive = computed(
    () => this.chatStore.licenseStatus()?.trialActive ?? false
  );

  readonly trialDaysRemaining = computed(
    () => this.chatStore.licenseStatus()?.trialDaysRemaining ?? null
  );

  readonly daysRemaining = computed(
    () => this.chatStore.licenseStatus()?.daysRemaining ?? null
  );

  readonly planName = computed(
    () => this.chatStore.licenseStatus()?.plan?.name ?? null
  );

  readonly planDescription = computed(
    () => this.chatStore.licenseStatus()?.plan?.description ?? null
  );

  readonly isCommunity = computed(
    () => this.chatStore.licenseStatus()?.isCommunity ?? false
  );

  // User profile computed signals (TASK_2025_129)
  readonly userEmail = computed(
    () => this.chatStore.licenseStatus()?.user?.email ?? null
  );

  readonly userFirstName = computed(
    () => this.chatStore.licenseStatus()?.user?.firstName ?? null
  );

  readonly userLastName = computed(
    () => this.chatStore.licenseStatus()?.user?.lastName ?? null
  );

  // TASK_2025_142: License reason for trial ended detection
  readonly licenseReason = computed(
    () => this.chatStore.licenseStatus()?.reason
  );

  /**
   * Computed: Whether any auth credential is configured
   * Delegates to AuthStateService (TASK_2025_133)
   */
  readonly hasAnyCredential = this.authState.hasAnyCredential;

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

  // ============================================================
  // Enhanced Prompts computed signals (TASK_2025_151)
  // ============================================================

  readonly enhancedPromptsEnabled = computed(
    () => this.enhancedPromptsStatus()?.enabled ?? false
  );

  readonly hasGeneratedPrompt = computed(
    () => this.enhancedPromptsStatus()?.hasGeneratedPrompt ?? false
  );

  readonly enhancedPromptsGeneratedAt = computed(() => {
    const ts = this.enhancedPromptsStatus()?.generatedAt;
    if (!ts) return null;
    return new Date(ts).toLocaleString();
  });

  readonly enhancedPromptsCacheValid = computed(
    () => this.enhancedPromptsStatus()?.cacheValid ?? false
  );

  readonly detectedStackSummary = computed(() => {
    const stack = this.enhancedPromptsStatus()?.detectedStack;
    if (!stack) return null;
    const parts: string[] = [];
    if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(', '));
    if (stack.languages.length > 0) parts.push(stack.languages.join(', '));
    if (stack.projectType) parts.push(stack.projectType);
    return parts.join(' | ');
  });

  readonly showEnhancedPromptsSection = computed(
    () => this.showPremiumSections() && !this.enhancedPromptsLoading()
  );

  /**
   * Computed: Display name for the current tier
   */
  readonly tierDisplayName = computed(() => {
    switch (this.licenseTier()) {
      case 'pro':
        return 'Pro';
      case 'trial_pro':
        return 'Pro Trial';
      case 'community':
        return 'Community';
      case 'expired':
        return 'Expired';
      default:
        return 'Unknown';
    }
  });

  /**
   * Computed: Whether to show trial info section
   */
  readonly showTrialInfo = computed(
    () => this.trialActive() && this.trialDaysRemaining() !== null
  );

  /**
   * Computed: User display name (first + last name, or email fallback)
   * TASK_2025_129
   */
  readonly userDisplayName = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first || last) {
      return [first, last].filter(Boolean).join(' ');
    }
    return this.userEmail();
  });

  /**
   * Computed: Whether to show user display name separately from email (TASK_2025_129)
   */
  readonly showUserName = computed(() => {
    const name = this.userDisplayName();
    return !!name && name !== this.userEmail();
  });

  /**
   * Signal: System prompt preset preference for new sessions
   * - 'claude_code': Minimal default preset
   * - 'enhanced': AI-generated project-specific guidance
   */
  readonly systemPromptPreset = signal<'claude_code' | 'enhanced'>('enhanced');

  // ============================================================
  // TASK_2025_142: Enhanced Trial Status Computed Signals
  // ============================================================

  /**
   * Computed: Trial end date in human-readable format
   * Calculates the end date based on days remaining from today
   */
  readonly trialEndDate = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return null;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    return endDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  /**
   * Computed: Trial progress percentage (for visual indicator)
   * Uses TRIAL_DURATION_DAYS constant to avoid hardcoded magic number
   * Returns percentage of trial remaining (100% = full trial, 0% = expired)
   */
  readonly trialProgress = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return 0;
    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, (days / TRIAL_DURATION_DAYS) * 100));
  });

  /**
   * Computed: Trial urgency level for styling
   * - 'error' when days <= 1 (red/urgent)
   * - 'warning' when days <= 3 (yellow/caution)
   * - 'info' otherwise (blue/informational)
   */
  readonly trialUrgencyLevel = computed((): 'info' | 'warning' | 'error' => {
    const days = this.trialDaysRemaining();
    if (days === null) return 'info';
    if (days <= 1) return 'error';
    if (days <= 3) return 'warning';
    return 'info';
  });

  /**
   * Computed: Trial status text for display
   * Shows appropriate message based on days remaining
   */
  readonly trialStatusText = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return '';
    if (days === 0) return 'Expires today';
    if (days === 1) return 'Expires tomorrow';
    return `${days} days remaining`;
  });

  /**
   * Computed: User initials for avatar (e.g., "JD" for John Doe)
   * (TASK_2025_129)
   */
  readonly userInitials = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first && last) {
      return `${first[0]}${last[0]}`.toUpperCase();
    }
    if (first) {
      return first[0].toUpperCase();
    }
    if (last) {
      return last[0].toUpperCase();
    }
    const email = this.userEmail();
    if (email && email.length > 0) {
      return email[0].toUpperCase();
    }
    return '?';
  });

  /**
   * Initialize: Load auth status on component mount
   * TASK_2025_133: Auth status now loaded via AuthStateService
   * TASK_2025_142: License status now comes from ChatStore (already fetched at app init)
   */
  async ngOnInit(): Promise<void> {
    // Only load auth status - license status is already in ChatStore
    await this.authState.loadAuthStatus();
    // Load enhanced prompts status for premium users (TASK_2025_151)
    if (this.isPremium()) {
      await this.loadEnhancedPromptsStatus();
    }
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
   * Open signup page in browser
   */
  async openSignup(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openSignup',
    });
  }

  /**
   * Open license key entry dialog
   */
  async enterLicenseKey(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.enterLicenseKey',
    });
  }

  /**
   * Open pricing page in browser
   */
  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  // ============================================================
  // Enhanced Prompts methods (TASK_2025_151)
  // ============================================================

  /**
   * Load enhanced prompts status from backend.
   * Called on init for premium users and after toggle/regenerate actions.
   */
  async loadEnhancedPromptsStatus(): Promise<void> {
    this.enhancedPromptsLoading.set(true);
    this.enhancedPromptsError.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:getStatus', {
        workspacePath: '.',
      });
      if (result.isSuccess()) {
        this.enhancedPromptsStatus.set(result.data);
      } else {
        this.enhancedPromptsError.set(result.error ?? 'Failed to load status');
      }
    } catch {
      this.enhancedPromptsError.set('Failed to load enhanced prompts status');
    } finally {
      this.enhancedPromptsLoading.set(false);
    }
  }

  /**
   * Toggle enhanced prompts on/off for the current workspace.
   * Reloads status after toggling to reflect the updated state.
   */
  async toggleEnhancedPrompts(enabled: boolean): Promise<void> {
    this.enhancedPromptsError.set(null);
    const result = await this.rpcService.call('enhancedPrompts:setEnabled', {
      workspacePath: '.',
      enabled,
    });
    if (result.isSuccess()) {
      await this.loadEnhancedPromptsStatus();
    } else {
      this.enhancedPromptsError.set(result.error ?? 'Failed to toggle');
    }
  }

  /**
   * Change system prompt preset preference for new sessions.
   * This affects which system prompt is used when creating new chat tabs.
   */
  setSystemPromptPreset(preset: 'claude_code' | 'enhanced'): void {
    this.systemPromptPreset.set(preset);
    // TODO: Persist preference to extension state via RPC
    // For now, this is session-scoped (resets on reload)
  }

  /**
   * Regenerate the enhanced prompt for the current workspace.
   * Uses a 2-minute timeout since generation involves an SDK query.
   */
  async regenerateEnhancedPrompt(): Promise<void> {
    this.isRegenerating.set(true);
    this.enhancedPromptsError.set(null);
    try {
      const result = await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 }
      );
      if (result.isSuccess()) {
        // Clear cached preview content since prompt has changed
        this.promptPreviewContent.set(null);
        this.promptPreviewExpanded.set(false);
        await this.loadEnhancedPromptsStatus();
      } else {
        this.enhancedPromptsError.set(result.error ?? 'Regeneration failed');
      }
    } finally {
      this.isRegenerating.set(false);
    }
  }

  /**
   * Toggle the expandable prompt preview section.
   * Fetches prompt content on first expand, then caches it in signal.
   */
  async togglePromptPreview(): Promise<void> {
    if (this.promptPreviewExpanded()) {
      this.promptPreviewExpanded.set(false);
      return;
    }
    // Fetch content if not already loaded
    if (!this.promptPreviewContent()) {
      const result = await this.rpcService.call(
        'enhancedPrompts:getPromptContent',
        {
          workspacePath: '.',
        }
      );
      if (result.isSuccess() && result.data.content) {
        this.promptPreviewContent.set(result.data.content);
      }
    }
    this.promptPreviewExpanded.set(true);
  }

  /**
   * Download the enhanced prompt file to disk via VS Code save dialog.
   */
  async downloadEnhancedPrompt(): Promise<void> {
    this.isDownloading.set(true);
    try {
      await this.rpcService.call('enhancedPrompts:download', {
        workspacePath: '.',
      });
    } finally {
      this.isDownloading.set(false);
    }
  }
}
