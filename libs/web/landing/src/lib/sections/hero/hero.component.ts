import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { HeroLightning } from './hero-lightning';
import { createHeroScroll } from './hero-scroll';

const CINEMATIC_QUERY =
  '(min-width: 768px) and (prefers-reduced-motion: no-preference)';

/** Arcs stop once the symbols have mostly faded (a fraction of the pinned layer fade, below 1). */
const SYMBOLS_GONE = 0.9;
/** The faded copy's CTAs leave the tab order (a fraction of the copy fade, below 1). */
const COPY_INERT = 0.95;

@Component({
  selector: 'ptah-hero',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="cinematic-hero" aria-labelledby="hero-title">
      <div class="story-stage" data-story-stage>
        <div class="title-frame" data-title-frame>
          <img
            class="title-still"
            src="/assets/live-demo/orchestration.jpg"
            alt=""
            aria-hidden="true"
            fetchpriority="high"
          />
          <div class="title-grain" aria-hidden="true"></div>
          <div class="artifacts" data-artifacts aria-hidden="true">
            <img data-float src="/assets/textures/ankh-sphere.webp" alt="" class="artifact artifact-ankh" />
            <img data-float src="/assets/textures/scarab.webp" alt="" class="artifact artifact-scarab" />
            <img data-float src="/assets/textures/eye_of_horus.webp" alt="" class="artifact artifact-eye" />
            <img data-float src="/assets/textures/sun_disk_ra.webp" alt="" class="artifact artifact-sun" />
            <canvas class="lightning-canvas" data-lightning aria-hidden="true"></canvas>
          </div>
          <div class="title-content" data-title-content>
            <p class="title-index">PTAHCODE / YOUR AI DEV TEAM</p>
            <h1 id="hero-title"><span data-title-beat>Free and open source.</span></h1>
            <p class="title-lead">
              PtahCode is a free, MIT-licensed desktop app that runs a team of AI agents on your own machine.
              Bring any model — open-weight or frontier — and keep your code and keys with you.
            </p>
            <div class="title-actions">
              <a class="download-link" routerLink="/download">
                Download PtahCode
                <span aria-hidden="true">↗</span>
              </a>
              <a class="watch-link" href="#command-center">
                <span aria-hidden="true">↘</span>
                Watch it work
              </a>
            </div>
          </div>
          <p class="scroll-cue title-footnote">
            <span class="cue-line" aria-hidden="true"></span><span>No account, no license key, no credit card</span><span class="cue-line" aria-hidden="true"></span>
          </p>
        </div>
      </div>
    </section>
  `,
  styleUrl: './hero.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private motionMedia?: MediaQueryList;
  private mediaContext?: ReturnType<typeof gsap.matchMedia>;
  private lightning?: HeroLightning;
  private stageVisible = false;
  private symbolsVisible = true;
  private reducedMotion = false;
  private saveData = false;

  public constructor() {
    if (!this.browser) return;
    afterNextRender(() => this.initialize());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const stage = this.host.nativeElement.querySelector<HTMLElement>('[data-story-stage]');
    if (!view || !stage || this.mediaContext) return;

    this.motionMedia = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionMedia?.matches ?? false;
    this.motionMedia?.addEventListener('change', this.onMotionChange);
    this.saveData = (view.navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true;

    if ('IntersectionObserver' in view) {
      this.observer = new IntersectionObserver(this.onIntersection);
      this.observer.observe(stage);
    }
    this.document.addEventListener('visibilitychange', this.syncLightning);

    if (this.saveData || this.reducedMotion) return;
    gsap.registerPlugin(ScrollTrigger);
    this.mediaContext = gsap.matchMedia();
    this.mediaContext.add(CINEMATIC_QUERY, () => this.animateCinematic(view, stage));
  }

  /** Desktop motion: intro reveal, floating artifacts, WebGL arcs and the scroll choreography (hero-scroll.ts). */
  private animateCinematic(view: Window, stage: HTMLElement): () => void {
    this.host.nativeElement.classList.add('is-cinematic');
    const symbols = Array.from(stage.querySelectorAll<HTMLElement>('[data-float]'));
    const artifacts = stage.querySelector<HTMLElement>('[data-artifacts]');
    const canvas = artifacts?.querySelector<HTMLCanvasElement>('[data-lightning]');
    if (artifacts && canvas) this.lightning = new HeroLightning(view, artifacts, canvas, symbols, stage);
    this.syncLightning();
    const beats = Array.from(stage.querySelectorAll<HTMLElement>('[data-title-beat]'));
    const supporting = Array.from(stage.querySelectorAll<HTMLElement>('.title-index, .title-lead, .title-actions, .title-footnote'));

    // Text is visible in SSR and in the CSS resting state. Browser motion starts only after render.
    const intro = gsap.timeline();
    intro.fromTo(beats, { opacity: 0, y: 24, filter: 'blur(8px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, stagger: 0.16, ease: 'power3.out' });
    intro.fromTo(supporting, { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'power2.out' }, 0.46);
    const floats = symbols.map((symbol, index) => gsap.to(symbol, {
      y: index % 2 === 0 ? -18 : 15,
      duration: 3.4 + index * 0.7,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: index * 0.3,
    }));

    const scroll = createHeroScroll(view, stage, {
      onLayers: (progress) => this.onLayersProgress(progress),
      onCopy: (progress) => this.onCopyProgress(progress),
    });

    return () => {
      this.lightning?.destroy();
      this.lightning = undefined;
      intro.kill();
      floats.forEach((float) => float.kill());
      scroll();
      this.host.nativeElement.classList.remove('is-cinematic', 'is-in-story');
      this.symbolsVisible = true;
      this.setTitleInert(false);
    };
  }

  private onLayersProgress(progress: number): void {
    this.symbolsVisible = progress < SYMBOLS_GONE;
    this.syncLightning();
  }

  private onCopyProgress(progress: number): void {
    const gone = progress >= COPY_INERT;
    this.host.nativeElement.classList.toggle('is-in-story', gone);
    // The faded copy is still held on screen; keep its CTAs out of the tab order (WCAG 2.4.7).
    this.setTitleInert(gone);
  }

  private setTitleInert(inert: boolean): void {
    this.host.nativeElement
      .querySelector<HTMLElement>('[data-title-content]')
      ?.toggleAttribute('inert', inert);
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.syncLightning();
  };

  private readonly onIntersection: IntersectionObserverCallback = (entries) => {
    for (const entry of entries) this.stageVisible = entry.isIntersecting;
    this.syncLightning();
  };

  private readonly syncLightning = (): void => {
    if (this.stageVisible && this.symbolsVisible && !this.document.hidden &&
      !this.reducedMotion && !this.saveData) this.lightning?.start();
    else this.lightning?.stop();
  };

  private cleanup(): void {
    this.mediaContext?.revert();
    this.mediaContext = undefined;
    this.lightning?.destroy();
    this.lightning = undefined;
    this.observer?.disconnect();
    this.motionMedia?.removeEventListener('change', this.onMotionChange);
    this.document.removeEventListener('visibilitychange', this.syncLightning);
  }
}
