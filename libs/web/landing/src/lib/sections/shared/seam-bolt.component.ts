import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LightningComponent } from '../../shared/lightning/lightning.component';

/**
 * The page motif: one tall, thin lightning bolt across the seam between two
 * sections, from deep in the previous section's bottom padding down to just
 * above this section's eyebrow, so it never sits behind text. Periodic: it
 * strikes briefly every few seconds (its own `seed`, so seams never strike
 * together) and is dark in between; each new `strike` adds one brief flash.
 * `charge` (0 to 1) raises the strike brightness as the section reveals.
 * Place it as the first child of a section that lets content overflow upward
 * (overflow-y visible). Decorative.
 */
@Component({
  selector: 'ptah-seam-bolt',
  standalone: true,
  imports: [LightningComponent],
  host: { 'aria-hidden': 'true' },
  template: `
    <ptah-lightning
      class="seam-bolt"
      [hue]="40"
      [transparent]="true"
      [intensity]="0.5 + 0.35 * charge()"
      [size]="1.3"
      [speed]="speed()"
      [seed]="seed()"
      [strike]="strike()"
    />
  `,
  styles: [
    `
      :host {
        --seam-up: clamp(6rem, 10vw, 9.5rem);
        --seam-down: clamp(3.25rem, 6.5vw, 6.75rem);
        position: absolute;
        z-index: -1;
        top: calc(-1 * var(--seam-up));
        left: var(--seam-x, 50%);
        width: min(24rem, 80vw);
        height: calc(var(--seam-up) + var(--seam-down));
        transform: translateX(-50%);
        pointer-events: none;
      }

      .seam-bolt {
        position: absolute;
        inset: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeamBoltComponent {
  /** 0 to 1: strike brightness builds as the section reveals. */
  public readonly charge = input(1);
  /** Change it on every reveal step to fire one brief flash. */
  public readonly strike = input(0);
  public readonly speed = input(1);
  /** Strike schedule seed; give each seam its own. */
  public readonly seed = input(1);
}
