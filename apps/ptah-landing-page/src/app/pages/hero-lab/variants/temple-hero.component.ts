import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  inject,
  input,
  DestroyRef,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Download, CirclePlay } from 'lucide-angular';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(SplitText, ScrambleTextPlugin);

export type TempleDecryptFinish = 'cartouche' | 'seal' | 'engraving';

/** Slot-safe scramble glyphs — near-uniform width, ankh + geometry + binary. */
const GLYPHS = '☥ΔΛΞΦϟ01▮▚';

/**
 * TempleHeroComponent — "Temple of the Machine" hero with the chosen Decrypt
 * headline entrance (TASK_2026_153, round 3).
 *
 * Decrypt phase (shared): SplitText chars are width-locked in place
 * (inline-block, measured px width) so the scramble NEVER reflows the layout.
 * Each character cycles glyph noise in amber and resolves to its final color
 * in a slow left-to-right wave (~3s) — cinematic, not jittery.
 *
 * The `finish` input picks the post-decrypt Egyptian treatment:
 * - `cartouche` — the headline fill crossfades to the hieroglyph-circuit
 *   texture in gold: the decree, engraved. Texture drifts imperceptibly.
 * - `seal`      — the Eye of Horus fades in behind the headline like a seal
 *   pressed under the decree, drifting with the artifacts.
 * - `engraving` — a light band masked by the hieroglyph-circuit pattern
 *   sweeps the headline once (light through a stencil), then a breathing
 *   amber glow settles on "AI Employee,".
 *
 * Reduced motion / no JS: the static DOM already shows each finish's final
 * state — full headline, no scramble, nothing hidden behind animation.
 */
@Component({
  selector: 'ptah-temple-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  template: `
    <section
      class="relative overflow-hidden bg-ink-950 min-h-screen flex items-center justify-center"
      aria-label="Hero"
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

      <div class="relative z-10 max-w-4xl mx-auto px-6 text-center py-28">
        <p
          data-kicker
          class="font-mono text-xs sm:text-sm uppercase tracking-[0.22em] text-amber-500/90"
        >
          Persistent · Multi-Agent · Always On
        </p>

        <h1
          data-headline
          aria-label="Your AI Employee, Not Your Autocomplete."
          class="relative mt-6 font-extrabold tracking-tight text-white [text-wrap:balance] text-4xl sm:text-5xl lg:text-6xl xl:text-7xl leading-[1.06]"
        >
          <!-- seal: Eye of Horus pressed behind the decree -->
          @if (finish() === 'seal') {
            <img
              data-seal
              src="/assets/textures/eye_of_horus.png"
              alt=""
              aria-hidden="true"
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 sm:w-96 lg:w-[26rem] opacity-[0.22] [mask-image:radial-gradient(circle,black_45%,transparent_70%)] pointer-events-none select-none will-change-transform"
            />
          }

          <span aria-hidden="true" class="hl-stack relative overflow-hidden">
            <span data-plain class="block"
              >Your <span class="text-amber-500">AI Employee,</span> Not Your
              Autocomplete.</span
            >
            @if (finish() === 'cartouche') {
              <span data-texture class="hl-texture block"
                >Your AI Employee, Not Your Autocomplete.</span
              >
            }
            @if (finish() === 'engraving') {
              <span
                data-stencil
                class="hl-stencil absolute inset-y-0 -left-1/3 w-1/3 pointer-events-none opacity-0"
              ></span>
            }
          </span>
        </h1>

        <p
          data-reveal
          class="mt-6 text-lg sm:text-xl text-ink-300 max-w-xl mx-auto [text-wrap:balance]"
        >
          Bring any model. Ptah remembers, schedules, and orchestrates.
        </p>

        <div
          data-reveal
          class="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
        >
          <div class="flex flex-col items-center">
            <a
              routerLink="/download"
              class="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            >
              <lucide-angular [img]="DownloadIcon" class="w-4 h-4" aria-hidden="true" />
              Download Ptah
            </a>
            <span class="text-xs text-ink-500 mt-2">100 days free. No credit card.</span>
          </div>
          <a
            href="#demo"
            class="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg border border-ink-600 text-ink-100 font-medium transition-colors duration-200 hover:border-amber-500/40 hover:text-white hover:bg-ink-850/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          >
            <lucide-angular [img]="PlayIcon" class="w-4 h-4" aria-hidden="true" />
            Watch it work
          </a>
        </div>
      </div>
    </section>
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

      /* The decree, engraved: a bright flat-gold tint layered over the
         circuit-hieroglyph pattern, clipped to the glyphs — luminous gold
         letterforms with the engraving showing through at ~15%. */
      .hl-texture {
        background-image: linear-gradient(
            rgba(255, 205, 112, 0.86),
            rgba(255, 205, 112, 0.86)
          ),
          url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
        background-size: auto, 420px;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      /* Light through a hieroglyph stencil: an amber band whose alpha is
         shaped by the pattern, swept across the headline by GSAP. */
      .hl-stencil {
        background-color: rgba(245, 165, 36, 0.5);
        -webkit-mask-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
        mask-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
        -webkit-mask-size: 380px;
        mask-size: 380px;
        mix-blend-mode: screen;
      }
    `,
  ],
})
export class TempleHeroComponent {
  public readonly finish = input<TempleDecryptFinish>('cartouche');

  public readonly DownloadIcon = Download;
  public readonly PlayIcon = CirclePlay;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const el = this.host.nativeElement;
        this.animateStage(el);
        const decodeDone = this.decryptInPlace(el);
        this.scheduleFinish(el, decodeDone);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  /** Artifact fade + drift, kicker scramble, sub/CTA reveal. */
  private animateStage(el: HTMLElement): void {
    const orbs = el.querySelectorAll<HTMLElement>('[data-float]');
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

  /** Post-decrypt Egyptian treatment. */
  private scheduleFinish(el: HTMLElement, at: number): void {
    switch (this.finish()) {
      case 'cartouche': {
        const texture = el.querySelector('[data-texture]');
        if (!texture) return;
        gsap.set(texture, { autoAlpha: 0 });
        gsap.to(texture, {
          autoAlpha: 1,
          duration: 1.8,
          ease: 'power2.inOut',
          delay: at + 0.2,
        });
        gsap.to(texture, {
          backgroundPosition: '0px 0px, 460px 40px',
          duration: 60,
          ease: 'none',
          repeat: -1,
          delay: at + 0.2,
        });
        break;
      }
      case 'seal': {
        const seal = el.querySelector('[data-seal]');
        if (!seal) return;
        gsap.set(seal, { autoAlpha: 0, scale: 1.12 });
        gsap.to(seal, {
          autoAlpha: 0.25,
          scale: 1,
          duration: 2.0,
          ease: 'power2.out',
          delay: at + 0.15,
        });
        gsap.to(seal, {
          y: -12,
          duration: 5.2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: at + 2.2,
        });
        break;
      }
      case 'engraving': {
        const stencil = el.querySelector<HTMLElement>('[data-stencil]');
        const glow = el.querySelector('[data-plain] .text-amber-500');
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
        if (glow) {
          gsap.to(glow, {
            textShadow: '0 0 34px rgba(245,165,36,0.55)',
            duration: 2.8,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: at + 2.0,
          });
        }
        break;
      }
    }
  }
}
