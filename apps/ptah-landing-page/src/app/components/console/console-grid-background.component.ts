import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * ConsoleGridBackgroundComponent — ambient dot-grid + optional soft amber glow.
 *
 * Design spec §3.5: pure CSS, no images, decorative (`aria-hidden`), sits behind
 * section content (`z-0`). Replaces every hieroglyph-parallax image and
 * `FloatingGlyphsComponent`. Identical at prerender and after hydration — no SSG
 * risk. Any GSAP parallax drift applied externally is optional polish only.
 */
@Component({
  selector: 'ptah-console-grid-background',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'absolute inset-0 z-0 pointer-events-none overflow-hidden',
  },
  template: `
    <div class="dot-grid absolute inset-0"></div>
    @if (glow()) {
      <div
        class="glow absolute rounded-full bg-amber-500/[0.06] blur-[120px]"
      ></div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dot-grid {
        background-image: radial-gradient(
          rgba(245, 165, 36, 0.05) 1px,
          transparent 1px
        );
        background-size: 28px 28px;
        -webkit-mask-image: radial-gradient(
          ellipse 60% 50% at 50% 40%,
          black 40%,
          transparent 80%
        );
        mask-image: radial-gradient(
          ellipse 60% 50% at 50% 40%,
          black 40%,
          transparent 80%
        );
      }
      .glow {
        width: 600px;
        height: 600px;
        left: 50%;
        top: 40%;
        transform: translate(-50%, -50%);
      }
    `,
  ],
})
export class ConsoleGridBackgroundComponent {
  /** Render the paired soft radial amber glow. */
  public readonly glow = input<boolean>(false);
}
