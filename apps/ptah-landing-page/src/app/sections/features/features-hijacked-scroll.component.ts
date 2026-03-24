import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  FeatureShowcaseTimelineComponent,
  ViewportAnimationDirective,
  ScrollAnimationDirective,
} from '@hive-academy/angular-gsap';
import { NgClass, NgOptimizedImage } from '@angular/common';
import { LucideAngularModule, Eye, Check } from 'lucide-angular';

interface TimelineStep {
  id: string;
  step: number;
  title: string;
  description: string;
  image: string;
  layout: 'left' | 'right';
  notes: string[];
}

/**
 * FeaturesHijackedScrollComponent - Premium fullscreen features showcase
 *
 * Custom implementation using scrollAnimation directive directly
 * to avoid SplitPanelSectionComponent NgOptimizedImage issues.
 */
@Component({
  selector: 'ptah-features-hijacked-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    NgOptimizedImage,
    FeatureShowcaseTimelineComponent,
    ViewportAnimationDirective,
    ScrollAnimationDirective,
    LucideAngularModule,
  ],
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  template: `
    <div class="min-h-screen relative">
      <agsp-feature-showcase-timeline>
        <!-- Hero Section for Features -->
        <div
          featureHero
          class="relative text-center py-24 flex flex-col justify-center"
        >
          <!-- Decorative Pattern -->
          <div
            class="absolute inset-0 flex items-center justify-center pointer-events-none"
            scrollAnimation
            [scrollConfig]="{
              animation: 'custom',
              start: 'top 90%',
              end: 'bottom 30%',
              scrub: 0.5,
              from: { scale: 0.8, opacity: 0, rotation: -10 },
              to: { scale: 1.2, opacity: 0.3, rotation: 5 }
            }"
          >
            <div class="w-[800px] h-[800px] text-[#d4af37]/10 opacity-30">
              <img
                src="assets/icons/decorative-circle.svg"
                alt=""
                aria-hidden="true"
                class="w-full h-full"
              />
            </div>
          </div>

          <!-- Hero Content -->
          <div class="relative z-10 px-4">
            <div
              class="inline-block mb-8"
              viewportAnimation
              [viewportConfig]="{ animation: 'scaleIn', duration: 0.6 }"
            >
              <span
                class="inline-flex items-center gap-2 px-6 py-2 bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-full text-sm font-semibold text-[#f4d47c]"
              >
                <lucide-angular
                  [img]="EyeIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
                NEXT-GEN VISIBILITY
              </span>
            </div>

            <h2
              class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-8 leading-tight"
              viewportAnimation
              [viewportConfig]="{
                animation: 'slideUp',
                duration: 0.8,
                delay: 0.1
              }"
            >
              <span
                class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
              >
                Native Visual Interface
              </span>
            </h2>

            <p
              class="text-2xl text-gray-300 max-w-3xl mx-auto"
              viewportAnimation
              [viewportConfig]="{
                animation: 'fadeIn',
                duration: 0.8,
                delay: 0.2
              }"
            >
              Don't settle for a black box.
              <span class="text-white font-semibold">
                See your agents think, plan, and execute
              </span>
              in real-time with our revolutionary recursive visualization.
            </p>
          </div>
        </div>

        <!-- Feature Steps - Custom Implementation -->
        @for (step of features(); track step.id; let i = $index) {
        <section
          class="relative min-h-screen flex flex-col md:flex-row w-full overflow-hidden"
        >
          <!-- Image Side -->
          <div
            class="relative h-64 sm:h-80 w-full md:absolute md:inset-y-0 md:w-1/2 md:h-auto order-first"
            [ngClass]="{
              'md:right-0': step.layout === 'left',
              'md:left-0': step.layout === 'right'
            }"
            scrollAnimation
            [scrollConfig]="{
              animation: 'custom',
              start: 'top 80%',
              end: 'top 30%',
              scrub: 0.8,
              from: { opacity: 0, scale: 1.1 },
              to: { opacity: 1, scale: 1 }
            }"
          >
            <!-- Parallax Image Container -->
            <div class="absolute inset-0 overflow-hidden">
              <!-- Gradient overlay -->
              <div
                class="absolute inset-0 z-10"
                [ngClass]="{
                  'bg-gradient-to-r from-slate-900 via-slate-900/80 to-transparent':
                    step.layout === 'left',
                  'bg-gradient-to-l from-slate-900 via-slate-900/80 to-transparent':
                    step.layout === 'right'
                }"
              ></div>

              <!-- Image with parallax -->
              <div
                class="absolute inset-0"
                scrollAnimation
                [scrollConfig]="{
                  animation: 'parallax',
                  speed: 0.3,
                  scrub: true
                }"
              >
                <img
                  [ngSrc]="step.image"
                  [alt]="step.title"
                  width="1024"
                  height="1024"
                  class="w-full h-full object-cover object-center"
                  priority
                />
              </div>

              <!-- Accent glow -->
              <div
                class="absolute inset-0 z-5 bg-gradient-to-br from-[#d4af37]/10 to-[#f4d47c]/5"
              ></div>
            </div>
          </div>

          <!-- Text Content Side -->
          <div
            class="relative z-20 w-full md:w-1/2 min-h-[60vh] md:min-h-screen flex items-center"
            [ngClass]="{
              'md:ml-0': step.layout === 'left',
              'md:ml-auto': step.layout === 'right'
            }"
          >
            <div
              class="px-4 sm:px-6 md:px-8 lg:px-16 py-12 md:py-20 max-w-2xl"
              [ngClass]="{
                'ml-auto': step.layout === 'left',
                'mr-auto': step.layout === 'right'
              }"
            >
              <!-- Badge -->
              <div
                class="mb-8"
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 85%',
                  end: 'top 45%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: step.layout === 'left' ? -60 : 60,
                    scale: 0.8
                  },
                  to: { opacity: 1, x: 0, scale: 1 }
                }"
              >
                <div class="inline-flex items-center gap-3 mb-6">
                  <span
                    class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20"
                  >
                    {{ step.step }}
                  </span>
                  <div
                    class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent max-w-[120px]"
                  ></div>
                </div>
              </div>

              <!-- Title -->
              <div
                class="mb-6"
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 82%',
                  end: 'top 40%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: step.layout === 'left' ? -80 : 80,
                    y: 20
                  },
                  to: { opacity: 1, x: 0, y: 0 }
                }"
              >
                <h3
                  class="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight"
                >
                  {{ step.title }}
                </h3>
              </div>

              <!-- Description -->
              <div
                class="mb-8"
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 79%',
                  end: 'top 35%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: step.layout === 'left' ? -60 : 60,
                    y: 15
                  },
                  to: { opacity: 1, x: 0, y: 0 }
                }"
              >
                <p class="text-xl text-gray-300 leading-relaxed">
                  {{ step.description }}
                </p>
              </div>

              <!-- Notes/Features List -->
              <div
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 76%',
                  end: 'top 30%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: step.layout === 'left' ? -40 : 40,
                    y: 10
                  },
                  to: { opacity: 1, x: 0, y: 0 }
                }"
              >
                <div class="space-y-4">
                  @for (note of step.notes; track $index) {
                  <div class="flex items-start gap-3">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-6 h-6 text-[#d4af37] mt-0.5 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <p class="text-base text-gray-400">{{ note }}</p>
                  </div>
                  }
                </div>
              </div>
            </div>
          </div>
        </section>
        }
      </agsp-feature-showcase-timeline>
    </div>
  `,
})
export class FeaturesHijackedScrollComponent {
  /** Lucide icon references */
  public readonly EyeIcon = Eye;
  public readonly CheckIcon = Check;

  public readonly features = signal<TimelineStep[]>([
    {
      id: 'visual-interface',
      step: 1,
      title: 'Recursive Agent Visualization',
      description:
        'Watch in real-time as your main agent spawns sub-agents, delegates tasks, and executes tools. See the "Software Architect" hand off to the "Frontend Developer," inspect the tree structure of their collaboration, and verify every file change with beautiful, glassmorphism-styled component visibility.',
      image: '/assets/images/showcase/ptah-visual-interface.png',
      layout: 'left',
      notes: [
        'Real-time execution tree',
        'Sub-agent delegation visibility',
        'Tool call inspection',
        'Glassmorphism UI',
      ],
    },
    {
      id: 'mcp-server',
      step: 2,
      title: 'Code Execution MCP Server',
      description:
        'Ptah includes a Code Execution MCP server that exposes 14 powerful API namespaces to any connected AI agent. Your provider of choice can query your workspace structure, search files semantically, analyze code with tree-sitter AST, check diagnostics, build dependency graphs, and access LSP superpowers.',
      image: '/assets/images/showcase/ptah-mcp-server.png',
      layout: 'right',
      notes: [
        '14 Ptah API namespaces',
        'Semantic file search',
        'Tree-sitter AST analysis',
        'LSP & dependency graphs',
      ],
    },
    {
      id: 'setup-wizard',
      step: 3,
      title: 'Intelligent Setup Wizard',
      description:
        "Don't settle for generic chat. Ptah's Intelligent Setup Wizard scans your codebase, detects your tech stack, and uses LLM-powered generation to create custom agents tailored to your project logic. Transform a generic helper into a specialized team member.",
      image: '/assets/images/showcase/ptah-setup-wizard.png',
      layout: 'left',
      notes: [
        '6-step automated flow',
        'Project stack detection',
        'LLM-powered rule generation',
        'Custom agent creation',
      ],
    },
    {
      id: 'model-control',
      step: 4,
      title: 'Multi-Provider Model Control',
      description:
        'Bring your own provider. Use OpenAI GPT-4o for reasoning, Claude Sonnet for coding, GitHub Copilot for completions, or tap into 200+ models via OpenRouter. One unified interface, complete model freedom with local persistence.',
      image: '/assets/images/showcase/ptah-openrouter.png',
      layout: 'right',
      notes: [
        'OpenAI, Claude, Copilot & more',
        '200+ models via OpenRouter',
        'Seamless provider switching',
        'Real-time cost tracking',
      ],
    },
  ]);
}
