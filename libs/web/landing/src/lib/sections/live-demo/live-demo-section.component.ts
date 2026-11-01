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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LIVE_DEMO_CATALOG } from '../../live-demo/live-demo-catalog';
import type { ReplayState } from '../../live-demo/runtime/types';
/**
 * Power-on scroll reveal runs on wide, motion-tolerant screens only. Narrow,
 * reduced-motion and prerendered views render the final, switched-on state.
 */
const POWER_ON_MEDIA = '(min-width: 1024px) and (prefers-reduced-motion: no-preference)';

type ReplayCommand = 'play' | 'pause' | 'speed' | 'restart';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300';

@Component({
  selector: 'ptah-live-demo-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #section id="live-demo" aria-labelledby="ptah-live-demo-heading" class="relative block pb-12 text-ink-100 sm:pb-16">
      <h2 id="ptah-live-demo-heading" class="sr-only">See PtahCode work</h2>

      <div class="mx-auto w-full max-w-[1680px] px-3 sm:px-4 lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-center lg:gap-6">
        <div role="tablist" aria-label="PtahCode demo scenarios" [attr.aria-orientation]="tablistOrientation()" (keydown)="onTabKeydown($event)"
          class="flex gap-2 overflow-x-auto pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
          @for (demo of catalog; track demo.id; let i = $index) {
            <button type="button" role="tab" [id]="'ptah-live-demo-tab-' + demo.id"
              aria-controls="ptah-live-demo-panel" [attr.aria-selected]="selectedIndex() === i"
              [attr.aria-label]="demo.label"
              [attr.aria-describedby]="selectedIndex() === i ? 'ptah-live-demo-desc-' + demo.id : null"
              [tabIndex]="selectedIndex() === i ? 0 : -1" (click)="selectTab(i)"
              [class]="tabClasses()[i]">
              <span class="flex w-full items-baseline gap-3">
                <span aria-hidden="true" class="font-mono text-xs tabular-nums"
                  [class.text-amber-400]="selectedIndex() === i" [class.text-ink-500]="selectedIndex() !== i">{{ i + 1 < 10 ? '0' : '' }}{{ i + 1 }}</span>
                <span data-tab-label class="text-sm font-semibold">{{ demo.label }}</span>
              </span>
              @if (selectedIndex() === i) {
                <span [id]="'ptah-live-demo-desc-' + demo.id" class="block pl-7 text-xs leading-relaxed text-ink-300">
                  {{ demo.description }}
                  @if (demo.id === 'orchestration' && !isMobile()) {
                    <span class="mt-1.5 block font-medium text-amber-300">Click Send in the demo to start</span>
                  }
                </span>
                @if (active() && !isMobile()) {
                  <span aria-hidden="true" class="ml-7 mt-1 block h-1 w-[calc(100%-1.75rem)] overflow-hidden rounded-full bg-ink-700">
                    <span class="block h-full rounded-full bg-amber-400" [style.width.%]="progress()"></span>
                  </span>
                }
              }
            </button>
          }
        </div>

        <div #frame class="relative lg:[perspective:2000px]">
          <div #glow aria-hidden="true" class="absolute inset-x-[8%] top-[12%] bottom-[-6%] rounded-[50%] bg-amber-500/25 blur-[90px]"></div>
          <div #window id="ptah-live-demo-panel" role="tabpanel" tabindex="0"
            [attr.aria-labelledby]="'ptah-live-demo-tab-' + selected().id"
            class="relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-device focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
            <div class="flex items-center gap-3 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
              <span aria-hidden="true" class="flex gap-1.5">
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-ink-600"></span>
              </span>
              <span class="truncate text-xs font-medium text-ink-300">PtahCode</span>
              <span class="ml-auto hidden text-xs text-ink-400 sm:inline">Recorded session replay</span>
            </div>

            <div class="relative aspect-[8/5] overflow-hidden bg-ink-950 lg:aspect-auto lg:h-[clamp(560px,calc(100svh-10rem),940px)]">
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
              <!-- Power-on veil: invisible at rest, so static renders show the screen switched on. -->
              <div #powerScreen data-power-screen aria-hidden="true" class="pointer-events-none absolute inset-0 z-10 bg-ink-950 opacity-0">
                <div #powerLine data-power-line
                  class="absolute inset-0 bg-gradient-to-b from-transparent via-amber-100 to-transparent opacity-0"></div>
              </div>
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
      </div>
    </section>
  `,
})
export class LiveDemoSectionComponent {
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
  /** Playlist items: amber left rule and tint on the selected scenario. */
  public readonly tabClasses = computed(() =>
    this.catalog.map((_, i) =>
      'flex w-60 shrink-0 flex-col items-start gap-1 rounded-lg border border-l-2 px-3 py-2.5 text-left transition-colors lg:w-full ' +
      FOCUS_RING + ' ' +
      (i === this.selectedIndex()
        ? 'border-ink-700 border-l-amber-400 bg-amber-400/10 text-white'
        : 'border-ink-800 border-l-ink-700 bg-ink-900/60 text-ink-300 hover:border-ink-600 hover:text-white')));

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly replayFrame = viewChild<ElementRef<HTMLIFrameElement>>('replayFrame');
  private readonly replayVideo = viewChild<ElementRef<HTMLVideoElement>>('replayVideo');
  private readonly frameEl = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly glowEl = viewChild<ElementRef<HTMLElement>>('glow');
  private readonly windowEl = viewChild<ElementRef<HTMLElement>>('window');
  private readonly powerScreenEl = viewChild<ElementRef<HTMLElement>>('powerScreen');
  private readonly powerLineEl = viewChild<ElementRef<HTMLElement>>('powerLine');
  private readonly browser = isPlatformBrowser(this.platformId);
  private readonly reducedMotion = signal(false);
  private saveData = false;
  private wideViewport = false;
  /** The playlist is a column on lg+ and a row below it. */
  readonly tablistOrientation = signal<'vertical' | 'horizontal'>('vertical');
  private sectionVisible = false;
  /** True once the page has loaded and the browser is idle, so the demo never competes with the hero. */
  private pageSettled = false;

  readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const id = this.selected().id;
    if (!/^[a-z0-9-]+$/.test(id)) return null;
    const url = `/demo/?scenario=${id}${this.reducedMotion() ? '&autoplay=0' : ''}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    // Power-on reveal: as the window scrolls in it leans back, dark, with a thin
    // CRT line across the screen; the line opens to full height and fades, the
    // screen brightens, the window flattens and the amber glow rises beneath it.
    // Transform/opacity only, scrubbed, reverted on destroy. The demo autostart
    // logic below is independent of it.
    effect((onCleanup) => {
      const frame = this.frameEl()?.nativeElement;
      const target = this.windowEl()?.nativeElement;
      const glow = this.glowEl()?.nativeElement;
      const screen = this.powerScreenEl()?.nativeElement;
      const line = this.powerLineEl()?.nativeElement;
      const view = this.document.defaultView;
      if (!this.browserReady() || !frame || !target || !glow || !screen || !line || !view || typeof view.matchMedia !== 'function') return;
      // Registered here, not at module scope: ScrollTrigger reads matchMedia on
      // registration, which server and test environments do not provide.
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add(POWER_ON_MEDIA, () => {
        gsap
          .timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: frame, start: 'top 95%', end: 'top 20%', scrub: 0.6, invalidateOnRefresh: true },
          })
          .fromTo(target, { rotateX: 22, scale: 0.88, transformOrigin: '50% 100%' }, { rotateX: 0, scale: 1, duration: 1 }, 0)
          .fromTo(screen, { opacity: 1 }, { opacity: 0, duration: 0.4, ease: 'power1.out' }, 0.5)
          .fromTo(line, { opacity: 1, scaleX: 0.25, scaleY: 0.006 }, { scaleX: 1, duration: 0.2, ease: 'power2.out' }, 0.1)
          .to(line, { scaleY: 1, duration: 0.35, ease: 'power2.in' }, 0.3)
          .to(line, { opacity: 0, duration: 0.25 }, 0.6)
          .fromTo(glow, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.5);
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
        this.tablistOrientation.set(this.wideViewport ? 'vertical' : 'horizontal');
        this.autoStart();
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
          else this.autoStart();
        }, { threshold: 0.1 });
        observer.observe(this.section()!.nativeElement);
      }
      // Autostart waits for the window load event plus an idle slot, so the
      // demo bundle never competes with the hero's first paint.
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
      // If `load` never fires (a stalled third-party request), settle anyway after 8 s.
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
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = (this.selectedIndex() + 1) % this.catalog.length; break;
      case 'ArrowLeft':
      case 'ArrowUp': next = (this.selectedIndex() - 1 + this.catalog.length) % this.catalog.length; break;
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

  private autoStart(): void {
    if (this.pageSettled && this.sectionVisible && this.wideViewport && !this.reducedMotion() && !this.saveData && !this.isMobile()) this.startDemo();
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
