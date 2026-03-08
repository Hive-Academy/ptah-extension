import {
  Component,
  ChangeDetectionStrategy,
  output,
  signal,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  Sparkles,
  RefreshCw,
  CheckCircle,
  ScanSearch,
  Palette,
  Rocket,
  type LucideIconData,
} from 'lucide-angular';

/**
 * Prompt category definition for the tab-card layout.
 */
interface PromptCategory {
  id: string;
  label: string;
  icon: LucideIconData;
  hieroglyph: string;
  prompts: PromptItem[];
}

/**
 * Individual prompt item within a category.
 */
interface PromptItem {
  label: string;
  text: string;
  description?: string;
}

/**
 * PromptSuggestionsComponent - Tab-based prompt suggestions with mini cards
 *
 * Complexity Level: 1 (Simple - static data, signal toggle, output event)
 * Patterns: Signal-based state, output() API, DaisyUI styling, Tab navigation
 *
 * Features:
 * - 6 category tabs in a 3×2 mini-card grid (Build, Fix, Review, Creative, DevOps, Explore)
 * - Covers all Ptah skills: orchestration, /ptah-core:simplify, /review-*, 3D scenes, GSAP, content, DevOps
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
    <div class="w-full">
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
            class="block text-[10px] text-base-content/40 mt-0.5 group-hover:text-primary/50"
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

  /** Prompt categories with intelligent suggestions covering all Ptah skills */
  readonly categories: PromptCategory[] = [
    {
      id: 'build',
      label: 'Build',
      icon: Sparkles,
      hieroglyph: '\u{13080}', // 𓂀
      prompts: [
        {
          label: 'Orchestrate a feature',
          text: '/ptah-core:orchestrate Build [describe your feature] with full workflow orchestration',
          description: 'PM → Architect → Dev → QA pipeline',
        },
        {
          label: 'Create API endpoint',
          text: '/ptah-core:orchestrate Create a REST API endpoint for [resource] with CRUD operations',
          description: 'REST CRUD scaffold',
        },
        {
          label: 'Build a component',
          text: '/ptah-core:orchestrate Add a new [component name] component with tests and documentation',
          description: 'Component + tests + docs',
        },
      ],
    },
    {
      id: 'fix',
      label: 'Fix',
      icon: RefreshCw,
      hieroglyph: '\u{13079}', // 𓁹
      prompts: [
        {
          label: 'Fix a bug',
          text: "/ptah-core:orchestrate BUGFIX: Fix [describe the bug you're seeing]",
          description: 'Diagnose → fix → verify',
        },
        {
          label: 'Simplify changed code',
          text: '/ptah-core:simplify',
          description: 'Review recent changes for reuse & quality',
        },
        {
          label: 'Refactor module',
          text: '/ptah-core:orchestrate REFACTORING: Modernize [component/module] to use current patterns',
          description: 'Modernize + optimize',
        },
      ],
    },
    {
      id: 'review',
      label: 'Review',
      icon: CheckCircle,
      hieroglyph: '\u{13153}', // 𓅓
      prompts: [
        {
          label: 'Code quality review',
          text: '/ptah-core:review-code',
          description: 'Style, patterns, best practices',
        },
        {
          label: 'Logic correctness review',
          text: '/ptah-core:review-logic',
          description: 'Business logic & edge cases',
        },
        {
          label: 'Security vulnerability scan',
          text: '/ptah-core:review-security',
          description: 'OWASP top 10, auth, injection',
        },
      ],
    },
    {
      id: 'creative',
      label: 'Creative',
      icon: Palette,
      hieroglyph: '\u{130B8}', // 𓂸
      prompts: [
        {
          label: 'Design a landing page',
          text: '/ptah-core:orchestrate CREATIVE: Design and build a landing page with hero section, features, and pricing',
          description: 'UI/UX → Content → Frontend',
        },
        {
          label: 'Add 3D hero scene',
          text: 'Create a 3D hero scene with neon lights and floating geometric shapes using @hive-academy/angular-3d',
          description: 'Three.js declarative components',
        },
        {
          label: 'Add scroll animations',
          text: 'Add smooth scroll-triggered animations with parallax effects using GSAP ScrollTrigger',
          description: 'GSAP + angular-gsap directives',
        },
        {
          label: 'Write technical content',
          text: '/ptah-core:orchestrate CREATIVE: Write a technical blog post about [topic] based on our codebase implementation',
          description: 'Blog, docs, or video scripts',
        },
      ],
    },
    {
      id: 'devops',
      label: 'DevOps',
      icon: Rocket,
      hieroglyph: '\u{13171}', // 𓅱
      prompts: [
        {
          label: 'Setup CI/CD pipeline',
          text: '/ptah-core:orchestrate DEVOPS: Set up CI/CD pipeline with automated testing and deployment',
          description: 'GitHub Actions / Docker',
        },
        {
          label: 'Dockerize the project',
          text: '/ptah-core:orchestrate DEVOPS: Create Docker configuration with multi-stage build and compose setup',
          description: 'Dockerfile + docker-compose',
        },
        {
          label: 'Setup infrastructure',
          text: '/ptah-core:orchestrate DEVOPS: Configure deployment infrastructure with database, caching, and monitoring',
          description: 'DB + Redis + observability',
        },
      ],
    },
    {
      id: 'explore',
      label: 'Explore',
      icon: ScanSearch,
      hieroglyph: '\u{13000}', // 𓀀
      prompts: [
        {
          label: 'Analyze architecture',
          text: '/ptah-core:orchestrate RESEARCH: Analyze the codebase architecture and document key patterns',
          description: 'Architecture deep-dive',
        },
        {
          label: 'Generate documentation',
          text: '/ptah-core:orchestrate DOCUMENTATION: Generate comprehensive API documentation for [module]',
          description: 'API docs + usage examples',
        },
        {
          label: 'Explain how it works',
          text: 'Explain how [feature/system] works in this codebase',
          description: 'Codebase walkthrough',
        },
      ],
    },
  ];

  /** Set active category tab */
  setCategory(categoryId: string): void {
    this.activeCategory.set(categoryId);
  }

  /** Handle prompt click - emit the full prompt text */
  selectPrompt(prompt: PromptItem): void {
    this.promptSelected.emit(prompt.text);
  }
}
