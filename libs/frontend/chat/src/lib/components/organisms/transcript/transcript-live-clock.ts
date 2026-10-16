import {
  DestroyRef,
  NgZone,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

const TICK_MS = 1000;

/**
 * The transcript's ONE live clock (design-spec §3.2, §3.7): a single
 * one-second interval that runs only while `running()` is true (a live turn
 * on a visible transcript) and is released when it turns false and on
 * destroy. No timer per bubble. The interval runs outside the zone; the
 * signal write still refreshes the OnPush bubbles that read `now`.
 *
 * Construct in an injection context (a component field initializer).
 */
export class TranscriptLiveClock {
  private readonly ngZone = inject(NgZone);
  private readonly _now = signal(Date.now());
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** Unix ms, updated once per second while running. */
  readonly now = this._now.asReadonly();

  constructor(running: () => boolean) {
    effect(() => {
      const run = running();
      untracked(() => (run ? this.start() : this.stop()));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private start(): void {
    if (this.intervalId !== null) return;
    this._now.set(Date.now());
    this.intervalId = this.ngZone.runOutsideAngular(() =>
      setInterval(() => this._now.set(Date.now()), TICK_MS),
    );
  }

  private stop(): void {
    if (this.intervalId === null) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
