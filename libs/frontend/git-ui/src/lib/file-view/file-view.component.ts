import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { EditorTarget } from '@ptah-extension/shared';
import { Code2, Eye, LucideAngularModule } from 'lucide-angular';
import type * as monaco from 'monaco-editor';
import type { EditorTab } from '../types/diff-tab.types';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import {
  detectMonacoTheme,
  observeMonacoTheme,
} from '../services/monaco-theme';

type MonacoApi = typeof monaco;
const MAX_MARKDOWN_PREVIEW_BYTES = 512 * 1024;

@Component({
  selector: 'ptah-file-view',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent, OpenInButtonComponent],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (view(); as current) {
      <div
        class="flex h-8 flex-shrink-0 items-center gap-2 border-b border-base-content/10 px-2"
      >
        <span
          class="min-w-0 flex-1 truncate text-xs font-medium"
          [title]="current.absolutePath"
        >
          {{ tab().fileName }}
        </span>
        <span class="badge badge-ghost badge-xs">Read-only</span>
        @if (current.isMarkdown) {
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            data-testid="file-view-preview-toggle"
            [disabled]="!previewAvailable()"
            [attr.aria-pressed]="previewVisible()"
            [title]="
              previewVisible()
                ? 'Show markdown source'
                : 'Show markdown preview'
            "
            (click)="togglePreview()"
          >
            <lucide-angular
              [img]="previewVisible() ? CodeIcon : EyeIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            {{ previewVisible() ? 'Source' : 'Preview' }}
          </button>
        }
      </div>

      <div
        class="relative flex-1 min-h-0"
        data-ptah-file-links
        [attr.data-ptah-link-root]="current.workspaceRoot"
        [attr.data-ptah-link-document]="current.absolutePath"
      >
        <div
          #editorContainer
          class="absolute inset-0"
          data-testid="file-view-editor"
          [class.invisible]="
            previewVisible() ||
            current.status === 'loading' ||
            current.status === 'blocked'
          "
        ></div>
        @if (current.status === 'loading') {
          <div
            class="flex h-full items-center justify-center gap-2 text-sm opacity-70"
            aria-busy="true"
          >
            <span
              class="loading loading-spinner loading-sm"
              aria-hidden="true"
            ></span>
            Loading file…
          </div>
        } @else if (current.status === 'blocked') {
          <div
            class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <p class="max-w-xl text-sm" role="alert">
              {{ current.failure?.message }}
            </p>
            @if (current.failure?.externalOpenAllowed) {
              <ptah-open-in-button
                mode="full"
                [targets]="editorTargets()"
                [path]="current.absolutePath"
                [line]="current.reveal?.line"
                [root]="current.workspaceRoot ?? ''"
                (open)="requestExternalConfirmation($event)"
              />
            }
          </div>
        } @else {
          @if (current.status === 'error') {
            <div
              class="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-error/15 px-3 py-2 text-xs"
              role="alert"
            >
              <span>{{ current.failure?.message }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="retryRequested.emit(tab().filePath)"
              >
                Retry
              </button>
            </div>
          }
          @if (previewVisible()) {
            <div
              class="absolute inset-0 overflow-y-auto p-4"
              data-testid="file-view-preview"
            >
              <ptah-markdown-block [content]="current.content" />
            </div>
          }
          @if (current.isMarkdown && !previewAvailable()) {
            <p
              class="absolute bottom-2 right-3 rounded bg-base-200 px-2 py-1 text-xs opacity-70"
            >
              Preview is disabled for files over 512 KB.
            </p>
          }
        }

        @if (pendingExternal(); as pending) {
          <div
            class="absolute inset-0 z-30 flex items-center justify-center bg-base-300/70 p-4"
          >
            <section
              class="max-w-lg rounded-box border border-base-content/20 bg-base-100 p-4 shadow-xl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="external-open-title"
            >
              <h3 id="external-open-title" class="font-semibold">
                Open outside the workspace?
              </h3>
              <p class="mt-2 text-sm">
                Open this file in {{ editorName(pending.target) }}?
              </p>
              <code
                class="mt-2 block break-all rounded bg-base-200 p-2 text-xs"
                >{{ pending.path }}</code
              >
              <div class="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="cancelExternal()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  data-testid="confirm-external-open"
                  (click)="confirmExternal()"
                >
                  Open
                </button>
              </div>
            </section>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileViewComponent {
  readonly tab = input.required<EditorTab>();
  readonly editorTargets = input.required<readonly EditorTarget[]>();
  readonly retryRequested = output<string>();
  readonly openExternal = output<OpenInRequest>();

  protected readonly EyeIcon = Eye;
  protected readonly CodeIcon = Code2;
  protected readonly pendingExternal = signal<OpenInRequest | null>(null);
  private readonly previewRequested = signal(true);
  protected readonly view = computed(() => this.tab().view ?? null);
  protected readonly previewAvailable = computed(() => {
    const view = this.view();
    return Boolean(
      view?.isMarkdown &&
      view.sizeBytes !== null &&
      view.sizeBytes <= MAX_MARKDOWN_PREVIEW_BYTES,
    );
  });
  protected readonly previewVisible = computed(
    () => this.previewAvailable() && this.previewRequested(),
  );

  private readonly editorContainer =
    viewChild<ElementRef<HTMLElement>>('editorContainer');
  private readonly monacoLoader = inject(MonacoLoaderService);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private monacoApi: MonacoApi | null = null;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private model: monaco.editor.ITextModel | null = null;
  private modelPath: string | null = null;
  private stopThemeObserver: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    let previousKey: string | null = null;
    effect(() => {
      const key = this.tab().filePath;
      const view = this.view();
      if (key !== previousKey) {
        previousKey = key;
        this.previewRequested.set(true);
      }
      if (view?.status === 'blocked') {
        this.disposeModel();
      } else if (
        view?.status === 'fresh' ||
        view?.status === 'refreshing' ||
        view?.status === 'error'
      ) {
        this.syncModel(view.absolutePath, view.content, view.reveal);
      }
    });

    afterNextRender(() => void this.initializeEditor());
    this.destroyRef.onDestroy(() => this.dispose());
  }

  protected togglePreview(): void {
    if (!this.previewAvailable()) return;
    this.previewRequested.update((value) => !value);
    if (!this.previewRequested()) {
      requestAnimationFrame(() => this.editor?.layout());
    }
  }

  protected requestExternalConfirmation(request: OpenInRequest): void {
    this.pendingExternal.set(request);
  }

  protected cancelExternal(): void {
    this.pendingExternal.set(null);
  }

  protected confirmExternal(): void {
    const request = this.pendingExternal();
    if (!request) return;
    this.pendingExternal.set(null);
    this.openExternal.emit(request);
  }

  protected editorName(targetId: string): string {
    return (
      this.editorTargets().find((target) => target.id === targetId)
        ?.displayName ?? targetId
    );
  }

  private async initializeEditor(): Promise<void> {
    try {
      const monacoApi = await this.monacoLoader.load();
      if (this.destroyed) return;
      const host = this.editorContainer()?.nativeElement;
      if (!host) return;
      this.monacoApi = monacoApi;
      this.ngZone.runOutsideAngular(() => {
        this.editor = monacoApi.editor.create(host, {
          readOnly: true,
          domReadOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          theme: detectMonacoTheme(),
        });
        this.stopThemeObserver = observeMonacoTheme(monacoApi);
      });
      const current = this.view();
      if (
        current &&
        current.status !== 'loading' &&
        current.status !== 'blocked'
      ) {
        this.syncModel(current.absolutePath, current.content, current.reveal);
      }
    } catch {
      // The surrounding tab already has a readable failure region for RPC
      // failures; a Monaco loader error must not replace backend refusal copy.
    }
  }

  private syncModel(
    path: string,
    content: string,
    reveal: { line: number; column: number } | null,
  ): void {
    if (!this.monacoApi || !this.editor) return;
    if (this.modelPath !== path) {
      this.model?.dispose();
      const language = this.detectLanguage(path);
      this.model = this.monacoApi.editor.createModel(
        content,
        language,
        this.monacoApi.Uri.parse(
          `inmemory://ptah-file-view/${encodeURIComponent(path)}`,
        ),
      );
      this.modelPath = path;
      this.editor.setModel(this.model);
    } else if (this.model && this.model.getValue() !== content) {
      this.model.setValue(content);
    }
    if (!this.model || !reveal) return;
    const lineNumber = Math.min(
      Math.max(1, reveal.line),
      this.model.getLineCount(),
    );
    const column = Math.min(
      Math.max(1, reveal.column),
      this.model.getLineMaxColumn(lineNumber),
    );
    const position = { lineNumber, column };
    this.editor.setSelection({
      startLineNumber: lineNumber,
      startColumn: column,
      endLineNumber: lineNumber,
      endColumn: column,
    });
    this.editor.revealPositionInCenter(position);
  }

  private detectLanguage(path: string): string {
    if (!this.monacoApi) return 'plaintext';
    const lowerPath = path.toLowerCase();
    return (
      this.monacoApi.languages
        .getLanguages()
        .find((language) =>
          language.extensions?.some((extension) =>
            lowerPath.endsWith(extension.toLowerCase()),
          ),
        )?.id ?? 'plaintext'
    );
  }

  private dispose(): void {
    this.destroyed = true;
    this.stopThemeObserver?.();
    this.stopThemeObserver = null;
    this.disposeModel();
    this.editor?.dispose();
    this.editor = null;
    this.monacoApi = null;
  }

  private disposeModel(): void {
    this.editor?.setModel(null);
    this.model?.dispose();
    this.model = null;
    this.modelPath = null;
  }
}
