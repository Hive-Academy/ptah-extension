import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
  output,
} from '@angular/core';
import { LucideAngularModule, ScanSearch, AlertTriangle } from 'lucide-angular';
import {
  SetupStatusWidgetComponent,
  PromptSuggestionsComponent,
} from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  PluginCatalogService,
  VSCodeService,
} from '@ptah-extension/core';

/**
 * ChatEmptyStateComponent - Egyptian-themed empty state for the chat view.
 *
 * Complexity Level: 1 (Low - composition + theming)
 * Patterns: Signal-based derivation, Component composition, DaisyUI styling
 *
 * Content (single column, no tabs):
 * - Hero: Ptah logo, title and tagline
 * - "Skills Not Configured" warning, deep-linking to the Marketplace Ptah
 *   plugins page (TASK_2026_524 — the plugin catalog is edited there now, inline,
 *   not in the modal this component used to host)
 * - Intelligent Project Setup card with `<ptah-setup-status-widget>`
 * - One `<ptah-prompt-suggestions>`
 * - Hieroglyphic footer
 *
 * Design System:
 * - Anubis theme: Lapis Lazuli Blue + Pharaoh's Gold
 * - Cinzel font for Egyptian elegance
 * - Glass morphism effects with golden shadows
 * - Hieroglyphic symbols: 𓀀 𓂀 𓁹 (Unicode Egyptian Hieroglyphs)
 *
 * SOLID Principles:
 * - Single Responsibility: Display the empty state and route to the Marketplace
 * - Open/Closed: Extensible via composition, closed for modification
 * - Composition: Embeds setup-status-widget and prompt-suggestions by selector
 * - Dependency Inversion: Depends on the `@ptah-extension/core` service
 *   abstractions rather than on the Marketplace library, which `chat` must not
 *   import — the page is addressed through `AppStateManager.openMarketplace`.
 */
@Component({
  selector: 'ptah-chat-empty-state',
  imports: [
    SetupStatusWidgetComponent,
    PromptSuggestionsComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
    ChatEmptyStateComponent - Premium Responsive Design

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
      <div class="relative w-full max-w-md lg:max-w-lg mb-6">
        <div class="flex flex-col items-center text-center">
          <!-- Logo with Divine Aura -->
          <div class="relative mb-4">
            <div
              class="absolute inset-0 -m-2 rounded-full divine-glow opacity-50"
            ></div>

            <img
              [src]="ptahIconUri"
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
          <p class="text-xs md:text-sm text-base-content-muted max-w-xs">
            Ancient Wisdom • Master Craftsman
          </p>
        </div>
      </div>

      <div class="w-full max-w-md lg:max-w-lg space-y-5 tab-content-animated">
        <!-- Warning if skills not configured -->
        @if (!hasConfiguredSkills()) {
          <div
            class="border border-base-300 rounded-md bg-base-200/50 p-3 flex items-start gap-2"
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
              <p class="text-xs text-base-content-muted leading-relaxed mb-2">
                The Intelligent Project Setup uses your configured skills to
                provide better recommendations. It's recommended to configure
                your Ptah Skills first for optimal results.
              </p>
              <button
                class="btn btn-xs btn-primary btn-outline"
                (click)="openMarketplaceSkills()"
                type="button"
              >
                Open Marketplace Skills
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
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0 agent-working"
              >
                <lucide-angular
                  [img]="ScanSearchIcon"
                  class="w-5 h-5 md:w-6 md:h-6"
                  aria-hidden="true"
                />
              </div>
              <div class="flex-1">
                <h3
                  class="text-sm md:text-base font-semibold text-primary mb-0.5"
                >
                  Intelligent Project Setup
                </h3>
                <p class="text-xs text-base-content-muted leading-relaxed">
                  MCP-powered scanning analyzes your workspace, detects
                  frameworks, and configures optimal AI agents automatically.
                </p>
              </div>
            </div>

            <!-- Feature Badges using DaisyUI -->
            <div class="flex flex-wrap gap-1.5 mb-3">
              <span class="badge badge-sm badge-ghost gap-1">
                <span class="text-[10px]">⚡</span> Auto-detect
              </span>
              <span class="badge badge-sm badge-ghost gap-1">
                <span class="text-[10px]">🔗</span> VS Code AI
              </span>
              <span class="badge badge-sm badge-ghost gap-1">
                <span class="text-[10px]">🛠️</span> MCP Server
              </span>
            </div>

            <!-- Setup Status Widget Integration -->
            <ptah-setup-status-widget />
          </div>
        </div>

        <!-- Prompt Suggestions -->
        <ptah-prompt-suggestions
          (promptSelected)="promptSelected.emit($event)"
        />
      </div>

      <!-- Decorative Egyptian Footer -->
      <div
        class="flex items-center justify-center gap-2 mt-auto pt-4 text-secondary/30"
        aria-hidden="true"
      >
        <span class="text-sm tracking-[0.5em]">𓀀𓂀𓁹𓂀𓀀</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        /* Use CSS variable from design system for subtle gradient */
        background: var(--gradient-panel);
      }

      /* Content reveal animation */
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
    `,
  ],
})
export class ChatEmptyStateComponent implements OnInit {
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  /**
   * The same shared catalog the setup widget reads (TASK_2026_345). This
   * component used to issue a bare `plugins:get-config` of its own, on a view
   * whose widget had already read it.
   */
  private readonly catalog = inject(PluginCatalogService);

  /** Emitted when user selects a prompt suggestion */
  readonly promptSelected = output<string>();

  /** Lucide icon references for template binding */
  protected readonly ScanSearchIcon = ScanSearch;
  protected readonly AlertTriangleIcon = AlertTriangle;

  /** Ptah icon URI - uses same method as app-shell component */
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  /**
   * Whether skills are configured (used for the "not configured" warning).
   *
   * Derived from the shared catalog rather than a private signal fed by a
   * private RPC. The warning is deliberately SUPPRESSED until the catalog has
   * been read: `hasEnabledPlugins` is false on an empty store, and flashing
   * "you have no skills" at a user who has plenty is worse than showing nothing
   * for one round trip.
   */
  protected readonly hasConfiguredSkills = computed(
    () => !this.catalog.isLoaded() || this.catalog.hasEnabledPlugins(),
  );

  /**
   * Read the catalog once so the warning above can evaluate.
   *
   * This read used to hang off `setActiveTab('setup')`; with the tab bar gone
   * the warning is on screen from the first paint, so the read has to happen
   * here. It is a no-op when another consumer of the shared catalog already
   * loaded it, which is the normal case.
   */
  ngOnInit(): void {
    void this.catalog.ensureLoaded();
  }

  /**
   * Open the Marketplace on the Ptah plugins skill source — where the catalog
   * is now edited inline.
   *
   * `chat` must not import `@ptah-extension/marketplace`, so the page is a
   * `core` `MarketplaceRoute` and `AppStateManager.openMarketplace` navigates
   * to it through the Router, under its busy guard.
   */
  protected openMarketplaceSkills(): void {
    this.appState.openMarketplace({ page: 'skills', source: 'ptah-plugins' });
  }
}
