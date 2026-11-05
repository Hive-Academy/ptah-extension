import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { DisplayFileItem } from './display-file-item';

/** Reads only the selected file; the component is destroyed when selection changes. */
@Component({
  selector: 'ptah-display-file-viewer',
  standalone: true,
  imports: [MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) { <p role="status" class="p-3 text-xs">Loading file…</p> }
    @else if (error()) {
      <div role="alert" class="flex items-center gap-2 rounded-box border border-error/30 p-3 text-xs">
        <span>{{ error() }}</span>
        <button type="button" class="btn btn-ghost btn-xs" (click)="retry()">Retry</button>
      </div>
    } @else if (file().kind === 'markdown-file') {
      <ptah-markdown-block [content]="markdown()" variant="auto" />
    } @else if (file().kind === 'image-file') {
      <img class="max-h-full max-w-full object-contain" [src]="objectUrl()" [alt]="file().title" />
    } @else if (pdfUrl()) {
      <iframe class="h-[70vh] w-full border-0" [src]="pdfUrl()" [title]="file().title"></iframe>
    }
  `,
})
export class DisplayFileViewerComponent {
  readonly file = input.required<DisplayFileItem>();
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly markdown = signal('');
  protected readonly objectUrl = signal<string | null>(null);
  protected readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;

  constructor() {
    effect((onCleanup) => {
      const file = this.file();
      const generation = ++this.generation;
      this.releaseUrl();
      void this.read(file, generation);
      onCleanup(() => { ++this.generation; this.releaseUrl(); });
    });
    this.destroyRef.onDestroy(() => { ++this.generation; this.releaseUrl(); });
  }

  protected retry(): void { void this.read(this.file(), ++this.generation); }

  private async read(file: DisplayFileItem, generation: number): Promise<void> {
    this.releaseUrl();
    this.loading.set(true);
    this.error.set(null);
    const params = { path: file.path, workspaceRoot: file.workspaceRoot, documentPath: file.documentPath };
    try {
      if (file.kind === 'markdown-file') {
        const reply = await this.rpc.call('file:viewContent', params);
        if (generation !== this.generation) return;
        if (!reply.success || !reply.data?.success) throw new Error('Could not read this file.');
        this.markdown.set(reply.data.content);
      } else {
        const reply = await this.rpc.call('file:viewBinary', params);
        if (generation !== this.generation) return;
        if (!reply.success || !reply.data?.success) throw new Error('Could not read this file.');
        if (reply.data.kind !== (file.kind === 'pdf-file' ? 'pdf' : 'image')) throw new Error('The file type changed.');
        const bytes = Uint8Array.from(atob(reply.data.dataBase64), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: reply.data.mime }));
        this.objectUrl.set(url);
        if (file.kind === 'pdf-file') this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }
    } catch {
      if (generation !== this.generation) return;
      this.error.set('This file could not be previewed. It may be missing, too large, or changed.');
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  private releaseUrl(): void {
    const url = untracked(() => this.objectUrl());
    if (url) URL.revokeObjectURL(url);
    this.objectUrl.set(null);
    this.pdfUrl.set(null);
  }
}
