import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { STEP_THRESHOLDS, stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const MULTI_VENDOR_POINTS: readonly string[] = [
  'Up to three child chats, each in a worktree.',
  'A new chat can adopt work still running.',
  'Past 150,000 tokens or 10 idle minutes: fresh brief.',
];

/** The third lane's context meter after the reset: a short fresh brief. */
export const FRESH_BRIEF_FILL = 0.14;

/**
 * Multi-vendor. Composition "front and lanes": the main chat clip runs off
 * the LEFT page edge (its left side squared off, the only section anchored
 * that way); the copy column overlaps the clip's top-right corner on an ink
 * scrim that fades in from the clip, so the headline stays on screen while the
 * stage is pinned. Under the header, three child-chat lanes branch out of the
 * clip's right edge as a staircase that steps away from it, one point per
 * lane. Signature: the third lane carries a context meter that fills with the
 * steps, then drops to a short fresh brief when its point lands. Scroll: the
 * header lines, the clip rises into place, then the pinned steps
 * branch the lanes top-down. The command-center layout mirrored: same clip
 * width, header column and type, from the shared tokens (`section-media.css`).
 */
@Component({
  selector: 'ptah-multi-vendor-section',
  standalone: true,
  imports: [ConsoleClipComponent, SectionHeaderComponent],
  template: `
    <section
      id="multi-vendor-orchestration"
      class="section-frame"
      aria-labelledby="multi-vendor-title"
    >
      <div class="frame-atmosphere mv-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="mv-stage" data-stage data-layout="front-lanes" [style.--enter]="scroll.enter()">
        <div class="mv-clip">
          <ptah-console-clip
            class="mv-video"
            video="/assets/live-demo/orchestration.mp4"
            videoWebm="/assets/live-demo/orchestration.webm"
            poster="/assets/live-demo/orchestration.jpg"
            label="PtahCode session: one prompt coordinates background work"
          />
        </div>

        <div class="mv-text" data-overlap>
          <ptah-section-header
            titleId="multi-vendor-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
          <ul class="mv-lanes" data-lanes>
            @for (point of points(); track point; let i = $index; let last = $last) {
              <li class="mv-lane" [class.is-in]="reached() > i" [style.--lane]="i">
                <span class="lane-branch" aria-hidden="true"></span>
                <span class="lane-text">{{ point }}</span>
                @if (last) {
                  <span
                    class="lane-meter"
                    data-meter
                    aria-hidden="true"
                    [class.is-fresh]="fresh()"
                    [style.--fill]="meterFill()"
                  ></span>
                }
              </li>
            }
          </ul>
        </div>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    './multi-vendor-section.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiVendorSectionComponent {
  public readonly eyebrow = input<string>('Beside the chat');
  public readonly headline = input<string>('Claude or Codex up front.');
  public readonly subline = input<string>(
    'Background work uses the command-line agents already installed on your machine.',
  );
  public readonly points = input<readonly string[]>(MULTI_VENDOR_POINTS);

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Lanes branched so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** The third lane's point is in: its context has been replaced by a fresh brief. */
  public readonly fresh = computed(() => this.reached() >= STEP_THRESHOLDS.length);
  /** The meter fills with the steps until the third point, then resets short. */
  public readonly meterFill = computed(() =>
    this.fresh()
      ? FRESH_BRIEF_FILL
      : Math.min(1, this.scroll.steps() / STEP_THRESHOLDS[STEP_THRESHOLDS.length - 1]),
  );
}
