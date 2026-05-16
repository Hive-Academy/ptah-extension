import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  Plus,
  Minus,
  Undo2,
  FileEdit,
  FilePlus,
  FileMinus,
  FileQuestion,
  FileCode,
  Folder,
} from 'lucide-angular';
import type { GitFileStatus } from '@ptah-extension/shared';

/**
 * SourceControlFileComponent - Single file row in the source control panel.
 *
 * Complexity Level: 1 (Simple presentational component)
 * Patterns: Standalone, OnPush, signal-based inputs/outputs
 *
 * Displays a file with:
 * - Status icon with semantic color (M=warning, A=success, D=error, ??=info)
 * - File name (bold) + parent directory (subdued)
 * - Inline hover actions: stage/unstage, discard
 * - Row click opens diff view
 */
@Component({
  selector: 'ptah-source-control-file',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      type="button"
      class="group flex items-center gap-1.5 w-full px-2 py-0.5 text-left text-xs
             hover:bg-base-content/10 transition-colors cursor-pointer"
      role="listitem"
      [title]="file().path"
      (click)="openDiff.emit(file().path)"
    >
      <!-- Status icon -->
      <lucide-angular
        [img]="statusIcon()"
        [class]="'w-3.5 h-3.5 flex-shrink-0 ' + statusColor()"
        aria-hidden="true"
      />

      <!-- File name + parent dir -->
      <span class="flex items-center gap-1 min-w-0 flex-1">
        <span class="font-medium truncate">{{ fileName() }}</span>
        @if (parentDir()) {
          <span class="opacity-40 text-[10px] truncate">{{ parentDir() }}</span>
        }
      </span>

      <!-- Inline actions (visible on hover) -->
      <span
        class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >
        @if (staged()) {
          <!-- Unstage button -->
          <button
            type="button"
            class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
            title="Unstage"
            aria-label="Unstage file"
            (click)="onAction($event, 'unstage')"
          >
            <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" />
          </button>
        } @else {
          <!-- Stage button -->
          <button
            type="button"
            class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
            title="Stage"
            aria-label="Stage file"
            (click)="onAction($event, 'stage')"
          >
            <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
          </button>
        }

        <!-- Discard button -->
        <button
          type="button"
          class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
          title="Discard changes"
          aria-label="Discard changes"
          (click)="onAction($event, 'discard')"
        >
          <lucide-angular [img]="Undo2Icon" class="w-3.5 h-3.5" />
        </button>
      </span>

      <!-- Status badge -->
      <span class="text-[10px] font-mono opacity-40 flex-shrink-0">{{
        file().status
      }}</span>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlFileComponent {
  readonly file = input.required<GitFileStatus>();
  readonly staged = input.required<boolean>();

  readonly stage = output<string>();
  readonly unstage = output<string>();
  readonly discard = output<string>();
  readonly openDiff = output<string>();
  readonly openFile = output<string>();

  // Icons
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly Undo2Icon = Undo2;

  protected readonly fileName = computed(() => {
    const parts = this.file().path.replace(/\\/g, '/').split('/');
    return parts.pop() ?? this.file().path;
  });

  protected readonly parentDir = computed(() => {
    const parts = this.file().path.replace(/\\/g, '/').split('/');
    if (parts.length > 1) {
      parts.pop();
      return parts.join('/');
    }
    return '';
  });

  protected readonly statusIcon = computed(() => {
    const file = this.file();
    if (file.status === '??' && file.isDirectory) return Folder;
    switch (file.status) {
      case 'M':
        return FileEdit;
      case 'A':
        return FilePlus;
      case 'D':
        return FileMinus;
      case '??':
        return FileQuestion;
      default:
        return FileCode;
    }
  });

  protected readonly statusColor = computed(() => {
    const file = this.file();
    if (file.status === '??' && file.isDirectory) return 'text-amber-500';
    switch (file.status) {
      case 'M':
        return 'text-warning';
      case 'A':
        return 'text-success';
      case 'D':
        return 'text-error';
      case '??':
        return 'text-info';
      default:
        return 'opacity-60';
    }
  });

  protected onAction(
    event: MouseEvent,
    action: 'stage' | 'unstage' | 'discard',
  ): void {
    event.stopPropagation();
    const path = this.file().path;
    switch (action) {
      case 'stage':
        this.stage.emit(path);
        break;
      case 'unstage':
        this.unstage.emit(path);
        break;
      case 'discard':
        this.discard.emit(path);
        break;
    }
  }
}
