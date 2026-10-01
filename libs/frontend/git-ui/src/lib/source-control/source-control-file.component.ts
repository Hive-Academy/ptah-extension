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
  FileType,
  FileWarning,
  Folder,
  CircleAlert,
  X,
} from 'lucide-angular';
import type { EditorTarget, GitFileStatus } from '@ptah-extension/shared';
import type { OpenDiffRequest } from '../types/diff-tab.types';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';

/**
 * SourceControlFileComponent - Single file row in the source control panel.
 *
 * Complexity Level: 1 (Simple presentational component)
 * Patterns: Standalone, OnPush, signal-based inputs/outputs
 *
 * Displays a file with:
 * - Status icon with semantic color (M/T=warning, A=success, D/U=error,
 *   ??=info); the trailing badge names the status in text, never colour alone
 * - File name (bold) + parent directory (subdued)
 * - Inline hover actions: stage/unstage, discard
 * - Row click opens diff view
 * - A dismissible error line when the row's last action failed
 */
@Component({
  selector: 'ptah-source-control-file',
  standalone: true,
  imports: [LucideAngularModule, OpenInButtonComponent],
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
        (click)="onOpenDiff()"
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
          @if (showParentDir() && parentDir()) {
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
            [disabled]="busy()"
            [attr.aria-busy]="busy() || null"
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
            [disabled]="busy()"
            [attr.aria-busy]="busy() || null"
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
          [disabled]="busy()"
          [attr.aria-busy]="busy() || null"
          (click)="onAction('discard')"
        >
          <lucide-angular [img]="Undo2Icon" class="w-3.5 h-3.5" />
        </button>
      </span>

      @if (!file().isDirectory) {
        <span
          class="flex flex-shrink-0 gap-1 font-mono text-[10px]"
          aria-label="Change counts"
        >
          <span class="text-success">+{{ file().additions ?? '?' }}</span>
          <span class="text-error">-{{ file().deletions ?? '?' }}</span>
        </span>
        <ptah-open-in-button
          mode="icon-only"
          [targets]="editorTargets()"
          [path]="file().path"
          [root]="workspaceRoot()"
          (open)="openFile.emit($event)"
        />
      }
      <!-- Keep the status badge as the final child for stable row semantics.
           The letter is the status's text carrier, so it is full
           text-base-content (the status icon keeps the hue): an opacity or
           base-content-muted letter drops below 4.5:1 on the row hover tint. -->
      <span
        class="text-[10px] font-mono text-base-content flex-shrink-0"
        [title]="statusLabel()"
        [attr.aria-label]="statusLabel()"
        >{{ statusBadge() }}</span
      >
    </div>
    <!-- A failed stage / unstage / discard of THIS row (TASK_2026_576 RC1).
         A second listitem rather than a child of the row above: the row's
         shape (open-diff button as its direct child, status badge as its last
         child) is load-bearing for its own spec, and the presentational host
         lets both items belong to the parent list. Text is text-base-content
         on the error tint — text-error on base fails AA in both themes. -->
    @if (error(); as message) {
      <div
        role="listitem"
        data-testid="git-row-error"
        class="flex items-start gap-1 mx-2 my-0.5 px-1.5 py-1 rounded text-[10px]
               text-base-content bg-error/10 border border-error/60"
      >
        <lucide-angular
          [img]="ErrorIcon"
          class="w-3 h-3 mt-px flex-shrink-0 text-error"
          aria-hidden="true"
        />
        <span role="alert" class="flex-1 min-w-0 break-words">{{
          message
        }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square p-0 w-6 h-6 min-h-6 flex-shrink-0
                 focus-visible:outline focus-visible:outline-2
                 focus-visible:outline-offset-[-2px]
                 focus-visible:outline-[oklch(var(--s))]"
          [attr.aria-label]="dismissErrorLabel()"
          (click)="dismissError.emit()"
        >
          <lucide-angular [img]="DismissIcon" class="w-3 h-3" />
        </button>
      </div>
    }
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
  readonly showParentDir = input(true);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');
  /**
   * Why the last stage / unstage / discard of this row failed, or null. Owned
   * by the panel, which clears it on dismiss or on the row's next success.
   */
  readonly error = input<string | null>(null);
  /**
   * True while this row cannot start an action: its own stage / unstage /
   * discard is in flight, or a bulk action covers it. Owned by the panel.
   */
  readonly busy = input(false);

  readonly stage = output<string>();
  readonly unstage = output<string>();
  readonly discard = output<string>();
  /**
   * The diff this row stands for. A row in *Staged Changes* and a row in
   * *Changes* for the same file are different comparisons, so the row emits
   * a structured request rather than a bare path (A2).
   */
  readonly openDiff = output<OpenDiffRequest>();
  readonly openFile = output<OpenInRequest>();
  /** The user dismissed this row's error message. */
  readonly dismissError = output<void>();
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly Undo2Icon = Undo2;
  readonly ErrorIcon = CircleAlert;
  readonly DismissIcon = X;

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

  /**
   * Names the section too: a partially staged file has a row, and possibly
   * an error, in both lists.
   */
  protected readonly dismissErrorLabel = computed(
    () =>
      `Dismiss error for ${this.fileName()} in ${
        this.staged() ? 'staged changes' : 'changes'
      }`,
  );

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
    const status = file.status;
    switch (status) {
      case 'M':
        return FileEdit;
      case 'A':
        return FilePlus;
      case 'D':
        return FileMinus;
      case 'U':
        return FileWarning;
      case 'T':
        return FileType;
      case '??':
        return FileQuestion;
      case 'R':
      case 'C':
      case '!':
        return FileCode;
      default: {
        // Compile-time exhaustiveness; a code from a newer backend still renders.
        const unhandled: never = status;
        void unhandled;
        return FileCode;
      }
    }
  });

  protected readonly statusColor = computed(() => {
    const file = this.file();
    if (file.status === '??' && file.isDirectory) return 'text-warning';
    const status = file.status;
    switch (status) {
      case 'M':
      case 'T':
        return 'text-warning';
      case 'A':
        return 'text-success';
      case 'D':
      case 'U':
        return 'text-error';
      case '??':
        return 'text-info';
      case 'R':
      case 'C':
      case '!':
        return 'opacity-60';
      default: {
        const unhandled: never = status;
        void unhandled;
        return 'opacity-60';
      }
    }
  });

  /**
   * One-character badge, VS Code's letters: untracked is `U`, so a conflict
   * is `!` and an ignored entry `I`. The badge never stands alone: it carries
   * {@link statusLabel} as its accessible name and title.
   */
  protected readonly statusBadge = computed(() => {
    const status = this.file().status;
    switch (status) {
      case '??':
        return 'U';
      case 'U':
        return '!';
      case '!':
        return 'I';
      case 'M':
      case 'A':
      case 'D':
      case 'R':
      case 'C':
      case 'T':
        return status;
      default: {
        const unhandled: never = status;
        return String(unhandled);
      }
    }
  });

  protected readonly statusLabel = computed(() => {
    const status = this.file().status;
    switch (status) {
      case 'M':
        return 'Modified';
      case 'A':
        return 'Added';
      case 'D':
        return 'Deleted';
      case '??':
        return 'Untracked';
      case 'R':
        return 'Renamed';
      case 'C':
        return 'Copied';
      case 'U':
        return 'Conflicted';
      case 'T':
        return 'Type changed';
      case '!':
        return 'Ignored';
      default: {
        const unhandled: never = status;
        return String(unhandled);
      }
    }
  });

  /** Directory-shaped legacy rows are never valid diff targets. */
  protected onOpenDiff(): void {
    if (this.file().isDirectory) return;
    this.openDiff.emit(this.diffRequest());
  }

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
