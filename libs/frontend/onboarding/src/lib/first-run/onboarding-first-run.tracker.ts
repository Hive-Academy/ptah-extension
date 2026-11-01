import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  PRIMARY_OUTLET,
  Router,
  type Event as RouterEvent,
} from '@angular/router';
import { LoggingService } from '@ptah-extension/core';
import type { Subscription } from 'rxjs';
import { OnboardingFlagService } from './onboarding-flag.service';

/** The redirect the chat guard issued, followed until it lands or dies. */
interface PendingRedirect {
  /** The chat navigation the guard redirected. */
  readonly originId: number;
  /** The navigation that carries the redirect, once it started. */
  replacementId: number | null;
  /** The origin was cancelled by its own redirect; the replacement is next. */
  awaiting: boolean;
}

/**
 * Commits the first-run flag only when the guard's redirect really lands.
 *
 * A guard that returns a `UrlTree` does not know whether the redirect will
 * land: a host `SWITCH_VIEW` during boot supersedes it. So the guard only
 * records its navigation id here, and `shownAt` is written in exactly one
 * place, on the replacement navigation's `NavigationEnd` whose first segment
 * is `onboarding`:
 *
 * | Event                         | Condition                                     | Effect |
 * | ----------------------------- | --------------------------------------------- | ------ |
 * | `recordRedirect(id)`          | —                                             | pending = origin `id` |
 * | `NavigationCancel`            | origin, code `Redirect`                       | awaiting the replacement |
 * | Cancel / Error / Skipped      | origin with any other code, or replacement    | clear |
 * | `NavigationStart`             | awaiting, first segment `onboarding`          | replacement = id |
 * | `NavigationStart`             | awaiting, any other URL                       | clear (superseded) |
 * | `NavigationEnd`               | replacement, first segment `onboarding`       | `markShown()`, clear |
 * | `NavigationEnd`               | any other id                                  | ignored (a manual visit never commits) |
 */
@Injectable({ providedIn: 'root' })
export class OnboardingFirstRunTracker {
  private readonly router = inject(Router);
  private readonly flag = inject(OnboardingFlagService);
  private readonly logger = inject(LoggingService);
  private readonly destroyRef = inject(DestroyRef);

  private subscription: Subscription | null = null;
  private pending: PendingRedirect | null = null;

  /** Subscribe to `Router.events` once for the app's lifetime. Idempotent. */
  start(): void {
    if (this.subscription) return;
    this.subscription = this.router.events.subscribe((event) =>
      this.onRouterEvent(event),
    );
    this.destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  /** Called by the chat guard with the navigation it is redirecting. */
  recordRedirect(navigationId: number): void {
    this.pending = {
      originId: navigationId,
      replacementId: null,
      awaiting: false,
    };
  }

  private onRouterEvent(event: RouterEvent): void {
    const pending = this.pending;
    if (!pending) return;

    if (event instanceof NavigationCancel) {
      if (
        event.id === pending.originId &&
        event.code === NavigationCancellationCode.Redirect &&
        pending.replacementId === null
      ) {
        pending.awaiting = true;
      } else if (this.isTracked(pending, event.id)) {
        this.pending = null;
      }
      return;
    }

    if (
      event instanceof NavigationError ||
      event instanceof NavigationSkipped
    ) {
      if (this.isTracked(pending, event.id)) this.pending = null;
      return;
    }

    if (event instanceof NavigationStart) {
      if (!pending.awaiting) return;
      if (this.firstSegment(event.url) === 'onboarding') {
        pending.replacementId = event.id;
        pending.awaiting = false;
      } else {
        this.pending = null;
      }
      return;
    }

    if (event instanceof NavigationEnd && event.id === pending.replacementId) {
      if (this.firstSegment(event.urlAfterRedirects) === 'onboarding') {
        this.flag.markShown();
      }
      this.pending = null;
    }
  }

  private isTracked(pending: PendingRedirect, id: number): boolean {
    return id === pending.originId || id === pending.replacementId;
  }

  /** The first primary segment's path, without matrix parameters or query. */
  private firstSegment(url: string): string | undefined {
    try {
      const tree = this.router.parseUrl(url);
      const segments =
        tree.root.children[PRIMARY_OUTLET]?.segments ?? tree.root.segments;
      return segments[0]?.path;
    } catch (error: unknown) {
      // degradation-audit: reported — a failed URL parse leaves first-run unmarked and is logged.
      this.logger.warn(
        'OnboardingFirstRunTracker',
        'Could not parse onboarding navigation URL',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return undefined;
    }
  }
}
