import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { STEP_THRESHOLDS, stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const COMMAND_CENTER_POINTS: readonly string[] = [
  'Twenty tiles. Nine may run together.',
  'The bell splits needs-you from notices.',
  'Git changes beside chat. Foreign trees stay read-only.',
];

/** The rail: twenty session ticks, nine of them running (from the headline). */
const RAIL_TICKS = 20;
const RAIL_RUNNING = 9;

/**
 * First section after the hero. Composition "rail and bleed": a wide clip
 * anchored to the right page edge (its right side squared off, so the desktop
 * reads as running on past the screen), with a session rail of twenty ticks
 * and the three points as stacked tiles overlapping its left edge. The
 * header sits in an off-centre column on the left. Scroll: the header lines,
 * then the clip rises, then the pinned steps light the nine running ticks
 * and bring the tiles in, top-down. Its clip, header column and type set
 * the shared media proportions (`section-media.css`) every other section follows.
 */
@Component({
  selector: 'ptah-command-center-section',
  standalone: true,
  imports: [ConsoleClipComponent, SectionHeaderComponent],
  template: `
    <section id="command-center" class="section-frame" aria-labelledby="command-center-title">
      <div class="frame-atmosphere cc-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="cc-stage" data-stage data-layout="rail-bleed" [style.--enter]="scroll.enter()">
        <!-- Desktop: over the clip's top-left on an ink scrim, so it stays on screen while pinned. -->
        <div class="cc-head" data-overlap>
          <ptah-section-header
            titleId="command-center-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
        </div>
        <div class="cc-clip">
          <ptah-console-clip
            class="cc-video"
            video="/assets/live-demo/multi-agent.mp4"
            videoWebm="/assets/live-demo/multi-agent.webm"
            poster="/assets/live-demo/multi-agent.jpg"
            label="PtahCode desktop: the session rail, the agents panel and the git dock beside the chat"
          />

          <div class="cc-rail" data-rail>
            <div class="rail-ticks" aria-hidden="true">
              @for (tick of ticks; track tick) {
                <span class="rail-tick" [class.is-running]="tick < running()"></span>
              }
            </div>
            <ul class="rail-tiles">
              @for (point of points(); track point; let i = $index) {
                <li class="rail-tile" [class.is-in]="reached() > i">
                  <span class="tile-mark" aria-hidden="true"></span>
                  <span>{{ point }}</span>
                </li>
              }
            </ul>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    './command-center-section.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandCenterSectionComponent {
  public readonly eyebrow = input<string>('On your desktop');
  public readonly headline = input<string>('One rail. Nine running. One bell.');
  public readonly subline = input<string>(
    'Twenty session tiles per workspace. Answer a permission or a question from the bell without leaving the thread.',
  );
  public readonly points = input<readonly string[]>(COMMAND_CENTER_POINTS);

  protected readonly ticks = Array.from({ length: RAIL_TICKS }, (_, index) => index);

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Tiles in so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** Running ticks light up with the steps; all nine by the last tile. */
  public readonly running = computed(() =>
    Math.round(RAIL_RUNNING * Math.min(1, this.scroll.steps() / STEP_THRESHOLDS[2])),
  );
}
