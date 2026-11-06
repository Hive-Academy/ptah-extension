import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { generateBoltPath, seededRandom } from '../../shared/lightning-bolt';
import { SeamBoltComponent } from '../shared/seam-bolt.component';
import { REVEAL, bindSectionScroll, seamCharge } from '../shared/section-scroll';

export interface DecisionLoopStage {
  readonly id: string;
  readonly number: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export const DECISION_LOOP_STAGES: readonly DecisionLoopStage[] = [
  {
    id: 'classify',
    number: '01',
    label: 'Classify type and depth',
    x: 210,
    y: 115,
  },
  {
    id: 'fast-model',
    number: '02',
    label: 'Fast model, 3-second abort',
    x: 540,
    y: 115,
  },
  {
    id: 'blend-evidence',
    number: '03',
    label: 'Blend 90-day evidence',
    x: 870,
    y: 115,
  },
  {
    id: 'drop-same-family',
    number: '04',
    label: 'Drop same-family review',
    x: 870,
    y: 355,
  },
  {
    id: 'routing-reminder',
    number: '05',
    label: 'Routing reminder in chat',
    x: 540,
    y: 355,
  },
  {
    id: 'check-files',
    number: '06',
    label: 'Check files, feed back',
    x: 210,
    y: 355,
  },
] as const;

const STAGE_THRESHOLDS = [0.06, 0.2, 0.36, 0.52, 0.68, 0.82] as const;

@Component({
  selector: 'ptah-decision-loop-section',
  standalone: true,
  imports: [SeamBoltComponent],
  template: `
    <section
      id="decision-model-loop"
      class="decision-loop-section"
      aria-labelledby="decision-loop-title"
    >
      <div class="loop-atmosphere" aria-hidden="true"></div>
      <div class="loop-grain" aria-hidden="true"></div>
      <ptah-seam-bolt [charge]="seam()" [strike]="activeStage() + 1" [speed]="0.9" [seed]="23" />

      <div class="loop-shell">
        <header class="loop-header">
          <p class="loop-eyebrow rise" [class.is-in]="revealProgress() >= reveal.eyebrow">
            <span class="cue-line" aria-hidden="true"></span>
            <span>{{ eyebrow() }}</span>
            <span class="cue-line" aria-hidden="true"></span>
          </p>
          <h2
            id="decision-loop-title"
            class="loop-title rise"
            [class.is-in]="revealProgress() >= reveal.headline"
          >
            {{ headline() }}
          </h2>
          <p class="loop-subline rise" [class.is-in]="revealProgress() >= reveal.subline">
            {{ subline() }}
          </p>
        </header>

        <div
          class="loop-window rise"
          data-loop-window
          [class.is-in]="revealProgress() >= reveal.visual"
          [style.--loop-progress]="loopProgress()"
        >
          <div class="loop-canvas-wrap">
            <!-- Desktop / Tablet Closed-Loop SVG Instrument -->
            <svg
              class="loop-svg-desktop"
              viewBox="0 0 1080 470"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="decision-loop-amber"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stop-color="#ffbb4d" />
                  <stop offset="50%" stop-color="#f5a524" />
                  <stop offset="100%" stop-color="#ffbb4d" />
                </linearGradient>
                <linearGradient
                  id="decision-feedback-grad"
                  x1="0%"
                  y1="100%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stop-color="#f5a524" />
                  <stop offset="55%" stop-color="#ffbb4d" />
                  <stop offset="100%" stop-color="#fff9eb" />
                </linearGradient>
              </defs>

              <!-- Subtle instrument coordinate hairlines -->
              <line
                x1="90"
                y1="235"
                x2="990"
                y2="235"
                stroke="#171a21"
                stroke-width="1"
              />
              <line
                x1="540"
                y1="48"
                x2="540"
                y2="422"
                stroke="#171a21"
                stroke-width="1"
              />

              <!-- Outer stadium return frame (completes visual perimeter 06 -> 01) -->
              <path
                [attr.d]="perimeterTrackPath"
                stroke="#262a33"
                stroke-width="2"
              />
              <path
                [attr.d]="leftPerimeterClosurePath"
                stroke="#f5a524"
                stroke-opacity="0.26"
                stroke-width="1.5"
                stroke-dasharray="5 7"
              />

              <!-- Primary 01 -> 06 active circuit (3-layer hero-lightning stroke craft) -->
              <path
                data-forward-glow
                [attr.d]="forwardTrackPath"
                stroke="#f5a524"
                stroke-opacity="0.1"
                stroke-width="5"
                stroke-linecap="round"
                pathLength="1"
              />
              <path
                data-forward-path
                [attr.d]="forwardTrackPath"
                stroke="url(#decision-loop-amber)"
                stroke-width="2"
                stroke-linecap="round"
                pathLength="1"
              />
              <path
                data-forward-core
                [attr.d]="forwardTrackPath"
                stroke="#fff9eb"
                stroke-opacity="0.78"
                stroke-width="1"
                stroke-linecap="round"
                pathLength="1"
              />

              <!-- Closed-Loop Feedback Return Arc: Stage 06 -> Stage 03 -->
              <path
                [attr.d]="feedbackReturnPath"
                stroke="#262a33"
                stroke-width="2"
                stroke-dasharray="4 6"
              />
              <path
                data-feedback-glow
                [attr.d]="feedbackReturnPath"
                stroke="#f5a524"
                stroke-opacity="0.12"
                stroke-width="5"
                stroke-linecap="round"
                pathLength="1"
              />
              <path
                data-feedback-path
                [attr.d]="feedbackReturnPath"
                stroke="url(#decision-feedback-grad)"
                stroke-width="2"
                stroke-linecap="round"
                pathLength="1"
              />

              <!-- Directional chevrons along the forward track and 06 -> 03 return arc -->
              <path
                d="M 372 110 L 380 115 L 372 120"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 702 110 L 710 115 L 702 120"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 985 231 L 990 239 L 995 231"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 708 350 L 700 355 L 708 360"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 378 350 L 370 355 L 378 360"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- Center feedback chevron pointing up-right toward Stage 03 -->
              <path
                d="M 534 233 L 545 232 L 541 242"
                stroke="#fff9eb"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              <!-- Convergence target rings on Stage 03 (870, 115) & Stage 06 (210, 355) -->
              <circle
                cx="870"
                cy="115"
                r="42"
                stroke="#ffbb4d"
                stroke-opacity="0.28"
                stroke-width="1"
                stroke-dasharray="3 5"
              />
              <circle
                cx="210"
                cy="355"
                r="42"
                stroke="#f5a524"
                stroke-opacity="0.24"
                stroke-width="1"
                stroke-dasharray="3 5"
              />

              <!-- Anchor rings for all 6 stages -->
              @for (stage of stages(); track stage.id; let i = $index) {
                <circle
                  [attr.cx]="stage.x"
                  [attr.cy]="stage.y"
                  r="28"
                  fill="#08090c"
                  [attr.stroke]="isStageReached(i) ? '#f5a524' : '#262a33'"
                  stroke-width="1.5"
                />
              }

              <!-- Travelling energy orb positioned by scroll progress -->
              <g
                data-orb-group
                [attr.transform]="
                  'translate(' + orbPosition().x + ' ' + orbPosition().y + ')'
                "
              >
                <circle r="14" fill="#f5a524" fill-opacity="0.22" />
                <!-- The travelling spark: a short bolt that re-jags at each stage. -->
                <polyline
                  [attr.points]="sparkPoints()"
                  stroke="#ffbb4d"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
                <circle r="6" fill="#ffbb4d" />
                <circle r="2.5" fill="#fff9eb" />
              </g>
            </svg>

            <!-- Mobile Closed-Loop SVG Rail (< 1024px) -->
            <svg
              class="loop-svg-mobile"
              viewBox="0 0 56 520"
              preserveAspectRatio="none"
              fill="none"
              aria-hidden="true"
            >
              <!-- Vertical spine 01 -> 06 -->
              <path
                d="M 34 28 L 34 492"
                stroke="#262a33"
                stroke-width="2"
              />
              <path
                data-mobile-forward
                d="M 34 28 L 34 492"
                stroke="#f5a524"
                stroke-width="2.5"
                stroke-linecap="round"
                pathLength="1"
              />
              <!-- Mobile feedback arc: Stage 06 (y=492) returns to Stage 03 (y=214) -->
              <path
                d="M 34 492 C 6 492, 6 214, 34 214"
                stroke="#262a33"
                stroke-width="1.75"
                stroke-dasharray="4 5"
              />
              <path
                data-mobile-feedback
                d="M 34 492 C 6 492, 6 214, 34 214"
                stroke="#ffbb4d"
                stroke-width="2.25"
                stroke-linecap="round"
                pathLength="1"
              />
              <path
                d="M 27 210 L 34 214 L 27 218"
                stroke="#ffbb4d"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>

            <!-- Accessible Ordered List of the 6 Loop Stages -->
            <ol class="loop-stages">
              @for (stage of stages(); track stage.id; let i = $index) {
                <li
                  class="loop-stage"
                  [attr.data-stage-index]="i"
                  [class.is-reached]="isStageReached(i)"
                  [class.is-active]="activeStage() === i"
                  [class.is-convergence]="i === 2"
                  [class.is-feedback-lit]="feedbackLit()"
                >
                  <div class="stage-header">
                    <span class="stage-node-dot" aria-hidden="true"></span>
                    <span class="stage-number" aria-hidden="true">{{
                      stage.number
                    }}</span>
                  </div>
                  <span class="stage-label">{{ stage.label }}</span>
                </li>
              }
            </ol>
          </div>

          <div class="loop-rail" aria-hidden="true">
            <div class="loop-rail-bar">
              <span class="loop-rail-fill" data-loop-rail-fill></span>
            </div>
            <div class="loop-rail-ticks">
              @for (stage of stages(); track stage.id; let i = $index) {
                <span class="rail-tick" [class.is-lit]="isStageReached(i)">{{
                  stage.number
                }}</span>
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrl: './decision-loop-section.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopSectionComponent {
  public readonly eyebrow = input<string>('Who runs it');
  public readonly headline = input<string>('How Ptah decides the work.');
  public readonly subline = input<string>(
    'A fast model proposes the job. Ninety days of local results, plus hard rules, shape who runs it.',
  );
  public readonly stages = input<readonly DecisionLoopStage[]>(DECISION_LOOP_STAGES);

  /**
   * Resting state (SSR and prefers-reduced-motion) is settled at 1 so every
   * stage and the 06 -> 03 feedback arc render complete without requiring JS.
   */
  public readonly loopProgress = signal(1);
  public readonly activeStage = signal(2);
  public readonly feedbackLit = computed(() => this.loopProgress() >= 0.9);

  public readonly orbPosition = computed<{ x: number; y: number }>(() =>
    this.computeOrbCoordinates(this.loopProgress()),
  );

  /** Section scroll progress for the top-down header reveal; settled at 1. */
  public readonly revealProgress = signal(1);
  protected readonly reveal = REVEAL;
  public readonly seam = computed(() => seamCharge(this.revealProgress()));
  /** A short bolt through the orb, re-drawn when the active stage changes. */
  protected readonly sparkPoints = computed(() =>
    generateBoltPath({ x: -22, y: 0 }, { x: 22, y: 0 }, seededRandom(31 + this.activeStage()))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(' '),
  );

  protected readonly perimeterTrackPath =
    'M 210 115 H 870 A 120 120 0 0 1 870 355 H 210 A 120 120 0 0 1 210 115 Z';

  protected readonly leftPerimeterClosurePath =
    'M 210 355 A 120 120 0 0 1 210 115';

  protected readonly forwardTrackPath =
    'M 210 115 H 870 A 120 120 0 0 1 870 355 H 210';

  protected readonly feedbackReturnPath =
    'M 210 355 C 360 235, 720 235, 870 115';

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private release?: () => void;

  public constructor() {
    if (!this.browser) return;
    afterNextRender(() => this.initialize());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  public isStageReached(index: number): boolean {
    const threshold = STAGE_THRESHOLDS[index] ?? 0;
    return this.loopProgress() >= threshold;
  }

  public setProgress(rawProgress: number): void {
    const clamped = Math.max(0, Math.min(1, rawProgress));
    this.loopProgress.set(clamped);

    // Stage 06 returns to Stage 03 at the end of the loop (>= 0.92).
    if (clamped >= 0.92) {
      this.activeStage.set(2);
    } else {
      let current = 0;
      for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
        if (clamped >= STAGE_THRESHOLDS[i]) {
          current = i;
        }
      }
      this.activeStage.set(current);
    }

    this.syncSvgStrokeProgress(clamped);
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const section = this.host.nativeElement.querySelector<HTMLElement>('section');
    if (!view || !section) return;

    // Vertical scroll drives everything: the header rises in reading order,
    // then the loop and its 01 -> 06 rail advance over the rest of the
    // scroll (pinned on desktop) and settle complete before the pin ends.
    this.release = bindSectionScroll(section, view, (progress) => {
      this.revealProgress.set(progress);
      const loop = (progress - REVEAL.visual) / (0.92 - REVEAL.visual);
      this.setProgress(Math.max(0.06, loop));
    });
  }

  private syncSvgStrokeProgress(progress: number): void {
    const root = this.host.nativeElement;
    const forwardFraction = Math.min(1, progress / 0.78);
    const feedbackFraction =
      progress <= 0.78 ? 0 : Math.min(1, (progress - 0.78) / 0.22);

    const forwardSelectors =
      '[data-forward-glow], [data-forward-path], [data-forward-core], [data-mobile-forward]';
    const feedbackSelectors =
      '[data-feedback-glow], [data-feedback-path], [data-mobile-feedback]';

    root
      .querySelectorAll<SVGPathElement>(forwardSelectors)
      .forEach((pathEl) => {
        pathEl.style.strokeDasharray = '1';
        pathEl.style.strokeDashoffset = String(1 - forwardFraction);
      });

    root
      .querySelectorAll<SVGPathElement>(feedbackSelectors)
      .forEach((pathEl) => {
        pathEl.style.strokeDasharray = '1';
        pathEl.style.strokeDashoffset = String(1 - feedbackFraction);
      });
  }

  private computeOrbCoordinates(progress: number): { x: number; y: number } {
    const clamped = Math.max(0, Math.min(1, progress));
    if (clamped <= 0.3) {
      const t = clamped / 0.3;
      return { x: Math.round(210 + t * 660), y: 115 };
    }
    if (clamped <= 0.48) {
      const t = (clamped - 0.3) / 0.18;
      const angle = -Math.PI / 2 + t * Math.PI;
      return {
        x: Math.round(870 + Math.cos(angle) * 120),
        y: Math.round(235 + Math.sin(angle) * 120),
      };
    }
    if (clamped <= 0.78) {
      const t = (clamped - 0.48) / 0.3;
      return { x: Math.round(870 - t * 660), y: 355 };
    }
    const t = (clamped - 0.78) / 0.22;
    const inv = 1 - t;
    const x =
      inv * inv * inv * 210 +
      3 * inv * inv * t * 360 +
      3 * inv * t * t * 720 +
      t * t * t * 870;
    const y =
      inv * inv * inv * 355 +
      3 * inv * inv * t * 235 +
      3 * inv * t * t * 235 +
      t * t * t * 115;
    return { x: Math.round(x), y: Math.round(y) };
  }

  private cleanup(): void {
    this.release?.();
    this.release = undefined;
  }
}
