import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import type { FileChange, FileChangeToolInput } from '@ptah-extension/shared';
import { LazyFileChangeRendererComponent } from './lazy-file-change-renderer.component';

const MAX_PATCH_CHARS = 100_000;
const MAX_RENDERED_FILES = 8;

@Component({
  selector: 'ptah-file-change-diff',
  standalone: true,
  imports: [LazyFileChangeRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3" data-testid="file-change-diff">
      @for (change of toolInput().changes; track $index) {
        <section
          class="rounded border border-base-300 bg-base-100 overflow-hidden"
        >
          <div
            class="flex flex-wrap items-center gap-2 border-b border-base-300 px-2 py-1 text-xs"
          >
            <span class="font-semibold text-base-content">{{
              label(change)
            }}</span>
            <span class="font-mono text-base-content-muted break-all">{{
              change.path
            }}</span>
            @if (movePath(change)) {
              <span class="text-base-content-muted">to</span>
              <span class="font-mono text-base-content-muted break-all">{{
                movePath(change)
              }}</span>
            }
          </div>
          @if (change.diff.length <= MAX_PATCH_CHARS && $index < MAX_RENDERED_FILES) {
            <ptah-lazy-file-change-renderer
              [change]="change"
              [patch]="patch(change)"
            />
          } @else {
            <pre class="overflow-auto whitespace-pre-wrap break-words p-2 text-xs text-base-content">{{ shownDiff(change.diff, $index) }}</pre>
            @if (change.diff.length > MAX_PATCH_CHARS && !expanded().has($index)) {
              <button type="button" class="btn btn-ghost btn-xs m-2" (click)="expand($index)">Show all</button>
            }
            @if ($index === MAX_RENDERED_FILES) {
              <p class="px-2 text-xs text-base-content-muted">Only the first 8 files render as patches in this card.</p>
            }
          }
        </section>
      }
    </div>
  `,
})
export class FileChangeDiffComponent {
  readonly toolInput = input.required<FileChangeToolInput>();
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly MAX_RENDERED_FILES = MAX_RENDERED_FILES;
  protected readonly MAX_PATCH_CHARS = MAX_PATCH_CHARS;

  protected movePath(change: FileChange): string | null {
    return change.kind.type === 'update' ? change.kind.move_path ?? null : null;
  }

  protected label(change: FileChange): string {
    if (this.movePath(change)) return 'Moved';
    return { add: 'Added', update: 'Updated', delete: 'Deleted' }[change.kind.type];
  }

  protected patch(change: FileChange): string | null {
    if (change.kind.type !== 'update') return null;
    const diff = change.diff;
    const path = change.path.replace(/^\/+/, '');
    const targetPath = (this.movePath(change) ?? change.path).replace(/^\/+/, '');
    if (!diff.includes('@@')) return null;
    if (diff.startsWith('diff --git ') || diff.startsWith('--- ')) return diff;
    return `--- a/${path}\n+++ b/${targetPath}\n${diff}`;
  }

  protected expand(index: number): void {
    this.expanded.update(current => new Set([...current, index]));
  }

  protected shownDiff(diff: string, index: number): string {
    if (!diff) return 'No patch text available.';
    return diff.length > MAX_PATCH_CHARS && !this.expanded().has(index)
      ? diff.slice(0, MAX_PATCH_CHARS) + '\nPatch truncated.'
      : diff;
  }
}
