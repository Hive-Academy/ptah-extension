import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal, type Signal } from '@angular/core';
import {
  withViewTransitions,
  type ActivatedRouteSnapshot,
  type ViewTransitionsFeature,
} from '@angular/router';
import { surfaceIdFromSegment } from './surface-routes';
import { LoggingService } from '../services/logging.service';

/** Surface identity is the first primary segment consumed by the top-level route.
 * Keep top-level surface routes non-empty and single-segmented.
 */
export function shouldAnimateSurfaceChange(
  from: ActivatedRouteSnapshot,
  to: ActivatedRouteSnapshot,
  reducedMotion: boolean,
): boolean {
  return (
    !reducedMotion &&
    surfaceIdFromSegment(from.firstChild?.url[0]?.path) !==
      surfaceIdFromSegment(to.firstChild?.url[0]?.path)
  );
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class SurfaceTransitionTracker {
  private readonly document = inject(DOCUMENT);
  private readonly logger = inject(LoggingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly busyState = signal(false);
  readonly busy: Signal<boolean> = this.busyState.asReadonly();
  private current: ViewTransition | undefined;
  private callbacks: Array<() => void> = [];
  private listening = false;
  private readonly skipOnInput = () => this.current?.skipTransition();

  afterTransition(fn: () => void): void {
    if (!this.current) {
      fn();
      return;
    }
    this.callbacks.push(fn);
  }

  track(transition: ViewTransition): void {
    if (!this.listening) {
      this.document.addEventListener('pointerdown', this.skipOnInput, true);
      this.document.addEventListener('keydown', this.skipOnInput, true);
      this.destroyRef.onDestroy(() => {
        this.document.removeEventListener('pointerdown', this.skipOnInput, true);
        this.document.removeEventListener('keydown', this.skipOnInput, true);
      });
      this.listening = true;
    }
    this.current = transition;
    this.busyState.set(true);
    this.document.documentElement.classList.remove('ptah-vt-entering');
    this.document.documentElement.classList.add('ptah-vt-active');
    void transition.updateCallbackDone.then(
      () => {
        if (this.current === transition) {
          this.document.documentElement.classList.add('ptah-vt-entering');
        }
      },
      () => undefined,
    );
    // Handle both outcomes of finished; a rejected finally() chain would itself
    // be unhandled. Superseded transitions leave callbacks for the latest one.
    void transition.finished.then(
      () => this.settle(transition),
      () => this.settle(transition),
    );
  }

  private settle(transition: ViewTransition): void {
    if (this.current !== transition) return;
    this.current = undefined;
    this.busyState.set(false);
    this.document.documentElement.classList.remove('ptah-vt-active', 'ptah-vt-entering');
    const callbacks = this.callbacks;
    this.callbacks = [];
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        this.logger.error('SurfaceTransitionTracker', 'Deferred callback failed', error);
      }
    }
  }
}

export function withSurfaceViewTransitions(): ViewTransitionsFeature {
  return withViewTransitions({
    skipInitialTransition: true,
    onViewTransitionCreated: ({ transition, from, to }) => {
      // Skip, not a zero-duration transition: a session switch changes the URL, and a
      // running transition would capture page snapshots on every switch. Dev builds log
      // the skipped transition's rejected `ready` promise; production builds do not.
      if (!shouldAnimateSurfaceChange(from, to, prefersReducedMotion())) {
        transition.skipTransition();
        return;
      }
      inject(SurfaceTransitionTracker).track(transition);
    },
  });
}
