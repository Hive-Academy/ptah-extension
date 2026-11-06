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
import { REVEAL, bindSectionScroll } from '../shared/section-scroll';
import {
  DECISION_LOOP_STAGES,
  STAGE_THRESHOLDS,
  stageReached,
  type DecisionLoopStage,
} from './decision-loop-geometry';
import { DecisionLoopRolesBarComponent } from './decision-loop-roles-bar.component';
import { DecisionLoopStageComponent } from './decision-loop-stage.component';
import { DecisionLoopTrackComponent } from './decision-loop-track.component';

export { DECISION_LOOP_STAGES, type DecisionLoopStage } from './decision-loop-geometry';

const FORWARD_SELECTORS =
  '[data-forward-glow], [data-forward-path], [data-forward-core], [data-mobile-forward]';
const FEEDBACK_SELECTORS = '[data-feedback-glow], [data-feedback-path], [data-mobile-feedback]';

/**
 * S3 decision loop. The window reads as a piece of the app's Settings:
 * the "Background Model Roles" accordion header on top, and each of the six
 * stages as a consumer-row card (decision-model-row) with the one control it
 * runs on. The amber circuit runs 01 -> 06 and returns from 06 "Check files,
 * feed back" to 03 "Blend 90-day evidence". Scroll draws it in; SSR and
 * reduced motion render it settled.
 */
@Component({
  selector: 'ptah-decision-loop-section',
  standalone: true,
  imports: [DecisionLoopRolesBarComponent, DecisionLoopStageComponent, DecisionLoopTrackComponent],
  template: `
    <section id="decision-model-loop" class="decision-loop-section" aria-labelledby="decision-loop-title">
      <div class="loop-atmosphere" aria-hidden="true"></div>
      <div class="loop-grain" aria-hidden="true"></div>

      <div class="loop-shell">
        <header class="loop-header">
          <p class="loop-eyebrow rise" [class.is-in]="revealProgress() >= reveal.eyebrow">
            <span class="cue-line" aria-hidden="true"></span>
            <span>{{ eyebrow() }}</span>
            <span class="cue-line" aria-hidden="true"></span>
          </p>
          <h2 id="decision-loop-title" class="loop-title rise" [class.is-in]="revealProgress() >= reveal.headline">
            {{ headline() }}
          </h2>
          <p class="loop-subline rise" [class.is-in]="revealProgress() >= reveal.subline">
            {{ subline() }}
          </p>
        </header>

        <div
          class="loop-window app-frame rise"
          data-loop-window
          [class.is-in]="revealProgress() >= reveal.visual"
          [style.--loop-progress]="loopProgress()"
        >
          <ptah-decision-loop-roles-bar />
          <div class="loop-canvas-wrap">
            <ptah-decision-loop-track [stages]="stages()" [progress]="loopProgress()" />

            <ol class="loop-stages">
              @for (stage of stages(); track stage.id; let i = $index) {
                <li
                  ptah-decision-loop-stage
                  class="loop-stage app-card"
                  [stage]="stage"
                  [attr.data-stage-index]="i"
                  [class.is-reached]="isStageReached(i)"
                  [class.is-active]="activeStage() === i"
                  [class.is-convergence]="i === 2"
                  [class.is-feedback-lit]="feedbackLit()"
                ></li>
              }
            </ol>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrls: ['../shared/app-mock.css', './decision-loop-section.component.css'],
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

  /** Section scroll progress for the top-down header reveal; settled at 1. */
  public readonly revealProgress = signal(1);
  protected readonly reveal = REVEAL;

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
    return stageReached(this.loopProgress(), index);
  }

  public setProgress(rawProgress: number): void {
    const clamped = Math.max(0, Math.min(1, rawProgress));
    this.loopProgress.set(clamped);

    // Stage 06 returns to Stage 03 at the end of the loop (>= 0.92).
    if (clamped >= 0.92) {
      this.activeStage.set(2);
    } else {
      let current = 0;
      STAGE_THRESHOLDS.forEach((threshold, i) => {
        if (clamped >= threshold) current = i;
      });
      this.activeStage.set(current);
    }

    this.syncSvgStrokeProgress(clamped);
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const section = this.host.nativeElement.querySelector<HTMLElement>('section');
    if (!view || !section) return;

    // Vertical scroll drives everything: the header rises in reading order,
    // then the loop advances over the rest of the scroll (pinned on desktop)
    // and settles complete before the pin ends.
    this.release = bindSectionScroll(section, view, (progress) => {
      this.revealProgress.set(progress);
      const loop = (progress - REVEAL.visual) / (0.92 - REVEAL.visual);
      this.setProgress(Math.max(0.06, loop));
    });
  }

  private syncSvgStrokeProgress(progress: number): void {
    const root = this.host.nativeElement;
    const forward = Math.min(1, progress / 0.78);
    const feedback = progress <= 0.78 ? 0 : Math.min(1, (progress - 0.78) / 0.22);
    const draw = (selectors: string, fraction: number): void =>
      root.querySelectorAll<SVGPathElement>(selectors).forEach((pathEl) => {
        pathEl.style.strokeDasharray = '1';
        pathEl.style.strokeDashoffset = String(1 - fraction);
      });
    draw(FORWARD_SELECTORS, forward);
    draw(FEEDBACK_SELECTORS, feedback);
  }

  private cleanup(): void {
    this.release?.();
    this.release = undefined;
  }
}
