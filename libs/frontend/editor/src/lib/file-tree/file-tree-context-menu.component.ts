import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  HostListener,
  ElementRef,
  inject,
  signal,
  afterNextRender,
} from '@angular/core';
import {
  LucideAngularModule,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  Terminal,
} from 'lucide-angular';
import type { FileTreeNode } from '../models/file-tree.model';

export type ContextMenuAction =
  | 'newFile'
  | 'newFolder'
  | 'rename'
  | 'delete'
  | 'copyPath';

@Component({
  selector: 'ptah-file-tree-context-menu',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <ul
      class="menu menu-sm bg-base-200 shadow-lg rounded-box border border-base-300 z-50 py-1 w-48"
      [style.left.px]="adjustedX()"
      [style.top.px]="adjustedY()"
      style="position: fixed"
      role="menu"
      aria-label="File actions"
    >
      <li>
        <button
          class="flex items-center gap-2 text-xs"
          (click)="emitAction('newFile')"
          role="menuitem"
        >
          <lucide-angular [img]="FilePlusIcon" class="w-3.5 h-3.5 opacity-60" />
          New File
        </button>
      </li>
      <li>
        <button
          class="flex items-center gap-2 text-xs"
          (click)="emitAction('newFolder')"
          role="menuitem"
        >
          <lucide-angular
            [img]="FolderPlusIcon"
            class="w-3.5 h-3.5 opacity-60"
          />
          New Folder
        </button>
      </li>
      @if (node()) {
        <li class="border-t border-base-300 mt-0.5 pt-0.5">
          <button
            class="flex items-center gap-2 text-xs"
            (click)="emitAction('rename')"
            role="menuitem"
          >
            <lucide-angular [img]="PencilIcon" class="w-3.5 h-3.5 opacity-60" />
            Rename
          </button>
        </li>
        <li>
          <button
            class="flex items-center gap-2 text-xs"
            (click)="emitAction('copyPath')"
            role="menuitem"
          >
            <lucide-angular [img]="CopyIcon" class="w-3.5 h-3.5 opacity-60" />
            Copy Path
          </button>
        </li>
        <li class="border-t border-base-300 mt-0.5 pt-0.5">
          <button
            class="flex items-center gap-2 text-xs text-error"
            (click)="emitAction('delete')"
            role="menuitem"
          >
            <lucide-angular [img]="Trash2Icon" class="w-3.5 h-3.5" />
            Delete
          </button>
        </li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeContextMenuComponent {
  private readonly el = inject(ElementRef);

  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly node = input<FileTreeNode | null>(null);

  readonly action = output<{
    type: ContextMenuAction;
    node: FileTreeNode | null;
  }>();
  readonly closed = output<void>();

  // Adjusted positions to prevent overflow
  readonly adjustedX = signal(0);
  readonly adjustedY = signal(0);

  readonly FilePlusIcon = FilePlus;
  readonly FolderPlusIcon = FolderPlus;
  readonly PencilIcon = Pencil;
  readonly Trash2Icon = Trash2;
  readonly CopyIcon = Copy;
  readonly TerminalIcon = Terminal;

  constructor() {
    afterNextRender(() => {
      this.adjustPosition();
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (
      event.target instanceof Node &&
      !this.el.nativeElement.contains(event.target)
    ) {
      this.closed.emit();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  emitAction(type: ContextMenuAction): void {
    this.action.emit({ type, node: this.node() });
    this.closed.emit();
  }

  private adjustPosition(): void {
    const menuEl = this.el.nativeElement.querySelector('ul');
    if (!menuEl) {
      this.adjustedX.set(this.x());
      this.adjustedY.set(this.y());
      return;
    }
    const rect = menuEl.getBoundingClientRect();
    const menuWidth = rect.width || 192;
    const menuHeight = rect.height || 200;

    let ax = this.x();
    let ay = this.y();

    if (ax + menuWidth > window.innerWidth) {
      ax = window.innerWidth - menuWidth - 4;
    }
    if (ay + menuHeight > window.innerHeight) {
      ay = window.innerHeight - menuHeight - 4;
    }
    this.adjustedX.set(Math.max(0, ax));
    this.adjustedY.set(Math.max(0, ay));
  }
}
