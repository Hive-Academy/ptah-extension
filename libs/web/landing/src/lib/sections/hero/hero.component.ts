import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LIVE_DEMO_CATALOG } from '../../live-demo/live-demo-catalog';

const CINEMATIC_QUERY =
  '(min-width: 768px) and (prefers-reduced-motion: no-preference)';

const CAPTIONS = [
  'Agents coordinate a shared plan.',
  'Models review the work together.',
  'Every session in one view.',
  'Parallel agents, one workspace.',
] as const;
const STORY_VIEWPORTS = 6.2;
const CHAPTER_STOPS = [1, 2.3, 3.6, 4.9].map((distance) => distance / STORY_VIEWPORTS);
const SNAP_STOPS = [0, ...CHAPTER_STOPS, 1];

@Component({
  selector: 'ptah-hero',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="cinematic-hero" aria-labelledby="hero-title">
      <div id="live-demo" class="story-stage" data-story-stage>
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
          <img data-float src="/assets/textures/ankh-sphere.png" alt="" class="artifact artifact-ankh" />
          <img data-float src="/assets/textures/scarab.png" alt="" class="artifact artifact-scarab" />
          <img data-float src="/assets/textures/eye_of_horus.png" alt="" class="artifact artifact-eye" />
          <img data-float src="/assets/textures/sun_disk_ra.png" alt="" class="artifact artifact-sun" />
        </div>
        <div class="title-content" data-title-content>
          <p class="title-index" aria-hidden="true">PTAHCODE / A FILM IN FOUR ACTS</p>
          <h1 id="hero-title"><span data-title-beat>Your AI dev team.</span><br /><span data-title-beat>Free and open source.</span></h1>
          <p class="title-lead">
            PtahCode is a free, MIT-licensed desktop app that runs a team of AI agents on your own machine.
            Bring any model — open-weight or frontier — and keep your code and keys with you.
          </p>
          <div class="title-actions">
            <a class="download-link" routerLink="/download">
              Download PtahCode
              <span aria-hidden="true">↗</span>
            </a>
            <a class="watch-link" href="#live-demo" (click)="watchStory($event)">
              <span aria-hidden="true">↘</span>
              Watch it work
            </a>
          </div>
          <p class="title-footnote">No account. No license key. No credit card.</p>
        </div>
        <div class="scroll-cue" aria-hidden="true">
          <span>Scroll to see the work</span><span class="cue-line"></span><span>↓</span>
        </div>
      </div>

        <div class="story-atmosphere" aria-hidden="true"></div>
        <div class="story-layout">
        <div class="story-window" data-story-window>
        <div class="scene-track" data-scene-track>
        @for (demo of catalog; track demo.id; let i = $index) {
          <figure class="story-scene" data-story-scene>
            <div class="scene-frame" data-scene-frame>
              <video
                class="scene-video"
                [src]="demo.video"
                [poster]="demo.poster"
                [attr.aria-label]="'PtahCode ' + demo.label + ' session clip'"
                controls
                [muted]="true"
                muted
                playsinline
                loop
                preload="none"
                (pause)="onVideoPause(i)"
                (play)="onVideoPlay(i)"
              >
                Your browser cannot play this PtahCode video.
              </video>
            </div>
            <figcaption class="scene-caption" data-scene-caption>
              <span class="caption-number">0{{ i + 1 }} / 04</span>
              <span class="caption-title">{{ demo.label }}</span>
              <span class="caption-line">{{ captions[i] }}</span>
            </figcaption>
          </figure>
        }
        </div>
        </div>
        <div class="chapter-rail" role="group" aria-label="Four chapters of PtahCode in action" [style.--rail-progress]="(activeChapter() + 1) / 4">
          <div class="rail-progress" aria-hidden="true"><span data-rail-fill></span></div>
          <ol>
            @for (demo of catalog; track demo.id; let i = $index) {
              <li><button type="button" class="chapter-button" [class.is-active]="activeChapter() === i"
                [attr.aria-current]="cinematic() && activeChapter() === i ? 'step' : null" (click)="goToChapter(i)">
                  <span class="rail-number">0{{ i + 1 }}</span><span>{{ demo.label }}</span>
              </button></li>
            }
          </ol>
        </div>
        </div>
      </div>
      <div class="story-outro" aria-hidden="true"><span>04 / 04</span><span>Built to ship.</span></div>
    </section>
  `,
  styleUrl: './hero.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroComponent {
  readonly catalog = LIVE_DEMO_CATALOG;
  readonly captions = CAPTIONS;
  readonly activeChapter = signal(-1);
  readonly cinematic = signal(false);
  readonly chapterStops = CHAPTER_STOPS;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly videos: HTMLVideoElement[] = [];
  private readonly visibleRatios = new Map<HTMLVideoElement, number>();
  private readonly manualPaused = new WeakSet<HTMLVideoElement>();
  private readonly pausingByCode = new WeakSet<HTMLVideoElement>();
  private observer?: IntersectionObserver;
  private motionMedia?: MediaQueryList;
  private mediaContext?: ReturnType<typeof gsap.matchMedia>;
  private storyTrigger?: ScrollTrigger;
  private lastSnapIndex = 0;
  private stageVisible = false;
  private reducedMotion = false;
  private saveData = false;

  constructor() {
    if (!this.browser) return;
    afterNextRender(() => this.initialize());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const stage = this.host.nativeElement.querySelector<HTMLElement>('[data-story-stage]');
    if (!view || !stage || this.videos.length) return;

    this.videos.push(...this.host.nativeElement.querySelectorAll<HTMLVideoElement>('video'));
    this.motionMedia = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionMedia?.matches ?? false;
    this.motionMedia?.addEventListener('change', this.onMotionChange);
    this.saveData = (view.navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true;

    if ('IntersectionObserver' in view) {
      this.observer = new IntersectionObserver(this.onIntersection, {
        threshold: [0, 0.15, 0.35, 0.65],
      });
      this.observer.observe(stage);
      for (const video of this.videos) this.observer.observe(video);
    }
    this.document.addEventListener('visibilitychange', this.syncPlayback);

    if (this.saveData || this.reducedMotion) return;
    gsap.registerPlugin(ScrollTrigger);
    this.mediaContext = gsap.matchMedia();
    this.mediaContext.add(CINEMATIC_QUERY, () => {
      this.host.nativeElement.classList.add('is-cinematic');
      this.cinematic.set(true);
      const title = stage.querySelector<HTMLElement>('[data-title-frame]');
      const track = stage.querySelector<HTMLElement>('[data-scene-track]');
      const window = stage.querySelector<HTMLElement>('[data-story-window]');
      const captions = Array.from(stage.querySelectorAll<HTMLElement>('[data-scene-caption]'));
      const symbols = Array.from(stage.querySelectorAll<HTMLElement>('[data-float]'));
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

      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: stage,
          start: 'top top',
          end: () => '+=' + Math.round(view.innerHeight * STORY_VIEWPORTS),
          pin: true,
          scrub: 1,
          snap: {
            snapTo: (progress: number) => {
              const nearest = SNAP_STOPS.reduce((best, stop, index) =>
                Math.abs(stop - progress) < Math.abs(SNAP_STOPS[best] - progress) ? index : best, 0);
              return SNAP_STOPS[Math.max(this.lastSnapIndex - 1, Math.min(this.lastSnapIndex + 1, nearest))];
            },
            inertia: false,
            delay: 0.25,
            duration: { min: 0.6, max: 1 },
            ease: 'power2.inOut',
          },
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => this.updateChapter(self.progress),
          onSnapComplete: (self) => {
            this.lastSnapIndex = SNAP_STOPS.reduce((best, stop, index) =>
              Math.abs(stop - self.progress) < Math.abs(SNAP_STOPS[best] - self.progress) ? index : best, 0);
          },
        },
      });
      if (title) timeline.to(title, { opacity: 0, yPercent: -8, duration: 0.9 }, 0);
      if (track) {
        timeline.fromTo(track, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.8);
        timeline.to(track, { x: () => -(window?.clientWidth ?? 0), duration: 0.45 }, 1.85);
        timeline.to(track, { x: () => -(window?.clientWidth ?? 0) * 2, duration: 0.45 }, 3.15);
        timeline.to(track, { x: () => -(window?.clientWidth ?? 0) * 3, duration: 0.45 }, 4.45);
      }
      captions.forEach((caption, index) => {
        timeline.fromTo(caption, { opacity: 0, y: 18 },
          { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' }, 0.75 + index * 1.3);
      });
      timeline.to({}, { duration: 1.08 }, 5.12);
      this.storyTrigger = timeline.scrollTrigger;

      return () => {
        intro.kill();
        floats.forEach((float) => float.kill());
        this.storyTrigger?.kill();
        this.storyTrigger = undefined;
        timeline.kill();
        this.host.nativeElement.classList.remove('is-cinematic');
        this.cinematic.set(false);
        this.activeChapter.set(-1);
        this.host.nativeElement.classList.remove('is-in-story');
        this.setTitleInert(false);
        this.lastSnapIndex = 0;
        this.syncPlayback();
      };
    });
  }

  watchStory(event: MouseEvent): void {
    event.preventDefault();
    if (!this.cinematic() || !this.storyTrigger) {
      // Natural (mobile / reduced-motion) layout: the stage anchor is the title card,
      // so go to the first clip instead.
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-story-scene]')
        ?.scrollIntoView({ behavior: this.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    this.goToChapter(0);
  }

  goToChapter(index: number): void {
    if (index < 0 || index >= CHAPTER_STOPS.length) return;
    if (!this.cinematic() || !this.storyTrigger) {
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-story-scene]')[index]
        ?.scrollIntoView({ behavior: this.reducedMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    this.lastSnapIndex = index + 1;
    this.document.defaultView?.scrollTo({
      top: this.storyTrigger.start + (this.storyTrigger.end - this.storyTrigger.start) * CHAPTER_STOPS[index],
      behavior: this.reducedMotion ? 'auto' : 'smooth',
    });
  }

  private updateChapter(progress: number): void {
    const settled = SNAP_STOPS.findIndex((stop, index) =>
      Math.abs(stop - progress) < 0.001 && Math.abs(index - this.lastSnapIndex) <= 1);
    if (settled >= 0) this.lastSnapIndex = settled;
    const chapter = progress < 0.95 / STORY_VIEWPORTS ? -1
      : progress < 1.65 / STORY_VIEWPORTS ? 0
      : progress < 2.95 / STORY_VIEWPORTS ? 1
      : progress < 4.25 / STORY_VIEWPORTS ? 2 : 3;
    this.host.nativeElement.classList.toggle('is-in-story', chapter >= 0);
    // The title fades out as the story starts; keep its CTAs out of the tab order
    // while they are invisible (WCAG 2.4.7).
    this.setTitleInert(chapter >= 0);
    if (chapter === this.activeChapter()) return;
    this.activeChapter.set(chapter);
    this.syncPlayback();
  }

  private setTitleInert(inert: boolean): void {
    this.host.nativeElement
      .querySelector<HTMLElement>('[data-title-content]')
      ?.toggleAttribute('inert', inert);
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.syncPlayback();
  };

  onVideoPause(index: number): void {
    const video = this.videos[index];
    if (!video) return;
    if (this.pausingByCode.delete(video)) return;
    this.manualPaused.add(video);
  }

  onVideoPlay(index: number): void {
    const video = this.videos[index];
    if (!video) return;
    if (this.cinematic() && index !== this.activeChapter()) {
      this.pauseVideo(video);
      return;
    }
    this.manualPaused.delete(video);
    for (const other of this.videos) if (other !== video) this.pauseVideo(other);
  }

  private readonly onIntersection: IntersectionObserverCallback = (entries) => {
    for (const entry of entries) {
      if (entry.target instanceof HTMLVideoElement) {
        this.visibleRatios.set(entry.target, entry.intersectionRatio);
      } else {
        this.stageVisible = entry.isIntersecting;
      }
    }
    this.syncPlayback();
  };

  private readonly syncPlayback = (): void => {
    const active = this.cinematic() && this.stageVisible && !this.document.hidden &&
      !this.reducedMotion && !this.saveData ? this.videos[this.activeChapter()] : undefined;
    for (const video of this.videos) {
      if (this.cinematic()) {
        if (video !== active) this.pauseVideo(video);
        else if (video.paused && !this.manualPaused.has(video)) {
          // A blocked autoplay leaves the poster and native controls available.
          void video.play().catch(() => this.manualPaused.add(video));
        }
      } else if (this.document.hidden || (this.visibleRatios.get(video) ?? 0) < 0.15) {
        this.pauseVideo(video);
      }
    }
  };

  private pauseVideo(video: HTMLVideoElement): void {
    if (video.paused) return;
    this.pausingByCode.add(video);
    video.pause();
  }

  private cleanup(): void {
    this.mediaContext?.revert();
    this.storyTrigger?.kill();
    this.observer?.disconnect();
    this.motionMedia?.removeEventListener('change', this.onMotionChange);
    this.document.removeEventListener('visibilitychange', this.syncPlayback);
    for (const video of this.videos) this.pauseVideo(video);
  }
}
