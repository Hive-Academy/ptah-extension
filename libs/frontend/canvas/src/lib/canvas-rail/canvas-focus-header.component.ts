import {
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  type OutputEmitterRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { SendToMessagingComponent } from '@ptah-extension/chat';
import type { TabViewMode } from '@ptah-extension/chat-types';
import {
  Ellipsis,
  LucideAngularModule,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-angular';
import { FloatingUIService } from '@ptah-extension/ui';

@Component({
  selector: 'ptah-canvas-focus-header',
  standalone: true,
  imports: [
    SendToMessagingComponent,
    LucideAngularModule,
  ],
  providers: [FloatingUIService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointerDown($event)' },
  template: `
    <div role="group" aria-label="Session controls"
      class="relative flex items-center gap-1"
      [class.flex-col]="rail()"
      (keydown.escape)="escape($event)">
      @if (running() && !floating()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs size-7"
          data-stop
          aria-label="Stop session"
          title="Stop session"
          (click)="stop.emit()"
        >
          ■
        </button>
      }
      <button
        type="button"
        class="btn btn-ghost btn-xs size-7 btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        data-compact
        [attr.aria-label]="
          viewMode() === 'full'
            ? 'Switch to compact view'
            : 'Switch to full view'
        "
        [attr.title]="
          viewMode() === 'full'
            ? 'Switch to compact view'
            : 'Switch to full view'
        "
        (click)="toggleViewMode.emit()"
      >
        <lucide-angular
          [img]="viewMode() === 'full' ? Minimize2Icon : Maximize2Icon"
          class="size-4"
          aria-hidden="true"
        />
      </button>
      @if (hasMenu()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs size-7 btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-header-menu
          aria-label="More session actions"
          title="More session actions"
          aria-haspopup="menu"
          [attr.aria-expanded]="menuOpen()"
          (click)="toggleMenu()"
        >
          <lucide-angular
            [img]="EllipsisIcon"
            class="size-4"
            aria-hidden="true"
          />
        </button>
      }
      @if (menuOpen() && hasMenu()) {
        <!-- The rail scrolls, which would clip an absolute menu: there it is fixed and placed beside the rail. -->
        <div
          role="menu"
          aria-label="Session actions"
          class="flex flex-col gap-0.5 rounded-lg border border-base-content/10 bg-base-200 p-2 shadow-lg"
          [class.absolute]="!rail()"
          [class.right-10]="!rail()"
          [class.top-10]="!rail()"
          [class.z-20]="!rail()"
          [class.fixed]="rail()"
          [class.z-50]="rail()"
          [style.visibility]="rail() ? 'hidden' : null"
        >
          @if (sendToInMenu()) {
            <div role="menuitem">
              <ptah-send-to-messaging [tabId]="tabId()" />
            </div>
          }
          @if (splitDisplayed()) {
            <button
              type="button"
              role="menuitem"
              data-action="swap-panes"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(swapPanesRequested)"
            >
              Swap panes
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="close-pane"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(closePaneRequested)"
            >
              Close pane
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="close-split"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(closeSplitRequested)"
            >
              Close split
            </button>
          }
        </div>
      }
      <button
        type="button"
        class="btn btn-ghost btn-xs size-7 btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        aria-label="Close session"
        title="Close session"
        (click)="closeRequested.emit()"
      >
        <lucide-angular [img]="XIcon" class="size-4" aria-hidden="true" />
      </button>
    </div>
  `,
})
export class CanvasFocusHeaderComponent implements DoCheck {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tabId = input.required<string>();
  readonly rail = input(false);
  readonly floating = input(false);
  /** Rendered inside an expanded inspector that already shows Hand off beside the title. */
  readonly embedded = input(false);
  readonly Minimize2Icon = Minimize2;
  readonly Maximize2Icon = Maximize2;
  readonly EllipsisIcon = Ellipsis;
  readonly XIcon = X;
  readonly running = input(false);
  readonly viewMode = input<TabViewMode>('full');
  /** Two panes are shown: the menu offers the split actions. */
  readonly splitDisplayed = input(false);
  readonly stop = output<void>();
  readonly toggleViewMode = output<void>();
  readonly closeRequested = output<void>();
  readonly closeSplitRequested = output<void>();
  readonly closePaneRequested = output<void>();
  readonly swapPanesRequested = output<void>();
  readonly menuOpen = signal(false);
  /** The rail menu carries Hand off; the expanded inspector and split pane show it elsewhere. */
  readonly sendToInMenu = computed(() => !this.floating() && !this.embedded());
  /** `⋯` renders only when its menu has at least one action. */
  readonly hasMenu = computed(() => this.sendToInMenu() || this.splitDisplayed());
  private readonly floatingUI = inject(FloatingUIService);
  private readonly injector = inject(Injector);
  private wasRunning = false;

  ngDoCheck(): void {
    if (this.wasRunning && !this.running()) {
      const stop =
        this.host.nativeElement.querySelector<HTMLElement>('[data-stop]');
      if (stop && stop === stop.ownerDocument.activeElement)
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-compact]')
          ?.focus();
    }
    this.wasRunning = this.running();
  }

  /**
   * Escape anywhere in the header (the still-focused trigger, a menu item, or
   * another header control) closes an open menu first and is consumed there,
   * so no pane or board handler sees it. With the menu closed it passes through.
   */
  escape(event: Event): void {
    if (!this.menuOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    this.focusTrigger();
  }

  toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu();
      return;
    }
    this.menuOpen.set(true);
    if (!this.rail()) return;
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const trigger = root.querySelector<HTMLElement>('[data-header-menu]');
        const menu = root.querySelector<HTMLElement>('[role="menu"]');
        if (!this.menuOpen() || !trigger || !menu) return;
        void this.floatingUI.position(trigger, menu, {
          placement: 'left-start',
          offset: 4,
        });
      },
      { injector: this.injector },
    );
  }

  /** A pointer press outside the controls closes the menu; focus stays where the press put it. */
  onDocumentPointerDown(event: Event): void {
    if (!this.menuOpen()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.closeMenu();
  }

  /**
   * Closes the menu and returns focus to its trigger before emitting, so a
   * board that then removes this header finds focus to repair.
   */
  choose(action: OutputEmitterRef<void>): void {
    this.closeMenu();
    this.focusTrigger();
    action.emit();
  }

  private closeMenu(): void {
    this.menuOpen.set(false);
    this.floatingUI.cleanup();
  }

  private focusTrigger(): void {
    this.host.nativeElement
      .querySelector<HTMLButtonElement>('[data-header-menu]')
      ?.focus();
  }
}
