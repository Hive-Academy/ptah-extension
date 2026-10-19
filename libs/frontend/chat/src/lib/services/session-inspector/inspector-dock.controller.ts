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
  InspectorShellController,
  inspectorDockWidth,
  inspectorMaxWidthFor,
} from './inspector-shell.controller';

/**
 * Width (px) of ChatView's Stats tab (`ptah-sidebar-tab`, default size
 * `w-8`). It sits inside the measured shell, between the main column and the
 * dock, so the host passes it to `InspectorShellController.attach` as
 * reserved width: it never counts toward the band or the dock maximum.
 */
export const INSPECTOR_TAB_WIDTH = 32;

/**
 * Docked width of one inspector host (design-spec §1-2): the live drag
 * draft, the rendered and maximum widths, the commit policy and the reset.
 * Provided per host beside `InspectorShellController`, never in root. The
 * stored preference is shared by every host (`InspectorDockWidthStore`); the
 * draft is this host's live drag only.
 */
@Injectable()
export class InspectorDockController {
  private readonly shell = inject(InspectorShellController);
  private readonly widthStore = inject(InspectorDockWidthStore);
  private readonly hostedSource = signal<() => boolean>(() => false);

  readonly minWidth = INSPECTOR_MIN_WIDTH;

  /** The docked inspector, its resize handle and its inline width render. */
  readonly slotShown = computed(
    () =>
      this.hostedSource()() &&
      this.shell.isOpen() &&
      this.shell.tab() !== null &&
      !this.shell.isModal(),
  );

  /**
   * Width while a drag or key step is in flight; never persisted. It resets
   * whenever the slot appears or goes: a handle destroyed mid-drag reports
   * nothing, so a stale draft must not survive into the next docked render.
   */
  private readonly draft = linkedSignal<boolean, number | null>({
    source: this.slotShown,
    computation: () => null,
  });
  private readonly resizingState = linkedSignal<boolean, boolean>({
    source: this.slotShown,
    computation: () => false,
  });

  /** Turns the dock's entrance animation off while the handle drags. */
  readonly resizing = this.resizingState.asReadonly();

  /** Rendered dock width: draft, else preference, clamped to the shell. */
  readonly width = computed(() =>
    inspectorDockWidth(
      this.draft() ?? this.widthStore.preference(),
      this.shell.shellWidth(),
    ),
  );

  /** Whole-px maximum, the same bound `width` is clamped to. */
  readonly maxWidth = computed(() =>
    inspectorMaxWidthFor(this.shell.shellWidth()),
  );

  /** Whether this host shows the inspector at all (e.g. not a tile). */
  bindHosted(hosted: () => boolean): void {
    this.hostedSource.set(hosted);
  }

  /** A drag frame or key step: render `width` without persisting it. */
  preview(width: number): void {
    this.draft.set(width);
  }

  /** A cancelled drag: back to the stored preference, nothing written. */
  cancel(): void {
    this.draft.set(null);
  }

  setResizing(resizing: boolean): void {
    this.resizingState.set(resizing);
  }

  /**
   * Drag end or key step. Persists only a draft that differs from what
   * renders now, so a click without movement at a shell-clamped width never
   * overwrites a wider stored preference.
   */
  commit(): void {
    const draft = this.draft();
    this.draft.set(null);
    if (draft === null) return;
    const rendered = inspectorDockWidth(
      this.widthStore.preference(),
      this.shell.shellWidth(),
    );
    if (Math.round(draft) === rendered) return;
    this.widthStore.commit(draft);
  }

  /** Double-click: forget the preference, back to the shell's default. */
  reset(): void {
    this.draft.set(null);
    this.widthStore.reset();
  }

  /**
   * Toggle from the Stats tab. `tabHost` is the element around the tab's
   * button; the button becomes the opener, so closing returns focus to it.
   */
  toggleFromTab(tabHost: HTMLElement | null): void {
    this.shell.toggle(tabHost?.querySelector<HTMLElement>('button') ?? null);
  }
}
