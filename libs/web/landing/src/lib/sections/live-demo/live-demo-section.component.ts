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
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LIVE_DEMO_CATALOG } from '../../live-demo/live-demo-catalog';
import type { ReplayState } from '../../live-demo/runtime/types';
import { LIVE_DEMO_LAYOUTS, type LiveDemoVariant } from './live-demo-variant';

/** Wide, motion-tolerant screens only; narrow and reduced-motion views stay flat. */
const TILT_MEDIA = '(min-width: 1024px) and (prefers-reduced-motion: no-preference)';

type ReplayCommand = 'play' | 'pause' | 'speed' | 'restart';

@Component({
  selector: 'ptah-live-demo-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #section id="live-demo" aria-labelledby="ptah-live-demo-heading"
      [class]="'relative block text-ink-100 ' + layout().section">
      @if (layout().band) {
        <div aria-hidden="true" [class]="layout().band"></div>
      }

      @if (layout().showHeading) {
        <div class="relative mx-auto max-w-[1200px] px-4 pb-8 pt-16 sm:px-6">
          <h2 id="ptah-live-demo-heading" class="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            See PtahCode work
          </h2>
          <p class="mt-3 max-w-2xl text-base leading-relaxed text-ink-300 sm:text-lg">
            Explore PtahCode sessions at your own pace. Choose a replay, then follow the work as it unfolds.
          </p>
        </div>
      } @else {
        <h2 id="ptah-live-demo-heading" class="sr-only">See PtahCode work</h2>
      }

      <div [class]="layout().frame">
        @if (layout().glow) {
          <div aria-hidden="true" [class]="layout().glow"></div>
        }
        <div #window id="ptah-live-demo-panel" role="tabpanel" tabindex="0"
          [attr.aria-labelledby]="'ptah-live-demo-tab-' + selected().id"
          [class]="'relative overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 ' + layout().window">
          <div class="flex items-center gap-3 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
            <span aria-hidden="true" class="flex gap-1.5">
              <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
            </span>
            <span class="truncate text-xs font-medium text-ink-300">PtahCode</span>
            <span class="ml-auto hidden text-xs text-ink-400 sm:inline">Recorded session replay</span>
          </div>

          <div [class]="'relative overflow-hidden bg-ink-950 ' + layout().viewport">
            @if (isMobile()) {
              <video #replayVideo class="h-full w-full object-contain" [src]="selected().video" [poster]="selected().poster" [muted]="true" playsinline controls preload="none"
                [attr.aria-label]="'PtahCode ' + selected().label + ' replay video'">
                Your browser cannot play this PtahCode video.
              </video>
            } @else if (active() && frameUrl()) {
              <iframe #replayFrame class="h-full w-full border-0" [src]="frameUrl()"
                title="PtahCode live demo replay" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>
            } @else {
              <img class="h-full w-full object-cover object-top" [src]="selected().poster"
                [alt]="'PtahCode ' + selected().label + ' demo preview'" width="1440" height="900" loading="lazy" />
              @if (browserReady()) {
                <div class="absolute inset-0 flex items-center justify-center bg-ink-950/40">
                  <button type="button" (click)="startDemo()"
                    class="rounded-full bg-amber-400 px-6 py-3 font-semibold text-ink-950 shadow-lg hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                    Play live demo
                  </button>
                </div>
              }
            }
          </div>

          @if (active() && !isMobile()) {
            <div class="flex flex-wrap items-center gap-3 border-t border-ink-700 bg-ink-850 px-4 py-3" aria-label="PtahCode replay controls">
              <button type="button" (click)="togglePlayback()" [attr.aria-label]="state()?.playing ? 'Pause PtahCode replay' : 'Play PtahCode replay'"
                class="rounded-md border border-ink-600 px-3 py-1.5 text-sm font-semibold text-ink-100 hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
                {{ state()?.playing ? 'Pause' : 'Play' }}
              </button>
              <button type="button" (click)="cycleSpeed()" [attr.aria-label]="'PtahCode replay speed ' + speed() + 'x. Change speed'"
                class="rounded-md border border-ink-600 px-3 py-1.5 text-sm font-semibold text-ink-100 hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
                {{ speed() }}× speed
              </button>
              <button type="button" (click)="restart()" aria-label="Restart PtahCode replay"
                class="rounded-md border border-ink-600 px-3 py-1.5 text-sm font-semibold text-ink-100 hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
                Restart
              </button>
              <div role="progressbar" aria-label="PtahCode replay progress" aria-valuemin="0" aria-valuemax="100"
                [attr.aria-valuenow]="progress()" [attr.aria-valuetext]="progress() + '% complete'"
                class="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-ink-700">
                <div class="h-full rounded-full bg-amber-400" [style.width.%]="progress()"></div>
              </div>
            </div>
          }
        </div>
      </div>

      <div role="tablist" aria-label="PtahCode demo scenarios" (keydown)="onTabKeydown($event)"
        [class]="'relative ' + layout().tablist">
        @for (demo of catalog; track demo.id; let i = $index) {
          <button type="button" role="tab" [id]="'ptah-live-demo-tab-' + demo.id"
            aria-controls="ptah-live-demo-panel" [attr.aria-selected]="selectedIndex() === i"
            [tabIndex]="selectedIndex() === i ? 0 : -1" (click)="selectTab(i)"
            [class]="tabClasses()[i]">
            @if (layout().chapterRails) {
              <span aria-hidden="true" class="block h-1 w-full overflow-hidden rounded-full bg-ink-700">
                <span class="block h-full rounded-full bg-amber-400" [style.width.%]="selectedIndex() === i ? chapterFill() : 0"></span>
              </span>
            }
            {{ demo.label }}
          </button>
        }
      </div>

      <div [class]="'relative ' + layout().caption">
        <p class="text-base font-semibold text-white">{{ selected().label }}</p>
        <p class="mt-1 text-sm leading-relaxed text-ink-300">{{ selected().description }}</p>
        @if (selected().id === 'orchestration' && !isMobile()) {
          <p class="mt-2 text-sm font-medium text-amber-300">Click Send in the demo to start</p>
        }
        <a href="/download" class="mt-4 inline-block rounded-lg border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
          Download PtahCode
        </a>
      </div>
    </section>
  `,
})
export class LiveDemoSectionComponent {
  /** Hero layout variation; see `live-demo-variant.ts`. */
  public readonly variant = input<LiveDemoVariant>('stage');
  public readonly layout = computed(() => LIVE_DEMO_LAYOUTS[this.variant()]);
  readonly catalog = LIVE_DEMO_CATALOG;
  readonly selectedIndex = signal(0);
  readonly selected = computed(() => this.catalog[this.selectedIndex()]);
  readonly active = signal(false);
  readonly isMobile = signal(false);
  readonly browserReady = signal(false);
  readonly state = signal<ReplayState | null>(null);
  readonly speed = signal(1);
  readonly progress = computed(() => {
    const state = this.state();
    if (!state || !Number.isFinite(state.duration) || state.duration <= 0 || !Number.isFinite(state.elapsed)) return 0;
    return Math.round(Math.max(0, Math.min(100, state.elapsed / state.duration * 100)));
  });
  /** Theater chapter rail of the selected tab: replay progress once known, else full. */
  public readonly chapterFill = computed(() => (this.active() && this.state() ? this.progress() : 100));
  public readonly tabClasses = computed(() => {
    const layout = this.layout();
    const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';
    return this.catalog.map((_, i) =>
      `${layout.tab} ${focus} ${i === this.selectedIndex() ? layout.tabActive : layout.tabIdle}`);
  });

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly replayFrame = viewChild<ElementRef<HTMLIFrameElement>>('replayFrame');
  private readonly replayVideo = viewChild<ElementRef<HTMLVideoElement>>('replayVideo');
  private readonly windowEl = viewChild<ElementRef<HTMLElement>>('window');
  private readonly browser = isPlatformBrowser(this.platformId);
  private readonly reducedMotion = signal(false);
  private saveData = false;
  private wideViewport = false;
  private sectionVisible = false;

  readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const id = this.selected().id;
    if (!/^[a-z0-9-]+$/.test(id)) return null;
    const url = `/demo/?scenario=${id}${this.reducedMotion() ? '&autoplay=0' : ''}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    // Stage variation: the window leans back and flattens over the first
    // 60% of a viewport of scroll. Transform-only, scrubbed, reverted when the
    // variation changes or the component is destroyed.
    effect((onCleanup) => {
      const tilt = this.layout().tilt;
      const target = this.windowEl()?.nativeElement;
      const view = this.document.defaultView;
      if (!tilt || !this.browserReady() || !target || !view || typeof view.matchMedia !== 'function') return;
      // Registered here, not at module scope: ScrollTrigger reads matchMedia on
      // registration, which server and test environments do not provide.
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add(TILT_MEDIA, () => {
        gsap.fromTo(
          target,
          { rotateX: 14, scale: 0.95, transformOrigin: '50% 100%' },
          {
            rotateX: 0,
            scale: 1,
            ease: 'none',
            scrollTrigger: { start: 0, end: () => view.innerHeight * 0.6, scrub: 0.6, invalidateOnRefresh: true },
          },
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
      this.saveData = Boolean((view.navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      const updateViewport = () => {
        this.isMobile.set(view.innerWidth < 768);
        this.wideViewport = view.innerWidth >= 1024;
        if (this.sectionVisible && this.wideViewport && !this.reducedMotion() && !this.saveData) this.startDemo();
      };
      updateViewport();
      const onVisibility = () => {
        if (this.document.visibilityState === 'hidden') this.pauseMedia();
      };
      const onMessage = (event: MessageEvent) => this.acceptStateMessage(event);
      view.addEventListener('resize', updateViewport);
      view.addEventListener('message', onMessage);
      this.document.addEventListener('visibilitychange', onVisibility);
      let observer: IntersectionObserver | undefined;
      if (typeof view.IntersectionObserver === 'function' && this.section()) {
        observer = new view.IntersectionObserver((entries) => {
          this.sectionVisible = entries[0]?.isIntersecting ?? false;
          if (!this.sectionVisible) this.pauseMedia();
          else if (this.wideViewport && !this.reducedMotion() && !this.saveData && !this.isMobile()) this.startDemo();
        }, { threshold: 0.1 });
        observer.observe(this.section()!.nativeElement);
      }
      this.destroyRef.onDestroy(() => {
        observer?.disconnect();
        view.removeEventListener('resize', updateViewport);
        view.removeEventListener('message', onMessage);
        this.document.removeEventListener('visibilitychange', onVisibility);
      });
    });
  }

  selectTab(index: number): void {
    if (index < 0 || index >= this.catalog.length || index === this.selectedIndex()) return;
    this.selectedIndex.set(index);
    this.state.set(null);
    this.speed.set(1);
  }

  onTabKeydown(event: KeyboardEvent): void {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (this.selectedIndex() + 1) % this.catalog.length; break;
      case 'ArrowLeft': next = (this.selectedIndex() - 1 + this.catalog.length) % this.catalog.length; break;
      case 'Home': next = 0; break;
      case 'End': next = this.catalog.length - 1; break;
      default: return;
    }
    event.preventDefault();
    this.selectTab(next);
    if (this.browser) {
      const tablist = event.currentTarget as HTMLElement;
      tablist.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
    }
  }

  startDemo(): void {
    if (this.browser && !this.isMobile() && this.frameUrl()) this.active.set(true);
  }

  togglePlayback(): void {
    this.sendControl(this.state()?.playing ? 'pause' : 'play');
  }

  cycleSpeed(): void {
    const next = this.speed() === 1 ? 2 : this.speed() === 2 ? 4 : 1;
    this.speed.set(next);
    this.sendControl('speed', next);
  }

  restart(): void {
    this.state.set(null);
    this.speed.set(1);
    this.sendControl('restart');
  }

  private sendControl(cmd: ReplayCommand, value?: number): void {
    if (!this.browser) return;
    const view = this.document.defaultView;
    const target = this.replayFrame()?.nativeElement.contentWindow;
    if (!view || !target) return;
    target.postMessage({ source: 'ptah-replay-control', cmd, ...(value === undefined ? {} : { value }) }, view.location.origin);
  }

  private pauseMedia(): void {
    if (!this.browser) return;
    this.replayVideo()?.nativeElement.pause();
    this.sendControl('pause');
  }

  private acceptStateMessage(event: MessageEvent): void {
    if (!this.browser) return;
    const view = this.document.defaultView;
    const frameWindow = this.replayFrame()?.nativeElement.contentWindow;
    if (!view || !frameWindow || event.origin !== view.location.origin || event.source !== frameWindow) return;
    const data = event.data as { source?: unknown; state?: ReplayState } | null;
    if (data?.source !== 'ptah-replay-state' || !data.state || data.state.scenario !== this.selected().id) return;
    this.state.set(data.state);
    // A pause sent while the iframe was still loading is lost, so re-send it.
    if (data.state.playing && (!this.sectionVisible || this.document.visibilityState === 'hidden')) this.sendControl('pause');
    if ([1, 2, 4].includes(data.state.speed)) this.speed.set(data.state.speed);
  }
}
