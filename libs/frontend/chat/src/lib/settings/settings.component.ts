import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
  effect,
  untracked,
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
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { ProvidersSettingsComponent, type ProvidersSettingsFocusTarget } from './providers/providers-settings.component';
import { ProvidersModelsLoader } from './providers/providers-models-loader.service';
import { SettingsSaveFeedbackService } from './feedback/settings-save-feedback.service';
import { SettingsToastComponent } from './feedback/settings-toast.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { WorkflowsConfigComponent } from './pro-features/workflows-config.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';
import {
  OrchestrationSettingsComponent,
  type OrchestrationSettingsFocusTarget,
} from './ptah-ai/orchestration-settings.component';
import { WebSearchConfigComponent } from './ptah-ai/web-search-config.component';
import { VoiceConfigComponent } from './ptah-ai/voice-config.component';
import { GoVetConsentConfigComponent } from './ptah-ai/go-vet-consent-config.component';
import {
  AppStateManager,
  ClaudeRpcService,
  AuthStateService,
  ProvidersSettingsStateService,
  VSCodeService,
  type PendingSettingsTab,
} from '@ptah-extension/core';

type PendingSection = NonNullable<PendingSettingsTab['section']>;

const PROVIDERS_SECTIONS: ReadonlySet<string> = new Set<ProvidersSettingsFocusTarget>([
  'main-agent', 'main-model', 'main-effort', 'connections', 'more-providers',
]);
const ORCHESTRATION_SECTIONS: ReadonlySet<string> = new Set<OrchestrationSettingsFocusTarget>([
  'background-models', 'cli-agents',
  'memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement',
]);

const isProvidersSection = (section: PendingSection | undefined): section is ProvidersSettingsFocusTarget =>
  section !== undefined && PROVIDERS_SECTIONS.has(section);
const isOrchestrationSection = (section: PendingSection | undefined): section is OrchestrationSettingsFocusTarget =>
  section !== undefined && ORCHESTRATION_SECTIONS.has(section);

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
 * - ProvidersSettingsComponent: Providers tab
 * - OrchestrationSettingsComponent: Agent Orchestration tab (policy, background roles, CLI agents)
 * - LicenseStatusCardComponent: Membership status, user profile, actions
 * - EnhancedPromptsConfigComponent: System prompt mode, preview, regenerate
 *
 * Deep links (`AppStateManager.requestSettingsTab`) are routed by section to the tab that owns
 * it (implementation-plan.md Component 10); an unknown or missing section opens the requested tab.
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
    OrchestrationSettingsComponent,
    WebSearchConfigComponent,
    VoiceConfigComponent,
    GoVetConsentConfigComponent,
    SettingsToastComponent,
    LucideAngularModule,
  ],
  // Page-scoped: the toast timer dies with the page; one models loader for every tab.
  providers: [
    SettingsSaveFeedbackService,
    { provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader },
  ],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly providersState = inject(ProvidersSettingsStateService);
  readonly authState = inject(AuthStateService);
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

  readonly providersTarget = signal<ProvidersSettingsFocusTarget | null>(null);
  readonly orchestrationTarget = signal<OrchestrationSettingsFocusTarget | null>(null);

  /**
   * Provider id carried by a deep-link into the settings page (e.g. the
   * tribunal panel's "Configure" action). Forwarded to ProvidersSettingsComponent,
   * which opens the setup wizard for that provider.
   */
  readonly requestedProviderId = signal<string | undefined>(undefined);

  readonly isElectron = this.vscodeService.isElectron;
  /** Header "App: …" label. */
  readonly appLabel = this.isElectron ? 'Desktop' : 'VS Code';
  /** Header workspace path (full, for `title`); null until setting sources load or with no folder open. */
  readonly workspacePath = computed(() => this.providersState.scopes().data?.activePath ?? null);
  readonly workspaceName = computed(
    () => this.workspacePath()?.split(/[\\/]/).filter(Boolean).pop() ?? null,
  );

  /**
   * Initialize: Load auth status on component mount.
   * Auth status is loaded via AuthStateService.
   */
  constructor() {
    // A request raised while Settings is already open (e.g. Agent Orchestration's
    // "Manage ... in Providers") never re-runs ngOnInit, so react to it here.
    effect(() => {
      if (this.appState.pendingSettingsTab()) untracked(() => this.applyPendingTab());
    });
  }

  async ngOnInit(): Promise<void> {
    this.applyPendingTab();
    await this.authState.loadAuthStatus();
  }

  /**
   * The Providers page opened the wizard for the deep-linked provider: consume
   * the request (like `consumePendingSettingsTab`) so leaving and returning to
   * the Providers tab does not reopen it.
   */
  consumeRequestedProvider(providerId: string): void {
    if (this.requestedProviderId() === providerId) this.requestedProviderId.set(undefined);
  }

  /**
   * A background role asked to set up a provider from the Orchestration tab: the setup wizard
   * lives on Providers, so switch there and hand it the provider id.
   */
  openProviderSetup(providerId: string): void {
    this.setActiveTab('providers');
    this.providersTarget.set(null);
    this.requestedProviderId.set(providerId);
  }

  /**
   * Routing table: implementation-plan.md Component 10. `cli-agents` lands on Orchestration, which focuses the CLI
   * matrix table (`[data-testid="cli-matrix"]`, the S6 row; Batch 34 retired the interim CLI manager heading).
   */
  private applyPendingTab(): void {
    const pending = this.appState.consumePendingSettingsTab();
    if (!pending) return;
    const { section, providerId } = pending;
    this.requestedProviderId.set(providerId);
    if (providerId || isProvidersSection(section)) {
      this.setActiveTab('providers');
      this.providersTarget.set(isProvidersSection(section) ? section : null);
      this.orchestrationTarget.set(null);
    } else if (isOrchestrationSection(section)) {
      this.setActiveTab('orchestration');
      this.orchestrationTarget.set(section);
      this.providersTarget.set(null);
    } else {
      this.setActiveTab(pending.tab);
      this.providersTarget.set(null);
      this.orchestrationTarget.set(null);
    }
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
   * A VS Code LM model change can change which CLIs are usable (#84). Re-detect through the
   * shared state: the Orchestration tab is never mounted while Advanced is shown.
   */
  onModelChanged(): void {
    void this.providersState.redetectClis();
  }

}
