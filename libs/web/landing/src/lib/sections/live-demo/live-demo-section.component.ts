import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LIVE_DEMO_CATALOG } from '../../live-demo/live-demo-catalog';

/**
 * Power-on scroll reveal runs on wide, motion-tolerant screens only. Narrow,
 * reduced-motion and prerendered views render the final, switched-on state.
 */
const POWER_ON_MEDIA =
  '(min-width: 1024px) and (prefers-reduced-motion: no-preference)';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';

@Component({
  selector: 'ptah-live-demo-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #section
      id="live-demo"
      aria-labelledby="ptah-live-demo-heading"
      class="relative block pb-12 text-ink-100 sm:pb-16"
    >
      <h2 id="ptah-live-demo-heading" class="sr-only">See PtahCode work</h2>

      <div
        class="mx-auto w-full max-w-[1680px] px-3 sm:px-4 lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-center lg:gap-6"
      >
        <div
          role="tablist"
          aria-label="PtahCode demo scenarios"
          [attr.aria-orientation]="tablistOrientation()"
          (keydown)="onTabKeydown($event)"
          class="flex gap-2 overflow-x-auto pb-3 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          @for (demo of catalog; track demo.id; let i = $index) {
            <button
              type="button"
              role="tab"
              [id]="'ptah-live-demo-tab-' + demo.id"
              aria-controls="ptah-live-demo-panel"
              [attr.aria-selected]="selectedIndex() === i"
              [attr.aria-label]="demo.label"
              [attr.aria-describedby]="
                selectedIndex() === i
                  ? 'ptah-live-demo-desc-' + demo.id
                  : null
              "
              [tabIndex]="selectedIndex() === i ? 0 : -1"
              (click)="selectTab(i)"
              [class]="tabClasses()[i]"
            >
              <span class="flex w-full items-baseline gap-3">
                <span
                  aria-hidden="true"
                  class="font-mono text-xs tabular-nums"
                  [class.text-amber-400]="selectedIndex() === i"
                  [class.text-ink-500]="selectedIndex() !== i"
                  >{{ i + 1 < 10 ? '0' : '' }}{{ i + 1 }}</span
                >
                <span data-tab-label class="text-sm font-semibold">{{
                  demo.label
                }}</span>
              </span>
              @if (selectedIndex() === i) {
                <span
                  [id]="'ptah-live-demo-desc-' + demo.id"
                  class="block pl-7 text-xs leading-relaxed text-ink-300"
                >
                  {{ demo.description }}
                </span>
                @if (progress() > 0) {
                  <span
                    aria-hidden="true"
                    class="ml-7 mt-1 block h-1 w-[calc(100%-1.75rem)] overflow-hidden rounded-full bg-ink-700"
                  >
                    <span
                      class="block h-full rounded-full bg-amber-400"
                      [style.width.%]="progress()"
                    ></span>
                  </span>
                }
              }
            </button>
          }
        </div>

        <div #frame class="relative lg:[perspective:2000px]">
          <div
            #glow
            aria-hidden="true"
            class="absolute inset-x-[8%] top-[12%] bottom-[-6%] rounded-[50%] bg-amber-500/25 blur-[90px]"
          ></div>
          <div
            #window
            id="ptah-live-demo-panel"
            role="tabpanel"
            tabindex="0"
            [attr.aria-labelledby]="
              'ptah-live-demo-tab-' + selected().id
            "
            class="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-device focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          >
            <div
              class="flex items-center gap-3 border-b border-ink-700 bg-ink-850 px-4 py-2.5"
            >
              <span aria-hidden="true" class="flex gap-1.5">
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
              </span>
              <span class="truncate text-xs font-medium text-ink-300"
                >PtahCode</span
              >
              <span class="ml-auto hidden text-xs text-ink-400 sm:inline"
                >Recorded session clip</span
              >
            </div>

            <div
              class="relative aspect-[8/5] overflow-hidden bg-ink-950 lg:aspect-auto lg:h-[clamp(560px,calc(100svh-10rem),940px)]"
            >
              <video
                #replayVideo
                class="h-full w-full object-contain"
                [src]="selected().video"
                [poster]="selected().poster"
                [muted]="true"
                playsinline
                controls
                preload="none"
                [attr.aria-label]="
                  'PtahCode ' + selected().label + ' session clip'
                "
                (timeupdate)="updateProgress()"
                (loadedmetadata)="updateProgress()"
                (ended)="updateProgress()"
              >
                Your browser cannot play this PtahCode video.
              </video>
              <!-- Power-on veil: invisible at rest, so static renders show the screen switched on. -->
              <div
                #powerScreen
                data-power-screen
                aria-hidden="true"
                class="pointer-events-none absolute inset-0 z-10 bg-ink-950 opacity-0"
              >
                <div
                  #powerLine
                  data-power-line
                  class="absolute inset-0 bg-gradient-to-b from-transparent via-amber-100 to-transparent opacity-0"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class LiveDemoSectionComponent {
  readonly catalog = LIVE_DEMO_CATALOG;
  readonly selectedIndex = signal(0);
  readonly selected = computed(() => this.catalog[this.selectedIndex()]);
  readonly progress = signal(0);

  /** Playlist items: amber left rule and tint on the selected scenario. */
  public readonly tabClasses = computed(() =>
    this.catalog.map(
      (_, i) =>
        'flex w-60 shrink-0 flex-col items-start gap-1 rounded-lg border border-l-2 px-3 py-2.5 text-left transition-colors lg:w-full ' +
        FOCUS_RING +
        ' ' +
        (i === this.selectedIndex()
          ? 'border-ink-700 border-l-amber-400 bg-amber-400/10 text-white'
          : 'border-ink-800 border-l-ink-700 bg-ink-900/60 text-ink-300 hover:border-ink-600 hover:text-white'),
    ),
  );

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly replayVideo =
    viewChild<ElementRef<HTMLVideoElement>>('replayVideo');
  private readonly frameEl = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly glowEl = viewChild<ElementRef<HTMLElement>>('glow');
  private readonly windowEl = viewChild<ElementRef<HTMLElement>>('window');
  private readonly powerScreenEl =
    viewChild<ElementRef<HTMLElement>>('powerScreen');
  private readonly powerLineEl =
    viewChild<ElementRef<HTMLElement>>('powerLine');
  private readonly browser = isPlatformBrowser(this.platformId);
  private readonly reducedMotion = signal(false);
  private saveData = false;
  private wideViewport = false;
  private mobileViewport = false;

  /** The playlist is a column on lg+ and a row below it. */
  readonly tablistOrientation = signal<'vertical' | 'horizontal'>('vertical');
  private sectionVisible = false;
  private pageSettled = false;
  private hasAutoStarted = false;

  constructor() {
    // Transform/opacity only, scrubbed, reverted on destroy. Video playback
    // uses the same reduced-motion preference but never starts on the server.
    effect((onCleanup) => {
      const frame = this.frameEl()?.nativeElement;
      const target = this.windowEl()?.nativeElement;
      const glow = this.glowEl()?.nativeElement;
      const screen = this.powerScreenEl()?.nativeElement;
      const line = this.powerLineEl()?.nativeElement;
      const view = this.document.defaultView;
      if (
        !this.browserReady() ||
        !frame ||
        !target ||
        !glow ||
        !screen ||
        !line ||
        !view ||
        typeof view.matchMedia !== 'function'
      ) {
        return;
      }
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add(POWER_ON_MEDIA, () => {
        gsap
          .timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
              trigger: frame,
              start: 'top 95%',
              end: 'top 20%',
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
          })
          .fromTo(
            target,
            { rotateX: 22, scale: 0.88, transformOrigin: '50% 100%' },
            { rotateX: 0, scale: 1, duration: 1 },
            0,
          )
          .fromTo(
            screen,
            { opacity: 1 },
            { opacity: 0, duration: 0.4, ease: 'power1.out' },
            0.5,
          )
          .fromTo(
            line,
            { opacity: 1, scaleX: 0.25, scaleY: 0.006 },
            { scaleX: 1, duration: 0.2, ease: 'power2.out' },
            0.1,
          )
          .to(line, { scaleY: 1, duration: 0.35, ease: 'power2.in' }, 0.3)
          .to(line, { opacity: 0, duration: 0.25 }, 0.6)
          .fromTo(
            glow,
            { opacity: 0 },
            { opacity: 1, duration: 0.5 },
            0.5,
          );
      });
      onCleanup(() => mm.revert());
    });

    afterNextRender(() => {
      if (!this.browser) return;
      const view = this.document.defaultView;
      if (!view) return;
      this.browserReady.set(true);
      const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion.set(reduced?.matches ?? false);
      this.saveData = Boolean(
        (
          view.navigator as Navigator & {
            connection?: { saveData?: boolean };
          }
        ).connection?.saveData,
      );
      const updateViewport = () => {
        this.mobileViewport = view.innerWidth < 768;
        this.wideViewport = view.innerWidth >= 1024;
        this.tablistOrientation.set(
          this.wideViewport ? 'vertical' : 'horizontal',
        );
        if (this.mobileViewport) this.pauseMedia();
        else this.autoStart();
      };
      updateViewport();
      const onVisibility = () => {
        if (this.document.visibilityState === 'hidden') this.pauseMedia();
      };
      const onReducedMotionChange = (event: MediaQueryListEvent) => {
        this.reducedMotion.set(event.matches);
        if (event.matches) this.pauseMedia();
      };
      view.addEventListener('resize', updateViewport);
      this.document.addEventListener('visibilitychange', onVisibility);
      reduced?.addEventListener?.('change', onReducedMotionChange);
      let observer: IntersectionObserver | undefined;
      if (typeof view.IntersectionObserver === 'function' && this.section()) {
        observer = new view.IntersectionObserver(
          (entries) => {
            this.sectionVisible = entries[0]?.isIntersecting ?? false;
            if (!this.sectionVisible) this.pauseMedia();
            else this.autoStart();
          },
          { threshold: 0.1 },
        );
        observer.observe(this.section()!.nativeElement);
      }

      // Wait for page load and an idle slot before automatic clip playback.
      let cancelSettle: (() => void) | undefined;
      const settle = () => {
        if (cancelSettle) return;
        const done = () => {
          this.pageSettled = true;
          this.autoStart();
        };
        if (typeof view.requestIdleCallback === 'function') {
          const handle = view.requestIdleCallback(done, { timeout: 2000 });
          cancelSettle = () => view.cancelIdleCallback(handle);
        } else {
          const handle = view.setTimeout(done, 200);
          cancelSettle = () => view.clearTimeout(handle);
        }
      };
      const loadFallback = view.setTimeout(settle, 8000);
      const onLoad = () => {
        view.clearTimeout(loadFallback);
        settle();
      };
      if (this.document.readyState === 'complete') onLoad();
      else view.addEventListener('load', onLoad, { once: true });
      this.destroyRef.onDestroy(() => {
        view.removeEventListener('load', onLoad);
        view.clearTimeout(loadFallback);
        cancelSettle?.();
        observer?.disconnect();
        view.removeEventListener('resize', updateViewport);
        this.document.removeEventListener('visibilitychange', onVisibility);
        reduced?.removeEventListener?.('change', onReducedMotionChange);
      });
    });
  }

  private readonly browserReady = signal(false);

  selectTab(index: number): void {
    if (
      index < 0 ||
      index >= this.catalog.length ||
      index === this.selectedIndex()
    ) {
      return;
    }
    this.pauseMedia();
    this.selectedIndex.set(index);
    this.progress.set(0);
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (this.selectedIndex() + 1) % this.catalog.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next =
          (this.selectedIndex() - 1 + this.catalog.length) %
          this.catalog.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.catalog.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectTab(next);
    if (this.browser) {
      const tablist = event.currentTarget as HTMLElement;
      tablist.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
    }
  }

  updateProgress(): void {
    const video = this.replayVideo()?.nativeElement;
    if (
      !video ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !Number.isFinite(video.currentTime)
    ) {
      this.progress.set(0);
      return;
    }
    this.progress.set(
      Math.round(Math.max(0, Math.min(100, (video.currentTime / video.duration) * 100))),
    );
  }

  private autoStart(): void {
    const video = this.replayVideo()?.nativeElement;
    if (
      this.hasAutoStarted ||
      !this.pageSettled ||
      !this.sectionVisible ||
      !this.wideViewport ||
      this.mobileViewport ||
      this.reducedMotion() ||
      this.saveData ||
      !video
    ) {
      return;
    }
    this.hasAutoStarted = true;
    const playback = video.play();
    if (playback) void playback.catch(() => undefined);
  }

  private pauseMedia(): void {
    this.replayVideo()?.nativeElement.pause();
  }
}
