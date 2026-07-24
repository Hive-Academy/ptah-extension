import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComparisonTugMeterComponent } from './comparison-tug-meter.component';

/**
 * ComparisonSectionComponent - Wrapper for the Comparison Tug-of-War Meter
 *
 * Complexity Level: 1 (Simple wrapper)
 * Patterns: Composition, delegates to specialized component
 *
 * This component serves as the public-facing section component for the
 * comparison. It delegates all rendering to ComparisonTugMeterComponent, which
 * renders the per-axis demo→production "tug-of-war" meters.
 *
 * SOLID Principles:
 * - Single Responsibility: Wrapper that exposes comparison section to parent
 * - Composition: Delegates to ComparisonTugMeterComponent
 */
@Component({
  selector: 'ptah-comparison-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComparisonTugMeterComponent],
  template: ` <ptah-comparison-tug-meter /> `,
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
