import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
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
  imports: [OpenInButtonComponent, DiffViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article
    class="border-b border-base-content/10"
    [class.opacity-60]="review.isViewed(file().path)"
  >
    <header class="flex items-center gap-2 px-2 py-1 text-xs">
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left"
        [attr.aria-expanded]="expanded()"
        (click)="review.expand(file().path)"
      >
        <span aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>
        {{ file().path }}</button
      ><span>{{ file().status }}</span
      ><span class="text-success">{{
        file().additions === null ? '?' : '+' + file().additions
      }}</span
      ><span class="text-error">{{
        file().deletions === null ? '?' : '-' + file().deletions
      }}</span
      ><button
        class="btn btn-ghost btn-xs"
        (click)="review.toggleViewed(file().path)"
      >
        {{
          review.isViewed(file().path) ? 'Unmark viewed' : 'Mark as viewed'
        }}</button
      ><ptah-open-in-button
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
    @if (expanded() && tab(); as active) {
      <div class="h-80">
        <ptah-diff-view
          [diffTab]="active"
          [openDiffKeys]="[active.filePath]"
          [applyHunks]="null"
        />
      </div>
    }
  </article>`,
})
export class GitReviewFileRowComponent {
  protected readonly review = inject(GitReviewService);
  protected readonly launchers = inject(EditorLauncherService);
  readonly file = input.required<GitReviewFile>();
  readonly workspaceRoot = input.required<string>();
  protected readonly expanded = computed(
    () => this.review.expandedPath() === this.file().path,
  );
  protected readonly tab = computed<EditorTab | null>(() => {
    const data = this.review.file();
    if (!data || data.path !== this.file().path) return null;
    const name = data.path.replace(/\\/g, '/').split('/').pop() ?? data.path;
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
}
