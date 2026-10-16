import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { BackgroundAgentStripEntry } from '@ptah-extension/chat-ui';
import {
  ArrowDownToLine,
  Ellipsis,
  Eye,
  LucideAngularModule,
  MessageSquareText,
  Square,
  type LucideIconData,
} from 'lucide-angular';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';

export type AgentTrayAction = 'transcript' | 'steer' | 'background' | 'stop';

interface MenuItem {
  readonly id: AgentTrayAction;
  readonly label: string;
  readonly icon: LucideIconData;
}

/** The actions a tray entry offers, in menu order. */
function menuItemsFor(entry: BackgroundAgentStripEntry): readonly MenuItem[] {
  const items: MenuItem[] = [];
  if (entry.canViewTranscript)
    items.push({ id: 'transcript', label: 'View transcript', icon: Eye });
  if (entry.steerable)
    items.push({ id: 'steer', label: 'Steer', icon: MessageSquareText });
  if (entry.canBackground)
    items.push({
      id: 'background',
      label: 'Send to background',
      icon: ArrowDownToLine,
    });
  if (entry.stoppable) items.push({ id: 'stop', label: 'Stop', icon: Square });
  return items;
}

/** Whether a tray entry has any action, i.e. whether its row shows the menu. */
export function trayEntryHasAction(entry: BackgroundAgentStripEntry): boolean {
  return menuItemsFor(entry).length > 0;
}

let nextMenuId = 0;

/**
 * The 28 x 28 `ellipsis` actions menu of an AGENTS row (design D3.6): the
 * tray actions the agent offers, as `menuitem`s by flag. Up / Down / Home /
 * End move focus, `Esc` closes and returns focus to the trigger, focus
 * leaving the menu closes it. The section owns `open`, so one menu at most is
 * open per section.
 */
@Component({
  selector: 'ptah-inspector-agent-actions-menu',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-flex shrink-0',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      class="inline-flex size-7 items-center justify-center rounded-md text-base-content-muted hover:bg-base-content/5 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? menuId : null"
      [attr.aria-label]="'Actions for ' + name()"
      (click)="openChange.emit(!open())"
      (keydown.arrowdown)="openFromKeyboard($event)"
    >
      <lucide-angular [img]="EllipsisIcon" class="size-4" aria-hidden="true" />
    </button>
    @if (open()) {
      <ul
        role="menu"
        [id]="menuId"
        [attr.aria-label]="'Actions for ' + name()"
        class="absolute right-0 top-full z-20 mt-1 min-w-[176px] rounded-md border border-surface-border bg-surface-1 py-1 shadow-lg"
        (keydown)="onMenuKeydown($event)"
      >
        @for (item of items(); track item.id) {
          <li role="none">
            <button
              #menuItem
              type="button"
              role="menuitem"
              tabindex="-1"
              class="flex h-8 w-full items-center gap-2 px-3 text-left text-xs hover:bg-base-content/5 focus-visible:bg-base-content/5 focus-visible:outline-none"
              (click)="select(item.id)"
            >
              <lucide-angular [img]="item.icon" class="size-3.5 shrink-0 text-base-content-muted" aria-hidden="true" />
              {{ item.label }}
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class InspectorAgentActionsMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly name = input.required<string>();
  readonly ctx = input.required<TrayAgentContext>();
  readonly open = input<boolean>(false);

  readonly openChange = output<boolean>();
  readonly action = output<AgentTrayAction>();

  protected readonly EllipsisIcon = Ellipsis;
  protected readonly menuId = `ptah-agent-menu-${++nextMenuId}`;
  protected readonly items = computed(() => menuItemsFor(this.ctx().entry));

  private readonly trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menuButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('menuItem');

  constructor() {
    // Opening moves focus to the first item once the menu renders.
    effect(() => {
      if (!this.open()) return;
      afterNextRender(() => this.focusItem(0), { injector: this.injector });
    });
  }

  protected openFromKeyboard(event: Event): void {
    event.preventDefault();
    if (!this.open()) this.openChange.emit(true);
    else this.focusItem(0);
  }

  protected select(id: AgentTrayAction): void {
    this.action.emit(id);
    this.closeToTrigger();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const buttons = this.menuButtons().map((ref) => ref.nativeElement);
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem(current < 0 ? 0 : (current + 1) % buttons.length);
        break;
      case 'ArrowUp':
        this.focusItem(
          current <= 0 ? buttons.length - 1 : current - 1,
        );
        break;
      case 'Home':
        this.focusItem(0);
        break;
      case 'End':
        this.focusItem(buttons.length - 1);
        break;
      case 'Escape':
        // Handled here so the inspector sheet does not also close.
        event.stopPropagation();
        this.closeToTrigger();
        break;
      case 'Tab':
        this.openChange.emit(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Focus that leaves the whole control (click-away, Tab) closes the menu. */
  protected onFocusOut(event: FocusEvent): void {
    if (!this.open()) return;
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    this.openChange.emit(false);
  }

  private closeToTrigger(): void {
    this.openChange.emit(false);
    this.trigger().nativeElement.focus();
  }

  private focusItem(index: number): void {
    this.menuButtons()[index]?.nativeElement.focus();
  }
}
