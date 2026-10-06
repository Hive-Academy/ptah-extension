import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
} from '@angular/core';
import { PromptSuggestionsComponent } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import { ProjectSetupCardComponent } from './project-setup-card.component';

/**
 * ChatEmptyStateComponent - Egyptian-themed empty state for the chat view.
 *
 * Complexity Level: 1 (Low - composition + theming)
 * Patterns: Signal-based derivation, Component composition, DaisyUI styling
 *
 * Content (single column, no tabs):
 * - Hero: Ptah logo, title and tagline
 * - `<ptah-project-setup-card>` (skills warning + Intelligent Project Setup),
 *   only when `showProjectSetup` is set — i.e. on the single-chat view before
 *   any session exists. An empty session tile does not show it; the Orchestra
 *   Canvas shows it on its own no-tiles screen.
 * - One `<ptah-prompt-suggestions>`
 * - Hieroglyphic footer
 *
 * Design System:
 * - Anubis theme: Lapis Lazuli Blue + Pharaoh's Gold
 * - Cinzel font for Egyptian elegance
 * - Glass morphism effects with golden shadows
 * - Hieroglyphic symbols: 𓀀 𓂀 𓁹 (Unicode Egyptian Hieroglyphs)
 */
@Component({
  selector: 'ptah-chat-empty-state',
  imports: [PromptSuggestionsComponent, ProjectSetupCardComponent],
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
        @if (showProjectSetup()) {
          <ptah-project-setup-card />
        }

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
export class ChatEmptyStateComponent {
  private readonly vscodeService = inject(VSCodeService);

  /** Show the skills warning and the Intelligent Project Setup card. */
  readonly showProjectSetup = input(false);

  /** Emitted when user selects a prompt suggestion */
  readonly promptSelected = output<string>();

  /** Ptah icon URI - uses same method as app-shell component */
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
}
