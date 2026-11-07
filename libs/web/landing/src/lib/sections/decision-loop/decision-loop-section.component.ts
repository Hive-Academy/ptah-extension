import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL, bindSectionScroll } from '../shared/section-scroll';
import { DECISION_LOOP_STAGES, stageReached, type DecisionLoopStage } from './decision-loop-stages';

export { DECISION_LOOP_STAGES, type DecisionLoopStage } from './decision-loop-stages';

/** The decision-loop clip: 1280 x 720 (16 : 9), 8 s, muted. */
export const DECISION_LOOP_CLIP = {
  video: '/assets/live-demo/decision-loop.mp4',
  videoWebm: '/assets/live-demo/decision-loop.webm',
  poster: '/assets/live-demo/decision-loop.jpg',
  label: 'The decision loop: six steps, and step 6 returns to step 3',
} as const;

/**
 * S3 decision loop. Header centred above a 16 : 9 clip of the loop (six
 * cards, the highlight moving card to card, step 6 returning to step 3).
 * The clip carries no readable text, so the six steps stay in the page as an
 * ordered list under it. Scroll brings the header in, then the steps, in
 * order; SSR and reduced motion render it settled.
 */
@Component({
  selector: 'ptah-decision-loop-section',
  standalone: true,
  imports: [ConsoleClipComponent],
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

        <div class="loop-clip rise" data-loop-clip [class.is-in]="revealProgress() >= reveal.visual">
          <ptah-console-clip
            [video]="clip.video"
            [videoWebm]="clip.videoWebm"
            [poster]="clip.poster"
            [label]="clip.label"
          />
        </div>

        <ol class="loop-stages">
          @for (stage of stages(); track stage.id; let i = $index) {
            <li class="loop-stage" [attr.data-stage-index]="i" [class.is-reached]="isStageReached(i)">
              <span class="stage-number" aria-hidden="true">{{ stage.number }}</span>
              <span class="stage-label">{{ stage.label }}</span>
            </li>
          }
        </ol>
      </div>
    </section>
  `,
  styleUrls: ['../shared/section-media.css', './decision-loop-section.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopSectionComponent {
  public readonly eyebrow = input<string>('Who runs it');
  public readonly headline = input<string>('How Ptah decides the work.');
  public readonly subline = input<string>(
    'A fast model proposes the job. Ninety days of local results, plus hard rules, shape who runs it.',
  );
  public readonly stages = input<readonly DecisionLoopStage[]>(DECISION_LOOP_STAGES);

  protected readonly clip = DECISION_LOOP_CLIP;

  /** Steps-in progress (0 to 1); settled at 1 for SSR and reduced motion. */
  public readonly loopProgress = signal(1);
  /** Section scroll progress for the top-down header reveal; settled at 1. */
  public readonly revealProgress = signal(1);
  protected readonly reveal = REVEAL;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private release?: () => void;

  public constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => this.initialize());
    inject(DestroyRef).onDestroy(() => {
      this.release?.();
      this.release = undefined;
    });
  }

  public isStageReached(index: number): boolean {
    return stageReached(this.loopProgress(), index);
  }

  public setProgress(rawProgress: number): void {
    this.loopProgress.set(Math.max(0, Math.min(1, rawProgress)));
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const section = this.host.nativeElement.querySelector<HTMLElement>('section');
    if (!view || !section) return;

    // Vertical scroll: the header rises in reading order, then the steps come
    // in over the rest of the scroll (pinned on desktop), all in before the
    // pin ends.
    this.release = bindSectionScroll(section, view, (progress) => {
      this.revealProgress.set(progress);
      this.setProgress(Math.max(0.06, (progress - REVEAL.visual) / (0.92 - REVEAL.visual)));
    });
  }
}
