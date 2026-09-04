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
import type { OpenDiffRequest } from '../services/editor/editor-tab.types';

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
    <!-- The row itself is the listitem — NOT a control. The open-diff button
         and the three inline actions are SIBLINGS inside it. Previously the
         whole row was a <button role="listitem"> with the action buttons
         nested inside, which is invalid HTML (the browser flattens it) and
         also stripped the row's own button role. That nesting was the sole
         reason onAction needed stopPropagation (D1 AC1/AC5). -->
    <div
      role="listitem"
      class="group flex items-center gap-1.5 w-full px-2 py-0.5 text-left text-xs
             hover:bg-base-content/10 transition-colors"
    >
      <button
        type="button"
        class="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer
               focus-visible:outline focus-visible:outline-2
               focus-visible:outline-offset-[-2px]
               focus-visible:outline-[oklch(var(--s))]"
        [title]="rowTitle()"
        [attr.aria-label]="'Open diff for ' + fileName()"
        (click)="openDiff.emit(diffRequest())"
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
            <span class="opacity-40 text-[10px] truncate">{{
              parentDir()
            }}</span>
          }
        </span>
      </button>

      <!-- Inline actions (visible on hover, and on keyboard focus — the
           focus-within/focus-visible pair is a NEW state, not visual drift:
           these controls previously rendered nothing at all for a keyboard
           user who tabbed onto them, D1 AC7). -->
      <span
        class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0"
      >
        @if (staged()) {
          <!-- Unstage button -->
          <button
            type="button"
            class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0
                   focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
            title="Unstage"
            aria-label="Unstage file"
            (click)="onAction('unstage')"
          >
            <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" />
          </button>
        } @else {
          <!-- Stage button -->
          <button
            type="button"
            class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0
                   focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
            title="Stage"
            aria-label="Stage file"
            (click)="onAction('stage')"
          >
            <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
          </button>
        }

        <!-- Discard button -->
        <button
          type="button"
          class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0
                 focus-visible:outline focus-visible:outline-2
                 focus-visible:outline-offset-[-2px]
                 focus-visible:outline-[oklch(var(--s))]"
          title="Discard changes"
          aria-label="Discard changes"
          (click)="onAction('discard')"
        >
          <lucide-angular [img]="Undo2Icon" class="w-3.5 h-3.5" />
        </button>
      </span>

      <!-- Status badge -->
      <span class="text-[10px] font-mono opacity-40 flex-shrink-0">{{
        file().status
      }}</span>
    </div>
  `,
  // The component HOST sits between the panel's role="list" and this row's
  // role="listitem". Marking it presentational keeps it out of the
  // accessibility tree so the listitem is still owned by the list.
  host: { role: 'presentation' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlFileComponent {
  readonly file = input.required<GitFileStatus>();
  readonly staged = input.required<boolean>();

  readonly stage = output<string>();
  readonly unstage = output<string>();
  readonly discard = output<string>();
  /**
   * The diff this row stands for. A row in *Staged Changes* and a row in
   * *Changes* for the same file are different comparisons, so the row emits
   * a structured request rather than a bare path (A2).
   */
  readonly openDiff = output<OpenDiffRequest>();
  readonly openFile = output<string>();
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly Undo2Icon = Undo2;

  /**
   * `origPath` is carried through for staged renames so the original side is
   * read at the pre-rename path instead of the (nonexistent) new one (N3).
   */
  protected readonly diffRequest = computed<OpenDiffRequest>(() => {
    const file = this.file();
    return {
      path: file.path,
      comparison: this.staged() ? 'staged' : 'worktree',
      ...(file.origPath ? { origPath: file.origPath } : {}),
    };
  });

  protected readonly rowTitle = computed(() => {
    const file = this.file();
    return file.origPath ? `${file.origPath} → ${file.path}` : file.path;
  });

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
    if (file.status === '??' && file.isDirectory) return 'text-warning';
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

  /**
   * Inline row action. Takes no event: the three action buttons are SIBLINGS
   * of the open-diff button, so activating one cannot open the diff. The
   * isolation is structural rather than a suppressed propagation (D1 AC5).
   */
  protected onAction(action: 'stage' | 'unstage' | 'discard'): void {
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
