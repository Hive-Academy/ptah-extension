import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { STEP_THRESHOLDS, stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const VOICE_AND_APPS_POINTS: readonly string[] = [
  'Interrupt it. It speaks briefly, then hands the rest off.',
  'Voice off until set. Local Whisper, Kokoro; ElevenLabs optional.',
  'Fixed parts only. Not HTML you write.',
];

/** Bar heights of the spoken reply: short, then handed off to a flat line. */
const VOICE_BARS = [0.4, 0.7, 1, 0.55, 0.85, 0.3, 0.65, 0.95, 0.5, 0.75, 0.35, 0.6, 0.9, 0.45, 0.7, 0.3] as const;

/**
 * Voice and Apps. Composition "text-led": the copy leads in a wide column on
 * the right; a smaller clip sits on the left, set lower than the headline.
 * Signature: a voice strip under the headline, a short burst of bars (it
 * speaks briefly) that ends in a flat amber line (then hands the rest off),
 * the first point drawn. Scroll: the header lines, the clip rises, then the
 * pinned steps speak the bars, draw the hand-off and bring the points in.
 * Sizes come from the shared media tokens (`section-media.css`).
 */
@Component({
  selector: 'ptah-voice-and-apps-section',
  standalone: true,
  imports: [ConsoleClipComponent, SectionHeaderComponent],
  template: `
    <section id="voice-and-apps" class="section-frame" aria-labelledby="voice-and-apps-title">
      <div class="frame-atmosphere va-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="va-stage" data-stage data-layout="text-led" [style.--enter]="scroll.enter()">
        <div class="va-clip">
          <ptah-console-clip
            class="va-video"
            video="/assets/live-demo/command-center.mp4"
            videoWebm="/assets/live-demo/command-center.webm"
            poster="/assets/live-demo/command-center.jpg"
            label="PtahCode Voice tab: a spoken command runs the work"
          />
        </div>

        <div class="va-text">
          <ptah-section-header
            titleId="voice-and-apps-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
          <div class="va-voice" data-voice-strip aria-hidden="true">
            @for (bar of bars; track $index; let i = $index) {
              <span class="voice-bar" [class.is-in]="spoken() > i" [style.--bar]="bar"></span>
            }
            <span class="voice-handoff" [class.is-in]="reached() >= 1"></span>
          </div>
          <ul class="va-points">
            @for (point of points(); track point; let i = $index) {
              <li class="va-point" [class.is-in]="reached() > i">{{ point }}</li>
            }
          </ul>
        </div>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    './voice-and-apps-section.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoiceAndAppsSectionComponent {
  public readonly eyebrow = input<string>('Title bar');
  public readonly headline = input<string>('Talk to the work. Use the app.');
  public readonly subline = input<string>(
    'Voice is a spoken stage of the work on the desktop. Apps builds a form, chart, or table in its own chat.',
  );
  public readonly points = input<readonly string[]>(VOICE_AND_APPS_POINTS);

  protected readonly bars = VOICE_BARS;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Points in so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** Bars spoken so far: all of them by the first point. */
  public readonly spoken = computed(() =>
    Math.round(VOICE_BARS.length * Math.min(1, this.scroll.steps() / STEP_THRESHOLDS[0])),
  );
}
