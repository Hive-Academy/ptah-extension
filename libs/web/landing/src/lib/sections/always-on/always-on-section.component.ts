import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const ALWAYS_ON_POINTS: readonly string[] = [
  'No binding yet: the control stays disabled.',
  'Session switching is Discord only.',
  'Catch-up within a day: none, last, or all.',
];

/** The always-on clip: 1280 x 720 (16 : 9), 8 s, muted. */
export const ALWAYS_ON_CLIP = {
  video: '/assets/live-demo/always-on.mp4',
  videoWebm: '/assets/live-demo/always-on.webm',
  poster: '/assets/live-demo/always-on.jpg',
  label: 'Hand the live chat to your phone: the desktop composer locks until you take it back',
} as const;

/**
 * Always-on. Composition "hand-off": a 16 : 9 clip runs off the left page
 * edge (the desktop chat handing off to a phone, the composer locking). The
 * header sits top-right; the three points are listed under it. The clip has
 * no readable text, so the copy stays in the page. Scroll: the header lines,
 * the clip rises, then the pinned steps bring the points in, top-down. The
 * clip takes the shared split clip size (`section-media.css`) at 16 : 9.
 */
@Component({
  selector: 'ptah-always-on-section',
  standalone: true,
  imports: [ConsoleClipComponent, SectionHeaderComponent],
  template: `
    <section id="always-on" class="section-frame" aria-labelledby="always-on-title">
      <div class="frame-atmosphere ao-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="ao-stage" data-stage data-layout="hand-off" [style.--enter]="scroll.enter()">
        <div class="ao-head">
          <ptah-section-header
            titleId="always-on-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
        </div>

        <div class="ao-clip" data-clip>
          <ptah-console-clip
            [video]="clip.video"
            [videoWebm]="clip.videoWebm"
            [poster]="clip.poster"
            [label]="clip.label"
          />
        </div>

        <ul class="ao-points">
          @for (point of points(); track point; let i = $index) {
            <li class="ao-point" [class.is-in]="reached() > i">
              <span class="point-mark" aria-hidden="true"></span>
              <span>{{ point }}</span>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    './always-on-section.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlwaysOnSectionComponent {
  public readonly eyebrow = input<string>('Off the desk');
  public readonly headline = input<string>('Hand the live chat to your phone.');
  public readonly subline = input<string>(
    'Pair Telegram, Discord, or Slack. The desktop composer locks until you take it back.',
  );
  public readonly points = input<readonly string[]>(ALWAYS_ON_POINTS);

  protected readonly clip = ALWAYS_ON_CLIP;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Points in so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
}
