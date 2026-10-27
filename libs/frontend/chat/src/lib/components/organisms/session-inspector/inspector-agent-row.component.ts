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
  'grid-cols-[minmax(0,1fr)_3.25rem_3rem_3rem] gap-x-1.5';

/**
 * One AGENTS row: the provider avatar with its status badge, name and type,
 * status, tokens and cost. A disclosure button: `aria-expanded` reports its
 * dock detail; Enter / Space select it like a click.
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
      class="grid w-full {{ columns }} items-center px-3 py-1.5 text-left hover:bg-base-content/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content"
      [attr.data-agent-key]="r.key"
      [attr.aria-label]="r.ariaLabel"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? controls() : null"
      (click)="selected.emit()"
    >
      <span class="flex min-w-0 items-center gap-2">
        <ptah-agent-avatar
          [kind]="r.agent.kind"
          [status]="r.agent.status"
          [cliId]="r.agent.cliId"
          [agentType]="r.agent.agentType"
          [size]="28"
        />
        <span class="min-w-0">
          <span class="block truncate text-xs font-semibold">{{ r.name }}</span>
          <span
            class="block truncate text-[11px] text-base-content-muted"
            [attr.title]="r.secondaryTitle"
            >{{ r.secondary }}</span
          >
        </span>
      </span>
      <span class="truncate text-[11px] font-medium {{ r.statusInk }}">{{
        r.statusText
      }}</span>
      <span
        class="truncate text-right text-[11px] tabular-nums"
        data-testid="agent-row-tokens"
        [class.text-base-content-muted]="r.tokens === dash"
        [attr.title]="r.tokens === dash ? notReported : null"
        >{{ r.tokens }}</span
      >
      <span
        class="truncate text-right text-[11px] tabular-nums"
        data-testid="agent-row-cost"
        [class.text-base-content-muted]="r.cost === dash"
        [attr.title]="r.cost === dash ? notReported : null"
        >{{ r.cost }}</span
      >
    </button>
  `,
})
export class InspectorAgentRowComponent {
  readonly row = input.required<AgentListRow>();
  readonly open = input(false);
  /** Id of the dock detail this row expands. */
  readonly controls = input<string | null>(null);
  readonly selected = output<void>();

  protected readonly columns = AGENT_ROW_COLUMNS;
  protected readonly dash = NOT_REPORTED_VALUE;
  protected readonly notReported = NOT_REPORTED_TITLE;
}
