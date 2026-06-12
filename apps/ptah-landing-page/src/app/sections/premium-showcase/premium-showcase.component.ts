import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgClass, NgOptimizedImage } from '@angular/common';
import { ScrollAnimationDirective } from '@hive-academy/angular-gsap';
import { ArrowRight, Check, LucideAngularModule } from 'lucide-angular';

interface ShowcaseSlide {
  step: string;
  layout: 'left' | 'right';
  eyebrow: string;
  headline: string;
  body: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  image: string;
  imageAlt: string;
}

@Component({
  selector: 'ptah-premium-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    NgOptimizedImage,
    ScrollAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <div class="relative bg-slate-950">
      @for (slide of slides(); track slide.step; let i = $index) {
        <section
          class="relative min-h-screen flex flex-col md:flex-row w-full overflow-hidden"
          [attr.aria-label]="slide.eyebrow"
        >
          <div
            class="relative h-72 sm:h-96 w-full md:absolute md:inset-y-0 md:w-1/2 md:h-auto order-first"
            [ngClass]="{
              'md:right-0': slide.layout === 'left',
              'md:left-0': slide.layout === 'right',
            }"
            scrollAnimation
            [scrollConfig]="{
              animation: 'custom',
              start: 'top 80%',
              end: 'top 25%',
              scrub: 0.8,
              from: { opacity: 0, scale: 1.08 },
              to: { opacity: 1, scale: 1 },
            }"
          >
            <div class="absolute inset-0 overflow-hidden">
              <div
                class="absolute inset-0"
                scrollAnimation
                [scrollConfig]="{
                  animation: 'parallax',
                  speed: 0.3,
                  scrub: true,
                }"
              >
                <img
                  [ngSrc]="slide.image"
                  [alt]="slide.imageAlt"
                  fill
                  class="object-cover object-center"
                />
              </div>
              <div
                class="absolute inset-0 z-10"
                [ngClass]="{
                  'bg-gradient-to-r from-slate-950 via-slate-950/70 to-transparent':
                    slide.layout === 'left',
                  'bg-gradient-to-l from-slate-950 via-slate-950/70 to-transparent':
                    slide.layout === 'right',
                }"
                aria-hidden="true"
              ></div>
            </div>
          </div>

          <div
            class="relative z-20 w-full md:w-1/2 min-h-[55vh] md:min-h-screen flex items-center"
            [ngClass]="{
              'md:ml-0': slide.layout === 'left',
              'md:ml-auto': slide.layout === 'right',
            }"
          >
            <div
              class="px-6 sm:px-10 lg:px-16 py-14 md:py-20 max-w-2xl"
              [ngClass]="{
                'ml-auto': slide.layout === 'left',
                'mr-auto': slide.layout === 'right',
              }"
            >
              <div
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 85%',
                  end: 'top 45%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: slide.layout === 'left' ? -60 : 60,
                    scale: 0.85,
                  },
                  to: { opacity: 1, x: 0, scale: 1 },
                }"
              >
                <div class="inline-flex items-center gap-4 mb-10">
                  <span
                    class="flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-semibold text-base shadow-lg shadow-[#d4af37]/20"
                    >{{ slide.step }}</span
                  >
                  <span
                    class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70"
                    >{{ slide.eyebrow }}</span
                  >
                  <div
                    class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent min-w-[60px]"
                    aria-hidden="true"
                  ></div>
                </div>
              </div>

              <div
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 82%',
                  end: 'top 40%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: slide.layout === 'left' ? -80 : 80,
                    y: 20,
                  },
                  to: { opacity: 1, x: 0, y: 0 },
                }"
              >
                <h3
                  class="text-2xl sm:text-3xl lg:text-4xl font-semibold text-white mb-8 leading-tight"
                >
                  {{ slide.headline }}
                </h3>
              </div>

              <div
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 79%',
                  end: 'top 36%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: slide.layout === 'left' ? -60 : 60,
                    y: 15,
                  },
                  to: { opacity: 1, x: 0, y: 0 },
                }"
              >
                <p
                  class="text-base sm:text-lg text-gray-300 leading-relaxed mb-10"
                >
                  {{ slide.body }}
                </p>
              </div>

              <div
                scrollAnimation
                [scrollConfig]="{
                  animation: 'custom',
                  start: 'top 76%',
                  end: 'top 32%',
                  scrub: 0.8,
                  from: {
                    opacity: 0,
                    x: slide.layout === 'left' ? -40 : 40,
                    y: 10,
                  },
                  to: { opacity: 1, x: 0, y: 0 },
                }"
              >
                <div class="space-y-3 mb-10">
                  @for (feature of slide.features; track feature) {
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="text-base text-gray-400">{{ feature }}</span>
                    </div>
                  }
                </div>
                <a
                  [href]="slide.ctaHref"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
                >
                  <span
                    class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
                  >
                    <lucide-angular
                      [img]="ArrowRightIcon"
                      class="w-4 h-4"
                      aria-hidden="true"
                    />
                  </span>
                  {{ slide.ctaLabel }}
                </a>
              </div>
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PremiumShowcaseComponent {
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly slides = signal<ShowcaseSlide[]>([
    {
      step: '01',
      layout: 'left',
      eyebrow: 'Unified Providers',
      headline: 'One Harness. Every Model. Total Control.',
      body: 'Access Claude, GitHub Copilot, OpenAI Codex, Ollama, and 200+ OpenRouter models through a single unified interface. Switch providers mid-session, share context across provider changes, and track real-time cost and token usage.',
      features: [
        'Unified provider tiles with one-click switching',
        'Shared context preserved across provider changes',
        'Real-time cost and token usage dashboards',
        'Secure per-provider API key management',
      ],
      ctaLabel: 'Explore Unified Providers',
      ctaHref: 'https://docs.ptah.live/providers/',
      image: '/assets/images/showcase/sim-providers.webp',
      imageAlt:
        'Ptah provider selection with Claude, Copilot, Codex, and Ollama tiles plus cost and token usage',
    },
    {
      step: '02',
      layout: 'right',
      eyebrow: 'Skill Plugins',
      headline: 'Your Stack. Your Skills. Your Rules.',
      body: 'Install domain-specific skill packs from the skills.sh registry or the built-in Skills Discovery panel in Ptah settings. Each plugin brings specialized agents, slash commands, and code patterns tuned for your stack.',
      features: [
        'Skill packs for Core, Angular, Nx SaaS, React, and more',
        'skills.sh registry â€” browse and install with one click',
        'Skills Discovery integrated into extension settings',
        'Build and publish custom plugins with the Skill Creator',
      ],
      ctaLabel: 'Explore Skill Plugins',
      ctaHref: 'https://docs.ptah.live/plugins/',
      image: '/assets/images/showcase/sim-plugins.webp',
      imageAlt:
        'Ptah skill plugins discovery grid with installable packs for Angular, React, Nx SaaS, and more',
    },
    {
      step: '03',
      layout: 'left',
      eyebrow: 'Agent Orchestration',
      headline: 'Spawn a Team. Delegate. Conquer.',
      body: 'Run Ptah CLI, Codex, GitHub Copilot, and Gemini agents as parallel workers. Fire-and-check orchestration with MCP lifecycle tools lets you delegate tasks across multiple AI agents simultaneously â€” each with its own provider and context.',
      features: [
        'Parallel subagent execution across providers',
        'Ptah CLI connects 200+ models via Claude Agent SDK',
        'MCP lifecycle tools for fire-and-check workflows',
        'Rewind and fork any session at any checkpoint',
      ],
      ctaLabel: 'Explore Agent Orchestration',
      ctaHref: 'https://docs.ptah.live/agents/agent-orchestration/',
      image: '/assets/images/showcase/sim-orchestration.webp',
      imageAlt:
        'Ptah agent orchestration live view with a main agent delegating to three sub-agents and a live log feed',
    },
    {
      step: '04',
      layout: 'right',
      eyebrow: 'Setup Wizard',
      headline: 'Instant Project Awareness. From Day One.',
      body: "Ptah's Setup Wizard scans your workspace in seconds â€” detects 13+ project types, analyses dependencies, and generates custom CLAUDE.md rules and project-adaptive agents. Your AI starts fully informed.",
      features: [
        '6-step automated workspace analysis',
        '13+ project type detection including monorepos',
        'LLM-generated rules and custom agent configurations',
        'Persistent project context across all sessions',
      ],
      ctaLabel: 'Explore Setup Wizard',
      ctaHref: 'https://docs.ptah.live/agents/setup-wizard/',
      image: '/assets/images/showcase/sim-setup-wizard.webp',
      imageAlt:
        'Ptah setup wizard at the detect-tech step showing the discovered stack and a setup log feed',
    },
    {
      step: '05',
      layout: 'left',
      eyebrow: 'Thoth Memory',
      headline: 'Your AI Remembers Everything. Always.',
      body: "Thoth's Memory Curator persists knowledge across every session using hybrid BM25 and vector recall with Reciprocal Rank Fusion. Import documentation, notes, and code as knowledge corpora. Your context grows with every conversation.",
      features: [
        'Persistent hybrid BM25 + vector recall across sessions',
        'Knowledge corpora: import docs, code, and notes',
        'Auto-summarisation after every session',
        'Electron-exclusive Thoth suite feature',
      ],
      ctaLabel: 'Learn About Thoth Memory',
      ctaHref: 'https://docs.ptah.live/automation/cron/',
      image: '/assets/images/showcase/sim-thoth-memory.webp',
      imageAlt:
        'Thoth memory timeline with tagged decision, bugfix, and discovery entries and a natural-language search',
    },
    {
      step: '06',
      layout: 'right',
      eyebrow: 'Skill Synthesis',
      headline: 'Your AI Learns. Gets Better. Every Session.',
      body: 'When a workflow repeats successfully, Ptah extracts the trajectory, judges its quality, and promotes it to a permanent, shareable skill file. Your best patterns become reusable building blocks â€” automatically.',
      features: [
        'Learns reusable workflows from your session trajectories',
        'Synthesises shareable skill files automatically',
        'Browse, edit, and share skills across projects',
        'Skills Discovery panel built into settings',
      ],
      ctaLabel: 'Learn About Skill Synthesis',
      ctaHref: 'https://docs.ptah.live/mcp-and-skills/',
      image: '/assets/images/showcase/sim-skill-synthesis.webp',
      imageAlt:
        'Thoth skill management with extract, judge, and promote pipeline stages and confidence-scored skill files',
    },
    {
      step: '07',
      layout: 'left',
      eyebrow: 'Canvas Orchestra',
      headline: 'Nine Agents. One View. Zero Chaos.',
      body: "The Canvas is Ptah's multi-tile workspace â€” a live 3Ã—3 grid where each tile runs an independent agent with its own provider, model, and context. Resize, reorder, and pin tiles. Background agents keep working while you focus elsewhere.",
      features: [
        'Up to 9 concurrent agent tiles in one gridstack view',
        'Each tile: independent provider, model, and context',
        'Resize, reorder, and pin tiles â€” full layout control',
        'Background agents continue while you work elsewhere',
      ],
      ctaLabel: 'Explore the Canvas',
      ctaHref: 'https://docs.ptah.live',
      image: '/assets/images/showcase/sim-canvas.webp',
      imageAlt:
        'Ptah canvas running two agent sessions side by side with token and cost stats per tile',
    },
    {
      step: '08',
      layout: 'right',
      eyebrow: 'Messaging Gateway',
      headline: 'Code Reviews in Telegram. Standups via Discord.',
      body: 'Trigger Ptah agents from Telegram, Discord, or Slack. Discord supports per-thread multi-session conversations â€” each thread gets its own agent context. Approve or reject agent actions before they execute.',
      features: [
        'Trigger agents from Telegram, Discord, or Slack',
        'Discord per-thread multi-session support',
        'Full approval relay â€” review before execution',
        'Voice input via gateway (coming soon)',
      ],
      ctaLabel: 'Learn About the Gateway',
      ctaHref: 'https://docs.ptah.live',
      image: '/assets/images/showcase/sim-gateway.webp',
      imageAlt:
        'Ptah messaging gateway with Telegram, Slack, and a connected Discord showing an allow-list and recent messages',
    },
  ]);
}
