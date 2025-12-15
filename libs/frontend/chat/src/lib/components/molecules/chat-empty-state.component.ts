import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { SetupStatusWidgetComponent } from './setup-status-widget.component';
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
  imports: [SetupStatusWidgetComponent, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
    ChatEmptyStateComponent - Compact VS Code Sidebar Design
    
    Follows VS Code UX Guidelines:
    - Icons: 16-24px (was 72px)
    - Headings: 14-16px (was 36px)
    - Padding: 12-16px (was 32px)
    - Compact single-column layout
    -->

    <div class="flex flex-col items-center h-full px-3 py-3">
      <!-- Compact Header -->
      <div class="flex flex-col items-center gap-1 mb-3 text-center">
        <img
          [ngSrc]="ptahIconUri"
          alt="Ptah"
          width="24"
          height="24"
          class="w-6 h-6"
        />
        <div class="text-center">
          <h1 class="text-sm font-semibold text-secondary leading-tight">
            Ptah
          </h1>
          <p class="text-xs text-base-content/60">
            Divine Creator • Master Craftsman
          </p>
        </div>
      </div>

      <!-- Setup Status Widget -->
      <div class="mb-3">
        <ptah-setup-status-widget />
      </div>

      <!-- Compact Capabilities -->
      <div class="glass-panel rounded-md p-3 mb-3">
        <div class="flex items-center gap-1.5 mb-2">
          <span class="text-secondary text-sm">☥</span>
          <h3
            class="text-xs font-medium text-secondary uppercase tracking-wide"
          >
            Capabilities
          </h3>
        </div>
        <ul class="space-y-1 text-xs text-base-content/80">
          <li class="flex items-center gap-1.5">
            <span class="text-secondary text-xs" aria-hidden="true">𓂀</span>
            <span>Orchestrate multi-agent workflows</span>
          </li>
          <li class="flex items-center gap-1.5">
            <span class="text-secondary text-xs" aria-hidden="true">𓁹</span>
            <span>Architect & generate code</span>
          </li>
          <li class="flex items-center gap-1.5">
            <span class="text-secondary text-xs" aria-hidden="true">𓅓</span>
            <span>Review, test & modernize</span>
          </li>
        </ul>
      </div>

      <!-- Compact Command Hint -->
      <div class="border border-secondary/20 rounded-md p-2.5 bg-base-200/50">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-sm">📜</span>
          <span class="text-xs font-medium text-base-content">Get Started</span>
        </div>
        <div
          class="bg-base-300 rounded px-2 py-1 font-mono text-xs text-secondary"
        >
          /orchestrate [your vision]
        </div>
      </div>

      <!-- Subtle decorative footer -->
      <div
        class="flex items-center justify-center gap-1 mt-auto pt-2 text-secondary/40 text-xs"
        aria-hidden="true"
      >
        <span>𓀀</span>
        <span>𓂀</span>
        <span>𓁹</span>
        <span>𓂀</span>
        <span>𓀀</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      /* Compact glass-panel for sidebar */
      .glass-panel {
        background: var(--glass-panel);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border);
      }
    `,
  ],
})
export class ChatEmptyStateComponent {
  private readonly vscodeService = inject(VSCodeService);

  /** Ptah icon URI - uses same method as app-shell component */
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
}
