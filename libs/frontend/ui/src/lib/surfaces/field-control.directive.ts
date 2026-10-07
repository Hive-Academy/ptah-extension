import { Directive, ElementRef, inject } from '@angular/core';

/** Marks the projected native control that `ptah-field` wires to its hint/error. */
@Directive({
  selector:
    'input[ptahFieldControl], select[ptahFieldControl], textarea[ptahFieldControl]',
  standalone: true,
})
export class PtahFieldControlDirective {
  readonly element = inject(ElementRef<HTMLElement>);
  readonly originalDescription =
    this.element.nativeElement.getAttribute('aria-describedby');

  constructor() {
    const control = this.element.nativeElement;
    control.classList.add(`${control.tagName.toLowerCase()}-sm`);
  }
}
