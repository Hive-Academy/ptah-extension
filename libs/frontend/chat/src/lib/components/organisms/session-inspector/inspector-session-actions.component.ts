import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { LoggingService } from '@ptah-extension/core';
import type { SessionId } from '@ptah-extension/shared';
import { LucideAngularModule, Ellipsis, FolderOpen, Pencil, Square } from 'lucide-angular';
import { ChatStore } from '../../../services/chat.store';
import { SessionOrganizerService } from '../../../services/session-list/session-organizer.service';
import { SessionRowActionsService } from '../../../services/session-list/session-row-actions.service';

type Action = 'rename' | 'organize' | 'stop';
interface SessionTarget { readonly id: SessionId; readonly title: string }

@Component({
  selector: 'ptah-inspector-session-actions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inspector-session-actions.component.html',
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class InspectorSessionActionsComponent {
  private readonly tabs = inject(TabManagerService);
  private readonly rowActions = inject(SessionRowActionsService);
  protected readonly organizer = inject(SessionOrganizerService);
  private readonly chat = inject(ChatStore);
  private readonly logger = inject(LoggingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly renameField = viewChild<ElementRef<HTMLInputElement>>('renameField');

  readonly tabId = input.required<string>();
  readonly running = input(false);
  protected readonly PencilIcon = Pencil;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly SquareIcon = Square;
  protected readonly EllipsisIcon = Ellipsis;
  protected readonly headerWidth = signal(Number.POSITIVE_INFINITY);
  protected readonly narrow = computed(() => this.headerWidth() < 320);
  protected readonly tab = computed(() => {
    this.tabs.tabs();
    return this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab ?? null;
  });
  protected readonly sessionId = computed(() => this.tab()?.claudeSessionId ?? null);
  protected readonly hasActions = computed(() => !!this.sessionId() || this.running());
  protected readonly moreOpen = signal(false);
  protected readonly renameOpen = signal(false);
  protected readonly renameDraft = signal('');
  protected readonly renameError = signal('');
  protected readonly renaming = signal(false);
  protected readonly announcement = signal('');
  private renameTarget: SessionTarget | null = null;
  private renameSequence = 0;

  constructor() {
    afterNextRender(() => {
      const header = this.host.nativeElement.closest('header');
      if (!header) return;
      const measure = () => {
        const width = header.getBoundingClientRect().width;
        this.headerWidth.set(width);
        if (width >= 320) this.moreOpen.set(false);
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(measure);
        observer.observe(header);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  protected toggleMore(): void {
    if (this.moreOpen()) this.closeMore();
    else this.openMore();
  }

  private openMore(last = false): void {
    this.moreOpen.set(true);
    afterNextRender(() => {
      const items = this.menuItems();
      items[last ? items.length - 1 : 0]?.focus();
    }, { injector: this.injector });
  }

  private menuItems(): HTMLButtonElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[data-inspector-menu-action]:not(:disabled)')];
  }

  protected closeMore(restoreFocus = true): void {
    this.moreOpen.set(false);
    if (restoreFocus) this.focusTrigger('more');
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.moreOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeMore();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!this.moreOpen()) {
      event.preventDefault();
      this.openMore(event.key === 'ArrowUp' || event.key === 'End');
      return;
    }
    const items = this.menuItems();
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(this.host.nativeElement.ownerDocument.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length
        : (current + items.length - 1) % items.length;
    items[next].focus();
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    if (this.moreOpen() && event.target instanceof Node && !this.host.nativeElement.contains(event.target))
      this.closeMore(false);
  }

  protected onFocusOut(event: FocusEvent): void {
    if (this.moreOpen() && event.relatedTarget instanceof Node && !this.host.nativeElement.contains(event.relatedTarget))
      this.closeMore(false);
  }

  protected onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelRename();
    } else if (event.key === 'Tab') {
      const form = event.currentTarget as HTMLFormElement;
      const controls = [...form.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && this.host.nativeElement.ownerDocument.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && this.host.nativeElement.ownerDocument.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  private focusTrigger(action: Action | 'more'): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLButtonElement>(
      `[data-inspector-action="${action}"]`,
    )?.focus());
  }

  private currentTarget(): SessionTarget | null {
    const tab = this.tab();
    return tab?.claudeSessionId ? { id: tab.claudeSessionId, title: tab.title } : null;
  }

  protected select(action: Action, fromMenu = false): void {
    if (fromMenu) this.closeMore();
    if (action === 'rename') this.startRename();
    else if (action === 'organize') void this.startOrganize();
    else void this.stop();
  }

  private startRename(): void {
    const target = this.currentTarget();
    if (!target) return;
    this.renameTarget = target;
    this.renameDraft.set(target.title);
    this.renameError.set('');
    this.renameOpen.set(true);
    this.renameSequence++;
    afterNextRender(() => this.renameField()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancelRename(): void {
    this.renameSequence++;
    this.renameOpen.set(false);
    this.renameTarget = null;
    this.focusTrigger(this.narrow() ? 'more' : 'rename');
  }

  protected async saveRename(): Promise<void> {
    if (this.renaming() || !this.renameOpen() || !this.renameTarget) return;
    const target = this.renameTarget;
    const sequence = this.renameSequence;
    this.renaming.set(true);
    try {
      const result = await this.rowActions.rename(target.id, target.title, this.renameDraft());
      if (this.renameOpen() && this.renameSequence === sequence) {
        if (result === 'failed') {
          this.renameError.set("Couldn't rename. Try again.");
          this.renameField()?.nativeElement.focus();
        } else this.cancelRename();
      }
    } finally { this.renaming.set(false); }
  }

  private async startOrganize(): Promise<void> {
    const target = this.currentTarget();
    if (!target || !this.organizer.available()) return;
    const restore = () => this.focusTrigger(this.narrow() ? 'more' : 'organize');
    try {
      const result = await this.organizer.openForSession(target.id, target.title, restore);
      if (result === 'failed') this.announcement.set("Could not load this session's organization.");
    } catch (error) {
      this.logger.error('InspectorSessionActions', 'Could not organize session', error);
      this.announcement.set("Could not load this session's organization.");
    }
  }

  private async stop(): Promise<void> {
    if (!this.running()) return;
    const target = this.currentTarget();
    if (!target) return;
    try {
      await this.chat.abortWithConfirmationFor(this.tabId(), target.id);
    } catch (error) {
      this.logger.error('InspectorSessionActions', 'Could not stop session', error);
      this.announcement.set('Could not stop this session.');
    }
  }
}
