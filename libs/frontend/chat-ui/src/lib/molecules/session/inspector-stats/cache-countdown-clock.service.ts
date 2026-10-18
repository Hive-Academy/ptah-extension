import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** One clock for every visible cache tile. It rests when no tile needs it. */
@Injectable({ providedIn: 'root' })
export class CacheCountdownClockService {
  private readonly document = inject(DOCUMENT);
  private readonly tick = signal(Date.now());
  readonly now = this.tick.asReadonly();
  private subscribers = 0;
  private interval: ReturnType<typeof setInterval> | null = null;

  private readonly visibilityChanged = (): void => {
    if (this.document.hidden) {
      this.stop();
    } else {
      this.tick.set(Date.now());
      this.start();
    }
  };

  acquire(): () => void {
    if (++this.subscribers === 1) {
      this.tick.set(Date.now());
      this.document.addEventListener('visibilitychange', this.visibilityChanged);
      this.start();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.subscribers === 0) {
        this.stop();
        this.document.removeEventListener('visibilitychange', this.visibilityChanged);
      }
    };
  }

  private start(): void {
    if (this.subscribers > 0 && !this.document.hidden && this.interval === null) {
      this.interval = setInterval(() => this.tick.set(Date.now()), 1_000);
    }
  }

  private stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
