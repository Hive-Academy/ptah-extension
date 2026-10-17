import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { TurnDisclosureRowComponent } from '../turn/turn-disclosure-row.component';

/** Shared lane disclosure with a separate action place and projected details. */
@Component({
  selector: 'ptah-execution-header',
  standalone: true,
  imports: [TurnDisclosureRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-kind]': 'kind()' },
  template: `
    <div class="flex h-[30px] min-w-0 items-center">
      <ptah-turn-disclosure-row
        class="min-w-0 flex-1"
        [label]="label()"
        [live]="live()"
        [peek]="live() ? peek() : null"
        [toolCount]="toolCount()"
        [filesChanged]="filesChanged()"
        [extraMeta]="extraMeta()"
        [metaTone]="metaTone()"
        [controlsId]="controlsId()"
        [open]="open()"
        (toggled)="open.set($event)"
      />
      <ng-content select="[executionHeaderActions]" />
    </div>
    @if (open()) {
      <div [id]="controlsId()" role="region" [attr.aria-label]="label() + ' details'" class="text-[11px] text-base-content-muted">
        <ng-content />
      </div>
    }
  `,
})
export class ExecutionHeaderComponent {
  readonly kind = input.required<'cli' | 'subagent'>();
  readonly label = input.required<string>();
  readonly live = input(false);
  readonly peek = input<string | null>(null);
  readonly toolCount = input(0);
  readonly filesChanged = input(0);
  readonly extraMeta = input<readonly string[]>([]);
  readonly metaTone = input<'muted' | 'warning'>('muted');
  readonly controlsId = input.required<string>();
  readonly open = model(false);
}
