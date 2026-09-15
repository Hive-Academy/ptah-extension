/**
 * `createMockWorkspaceWatcher` — recording `jest.Mocked<IWorkspaceWatcher>`.
 *
 * Every `watch` call becomes a {@link MockWorkspaceSubscription}: it keeps the
 * root, options and listener the consumer subscribed with, counts its
 * disposals, and lets a spec deliver batches shaped exactly as the port shapes
 * them. No coalescing, no timers, no exclusion — the guarantees behind the
 * port are `WorkspaceChangeCoalescer`'s and are pinned by its own spec and by
 * `runWorkspaceWatcherContract`; this double is for CONSUMER specs.
 *
 * Delivery ignores disposal on purpose, so a spec can play a batch that was
 * already in flight when the consumer unsubscribed.
 */

import type {
  IWorkspaceWatcher,
  WorkspaceChangeBatch,
  WorkspaceChangeKind,
  WorkspaceChangeListener,
  WorkspaceWatchOptions,
} from '../../interfaces/workspace-watcher.interface';
import type { IDisposable } from '../../types/platform.types';

/** One recorded subscription; also the `IDisposable` `watch` returned. */
export interface MockWorkspaceSubscription extends IDisposable {
  readonly root: string;
  readonly options: WorkspaceWatchOptions;
  readonly listener: WorkspaceChangeListener;
  /** How many times `dispose()` ran — "disposed exactly once" is assertable. */
  readonly disposeCount: number;
  readonly disposed: boolean;
  /** Calls the listener with `batch` over an empty, complete batch for `root`. */
  deliver(batch: Partial<WorkspaceChangeBatch>): void;
  /** Delivers one normal batch holding `paths`, all of `kind`. */
  fire(kind: WorkspaceChangeKind, ...paths: string[]): void;
}

export interface MockWorkspaceWatcherState {
  /** Every subscription, in `watch` order, disposed or not. */
  readonly subscriptions: readonly MockWorkspaceSubscription[];
  /** The subscriptions not yet disposed. */
  live(): MockWorkspaceSubscription[];
  /** The newest subscription. Throws when `watch` was never called. */
  latest(): MockWorkspaceSubscription;
}

export type MockWorkspaceWatcher = jest.Mocked<IWorkspaceWatcher> & {
  readonly __state: MockWorkspaceWatcherState;
};

function createSubscription(
  root: string,
  options: WorkspaceWatchOptions,
  listener: WorkspaceChangeListener,
): MockWorkspaceSubscription {
  let disposeCount = 0;
  const subscription: MockWorkspaceSubscription = {
    root,
    options,
    listener,
    get disposeCount() {
      return disposeCount;
    },
    get disposed() {
      return disposeCount > 0;
    },
    dispose: () => {
      disposeCount++;
    },
    deliver: (batch) =>
      listener({
        root,
        changes: [],
        truncated: false,
        overflow: false,
        droppedCount: 0,
        ...batch,
      }),
    fire: (kind, ...paths) =>
      subscription.deliver({
        changes: paths.map((path) => ({ path, kind })),
      }),
  };
  return subscription;
}

export function createMockWorkspaceWatcher(): MockWorkspaceWatcher {
  const subscriptions: MockWorkspaceSubscription[] = [];

  return {
    watch: jest.fn(
      (
        root: string,
        options: WorkspaceWatchOptions,
        listener: WorkspaceChangeListener,
      ): IDisposable => {
        const subscription = createSubscription(root, options, listener);
        subscriptions.push(subscription);
        return subscription;
      },
    ),
    __state: {
      subscriptions,
      live: () => subscriptions.filter((s) => !s.disposed),
      latest: () => {
        const last = subscriptions[subscriptions.length - 1];
        if (!last) throw new Error('IWorkspaceWatcher.watch was never called');
        return last;
      },
    },
  };
}
