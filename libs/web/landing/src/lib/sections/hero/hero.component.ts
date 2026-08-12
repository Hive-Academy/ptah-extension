import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  inject,
  DestroyRef,
} from '@angular/core';
import gsap from 'gsap';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import { HeroDeviceShowcaseComponent } from './hero-device-showcase.component';

/**
 * HeroComponent — "Temple of the Machine" hero (TASK_2026_153, final round).
 *
 * Layers:
 * 1. Temple stage (min-h-screen): pyramid backdrop veiled at 0.16, four masked
 *    Egyptian artifacts drifting on independent sine loops, and the centered
 *    decrypt headline block (`HeroContentOverlayComponent`).
 * 2. Device showcase + stat row below the fold.
 *
 * Artifacts are scoped to the stage container so their percentage positions
 * stay inside the first viewport, not the full section.
 */
@Component({
  selector: 'ptah-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroContentOverlayComponent, HeroDeviceShowcaseComponent],
  template: `
    <section class="relative overflow-hidden bg-ink-950">
      <div
        class="relative min-h-screen flex items-center justify-center overflow-hidden"
      >
        <!-- temple backdrop, veiled -->
        <div
          class="absolute inset-0 opacity-[0.16]"
          style="background-image: url('/assets/backgrounds/pyramid_energy_apex.png'); background-size: cover; background-position: center 30%;"
          aria-hidden="true"
        ></div>
        <div
          class="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-transparent to-ink-950"
          aria-hidden="true"
        ></div>

        <!-- four artifacts, four depths -->
        <img
          data-float
          src="/assets/textures/ankh-sphere.png"
          alt=""
          aria-hidden="true"
          class="absolute left-[8%] top-[20%] w-24 lg:w-36 opacity-70 [mask-image:radial-gradient(circle,black_52%,transparent_71%)] pointer-events-none select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/scarab.png"
          alt=""
          aria-hidden="true"
          class="absolute right-[10%] top-[14%] w-20 lg:w-28 opacity-50 blur-[1px] [mask-image:radial-gradient(circle,black_52%,transparent_71%)] pointer-events-none select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/eye_of_horus.png"
          alt=""
          aria-hidden="true"
          class="absolute right-[6%] bottom-[18%] w-28 lg:w-40 opacity-65 [mask-image:radial-gradient(circle,black_52%,transparent_71%)] pointer-events-none select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/sun_disk_ra.png"
          alt=""
          aria-hidden="true"
          class="absolute left-[10%] bottom-[12%] w-20 lg:w-32 opacity-40 blur-[2px] [mask-image:radial-gradient(circle,black_52%,transparent_71%)] pointer-events-none select-none will-change-transform"
        />

        <ptah-hero-content-overlay class="relative z-10" />
      </div>

      <ptah-hero-device-showcase />
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class HeroComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const orbs =
          this.host.nativeElement.querySelectorAll<HTMLElement>('[data-float]');
        gsap.from(orbs, {
          opacity: 0,
          scale: 0.92,
          duration: 1.4,
          stagger: 0.15,
          ease: 'power2.out',
        });
        orbs.forEach((orb, i) => {
          gsap.to(orb, {
            y: i % 2 === 0 ? -18 : 15,
            duration: 3.4 + i * 0.7,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: 0.3 * i,
          });
        });
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }
}
