import {
  CheckCircle,
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
export interface PromptCategory {
  id: string;
  label: string;
  icon: LucideIconData;
  hieroglyph: string;
  prompts: PromptItem[];
}

/**
 * Individual prompt item within a category.
 */
export interface PromptItem {
  label: string;
  text: string;
  description?: string;
}

/**
 * The prompt catalogue shared by the composer `/` menu and the empty-chat
 * launchers (TASK_2026_721 D19: a launcher prefills the first prompt of its
 * category).
 *
 * Prompt categories with intelligent suggestions covering shipped Ptah skills and commands.
 */
export const PROMPT_CATALOGUE: readonly PromptCategory[] = [
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
        text: '/orchestrate TASK_A TASK_B Run a multi-agent fix fleet',
        description: 'Multi-agent bugfix batch',
      },
      {
        label: 'Humanize messy library',
        text: '/humanize-library Refactor [library path] into single-responsibility files with clear names and no duplication',
        description: 'Refactor for readability',
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
        text: '/orchestrate TASK_A TASK_B Coordinate a fix fleet with judge and commit',
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

/** The categories the empty-chat launchers show, in order (D19). */
export const LAUNCHER_IDS = ['build', 'fix', 'review', 'explore'] as const;

/** A category id the empty-chat launchers show. */
export type LauncherId = (typeof LAUNCHER_IDS)[number];
