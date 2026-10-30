import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ResumableGenerationAgent } from '@ptah-extension/shared';
import { ItemStatusCardComponent } from './item-status-card.component';

/** One grid row: the agent DTO plus optional retry budget for that card. */
export interface ItemStatusGridRow {
  readonly agent: ResumableGenerationAgent;
  readonly attempt?: number | null;
  readonly budget?: number | null;
  readonly retrying?: boolean;
}

/**
 * Presentational grid of per-agent status cards. The parent chooses which
 * agents to list (including the terminal "retryable failures only" filter).
 */
@Component({
  selector: 'ptah-item-status-grid',
  standalone: true,
  imports: [ItemStatusCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3"
      role="list"
      aria-label="Agent status"
      data-testid="item-status-grid"
    >
      @for (item of items(); track item.agent.agentId) {
        <ptah-item-status-card
          role="listitem"
          [agent]="item.agent"
          [attempt]="item.attempt ?? null"
          [budget]="item.budget ?? null"
          [retrying]="item.retrying ?? false"
          (retry)="retry.emit($event)"
        />
      }
    </div>
  `,
})
export class ItemStatusGridComponent {
  readonly items = input.required<readonly ItemStatusGridRow[]>();
  readonly retry = output<string>();
}
