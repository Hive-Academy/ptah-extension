import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { LucideAngularModule, ScanSearch, Puzzle } from 'lucide-angular';
import { SetupStatusWidgetComponent } from './setup-status-widget.component';
import { PluginStatusWidgetComponent } from './plugin-status-widget.component';
import { PluginBrowserModalComponent } from './plugin-browser-modal.component';
import { VSCodeService } from '@ptah-extension/core';

/**
 * ChatEmptyStateComponent - Egyptian-themed empty state for chat view
 *
 * Complexity Level: 2 (Medium - composition + theming)
 * Patterns: Signal-based state, Component composition, DaisyUI styling
 *
 * Features:
 * - Egyptian artifact reveal experience with Anubis theme
 * - Hieroglyphic Unicode symbols for visual flair
 * - Ptah (Divine Creator) branding with Cinzel font
 * - Integrated setup-status-widget component
 * - Integrated plugin-status-widget and plugin-browser-modal (TASK_2025_153)
 * - Professional AI capabilities showcase
 * - Sacred command invocation guide (/orchestrate)
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
 * - Single Responsibility: Display empty state with Egyptian theme
 * - Open/Closed: Extensible via composition, closed for modification
 * - Composition: Embeds setup-status-widget via component selector
 * - Dependency Inversion: Depends on VSCodeService abstraction
 */
@Component({
  selector: 'ptah-chat-empty-state',
  imports: [
    SetupStatusWidgetComponent,
    PluginStatusWidgetComponent,
    PluginBrowserModalComponent,
    NgOptimizedImage,
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
            Divine Creator • Master Craftsman
          </p>
        </div>
      </div>

      <!-- Smart Setup CTA Card - Glass Panel -->
      <div class="w-full max-w-md mb-5">
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
      </div>

      <!-- Plugin Configuration Card (TASK_2025_153) -->
      <div class="w-full max-w-md mb-5">
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
            <ptah-plugin-status-widget
              (configureClicked)="openPluginBrowser()"
            />
          </div>
        </div>
      </div>

      <!-- Capabilities Section -->
      <div class="w-full max-w-md mb-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-secondary text-base">☥</span>
          <h3
            class="text-xs md:text-sm font-semibold text-secondary uppercase tracking-wider"
          >
            Capabilities
          </h3>
          <div
            class="divider divider-horizontal flex-1 my-0 before:bg-secondary/20 after:bg-transparent"
          ></div>
        </div>

        <div class="grid grid-cols-3 gap-1.5 md:gap-2">
          <div
            class="card bg-base-200/50 border border-base-300 hover:border-secondary/30 hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
          >
            <div class="card-body items-center text-center p-2 md:p-3">
              <span class="text-base md:text-xl">𓂀</span>
              <span class="text-[10px] md:text-xs font-medium"
                >Orchestrate</span
              >
              <span class="text-[8px] md:text-[10px] text-base-content/50"
                >Workflows</span
              >
            </div>
          </div>
          <div
            class="card bg-base-200/50 border border-base-300 hover:border-secondary/30 hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
          >
            <div class="card-body items-center text-center p-2 md:p-3">
              <span class="text-base md:text-xl">𓁹</span>
              <span class="text-[10px] md:text-xs font-medium">Architect</span>
              <span class="text-[8px] md:text-[10px] text-base-content/50"
                >Gen code</span
              >
            </div>
          </div>
          <div
            class="card bg-base-200/50 border border-base-300 hover:border-secondary/30 hover:bg-base-200 transition-all duration-200 hover:-translate-y-0.5"
          >
            <div class="card-body items-center text-center p-2 md:p-3">
              <span class="text-base md:text-xl">𓅓</span>
              <span class="text-[10px] md:text-xs font-medium">Review</span>
              <span class="text-[8px] md:text-[10px] text-base-content/50"
                >Modernize</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Get Started Command -->
      <div class="w-full max-w-md">
        <div class="card bg-base-300/50 border border-base-content/10">
          <div class="card-body p-4">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-base">📜</span>
              <span class="text-xs md:text-sm font-semibold text-base-content"
                >Get Started</span
              >
            </div>
            <div class="mockup-code bg-base-100 py-2 px-4 min-h-0">
              <pre
                data-prefix=">"
                class="text-secondary"
              ><code class="text-xs md:text-sm">/orchestrate <span class="text-base-content/40">[your vision]</span></code></pre>
            </div>
            <p class="text-[10px] md:text-xs text-base-content/50 mt-2">
              Describe what you want to build and let Ptah orchestrate the
              workflow
            </p>
          </div>
        </div>
      </div>

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

      /* Minimal custom styles - only what's not in the design system */

      /* Card body override for compact layout */
      .card-body {
        padding: var(--sidebar-spacing-md);
      }

      /* Mockup code minimal height */
      .mockup-code {
        min-height: auto;
      }

      .mockup-code pre {
        padding-top: 0.25rem;
        padding-bottom: 0.25rem;
      }
    `,
  ],
})
export class ChatEmptyStateComponent {
  private readonly vscodeService = inject(VSCodeService);

  /** Lucide icon references for template binding */
  protected readonly ScanSearchIcon = ScanSearch;
  protected readonly PuzzleIcon = Puzzle;

  /** Ptah icon URI - uses same method as app-shell component */
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  /** Whether the plugin browser modal is open (TASK_2025_153) */
  protected readonly isPluginBrowserOpen = signal(false);

  /** Open the plugin browser modal */
  protected openPluginBrowser(): void {
    this.isPluginBrowserOpen.set(true);
  }

  /** Close the plugin browser modal */
  protected closePluginBrowser(): void {
    this.isPluginBrowserOpen.set(false);
  }

  /** Handle plugins saved event from modal */
  protected onPluginsSaved(enabledIds: string[]): void {
    this.isPluginBrowserOpen.set(false);
    // Plugin config saved via RPC in the modal - no additional action needed
  }
}
