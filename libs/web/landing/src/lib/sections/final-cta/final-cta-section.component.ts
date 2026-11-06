import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { FlankBoltComponent } from '../shared/flank-bolt.component';

/** Reading order of the closing band, as fractions of its scroll progress; 1 is settled. */
export const CTA_REVEAL = {
  /** One threshold per headline sentence, top-down. */
  sentences: [0.08, 0.22, 0.36],
  line: 0.5,
  actions: 0.64,
} as const;

const MOTION = '(prefers-reduced-motion: no-preference)';

/**
 * Ties `onProgress` (0 to 1) to vertical scroll without a pin: the last band
 * scrubs in as it rises and stays settled at 1. Reduced motion settles at 1
 * and creates nothing; turning reduced motion on later reverts the trigger
 * and settles. Returns the release function.
 */
export function bindCtaScroll(
  section: HTMLElement,
  view: Window,
  onProgress: (progress: number) => void,
): () => void {
  if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) {
    onProgress(1);
    return () => undefined;
  }

  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  media.add(MOTION, () => {
    onProgress(0);
    const scrub = ScrollTrigger.create({
      trigger: section,
      start: 'top 85%',
      end: 'center 55%',
      scrub: 0.4,
      onUpdate: (self) => onProgress(self.progress),
    });
    return () => {
      scrub.kill();
      onProgress(1);
    };
  });
  return () => media.revert();
}

/** Splits the headline into its sentences, one per line. */
export function headlineSentences(headline: string): string[] {
  return headline
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Final CTA. Composition "closing slab": the headline's three sentences are
 * stacked large on the left, each line further in; a single bolt runs under
 * them toward the right, where the licence line and the two buttons sit low
 * and right. Scroll (no pin): the sentences, the line, then the buttons;
 * focus always shows the buttons. One canvas bolt, no clip.
 */
@Component({
  selector: 'ptah-final-cta-section',
  standalone: true,
  imports: [RouterLink, FlankBoltComponent],
  template: `
    <section id="cta" class="section-frame cta-frame" aria-labelledby="cta-title">
      <div class="frame-atmosphere cta-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="cta-slab" data-layout="closing-slab">
        <h2 id="cta-title" class="cta-title">
          @for (sentence of sentences(); track $index; let i = $index) {
            <span class="cta-sentence" [class.is-in]="progress() >= sentenceAt(i)" [style.--at]="i">{{
              sentence
            }}</span>
            {{ ' ' }}
          }
        </h2>

        <ptah-flank-bolt class="cta-bolt" axis="horizontal" [seed]="151" [strike]="strike()" />

        <div class="cta-close">
          <p class="cta-line" [class.is-in]="progress() >= reveal.line">{{ line() }}</p>
          <div class="cta-actions" [class.is-in]="progress() >= reveal.actions">
            <a class="cta-download" routerLink="/download">
              {{ downloadLabel() }}
              <span aria-hidden="true">↗</span>
            </a>
            <a class="cta-docs" href="https://docs.ptah.live" target="_blank" rel="noopener noreferrer">
              {{ docsLabel() }}
            </a>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrls: ['../shared/section-frame.css', './final-cta-section.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinalCtaSectionComponent {
  public readonly headline = input<string>('Free. No account. No license key.');
  public readonly line = input<string>('MIT license. No trial and no credit card.');
  public readonly downloadLabel = input<string>('Download PtahCode');
  public readonly docsLabel = input<string>('Read the docs');

  protected readonly reveal = CTA_REVEAL;

  /** Scroll progress; settled at 1 for SSR and reduced motion. */
  public readonly progress = signal(1);
  public readonly sentences = computed(() => headlineSentences(this.headline()));
  /** The bolt flashes once per sentence, then for the line and the buttons. */
  public readonly strike = computed(() => {
    const at = this.progress();
    const sentences = this.sentences().filter((_, i) => at >= this.sentenceAt(i)).length;
    return sentences + Number(at >= CTA_REVEAL.line) + Number(at >= CTA_REVEAL.actions);
  });

  public constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const document = inject(DOCUMENT);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    let release: (() => void) | undefined;
    afterNextRender(() => {
      const view = document.defaultView;
      const section = host.nativeElement.querySelector('section');
      if (view && section) release = bindCtaScroll(section, view, (value) => this.progress.set(value));
    });
    inject(DestroyRef).onDestroy(() => release?.());
  }

  /** Where sentence `i` comes in; any sentence past the third comes in with it. */
  protected sentenceAt(i: number): number {
    const at = CTA_REVEAL.sentences;
    return at[Math.min(i, at.length - 1)];
  }
}
