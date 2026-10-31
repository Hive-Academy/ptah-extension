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
import { DOCUMENT } from '@angular/common';
import {
  LucideAngularModule,
  ArrowLeft,
  Plug,
  Layers,
  SlidersHorizontal,
  AudioLines,
  RotateCw,
} from 'lucide-angular';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
// Two declarations on purpose: each component import must hold only the `@defer`-only class, or
// Angular keeps the whole tab (Providers with its named-accounts UI and agents routing, Context Management) in the eager chunk.
import { ProvidersSettingsComponent } from './providers/providers-settings.component';
import type { ProvidersSettingsFocusTarget } from './providers/providers-settings.component';
import { ProvidersModelsLoader } from './providers/providers-models-loader.service';
import { SettingsSaveFeedbackService } from './feedback/settings-save-feedback.service';
import { SettingsToastComponent } from './feedback/settings-toast.component';
import { AgentsRoutingSettingsComponent } from './providers/agents-routing-settings.component';
import type { AgentsRoutingFocusTarget } from './providers/agents-routing-settings.component';
import { OrchestrationSettingsComponent } from './ptah-ai/orchestration-settings.component';
import { AdvancedSettingsComponent } from './advanced-settings.component';
import { SearchVoiceSettingsComponent } from './search-voice-settings.component';
import {
  AppStateManager,
  AuthStateService,
  ProvidersSettingsStateService,
  VSCodeService,
  type PendingSettingsTab,
} from '@ptah-extension/core';

type PendingSection = NonNullable<PendingSettingsTab['section']>;

const PROVIDERS_SECTIONS: ReadonlySet<string> =
  new Set<ProvidersSettingsFocusTarget>([
    'main-agent',
    'main-model',
    'main-effort',
    'connections',
    'more-providers',
  ]);
/** The CLI matrix and the background roles: on the Providers tab, below the Main agent and Connections. */
const AGENTS_ROUTING_SECTIONS: ReadonlySet<string> =
  new Set<AgentsRoutingFocusTarget>([
    'background-models',
    'cli-agents',
    'memory-curator',
    'enhancement',
  ]);

const isProvidersSection = (
  section: PendingSection | undefined,
): section is ProvidersSettingsFocusTarget =>
  section !== undefined && PROVIDERS_SECTIONS.has(section);
const isAgentsRoutingSection = (
  section: PendingSection | undefined,
): section is AgentsRoutingFocusTarget =>
  section !== undefined && AGENTS_ROUTING_SECTIONS.has(section);

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
 * - ProvidersSettingsComponent + AgentsRoutingSettingsComponent: Providers tab (Main agent, Connections, then the
 *   CLI matrix and the background model roles)
 * - OrchestrationSettingsComponent: Context Management tab (tab id `orchestration`: subagent cache TTL, session
 *   budget, lane guards, context budgets, Codex agents, background queries)
 * - AdvancedSettingsComponent: Advanced tab (membership, data portability, agent behaviour, MCP, VS Code LM)
 * - SearchVoiceSettingsComponent: Search & Voice tab (web search, voice, go vet consent)
 *
 * Deep links (`AppStateManager.requestSettingsTab`) are routed by section to the tab that owns
 * it, whatever tab the caller named (implementation-plan.md Component 10); an unknown or missing
 * section opens the requested tab. See `applyPendingTab`.
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [
    // Used only inside `@defer` in the template, so each tab compiles to its own lazy chunk.
    // Referencing any of these classes anywhere else in this file would make it eager again.
    ProvidersSettingsComponent,
    AgentsRoutingSettingsComponent,
    OrchestrationSettingsComponent,
    AdvancedSettingsComponent,
    SearchVoiceSettingsComponent,
    SettingsToastComponent,
    LucideAngularModule,
  ],
  // Page-scoped: the toast timer dies with the page; one models loader for every tab.
  providers: [
    SettingsSaveFeedbackService,
    { provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader },
  ],
  templateUrl: './settings.component.html',
  // Card-tab layout follows the header's own width (a VS Code sidebar can be ~300 px), not the
  // viewport: one row of four from 46rem (the widest label fits on one line), a 2x2 grid below,
  // icon-only tiles below 18rem (the label stays in the accessible name and title).
  styles: `
    .settings-header {
      display: block;
      container-type: inline-size;
    }
    /* Glass (data-glass on, any theme): the page plane clears like the other shell pages, so the blurred chrome pane
       and its scene show between the cards; light and dark keep the solid surface-0 plane. The header and the security
       line keep a plate (their text sits on the pane), the tabs a tile; the active tab keeps a stronger fill. */
    :host-context([data-glass='on']) .settings-page {
      background-color: transparent;
    }
    :host-context([data-glass='on']) .settings-header {
      padding: 0.5rem 0.75rem 0.625rem;
    }
    :host-context([data-glass='on']) .settings-plate {
      padding: 0.25rem 0.625rem;
    }
    :host-context([data-glass='on']) .settings-tab.tab-active,
    :host-context([data-glass='on']) .settings-tab:not(.tab-active):hover {
      background: var(--glass-hover);
    }
    .settings-tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.375rem;
    }
    .settings-tab:not(.tab-active):hover {
      background: var(--surface-3);
      color: oklch(var(--bc));
    }
    /* One row from 36rem: the Electron page beside its sidebar (~42rem) keeps one row of four tabs. */
    @container (min-width: 36rem) {
      .settings-tabs {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .settings-tab-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    /* Tighter tiles until 46rem: 12 px labels (the Settings floor) and a 4 px icon gap there; 14 px (text-sm) from
       46rem. A label that still does not fit its quarter (Context Management at 1024 px with the Workspaces panel open,
       ~39-42rem) wraps between words onto a second line instead of ending in an ellipsis. */
    @container (min-width: 36rem) and (max-width: 45.99rem) {
      .settings-tab {
        padding-inline: 0.375rem;
        gap: 0.25rem;
        font-size: 0.75rem;
      }
      .settings-tab-label {
        white-space: normal;
        line-height: 1rem;
      }
    }
    @container (max-width: 17.99rem) {
      .settings-tabs {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .settings-tab {
        padding-inline: 0;
      }
      .settings-tab-label {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly providersState = inject(ProvidersSettingsStateService);
  readonly authState = inject(AuthStateService);
  private readonly document = inject(DOCUMENT);
  readonly ArrowLeftIcon = ArrowLeft;
  readonly RotateCwIcon = RotateCw;
  /** Card tabs, in order. Each label is the button's exact accessible name (live-app scripts use it). */
  readonly settingsTabs = [
    { id: 'claude-auth', label: 'Providers', icon: Plug },
    { id: 'orchestration', label: 'Context Management', icon: Layers },
    { id: 'pro-features', label: 'Advanced', icon: SlidersHorizontal },
    { id: 'tools', label: 'Search & Voice', icon: AudioLines },
  ] as const;
  readonly activeSettingsTab = signal<
    'providers' | 'claude-auth' | 'orchestration' | 'pro-features' | 'tools'
  >('claude-auth');

  readonly providersTarget = signal<ProvidersSettingsFocusTarget | null>(null);
  /** Focus target for the CLI matrix / background roles part of the Providers tab. */
  readonly agentsRoutingTarget = signal<AgentsRoutingFocusTarget | null>(null);

  /**
   * Provider id carried by a deep-link into the settings page (e.g. the
   * tribunal panel's "Configure" action). Forwarded to ProvidersSettingsComponent,
   * which opens the setup wizard for that provider.
   */
  readonly requestedProviderId = signal<string | undefined>(undefined);

  readonly isElectron = this.vscodeService.isElectron;
  /** Header "App: …" label. */
  readonly appLabel = this.isElectron ? 'Desktop' : 'VS Code';

  runOnboardingAgain(): void {
    this.appState.setCurrentView('onboarding');
  }

  checkClaudeCode(): void {
    if (this.isElectron) this.appState.openOnboardingReady();
  }
  /** Header workspace path (full, for `title`); null until setting sources load or with no folder open. */
  readonly workspacePath = computed(
    () => this.providersState.scopes().data?.activePath ?? null,
  );
  readonly workspaceName = computed(
    () => this.workspacePath()?.split(/[\\/]/).filter(Boolean).pop() ?? null,
  );

  /**
   * Initialize: Load auth status on component mount.
   * Auth status is loaded via AuthStateService.
   */
  constructor() {
    // A request raised while Settings is already open (e.g. the connection
    // drawer's role link, or a role's provider setup) never re-runs ngOnInit, so react to it here.
    effect(() => {
      if (this.appState.pendingSettingsTab())
        untracked(() => this.applyPendingTab());
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
    if (this.requestedProviderId() === providerId)
      this.requestedProviderId.set(undefined);
  }

  /**
   * The one routing table for deep links (implementation-plan.md Component 10). The section decides the tab, not the
   * caller's `tab`: Providers sections and every `providerId` land on Providers; `cli-agents`, `background-models` and
   * the role ids land on Providers too, where `AgentsRoutingSettingsComponent` focuses the CLI matrix table
   * (`[data-testid="cli-matrix"]`) or opens the background roles. Callers that still name `tab: 'orchestration'` for
   * those sections keep working unchanged.
   */
  private applyPendingTab(): void {
    const pending = this.appState.consumePendingSettingsTab();
    if (!pending) return;
    const { section, providerId } = pending;
    this.requestedProviderId.set(providerId);
    if (providerId || isProvidersSection(section)) {
      this.setActiveTab('providers');
      this.providersTarget.set(isProvidersSection(section) ? section : null);
      this.agentsRoutingTarget.set(null);
    } else if (isAgentsRoutingSection(section)) {
      this.setActiveTab('providers');
      this.agentsRoutingTarget.set(section);
      this.providersTarget.set(null);
    } else {
      this.setActiveTab(pending.tab);
      this.providersTarget.set(null);
      this.agentsRoutingTarget.set(null);
    }
  }

  /**
   * Switch active settings tab
   */
  setActiveTab(
    tab:
      'providers' | 'claude-auth' | 'orchestration' | 'pro-features' | 'tools',
  ): void {
    const next = tab === 'providers' ? 'claude-auth' : tab;
    if (next !== this.activeSettingsTab()) {
      // A deep-link target belongs to the visit it opened: a tab is torn down when left and rebuilt on return, and a
      // kept target would re-open the roles (or a role's popover) and take focus again (Batch 35 revise, R3).
      // applyPendingTab sets the new target after this call.
      this.providersTarget.set(null);
      this.agentsRoutingTarget.set(null);
    }
    this.activeSettingsTab.set(next);
  }

  /**
   * Navigate back to chat view
   */
  backToChat(): void {
    this.appState.setCurrentView('chat');
  }

  /**
   * Recovery for a Providers chunk that failed to load. Angular and the module
   * loader cache the failure, so reopening Settings would fail again; a reload
   * restarts the renderer instead (as electron-shell's welcome screen does).
   */
  reloadWindow(): void {
    this.document.defaultView?.location.reload();
  }

  /**
   * A VS Code LM model change can change which CLIs are usable (#84). Re-detect through the
   * shared state: the Providers tab (which holds the CLI matrix) is never mounted while Advanced is shown.
   */
  onModelChanged(): void {
    void this.providersState.redetectClis();
  }
}
