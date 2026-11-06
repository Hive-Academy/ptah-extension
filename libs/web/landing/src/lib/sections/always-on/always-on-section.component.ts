import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const ALWAYS_ON_POINTS: readonly string[] = [
  'No binding yet: the control stays disabled.',
  'Session switching is Discord only.',
  'Catch-up within a day: none, last, or all.',
];

/** Widths of the abstract chat lines in the desktop window, as shares of its body. */
const DESK_LINES = [0.62, 0.84, 0.48, 0.74, 0.56] as const;

/**
 * Always-on. Composition "hand-off": a desktop chat window runs off the left
 * page edge; the live chat moves across the gap to a phone set higher on
 * the right, and the three points arrive on the phone as messages. The
 * desktop composer shows a lock once the chat is handed over. The header sits
 * top-right, above the phone. Scroll: the header lines, the desk rises, then
 * the pinned steps hand off, lock the composer and deliver the messages,
 * top-down. The desk takes the shared split clip size (`section-media.css`).
 */
@Component({
  selector: 'ptah-always-on-section',
  standalone: true,
  imports: [SectionHeaderComponent],
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

        <div class="ao-desk" data-desk aria-hidden="true" [class.is-locked]="reached() >= 1">
          <div class="desk-bar"><i></i><i></i><i></i></div>
          <div class="desk-body">
            @for (line of deskLines; track $index; let odd = $odd) {
              <span class="desk-line" [class.is-reply]="odd" [style.--line]="line"></span>
            }
          </div>
          <div class="desk-composer">
            <span class="composer-caret"></span>
            <svg class="composer-lock" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
        </div>

        <div class="ao-phone" data-phone [class.is-live]="reached() >= 1">
          <div class="phone-notch" aria-hidden="true"></div>
          <ul class="ao-points">
            @for (point of points(); track point; let i = $index) {
              <li class="ao-point" [class.is-in]="reached() > i">{{ point }}</li>
            }
          </ul>
        </div>
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

  protected readonly deskLines = DESK_LINES;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Messages delivered so far (0 to 3); the first one also locks the desk. */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
}
