import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  type OutputEmitterRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { Ellipsis, LucideAngularModule } from 'lucide-angular';

/**
 * A split pane's floating `⋯` control: the pane actions only (Swap panes,
 * Close pane, Close split). Session actions live in the session card menu.
 */
@Component({
  selector: 'ptah-canvas-focus-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointerDown($event)' },
  template: `
    <div role="group" aria-label="Pane controls"
      class="relative flex items-center"
      (keydown.escape)="escape($event)">
      <button
        type="button"
        class="btn btn-ghost btn-xs size-7 btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        data-header-menu
        aria-label="Pane actions"
        title="Pane actions"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        (click)="toggleMenu()"
      >
        <lucide-angular [img]="EllipsisIcon" class="size-4" aria-hidden="true" />
      </button>
      @if (menuOpen()) {
        <div
          role="menu"
          aria-label="Pane actions"
          class="absolute right-0 top-9 z-20 flex w-max min-w-36 flex-col gap-0.5 whitespace-nowrap rounded-lg border border-base-content/10 bg-base-200 p-2 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-action="swap-panes"
            class="btn btn-ghost btn-sm flex-nowrap justify-start whitespace-nowrap font-normal"
            (click)="choose(swapPanesRequested)"
          >
            Swap panes
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="close-pane"
            class="btn btn-ghost btn-sm flex-nowrap justify-start whitespace-nowrap font-normal"
            (click)="choose(closePaneRequested)"
          >
            Close pane
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="close-split"
            class="btn btn-ghost btn-sm flex-nowrap justify-start whitespace-nowrap font-normal"
            (click)="choose(closeSplitRequested)"
          >
            Close split
          </button>
        </div>
      }
    </div>
  `,
})
export class CanvasFocusHeaderComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly EllipsisIcon = Ellipsis;
  readonly closeSplitRequested = output<void>();
  readonly closePaneRequested = output<void>();
  readonly swapPanesRequested = output<void>();
  readonly menuOpen = signal(false);

  /**
   * Escape anywhere in the group (the still-focused trigger or a menu item)
   * closes an open menu first and is consumed there, so no pane or board
   * handler sees it. With the menu closed it passes through.
   */
  escape(event: Event): void {
    if (!this.menuOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.set(false);
    this.focusTrigger();
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** A pointer press outside the controls closes the menu; focus stays where the press put it. */
  onDocumentPointerDown(event: Event): void {
    if (!this.menuOpen()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.menuOpen.set(false);
  }

  /**
   * Closes the menu and returns focus to its trigger before emitting, so a
   * board that then removes this pane finds focus to repair.
   */
  choose(action: OutputEmitterRef<void>): void {
    this.menuOpen.set(false);
    this.focusTrigger();
    action.emit();
  }

  private focusTrigger(): void {
    this.host.nativeElement
      .querySelector<HTMLButtonElement>('[data-header-menu]')
      ?.focus();
  }
}
