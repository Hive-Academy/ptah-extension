import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type {
  CommandCaption,
  CommandCaptionExit,
} from '../model/command-center.store';

/** Longest caption text shown; longer sentences show their latest words. */
export const CAPTION_MAX_CHARS = 140;
/** Above this length the line likely wraps, so the strip drops its pill shape and adds a speaker eyebrow. */
const CAPTION_ONE_LINE_CHARS = 72;
const FADE_OUT_MS = 400;
const CUT_OUT_MS = 120;
/** Screen readers hear a finished sentence once it has been on screen this long. */
export const CAPTION_ANNOUNCE_DEBOUNCE_MS = 400;
/** Oldest queued announcements are dropped beyond this, so a long reply cannot back up. */
const CAPTION_ANNOUNCE_QUEUE_MAX = 6;
const ZERO_WIDTH_SPACE = '\u200B';

/** Keeps the tail of a long sentence, cut at a word boundary, behind an ellipsis. */
export function captionTail(text: string, max = CAPTION_MAX_CHARS): string {
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  const space = tail.indexOf(' ');
  const words =
    space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail;
  return `…${words}`;
}

/**
 * Stage caption: the sentence Ptah is speaking, or what the user said. The
 * strip itself is visual (`aria-hidden`); a separate polite status region
 * announces only finished agent sentences and the user's final transcript.
 */
@Component({
  selector: 'ptah-command-caption-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'caption-host' },
  styles: `
    :host {
      position: absolute;
      left: 50%;
      bottom: 20px;
      z-index: 10;
      width: min(720px, calc(100% - 40px));
      transform: translateX(-50%);
      pointer-events: none;
      display: flex;
      justify-content: center;
    }
    @container (max-width: 480px) {
      :host { bottom: 12px; width: calc(100% - 24px); }
    }
    .caption-strip {
      max-width: 100%;
      padding: 8px 16px;
      border-radius: var(--glass-radius-inner, 14px);
      opacity: 1;
      animation: caption-in 120ms ease-out;
      transition: opacity 400ms ease-out;
    }
    .caption-strip.single { border-radius: 9999px; }
    .caption-strip.leaving { opacity: 0; }
    .caption-strip.cut { transition-duration: 120ms; }
    .caption-line { min-height: 24px; animation: caption-in 160ms ease-out; }
    .caption-text {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }
    .caption-text.agent { font-size: 16px; line-height: 24px; font-weight: 500; }
    .caption-text.user, .caption-text.status { font-size: 14px; line-height: 20px; -webkit-line-clamp: 1; }
    .eyebrow { font-size: 10px; line-height: 14px; }
    :host-context([data-glass='on']) .caption-strip { border-color: transparent; }
    .caption-strip.reduced,
    .caption-strip.reduced .caption-line { animation: none; transition: none; }
    @media (prefers-reduced-motion: reduce) {
      .caption-strip, .caption-line { animation: none; transition: none; }
    }
    @keyframes caption-in { from { opacity: 0; } to { opacity: 1; } }
  `,
  template: `
    @if (shown(); as line) {
      <div
        class="caption-strip border border-base-300 bg-base-200 text-base-content"
        data-glass-surface="plate"
        data-testid="caption-strip"
        aria-hidden="true"
        [class.single]="!multiline()"
        [class.leaving]="leaving()"
        [class.cut]="exit() === 'cut'"
        [class.reduced]="reducedMotion()"
      >
        @for (item of [line]; track lineKey(item)) {
          <div class="caption-line">
            @if (multiline() && item.role !== 'status') {
              <p
                class="eyebrow font-semibold uppercase tracking-widest"
                [class.text-state-need]="item.role === 'agent'"
                [class.text-base-content-muted]="item.role === 'user'"
              >
                {{ item.role === 'agent' ? 'Ptah' : 'You' }}
              </p>
            }
            <p
              class="caption-text"
              [class.agent]="item.role === 'agent'"
              [class.user]="item.role === 'user'"
              [class.status]="item.role === 'status'"
              [class.text-base-content-muted]="item.role !== 'agent'"
            >
              {{ text() }}
            </p>
          </div>
        }
      </div>
    }
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="caption-announcer"
    >
      {{ announcement() }}
    </p>
  `,
})
export class CommandCaptionStripComponent {
  public readonly caption = input<CommandCaption | null>(null);
  public readonly exit = input<CommandCaptionExit>('fade');
  public readonly reducedMotion = input(false);

  protected readonly shown = signal<CommandCaption | null>(null);
  protected readonly leaving = signal(false);
  protected readonly announcement = signal('');
  protected readonly text = computed(() =>
    captionTail(this.shown()?.text ?? ''),
  );
  protected readonly multiline = computed(
    () => this.text().length > CAPTION_ONE_LINE_CHARS,
  );

  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the strip shows once the current exit finishes (a hint, or nothing). */
  private afterLeave: CommandCaption | null = null;
  private lastQueuedSeq: number | null = null;
  private readonly pendingAnnouncements: string[] = [];

  public constructor() {
    effect(() => {
      const caption = this.caption();
      untracked(() => this.present(caption));
    });
    effect(() => {
      const caption = this.caption();
      untracked(() => this.scheduleAnnouncement(caption));
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearLeaveTimer();
      if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    });
  }

  protected lineKey(line: CommandCaption): string {
    return `${line.role}:${line.seq}:${line.text}`;
  }

  /**
   * The page swaps a muted selection hint in as soon as a spoken line clears,
   * so a hint replacing a spoken or heard line is held back until that line's
   * fade or cut has played; only then does the hint appear.
   */
  private present(caption: CommandCaption | null): void {
    const current = this.shown();
    const spokenShowing = !!current && current.role !== 'status';
    if (
      caption &&
      (caption.role !== 'status' || !spokenShowing || this.reducedMotion())
    ) {
      this.clearLeaveTimer();
      this.afterLeave = null;
      this.leaving.set(false);
      this.shown.set(caption);
      return;
    }
    this.afterLeave = caption;
    if (this.leaveTimer !== null || !current) return;
    if (this.reducedMotion()) {
      this.shown.set(null);
      this.leaving.set(false);
      return;
    }
    this.leaving.set(true);
    this.leaveTimer = setTimeout(
      () => {
        this.leaveTimer = null;
        this.shown.set(this.afterLeave);
        this.afterLeave = null;
        this.leaving.set(false);
      },
      this.exit() === 'cut' ? CUT_OUT_MS : FADE_OUT_MS,
    );
  }

  /**
   * Status hints and repeats are never announced; partial words never reach the
   * store. Each finished line waits in order, so short consecutive sentences are
   * all announced instead of the later one cancelling the earlier.
   */
  private scheduleAnnouncement(caption: CommandCaption | null): void {
    if (!caption || caption.role === 'status') return;
    if (caption.seq === this.lastQueuedSeq) return;
    this.lastQueuedSeq = caption.seq;
    this.pendingAnnouncements.push(
      caption.role === 'user'
        ? `You said: ${caption.text}`
        : `Ptah: ${caption.text}`,
    );
    if (this.pendingAnnouncements.length > CAPTION_ANNOUNCE_QUEUE_MAX)
      this.pendingAnnouncements.shift();
    if (this.announceTimer === null) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.announceTimer = setTimeout(() => {
      this.announceTimer = null;
      const next = this.pendingAnnouncements.shift();
      if (next !== undefined) this.announce(next);
      if (this.pendingAnnouncements.length > 0) this.scheduleFlush();
    }, CAPTION_ANNOUNCE_DEBOUNCE_MS);
  }

  /**
   * An identical sentence would leave the region's text unchanged, so screen
   * readers would stay silent. A zero-width space toggles on repeats to force
   * a text change without anything audible.
   */
  private announce(text: string): void {
    this.announcement.set(
      this.announcement() === text ? `${text}${ZERO_WIDTH_SPACE}` : text,
    );
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer === null) return;
    clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }
}
