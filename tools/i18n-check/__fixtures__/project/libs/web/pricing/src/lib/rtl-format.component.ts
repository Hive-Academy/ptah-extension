// i18n-check self-test fixture (data only, never compiled), F2b plants.
// Planted violations are marked PLANT; lines marked PASS must not be reported.
import { Component } from '@angular/core';

// Local declaration: the fixture imports no workspace project.
declare function intlLocale(): string;

// PASS: a type union is not a pipe (N3).
export type Moment = number | Date;

@Component({
  selector: 'fx-pricing-rtl-format',
  templateUrl: './rtl-format.component.html',
  styleUrl: './rtl-format.component.css',
  styles: `
    /* PLANT (rtl-physical): a physical margin in inline styles. */
    .badge {
      margin-left: 0;
    }
  `,
})
export class PricingRtlFormatComponent {
  protected readonly renewedAt: Moment = 0;
  protected readonly auditedAmount = 12;

  // PLANT (locale-format-call): browser-locale formatting.
  readonly renewedLabel = new Date(0).toLocaleDateString();

  // PASS: an Intl formatter built with intlLocale().
  readonly months = new Intl.DateTimeFormat(intlLocale(), { month: 'short' });

  // PLANT (intl-without-locale): a hard-coded locale.
  readonly relative = new Intl.RelativeTimeFormat('en');

  // PASS: the marker covers the next property.
  // i18n-format-exempt: reads the time zone, formats nothing
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // PLANT (rtl-physical): a data-driven physical position.
  readonly marker = { left: 38, top: 0 };

  // rtl-exempt: GSAP start offset, mirrored in code
  readonly tween = { paddingRight: 12 };

  // PLANT (detached-marker): a trailing marker attaches to nothing.
  readonly seam = 38; // rtl-exempt: fixed seam
}
