import { afterEveryRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { MonogramTileComponent, ProviderMarkComponent, PROVIDER_BRAND_SLUGS } from '@ptah-extension/ui';
import type { ProjectionResult } from '../model/work-projection';
import { CommandCenterStore } from '../model/command-center.store';
import type { SceneGeometry } from '../scene/connector-geometry';
import { CommandOverlayPositioner } from './command-overlay-positioner';
import { EMPTY_PLATE_RESERVATION, type PlateMode, type PlateReservation } from './command-overlay-placement';

export const COMMAND_OVERLAY_OPEN_DELAY_MS = 150;
export const COMMAND_OVERLAY_CLOSE_DELAY_MS = 200;

@Component({
  selector: 'ptah-command-overlay',
  standalone: true,
  imports: [ProviderMarkComponent, MonogramTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (activeNode(); as node) {
      <section #card id="command-plate"
        class="fixed z-20 rounded-xl border border-base-300 bg-base-100 p-3 text-base-content shadow-xl"
        [class.pointer-events-none]="!pinnedNodeId()"
        [class.pointer-events-auto]="!!pinnedNodeId()"
        [attr.role]="pinnedNodeId() ? 'region' : 'tooltip'"
        [attr.aria-label]="pinnedNodeId() ? node.label + ' details' : null"
        [attr.data-plate-mode]="pinnedNodeId() ? 'pinned' : 'preview'"
        (keydown.escape)="onEscape($event)">
        <div class="flex items-start gap-2">
          @if (knownProvider(node.providerId); as providerId) {
            <ptah-provider-mark [providerId]="providerId" size="sm" />
          } @else {
            <ptah-monogram-tile [label]="node.providerId || node.label" size="sm" />
          }
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ node.label }}</p>
            <p class="text-xs text-base-content-muted">
              @if (providerName(node.providerId); as provider) { {{ provider }} · }
              {{ node.kind }} · {{ node.state }}
            </p>
            @if (age(node.updatedAt); as ageText) {
              <p class="text-xs text-base-content-muted">{{ ageText }}</p>
            }
          </div>
          @if (pinnedNodeId()) {
            <button type="button" class="min-h-11 min-w-11 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning"
              aria-label="Close node details" (click)="closePinned()">×</button>
          }
        </div>
        @if (pinnedNodeId() && phases().length) {
          <ul class="mt-2 border-t border-base-300 pt-2 text-xs">
            @for (phase of phases(); track phase.id) { <li>{{ phase.label }} · {{ phase.state }}</li> }
          </ul>
        }
      </section>
    }
  `,
})
export class CommandOverlayComponent {
  public readonly projection = input.required<ProjectionResult>();
  public readonly hoveredNodeId = input<string | null>(null);
  public readonly selectedId = input<string | null>(null);
  public readonly reducedMotion = input(false);
  public readonly geometry = input<SceneGeometry | null>(null);
  public readonly focusWorkListRow = output<string>();
  public readonly reservationChange = output<PlateReservation>();
  public readonly repositionRequested = output<void>();
  private readonly _activeNodeId = signal<string | null>(null);
  public readonly activeNodeId = this._activeNodeId.asReadonly();
  private readonly _pinnedNodeId = signal<string | null>(null);
  public readonly pinnedNodeId = this._pinnedNodeId.asReadonly();
  public readonly activeNode = computed(() => this.projection().nodes.find(node => node.id === this.activeNodeId()) ?? null);
  public readonly phases = computed(() => this.projection().nodes.filter(node => node.kind === 'phase' && node.parentId === this.activeNodeId()));
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(CommandCenterStore);
  private readonly positioner = new CommandOverlayPositioner();
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private selectedBeforePin: string | null = null;
  private reservation: PlateReservation = EMPTY_PLATE_RESERVATION;
  private mode: PlateMode | null = null;
  private lastViewport = '';
  private scrolledPin: string | null = null;
  private destroyed = false;

  public constructor() {
    effect(() => {
      const hover = this.hoveredNodeId();
      if (this.pinnedNodeId()) return;
      if (hover) this.requestOpen(hover);
      else this.scheduleClose();
    });
    effect(() => {
      const selected = this.store.selectedId();
      const pinned = this.pinnedNodeId();
      if (pinned && selected !== this.selectedBeforePin) this.unpin(false);
    });
    afterEveryRender(() => this.position());
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.clearTimers();
      this.generation++;
      document.removeEventListener('pointerdown', this.onOutsidePointer);
      this.setReservation(EMPTY_PLATE_RESERVATION);
    });
  }

  public knownProvider(id: string | null): string | null {
    return id && Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ? id : null;
  }
  public providerName(id: string | null): string | null {
    if (!id || id.toLowerCase() === 'unknown') return null;
    return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }
  public age(updatedAt?: number): string | null {
    if (updatedAt === undefined || !Number.isFinite(updatedAt)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }
  public activate(id: string): void {
    if (!this.projection().nodes.some(node => node.id === id)) return;
    this.clearTimers();
    this.generation++;
    this.selectedBeforePin = this.store.selectedId();
    this.mode = null;
    this.lastViewport = '';
    this.scrolledPin = null;
    this._pinnedNodeId.set(id);
    this._activeNodeId.set(id);
    document.addEventListener('pointerdown', this.onOutsidePointer);
    this.repositionRequested.emit();
  }
  public pin(id: string): void {
    this.store.select(id);
    this.activate(id);
  }
  public closePinned(): void { this.unpin(true); }
  public closeCard(): void {
    this.clearTimers();
    this.generation++;
    this._pinnedNodeId.set(null);
    this._activeNodeId.set(null);
    this.mode = null;
    this.lastViewport = '';
    this.scrolledPin = null;
    document.removeEventListener('pointerdown', this.onOutsidePointer);
    this.setReservation(EMPTY_PLATE_RESERVATION);
  }
  public onEscape(event: Event): void {
    if (!(event instanceof KeyboardEvent) || !this.pinnedNodeId()) return;
    event.preventDefault();
    event.stopPropagation();
    this.unpin(true);
  }
  private unpin(restoreFocus: boolean): void {
    const id = this.pinnedNodeId();
    if (!id) return;
    this.closeCard();
    if (restoreFocus) this.restoreFocus(id);
  }
  private restoreFocus(id: string): void {
    const stage = this.host.nativeElement.parentElement;
    const root = Array.from(stage?.querySelectorAll<HTMLElement>('[data-core-root-id]') ?? []).find(el => el.dataset['coreRootId'] === id);
    const row = Array.from(stage?.querySelectorAll<HTMLElement>('[data-stream-row-id]') ?? []).find(el => el.dataset['streamRowId'] === id);
    if (root || row) (root ?? row)?.focus();
    else if (this.projection().nodes.some(node => node.id === id && node.kind === 'root')) stage?.querySelector<HTMLElement>('[data-scene-heading]')?.focus();
    else this.focusWorkListRow.emit(id);
  }
  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (!this.pinnedNodeId()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.card()?.nativeElement.contains(target)) return;
    const stage = this.host.nativeElement.parentElement;
    if (target instanceof Element && (target.closest('[data-stream-row-id]') || target.closest('[data-core-root-id]')) && stage?.contains(target)) return;
    this.unpin(true);
  };
  private requestOpen(id: string): void {
    if (this.destroyed || !this.projection().nodes.some(node => node.id === id)) return;
    this.cancelClose();
    if (this.activeNodeId() === id) return;
    this.cancelOpen();
    const generation = ++this.generation;
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (generation === this.generation && this.hoveredNodeId() === id && !this.pinnedNodeId() &&
        (this.geometry()?.stage.width ?? 0) >= 960) {
        this._activeNodeId.set(id);
        this.repositionRequested.emit();
      }
    }, COMMAND_OVERLAY_OPEN_DELAY_MS);
  }
  private scheduleClose(): void {
    if (!this.activeNodeId() || this.pinnedNodeId() || this.closeTimer) return;
    this.cancelOpen();
    const generation = ++this.generation;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (generation === this.generation && !this.hoveredNodeId() && !this.pinnedNodeId()) {
        this._activeNodeId.set(null);
        this.setReservation(EMPTY_PLATE_RESERVATION);
      }
    }, COMMAND_OVERLAY_CLOSE_DELAY_MS);
  }
  private position(): void {
    const id = this.activeNodeId();
    const geometry = this.geometry();
    const card = this.card()?.nativeElement;
    const stage = this.host.nativeElement.parentElement?.querySelector<HTMLElement>('[data-scene-stage]');
    if (!id || !geometry || !card || !stage) return;
    const kind = this.projection().nodes.find(node => node.id === id)?.kind === 'root' ? 'root' : 'stream';
    if (this.pinnedNodeId()) {
      const viewport = `${geometry.streamViewport.width}:${geometry.streamViewport.height}`;
      const previousMode = this.lastViewport && this.lastViewport !== viewport ? this.mode : null;
      const placed = this.positioner.pinned(geometry, id, kind, card.scrollHeight, previousMode);
      if (!placed) { this.unpin(true); return; }
      this.mode = placed.mode;
      this.lastViewport = viewport;
      this.positioner.apply(card, stage, placed.plate, placed.scrollInsidePlate);
      this.setReservation(placed.reservation);
      if (kind === 'stream' && placed.mode === 'inline' && this.scrolledPin !== id) {
        const slot = Array.from(stage.querySelectorAll<HTMLElement>('[data-plate-slot-id]'))
          .find(element => element.dataset['plateSlotId'] === id);
        if (slot) {
          this.scrolledPin = id;
          slot.scrollIntoView?.({ block: 'nearest' });
          this.repositionRequested.emit();
        }
      }
    } else {
      const preview = this.positioner.preview(geometry, id, card.scrollHeight, kind);
      if (preview) this.positioner.apply(card, stage, preview);
      else card.style.visibility = 'hidden';
      this.setReservation(EMPTY_PLATE_RESERVATION);
    }
  }
  private setReservation(next: PlateReservation): void {
    if (this.reservation.pinnedId === next.pinnedId && this.reservation.anchorKind === next.anchorKind &&
      this.reservation.inlineSlotHeight === next.inlineSlotHeight && this.reservation.reservedHeight === next.reservedHeight) return;
    this.reservation = next;
    this.reservationChange.emit(next);
  }
  private cancelOpen(): void { if (this.openTimer) clearTimeout(this.openTimer); this.openTimer = null; }
  private cancelClose(): void { if (this.closeTimer) clearTimeout(this.closeTimer); this.closeTimer = null; }
  private clearTimers(): void { this.cancelOpen(); this.cancelClose(); }
}
