import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { PROMPT_CATALOGUE, type PromptItem } from './prompt-catalogue';

/**
 * PromptSuggestionsComponent - Tab-based prompt suggestions with mini cards
 *
 * Complexity Level: 1 (Simple - static data, signal toggle, output event)
 * Patterns: Signal-based state, output() API, DaisyUI styling, Tab navigation
 *
 * Features:
 * - 6 category tabs in a 3×2 mini-card grid (Build, Fix, Review, Agents, Explore, Creative)
 * - Covers all Ptah skills: orchestration, /simplify, /review-*, CLI agents, MCP tools, 3D scenes, GSAP, content
 * - Selected tab shows prompt cards below with fade animation
 * - Clicking a prompt card emits full text to parent for chat input fill
 * - Egyptian/Anubis theme with hieroglyphic symbols
 * - Compact layout for ~300px sidebar width
 *
 * SOLID Principles:
 * - Single Responsibility: Display prompt suggestions and emit selection
 * - Open/Closed: Extensible via prompt data, closed for modification
 * - Dependency Inversion: No injected services; pure presentational component
 */
@Component({
  selector: 'ptah-prompt-suggestions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full" data-glass-surface="tile">
      <!-- Section header -->
      <div class="flex items-center gap-2 mb-3">
        <span class="text-secondary text-base">📜</span>
        <h3
          class="text-xs md:text-sm font-semibold text-secondary uppercase tracking-wider"
        >
          Get Started
        </h3>
        <div
          class="divider divider-horizontal flex-1 my-0 before:bg-secondary/20 after:bg-transparent"
        ></div>
      </div>

      <!-- Category tabs as 3×2 mini-card grid -->
      <div class="grid grid-cols-3 gap-1 md:gap-1.5 mb-3">
        @for (category of categories; track category.id) {
          <button
            [class]="
              'category-tab flex flex-col items-center text-center p-1.5 md:p-2 rounded-lg border transition-all duration-200 cursor-pointer ' +
              (activeCategory() === category.id
                ? 'active border-secondary bg-secondary/10'
                : 'border-base-300 bg-base-200/30')
            "
            (click)="setCategory(category.id)"
            type="button"
            [title]="category.label + ' prompts'"
          >
            <span class="text-xs md:text-sm leading-none">{{
              category.hieroglyph
            }}</span>
            <span
              [class]="
                'text-[9px] md:text-[10px] font-medium mt-0.5 leading-tight ' +
                (activeCategory() === category.id ? 'text-secondary' : '')
              "
              >{{ category.label }}</span
            >
          </button>
        }
      </div>

      <!-- Prompt cards for selected category -->
      @if (activePrompts(); as prompts) {
        <div class="space-y-1.5 prompt-cards-animated">
          @for (prompt of prompts; track prompt.label) {
            <button
              class="w-full text-left px-3 py-2 rounded-lg text-xs
                     bg-base-200/40 hover:bg-primary/10
                     border border-base-300/50 hover:border-primary/30
                     transition-all duration-150 cursor-pointer group"
              (click)="selectPrompt(prompt)"
              [title]="prompt.text"
              type="button"
            >
              <span class="font-medium group-hover:text-primary">{{
                prompt.label
              }}</span>
              @if (prompt.description) {
                <span
                  class="block text-[10px] text-base-content-muted mt-0.5 group-hover:text-primary/50"
                >
                  {{ prompt.description }}
                </span>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .category-tab:hover:not(.active) {
        background-color: oklch(var(--b2) / 0.6);
        border-color: oklch(var(--bc) / 0.15);
      }

      .category-tab.active {
        box-shadow: 0 0 8px oklch(var(--s) / 0.15);
      }

      .prompt-cards-animated {
        animation: fadeSlideIn 0.25s ease-out;
      }

      @keyframes fadeSlideIn {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class PromptSuggestionsComponent {
  /** Emitted when user clicks a prompt suggestion */
  readonly promptSelected = output<string>();

  /** Currently selected category tab */
  readonly activeCategory = signal<string>('build');

  /** Prompts for the active category */
  readonly activePrompts = computed(() => {
    const id = this.activeCategory();
    return this.categories.find((c) => c.id === id)?.prompts ?? [];
  });

  /** Prompt categories, shared with the empty-chat launchers (prompt-catalogue.ts). */
  readonly categories = PROMPT_CATALOGUE;

  /** Set active category tab */
  setCategory(categoryId: string): void {
    this.activeCategory.set(categoryId);
  }

  /** Handle prompt click - emit the full prompt text */
  selectPrompt(prompt: PromptItem): void {
    this.promptSelected.emit(prompt.text);
  }
}
