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
import {
  LucideAngularModule,
  AlertTriangle,
  RefreshCw,
  Columns2,
  Rows2,
} from 'lucide-angular';
import type * as monaco from 'monaco-editor';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import type { EditorTab } from '../services/editor/editor-tab.types';
import { diffComparisonLabel } from '../services/editor/editor-tab.types';

type MonacoApi = typeof monaco;

type LoadState = 'loading' | 'ready' | 'error';

/** Both text models backing one diff tab, cached and reused across switches. */
interface DiffModelPair {
  original: monaco.editor.ITextModel;
  modified: monaco.editor.ITextModel;
}

/**
 * Backend setting key for the inline / side-by-side preference (D3).
 *
 * Served by the EXISTING `editor:getSetting` / `editor:updateSetting` pair on
 * all three hosts — D3 deliberately adds no new RPC method.
 */
const DIFF_LAYOUT_SETTING_KEY = 'editor.diff.renderSideBySide';

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
 * The component takes ONE diff input — the diff tab record — rather than three
 * loose strings. Everything the chrome needs (which comparison, whether a side
 * is absent, binary or failed, how fresh the read is) is carried on that record
 * by the backend, so nothing here has to infer state from content. In
 * particular "(new file)" is driven by `originalRef.kind === 'absent'`, NOT by
 * an empty original: a genuinely-empty tracked file is not a new file (A3 AC5).
 *
 * LIFECYCLE (B1/B2). The component is mounted for the whole session — the
 * editor panel hides it with `[class.invisible]` rather than unmounting it —
 * and the Monaco diff editor is created exactly ONCE. Switching diff tabs
 * swaps a cached model PAIR and restores that tab's view state; a content
 * update rewrites the existing models via `pushEditOperations`. Nothing here
 * ever reads `window.monaco`: the API handle comes from the loader promise, so
 * "updates still work with the global unavailable" (B2 AC4) is structural
 * rather than a behavioural promise.
 *
 * Model pairs are evicted when their tab closes, which is where this diverges
 * from `CodeEditorComponent` (that one deliberately retains evicted models,
 * because its tab content is cheap to re-open and its undo history is not).
 * The live-key set arrives as an input rather than by injecting `EditorService`,
 * so this stays a presentational component with no dependency on the editor
 * coordinator.
 */
@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="w-full h-full flex flex-col bg-base-100">
      <!-- Diff header bar: identity, chrome and freshness in one row. -->
      @if (showHeader() && diff(); as d) {
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

          <!--
            D3: layout toggle. aria-pressed describes the INLINE state, so the
            control reads as "inline diff view: off/on" rather than as an
            unlabelled two-state icon.
          -->
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto px-1.5 flex-shrink-0"
            data-testid="diff-layout-toggle"
            [attr.aria-pressed]="!renderSideBySide()"
            aria-label="Inline diff view"
            [attr.title]="
              renderSideBySide()
                ? 'Switch to inline diff view'
                : 'Switch to side-by-side diff view'
            "
            (click)="toggleRenderSideBySide()"
          >
            <lucide-angular
              [img]="renderSideBySide() ? Rows2Icon : Columns2Icon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-xs px-1.5 flex-shrink-0"
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
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Max number of cached model PAIRS (two models each) retained before LRU
   * eviction. Eviction-on-close already bounds the cache to the number of open
   * diff tabs, so this cap is a backstop; 30 matches B1 AC5's workload.
   */
  private static readonly MAX_DIFF_PAIRS = 30;
  private static instanceCounter = 0;

  /** The active diff tab, or null when no diff is being shown. */
  readonly diffTab = input<EditorTab | null>(null);

  /**
   * Keys of every diff tab currently open. A pair whose key leaves this set has
   * had its tab closed (or its whole workspace swapped out) and is disposed —
   * B1 AC5/AC6. Supplied by the panel so this component needs no reference to
   * `EditorService`.
   */
  readonly openDiffKeys = input<readonly string[]>([]);

  /**
   * Render the built-in git header bar (path, comparison chip, layout toggle,
   * retry). Non-git consumers — e.g. the Skills library's enhancement preview,
   * which reuses the Monaco diff surface for two in-memory bodies — supply
   * their own chrome and turn this off, so the panel never claims a bogus
   * `staged` / `working tree` provenance.
   *
   * @default true
   */
  readonly showHeader = input<boolean>(true);

  /** Emits the diff tab key when the user asks for a re-read. */
  readonly retryRequested = output<string>();

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly Columns2Icon = Columns2;
  protected readonly Rows2Icon = Rows2;

  private readonly editorContainer =
    viewChild.required<ElementRef<HTMLElement>>('editorContainer');

  private monacoApi: MonacoApi | null = null;
  private editor: monaco.editor.IStandaloneDiffEditor | null = null;
  /** Model pairs keyed by diff tab key. */
  private readonly pairs = new Map<string, DiffModelPair>();
  /** Per-tab diff view state (both sides' scroll + cursor), keyed by tab key. */
  private readonly viewStates = new Map<
    string,
    monaco.editor.IDiffEditorViewState
  >();
  /** Key of the pair currently attached to the editor, or null when detached. */
  private currentKey: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private destroyed = false;

  /**
   * Per-instance id namespacing model URIs. Monaco's model registry is keyed
   * globally by URI, so two diff surfaces showing the same tab must not collide.
   */
  private readonly instanceId = `dv-${(DiffViewComponent.instanceCounter++).toString(
    36,
  )}-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly loadState = signal<LoadState>('loading');
  protected readonly loadError = signal<string>('');

  /** D3: side-by-side (true) vs inline (false). Persisted per user. */
  protected readonly renderSideBySide = signal(true);

  /** The diff descriptor, or null when the input carries a non-diff tab. */
  protected readonly diff = computed(() => this.diffTab()?.diff ?? null);

  protected readonly tabKey = computed(() => this.diffTab()?.filePath ?? '');

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
    void this.loadLayoutPreference();

    afterNextRender(() => {
      this.loader
        .load()
        .then((monacoApi) => {
          if (this.destroyed) return;
          this.createEditor(monacoApi);
          // The effects below only fire on SUBSEQUENT changes, so reconcile
          // once against whatever the inputs already hold.
          this.syncDiff(this.diffTab());
          this.evictClosedPairs(this.openDiffKeys());
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

    // Declared BEFORE the eviction effect so that, in a flush where a tab is
    // closed, the closing tab is detached from the editor before its models are
    // disposed.
    effect(() => {
      const tab = this.diffTab();
      this.syncDiff(tab);
    });

    effect(() => {
      const keys = this.openDiffKeys();
      this.evictClosedPairs(keys);
    });

    effect(() => {
      const sideBySide = this.renderSideBySide();
      this.applyRenderSideBySide(sideBySide);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.currentKey = null;
    for (const key of [...this.pairs.keys()]) this.disposePair(key);
    this.viewStates.clear();
    try {
      this.editor?.dispose();
    } catch {
      // Monaco can throw if the editor was already disposed elsewhere.
      void 0;
    }
    this.editor = null;
    this.monacoApi = null;
  }

  private createEditor(monacoApi: MonacoApi): void {
    const container = this.editorContainer().nativeElement;
    this.monacoApi = monacoApi;

    this.ngZone.runOutsideAngular(() => {
      const editor = monacoApi.editor.createDiffEditor(container, {
        theme: this.detectMonacoTheme(),
        automaticLayout: false,
        // `readOnly` and `renderMarginRevertIcon` are PERMANENT (plan §4.3):
        // Monaco's built-in revert arrow edits the modified BUFFER, which is
        // the wrong mechanism for a git-backed diff. Hunk actions (D2) are
        // built as decorations instead, so no accidental edit is possible.
        readOnly: true,
        renderSideBySide: this.renderSideBySide(),
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

  // -------------------------------------------------------------------------
  // Model lifecycle (B1, B2)
  // -------------------------------------------------------------------------

  /**
   * Reconcile the editor with the given diff tab.
   *
   * Switching tabs attaches a CACHED model pair and restores that tab's own
   * view state; a content update rewrites the attached models in place. The
   * editor itself is never recreated, which is the whole of B1 AC1.
   */
  private syncDiff(tab: EditorTab | null): void {
    const api = this.monacoApi;
    const editor = this.editor;
    if (!api || !editor) return;

    const diff = tab?.diff ?? null;
    if (!tab || !diff) {
      // No diff active: detach, keeping the pair cached for the return trip.
      if (this.currentKey) {
        this.saveViewState(this.currentKey);
        this.currentKey = null;
      }
      editor.setModel(null);
      return;
    }

    const key = tab.filePath;
    const language = this.detectLanguage(diff.path);

    let pair = this.pairs.get(key);
    if (!pair) {
      pair = this.createPair(api, key, diff.original, diff.modified, language);
    } else {
      // B2 AC1/AC2/AC5: rewrite in place. No dispose, no recreate, so Monaco
      // re-tokenizes incrementally instead of flashing unstyled text, and a
      // burst of updates cannot leak models.
      this.applyText(pair.original, diff.original);
      this.applyText(pair.modified, diff.modified);
      this.applyLanguage(api, pair.original, language);
      this.applyLanguage(api, pair.modified, language);
    }

    if (this.currentKey !== key) {
      if (this.currentKey) this.saveViewState(this.currentKey);
      editor.setModel({ original: pair.original, modified: pair.modified });
      this.currentKey = key;
      this.restoreViewState(key);
      this.scheduleLayout();
    }

    // Touch for LRU recency.
    this.pairs.delete(key);
    this.pairs.set(key, pair);
    this.enforcePairCap(key);
  }

  private createPair(
    api: MonacoApi,
    key: string,
    original: string,
    modified: string,
    language: string,
  ): DiffModelPair {
    return {
      original: this.getOrCreateModel(api, key, 'original', original, language),
      modified: this.getOrCreateModel(api, key, 'modified', modified, language),
    };
  }

  private getOrCreateModel(
    api: MonacoApi,
    key: string,
    side: 'original' | 'modified',
    content: string,
    language: string,
  ): monaco.editor.ITextModel {
    const uri = api.Uri.parse(
      `ptah-diff://${this.instanceId}/${encodeURIComponent(key)}/${side}`,
    );
    const existing = api.editor.getModel(uri);
    if (existing) {
      this.applyText(existing, content);
      this.applyLanguage(api, existing, language);
      return existing;
    }
    return api.editor.createModel(content, language, uri);
  }

  /** Rewrite a model's whole text without disposing it (B2 AC1). */
  private applyText(model: monaco.editor.ITextModel, text: string): void {
    if (model.getValue() === text) return;
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text }],
      () => null,
    );
  }

  /** Re-tokenize in place when the tab's language changes (B2 AC3). */
  private applyLanguage(
    api: MonacoApi,
    model: monaco.editor.ITextModel,
    language: string,
  ): void {
    if (model.getLanguageId() === language) return;
    api.editor.setModelLanguage(model, language);
  }

  private enforcePairCap(justAddedKey: string): void {
    if (this.pairs.size <= DiffViewComponent.MAX_DIFF_PAIRS) return;
    for (const key of [...this.pairs.keys()]) {
      if (this.pairs.size <= DiffViewComponent.MAX_DIFF_PAIRS) break;
      if (key === justAddedKey || key === this.currentKey) continue;
      this.disposePair(key);
    }
  }

  /**
   * Drop every cached pair whose tab is gone (B1 AC5) — including the wholesale
   * `openTabs` replacement a workspace switch performs (B1 AC6).
   *
   * The attached pair is never evicted here: it is by definition the tab the
   * user is looking at, and detaching is `syncDiff`'s job.
   */
  private evictClosedPairs(openKeys: readonly string[]): void {
    if (!this.monacoApi) return;
    const live = new Set(openKeys);
    for (const key of [...this.pairs.keys()]) {
      if (live.has(key) || key === this.currentKey) continue;
      this.disposePair(key);
    }
  }

  private disposePair(key: string): void {
    const pair = this.pairs.get(key);
    this.pairs.delete(key);
    this.viewStates.delete(key);
    if (!pair) return;
    if (this.currentKey === key) {
      this.currentKey = null;
      this.editor?.setModel(null);
    }
    pair.original.dispose();
    pair.modified.dispose();
  }

  // -------------------------------------------------------------------------
  // View state (B1 AC3, AC4)
  // -------------------------------------------------------------------------

  private saveViewState(key: string): void {
    const state = this.editor?.saveViewState();
    if (state) this.viewStates.set(key, state);
  }

  private restoreViewState(key: string): void {
    const state = this.viewStates.get(key);
    if (state) this.editor?.restoreViewState(state);
  }

  /**
   * Relayout on the next animation frame.
   *
   * MUST be `requestAnimationFrame`, not a microtask: the panel hides this
   * component with `[class.invisible]`, and a microtask can run before Angular
   * has flushed the class removal to the DOM, at which point Monaco measures a
   * zero-sized (still hidden) container and renders nothing.
   */
  private scheduleLayout(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        if (this.destroyed) return;
        this.editor?.layout();
      });
    });
  }

  // -------------------------------------------------------------------------
  // D3 — inline / side-by-side layout
  // -------------------------------------------------------------------------

  protected toggleRenderSideBySide(): void {
    const next = !this.renderSideBySide();
    this.renderSideBySide.set(next);
    void this.persistLayoutPreference(next);
  }

  /** Swap layout on the LIVE editor — no recreation (D3 AC2, consistent with B1). */
  private applyRenderSideBySide(sideBySide: boolean): void {
    const editor = this.editor;
    if (!editor) return;
    const state = editor.saveViewState();
    editor.updateOptions({ renderSideBySide: sideBySide });
    if (state) editor.restoreViewState(state);
    this.scheduleLayout();
  }

  private async loadLayoutPreference(): Promise<void> {
    try {
      const result = await rpcCall<{ value?: boolean }>(
        this.vscodeService,
        'editor:getSetting',
        { key: DIFF_LAYOUT_SETTING_KEY },
      );
      if (this.destroyed) return;
      if (result.success && typeof result.data?.value === 'boolean') {
        this.renderSideBySide.set(result.data.value);
      }
    } catch {
      // A missing or unreadable preference is not an error worth surfacing —
      // side-by-side is the default and the toggle still works.
      void 0;
    }
  }

  private async persistLayoutPreference(sideBySide: boolean): Promise<void> {
    try {
      await rpcCall(this.vscodeService, 'editor:updateSetting', {
        key: DIFF_LAYOUT_SETTING_KEY,
        value: sideBySide,
      });
    } catch {
      void 0;
    }
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
