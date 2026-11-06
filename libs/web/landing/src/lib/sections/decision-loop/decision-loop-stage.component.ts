import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DecisionLoopStage } from './decision-loop-geometry';
import { DecisionLoopStageCueComponent } from './decision-loop-stage-cue.component';

/**
 * One stage of the loop, drawn as a consumer-row card (decision-model-row):
 * the label as its name, the number in an xs badge, then the control the
 * stage runs on. The host is the list item itself, so the parent keeps a
 * real `<ol>` and sets the state classes (`is-reached`, `is-active`,
 * `is-convergence`, `is-feedback-lit`) and `data-stage-index` on it.
 */
@Component({
  // The host must be the <li> of the parent's <ol> (same pattern as canvas-rail-card).
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[ptah-decision-loop-stage]',
  standalone: true,
  imports: [DecisionLoopStageCueComponent],
  template: `
    <div class="stage-header">
      <span class="stage-node-dot" aria-hidden="true"></span>
      <span class="stage-label">{{ stage().label }}</span>
      <span class="stage-number app-badge" aria-hidden="true">{{ stage().number }}</span>
    </div>
    @if (stage().cue; as cue) {
      <ptah-decision-loop-stage-cue class="stage-cue" [cue]="cue" />
    }
  `,
  styleUrls: ['../shared/app-mock.css', './decision-loop-stage.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopStageComponent {
  public readonly stage = input.required<DecisionLoopStage>();
}
