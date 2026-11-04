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
  signal,
  viewChild,
} from '@angular/core';
import {
  ArrowLeft,
  ChevronDown,
  LucideAngularModule,
  Play,
} from 'lucide-angular';
import {
  SPEC_ROOT,
  TASK_STATUSES,
  type TaskSpecDetail,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TASK_STATUS_LABELS, isStartableStatus } from '../../task-presentation';
import { TASK_STATUS_INK, deriveTaskStage } from '../../task-stage';
import type { TaskStartRequest } from '../../types/task-agent.types';
import type { TaskStatusChange } from '../board/task-card.component';

/** Makes each header's `aria-controls` target unique on the page. */
let nextMenuId = 0;

/**
 * The full-page task detail's header (design-spec "Task detail"): a
 * "← Board" back control, the `.ptah / specs / <folder>` breadcrumb, the title
 * with status, type and stage badges, the folder path, and the two task
 * actions on the right — Start in chat and Change status.
 *
 * Presentational: it emits the SAME payloads the Kanban card emits
 * ({@link TaskStartRequest}, {@link TaskStatusChange}), so the host routes
 * them through the paths the board already uses. Start is offered only where
 * the card offers it (`isStartableStatus`); isolation and agent targeting stay
 * on the card and the list row.
 *
 * Focus moves to Back when the page opens, because the card that opened it is
 * hidden with the board.
 *
 * Change status is a menu button: the trigger is the only Tab stop, Enter,
 * Space or ArrowDown opens the menu onto its first item, the arrow keys move
 * between items, and Escape closes it and gives focus back to the trigger.
 */
@Component({
  selector: 'ptah-task-detail-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <header
      class="flex flex-col gap-2 border-b border-surface-border bg-surface-1 px-5 py-4"
      data-testid="task-detail-header"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          #backButton
          type="button"
          class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          aria-label="Back to board"
          data-testid="task-detail-back"
          (click)="back.emit()"
        >
          <lucide-angular
            [img]="ArrowLeftIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Board
        </button>
        <nav
          class="min-w-0 flex-1 truncate font-mono text-xs text-base-content-muted"
          aria-label="Task folder location"
          data-testid="task-detail-breadcrumb"
        >
          .ptah / specs / {{ detail()?.folderName ?? folderHint() }}
        </nav>

        @if (detail(); as task) {
          <div class="ml-auto flex flex-wrap items-center gap-2">
            @if (startable()) {
              <button
                type="button"
                class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="task-detail-start"
                [disabled]="starting()"
                [attr.aria-label]="'Start task ' + task.id + ' in chat'"
                (click)="onStart(task)"
              >
                <lucide-angular
                  [img]="PlayIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Start in chat
              </button>
            }
            <!-- One Tab stop: the trigger. The menu is display:none while
                 closed, and its items are reached with the arrow keys. -->
            <div class="relative" (focusout)="onMenuFocusOut($event)">
              <button
                #statusTrigger
                type="button"
                class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                aria-haspopup="menu"
                [attr.aria-expanded]="menuVisible()"
                [attr.aria-controls]="menuId"
                data-testid="task-detail-status-trigger"
                [disabled]="busy()"
                (click)="toggleMenu()"
                (keydown.arrowdown)="openMenu('first', $event)"
                (keydown.arrowup)="openMenu('last', $event)"
              >
                Change status
                <lucide-angular
                  [img]="ChevronDownIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
              </button>
              <ul
                #statusMenu
                role="menu"
                [id]="menuId"
                class="menu menu-sm absolute right-0 top-full z-30 mt-1 w-44 rounded-box border border-surface-border bg-surface-2 p-1 shadow-[var(--elev-shadow-raised)]"
                [class.hidden]="!menuVisible()"
                aria-label="Change status"
                data-testid="task-detail-status-menu"
              >
                @for (option of statusOptions; track option) {
                  <li role="none">
                    <!-- The shared ring, drawn inward (-outline-offset-2, as
                         the task-list row does): a positive offset would be
                         clipped by the menu's p-1 padding. -->
                    <button
                      type="button"
                      role="menuitem"
                      tabindex="-1"
                      class="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content"
                      [class.active]="option === task.status"
                      [attr.aria-current]="
                        option === task.status ? 'true' : null
                      "
                      [attr.data-status]="option"
                      (click)="onStatusPick(task, option)"
                      (keydown)="onMenuKeydown($event)"
                    >
                      {{ statusLabels[option] }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          </div>
        }
      </div>

      @if (detail(); as task) {
        <div class="flex flex-wrap items-center gap-2">
          <h2
            class="min-w-0 text-xl font-semibold leading-snug text-base-content"
          >
            {{ task.title }}
          </h2>
          <span
            class="badge badge-ghost badge-sm"
            [class]="statusInk()"
            data-testid="task-detail-status"
            >{{ statusLabels[task.status] }}</span
          >
          @if (task.type) {
            <span class="badge badge-ghost badge-sm text-base-content">{{
              task.type
            }}</span>
          }
          @if (stage(); as stage) {
            <span
              class="badge badge-ghost badge-sm text-base-content"
              data-testid="task-detail-stage"
              >{{ stage }}</span
            >
          }
        </div>
        <span
          class="truncate font-mono text-xs text-base-content-muted"
          data-testid="task-detail-path"
          [title]="specRoot + '/' + task.folderName + '/'"
          >{{ specRoot }}/{{ task.folderName }}/</span
        >
      }
    </header>
  `,
})
export class TaskDetailHeaderComponent {
  /** `null` while the task loads or when it could not be found. */
  public readonly detail = input.required<TaskSpecDetail | null>();
  /** Shown in the breadcrumb until the detail arrives. */
  public readonly folderHint = input('');
  /** A carrier write is outstanding; the status menu waits for it. */
  public readonly busy = input(false);
  /** This task is launching; Start waits for it. */
  public readonly starting = input(false);

  public readonly back = output<void>();
  public readonly startTask = output<TaskStartRequest>();
  public readonly statusChange = output<TaskStatusChange>();

  private readonly backButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('backButton');
  private readonly statusTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('statusTrigger');
  private readonly statusMenu =
    viewChild<ElementRef<HTMLUListElement>>('statusMenu');
  private readonly injector = inject(Injector);

  /** The status menu was opened; it shows only while no write is running. */
  private readonly menuOpen = signal(false);
  protected readonly menuVisible = computed(
    () => this.menuOpen() && !this.busy() && this.detail() !== null,
  );
  protected readonly menuId = `ptah-task-detail-status-menu-${nextMenuId++}`;

  protected readonly specRoot = SPEC_ROOT;
  protected readonly statusOptions: readonly TaskStatus[] = TASK_STATUSES;
  protected readonly statusLabels = TASK_STATUS_LABELS;

  protected readonly startable = computed(() => {
    const task = this.detail();
    return task !== null && isStartableStatus(task.status);
  });
  protected readonly statusInk = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_INK[task.status] : '';
  });
  protected readonly stage = computed(() =>
    deriveTaskStage(this.detail()?.artifacts ?? []),
  );

  public constructor() {
    // `focusVisible: true`: the page usually opens from a mouse click on a
    // card, and Chromium then withholds :focus-visible from a programmatic
    // focus, so the moved focus would be invisible. Focus moved away from
    // where the user acted, so its ring is always shown.
    afterNextRender(() =>
      this.backButton().nativeElement.focus({ focusVisible: true }),
    );
    // A status write, or the detail going away, closes the menu for good:
    // it must not reappear on its own when the write finishes.
    effect(() => {
      if (this.busy() || this.detail() === null) this.menuOpen.set(false);
    });
  }

  protected onStart(task: TaskSpecDetail): void {
    this.startTask.emit({ taskId: task.id, isolate: false });
  }

  protected onStatusPick(task: TaskSpecDetail, status: TaskStatus): void {
    this.closeMenu(true);
    if (status === task.status) return;
    this.statusChange.emit({ taskId: task.id, status });
  }

  /** Enter, Space and a mouse click on the trigger all arrive here. */
  protected toggleMenu(): void {
    if (this.menuVisible()) {
      this.closeMenu(false);
      return;
    }
    this.openMenu('first');
  }

  /** Opens the menu and moves focus to its first or last item. */
  protected openMenu(target: 'first' | 'last', event?: Event): void {
    event?.preventDefault();
    if (this.busy()) return;
    this.menuOpen.set(true);
    // The menu is display:none until the next render, and a hidden element
    // cannot take focus.
    afterNextRender(
      () => {
        const items = this.menuItems();
        items[target === 'first' ? 0 : items.length - 1]?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Arrow keys, Home and End move between items; Tab leaves and closes. */
  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === event.target);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Tab':
        this.closeMenu(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  /**
   * Escape closes a visible menu and returns focus to its trigger. Otherwise
   * it bubbles, so the tasks view can close the detail.
   */
  protected onEscape(event: Event): void {
    if (!this.menuVisible()) return;
    event.stopPropagation();
    this.closeMenu(true);
  }

  /** Focus leaving the trigger and menu (a click elsewhere, Tab) closes it. */
  protected onMenuFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    const container = event.currentTarget;
    if (
      next instanceof Node &&
      container instanceof Node &&
      container.contains(next)
    ) {
      return;
    }
    this.closeMenu(false);
  }

  private closeMenu(refocus: boolean): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (refocus) this.statusTrigger()?.nativeElement.focus();
  }

  private menuItems(): HTMLButtonElement[] {
    const menu = this.statusMenu()?.nativeElement;
    return menu
      ? Array.from(
          menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        )
      : [];
  }

  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly PlayIcon = Play;
}
