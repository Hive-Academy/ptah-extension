import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
  ViewChild,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  ScanSearch,
  Puzzle,
  AlertTriangle,
} from 'lucide-angular';
import { SetupStatusWidgetComponent } from './setup-status-widget.component';
import { PluginStatusWidgetComponent } from './plugin-status-widget.component';
import { PluginBrowserModalComponent } from './plugin-browser-modal.component';
import { PromptSuggestionsComponent } from './prompt-suggestions.component';
import {
  VSCodeService,
  ClaudeRpcService,
  CommandDiscoveryFacade,
} from '@ptah-extension/core';
import { ChatStore } from '../../../services/chat.store';

/**
 * ChatEmptyStateComponent - Egyptian-themed empty state for chat view with tabbed navigation
 *
 * Complexity Level: 2 (Medium - composition + theming + tabs)
 * Patterns: Signal-based state, Component composition, DaisyUI styling, Tabbed navigation
 *
 * Features:
 * - Two-tab navigation: "Ptah Skills" and "Intelligent Project Setup"
 * - Tab 1: Ptah Skills (Ptah Skills + Plugins configuration)
 * - Tab 2: Intelligent Project Setup (MCP-powered workspace scanning)
 * - Warning in Setup tab if skills not configured yet
 * - Egyptian artifact reveal experience with Anubis theme
 * - Hieroglyphic Unicode symbols for visual flair
 * - Ptah (Ancient Wisdom) branding with Cinzel font
 *
 * Design System:
 * - Anubis theme: Lapis Lazuli Blue + Pharaoh's Gold
 * - Cinzel font for Egyptian elegance
 * - Glass morphism effects with golden shadows
 * - Hieroglyphic symbols: 𓀀 𓂀 𓁹 (Unicode Egyptian Hieroglyphs)
 * - Ankh symbol: ☥ (Key of Life - represents AI capabilities)
 * - Papyrus scroll: 📜 (Getting started guide)
 *
 * SOLID Principles:
 * - Single Responsibility: Display empty state with Egyptian theme and tab navigation
 * - Open/Closed: Extensible via composition, closed for modification
 * - Composition: Embeds setup-status-widget and plugin widgets via component selectors
 * - Dependency Inversion: Depends on VSCodeService and ClaudeRpcService abstractions
 */
@Component({
  selector: 'ptah-chat-empty-state',
  imports: [
    SetupStatusWidgetComponent,
    PluginStatusWidgetComponent,
    PluginBrowserModalComponent,
    PromptSuggestionsComponent,
    NgOptimizedImage,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
    ChatEmptyStateComponent - Premium Responsive Design with Tabbed Navigation

    Design System: Anubis Theme
    - Uses predefined .glass-panel, .divine-glow utilities from styles.css
    - Leverages existing CSS variables for spacing, colors, animations
    - DaisyUI components with theme-aware classes

    Responsive Design:
    - Compact: Sidebar narrow view (< 280px width)
    - Expanded: Full panel view with rich visuals
    -->

    <div class="flex flex-col items-center h-full p-4 md:p-6 overflow-y-auto">
      <!-- Hero Section with Divine Glow -->
      <div class="relative w-full max-w-md mb-6">
        <div class="flex flex-col items-center text-center">
          <!-- Logo with Divine Aura -->
          <div class="relative mb-4">
            <div
              class="absolute inset-0 -m-2 rounded-full divine-glow opacity-50"
            ></div>
            <img
              [ngSrc]="ptahIconUri"
              alt="Ptah"
              width="64"
              height="64"
              class="w-12 h-12 md:w-16 md:h-16 relative z-10 drop-shadow-lg"
            />
          </div>

          <!-- Title & Tagline -->
          <h1
            class="text-lg md:text-2xl font-bold font-display text-secondary mb-1 tracking-tight"
          >
            Ptah
          </h1>
          <p class="text-xs md:text-sm text-base-content/70 max-w-xs">
            Ancient Wisdom • Master Craftsman
          </p>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="w-full max-w-md mb-4">
        <div role="tablist" class="tabs tabs-boxed bg-base-200/50 p-1">
          <button
            role="tab"
            [class]="activeTab() === 'skills' ? 'tab tab-active' : 'tab'"
            (click)="setActiveTab('skills')"
            type="button"
            aria-label="Ptah Skills Tab"
          >
            <lucide-angular
              [img]="PuzzleIcon"
              class="w-3.5 h-3.5 mr-1.5"
              aria-hidden="true"
            />
            <span class="text-xs md:text-sm">Ptah Skills</span>
          </button>
          <button
            role="tab"
            [class]="activeTab() === 'setup' ? 'tab tab-active' : 'tab'"
            (click)="setActiveTab('setup')"
            type="button"
            aria-label="Intelligent Project Setup Tab"
          >
            <lucide-angular
              [img]="ScanSearchIcon"
              class="w-3.5 h-3.5 mr-1.5"
              aria-hidden="true"
            />
            <span class="text-xs md:text-sm">Project Setup</span>
          </button>
        </div>
      </div>

      <!-- Tab 1: Ptah Skills -->
      @if (activeTab() === 'skills') {
      <div class="w-full max-w-md space-y-5 tab-content-animated">
        <!-- Ptah Skills Card -->
        <div
          class="glass-panel glass-panel-divine rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg"
        >
          <div class="p-4">
            <div class="flex items-start gap-3 mb-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0"
              >
                <lucide-angular
                  [img]="PuzzleIcon"
                  class="w-5 h-5 md:w-6 md:h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="flex-1">
                <h3
                  class="text-sm md:text-base font-semibold text-primary mb-0.5"
                >
                  Ptah Skills
                  <span class="badge badge-primary badge-xs ml-1">Pro</span>
                </h3>
                <p class="text-xs text-base-content/60 leading-relaxed">
                  Enhance your sessions with specialized skills for
                  orchestration, frontend patterns, backend architecture, and
                  more.
                </p>
              </div>
            </div>
            @if (isPremium()) {
            <ptah-plugin-status-widget
              (configureClicked)="openPluginBrowser()"
            />
            } @else {
            <div
              class="flex items-center justify-between p-2 rounded-md bg-base-200/50 border border-base-300"
            >
              <span class="text-xs text-base-content/60"
                >Available with Pro plan</span
              >
              <span class="badge badge-xs badge-primary">Upgrade</span>
            </div>
            }
          </div>
        </div>

        <!-- Prompt Suggestions with tab-card layout (TASK_2025_174) -->
        <ptah-prompt-suggestions
          (promptSelected)="promptSelected.emit($event)"
        />
      </div>
      }

      <!-- Tab 2: Intelligent Project Setup -->
      @if (activeTab() === 'setup') {
      <div class="w-full max-w-md space-y-5 tab-content-animated">
        <!-- Warning if skills not configured -->
        @if (isPremium() && !hasConfiguredSkills()) {
        <div
          class="border border-warning/30 rounded-md bg-warning/5 p-3 flex items-start gap-2"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-4 h-4 text-warning shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div class="flex-1">
            <h4 class="text-xs font-semibold text-warning mb-1">
              Skills Not Configured
            </h4>
            <p class="text-xs text-base-content/60 leading-relaxed mb-2">
              The Intelligent Project Setup uses your configured skills to
              provide better recommendations. It's recommended to configure your
              Ptah Skills first for optimal results.
            </p>
            <button
              class="btn btn-xs btn-warning"
              (click)="setActiveTab('skills')"
              type="button"
            >
              Configure Skills First
            </button>
          </div>
        </div>
        }

        <!-- Smart Setup CTA Card - Glass Panel -->
        <div
          class="glass-panel glass-panel-divine rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg"
        >
          <div class="p-4">
            <!-- Header with Scanner Icon -->
            <div class="flex items-start gap-3 mb-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-secondary/10 text-secondary shrink-0 agent-working"
              >
                <lucide-angular
                  [img]="ScanSearchIcon"
                  class="w-5 h-5 md:w-6 md:h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="flex-1">
                <h3
                  class="text-sm md:text-base font-semibold text-secondary mb-0.5"
                >
                  Intelligent Project Setup
                </h3>
                <p class="text-xs text-base-content/60 leading-relaxed">
                  MCP-powered scanning analyzes your workspace, detects
                  frameworks, and configures optimal AI agents automatically.
                </p>
              </div>
            </div>

            <!-- Feature Badges using DaisyUI -->
            <div class="flex flex-wrap gap-1.5 mb-3">
              <span class="badge badge-sm badge-outline badge-secondary gap-1">
                <span class="text-[10px]">⚡</span> Auto-detect
              </span>
              <span class="badge badge-sm badge-outline badge-secondary gap-1">
                <span class="text-[10px]">🔗</span> VS Code AI
              </span>
              <span class="badge badge-sm badge-outline badge-secondary gap-1">
                <span class="text-[10px]">🛠️</span> MCP Server
              </span>
            </div>

            <!-- Setup Status Widget Integration -->
            <ptah-setup-status-widget />
          </div>
        </div>

        <!-- Prompt Suggestions (TASK_2025_174) -->
        <ptah-prompt-suggestions
          (promptSelected)="promptSelected.emit($event)"
        />
      </div>
      }

      <!-- Decorative Egyptian Footer -->
      <div
        class="flex items-center justify-center gap-2 mt-auto pt-4 text-secondary/30"
        aria-hidden="true"
      >
        <span class="text-sm tracking-[0.5em]">𓀀𓂀𓁹𓂀𓀀</span>
      </div>
    </div>

    <!-- Plugin Browser Modal (TASK_2025_153) -->
    <ptah-plugin-browser-modal
      [isOpen]="isPluginBrowserOpen()"
      (closed)="closePluginBrowser()"
      (saved)="onPluginsSaved($event)"
    />
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        /* Use CSS variable from design system for subtle gradient */
        background: var(--gradient-panel);
      }

      /* Tab content animation */
      .tab-content-animated {
        animation: fadeIn 0.3s ease-in-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Tab styling customization */
      .tabs-boxed .tab {
        transition: all 0.2s ease;
      }

      .tabs-boxed .tab:hover {
        background-color: var(--fallback-b2, oklch(var(--b2) / 0.7));
      }

      .tabs-boxed .tab-active {
        background-color: var(--fallback-p, oklch(var(--p) / 1));
        color: var(--fallback-pc, oklch(var(--pc) / 1));
      }
    `,
  ],
})
export class ChatEmptyStateComponent {
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly chatStore = inject(ChatStore);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);

  @ViewChild(PluginStatusWidgetComponent)
  private pluginWidget?: PluginStatusWidgetComponent;

  /** Emitted when user selects a prompt suggestion (TASK_2025_174) */
  readonly promptSelected = output<string>();

  /** Lucide icon references for template binding */
  protected readonly ScanSearchIcon = ScanSearch;
  protected readonly PuzzleIcon = Puzzle;
  protected readonly AlertTriangleIcon = AlertTriangle;

  /** Ptah icon URI - uses same method as app-shell component */
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  /** Whether the current user has a premium license */
  protected readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false
  );

  /** Whether the plugin browser modal is open (TASK_2025_153) */
  protected readonly isPluginBrowserOpen = signal(false);

  /** Active tab: 'skills' or 'setup' */
  protected readonly activeTab = signal<'skills' | 'setup'>('skills');

  /** Whether skills are configured (used for warning display) */
  protected readonly hasConfiguredSkills = signal(false);

  /** Set the active tab and check skills configuration if switching to setup */
  protected setActiveTab(tab: 'skills' | 'setup'): void {
    this.activeTab.set(tab);

    // Check if skills are configured when switching to setup tab
    if (tab === 'setup' && this.isPremium()) {
      this.checkSkillsConfiguration();
    }
  }

  /** Check if user has configured any skills */
  private async checkSkillsConfiguration(): Promise<void> {
    try {
      const result = await this.rpcService.call('plugins:get-config', {});
      if (result.isSuccess()) {
        const hasEnabled = result.data.enabledPluginIds.length > 0;
        this.hasConfiguredSkills.set(hasEnabled);
      }
    } catch {
      // Silently fail - warning won't show if we can't determine
      this.hasConfiguredSkills.set(true);
    }
  }

  /** Open the plugin browser modal (premium only) */
  protected openPluginBrowser(): void {
    if (!this.isPremium()) return;
    this.isPluginBrowserOpen.set(true);
  }

  /** Close the plugin browser modal */
  protected closePluginBrowser(): void {
    this.isPluginBrowserOpen.set(false);
  }

  /** Handle plugins saved event from modal - refresh widget count and command cache */
  protected onPluginsSaved(_enabledIds: string[]): void {
    this.isPluginBrowserOpen.set(false);
    this.pluginWidget?.fetchPluginStatus();
    // Update skills configuration status
    this.hasConfiguredSkills.set(_enabledIds.length > 0);
    // Invalidate slash command cache so plugin commands are re-fetched
    this.commandDiscovery.clearCache();
  }
}
