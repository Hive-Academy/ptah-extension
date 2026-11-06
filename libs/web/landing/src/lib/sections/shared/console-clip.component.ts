import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

/**
 * The clip plays only while its box lies inside the viewport, measured in
 * pixels; this tolerance absorbs sub-pixel rounding at the viewport edge.
 */
export const EDGE_TOLERANCE_PX = 2;

/**
 * True when `rect` is fully inside the viewport vertically (within the tolerance) and
 * on screen horizontally. Horizontal containment is not required: some layouts let the
 * clip bleed off a page edge on purpose, and "fully in view" is a scroll (vertical) rule.
 */
export function insideViewport(rect: DOMRectReadOnly, width: number, height: number): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top >= -EDGE_TOLERANCE_PX &&
    rect.bottom <= height + EDGE_TOLERANCE_PX &&
    rect.left < width &&
    rect.right > 0
  );
}

/**
 * A live-demo clip in the hero's framed window. Lazy: no media bytes until it
 * plays (`preload="none"`) and no poster until it is near. Plays muted only
 * while fully on screen; reduced motion and save-data keep native controls.
 */
@Component({
  selector: 'ptah-console-clip',
  standalone: true,
  template: `
    <div class="clip-window">
      <video
        #clip
        class="clip-video"
        [attr.poster]="near() ? poster() : null"
        [attr.aria-label]="label()"
        [attr.controls]="autoplay() ? null : ''"
        preload="none"
        [muted]="true"
        muted
        playsinline
        loop
        (play)="playing.set(true)"
        (pause)="playing.set(false)"
      >
        <source [src]="video()" type="video/mp4" />
        <source [src]="videoWebm()" type="video/webm" />
      </video>
      <button
        type="button"
        class="clip-toggle"
        [hidden]="!autoplay()"
        [attr.aria-label]="playing() ? 'Pause clip' : 'Play clip'"
        (click)="toggle()"
      >
        <span aria-hidden="true">{{ playing() ? 'Ⅱ' : '▶' }}</span>
      </button>
    </div>
  `,
  styleUrl: './console-clip.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsoleClipComponent {
  public readonly video = input.required<string>();
  public readonly videoWebm = input.required<string>();
  public readonly poster = input.required<string>();
  public readonly label = input.required<string>();

  /** False on the server and for reduced motion or save-data. */
  public readonly autoplay = signal(false);
  /** True once the clip is within a screen of the viewport (or on the server). */
  public readonly near = signal(true);
  public readonly playing = signal(false);

  private readonly clip = viewChild.required<ElementRef<HTMLVideoElement>>('clip');
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private inView = false;
  private manualPause = false;
  private destroyed = false;
  private edgesWatched = false;
  /** Bumped by every play request and by destroy; a stale play is ignored. */
  private playTicket = 0;
  private nearObserver?: IntersectionObserver;
  private viewObserver?: IntersectionObserver;

  public constructor() {
    if (!this.browser) return;
    afterNextRender(() => this.initialize());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.playTicket++;
      this.nearObserver?.disconnect();
      this.viewObserver?.disconnect();
      const view = this.document.defaultView;
      if (view) this.watchEdges(view, false);
      this.document.removeEventListener('visibilitychange', this.sync);
      this.clip().nativeElement.pause();
    });
  }

  public toggle(): void {
    const video = this.clip().nativeElement;
    this.manualPause = !video.paused;
    if (this.manualPause) {
      this.playTicket++;
      video.pause();
    } else {
      this.play(video, true);
    }
  }

  private initialize(): void {
    const view = this.document.defaultView;
    if (!view || typeof view.IntersectionObserver !== 'function') return;
    const element = this.clip().nativeElement;

    this.near.set(false);
    this.nearObserver = new view.IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.near.set(true);
        this.nearObserver?.disconnect();
      },
      { rootMargin: '100% 0px' },
    );
    this.nearObserver.observe(element);

    const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const saveData =
      (view.navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData === true;
    if (reducedMotion || saveData) return;

    this.autoplay.set(true);
    // The observer says when the clip is on screen at all; while it is, a
    // passive scroll / resize check measures the box in pixels, so the first
    // real departure past the tolerance pauses it (an observer threshold alone
    // would fire only at the next ratio step, several pixels later).
    this.viewObserver = new view.IntersectionObserver(
      (entries) => {
        const onScreen = entries.some((entry) => entry.isIntersecting);
        this.watchEdges(view, onScreen);
        this.measure();
      },
      { threshold: [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1] },
    );
    this.viewObserver.observe(element);
    this.document.addEventListener('visibilitychange', this.sync);
  }

  /** Attaches the pixel check only while the clip is on screen. */
  private watchEdges(view: Window, on: boolean): void {
    if (on === this.edgesWatched) return;
    this.edgesWatched = on;
    if (on) {
      view.addEventListener('scroll', this.measure, { passive: true });
      view.addEventListener('resize', this.measure, { passive: true });
    } else {
      view.removeEventListener('scroll', this.measure);
      view.removeEventListener('resize', this.measure);
    }
  }

  private readonly measure = (): void => {
    const view = this.document.defaultView;
    if (!view || this.destroyed) return;
    const box = this.clip().nativeElement.getBoundingClientRect();
    const inside = this.edgesWatched && insideViewport(box, view.innerWidth, view.innerHeight);
    if (inside === this.inView) return;
    this.inView = inside;
    this.sync();
  };

  /** Autoplay is allowed only while fully in view, in a visible tab, not paused by hand. */
  private autoplayAllowed(): boolean {
    return !this.destroyed && this.inView && !this.document.hidden && !this.manualPause;
  }

  private readonly sync = (): void => {
    const video = this.clip().nativeElement;
    const shouldPlay = this.autoplayAllowed();
    if (shouldPlay && video.paused) {
      this.play(video, false);
    } else if (!shouldPlay && !video.paused) {
      this.playTicket++;
      video.pause();
    }
  };

  /**
   * `manual` plays from the toggle, which may run while partly in view. When
   * the play promise settles, eligibility is checked again: a destroyed host,
   * a hidden tab, or (for autoplay) a clip that left the view pauses it. A
   * request superseded by a newer play or pause leaves the decision to it.
   */
  private play(video: HTMLVideoElement, manual: boolean): void {
    const ticket = ++this.playTicket;
    const pending = video.play() as Promise<void> | undefined;
    pending?.then(
      () => {
        if (this.destroyed) return video.pause();
        if (ticket !== this.playTicket) return;
        if (this.document.hidden || (!manual && !this.autoplayAllowed())) video.pause();
      },
      (error: unknown) => {
        // AbortError: a pause landed while play() was pending; keep autoplay.
        // Any other rejection means the browser blocked it; show controls.
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          this.autoplay.set(false);
        }
      },
    );
  }
}
