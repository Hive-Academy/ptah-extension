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
    class="proposal-section min-w-0"
    [attr.aria-label]="title()"
  >
    <h3 class="sr-only">{{ title() }}</h3>
    <div class="proposal-fields grid min-w-0 gap-x-4">
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
  styles: [`
    .proposal-section { container-type: inline-size; }
    @container (min-width: 560px) {
      .proposal-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `],
})
export class ProposalSectionComponent {
  readonly title = input.required<string>();
  readonly items = input.required<readonly ProposalSectionItem[]>();
}
