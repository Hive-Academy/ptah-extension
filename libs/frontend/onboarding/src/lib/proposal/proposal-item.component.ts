import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { ChangeTag } from './proposal-flow.store';

@Component({
  selector: 'ptah-proposal-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="rounded-[10px] border border-base-300 p-3"
    data-glass-surface="tile"
    [class.border-primary]="tag()"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h4 class="font-medium">{{ label() }}</h4>
      @if (tag()) {
        <span
          class="badge badge-outline badge-sm border-primary text-base-content"
          >{{ tag() === 'new' ? 'New' : 'Changed' }}</span
        >
      }
    </div>
    @if (createdSkills().length) {
      <ul class="mt-2 space-y-1">
        @for (skill of createdSkills(); track skill) {
          <li class="text-sm">
            {{ skill }}
            <span class="badge badge-outline badge-sm">Created skill</span>
          </li>
        }
      </ul>
    }
    <pre
      class="mt-2 whitespace-pre-wrap break-words text-sm text-base-content-muted"
      >{{ display() }}</pre>
  </div>`,
})
export class ProposalItemComponent {
  readonly label = input.required<string>();
  readonly value = input.required<unknown>();
  readonly tag = input<ChangeTag | null>(null);
  readonly createdSkills = input<readonly string[]>([]);
  readonly display = computed(() =>
    typeof this.value() === 'string'
      ? (this.value() as string)
      : (JSON.stringify(this.value(), null, 2) ?? '—'),
  );
}
