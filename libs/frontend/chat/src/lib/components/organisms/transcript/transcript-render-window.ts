import { Injectable, signal } from '@angular/core';

/**
 * Vertical `rootMargin` (px) applied to the transcript's intersection observer.
 * Messages within this distance of the scroll viewport, above or below, are
 * mounted. Wide enough that a fast flick never reaches an unmounted region
 * before the browser has delivered the callback.
 */
export const RENDER_WINDOW_MARGIN_PX = 2000;

/**
 * How many trailing messages are mounted unconditionally, on top of whatever
 * the observer reports. The tail is counted in messages; the streaming
 * message(s) are exempt by id, not by position, so a long turn can never be
 * torn down mid-stream even if it outgrows the tail.
 */
export const ALWAYS_MOUNTED_TAIL = 6;

/**
 * Placeholder height for a message that has never been measured. Matches
 * `contain-intrinsic-size: auto 120px` in `chat-transcript.component.css`, so
 * the scrollbar estimate for never-visited content is unchanged by windowing.
 */
export const PLACEHOLDER_FALLBACK_PX = 120;

/**
 * TranscriptRenderWindow — decides which message ids are mounted, and remembers
 * each one's last measured height. Nothing else.
 *
 * Provided in `ChatTranscriptComponent.providers` (NOT `providedIn: 'root'`) so
 * each transcript owns its own window, mirroring the component-scoped
 * `TranscriptRetentionService` one level up. It reads no other service: the
 * component hands it the current id list, the finalized boundary and the active
 * flag, which keeps this a pure policy object.
 *
 * Degradation is deliberate: when `IntersectionObserver` is unavailable (jsdom,
 * SSR) `supported` is false and `isMounted()` returns true for every id. A
 * memory optimization must never be able to blank the transcript.
 */
@Injectable()
export class TranscriptRenderWindow {
  /**
   * False when the platform has no `IntersectionObserver`. Everything mounts —
   * the pre-windowing behaviour.
   */
  readonly supported: boolean;

  private observer: IntersectionObserver | null = null;

  /** Registered slot element → message id. Written by the slot directive. */
  private readonly elements = new Map<HTMLElement, string>();

  /** Last MEASURED slot height per message id, in CSS px. */
  private readonly heights = new Map<string, number>();

  /**
   * Bumped whenever `heights` changes. `placeholderHeight()` reads it so the
   * template re-evaluates without copying the map on every callback.
   */
  private readonly heightVersion = signal(0);

  /** Ids the observer currently reports inside the window. */
  private readonly intersecting = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /** Trailing + streaming ids, never unmounted. */
  private readonly tail = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Mirrors `ChatTranscriptComponent.active()`. Under `display:none` every
   * element reports non-intersecting; processing that would unmount a hidden
   * tab's entire window and defeat the keep-alive the retention service exists
   * for. Callbacks are ignored while false, matching the frozen-`vm` discipline.
   */
  private isActive = false;

  constructor() {
    this.supported = typeof IntersectionObserver !== 'undefined';
  }

  /**
   * Create the observer rooted on the transcript's scroll container. Called
   * once from the component's `afterNextRender`, by which time slots may
   * already have registered — those are observed here.
   */
  attach(root: HTMLElement | null): void {
    if (!this.supported || !root || this.observer) return;
    this.observer = new IntersectionObserver(
      (entries) => this.handleEntries(entries),
      { root, rootMargin: `${RENDER_WINDOW_MARGIN_PX}px 0px` },
    );
    for (const element of this.elements.keys()) {
      this.observer.observe(element);
    }
  }

  /** Register (or re-key) a slot element. Idempotent for an unchanged id. */
  register(messageId: string, element: HTMLElement): void {
    if (this.elements.get(element) === messageId) return;
    this.observer?.unobserve(element);
    this.elements.set(element, messageId);
    this.observer?.observe(element);
  }

  /** Detach a slot element on directive destroy. */
  unregister(element: HTMLElement): void {
    this.observer?.unobserve(element);
    this.elements.delete(element);
  }

  /**
   * Feed the window the current message ids and the finalized boundary. Ids at
   * or past `finalizedCount` are the tab's streaming messages and join the
   * always-mounted tail. Height records for ids no longer in the list are
   * evicted so the map cannot outlive the transcript's content.
   */
  syncMessages(messageIds: readonly string[], finalizedCount: number): void {
    const nextTail = new Set<string>();
    for (
      let i = Math.max(0, messageIds.length - ALWAYS_MOUNTED_TAIL);
      i < messageIds.length;
      i++
    ) {
      nextTail.add(messageIds[i]);
    }
    for (let i = Math.max(0, finalizedCount); i < messageIds.length; i++) {
      nextTail.add(messageIds[i]);
    }
    if (!sameSet(nextTail, this.tail())) {
      this.tail.set(nextTail);
    }
    this.evictAbsent(new Set(messageIds));
  }

  /** Freeze (false) or resume (true) observer processing. */
  setActive(active: boolean): void {
    this.isActive = active;
  }

  /** Whether `messageId`'s bubble should be mounted. Signal read. */
  isMounted(messageId: string): boolean {
    if (!this.supported) return true;
    if (this.tail().has(messageId)) return true;
    return this.intersecting().has(messageId);
  }

  /**
   * Height (px) an unmounted slot must reserve. The last measured height, or
   * `PLACEHOLDER_FALLBACK_PX` for a message never rendered. Never below 1 — a
   * run of zero-height slots would let the observer's margin skip a whole block
   * of messages. Signal read.
   */
  placeholderHeight(messageId: string): number {
    this.heightVersion();
    return Math.max(this.heights.get(messageId) ?? PLACEHOLDER_FALLBACK_PX, 1);
  }

  /**
   * O(entries), not O(messages). A height is recorded only for a slot that was
   * ALREADY mounted when the entry was captured — notably on the leaving edge,
   * where `boundingClientRect` still describes the mounted bubble. Recording on
   * the entering edge would memorize the placeholder's own height instead.
   */
  private handleEntries(entries: readonly IntersectionObserverEntry[]): void {
    if (!this.isActive) return;

    const current = this.intersecting();
    const tail = this.tail();
    let next: Set<string> | null = null;
    let heightsChanged = false;

    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const messageId = this.elements.get(element);
      if (messageId === undefined) continue;

      const wasMounted = tail.has(messageId) || current.has(messageId);
      const height = entry.boundingClientRect.height;
      if (wasMounted && height > 0 && this.heights.get(messageId) !== height) {
        this.heights.set(messageId, height);
        heightsChanged = true;
      }

      if (entry.isIntersecting) {
        if (!current.has(messageId)) {
          next ??= new Set(current);
          next.add(messageId);
        }
      } else if (current.has(messageId)) {
        next ??= new Set(current);
        next.delete(messageId);
      }
    }

    if (heightsChanged) this.heightVersion.update((v) => v + 1);
    if (next) this.intersecting.set(next);
  }

  private evictAbsent(present: ReadonlySet<string>): void {
    let heightsChanged = false;
    for (const id of this.heights.keys()) {
      if (!present.has(id)) {
        this.heights.delete(id);
        heightsChanged = true;
      }
    }
    if (heightsChanged) this.heightVersion.update((v) => v + 1);

    const current = this.intersecting();
    let next: Set<string> | null = null;
    for (const id of current) {
      if (!present.has(id)) {
        next ??= new Set(current);
        next.delete(id);
      }
    }
    if (next) this.intersecting.set(next);
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
