import { Directive, ElementRef, inject } from '@angular/core';

/**
 * AutocompleteDirective - Attaches to Input Element
 *
 * Marks input element for autocomplete overlay positioning.
 * Provides ElementRef reference for AutocompleteComponent integration.
 *
 * Pattern: Netanel Basal directive-based autocomplete
 *
 * @example
 * <input type="text" autocompleteInput placeholder="Type to search..." />
 */
@Directive({
  selector: '[autocompleteInput]',
  standalone: true,
})
export class AutocompleteDirective {
  readonly elementRef = inject(ElementRef<HTMLInputElement>);
}
