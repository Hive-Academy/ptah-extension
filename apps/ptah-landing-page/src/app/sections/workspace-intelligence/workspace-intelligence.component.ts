import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { Code, GitBranch, LucideAngularModule, Search } from 'lucide-angular';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

interface SearchResultRow {
  symbol: string;
  kind: string;
  file: string;
  score: string;
}

interface IntelligenceFeature {
  icon: typeof Search;
  title: string;
  body: string;
}

@Component({
  selector: 'ptah-workspace-intelligence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="workspace-intelligence"
      aria-label="Code Intelligence"
      class="relative bg-slate-950 py-32 sm:py-44 overflow-hidden"
    >
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div class="max-w-2xl mb-20 sm:mb-28">
          <h2
            viewportAnimation
            [viewportConfig]="headerConfig"
            class="text-3xl md:text-4xl lg:text-5xl font-semibold text-white leading-tight mb-8"
          >
            Ptah Doesn't Just Chat.
            <span
              class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
              >It Understands Your Code.</span
            >
          </h2>
          <p
            viewportAnimation
            [viewportConfig]="subheadConfig"
            class="text-base sm:text-lg text-gray-400 leading-relaxed"
          >
            Your codebase is indexed, analysed, and understood before the first
            message. Tree-sitter AST parsing, hybrid symbol search, and full
            project-type detection give every agent deep structural context from
            the moment it starts.
          </p>
        </div>

        <div
          class="grid grid-cols-1 lg:grid-cols-5 gap-16 lg:gap-20 items-start"
        >
          <div
            viewportAnimation
            [viewportConfig]="terminalConfig"
            class="lg:col-span-3"
          >
            <div
              class="rounded-2xl border border-[#d4af37]/25 bg-[#0a0a0a]/95 shadow-glow-gold overflow-hidden font-mono text-sm"
              role="img"
              aria-label="Ptah hybrid symbol search returning ranked results for a natural-language query"
            >
              <div
                class="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-slate-900/60"
                aria-hidden="true"
              >
                <span class="w-3 h-3 rounded-full bg-[#b22222]/70"></span>
                <span class="w-3 h-3 rounded-full bg-amber-500/70"></span>
                <span class="w-3 h-3 rounded-full bg-emerald-500/70"></span>
                <span class="ml-3 text-xs text-gray-500"
                  >ptah — symbol search</span
                >
              </div>
              <div class="p-5 sm:p-6" aria-hidden="true">
                <div class="flex items-center gap-2 mb-5 flex-wrap">
                  <span class="text-emerald-400">❯</span>
                  <span class="text-gray-300">ptah.code.searchSymbols</span>
                  <span class="text-[#f4d47c]"
                    >"where do we validate auth tokens"</span
                  >
                  <span class="cursor-blink text-[#d4af37]">▍</span>
                </div>
                <div class="space-y-2.5">
                  @for (row of results; track row.symbol; let i = $index) {
                    <div
                      viewportAnimation
                      [viewportConfig]="getRowConfig(i)"
                      class="flex items-baseline gap-3 rounded-lg px-3 py-2 bg-white/[0.03] border border-white/5"
                    >
                      <span class="text-[#d4af37] shrink-0">{{
                        row.score
                      }}</span>
                      <span class="text-white">{{ row.symbol }}</span>
                      <span class="text-gray-600 text-xs">{{ row.kind }}</span>
                      <span
                        class="text-gray-500 text-xs ml-auto truncate hidden sm:inline"
                        >{{ row.file }}</span
                      >
                    </div>
                  }
                </div>
                <p class="mt-5 text-xs text-gray-600">
                  hybrid BM25 + vector · Reciprocal Rank Fusion · 4 languages
                </p>
              </div>
            </div>
          </div>

          <div class="lg:col-span-2 space-y-12">
            @for (
              feature of featureBlocks;
              track feature.title;
              let i = $index
            ) {
              <div
                viewportAnimation
                [viewportConfig]="getFeatureConfig(i)"
                class="relative pl-6"
              >
                <div
                  class="absolute left-0 top-1 bottom-1 w-px bg-gradient-to-b from-[#d4af37]/60 to-transparent"
                  aria-hidden="true"
                ></div>
                <div class="flex items-center gap-3 mb-3">
                  <lucide-angular
                    [img]="feature.icon"
                    class="w-5 h-5 text-[#d4af37]"
                    aria-hidden="true"
                  />
                  <h3 class="text-lg font-semibold text-white">
                    {{ feature.title }}
                  </h3>
                </div>
                <p class="text-sm text-gray-400 leading-relaxed">
                  {{ feature.body }}
                </p>
              </div>
            }
          </div>
        </div>

        <p
          class="text-center text-sm text-gray-500 border-t border-white/5 pt-8 mt-16"
        >
          Plus: Monaco editor · xterm terminal · git diff view · branch picker ·
          worktree support
        </p>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .cursor-blink {
        animation: cursor-blink 1.1s steps(1) infinite;
      }
      @keyframes cursor-blink {
        50% {
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cursor-blink {
          animation: none;
        }
      }
    `,
  ],
})
export class WorkspaceIntelligenceComponent {
  public readonly results: SearchResultRow[] = [
    {
      symbol: 'validateAuthToken',
      kind: 'function',
      file: 'libs/auth/token-validator.ts',
      score: '0.94',
    },
    {
      symbol: 'AuthTokenGuard',
      kind: 'class',
      file: 'libs/auth/guards/token.guard.ts',
      score: '0.88',
    },
    {
      symbol: 'refreshTokenSchema',
      kind: 'const',
      file: 'libs/shared/schemas/auth.ts',
      score: '0.81',
    },
    {
      symbol: 'verifySessionClaims',
      kind: 'function',
      file: 'apps/api/src/session/claims.ts',
      score: '0.77',
    },
  ];

  public readonly featureBlocks: IntelligenceFeature[] = [
    {
      icon: Search,
      title: 'Hybrid Symbol Search',
      body: 'BM25 full-text search fused with vector embeddings via Reciprocal Rank Fusion. Find any function, class, or export by natural-language description — code-aware, not keyword matching. Results are injected straight into agent context.',
    },
    {
      icon: Code,
      title: 'Tree-sitter AST Indexing',
      body: 'Structural parsing across JavaScript, TypeScript, Python, and Go. Every function, class, and import is indexed with exact file positions — not regex guesses. The indexing pipeline stays fully under your control.',
    },
    {
      icon: GitBranch,
      title: 'Rewind and Fork',
      body: 'Branch any session at any checkpoint. Explore alternative approaches from the same starting state, roll back to a stable point, or fork a conversation to hand off to a colleague.',
    },
  ];

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/scarab.png',
      size: 100,
      top: '10%',
      right: '10%',
      delay: 0,
      duration: 10,
    },
    {
      src: '/assets/icons/glyphs/djed.png',
      size: 85,
      bottom: '14%',
      right: '5%',
      delay: 2.2,
      duration: 12,
    },
  ];

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.15,
  };

  public readonly subheadConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.15,
    threshold: 0.15,
  };

  public readonly terminalConfig: ViewportAnimationConfig = {
    animation: 'slideRight',
    duration: 0.8,
    threshold: 0.15,
  };

  public getRowConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.25 + index * 0.15,
      threshold: 0.2,
    };
  }

  public getFeatureConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideLeft',
      duration: 0.7,
      delay: 0.15 + index * 0.15,
      ease: 'power2.out',
      threshold: 0.15,
    };
  }
}
