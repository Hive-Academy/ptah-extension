import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { AgentAvatarComponent } from '@ptah-extension/chat-ui';
import {
  NOT_REPORTED_TITLE,
  NOT_REPORTED_VALUE,
  type AgentListRow,
} from './inspector-agent-list';

/** Column template shared by the AGENTS header row and every agent row. */
export const AGENT_ROW_COLUMNS =
  'grid-cols-[minmax(0,1fr)_3rem_3.5rem_3rem] gap-x-1.5';

/**
 * One AGENTS row: the provider avatar with its status badge, name and model,
 * tokens (In / out in the tooltip), cost and status. A click (Enter / Space)
 * selects the row and opens the agent's thread.
 */
@Component({
  selector: 'ptah-inspector-agent-row',
  standalone: true,
  imports: [AgentAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let r = row();
    <button
      type="button"
      class="grid w-full {{
        columns
      }} items-center py-1.5 pl-3 pr-1 text-left hover:bg-base-content/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content"
      [attr.data-agent-key]="r.key"
      [attr.aria-label]="r.ariaLabel"
      [disabled]="r.agent.kind === 'task'"
      (click)="selected.emit()"
    >
      <span class="flex min-w-0 items-center gap-2">
        <ptah-agent-avatar
          [kind]="r.agent.kind"
          [status]="r.agent.status"
          [cliId]="r.agent.cliId"
          [agentType]="r.agent.agentType"
          [size]="24"
        />
        <span class="min-w-0">
          <span
            class="block truncate text-[11.5px] font-semibold"
            [attr.title]="r.name"
            >{{ r.name }}</span
          >
          <span
            class="block truncate text-[10.5px] text-base-content-muted"
            data-testid="agent-row-model"
            [attr.title]="r.secondaryTitle"
            >{{ r.secondary }}</span
          >
        </span>
      </span>
      <span
        class="truncate text-right text-[10.5px] tabular-nums"
        data-testid="agent-row-tokens"
        [class.text-base-content-muted]="r.tokens === dash"
        [attr.title]="r.tokens === dash ? notReported : r.tokensTitle"
        >{{ r.tokens }}</span
      >
      <span
        class="truncate text-right text-[10.5px] tabular-nums"
        data-testid="agent-row-cost"
        [class.text-base-content-muted]="r.cost === dash"
        [attr.title]="r.cost === dash ? notReported : r.cost"
        >{{ r.cost }}</span
      >
      <span
        class="truncate text-right text-[10.5px] font-medium {{ r.statusInk }}"
        >{{ r.statusText }}</span
      >
    </button>
  `,
})
export class InspectorAgentRowComponent {
  readonly row = input.required<AgentListRow>();
  readonly selected = output<void>();

  protected readonly columns = AGENT_ROW_COLUMNS;
  protected readonly dash = NOT_REPORTED_VALUE;
  protected readonly notReported = NOT_REPORTED_TITLE;
}
