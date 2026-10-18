import { Subscription, type SchedulerAction, type SchedulerLike } from 'rxjs';

/** A scheduled RxJS action backed by a single unref'd Node timeout. */
class UnrefAction<T> extends Subscription implements SchedulerAction<T> {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly work: (this: SchedulerAction<T>, state?: T) => void,
  ) {
    super();
    this.add(() => this.clearTimer());
  }

  schedule(state?: T, delay = 0): Subscription {
    if (this.closed) return this;
    this.clearTimer();
    this.handle = setTimeout(
      () => {
        this.handle = null;
        if (!this.closed) this.work.call(this, state);
      },
      Math.max(0, delay),
    );
    this.handle.unref?.();
    return this;
  }

  private clearTimer(): void {
    if (this.handle !== null) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

/** RxJS scheduler whose pending actions never keep Node alive. */
export function createUnrefScheduler(): SchedulerLike {
  return {
    now: () => Date.now(),
    schedule<T>(
      work: (this: SchedulerAction<T>, state?: T) => void,
      delay = 0,
      state?: T,
    ): Subscription {
      return new UnrefAction(work).schedule(state, delay);
    },
  };
}
