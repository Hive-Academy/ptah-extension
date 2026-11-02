import {
  AfterContentInit,
  contentChild,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import {
  ActivatedRoute,
  GuardsCheckEnd,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  Router,
  RouterOutlet,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MotionStageDirective, type MotionStageState } from './motion-stage.directive';
import type { MotionRouteKey, MotionRouteKeyFn } from './motion-route-keys';

interface PendingRoute {
  readonly id: number;
  readonly key: MotionRouteKey;
  readonly prior: MotionStageState;
  readonly outletInstance: object | null;
  readonly replaces: boolean;
}

interface LeaveClone {
  start(): void;
  dispose(): void;
}

function targetOutletRoute(parent: ActivatedRouteSnapshot, target: RouterStateSnapshot): ActivatedRouteSnapshot | null {
  let node: ActivatedRouteSnapshot | null = target.root;
  for (const ancestor of parent.pathFromRoot.slice(1)) {
    node = node.firstChild ?? null;
    if (!node || node.routeConfig !== ancestor.routeConfig) return null;
  }
  return node.firstChild ?? null;
}

function tokenMilliseconds(element: HTMLElement, name: string): number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return value.endsWith('ms') ? amount : value.endsWith('s') ? amount * 1000 : 0;
}

@Directive({
  selector: '[ptahMotionRouteStage]',
  standalone: true,
  hostDirectives: [MotionStageDirective],
})
export class MotionRouteStageDirective implements AfterContentInit {
  readonly motionRouteKey = input.required<MotionRouteKeyFn>();
  readonly motionLeaveClone = input(false);

  private readonly stage = inject(MotionStageDirective, { self: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly outlet = contentChild.required(RouterOutlet);
  private committed: MotionRouteKey | null = null;
  private pending: PendingRoute | null = null;
  private clone: LeaveClone | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.pending = null;
      this.disposeClone();
    });
  }

  ngAfterContentInit(): void {
    this.committed = this.motionRouteKey()(this.router.routerState.snapshot);
    this.stage.setIndex(this.committed?.index ?? null);
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof GuardsCheckEnd && event.shouldActivate) {
        this.onGuardsCheckEnd(event);
      } else if (event instanceof NavigationEnd && event.id === this.pending?.id) {
        const pending = this.pending;
        this.committed = pending.key;
        if (!pending.replaces && this.outlet().isActivated &&
            this.outlet().component === pending.outletInstance) this.stage.replay();
        this.clone?.start();
        this.pending = null;
      } else if ((event instanceof NavigationCancel || event instanceof NavigationError ||
          event instanceof NavigationSkipped) && event.id === this.pending?.id) {
        this.stage.restoreState(this.pending.prior);
        this.pending = null;
        this.disposeClone();
      }
    });
  }

  private onGuardsCheckEnd(event: GuardsCheckEnd): void {
    if (this.pending) {
      this.stage.restoreState(this.pending.prior);
      this.pending = null;
      this.disposeClone();
    }
    const next = this.motionRouteKey()(event.state);
    if (!next || next.key === this.committed?.key) return;
    this.disposeClone();
    const prior = this.stage.captureState();
    this.stage.setIndex(next.index);
    const outlet = this.outlet();
    const target = targetOutletRoute(this.route.snapshot, event.state);
    const replaces = outlet.isActivated && target !== null &&
      target.routeConfig !== outlet.activatedRoute.snapshot.routeConfig;
    if (replaces && this.motionLeaveClone()) this.createClone();
    this.pending = {
      id: event.id,
      key: next,
      prior,
      outletInstance: outlet.isActivated ? outlet.component : null,
      replaces,
    };
  }

  private createClone(): void {
    this.disposeClone();
    const stageElement = this.stageElement();
    const panel = stageElement?.querySelector<HTMLElement>(':scope > .ptah-motion-panel:not([data-motion-clone])');
    if (!stageElement || !panel) return;
    const clone = panel.cloneNode(true) as HTMLElement;
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    clone.setAttribute('data-motion-clone', 'pending');
    clone.classList.remove('ptah-motion-enter', 'ptah-motion-leave');
    clone.classList.add('ptah-motion-leave');
    stageElement.appendChild(clone);

    let frame = 0;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clone.removeEventListener('animationend', onAnimation);
      clone.removeEventListener('animationcancel', onAnimation);
      if (frame) cancelAnimationFrame(frame);
      if (capTimer) clearTimeout(capTimer);
      if (completionTimer) clearTimeout(completionTimer);
      clone.remove();
      if (this.clone?.dispose === dispose) this.clone = null;
    };
    const onAnimation = (event: AnimationEvent) => {
      if (event.target === clone && event.animationName === 'ptahMotionLeave') dispose();
    };
    clone.addEventListener('animationend', onAnimation);
    clone.addEventListener('animationcancel', onAnimation);
    const duration = tokenMilliseconds(stageElement, '--ptah-motion-out');
    capTimer = setTimeout(dispose, Math.max(1500, duration + 50));
    this.clone = {
      dispose,
      start: () => {
        clone.setAttribute('data-motion-clone', 'running');
        frame = requestAnimationFrame(() => {
          frame = 0;
          const animations = (clone.getAnimations?.() ?? []).filter((animation) =>
            'animationName' in animation && animation.animationName === 'ptahMotionLeave' &&
            animation.playState === 'running',
          );
          if (animations.length === 0) {
            dispose();
            return;
          }
          const longest = Math.max(duration, ...animations.map((animation) => {
            const endTime = animation.effect?.getComputedTiming().endTime;
            return typeof endTime === 'number' && Number.isFinite(endTime) ? endTime : duration;
          }));
          completionTimer = setTimeout(dispose, longest + 50);
        });
      },
    };
  }

  private stageElement(): HTMLElement | null {
    return this.host;
  }

  private disposeClone(): void {
    this.clone?.dispose();
    this.clone = null;
  }
}
