import {
  Component,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  effect,
  OnDestroy,
  NgZone,
  inject,
  afterNextRender,
  ChangeDetectorRef,
} from '@angular/core';
import { LucideAngularModule, AlertTriangle, RefreshCw } from 'lucide-angular';
import type * as monaco from 'monaco-editor';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import type { EditorTab } from '../services/editor/editor-tab.types';
import { diffComparisonLabel } from '../services/editor/editor-tab.types';

type MonacoApi = typeof monaco;

type LoadState = 'loading' | 'ready' | 'error';

/**
 * DiffViewComponent - Direct Monaco diff editor for side-by-side file comparison.
 *
 * Uses Monaco's createDiffEditor API directly rather than the
 * `<ngx-monaco-diff-editor>` wrapper because that wrapper disposes and
 * re-initialises the editor on every model setter call (flicker + tokenizer
 * thrash on streaming diffs). Loading is coordinated with the ngx wrapper
 * through `MonacoLoaderService` (shared via `window.monaco`), so this
 * component renders correctly even when it is the first Monaco surface to
 * mount in the session.
 *
 * The component takes ONE input — the diff tab record — rather than three
 * loose strings. Everything the chrome needs (which comparison, whether a side
 * is absent, binary or failed, how fresh the read is) is carried on that record
 * by the backend, so nothing here has to infer state from content. In
 * particular "(new file)" is driven by `originalRef.kind === 'absent'`, NOT by
 * an empty original: a genuinely-empty tracked file is not a new file (A3 AC5).
 */
@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="w-full h-full flex flex-col bg-base-100">
      <!-- Diff header bar: identity, chrome and freshness in one row. -->
      @if (diff(); as d) {
        <div
          class="flex items-center gap-2 px-2 py-1 text-xs bg-base-200 border-b border-base-content/10 flex-shrink-0"
          role="status"
          [attr.aria-label]="headerAriaLabel()"
        >
          <span class="truncate font-medium" [attr.title]="pathTitle()">{{
            d.path
          }}</span>

          @if (isRename()) {
            <span class="opacity-50 truncate text-[10px]"
              >renamed from {{ d.originalPath }}</span
            >
          }

          <span
            class="px-1.5 py-0.5 rounded bg-base-content/10 opacity-70 flex-shrink-0"
            >{{ comparisonLabel() }}</span
          >

          @if (chromeLabel(); as chrome) {
            <span
              class="px-1.5 py-0.5 rounded bg-base-content/10 flex-shrink-0"
              data-testid="diff-chrome"
              >{{ chrome }}</span
            >
          }

          @if (statusLabel(); as status) {
            <span
              class="flex items-center gap-1 flex-shrink-0"
              [class.text-error]="d.status === 'error'"
              [class.text-warning]="d.status === 'stale'"
              [class.opacity-60]="d.status === 'refreshing'"
              data-testid="diff-status-chip"
              [attr.title]="d.errorMessage"
            >
              @if (d.status !== 'refreshing') {
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              }
              {{ status }}
            </span>
          }

          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto px-1.5 flex-shrink-0"
            data-testid="diff-retry"
            title="Re-read this comparison from git"
            aria-label="Retry reading this diff from git"
            [disabled]="d.status === 'refreshing'"
            (click)="retryRequested.emit(tabKey())"
          >
            <lucide-angular [img]="RefreshCwIcon" class="w-3 h-3" />
          </button>
        </div>
      }

      <div class="flex-1 min-h-0 relative">
        <div #editorContainer class="w-full h-full"></div>

        @if (loadState() === 'loading') {
          <div
            class="absolute inset-0 flex items-center justify-center text-sm text-base-content/60 pointer-events-none"
          >
            <span class="loading loading-spinner loading-sm mr-2"></span>
            Loading diff editor…
          </div>
        } @else if (loadState() === 'error') {
          <div
            class="absolute inset-0 flex flex-col items-center justify-center p-4 text-sm text-error gap-2"
          >
            <span class="font-medium">Failed to load diff editor</span>
            <span class="text-xs text-base-content/60 max-w-md text-center">
              {{ loadError() }}
            </span>
          </div>
        }

        <!--
          Persistent overlays (NOT toasts) — A1 AC7 requires the indicator to
          stay until the condition clears. A failed git read is never rendered
          as content, so the overlay is opaque.
        -->
        @if (gitError(); as message) {
          <div
            class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-base-100"
            data-testid="diff-error-overlay"
            role="alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-5 h-5 text-error"
              aria-hidden="true"
            />
            <span class="text-sm text-error font-medium text-center max-w-md">{{
              message
            }}</span>
            @if (gitErrorDetail(); as detail) {
              <span
                class="text-xs text-base-content/60 max-w-md text-center break-all"
                >{{ detail }}</span
              >
            }
            <button
              type="button"
              class="btn btn-xs btn-outline mt-1"
              data-testid="diff-error-retry"
              (click)="retryRequested.emit(tabKey())"
            >
              Retry
            </button>
          </div>
        } @else if (isBinary()) {
          <div
            class="absolute inset-0 flex items-center justify-center p-4 bg-base-100 text-sm text-base-content/60"
            data-testid="diff-binary-overlay"
          >
            Binary file — diff not shown
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffViewComponent implements OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly loader = inject(MonacoLoaderService);

  /** The active diff tab, or null when no diff is being shown. */
  readonly diffTab = input<EditorTab | null>(null);

  /** Emits the diff tab key when the user asks for a re-read. */
  readonly retryRequested = output<string>();

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;

  private readonly editorContainer =
    viewChild.required<ElementRef<HTMLElement>>('editorContainer');

  private editor: monaco.editor.IStandaloneDiffEditor | null = null;
  private originalModel: monaco.editor.ITextModel | null = null;
  private modifiedModel: monaco.editor.ITextModel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private destroyed = false;

  protected readonly loadState = signal<LoadState>('loading');
  protected readonly loadError = signal<string>('');

  /** The diff descriptor, or null when the input carries a non-diff tab. */
  protected readonly diff = computed(() => this.diffTab()?.diff ?? null);

  protected readonly tabKey = computed(() => this.diffTab()?.filePath ?? '');

  protected readonly originalContent = computed(
    () => this.diff()?.original ?? '',
  );
  protected readonly modifiedContent = computed(
    () => this.diff()?.modified ?? '',
  );

  private readonly language = computed(() =>
    this.detectLanguage(this.diff()?.path ?? ''),
  );

  protected readonly comparisonLabel = computed(() => {
    const d = this.diff();
    return d ? diffComparisonLabel(d.comparison) : '';
  });

  protected readonly isRename = computed(() => {
    const d = this.diff();
    return !!d && d.originalPath !== d.path;
  });

  protected readonly pathTitle = computed(() => {
    const d = this.diff();
    if (!d) return '';
    return d.originalPath === d.path ? d.path : `${d.originalPath} → ${d.path}`;
  });

  /**
   * A file that exists on only one side of the comparison.
   *
   * Driven exclusively by the resolved refs. Deriving this from
   * `original === ''` is the defect A3 AC5 names: an empty tracked file would
   * masquerade as a newly-added one.
   */
  protected readonly isNewFile = computed(
    () => this.diff()?.originalRef.kind === 'absent',
  );

  protected readonly isDeleted = computed(
    () => this.diff()?.modifiedRef.kind === 'absent',
  );

  protected readonly isBinary = computed(() => this.diff()?.isBinary === true);

  /** True when both sides resolved and are byte-identical (e.g. after discard). */
  protected readonly hasNoChanges = computed(() => {
    const d = this.diff();
    if (!d || d.isBinary) return false;
    if (d.originalRef.kind === 'absent' || d.modifiedRef.kind === 'absent') {
      return false;
    }
    return d.original === d.modified;
  });

  /**
   * The single chrome chip describing the shape of this diff.
   *
   * Suppressed entirely while the status is `error`: if a side could not be
   * read, the refs describe nothing, and claiming "deleted" or "new file" off
   * placeholder refs would be exactly the kind of fabricated state A3 exists
   * to remove.
   */
  protected readonly chromeLabel = computed(() => {
    if (this.diff()?.status === 'error') return '';
    if (this.isBinary()) return 'binary';
    if (this.isDeleted()) return 'deleted';
    if (this.isNewFile()) return 'new file';
    if (this.hasNoChanges()) return 'no changes';
    return '';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.diff()?.status) {
      case 'refreshing':
        return 'refreshing…';
      case 'stale':
        return 'stale';
      case 'error':
        return 'error';
      default:
        return '';
    }
  });

  /** Message for the persistent error overlay; null when the read succeeded. */
  protected readonly gitError = computed(() => {
    const d = this.diff();
    if (!d || d.status !== 'error') return null;
    return d.errorMessage ?? 'Git could not read this file.';
  });

  protected readonly gitErrorDetail = computed(() =>
    this.diff()?.status === 'error' ? (this.diff()?.errorDetail ?? '') : '',
  );

  protected readonly headerAriaLabel = computed(() => {
    const d = this.diff();
    if (!d) return '';
    const chrome = this.chromeLabel();
    const status = this.statusLabel();
    return [
      `Diff of ${d.path}`,
      `${this.comparisonLabel()} comparison`,
      chrome,
      status,
    ]
      .filter(Boolean)
      .join(', ');
  });

  constructor() {
    afterNextRender(() => {
      this.loader
        .load()
        .then((monacoApi) => {
          if (this.destroyed) return;
          this.createEditor(monacoApi);
          this.loadState.set('ready');
          this.cdr.markForCheck();
        })
        .catch((err: unknown) => {
          if (this.destroyed) return;
          this.loadState.set('error');
          this.loadError.set(
            err instanceof Error ? err.message : String(err ?? 'Unknown error'),
          );
          this.cdr.markForCheck();
        });
    });

    effect(() => {
      const original = this.originalContent();
      const modified = this.modifiedContent();
      const lang = this.language();
      if (this.editor) {
        this.updateModels(original, modified, lang);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.disposeModels();
    this.editor?.dispose();
    this.editor = null;
  }

  private createEditor(monacoApi: MonacoApi): void {
    const container = this.editorContainer().nativeElement;
    const lang = this.language();
    const original = this.originalContent();
    const modified = this.modifiedContent();

    const originalModel = monacoApi.editor.createModel(original, lang);
    const modifiedModel = monacoApi.editor.createModel(modified, lang);
    this.originalModel = originalModel;
    this.modifiedModel = modifiedModel;

    this.ngZone.runOutsideAngular(() => {
      const editor = monacoApi.editor.createDiffEditor(container, {
        theme: this.detectMonacoTheme(),
        automaticLayout: false,
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        ignoreTrimWhitespace: false,
        minimap: { enabled: false },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      });
      this.editor = editor;

      editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      this.resizeObserver = new ResizeObserver(() => {
        this.editor?.layout();
      });
      this.resizeObserver.observe(container);
      if (typeof document !== 'undefined') {
        this.themeObserver = new MutationObserver(() => {
          monacoApi.editor.setTheme(this.detectMonacoTheme());
        });
        this.themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-vscode-theme-kind', 'data-theme'],
        });
      }
    });
  }

  /**
   * Detect the appropriate Monaco theme based on the host environment:
   * 1. `data-vscode-theme-kind` (VS Code webview): `vscode-light` -> `vs`,
   *    `vscode-high-contrast` -> `hc-black`, `vscode-dark` -> `vs-dark`.
   * 2. `data-theme` (DaisyUI fallback): `light` -> `vs`, anything else -> `vs-dark`.
   * Returns `'vs-dark'` as the default and SSR-safe value when document is not available.
   */
  private detectMonacoTheme(): string {
    if (typeof document === 'undefined') return 'vs-dark';

    const vscodeKind = document.body.getAttribute('data-vscode-theme-kind');
    if (vscodeKind === 'vscode-light') return 'vs';
    if (vscodeKind === 'vscode-high-contrast') return 'hc-black';
    if (vscodeKind === 'vscode-dark') return 'vs-dark';

    const dataTheme = document.body.getAttribute('data-theme');
    if (dataTheme === 'light') return 'vs';

    return 'vs-dark';
  }

  private updateModels(original: string, modified: string, lang: string): void {
    const monacoApi = (window as Window & { monaco?: MonacoApi }).monaco;
    if (!monacoApi) return;

    this.disposeModels();

    const originalModel = monacoApi.editor.createModel(original, lang);
    const modifiedModel = monacoApi.editor.createModel(modified, lang);
    this.originalModel = originalModel;
    this.modifiedModel = modifiedModel;

    this.editor?.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  }

  private disposeModels(): void {
    this.originalModel?.dispose();
    this.modifiedModel?.dispose();
    this.originalModel = null;
    this.modifiedModel = null;
  }

  private detectLanguage(filePath: string): string {
    if (!filePath) return 'plaintext';
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      svg: 'xml',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      ps1: 'powershell',
      dockerfile: 'dockerfile',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      env: 'dotenv',
      graphql: 'graphql',
      gql: 'graphql',
      r: 'r',
      lua: 'lua',
      dart: 'dart',
      vue: 'html',
      svelte: 'html',
    };
    return languageMap[ext ?? ''] ?? 'plaintext';
  }
}
