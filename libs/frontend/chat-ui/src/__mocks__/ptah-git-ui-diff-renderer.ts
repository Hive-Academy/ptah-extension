import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'ptah-pierre-diff-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-pierre-diff" [attr.data-style]="diffStyle()">{{ patch() || newText() || oldText() }}</div>`,
})
export class PierreDiffHostComponent {
  readonly patch = input<string | null>(null);
  readonly oldText = input<string | null>(null);
  readonly newText = input<string | null>(null);
  readonly fileName = input('');
  readonly diffStyle = input<'split' | 'unified'>('split');
  readonly mappingError = computed(() => this.patch()?.includes('INVALID') ? new Error('Invalid patch') : null);
}
