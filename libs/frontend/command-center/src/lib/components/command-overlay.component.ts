import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  NgZone,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FloatingUIService,
  MonogramTileComponent,
  ProviderMarkComponent,
  PROVIDER_BRAND_SLUGS,
  PROVIDER_MARKS,
} from '@ptah-extension/ui';
import { LucideAngularModule } from 'lucide-angular';
import { CommandCenterStore } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import type { SceneLabel } from '../scene/command-scene-renderer';
import { CommandOverlayPositioner } from './command-overlay-positioner';
import { stateColor, stateIcon } from './command-state-icon';

export const COMMAND_OVERLAY_OPEN_DELAY_MS = 150;
export const COMMAND_OVERLAY_CLOSE_DELAY_MS = 200;

@Component({
  selector: 'ptah-command-overlay',
  standalone: true,
  imports: [ProviderMarkComponent, MonogramTileComponent, LucideAngularModule],
  providers: [FloatingUIService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none absolute inset-0">
      @for (node of projection().nodes; track node.id) {
        <button
          type="button"
          class="pointer-events-auto absolute left-0 top-0 flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg border border-base-300 bg-base-100/95 px-2 text-xs text-base-content shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [class.border-warning]="selectedId() === node.id"
          [style.visibility]="
            visibleLabelIds() === null || visibleLabelIds()?.includes(node.id)
              ? 'visible'
              : 'hidden'
          "
          [attr.data-node-id]="node.id"
          [attr.aria-label]="node.label + ', ' + node.state"
          [attr.aria-pressed]="selectedId() === node.id"
          [attr.aria-describedby]="
            activeNodeId() === node.id && !pinnedNodeId()
              ? 'command-node-card'
              : null
          "
          [attr.aria-expanded]="
            activeNodeId() === node.id && pinnedNodeId() === node.id
              ? 'true'
              : null
          "
          [attr.aria-controls]="
            pinnedNodeId() === node.id ? 'command-node-card' : null
          "
          (pointerenter)="onLabelEnter(node.id)"
          (pointerleave)="onLabelLeave(node.id)"
          (click)="pin(node.id)"
          (keydown.enter)="onLabelEnterKey($event, node.id)"
          (keydown.space)="onLabelEnterKey($event, node.id)"
          (keydown.escape)="onEscape($event)"
        >
          <span class="flex max-w-36 min-w-0 items-center gap-1 font-semibold">
            @if (knownProvider(node.providerId); as providerId) {
              <ptah-provider-mark [providerId]="providerId" size="sm" />
            } @else {
              <ptah-monogram-tile
                [label]="node.providerId || node.label"
                size="sm"
              />
            }
            <span class="min-w-0 truncate">{{ node.label }}</span>
          </span>
          <span class="text-[11px] text-base-content-muted">
            @if (providerName(node.providerId); as provider) {
              {{ provider }} ·
            }
            <span
              class="inline-flex items-center gap-1"
              [class]="stateColor(node.state)"
            >
              <lucide-angular
                [img]="stateIcon(node.state)"
                class="h-3 w-3"
                aria-hidden="true"
                [class.animate-spin]="
                  (node.state === 'running' || node.state === 'starting') &&
                  !reducedMotion()
                "
              />
              {{ node.state }}
            </span>
          </span>
        </button>
      }
      <span
        #cardAnchor
        aria-hidden="true"
        class="absolute left-0 top-0 h-0 w-0"
      ></span>
      @if (activeNode(); as node) {
        <div
          #bridge
          aria-hidden="true"
          class="pointer-events-auto fixed"
          (pointerenter)="onBridgeEnter()"
          (pointerleave)="onBridgeLeave()"
        ></div>
        <section
          #card
          id="command-node-card"
          class="pointer-events-auto fixed z-20 w-64 rounded-xl border border-base-300 bg-base-100 p-3 text-base-content shadow-xl"
          [class.transition-opacity]="!reducedMotion()"
          [attr.role]="pinnedNodeId() ? 'region' : 'tooltip'"
          [attr.aria-label]="pinnedNodeId() ? node.label + ' details' : null"
          (pointerenter)="onCardEnter()"
          (pointerleave)="onCardLeave()"
          (keydown.escape)="onEscape($event)"
        >
          <div class="flex items-start gap-2">
            @if (knownProvider(node.providerId); as providerId) {
              <ptah-provider-mark [providerId]="providerId" size="sm" />
            } @else {
              <ptah-monogram-tile
                [label]="node.providerId || node.label"
                size="sm"
              />
            }
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{{ node.label }}</p>
              <p class="text-xs text-base-content-muted">
                @if (providerName(node.providerId); as provider) {
                  {{ provider }} ·
                }
                <span
                  class="inline-flex items-center gap-1"
                  [class]="stateColor(node.state)"
                >
                  <lucide-angular
                    [img]="stateIcon(node.state)"
                    class="h-3 w-3"
                    aria-hidden="true"
                    [class.animate-spin]="
                      (node.state === 'running' || node.state === 'starting') &&
                      !reducedMotion()
                    "
                  />
                  {{ node.state }}
                </span>
              </p>
            </div>
            @if (pinnedNodeId()) {
              <button
                type="button"
                class="min-h-11 min-w-11 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
                aria-label="Close node details"
                (click)="closePinned()"
              >
                ×
              </button>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class CommandOverlayComponent {
  public readonly visibleLabelIds = input<readonly string[] | null>(null);
  private readonly store = inject(CommandCenterStore);
  public readonly projection = input.required<ProjectionResult>();
  public readonly hoveredNodeId = input<string | null>(null);
  public readonly selectedId = input<string | null>(null);
  public readonly reducedMotion = input(false);
  public readonly focusWorkListRow = output<string>();
  private readonly _activeNodeId = signal<string | null>(null);
  public readonly activeNodeId = this._activeNodeId.asReadonly();
  private readonly _pinnedNodeId = signal<string | null>(null);
  public readonly pinnedNodeId = this._pinnedNodeId.asReadonly();
  public readonly activeNode = computed(
    () =>
      this.projection().nodes.find((node) => node.id === this.activeNodeId()) ??
      null,
  );
  public readonly stateIcon = stateIcon;
  public readonly stateColor = stateColor;

  private readonly floating = inject(FloatingUIService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly anchorRef =
    viewChild.required<ElementRef<HTMLElement>>('cardAnchor');
  private readonly cardRef = viewChild<ElementRef<HTMLElement>>('card');
  private readonly bridgeRef = viewChild<ElementRef<HTMLElement>>('bridge');
  private labelHoverId: string | null = null;
  private dismissedHoverId: string | null = null;
  private cardHover = false;
  private bridgeHover = false;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly positioner = new CommandOverlayPositioner(
    this.floating,
    () => this.activeNodeId(),
    () => this.getOverlayLabels(),
    () => this.getCardAnchor(),
    () => this.cardRef()?.nativeElement ?? null,
    () => this.bridgeRef()?.nativeElement ?? null,
  );
  private selectedBeforePin: string | null = null;
  private destroyed = false;

  public constructor() {
    effect(() => {
      const hover = this.hoveredNodeId();
      if (
        this.dismissedHoverId &&
        hover !== this.dismissedHoverId &&
        this.labelHoverId !== this.dismissedHoverId
      )
        this.dismissedHoverId = null;
      if (hover && !this.pinnedNodeId()) this.requestOpen(hover);
      else this.scheduleClose();
    });
    effect(() => {
      const selection = this.store.selectedId();
      const pinned = this.pinnedNodeId();
      if (pinned && selection !== this.selectedBeforePin) this.unpin(false);
    });
    effect(() => {
      const pinned = this.pinnedNodeId();
      const active = this.activeNodeId();
      const ids = this.projection().nodes.map((node) => node.id);
      if (pinned && !ids.includes(pinned)) this.unpin(false);
      else if (active && !ids.includes(active)) this.close();
    });
    let shownPinnedId: string | null = null;
    effect(() => {
      const visible = this.visibleLabelIds();
      const pinned = this.pinnedNodeId();
      if (!pinned || visible === null) {
        shownPinnedId = null;
        return;
      }
      if (visible.includes(pinned)) {
        shownPinnedId = pinned;
      } else if (shownPinnedId === pinned) {
        // Only a plate that a relayout hid hands focus to its work-list row —
        // and only when focus is inside the pinned card, on its plate, or on
        // the overlay host: a relayout must not steal focus from a control
        // the user is typing in elsewhere. The plate is unpinned either way.
        shownPinnedId = null;
        const handoff = this.focusInsidePinnedOverlay(pinned);
        this.unpin(false);
        if (handoff) this.focusWorkListRow.emit(pinned);
      }
    });
    effect(() => {
      const id = this.activeNodeId();
      if (!id) return;
      this.zone.runOutsideAngular(() => this.positioner.schedule());
    });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.clearTimers();
      this.positioner.destroy();
    });
  }

  /** Call after the overlay view renders and whenever projection changes. */
  public getOverlayLabels(): readonly SceneLabel[] {
    const root = this.anchorRef().nativeElement.parentElement;
    if (!root) return [];
    const elements = new Map(
      Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]')).map(
        (element) => [element.dataset['nodeId'], element],
      ),
    );
    return this.projection().nodes.flatMap((node) => {
      const element = elements.get(node.id);
      if (!element) return [];
      return [
        {
          id: node.id,
          element,
          width: element.offsetWidth,
          height: element.offsetHeight,
        },
      ];
    });
  }

  public getCardAnchor(): HTMLElement {
    return this.anchorRef().nativeElement;
  }

  public knownProvider(id: string | null): string | null {
    return id &&
      (Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ||
        Object.hasOwn(PROVIDER_MARKS, id))
      ? id
      : null;
  }

  public providerName(id: string | null): string | null {
    if (!id || id.toLowerCase() === 'unknown') return null;
    return id
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  public onLabelEnter(id: string): void {
    if (this.dismissedHoverId && this.dismissedHoverId !== id)
      this.dismissedHoverId = null;
    this.labelHoverId = id;
    this.cancelClose();
    if (!this.pinnedNodeId()) this.requestOpen(id);
  }

  public onLabelLeave(id: string): void {
    if (this.labelHoverId === id) this.labelHoverId = null;
    if (this.dismissedHoverId === id && this.hoveredNodeId() !== id)
      this.dismissedHoverId = null;
    this.cancelOpen();
    this.scheduleClose();
  }

  public onCardEnter(): void {
    this.cardHover = true;
    this.cancelClose();
  }

  public onCardLeave(): void {
    this.cardHover = false;
    this.scheduleClose();
  }

  public onBridgeEnter(): void {
    this.bridgeHover = true;
    this.cancelClose();
  }

  public onBridgeLeave(): void {
    this.bridgeHover = false;
    this.scheduleClose();
  }

  public onLabelEnterKey(event: Event, id: string): void {
    if (!(event instanceof KeyboardEvent)) return;
    event.preventDefault();
    this.pin(id);
  }

  public pin(id: string): void {
    this.clearTimers();
    this.store.select(id);
    this.selectedBeforePin = id;
    this._pinnedNodeId.set(id);
    this.activate(id);
  }

  public closePinned(): void {
    this.unpin(true);
  }

  public closeCard(): void {
    this.clearTimers();
    this._pinnedNodeId.set(null);
    this.close();
  }

  public onEscape(event: Event): void {
    if (
      !(event instanceof KeyboardEvent) ||
      (!this.activeNodeId() && !this.openTimer)
    )
      return;
    event.preventDefault();
    this.dismissedHoverId = this.hoveredNodeId() ?? this.labelHoverId;
    this.cancelOpen();
    if (this.pinnedNodeId()) this.unpin(true);
    else this.close();
  }

  private unpin(restoreFocus: boolean): void {
    const id = this.pinnedNodeId();
    if (!id) return;
    const card = this.cardRef()?.nativeElement;
    const focusInCard = !!card && card.contains(document.activeElement);
    this._pinnedNodeId.set(null);
    this.close();
    if (restoreFocus && focusInCard) {
      const trigger = this.findLabel(id);
      if (trigger && trigger.style.display !== 'none') trigger.focus();
      else this.focusWorkListRow.emit(id);
    }
  }

  /** Focus is inside the pinned card, on its plate, or on the overlay host. */
  private focusInsidePinnedOverlay(pinnedId: string): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (active === this.hostRef.nativeElement) return true;
    const card = this.cardRef()?.nativeElement;
    if (card && card.contains(active)) return true;
    const plate = this.findLabel(pinnedId);
    return !!plate && plate.contains(active);
  }

  private requestOpen(id: string): void {
    if (
      this.destroyed ||
      this.dismissedHoverId === id ||
      this.pinnedNodeId() ||
      !this.projection().nodes.some((node) => node.id === id)
    )
      return;
    this.cancelClose();
    if (this.activeNodeId() === id) return;
    this.cancelOpen();
    this.zone.runOutsideAngular(() => {
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        if (this.labelHoverId === id || this.hoveredNodeId() === id)
          this.zone.run(() => this.activate(id));
      }, COMMAND_OVERLAY_OPEN_DELAY_MS);
    });
  }

  private scheduleClose(): void {
    const id = this.activeNodeId();
    if (
      !id ||
      this.pinnedNodeId() ||
      this.labelHoverId === id ||
      this.hoveredNodeId() === id ||
      this.cardHover ||
      this.bridgeHover ||
      this.closeTimer
    )
      return;
    this.zone.runOutsideAngular(() => {
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        if (
          this.activeNodeId() === id &&
          this.labelHoverId !== id &&
          this.hoveredNodeId() !== id &&
          !this.cardHover &&
          !this.bridgeHover &&
          !this.pinnedNodeId()
        )
          this.zone.run(() => this.close());
      }, COMMAND_OVERLAY_CLOSE_DELAY_MS);
    });
  }

  private activate(id: string): void {
    if (this.activeNodeId() !== id) {
      this.positioner.stop();
      this._activeNodeId.set(id);
    }
  }

  private close(): void {
    this.clearTimers();
    this._activeNodeId.set(null);
    this.positioner.stop();
  }

  private findLabel(id: string): HTMLElement | null {
    return (
      this.getOverlayLabels().find((label) => label.id === id)?.element ?? null
    );
  }

  private cancelOpen(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private cancelClose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private clearTimers(): void {
    this.cancelOpen();
    this.cancelClose();
  }
}
