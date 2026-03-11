import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComparisonSplitScrollComponent } from './comparison-split-scroll.component';

/**
 * ComparisonSectionComponent - Wrapper for Comparison Split Scroll
 *
 * Complexity Level: 1 (Simple wrapper)
 * Patterns: Composition, delegates to specialized component
 *
 * This component serves as the public-facing section component for the comparison.
 * It delegates all rendering to ComparisonSplitScrollComponent which implements
 * the ParallaxSplitScrollComponent pattern.
 *
 * SOLID Principles:
 * - Single Responsibility: Wrapper that exposes comparison section to parent
 * - Composition: Delegates to ComparisonSplitScrollComponent
 */
@Component({
  selector: 'ptah-comparison-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComparisonSplitScrollComponent],
  template: ` <ptah-comparison-split-scroll /> `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
    `,
  ],
})
export class ComparisonSectionComponent {}
