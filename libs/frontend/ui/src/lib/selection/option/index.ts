/**
 * Option Component - Barrel Export
 *
 * Exports the OptionComponent and re-exports Highlightable interface
 * from @angular/cdk/a11y for consumer convenience.
 */
export * from './option.component';

// Re-export Highlightable for consumer convenience
export type { Highlightable } from '@angular/cdk/a11y';
