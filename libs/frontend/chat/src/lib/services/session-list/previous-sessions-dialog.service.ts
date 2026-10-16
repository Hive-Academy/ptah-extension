import {
  DOCUMENT,
  Injectable,
  Injector,
  afterNextRender,
  inject,
  signal,
  type AfterRenderRef,
} from '@angular/core';

/** Every control that opens the previous-sessions modal carries this attribute. */
const TRIGGER_SELECTOR = '[data-previous-sessions-trigger]';

export interface PreviousSessionsCloseOptions {
  /** `false` closes without moving focus (e.g. the shell left the chat view). */
  readonly restoreFocus?: boolean;
}

/**
 * Whether the previous-sessions modal is open, and where focus goes when it
 * closes (TASK_2026_679, design 4.3).
 *
 * `open()` records the focused element as the opener. `close()` returns focus
 * to it after the next render, once the state change that removes `inert`
 * from the content behind the modal has reached the DOM (R2). When the opener
 * is gone, inert or hidden, the first visible Previous sessions trigger takes
 * focus; with neither, focus is not moved.
 */
@Injectable({ providedIn: 'root' })
export class PreviousSessionsDialogService {
  private readonly document = inject(DOCUMENT);
  // Root injector: `afterNextRender` needs one outside an injection context.
  private readonly injector = inject(Injector);

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  private opener: HTMLElement | null = null;
  /** The single-shot focus restore scheduled by the last `close()`. */
  private pendingRestore: AfterRenderRef | null = null;

  /** Open the modal. A no-op when it is already open (the first opener is kept). */
  open(): void {
    if (this._isOpen()) return;
    // A reopen before the last close rendered must not have focus pulled out.
    this.cancelPendingRestore();
    this.opener = this.focusedElement();
    this._isOpen.set(true);
  }

  /**
   * Close the modal. Unless `restoreFocus` is `false`, focus returns to the
   * opener after the close renders. A no-op when the modal is closed.
   */
  close(options?: PreviousSessionsCloseOptions): void {
    if (!this._isOpen()) return;
    const opener = this.opener;
    this.opener = null;
    this._isOpen.set(false);
    if (options?.restoreFocus === false) return;
    this.cancelPendingRestore();
    this.pendingRestore = afterNextRender(
      () => {
        this.pendingRestore = null;
        this.restoreFocus(opener);
      },
      { injector: this.injector },
    );
  }

  private restoreFocus(opener: HTMLElement | null): void {
    const target =
      opener && this.canTakeFocus(opener) ? opener : this.firstVisibleTrigger();
    target?.focus();
  }

  private firstVisibleTrigger(): HTMLElement | null {
    const view = this.document.defaultView;
    if (!view) return null;
    for (const element of Array.from(
      this.document.querySelectorAll(TRIGGER_SELECTOR),
    )) {
      if (element instanceof view.HTMLElement && this.canTakeFocus(element)) {
        return element;
      }
    }
    return null;
  }

  /** Connected, enabled, outside any `[inert]` or `[hidden]` subtree, and rendered visible. */
  private canTakeFocus(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    if (element.matches(':disabled')) return false;
    if (element.closest('[inert], [hidden]')) return false;
    return this.isVisible(element);
  }

  private isVisible(element: HTMLElement): boolean {
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ visibilityProperty: true });
    }
    // Environments without checkVisibility (jsdom): walk the computed styles.
    const view = this.document.defaultView;
    for (
      let node: Element | null = element;
      node && view;
      node = node.parentElement
    ) {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    }
    return true;
  }

  /** The focused element, or null when nothing but the page itself has focus. */
  private focusedElement(): HTMLElement | null {
    const active = this.document.activeElement;
    const view = this.document.defaultView;
    if (!view || !(active instanceof view.HTMLElement)) return null;
    if (active === this.document.body) return null;
    return active;
  }

  private cancelPendingRestore(): void {
    this.pendingRestore?.destroy();
    this.pendingRestore = null;
  }
}
