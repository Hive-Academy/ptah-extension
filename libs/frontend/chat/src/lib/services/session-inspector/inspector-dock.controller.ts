import {
  Injectable,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { InspectorDockWidthStore } from './inspector-dock-width.store';
import {
  INSPECTOR_MIN_WIDTH,
  inspectorDockWidth,
  inspectorMaxWidthFor,
} from './inspector-dock-width';

/**
 * Docked width of one inspector host (design-spec §1-2): the live drag
 * draft, the rendered and maximum widths, the commit policy and the reset.
 * Provided per host, never in root. The host binds whether the dock shows
 * and the width the tile area and the dock share. The stored preference is
 * shared by every host (`InspectorDockWidthStore`); the draft is this host's
 * live drag only.
 */
@Injectable()
export class InspectorDockController {
  private readonly widthStore = inject(InspectorDockWidthStore);
  private readonly shownSource = signal<() => boolean>(() => false);
  private readonly availableWidthSource = signal<() => number>(() => 0);

  readonly minWidth = INSPECTOR_MIN_WIDTH;

  /** The docked inspector, its resize handle and its inline width render. */
  readonly slotShown = computed(() => this.shownSource()());

  /**
   * Width while a drag or key step is in flight; never persisted. It resets
   * whenever the slot appears or goes: a handle destroyed mid-drag reports
   * nothing, so a stale draft must not survive into the next docked render.
   */
  private readonly draft = linkedSignal<boolean, number | null>({
    source: this.slotShown,
    computation: () => null,
  });

  private readonly availableWidth = computed(() =>
    this.availableWidthSource()(),
  );

  /** Rendered dock width: draft, else preference, clamped to the host. */
  readonly width = computed(() =>
    inspectorDockWidth(
      this.draft() ?? this.widthStore.preference(),
      this.availableWidth(),
    ),
  );

  /** Whole-px maximum, the same bound `width` is clamped to. */
  readonly maxWidth = computed(() =>
    inspectorMaxWidthFor(this.availableWidth()),
  );

  /**
   * Bind the host: `shown` is whether the dock renders now, `availableWidth`
   * the width (px) the tile area and the dock share.
   */
  bind(shown: () => boolean, availableWidth: () => number): void {
    this.shownSource.set(shown);
    this.availableWidthSource.set(availableWidth);
  }

  /** A drag frame or key step: render `width` without persisting it. */
  preview(width: number): void {
    this.draft.set(width);
  }

  /** A cancelled drag: back to the stored preference, nothing written. */
  cancel(): void {
    this.draft.set(null);
  }

  /**
   * Drag end or key step. The draft is clamped to the current host width
   * first, so a host that shrank mid-drag stores the width that rendered,
   * not the raw pointer position. Persists only a clamped draft that differs
   * from what the preference renders now, so a click without movement at a
   * host-clamped width never overwrites a wider stored preference.
   */
  commit(): void {
    const draft = this.draft();
    this.draft.set(null);
    if (draft === null) return;
    const available = this.availableWidth();
    const clamped = inspectorDockWidth(draft, available);
    const rendered = inspectorDockWidth(this.widthStore.preference(), available);
    if (clamped === rendered) return;
    this.widthStore.commit(clamped);
  }

  /** Double-click: forget the preference, back to the host's default. */
  reset(): void {
    this.draft.set(null);
    this.widthStore.reset();
  }
}
