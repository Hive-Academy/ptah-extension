/**
 * NativeDrawerComponent - Modal slide-over panel with a native focus trap.
 *
 * The detail surface for card-driven views: a full-height sheet that slides in
 * from the trailing (or leading) edge over a dimming backdrop. Domain-free —
 * everything inside is projected.
 *
 * Follows the same control contract as the other `Native*` overlays: the
 * PARENT owns visibility (`isOpen`) and the drawer only ever *requests*
 * closure via {@link closed}. That keeps the open state in one place instead of
 * splitting it between the parent's signal and internal component state.
 *
 * Focus handling is native (no CDK `FocusTrap`, which conflicts with VS Code
 * webview sandboxing):
 * - the element focused before opening is remembered and restored on close
 * - focus moves into the panel on open (first focusable, else the panel)
 * - Tab / Shift+Tab cycle within the panel
 * - Escape requests closure
 * - a backdrop click requests closure
 *
 * Three projection slots: `[drawer-header]`, default (scrollable body) and
 * `[drawer-footer]` (pinned).
 *
 * @example
 * ```html
 * <ptah-native-drawer
 *   [isOpen]="selected() !== null"
 *   ariaLabel="Skill details"
 *   (closed)="selected.set(null)"
 * >
 *   <h2 drawer-header>deep-research</h2>
 *   <p>Body…</p>
 *   <div drawer-footer><button (click)="selected.set(null)">Close</button></div>
 * </ptah-native-drawer>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/** Edge the drawer slides in from. */
export type NativeDrawerSide = 'right' | 'left';

/** Everything that can receive focus inside the panel, in DOM order. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

@Component({
  selector: 'ptah-native-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-50 flex" data-testid="native-drawer-root">
        <div
          class="ptah-drawer-backdrop absolute inset-0 bg-black/50"
          data-testid="native-drawer-backdrop"
          aria-hidden="true"
          (click)="onBackdropClick()"
        ></div>

        <div
          #panel
          class="ptah-drawer-panel relative flex h-full flex-col border-base-300 bg-base-100 shadow-2xl"
          [class]="panelClasses()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="ariaLabel()"
          tabindex="-1"
          data-testid="native-drawer-panel"
          (keydown)="onPanelKeydown($event)"
        >
          <div
            class="flex flex-shrink-0 items-start gap-2 border-b border-base-300 px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <ng-content select="[drawer-header]" />
            </div>
            @if (showCloseButton()) {
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-square -mr-1 flex-shrink-0"
                data-testid="native-drawer-close"
                aria-label="Close panel"
                (click)="requestClose()"
              >
                <span aria-hidden="true" class="text-base leading-none">×</span>
              </button>
            }
          </div>

          <div
            class="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            data-testid="native-drawer-body"
          >
            <ng-content />
          </div>

          <div class="flex-shrink-0 empty:hidden">
            <ng-content select="[drawer-footer]" />
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      @keyframes ptah-drawer-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes ptah-drawer-slide-in-right {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      @keyframes ptah-drawer-slide-in-left {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(0);
        }
      }

      .ptah-drawer-backdrop {
        animation: ptah-drawer-fade-in 150ms ease-out;
      }

      .ptah-drawer-panel {
        animation: ptah-drawer-slide-in-right 180ms ease-out;
      }

      .ptah-drawer-panel-left {
        animation-name: ptah-drawer-slide-in-left;
      }

      @media (prefers-reduced-motion: reduce) {
        .ptah-drawer-backdrop,
        .ptah-drawer-panel {
          animation: none;
        }
      }
    `,
  ],
})
export class NativeDrawerComponent implements OnDestroy {
  /** Whether the drawer is rendered. Owned by the parent. */
  readonly isOpen = input.required<boolean>();

  /** Edge to slide in from. @default 'right' */
  readonly side = input<NativeDrawerSide>('right');

  /**
   * Tailwind width classes for the panel. Overridable because the right width
   * is a per-surface decision (a log drawer is wider than a settings drawer).
   */
  readonly widthClass = input<string>('w-full max-w-2xl');

  /** Accessible name of the dialog. */
  readonly ariaLabel = input<string>('Details');

  /** Render the built-in header close button. @default true */
  readonly showCloseButton = input<boolean>(true);

  /** Escape requests closure. @default true */
  readonly closeOnEscape = input<boolean>(true);

  /** A backdrop click requests closure. @default true */
  readonly closeOnBackdrop = input<boolean>(true);

  /** Emitted once focus has moved into the panel. */
  readonly opened = output<void>();

  /**
   * The drawer is asking to be closed (Escape, backdrop, close button). The
   * parent must flip `isOpen` — the drawer never closes itself.
   */
  readonly closed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Element focused before the drawer opened; focus returns here on close. */
  private previousActiveElement: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.previousActiveElement =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        // The panel is created by the `@if` in this same change detection
        // pass, so defer the focus move until it exists in the DOM.
        queueMicrotask(() => this.focusPanel());
      } else {
        this.restoreFocus();
      }
    });
  }

  protected panelClasses(): string {
    const width = this.widthClass();
    return this.side() === 'left'
      ? `ptah-drawer-panel-left mr-auto border-r ${width}`
      : `ml-auto border-l ${width}`;
  }

  protected onBackdropClick(): void {
    if (!this.closeOnBackdrop()) return;
    this.closed.emit();
  }

  protected requestClose(): void {
    this.closed.emit();
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!this.closeOnEscape()) return;
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
      return;
    }

    if (event.key === 'Tab') {
      this.trapTab(event);
    }
  }

  private focusPanel(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusables = this.focusableElements(panel);
    (focusables[0] ?? panel).focus();
    this.opened.emit();
  }

  private trapTab(event: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusables = this.focusableElements(panel);
    if (focusables.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusableElements(panel: HTMLElement): HTMLElement[] {
    return Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('hidden') && el.tabIndex !== -1);
  }

  private restoreFocus(): void {
    if (this.previousActiveElement?.isConnected) {
      this.previousActiveElement.focus();
    }
    this.previousActiveElement = null;
  }

  ngOnDestroy(): void {
    this.restoreFocus();
  }
}
