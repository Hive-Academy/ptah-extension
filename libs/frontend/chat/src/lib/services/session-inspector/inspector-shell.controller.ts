import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  Injector,
  type Signal,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabViewMode } from '@ptah-extension/chat-types';
import { sessionWorkflowKind } from '../../tokens/session-workflow-addons.token';
import { InspectorOpenStateService } from './inspector-open-state.service';
import { SessionInspectorStore } from './session-inspector.store';

/** Width band of the inspector host shell. */
export type InspectorBand = 'docked' | 'sheet' | 'full-sheet';

/** Shell width (px) from which the inspector docks beside the main column. */
export const INSPECTOR_DOCKED_MIN_WIDTH = 960;
/** Shell width (px) below which the overlay sheet takes the full width. */
export const INSPECTOR_SHEET_MIN_WIDTH = 640;

/** Narrowest docked inspector width (px); matches the Git dock `min-w-[300px]`. */
export const INSPECTOR_MIN_WIDTH = 300;
/** Widest docked inspector width (px). */
export const INSPECTOR_MAX_WIDTH = 560;
/** Width (px) the main column keeps beside the docked inspector (960 - 336). */
export const INSPECTOR_MAIN_MIN_WIDTH = 624;
/** Shell width (px) from which the default docked width is the large tier. */
export const INSPECTOR_LARGE_SHELL_MIN_WIDTH = 1100;
/** Shell width (px) from which the default docked width is the wide tier. */
export const INSPECTOR_WIDE_SHELL_MIN_WIDTH = 1500;
/** Default docked width (px) below `INSPECTOR_LARGE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_DEFAULT_WIDTH = 336;
/** Default docked width (px) from `INSPECTOR_LARGE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_LARGE_DEFAULT_WIDTH = 400;
/** Default docked width (px) from `INSPECTOR_WIDE_SHELL_MIN_WIDTH`. */
export const INSPECTOR_WIDE_DEFAULT_WIDTH = 448;

/**
 * Attribute the inspector's `Close session details` button carries, so the
 * controller can focus it when the sheet opens.
 */
export const INSPECTOR_CLOSE_ATTR = 'data-inspector-close';

export const SHOW_SESSION_DETAILS_LABEL = 'Show session details';
export const HIDE_SESSION_DETAILS_LABEL = 'Hide session details';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The band of a shell `width` px wide. */
export function inspectorBandFor(width: number): InspectorBand {
  if (width >= INSPECTOR_DOCKED_MIN_WIDTH) return 'docked';
  if (width >= INSPECTOR_SHEET_MIN_WIDTH) return 'sheet';
  return 'full-sheet';
}

/**
 * Widest docked inspector for a shell `shellWidth` px wide: the main column
 * keeps `INSPECTOR_MAIN_MIN_WIDTH`, within [MIN, MAX]. Whole px, rounded
 * down, so a subpixel shell never takes the main column below its floor. An
 * unmeasured shell (0 or non-finite) allows `INSPECTOR_MAX_WIDTH`.
 */
export function inspectorMaxWidthFor(shellWidth: number): number {
  if (!(shellWidth > 0) || !Number.isFinite(shellWidth)) {
    return INSPECTOR_MAX_WIDTH;
  }
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    Math.min(
      INSPECTOR_MAX_WIDTH,
      Math.floor(shellWidth - INSPECTOR_MAIN_MIN_WIDTH),
    ),
  );
}

/**
 * Default docked width for a shell `shellWidth` px wide. An unmeasured shell
 * (0 or non-finite) gets the narrow tier.
 */
export function inspectorDefaultWidthFor(shellWidth: number): number {
  if (!Number.isFinite(shellWidth)) return INSPECTOR_DEFAULT_WIDTH;
  if (shellWidth < INSPECTOR_LARGE_SHELL_MIN_WIDTH) {
    return INSPECTOR_DEFAULT_WIDTH;
  }
  if (shellWidth < INSPECTOR_WIDE_SHELL_MIN_WIDTH) {
    return INSPECTOR_LARGE_DEFAULT_WIDTH;
  }
  return INSPECTOR_WIDE_DEFAULT_WIDTH;
}

/**
 * Rendered docked width: `preference` (else the shell's default) rounded and
 * clamped to [MIN, `inspectorMaxWidthFor(shellWidth)`]. A non-finite
 * preference falls back to the default. The clamp is for rendering only and
 * is never written back to the stored preference.
 */
export function inspectorDockWidth(
  preference: number | null,
  shellWidth: number,
): number {
  const wanted =
    preference !== null && Number.isFinite(preference)
      ? preference
      : inspectorDefaultWidthFor(shellWidth);
  // Round first: the integer max then bounds the rendered width.
  const max = inspectorMaxWidthFor(shellWidth);
  return Math.min(max, Math.max(INSPECTOR_MIN_WIDTH, Math.round(wanted)));
}

/** The tab facts the open rule reads. */
export interface InspectorTabContext {
  readonly tabId: string;
  readonly mode: TabViewMode;
  /** `true` for a workflow tab (`sessionWorkflowKind`), else `null`. */
  readonly initialOpen: boolean | null;
}

function sameContext(
  a: InspectorTabContext | null,
  b: InspectorTabContext | null,
): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.tabId === b.tabId &&
      a.mode === b.mode &&
      a.initialOpen === b.initialOpen)
  );
}

/** Connected and rendered (`display: none` ancestors give no offsetParent). */
function isVisible(element: HTMLElement | null): element is HTMLElement {
  return (
    element !== null && element.isConnected && element.offsetParent !== null
  );
}

/**
 * Open state, width band, modal sheet and focus routine of one inspector
 * host. Provided per host component (`ChatViewComponent`, the Rail board),
 * never in root: each host has its own shell and its own sheet.
 *
 * Rules: docked (shell >= 960 px) open = the per-tab docked choice, else the
 * default; overlay (< 960 px) the sheet is closed on load, on tab switch and
 * on resize into the band, opens only by `toggle()`, and never writes the
 * docked choice. Resizing overlay -> docked with the sheet open keeps the
 * inspector open by writing the docked choice.
 */
@Injectable()
export class InspectorShellController {
  private readonly tabManager = inject(TabManagerService);
  private readonly openState = inject(InspectorOpenStateService);
  private readonly store = inject(SessionInspectorStore);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  private readonly tabIdSource = signal<() => string | null>(() => null);
  private readonly bandState = signal<InspectorBand>('docked');
  private readonly sheetOpen = signal(false);
  private readonly shellWidthState = signal(0);

  private observer: ResizeObserver | null = null;
  private reservedWidth = 0;
  private shell: HTMLElement | null = null;
  private opener: () => HTMLElement | null = () => null;
  private title: () => HTMLElement | null = () => null;
  private rememberedOpener: HTMLElement | null = null;
  private pendingCloseFocus = false;
  private destroyed = false;

  /** `docked` >= 960 px, `sheet` 640-959 px, `full-sheet` < 640 px. */
  readonly band = this.bandState.asReadonly();

  /**
   * Last measured shell width (px) less the `reservedWidth` given to
   * `attach`; 0 until the shell is measured.
   */
  readonly shellWidth: Signal<number> = this.shellWidthState.asReadonly();

  /** The bound tab, or `null` when there is none or it no longer exists. */
  readonly tab = computed<InspectorTabContext | null>(
    () => {
      const tabId = this.tabIdSource()();
      if (!tabId) return null;
      const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!tab) return null;
      return {
        tabId,
        mode: tab.viewMode ?? 'full',
        initialOpen: sessionWorkflowKind(tab) !== null ? true : null,
      };
    },
    { equal: sameContext },
  );

  readonly isOpen = computed(() => {
    const tab = this.tab();
    if (!tab) return false;
    return this.band() === 'docked'
      ? this.openState.dockedOpen(tab.tabId, tab.mode, tab.initialOpen)
      : this.sheetOpen();
  });

  /** The overlay sheet is open: dialog semantics, main column inert. */
  readonly isModal = computed(
    () => this.band() !== 'docked' && this.sheetOpen() && this.tab() !== null,
  );

  /** Bind to the main column's `[inert]` attribute. */
  readonly mainInert = this.isModal;

  /** Toggle cue: `need` before `sel`; always `null` while open. */
  readonly showDot = computed<'need' | 'sel' | null>(() => {
    if (this.isOpen()) return null;
    const tab = this.tab();
    if (!tab) return null;
    if (this.store.modelFor(tab.tabId)().needsYouCount > 0) return 'need';
    return tab.initialOpen === true ? 'sel' : null;
  });

  /** Depends on the open state only, never on the dot. */
  readonly toggleLabel = computed(() =>
    this.isOpen() ? HIDE_SESSION_DETAILS_LABEL : SHOW_SESSION_DETAILS_LABEL,
  );

  constructor() {
    let previousTabId: string | null | undefined;
    effect(() => {
      const tabId = this.tabIdSource()();
      if (previousTabId !== undefined && tabId !== previousTabId) {
        untracked(() => this.onTabChanged());
      }
      previousTabId = tabId;
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.observer?.disconnect();
      this.observer = null;
      this.shell = null;
      this.rememberedOpener = null;
      this.opener = () => null;
      this.title = () => null;
    });
  }

  /**
   * Bind the tab whose inspector this host shows. `tabId` is read reactively;
   * a change of id closes the sheet (the host may also call `onTabChanged`).
   */
  bindTab(tabId: () => string | null): void {
    this.tabIdSource.set(tabId);
  }

  /**
   * Observe `shell` for the width band. `opener` is the header toggle and
   * `title` the session-title `h1[tabindex=-1]`, the focus fallbacks of
   * `closeInsp`. `reservedWidth` px of the shell belong to neither the main
   * column nor the inspector (ChatView's Stats tab) and never count toward
   * the band or the dock maximum. Re-attaching moves the one observer to the
   * new shell.
   */
  attach(
    shell: HTMLElement,
    opener: () => HTMLElement | null,
    title: () => HTMLElement | null,
    reservedWidth = 0,
  ): void {
    if (this.destroyed) return;
    this.shell = shell;
    this.opener = opener;
    this.title = title;
    this.reservedWidth = reservedWidth;
    if (typeof ResizeObserver === 'undefined') {
      const width = shell.getBoundingClientRect().width - reservedWidth;
      if (width > 0) this.shellWidthState.set(width);
      this.applyBand('docked');
      return;
    }
    this.applyWidth(shell.getBoundingClientRect().width);
    this.observer ??= new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) this.applyWidth(entry.contentRect.width);
    });
    this.observer.disconnect();
    this.observer.observe(shell);
  }

  /**
   * Open or close the inspector. `opener` is the control the user activated
   * (e.g. the Stats tab); `closeInsp('opener')` returns focus to it. Without
   * one, the attached header toggle (then the focused element) is the opener.
   */
  toggle(opener: HTMLElement | null = null): void {
    const tab = this.tab();
    if (!tab) return;
    if (this.band() === 'docked') {
      const open = !this.isOpen();
      // Closing through the toggle keeps focus on the activated control.
      this.rememberedOpener = open ? opener : null;
      this.openState.setDocked(tab.tabId, tab.mode, open);
      return;
    }
    if (this.sheetOpen()) {
      this.closeInsp('opener');
      return;
    }
    const active = this.document.activeElement;
    this.rememberedOpener =
      opener ??
      this.opener() ??
      (active instanceof HTMLElement ? active : null);
    this.sheetOpen.set(true);
    this.pendingCloseFocus = true;
    afterNextRender(() => this.focusCloseButton(), {
      injector: this.injector,
    });
  }

  /**
   * The one close routine. Docked: writes the closed docked choice. Overlay:
   * closes the sheet, never touching the docked choice. Focus then moves to
   * `target`, else the opener when connected and visible, else the session
   * title; never to `body`.
   */
  closeInsp(target?: HTMLElement | 'opener'): void {
    const tab = this.tab();
    if (this.band() === 'docked') {
      if (!tab) return;
      this.openState.setDocked(tab.tabId, tab.mode, false);
    } else {
      if (!this.sheetOpen()) return;
      this.sheetOpen.set(false);
    }
    this.pendingCloseFocus = false;
    this.restoreFocus(target instanceof HTMLElement ? target : null, false);
  }

  /** Tab or session switch: a modal sheet closes; the docked choice is per tab. */
  onTabChanged(): void {
    if (this.isModal()) {
      this.closeInsp();
      return;
    }
    this.sheetOpen.set(false);
    this.pendingCloseFocus = false;
  }

  /**
   * Called by the inspector when its close button renders (late mount from a
   * deferred chunk): focuses it if the sheet just opened.
   */
  closeReady(button: HTMLElement): void {
    if (!this.pendingCloseFocus || !this.isModal()) return;
    this.pendingCloseFocus = false;
    button.focus();
  }

  /**
   * Keydown on the sheet: Tab / Shift+Tab wrap inside it; Esc closes it. An
   * open request panel handles its own Esc first and stops propagation.
   */
  onSheetKeydown(event: KeyboardEvent): void {
    if (!this.isModal()) return;
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeInsp('opener');
      return;
    }
    if (event.key !== 'Tab') return;
    const sheet = event.currentTarget;
    if (!(sheet instanceof HTMLElement)) return;
    const items = Array.from(
      sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((item) => isVisible(item) && item.closest('[inert]') === null);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.document.activeElement;
    const inside = active instanceof Node && sheet.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  private applyWidth(measured: number): void {
    // A detached or hidden shell measures 0: keep the last real band.
    if (!(measured > 0)) return;
    const width = Math.max(0, measured - this.reservedWidth);
    this.shellWidthState.set(width);
    this.applyBand(inspectorBandFor(width));
  }

  private applyBand(next: InspectorBand): void {
    const previous = untracked(this.bandState);
    if (next === previous) return;
    this.bandState.set(next);
    if (previous === 'docked') {
      // Docked -> overlay: the sheet starts closed and the docked choice is
      // kept. Focus moves only if it was inside the docked inspector.
      this.sheetOpen.set(false);
      this.pendingCloseFocus = false;
      this.restoreFocus(null, true);
      return;
    }
    if (next === 'docked' && untracked(this.sheetOpen)) {
      // Overlay -> docked with the sheet open: the inspector stays, focus
      // stays where it is.
      const tab = untracked(this.tab);
      if (tab) this.openState.setDocked(tab.tabId, tab.mode, true);
      this.sheetOpen.set(false);
      this.pendingCloseFocus = false;
    }
  }

  private focusCloseButton(): void {
    if (this.destroyed || !this.pendingCloseFocus || !this.isModal()) return;
    const button = this.shell?.querySelector<HTMLElement>(
      `[${INSPECTOR_CLOSE_ATTR}]`,
    );
    if (!button) return; // late mount: `closeReady` focuses it
    this.pendingCloseFocus = false;
    button.focus();
  }

  /** After the next render (inert removed), focus the first live candidate. */
  private restoreFocus(target: HTMLElement | null, onlyIfLost: boolean): void {
    const opener = this.rememberedOpener;
    this.rememberedOpener = null;
    afterNextRender(
      () => {
        if (this.destroyed) return;
        if (onlyIfLost && !this.focusLost()) return;
        const candidate = [target, opener, this.opener()].find(isVisible);
        if (candidate) {
          candidate.focus();
          return;
        }
        const title = this.title();
        if (title?.isConnected) title.focus();
      },
      { injector: this.injector },
    );
  }

  private focusLost(): boolean {
    const active = this.document.activeElement;
    return (
      active === null || active === this.document.body || !active.isConnected
    );
  }
}
