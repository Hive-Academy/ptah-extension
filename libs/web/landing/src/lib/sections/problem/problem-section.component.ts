import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import gsap from 'gsap';

/**
 * ProblemSectionComponent — S2 Founder Insight (design spec §4 S2, copy deck S2).
 *
 * Full-width two-column "gap" section: narrative on the left, a line chart on
 * the right making the claim literal — a vibe-coded prototype's integrity rises
 * then collapses after feature five, while Ptah's line stays flat. Distinct
 * shape from the hero (centered focal + device frame) and S3, per the brand's
 * "every section earns a unique shape" rule.
 *
 * Both chart lines render fully drawn by default — SSG / no-JS / reduced-motion
 * safe. Under `no-preference` the lines reset and draw when the chart scrolls
 * into view (IntersectionObserver + GSAP).
 */
@Component({
  selector: 'ptah-problem-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <section
      id="the-onboarding-problem"
      aria-label="Architecture that stays consistent past feature five"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <div class="w-full px-6 sm:px-10 lg:px-16">
        <div class="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <!-- narrative -->
          <div viewportAnimation [viewportConfig]="textConfig" class="max-w-xl">
            <h2
              class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]"
            >
              Architecture that stays consistent
              <span class="text-amber-500">past feature five.</span>
            </h2>
            <div
              class="mt-6 space-y-4 text-lg text-ink-300 leading-relaxed [text-wrap:pretty]"
            >
              <p>
                A prototype holds together for the demo. Then feature five
                arrives, and the decisions nobody wrote down start to collide —
                a second tenant, a billing edge case, an auth path no one
                pen-tested.
              </p>
              <p>
                Ptah studies your codebase before the first message and keeps
                every architectural decision it makes, staffing the parts a solo
                prototype skips. The line stays flat.
              </p>
            </div>
          </div>

          <!-- chart -->
          <div
            viewportAnimation
            [viewportConfig]="chartConfig"
            class="rounded-2xl border border-ink-700 bg-ink-900/40 p-5 sm:p-8"
          >
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
              <span
                class="flex items-center gap-2 font-mono text-xs text-ink-300"
              >
                <span class="w-6 h-0.5 rounded bg-amber-500"></span>
                Ptah — consistent
              </span>
              <span
                class="flex items-center gap-2 font-mono text-xs text-ink-400"
              >
                <span class="w-6 h-0.5 rounded bg-rose-400/70"></span>
                Vibe-coded prototype
              </span>
            </div>

            <svg
              viewBox="0 0 800 300"
              class="w-full h-auto"
              role="img"
              aria-label="Line chart: a vibe-coded prototype's integrity rises then collapses after feature five, while Ptah stays consistent."
            >
              @for (y of gridlines; track y) {
                <line
                  [attr.x1]="40"
                  [attr.x2]="770"
                  [attr.y1]="y"
                  [attr.y2]="y"
                  stroke="#262a33"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
              }
              <line
                x1="470"
                x2="470"
                y1="40"
                y2="270"
                stroke="#3a3f4b"
                stroke-width="1"
                stroke-dasharray="3 4"
                vector-effect="non-scaling-stroke"
              />
              <text
                x="470"
                y="30"
                fill="#8b92a1"
                font-size="12"
                font-family="monospace"
                text-anchor="middle"
              >
                feature 5
              </text>

              <!-- prototype: rises, then cracks after feature 5 -->
              <path
                data-draw
                d="M40,215 L150,180 L260,150 L360,128 L470,120 L560,175 L660,235 L770,262"
                fill="none"
                stroke="#fb7185"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                pathLength="1"
                opacity="0.75"
                vector-effect="non-scaling-stroke"
              />
              <!-- ptah: steady, consistent -->
              <path
                data-draw
                d="M40,200 L150,188 L260,176 L360,166 L470,158 L560,150 L660,143 L770,136"
                fill="none"
                stroke="#f5a524"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                pathLength="1"
                vector-effect="non-scaling-stroke"
              />

              <circle cx="470" cy="120" r="4" fill="#fb7185" />
              <text
                x="500"
                y="105"
                fill="#fb7185"
                font-size="12"
                font-family="monospace"
              >
                prototype cracks
              </text>

              @for (f of xLabels; track f.x) {
                <text
                  [attr.x]="f.x"
                  y="290"
                  fill="#5b616f"
                  font-size="11"
                  font-family="monospace"
                  text-anchor="middle"
                >
                  {{ f.label }}
                </text>
              }
            </svg>
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
    `,
  ],
})
export class ProblemSectionComponent {
  public readonly gridlines = [60, 130, 200, 260];

  public readonly xLabels = [
    { x: 40, label: 'f1' },
    { x: 205, label: 'f2' },
    { x: 360, label: 'f3' },
    { x: 470, label: 'f5' },
    { x: 660, label: 'f8' },
    { x: 770, label: 'f13' },
  ];

  /** Narrative entrance — slide in from the left. */
  public readonly textConfig: ViewportAnimationConfig = {
    animation: 'slideRight',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  /** Chart panel entrance — slide in from the right. */
  public readonly chartConfig: ViewportAnimationConfig = {
    animation: 'slideLeft',
    duration: 0.6,
    delay: 0.15,
    threshold: 0.15,
    ease: 'power2.out',
  };

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      // Lines are drawn by default (SSG-safe). Only reset + replay the draw
      // when motion is welcome and the chart scrolls into view.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const el = this.host.nativeElement;
        const paths = el.querySelectorAll<SVGPathElement>('[data-draw]');
        const svg = el.querySelector('svg');
        if (!paths.length || !svg) return;

        gsap.set(paths, { strokeDasharray: 1, strokeDashoffset: 1 });
        const io = new IntersectionObserver(
          (entries, obs) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                gsap.to(paths, {
                  strokeDashoffset: 0,
                  duration: 1.7,
                  ease: 'power3.out',
                  stagger: 0.35,
                });
                obs.disconnect();
              }
            }
          },
          { threshold: 0.3 },
        );
        io.observe(svg);
        return () => io.disconnect();
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }
}
