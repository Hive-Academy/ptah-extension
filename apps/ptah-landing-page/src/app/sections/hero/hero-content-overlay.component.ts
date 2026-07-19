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

/** The rotating tail of the headline. Article baked in so the line always
 *  reads "It ships <keyword>". Order: product, then the three pillars. */
const KEYWORDS = ['the SaaS.', 'the billing.', 'the auth.', 'the audit.'];

/**
 * HeroContentOverlayComponent — "Focal Distillation" headline.
 *
 * One statement — "It ships …" — whose final word carries the specifics and
 * rotates through {SaaS, billing, auth, audit}. Each swap is a BLUR MORPH: the
 * word dissolves out on a soft blur and resolves the next word back in — an
 * understated, premium crossfade rather than a mechanical decode.
 *
 * The keyword box is width/height-locked to the widest word, so the centered
 * line never reflows mid-swap.
 *
 * Reduced motion / no JS: the static DOM is already a valid final state —
 * "It ships the SaaS." The H1 carries the real phrase via aria-label so the
 * rotation is never announced.
 */
@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  template: `
    <div class="max-w-4xl mx-auto px-6 text-center py-24">
      <h1
        data-headline
        aria-label="It ships the SaaS."
        class="font-bold tracking-tight text-white leading-[1.05] text-4xl sm:text-5xl lg:text-6xl"
      >
        It ships<br />
        <span data-keyword class="text-amber-500">the SaaS.</span>
      </h1>

      <p
        data-reveal
        class="mt-8 text-lg sm:text-xl text-ink-300 max-w-xl mx-auto [text-wrap:balance]"
      >
        The AI dev team for SaaS you'll actually charge for — nine agents in
        parallel, any model.
      </p>

      <div data-reveal class="mt-10 flex flex-col items-center gap-3">
        <a
          routerLink="/download"
          class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg bg-amber-500 text-ink-950 font-semibold text-base transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
          aria-label="Download the Ptah desktop app"
        >
          <lucide-angular
            [img]="DownloadIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
          Download Ptah — it's free
        </a>
        <a
          href="#demo"
          class="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-white transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded"
          aria-label="Watch Ptah in action"
        >
          <lucide-angular [img]="PlayIcon" class="w-4 h-4" aria-hidden="true" />
          Watch it work
        </a>
      </div>

      <p class="mt-4 text-xs text-ink-500">
        Open source. No credit card, ever.
      </p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
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
        this.animateEntrance(el);
        this.morphKeyword(el);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  /** Headline lift + staggered reveal of subhead and CTAs. */
  private animateEntrance(el: HTMLElement): void {
    const headline = el.querySelector('[data-headline]');
    if (headline) {
      gsap.from(headline, {
        y: 22,
        opacity: 0,
        duration: 1.0,
        ease: 'power3.out',
      });
    }
    gsap.from(el.querySelectorAll('[data-reveal]'), {
      y: 24,
      opacity: 0,
      duration: 0.9,
      stagger: 0.14,
      ease: 'power3.out',
      delay: 0.4,
    });
  }

  /**
   * Width/height-lock the keyword to the widest word, then blur-morph from each
   * word to the next on an endless loop with a hold between swaps. matchMedia
   * scope reverts the timeline on destroy / motion-preference change.
   */
  private morphKeyword(el: HTMLElement): void {
    const kw = el.querySelector<HTMLElement>('[data-keyword]');
    if (!kw) return;

    const original = kw.textContent ?? KEYWORDS[0];
    // Lock the box to the widest word BEFORE animating so a swap never reflows
    // the line. Overflow stays visible — the blur halo should spill, not clip.
    kw.style.display = 'inline-block';
    kw.style.whiteSpace = 'nowrap';
    kw.style.textAlign = 'center';
    kw.style.verticalAlign = 'bottom';
    kw.style.willChange = 'transform, opacity, filter';
    let maxW = 0;
    let maxH = 0;
    KEYWORDS.forEach((word) => {
      kw.textContent = word;
      maxW = Math.max(maxW, kw.offsetWidth);
      maxH = Math.max(maxH, kw.offsetHeight);
    });
    kw.textContent = original;
    kw.style.width = `${Math.ceil(maxW * 1.04)}px`;
    kw.style.height = `${Math.ceil(maxH)}px`;
    gsap.set(kw, { filter: 'blur(0px)' });

    const tl = gsap.timeline({ repeat: -1, delay: 2.0 });
    KEYWORDS.forEach((_, i) => {
      const next = KEYWORDS[(i + 1) % KEYWORDS.length];
      tl.to(
        kw,
        {
          opacity: 0,
          filter: 'blur(9px)',
          y: -6,
          duration: 0.45,
          ease: 'power2.in',
        },
        '+=1.7',
      );
      tl.add(() => (kw.textContent = next));
      tl.set(kw, { y: 6 });
      tl.to(kw, {
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        duration: 0.55,
        ease: 'power3.out',
      });
    });
  }
}
