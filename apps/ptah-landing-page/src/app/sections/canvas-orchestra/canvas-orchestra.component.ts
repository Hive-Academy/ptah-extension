import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ScrollAnimationConfig,
  ScrollAnimationDirective,
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ArrowRight, Check, LucideAngularModule } from 'lucide-angular';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

interface CanvasTile {
  id: number;
  label: string;
  active: boolean;
  tall: boolean;
  wide: boolean;
  streaming: boolean;
}

@Component({
  selector: 'ptah-canvas-orchestra',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ScrollAnimationDirective,
    ViewportAnimationDirective,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="canvas"
      aria-label="Canvas Orchestra"
      class="relative bg-slate-950 py-32 sm:py-44 overflow-hidden"
    >
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div class="flex flex-col md:flex-row items-center gap-16 lg:gap-20">
          <div
            viewportAnimation
            [viewportConfig]="leftConfig"
            class="w-full md:w-[45%] order-2 md:order-1"
          >
            <h2
              class="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold text-white leading-tight mb-8"
            >
              Nine Agents. One View.
              <span
                class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
                >Zero Chaos.</span
              >
            </h2>
            <p
              class="text-base sm:text-lg text-gray-400 max-w-xl leading-relaxed mb-10"
            >
              Run nine independent agents simultaneously in a drag-and-resize
              grid. Each tile holds a full chat session with its own provider,
              model, and context window. Background agents keep working while
              you focus on one — then check in when they surface results.
            </p>
            <div class="space-y-3 mb-10">
              @for (feature of features; track feature) {
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
              href="https://docs.ptah.live"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group/link focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
            >
              <span
                class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover/link:bg-[#d4af37]/20 transition-colors"
              >
                <lucide-angular
                  [img]="ArrowRightIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
              </span>
              See Canvas in Docs
            </a>
          </div>

          <div
            scrollAnimation
            [scrollConfig]="canvasScroll"
            class="w-full md:w-[55%] order-1 md:order-2 canvas-stage"
          >
            <div
              class="canvas-frame relative rounded-2xl border border-[#d4af37]/25 shadow-glow-gold overflow-hidden aspect-[16/10] bg-slate-900"
              role="img"
              aria-label="Ptah Canvas showing six active agent tiles in a gridstack layout"
            >
              <div
                class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-2 p-3"
                aria-hidden="true"
              >
                @for (tile of tiles; track tile.id; let i = $index) {
                  <div
                    viewportAnimation
                    [viewportConfig]="getTileConfig(i)"
                    class="rounded-lg border border-[#d4af37]/15 bg-slate-950/80 p-2.5 flex flex-col"
                    [class.row-span-2]="tile.tall"
                    [class.col-span-2]="tile.wide"
                  >
                    <div class="flex items-center gap-1.5 mb-2">
                      <span
                        class="w-1.5 h-1.5 rounded-full"
                        [class.bg-emerald-400]="tile.active"
                        [class.animate-pulse]="tile.active"
                        [class.bg-slate-600]="!tile.active"
                      ></span>
                      <span class="text-[10px] font-medium text-[#f4d47c]/70">{{
                        tile.label
                      }}</span>
                    </div>
                    <div class="space-y-1.5 flex-1">
                      <div class="h-1.5 rounded-full bg-white/10 w-full"></div>
                      <div class="h-1.5 rounded-full bg-white/10 w-4/5"></div>
                      @if (tile.streaming) {
                        <div class="h-1.5 rounded-full w-3/5 stream-line"></div>
                      } @else {
                        <div
                          class="h-1.5 rounded-full w-3/5 bg-[#d4af37]/20"
                        ></div>
                      }
                      @if (tile.tall) {
                        <div class="h-1.5 rounded-full bg-white/10 w-5/6"></div>
                        @if (tile.streaming) {
                          <div
                            class="h-1.5 rounded-full w-2/3 stream-line"
                          ></div>
                        } @else {
                          <div
                            class="h-1.5 rounded-full w-2/3 bg-white/10"
                          ></div>
                        }
                      }
                    </div>
                  </div>
                }
              </div>
              <div
                class="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-slate-950 to-transparent pointer-events-none"
                aria-hidden="true"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .canvas-stage {
        perspective: 1400px;
      }
      .canvas-frame {
        transform: rotateY(-8deg) rotateX(4deg);
        transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .canvas-frame:hover {
        transform: rotateY(0deg) rotateX(0deg);
      }
      .stream-line {
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.08) 0%,
          rgba(212, 175, 55, 0.45) 50%,
          rgba(255, 255, 255, 0.08) 100%
        );
        background-size: 200% 100%;
        animation: stream-sweep 2.4s linear infinite;
      }
      @keyframes stream-sweep {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .stream-line {
          animation: none;
          background-position: 50% 0;
        }
        .canvas-frame {
          transform: none;
        }
      }
    `,
  ],
})
export class CanvasOrchestraComponent {
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly features = [
    'Up to 9 concurrent agent tiles in one view',
    'Independent provider and model per tile',
    'Drag, resize, and pin tiles — full layout control',
    'Background agents continue while you work',
  ];

  public readonly tiles: CanvasTile[] = [
    {
      id: 1,
      label: 'Claude',
      active: true,
      tall: true,
      wide: false,
      streaming: true,
    },
    {
      id: 2,
      label: 'Copilot',
      active: true,
      tall: false,
      wide: true,
      streaming: true,
    },
    {
      id: 3,
      label: 'Codex',
      active: false,
      tall: false,
      wide: false,
      streaming: false,
    },
    {
      id: 4,
      label: 'Ollama',
      active: true,
      tall: false,
      wide: false,
      streaming: true,
    },
    {
      id: 5,
      label: 'Agent 5',
      active: true,
      tall: false,
      wide: false,
      streaming: false,
    },
  ];

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/ankh.png',
      size: 100,
      bottom: '12%',
      left: '5%',
      delay: 0,
      duration: 11,
    },
    {
      src: '/assets/icons/glyphs/eye-of-horus.png',
      size: 85,
      top: '10%',
      left: '38%',
      delay: 2,
      duration: 9,
    },
  ];

  public readonly canvasScroll: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top 85%',
    end: 'top 35%',
    scrub: 1,
    from: { opacity: 0, y: 80 },
    to: { opacity: 1, y: 0 },
  };

  public readonly leftConfig: ViewportAnimationConfig = {
    animation: 'slideRight',
    duration: 0.8,
    threshold: 0.15,
  };

  public getTileConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: 0.15 + index * 0.1,
      threshold: 0.2,
    };
  }
}
