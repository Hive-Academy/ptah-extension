import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  NgZone,
  Signal,
  WritableSignal,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

export type WallClockCadence = 'second' | 'coarse';
export const WALL_CLOCK_COARSE_MS = 30_000;

const CADENCES: readonly WallClockCadence[] = ['second', 'coarse'];
const INTERVAL_MS: Record<WallClockCadence, number> = {
  second: 1_000,
  coarse: WALL_CLOCK_COARSE_MS,
};

@Injectable({ providedIn: 'root' })
export class WallClockService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly ticks: Record<WallClockCadence, WritableSignal<number>> = {
    second: signal(Date.now()),
    coarse: signal(Date.now()),
  };
  private readonly readonlyTicks: Record<WallClockCadence, Signal<number>> = {
    second: this.ticks.second.asReadonly(),
    coarse: this.ticks.coarse.asReadonly(),
  };
  private readonly subscribers: Record<WallClockCadence, number> = {
    second: 0,
    coarse: 0,
  };
  private readonly intervals: Record<WallClockCadence, ReturnType<typeof setInterval> | null> = {
    second: null,
    coarse: null,
  };

  private readonly visibilityChanged = (): void => {
    for (const cadence of CADENCES) {
      if (this.document.hidden) {
        this.stop(cadence);
      } else if (this.subscribers[cadence] > 0) {
        this.ticks[cadence].set(Date.now());
        this.start(cadence);
      }
    }
  };

  now(cadence: WallClockCadence): Signal<number> {
    return this.readonlyTicks[cadence];
  }

  acquire(cadence: WallClockCadence): () => void {
    const wasIdle = this.subscribers.second + this.subscribers.coarse === 0;
    this.subscribers[cadence]++;
    this.ticks[cadence].set(Date.now());
    if (wasIdle) {
      this.document.addEventListener('visibilitychange', this.visibilityChanged);
    }
    this.start(cadence);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscribers[cadence]--;
      if (this.subscribers[cadence] === 0) this.stop(cadence);
      if (this.subscribers.second + this.subscribers.coarse === 0) {
        this.document.removeEventListener('visibilitychange', this.visibilityChanged);
      }
    };
  }

  private start(cadence: WallClockCadence): void {
    if (this.document.hidden || this.subscribers[cadence] === 0 || this.intervals[cadence] !== null) return;
    this.zone.runOutsideAngular(() => {
      this.intervals[cadence] = setInterval(
        () => this.ticks[cadence].set(Date.now()),
        INTERVAL_MS[cadence],
      );
    });
  }

  private stop(cadence: WallClockCadence): void {
    const interval = this.intervals[cadence];
    if (interval === null) return;
    clearInterval(interval);
    this.intervals[cadence] = null;
  }
}

/** Subscribe for the lifetime of the injection context, or only while active. */
export function injectWallClock(
  cadence: WallClockCadence,
  active?: () => boolean,
): Signal<number> {
  const clock = inject(WallClockService);
  const destroyRef = inject(DestroyRef);
  if (active) {
    effect((onCleanup) => {
      if (active()) {
        onCleanup(untracked(() => clock.acquire(cadence)));
      }
    });
  } else {
    destroyRef.onDestroy(clock.acquire(cadence));
  }
  return clock.now(cadence);
}
