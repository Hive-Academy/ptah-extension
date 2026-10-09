import {
  ChangeDetectionStrategy,
  Component,
  contentChild,
  effect,
  input,
} from '@angular/core';
import { PtahFieldControlDirective } from './field-control.directive';

let fieldId = 0;
@Component({
  selector: 'ptah-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="flex flex-col">
    <label [attr.for]="controlId" class="mb-1 text-xs font-medium">{{
      label()
    }}</label
    ><ng-content
      select="input[ptahFieldControl], select[ptahFieldControl], textarea[ptahFieldControl]"
    />
    @if (hint() || error()) {
      <p
        [id]="descriptionId"
        class="mt-1.5 text-xs text-base-content-muted"
        [attr.data-error]="error() ? 'true' : null"
      >
        {{ error() || hint() }}
      </p>
    }
  </div>`,
})
export class PtahFieldComponent {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly control = contentChild(PtahFieldControlDirective);
  readonly controlId = `ptah-field-control-${++fieldId}`;
  readonly descriptionId = `ptah-field-description-${fieldId}`;
  constructor() {
    effect(() => {
      const marked = this.control();
      const control = marked?.element.nativeElement;
      if (!control || !marked) return;
      if (!control.id) control.id = this.controlId;
      const text = this.error() || this.hint();
      const ids = new Set(
        (marked.originalDescription ?? '').split(/\s+/).filter(Boolean),
      );
      if (text) ids.add(this.descriptionId);
      if (ids.size)
        control.setAttribute('aria-describedby', [...ids].join(' '));
      else control.removeAttribute('aria-describedby');
      if (this.error()) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    });
  }
}
