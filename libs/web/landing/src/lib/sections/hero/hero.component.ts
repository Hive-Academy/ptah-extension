import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  inject,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import gsap from 'gsap';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import { LiveDemoSectionComponent } from '../live-demo/live-demo-section.component';

/**
 * HeroComponent — "Temple of the Machine" hero with the PtahCode live demo as
 * its centerpiece.
 *
 * Layers:
 * 1. Sky (first viewport, decorative): pyramid backdrop veiled at 0.16 and four
 *    masked Egyptian artifacts drifting on independent sine loops.
 * 2. Headline (`HeroContentOverlayComponent`), centred in the first viewport
 *    below the fixed nav, then the live demo (`LiveDemoSectionComponent`),
 *    which starts below the fold and powers on as it scrolls in.
 * 3. Stat row.
 */
@Component({
  selector: 'ptah-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeroContentOverlayComponent,
    LiveDemoSectionComponent,
    ViewportAnimationDirective,
  ],
  template: `
    <section class="relative overflow-hidden bg-ink-950">
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-[100svh] overflow-hidden"
        aria-hidden="true"
      >
        <!-- temple backdrop, veiled -->
        <div
          class="absolute inset-0 opacity-[0.16]"
          style="background-image: url('/assets/backgrounds/pyramid_energy_apex.webp'); background-size: cover; background-position: center 30%;"
        ></div>
        <div
          class="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-transparent to-ink-950"
        ></div>

        <!-- four artifacts, four depths -->
        <img
          data-float
          src="/assets/textures/ankh-sphere.png"
          alt=""
          class="absolute left-[8%] top-[20%] w-24 lg:w-36 opacity-70 [mask-image:radial-gradient(circle,black_52%,transparent_71%)] select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/scarab.png"
          alt=""
          class="absolute right-[10%] top-[14%] w-20 lg:w-28 opacity-50 blur-[1px] [mask-image:radial-gradient(circle,black_52%,transparent_71%)] select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/eye_of_horus.png"
          alt=""
          class="absolute right-[6%] bottom-[18%] w-28 lg:w-40 opacity-65 [mask-image:radial-gradient(circle,black_52%,transparent_71%)] select-none will-change-transform"
        />
        <img
          data-float
          src="/assets/textures/sun_disk_ra.png"
          alt=""
          class="absolute left-[10%] bottom-[12%] w-20 lg:w-32 opacity-40 blur-[2px] [mask-image:radial-gradient(circle,black_52%,transparent_71%)] select-none will-change-transform"
        />
      </div>

      <div class="relative z-10 flex flex-col">
        <div
          data-hero-headline
          class="flex min-h-[100svh] items-center justify-center pt-24 pb-12"
        >
          <ptah-hero-content-overlay />
        </div>
        <div class="relative z-20 w-full">
          <ptah-live-demo-section />
        </div>
      </div>

      <div
        viewportAnimation
        [viewportConfig]="statsConfig"
        class="relative z-10 mx-auto grid max-w-md grid-cols-2 gap-x-10 gap-y-8 px-4 pt-4 pb-20 sm:flex sm:max-w-3xl sm:flex-wrap sm:justify-center sm:pb-28"
      >
        @for (stat of stats; track stat.label) {
          <div class="flex flex-col items-center text-center sm:w-40">
            <span
              class="font-mono text-3xl sm:text-4xl font-bold text-white leading-none whitespace-nowrap"
              >{{ stat.value }}</span
            >
            <span class="text-xs sm:text-sm text-ink-400 mt-2 leading-snug">{{
              stat.label
            }}</span>
          </div>
        }
      </div>
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
  public readonly stats = [
    { value: '9', label: 'concurrent agent tiles' },
    { value: '7', label: 'model providers, zero lock-in' },
    { value: 'Free', label: 'and open source' },
    { value: '3', label: 'platforms: Windows, macOS, Linux' },
  ];

  /** Stat row — fade in. SSG-safe: the resting state is fully visible. */
  public readonly statsConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.1,
  };

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    afterNextRender(() => {
      if (!this.browser) return;
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
