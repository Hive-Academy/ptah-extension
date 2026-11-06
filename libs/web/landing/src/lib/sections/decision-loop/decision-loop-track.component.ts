import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  DECISION_LOOP_STAGES,
  LOOP_PATHS,
  orbCoordinates,
  stageReached,
  type DecisionLoopStage,
} from './decision-loop-geometry';

/**
 * The loop's track: the 01 -> 06 stadium circuit, the 06 -> 03 feedback arc,
 * the stage anchor rings and the travelling orb (desktop), plus the vertical
 * rail (compact screens). Decorative; the host section draws the strokes in
 * by setting dash offsets on the `data-*` paths and passes the progress in.
 */
@Component({
  selector: 'ptah-decision-loop-track',
  standalone: true,
  template: `
    <svg class="loop-svg-desktop" viewBox="0 0 1080 470" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="decision-loop-amber" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffbb4d" />
          <stop offset="50%" stop-color="#f5a524" />
          <stop offset="100%" stop-color="#ffbb4d" />
        </linearGradient>
        <linearGradient id="decision-feedback-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f5a524" />
          <stop offset="55%" stop-color="#ffbb4d" />
          <stop offset="100%" stop-color="#fff9eb" />
        </linearGradient>
      </defs>

      <path [attr.d]="paths.perimeter" stroke="#262a33" stroke-width="2" />
      <path [attr.d]="paths.leftClosure" stroke="#f5a524" stroke-opacity="0.26" stroke-width="1.5" stroke-dasharray="5 7" />

      <path data-forward-glow [attr.d]="paths.forward" stroke="#f5a524" stroke-opacity="0.1" stroke-width="5" stroke-linecap="round" pathLength="1" />
      <path data-forward-path [attr.d]="paths.forward" stroke="url(#decision-loop-amber)" stroke-width="2" stroke-linecap="round" pathLength="1" />
      <path data-forward-core [attr.d]="paths.forward" stroke="#fff9eb" stroke-opacity="0.78" stroke-width="1" stroke-linecap="round" pathLength="1" />

      <!-- Feedback return: 06 "Check files, feed back" -> 03 "Blend 90-day evidence" -->
      <path [attr.d]="paths.feedback" stroke="#262a33" stroke-width="2" stroke-dasharray="4 6" />
      <path data-feedback-glow [attr.d]="paths.feedback" stroke="#f5a524" stroke-opacity="0.12" stroke-width="5" stroke-linecap="round" pathLength="1" />
      <path data-feedback-path [attr.d]="paths.feedback" stroke="url(#decision-feedback-grad)" stroke-width="2" stroke-linecap="round" pathLength="1" />

      <g stroke="#ffbb4d" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 372 110 L 380 115 L 372 120" />
        <path d="M 702 110 L 710 115 L 702 120" />
        <path d="M 985 231 L 990 239 L 995 231" />
        <path d="M 708 350 L 700 355 L 708 360" />
        <path d="M 378 350 L 370 355 L 378 360" />
      </g>
      <path d="M 534 233 L 545 232 L 541 242" stroke="#fff9eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

      <circle cx="870" cy="115" r="42" stroke="#ffbb4d" stroke-opacity="0.28" stroke-width="1" stroke-dasharray="3 5" />
      <circle cx="210" cy="355" r="42" stroke="#f5a524" stroke-opacity="0.24" stroke-width="1" stroke-dasharray="3 5" />

      @for (stage of stages(); track stage.id; let i = $index) {
        <circle
          [attr.cx]="stage.x"
          [attr.cy]="stage.y"
          r="28"
          fill="#08090c"
          [attr.stroke]="reached(i) ? '#f5a524' : '#262a33'"
          stroke-width="1.5"
        />
      }

      <g data-orb-group [attr.transform]="orbTransform()">
        <circle r="14" fill="#f5a524" fill-opacity="0.22" />
        <circle r="6" fill="#ffbb4d" />
        <circle r="2.5" fill="#fff9eb" />
      </g>
    </svg>

    <svg class="loop-svg-mobile" viewBox="0 0 56 520" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <path d="M 34 28 L 34 492" stroke="#262a33" stroke-width="2" />
      <path data-mobile-forward d="M 34 28 L 34 492" stroke="#f5a524" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
      <path d="M 34 492 C 6 492, 6 214, 34 214" stroke="#262a33" stroke-width="1.75" stroke-dasharray="4 5" />
      <path data-mobile-feedback d="M 34 492 C 6 492, 6 214, 34 214" stroke="#ffbb4d" stroke-width="2.25" stroke-linecap="round" pathLength="1" />
      <path d="M 27 210 L 34 214 L 27 218" stroke="#ffbb4d" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  styleUrls: ['./decision-loop-track.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopTrackComponent {
  public readonly stages = input<readonly DecisionLoopStage[]>(DECISION_LOOP_STAGES);
  public readonly progress = input(1);

  protected readonly paths = LOOP_PATHS;
  protected readonly orbTransform = computed(() => {
    const { x, y } = orbCoordinates(this.progress());
    return `translate(${x} ${y})`;
  });

  protected reached(index: number): boolean {
    return stageReached(this.progress(), index);
  }
}
