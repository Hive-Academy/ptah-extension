import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  inject,
  DestroyRef,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, CirclePlay, Download } from 'lucide-angular';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(SplitText, ScrambleTextPlugin);

/** Slot-safe scramble glyphs — near-uniform width, ankh + geometry + binary. */
const GLYPHS = '☥ΔΛΞΦϟ01▮▚';

/**
 * HeroContentOverlayComponent — decrypt headline block (TASK_2026_153 winner:
 * Temple × Decrypt × Engraving).
 *
 * Decrypt: SplitText chars are width-locked in place (inline-block, measured
 * px width) so the scramble NEVER reflows the layout. Each character cycles
 * glyph noise in amber and resolves to its final color in a slow
 * left-to-right wave (~3s).
 *
 * Engraving finish: once the headline has resolved, an amber band masked by
 * the hieroglyph-circuit pattern sweeps across it once (light through a
 * stencil), then a breathing amber glow settles on "It Ships."
 *
 * Reduced motion / no JS: the static DOM is already the final state — full
 * headline, stencil at opacity 0, nothing hidden behind animation. The H1
 * carries the real text via aria-label; animated spans are aria-hidden.
 */
@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  template: `
    <div class="max-w-4xl mx-auto px-6 text-center py-28">
      <p
        data-kicker
        class="font-mono text-xs sm:text-sm uppercase tracking-[0.22em] text-amber-500/90"
      >
        Multi-Tenant · Billing-Ready · Security-Reviewed
      </p>

      <h1
        data-headline
        aria-label="It Knows Your Architecture. It Ships the SaaS."
        class="relative mt-6 font-extrabold tracking-tight text-white [text-wrap:balance] text-4xl sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.06]"
      >
        <span aria-hidden="true" class="hl-stack relative overflow-hidden">
          <span data-plain class="block"
            >It Knows Your Architecture.
            <span data-glow class="text-amber-500"
              >It Ships the SaaS.</span
            ></span
          >
          <span
            data-stencil
            class="hl-stencil absolute inset-y-0 -left-1/3 w-1/3 pointer-events-none opacity-0"
          ></span>
        </span>
      </h1>

      <p
        data-reveal
        class="mt-6 text-lg sm:text-xl text-ink-300 max-w-2xl mx-auto [text-wrap:balance]"
      >
        Ptah is the AI dev team for SaaS you'll actually charge for —
        multi-tenant data isolation, billing integration, cross-vendor security
        review, and architecture that stays consistent past the first feature.
        Up to nine agents shipping in parallel. Bring any model.
      </p>

      <div
        data-reveal
        class="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
      >
        <div class="flex flex-col items-center w-full sm:w-auto">
          <a
            routerLink="/download"
            class="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm sm:text-base transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            aria-label="Download the Ptah desktop app"
          >
            <lucide-angular
              [img]="DownloadIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Download Ptah
          </a>
          <span class="text-xs text-ink-500 mt-2 text-center"
            >Free. Open source. No credit card, ever.</span
          >
        </div>

        <a
          href="#demo"
          class="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 rounded-lg border border-ink-600 text-ink-100 font-medium text-sm sm:text-base transition-colors duration-200 hover:border-amber-500/40 hover:text-white hover:bg-ink-850 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Watch Ptah in action"
        >
          <lucide-angular [img]="PlayIcon" class="w-4 h-4" aria-hidden="true" />
          Watch it work
        </a>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .hl-stack {
        display: grid;
      }
      .hl-stack > * {
        grid-area: 1 / 1;
      }

      /* Light through a hieroglyph stencil: an amber band shaped by the
         pattern, swept across the headline by GSAP. The pattern PNG is
         opaque (24bpp, no alpha), so the mask MUST read luminance — with the
         default alpha mode the band renders as a solid block. */
      .hl-stencil {
        background-color: rgba(245, 165, 36, 0.5);
        mask-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
        mask-size: 380px;
        mask-mode: luminance;
        mix-blend-mode: screen;
      }
    `,
  ],
})
export class HeroContentOverlayComponent {
  public readonly DownloadIcon = Download;
  public readonly PlayIcon = CirclePlay;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const el = this.host.nativeElement;
        this.animateChrome(el);
        const decodeDone = this.decryptInPlace(el);
        this.engrave(el, decodeDone);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  /** Kicker scramble + sub/CTA reveal. */
  private animateChrome(el: HTMLElement): void {
    const kicker = el.querySelector<HTMLElement>('[data-kicker]');
    if (kicker) {
      gsap.to(kicker, {
        duration: 1.6,
        scrambleText: {
          text: kicker.textContent ?? '',
          chars: 'upperCase',
          speed: 0.25,
        },
        ease: 'none',
      });
    }

    gsap.from(el.querySelectorAll('[data-reveal]'), {
      y: 26,
      opacity: 0,
      duration: 0.9,
      stagger: 0.14,
      ease: 'power3.out',
      delay: 1.3,
    });
  }

  /**
   * In-place decrypt: every char is width-locked before scrambling, so the
   * wave of glyph noise resolves with ZERO layout shift. Returns the time
   * (seconds) at which the last character has settled.
   */
  private decryptInPlace(el: HTMLElement): number {
    const plain = el.querySelector<HTMLElement>('[data-plain]');
    if (!plain) return 0;
    const split = new SplitText(plain, { type: 'chars,words' });
    const chars = split.chars as HTMLElement[];
    const BASE_DELAY = 0.2;
    const WAVE = 0.05;
    let last = 0;

    chars.forEach((char) => {
      char.style.width = `${char.offsetWidth}px`;
      char.style.display = 'inline-block';
      char.style.textAlign = 'center';
    });

    chars.forEach((char, i) => {
      const finalColor = getComputedStyle(char).color;
      const finalText = char.textContent ?? '';
      const delay = BASE_DELAY + i * WAVE;
      const duration = gsap.utils.random(1.2, 1.9);
      char.style.color = 'rgba(245, 165, 36, 0.55)';
      gsap.to(char, {
        duration,
        delay,
        scrambleText: { text: finalText, chars: GLYPHS, speed: 0.28 },
        ease: 'none',
      });
      gsap.to(char, {
        color: finalColor,
        duration: 0.6,
        delay: delay + duration - 0.45,
        ease: 'power1.inOut',
      });
      last = Math.max(last, delay + duration + 0.2);
    });

    gsap.delayedCall(last + 1.6, () => split.revert());
    return last;
  }

  /** Engraving finish: stencil light-sweep, then breathing glow on "It Ships." */
  private engrave(el: HTMLElement, at: number): void {
    const stencil = el.querySelector<HTMLElement>('[data-stencil]');
    if (stencil) {
      gsap.fromTo(
        stencil,
        { xPercent: 0, autoAlpha: 1 },
        {
          xPercent: 500,
          duration: 2.0,
          ease: 'power2.inOut',
          delay: at + 0.2,
          onComplete: function (this: gsap.core.Tween) {
            gsap.set(this.targets(), { autoAlpha: 0 });
          },
        },
      );
    }
    // Re-query at fire time: split.revert() (at `last + 1.6`) replaces the
    // headline's children, so a reference captured now would be detached.
    gsap.delayedCall(at + 2.0, () => {
      const glow = el.querySelector('[data-glow]');
      if (glow) {
        gsap.to(glow, {
          textShadow: '0 0 34px rgba(245,165,36,0.55)',
          duration: 2.8,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      }
    });
  }
}
