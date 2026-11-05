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
 * The clip plays only while fully in view and pauses at the first pixel row
 * that leaves. 0.98 (not 1) absorbs sub-pixel rounding at the viewport edge.
 */
export const FULL_VIEW_RATIO = 0.98;

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
    this.viewObserver = new view.IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.inView = entry.intersectionRatio >= FULL_VIEW_RATIO;
        this.sync();
      },
      { threshold: [0, FULL_VIEW_RATIO, 1] },
    );
    this.viewObserver.observe(element);
    this.document.addEventListener('visibilitychange', this.sync);
  }

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
