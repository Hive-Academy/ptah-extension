import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import {
  CheckCircle,
  LucideAngularModule,
  Palette,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Users,
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

  /** Prompt categories with intelligent suggestions covering shipped Ptah skills and commands */
  readonly categories: PromptCategory[] = [
    {
      id: 'build',
      label: 'Build',
      icon: Sparkles,
      hieroglyph: '\u{13080}', // 𓂀
      prompts: [
        {
          label: 'Orchestrate a feature',
          text: '/orchestrate Build [describe your feature] with full workflow orchestration',
          description: 'Plan, implement, review',
        },
        {
          label: 'Bootstrap SaaS workspace',
          text: '/saas-workspace-initializer Initialize a new SaaS project with Nx, NestJS, and Angular',
          description: 'Nx + NestJS + Angular',
        },
        {
          label: 'Design NestJS feature',
          text: '/nestjs-backend-patterns Design a NestJS feature module for [domain] with provider pattern and Prisma',
          description: 'Controller-service-Prisma',
        },
        {
          label: 'Add Angular component',
          text: '/angular-frontend-patterns Add a new Angular component with signals, OnPush, and smart/dumb split',
          description: 'Signals, OnPush, split',
        },
        {
          label: 'Generate project harness',
          text: 'Open the Setup Wizard, scan this workspace, analyze the project, and generate a harness.',
          description: 'Setup wizard scan',
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
          text: "/orchestrate BUGFIX: Fix [describe the bug you're seeing]",
          description: 'Diagnose, fix, verify',
        },
        {
          label: 'Run fix fleet',
          text: '/fleet-orchestration Run a multi-agent fix fleet on [task spec range]',
          description: 'Multi-agent bugfix batch',
        },
        {
          label: 'Humanize messy library',
          text: '/humanize-library Refactor [library path] into single-responsibility files with clear names and no duplication',
          description: 'Refactor for readability',
        },
        {
          label: 'Extract UI feature',
          text: '/extract-and-relocate-angular-component-feature Move [feature] from [source component] into a new self-contained component in [destination]',
          description: 'Move feature to component',
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
          text: '/review-code',
          description: 'Style, patterns, best practices',
        },
        {
          label: 'Logic correctness review',
          text: '/review-logic',
          description: 'Business logic & edge cases',
        },
        {
          label: 'Security vulnerability scan',
          text: '/review-security',
          description: 'OWASP top 10, auth, injection',
        },
        {
          label: 'Code review tribunal',
          text: '/tribunal Review [module] with a multi-vendor panel and synthesize a cited verdict',
          description: 'Multi-vendor cited verdict',
        },
        {
          label: 'Audit UX',
          text: '/impeccable Audit the UX of [page/component] for accessibility, visual hierarchy, and performance',
          description: 'Accessibility and hierarchy',
        },
      ],
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: Users,
      hieroglyph: '\u{1312D}', // 𓄭
      prompts: [
        {
          label: 'Spawn CLI agent lane',
          text: '/agent-lanes Spawn a background CLI agent lane to implement [task]',
          description: 'Background implementation worker',
        },
        {
          label: 'Run headless Ptah',
          text: '/ptah-cli-usage Run a headless Ptah CLI session over JSON-RPC to [execute task/serve MCP]',
          description: 'JSON-RPC CI pipeline',
        },
        {
          label: 'Start tribunal panel',
          text: '/tribunal Start a tribunal panel for [topic] and render a cited verdict',
          description: 'Council, Forge, or Crucible',
        },
        {
          label: 'Deploy fix fleet',
          text: '/fleet-orchestration Deploy a fix fleet across [task spec range] with judge and commit',
          description: 'Parallel agent task swarm',
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
          text: '/orchestrate RESEARCH: Analyze the codebase architecture, map the dependency graph, and document key patterns and boundaries',
          description: 'Dependency graph deep dive',
        },
        {
          label: 'Index workspace',
          text: 'Use Workspace Indexing to scan this workspace and report symbols, dependencies, and code quality metrics.',
          description: 'Symbols and quality metrics',
        },
        {
          label: 'View task board',
          text: 'Show the .ptah/specs task board and report tasks grouped by status.',
          description: '.ptah/specs statuses',
        },
        {
          label: 'Browse marketplace',
          text: 'Open the Ptah Marketplace and list available plugins or skills for [category].',
          description: 'Plugins and skills',
        },
        {
          label: 'Search memory',
          text: 'Search the Memory Curator for prior decisions and context about [topic].',
          description: 'Prior decisions',
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
          label: 'Design landing page',
          text: '/ui-ux-designer Design a landing page for [product] with brand discovery and design tokens',
          description: 'Brand discovery and tokens',
        },
        {
          label: 'Add 3D scene',
          text: '/angular-3d-scene-crafter Create a 3D hero scene with neon lights and floating geometric shapes',
          description: 'Three.js Angular scene',
        },
        {
          label: 'Add scroll animation',
          text: '/angular-gsap-animation-crafter Add scroll-triggered animations with parallax to [section]',
          description: 'GSAP ScrollTrigger effects',
        },
        {
          label: 'Write technical content',
          text: '/technical-content-writer Write a technical blog post about [topic] grounded in our codebase',
          description: 'Blog grounded in code',
        },
        {
          label: 'Record video showcase',
          text: '/video-showcase Record a narrated marketing demo of [feature]',
          description: 'Narrated product demo',
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
