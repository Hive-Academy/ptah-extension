import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { FlankBoltComponent } from '../shared/flank-bolt.component';
import { REVEAL, revealedLines } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { STEP_THRESHOLDS, stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const TRIBUNAL_POINTS: readonly string[] = [
  'Vendors review or debate one decision.',
  'You confirm the panel before it starts.',
  'Too few vendor families, and it says so.',
];

/** The bench behind the clip: five empty seats, fanned. */
const SEATS = [-8, -4, 0, 4, 8] as const;

/**
 * Tribunal. Composition "the bench": a big clip anchored right with a fan of
 * five empty console windows (the panel's seats) rising from behind its top
 * edge; on desktop the larger copy column overlaps the clip's left edge on an
 * ink scrim, so the headline stays on screen while pinned. The last point is
 * set as the verdict and lands last. Scroll: the header lines, the clip
 * rises, then the pinned steps seat the panel and bring the points in, the
 * verdict last. Two canvas bolts flank the clip: one under its right part,
 * one along its right edge.
 */
@Component({
  selector: 'ptah-tribunal-section',
  standalone: true,
  imports: [ConsoleClipComponent, FlankBoltComponent, SectionHeaderComponent],
  template: `
    <section id="tribunal" class="section-frame" aria-labelledby="tribunal-title">
      <div class="frame-atmosphere tb-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="tb-stage" data-stage data-layout="bench" [style.--enter]="scroll.enter()">
        <div class="tb-text">
          <ptah-section-header
            titleId="tribunal-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
          <ul class="tb-points">
            @for (point of points(); track point; let i = $index; let last = $last) {
              <li class="tb-point" [class.is-verdict]="last" [class.is-in]="reached() > i">
                {{ point }}
              </li>
            }
          </ul>
        </div>
        <div class="tb-clip">
          <ptah-flank-bolt class="tb-bolt tb-bolt-floor" axis="horizontal" [seed]="83" [strike]="strike()" />
          <div class="tb-bench" aria-hidden="true">
            @for (tilt of seats; track $index; let i = $index) {
              <span class="tb-seat" [class.is-in]="seated() > i" [style.--tilt]="tilt + 'deg'" [style.--at]="i">
                <span class="seat-bar"><i></i><i></i><i></i></span>
              </span>
            }
          </div>
          <ptah-flank-bolt class="tb-bolt tb-bolt-outer" axis="vertical" [seed]="97" [strike]="strike()" />
          <ptah-console-clip
            class="tb-video"
            video="/assets/live-demo/tribunal-council.mp4"
            videoWebm="/assets/live-demo/tribunal-council.webm"
            poster="/assets/live-demo/tribunal-council.jpg"
            label="PtahCode chat: a council of vendors reviews one release plan"
          />
        </div>
      </div>
    </section>
  `,
  styleUrls: ['../shared/section-frame.css', './tribunal-section.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TribunalSectionComponent {
  public readonly eyebrow = input<string>('In the chat');
  public readonly headline = input<string>('Several vendors debate one call.');
  public readonly subline = input<string>(
    'Ask in the chat you already have. It is not a separate screen.',
  );
  public readonly points = input<readonly string[]>(TRIBUNAL_POINTS);

  protected readonly seats = SEATS;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Points in so far (0 to 3); the verdict is the third. */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** Seats taken so far: the whole panel by the first point. */
  public readonly seated = computed(() =>
    Math.round(SEATS.length * Math.min(1, this.scroll.steps() / STEP_THRESHOLDS[0])),
  );
  /** The flanking bolts flash once per header line and once per point. */
  public readonly strike = computed(() => revealedLines(this.headerProgress()) + this.reached());
}
