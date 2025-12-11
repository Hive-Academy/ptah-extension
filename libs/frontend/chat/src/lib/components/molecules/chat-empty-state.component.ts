import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
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
  standalone: true,
  imports: [SetupStatusWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Egyptian Artifact Container -->
    <div
      class="flex flex-col items-center justify-center h-full text-center px-6 py-8"
    >
      <!-- Ancient Egyptian Header -->
      <div class="mb-6">
        <!-- Hieroglyphic Border Top -->
        <div
          class="flex items-center justify-center gap-2 mb-4 text-secondary opacity-60"
        >
          <span class="text-2xl">𓀀</span>
          <span class="text-xl">𓂀</span>
          <span class="text-2xl">𓁹</span>
          <span class="text-xl">𓂀</span>
          <span class="text-2xl">𓀀</span>
        </div>

        <!-- Ptah Icon (Divine Creator God) -->
        <div
          class="text-7xl mb-4 animate-pulse"
          style="animation-duration: 3s;"
        >
          🏛️
        </div>

        <!-- Ancient Wisdom Title (Cinzel font for Egyptian elegance) -->
        <h1
          class="text-4xl font-display font-bold text-secondary mb-2"
          style="text-shadow: 0 0 20px rgba(212, 175, 55, 0.3);"
        >
          Ptah
        </h1>
        <p class="text-sm text-base-content/60 font-display italic mb-1">
          Divine Creator • Master Craftsman
        </p>
        <p class="text-base text-base-content/80 max-w-md mx-auto">
          Ancient AI wisdom meets modern development power
        </p>
      </div>

      <!-- Setup Status Widget (Prominent Display) -->
      <div class="w-full max-w-2xl mb-8">
        <ptah-setup-status-widget />
      </div>

      <!-- Sacred Knowledge Section -->
      <div class="glass-panel rounded-lg p-6 max-w-2xl w-full mb-6">
        <!-- Ankh Symbol (Key of Life - Represents AI Capabilities) -->
        <div class="text-4xl text-secondary mb-3">☥</div>

        <h3 class="text-lg font-semibold text-secondary mb-3 font-display">
          Powers Bestowed by the Gods
        </h3>

        <div
          class="grid grid-cols-1 md:grid-cols-2 gap-3 text-left text-sm text-base-content/80"
        >
          <!-- Left Column -->
          <div class="space-y-2">
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓂀</span>
              <span>Orchestrate multi-agent workflows</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓁹</span>
              <span>Architect complex systems</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓃀</span>
              <span>Generate production code</span>
            </div>
          </div>

          <!-- Right Column -->
          <div class="space-y-2">
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓅓</span>
              <span>Review with divine precision</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓆣</span>
              <span>Test with sacred rigor</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-secondary mt-0.5">𓋹</span>
              <span>Modernize ancient codebases</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Papyrus Scroll - Getting Started -->
      <div
        class="border border-secondary/30 rounded-lg p-5 max-w-2xl w-full bg-base-200/50"
      >
        <!-- Papyrus Texture Accent -->
        <div class="flex items-center gap-2 mb-3">
          <span class="text-2xl">📜</span>
          <h4 class="text-md font-semibold text-base-content font-display">
            Invoke the Divine
          </h4>
        </div>

        <p class="text-sm text-base-content/70 mb-3">
          Begin your journey by invoking the sacred command:
        </p>

        <div
          class="bg-base-300 rounded px-3 py-2 font-mono text-sm text-secondary border border-secondary/20"
        >
          /orchestrate [your vision]
        </div>

        <p class="text-xs text-base-content/60 mt-3 italic">
          The gods will summon the pantheon of specialist agents to fulfill your
          command
        </p>
      </div>

      <!-- Hieroglyphic Border Bottom -->
      <div
        class="flex items-center justify-center gap-2 mt-6 text-secondary opacity-60"
      >
        <span class="text-2xl">𓀀</span>
        <span class="text-xl">𓂀</span>
        <span class="text-2xl">𓁹</span>
        <span class="text-xl">𓂀</span>
        <span class="text-2xl">𓀀</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      /* Enhance glass-panel for Egyptian aesthetic */
      .glass-panel {
        background: var(--glass-panel);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border);
        box-shadow: 0 0 20px rgba(212, 175, 55, 0.1),
          inset 0 1px 0 rgba(212, 175, 55, 0.2);
      }

      /* Golden glow animation for Ptah icon */
      @keyframes golden-glow {
        0%,
        100% {
          filter: drop-shadow(0 0 8px rgba(212, 175, 55, 0.4));
        }
        50% {
          filter: drop-shadow(0 0 16px rgba(212, 175, 55, 0.6));
        }
      }
    `,
  ],
})
export class ChatEmptyStateComponent {
  private readonly vscodeService = inject(VSCodeService);
}
