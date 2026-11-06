import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DecisionLoopCue } from './decision-loop-geometry';

/**
 * The one app control a loop stage runs on, drawn in the app's own shape:
 * - badge:  the info-tinted outline badge of the roles accordion;
 * - model:  the Decision model row's cell (provider mark, served-by name,
 *           state badge; decision-model-row.component.ts), the mark drawn as
 *           the app's lucide `bot` fallback glyph;
 * - toggle: the Routing suggestions toggle-xs toggle-success, on
 *           (host-routing-setting.component.ts).
 * Decorative; the stage label carries the meaning.
 */
@Component({
  selector: 'ptah-decision-loop-stage-cue',
  standalone: true,
  template: `
    @let c = cue();
    <span class="cue" aria-hidden="true">
      @switch (c.kind) {
        @case ('badge') {
          <span class="app-badge is-info">{{ c.text }}</span>
        }
        @case ('model') {
          <span class="cue-cell">
            <svg class="cue-mark" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM2 14h2M20 14h2M15 13v2M9 13v2"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="cue-text">{{ c.text }}</span>
          </span>
          <span class="app-badge">{{ c.state }}</span>
        }
        @case ('toggle') {
          <span class="app-toggle"></span>
          <span class="cue-text">{{ c.text }}</span>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: block;
    }

    .cue {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }

    .cue-cell {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      height: 1.6rem;
      padding: 0 0.5rem;
      border: 1px solid var(--app-line-strong);
      border-radius: 0.375rem;
      background: var(--app-b1);
    }

    .cue-mark {
      flex: none;
      width: 0.875rem;
      height: 0.875rem;
      color: var(--app-ink);
    }

    .cue-text {
      overflow: hidden;
      color: var(--app-ink);
      font-size: 0.75rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  styleUrls: ['../shared/app-mock.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionLoopStageCueComponent {
  public readonly cue = input.required<DecisionLoopCue>();
}
