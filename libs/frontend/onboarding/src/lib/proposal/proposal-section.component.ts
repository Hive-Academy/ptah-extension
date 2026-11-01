import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProposalItemComponent } from './proposal-item.component';
import type { ChangeTag } from './proposal-flow.store';

export interface ProposalSectionItem {
  readonly key: string;
  readonly label: string;
  readonly value: unknown;
  readonly tag: ChangeTag | null;
  readonly createdSkills?: readonly string[];
}
@Component({
  selector: 'ptah-proposal-section',
  standalone: true,
  imports: [ProposalItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    class="space-y-3 rounded-[14px] border border-base-300 p-4"
    data-glass-surface="content"
    [attr.aria-label]="title()"
  >
    <h3 class="font-semibold">{{ title() }}</h3>
    <div class="grid gap-3 min-[720px]:grid-cols-2">
      @for (item of items(); track item.key) {
        <ptah-proposal-item
          [label]="item.label"
          [value]="item.value"
          [tag]="item.tag"
          [createdSkills]="item.createdSkills ?? []"
        />
      }
    </div>
  </section>`,
})
export class ProposalSectionComponent {
  readonly title = input.required<string>();
  readonly items = input.required<readonly ProposalSectionItem[]>();
}
