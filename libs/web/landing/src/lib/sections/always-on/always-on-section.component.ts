import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';
import { AlwaysOnDeskComponent } from './always-on-desk.component';

export const ALWAYS_ON_POINTS: readonly string[] = [
  'No binding yet: the control stays disabled.',
  'Session switching is Discord only.',
  'Catch-up within a day: none, last, or all.',
];

/**
 * Always-on. Composition "hand-off": the desktop app window runs off the left
 * page edge, drawn from the real hand-off UI (Session actions -> "Hand off
 * session to…" picker; then "Resolve back to webview", read-only here, the
 * composer locked; see always-on-desk). The live chat moves across the gap to
 * a phone set higher on the right, and the three points arrive on the phone
 * as messages, in the same surface and badge system. The header sits
 * top-right, above the phone. Scroll: the header lines, the desk rises, then
 * the pinned steps hand off, lock the composer and deliver the messages,
 * top-down. The desk takes the shared split clip size (`section-media.css`).
 */
@Component({
  selector: 'ptah-always-on-section',
  standalone: true,
  imports: [SectionHeaderComponent, AlwaysOnDeskComponent],
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
          <ptah-always-on-desk [handedOff]="reached() >= 1" />
        </div>

        <div class="ao-phone" data-phone [class.is-live]="reached() >= 1">
          <div class="phone-notch" aria-hidden="true"></div>
          <div class="phone-head" aria-hidden="true">
            <span class="app-dot" [class.is-ok]="reached() >= 1"></span>
            <span class="phone-name">Telegram</span>
          </div>
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
    '../shared/app-mock.css',
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

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Messages delivered so far (0 to 3); the first one also locks the desk. */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
}
