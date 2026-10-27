import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { NOT_REPORTED_TITLE, type AgentDetailCell } from './inspector-agent-list';

/**
 * Dock detail of the selected AGENTS row, rendered in the flow directly under
 * it: a mini row of figures (Context, In / out and Turns or Duration when
 * known) and the "Open thread" action. Projected content (the row's actions
 * menu) sits beside the action.
 */
@Component({
  selector: 'ptah-inspector-agent-dock-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pb-2 pl-[52px] pr-3" data-testid="agent-dock-detail">
      <dl
        class="grid"
        [style.grid-template-columns]="
          'repeat(' + cells().length + ', minmax(0, 1fr))'
        "
      >
        @for (cell of cells(); track cell.label; let first = $first) {
          <div
            class="min-w-0"
            [class.border-l]="!first"
            [class.border-surface-border]="!first"
            [class.pl-2]="!first"
          >
            <dt class="text-[11px] text-base-content-muted">{{ cell.label }}</dt>
            <dd
              class="truncate text-xs font-semibold tabular-nums"
              [class.text-base-content-muted]="cell.title === notReported"
              [attr.title]="cell.title"
            >
              {{ cell.value }}
            </dd>
          </div>
        }
      </dl>
      <div class="mt-1.5 flex min-h-6 items-center justify-between gap-2">
        @if (canOpen()) {
          <button
            type="button"
            data-testid="agent-open-thread"
            class="link link-hover text-xs font-medium text-info focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            [attr.aria-label]="'Open ' + name() + ' thread'"
            (click)="openThread.emit()"
          >
            Open thread <span aria-hidden="true">→</span>
          </button>
        } @else {
          <span></span>
        }
        <ng-content />
      </div>
    </div>
  `,
})
export class InspectorAgentDockDetailComponent {
  readonly name = input.required<string>();
  readonly cells = input.required<readonly AgentDetailCell[]>();
  /** The host can show this agent's thread. */
  readonly canOpen = input(false);
  readonly openThread = output<void>();

  protected readonly notReported = NOT_REPORTED_TITLE;
}
