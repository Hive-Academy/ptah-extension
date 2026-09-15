import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  Binary,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  LucideAngularModule,
} from 'lucide-angular';
import { OpenInButtonComponent } from '../open-in/open-in-button.component';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitReviewService } from '../services/git-review.service';
import type { GitBlobRead, GitReviewFile } from '@ptah-extension/shared';
import type { EditorTab } from '../types/diff-tab.types';

function text(read: GitBlobRead): string {
  return read.outcome === 'content' ? read.content : '';
}

@Component({
  selector: 'ptah-git-review-file-row',
  standalone: true,
  imports: [LucideAngularModule, OpenInButtonComponent, DiffViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article
    class="border-b border-base-content/10"
    [id]="rowId()"
    [attr.data-review-path]="file().path"
    [class.opacity-60]="viewed()"
  >
    <header
      class="group flex items-center gap-2 px-2 py-1.5 text-xs transition-colors hover:bg-base-300"
      [class.sticky]="expanded()"
      [class.top-0]="expanded()"
      [class.z-10]="expanded()"
      [class.bg-base-200]="expanded()"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]"
        [title]="pathTitle()"
        [attr.aria-label]="'Toggle diff for ' + pathTitle()"
        [attr.aria-expanded]="expanded()"
        (click)="review.expand(file().path)"
      >
        <lucide-angular
          [img]="expanded() ? ChevronDownIcon : ChevronRightIcon"
          class="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        />
        <span
          class="min-w-0 shrink-[0.2] truncate font-medium"
          data-testid="review-file-name"
          >{{ displayName() }}</span
        >
        @if (parentDirectory()) {
          <span
            class="min-w-0 flex-1 shrink truncate text-[10px] opacity-45"
            data-testid="review-parent-directory"
            >{{ parentDirectory() }}</span
          >
        }
      </button>
      <span
        class="badge badge-sm shrink-0 border-0 text-[10px]"
        [class]="statusClass()"
        [attr.aria-label]="statusLabel()"
        [title]="statusLabel()"
        >{{ statusLabel() }}</span
      >
      @if (file().binary) {
        <span
          class="flex shrink-0 items-center gap-1 opacity-60"
          title="Binary file"
        >
          <lucide-angular
            [img]="BinaryIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
          binary
        </span>
      } @else {
        <span class="shrink-0 text-success"
          >+{{ file().additions ?? '?' }}</span
        >
        <span class="shrink-0 text-error">-{{ file().deletions ?? '?' }}</span>
      }
      <label class="flex shrink-0 cursor-pointer items-center gap-1">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          [checked]="viewed()"
          [attr.aria-label]="'Viewed ' + file().path"
          (change)="onViewedChange($event)"
        />
        <span>Viewed</span>
      </label>
      <ptah-open-in-button
        mode="icon-only"
        [targets]="launchers.targets()"
        [path]="file().path"
        [root]="workspaceRoot()"
        (open)="
          launchers.openFile(
            $event.target,
            workspaceRoot(),
            file().path,
            $event.line
          )
        "
      />
    </header>
    @if (expanded()) {
      @if (file().binary) {
        <div
          class="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-sm opacity-60"
        >
          <lucide-angular
            [img]="BinaryIcon"
            class="h-6 w-6"
            aria-hidden="true"
          />
          <span>Binary files cannot be displayed as text.</span>
        </div>
      } @else if (tab(); as active) {
        <div class="min-h-64" [style.height]="diffHeight()">
          <ptah-diff-view
            [diffTab]="active"
            [openDiffKeys]="[active.filePath]"
            [showHeader]="false"
            [layoutOverride]="inlineLayout() ? 'inline' : null"
            [applyHunks]="null"
          />
        </div>
      } @else {
        <div
          class="flex min-h-64 items-center justify-center gap-2 text-sm opacity-60"
          role="status"
        >
          <lucide-angular
            [img]="LoaderIcon"
            class="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
          Loading file diff…
        </div>
      }
    }
  </article>`,
})
export class GitReviewFileRowComponent {
  protected readonly review = inject(GitReviewService);
  protected readonly launchers = inject(EditorLauncherService);
  readonly file = input.required<GitReviewFile>();
  readonly workspaceRoot = input.required<string>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly BinaryIcon = Binary;
  protected readonly LoaderIcon = LoaderCircle;

  protected readonly expanded = computed(
    () => this.review.expandedPath() === this.file().path,
  );
  protected readonly viewed = computed(() =>
    this.review.isViewed(this.file().path),
  );
  protected readonly rowId = computed(
    () => `git-review-file-${encodeURIComponent(this.file().path)}`,
  );
  protected readonly pathTitle = computed(() => {
    const file = this.file();
    return file.originalPath
      ? `${file.originalPath} → ${file.path}`
      : file.path;
  });
  protected readonly displayName = computed(() => {
    const file = this.file();
    const name = this.baseName(file.path);
    return file.originalPath
      ? `${this.baseName(file.originalPath)} → ${name}`
      : name;
  });
  protected readonly parentDirectory = computed(() => {
    const parts = this.file().path.replace(/\\/g, '/').split('/');
    parts.pop();
    return parts.join('/');
  });
  protected readonly statusLabel = computed(() => {
    switch (this.file().status) {
      case 'A':
        return 'Added';
      case 'M':
        return 'Modified';
      case 'D':
        return 'Deleted';
      case 'R':
        return 'Renamed';
      case 'C':
        return 'Copied';
    }
  });
  protected readonly statusClass = computed(() => {
    switch (this.file().status) {
      case 'A':
        return 'badge-success';
      case 'M':
        return 'badge-warning';
      case 'D':
        return 'badge-error';
      case 'R':
      case 'C':
        return 'badge-info';
    }
  });
  protected readonly inlineLayout = computed(() => {
    const status = this.file().status;
    return status === 'A' || status === 'D';
  });
  protected readonly diffHeight = computed(() => {
    const data = this.review.file();
    if (!data || data.path !== this.file().path) return '16rem';
    const lineCount = Math.max(
      this.lineCount(text(data.original)),
      this.lineCount(text(data.modified)),
    );
    return `clamp(16rem, ${Math.min(900, 72 + lineCount * 19)}px, 70vh)`;
  });
  protected readonly tab = computed<EditorTab | null>(() => {
    const data = this.review.file();
    if (!data || data.path !== this.file().path) return null;
    const name = this.baseName(data.path);
    return {
      filePath: `review:${data.baseSha}:${data.headSha}:${data.path}`,
      fileName: name,
      content: text(data.modified),
      isDirty: false,
      diff: {
        provenance: {
          kind: 'historical',
          base: { name: this.review.base(), sha: data.baseSha },
          head: { name: this.review.head(), sha: data.headSha },
        },
        comparison: 'staged',
        path: data.path,
        originalPath: data.originalPath,
        original: text(data.original),
        modified: text(data.modified),
        originalRef:
          data.original.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'commit', sha: data.baseSha },
        modifiedRef:
          data.modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'commit', sha: data.headSha },
        snapshotToken: '',
        hunks: [],
        isBinary:
          data.original.outcome === 'binary' ||
          data.modified.outcome === 'binary',
        status: 'fresh',
        requestId: 0,
      },
    };
  });

  protected onViewedChange(event: Event): void {
    const path = this.file().path;
    const checked = (event.target as HTMLInputElement).checked;
    this.review.toggleViewed(path);
    if (checked && this.expanded()) void this.review.expand(path);
  }

  private baseName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts.pop() ?? path;
  }

  private lineCount(content: string): number {
    return content ? content.split('\n').length : 1;
  }
}
