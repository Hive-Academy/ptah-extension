import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  inject,
  untracked,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';
import { LucideAngularModule, Eye, Code } from 'lucide-angular';
import type * as monaco from 'monaco-editor';
import { VimModeService } from '../services/vim-mode.service';
import { EditorService } from '../services/editor.service';
import { MonacoLoaderService } from '../services/monaco-loader.service';

type MonacoApi = typeof monaco;

/**
 * CodeEditorComponent - Monaco editor with per-file model reuse.
 *
 * Complexity Level: 3 (direct Monaco lifecycle + per-file model/view-state
 * cache + external-vs-user edit reconciliation).
 *
 * Why it drives Monaco directly (like {@link DiffViewComponent}) instead of the
 * `<ngx-monaco-editor>` wrapper: the wrapper disposes and re-initialises the
 * whole editor whenever its `[options]` or `ngModel` setters fire. Because our
 * options were a `computed()` returning a fresh object and the content is
 * re-assigned on every file/workspace switch, that meant a full editor teardown
 * on every switch — the "files re-open with flicker" effect, plus lost undo
 * history and scroll/cursor position.
 *
 * Instead we:
 *   - create the editor exactly ONCE via `monaco.editor.create`,
 *   - keep a per-file `ITextModel` cache keyed by file path (LRU-capped),
 *   - `editor.setModel(cachedModel)` on switch (no teardown, undo preserved),
 *   - save/restore per-file view state so scroll/cursor survive switches,
 *   - reconcile external content changes (reverts, `editor:reread-open-tabs`)
 *     via `pushEditOperations` guarded against user-edit feedback loops.
 *
 * Content synchronisation contract with the parent/`EditorService` is unchanged:
 * user edits emit `contentChanged` (→ `updateTabContent`, marks the tab dirty);
 * Ctrl/Cmd+S emits `fileSaved`.
 */
@Component({
  selector: 'ptah-code-editor',
  standalone: true,
  imports: [MarkdownComponent, LucideAngularModule],
  template: `
    <div class="h-full w-full flex flex-col">
      @if (filePath()) {
        <div
          class="flex items-center gap-2 px-3 py-1.5 bg-base-300 border-b border-base-300 text-xs"
        >
          <span class="opacity-60 truncate" [attr.title]="filePath()">{{
            fileName()
          }}</span>
          @if (isDirty()) {
            <span class="badge badge-xs badge-warning">Modified</span>
          }
          <div class="ml-auto flex items-center">
            @if (isMarkdownFile()) {
              <button
                class="btn btn-ghost btn-xs gap-1"
                [attr.aria-label]="
                  showPreview() ? 'Switch to editor' : 'Switch to preview'
                "
                [title]="showPreview() ? 'Edit markdown' : 'Preview markdown'"
                (click)="togglePreview()"
              >
                <lucide-angular
                  [img]="showPreview() ? CodeIcon : EyeIcon"
                  class="w-3.5 h-3.5"
                />
                <span>{{ showPreview() ? 'Edit' : 'Preview' }}</span>
              </button>
            }
          </div>
        </div>
      }
      <div class="flex-1 min-h-0 relative" data-testid="editor-monaco">
        <!-- Monaco host is kept mounted at all times so the editor is created
             once (on first render) and never torn down on file/workspace
             switch. It is only visually hidden for the empty state or while the
             markdown preview is shown. -->
        <div
          #editorHost
          class="absolute inset-0"
          [class.invisible]="!filePath() || (showPreview() && isMarkdownFile())"
        ></div>
        @if (!filePath()) {
          <div
            class="absolute inset-0 flex items-center justify-center bg-base-100"
          >
            <div class="text-center opacity-40">
              <p class="text-lg mb-2">No file open</p>
              <p class="text-sm">
                Select a file from the explorer to start editing
              </p>
            </div>
          </div>
        } @else if (showPreview() && isMarkdownFile()) {
          <div
            class="absolute inset-0 overflow-y-auto bg-base-100 p-6 prose prose-invert max-w-none"
          >
            <markdown [data]="editorContent()" />
          </div>
        }
      </div>
      @if (vimModeService.enabled() && isFocused() && filePath()) {
        <div
          #vimStatusBar
          class="h-6 bg-base-300 border-t border-base-content/10 text-xs px-2 flex items-center font-mono text-base-content/70 flex-shrink-0"
          aria-label="Vim status"
        ></div>
      }
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
export class CodeEditorComponent {
  readonly filePath = input<string | undefined>(undefined);
  readonly content = input<string>('');

  /**
   * Whether this editor pane currently has focus.
   * When false, vim mode is detached from this instance.
   * Defaults to true for non-split (single pane) usage.
   */
  readonly isFocused = input(true);

  /**
   * Whether the incoming `content` represents the file's PERSISTED (on-disk)
   * state. Drives the local "Modified" badge's clean baseline.
   *
   * - `undefined` (default) — no information. Legacy behaviour: an incoming
   *   change to `content` is treated as a new clean baseline, which is correct
   *   for the only shapes a non-split editor ever sees (a revert, a re-read).
   *   Every caller outside the split-pane same-file case leaves it unset, so
   *   that path is byte-identical to before C2.
   * - `false` — `content` is an UNSAVED mirror of the sibling split pane. Apply
   *   it, but keep the existing baseline: the file really is modified, and
   *   adopting the mirror as clean would clear this pane's badge while the tab
   *   strip still (correctly) shows a dirty dot.
   * - `true` — `content` is the persisted state. Adopt it as the baseline even
   *   when the model already matches it, which is how the pane that did NOT
   *   issue the save clears its badge after the other pane saves (C2 AC4).
   */
  readonly contentIsPersisted = input<boolean | undefined>(undefined);

  readonly contentChanged = output<string>();
  readonly fileSaved = output<{ filePath: string; content: string }>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  protected readonly vimModeService = inject(VimModeService);
  private readonly editorService = inject(EditorService);
  private readonly loader = inject(MonacoLoaderService);

  /** Host element the Monaco editor mounts into. Always present in the DOM. */
  private readonly editorHost =
    viewChild<ElementRef<HTMLElement>>('editorHost');

  /** Reference to the vim status bar DOM element. */
  private readonly vimStatusBar =
    viewChild<ElementRef<HTMLElement>>('vimStatusBar');

  private static instanceCounter = 0;
  /**
   * Max number of cached models retained before LRU eviction.
   *
   * IMPORTANT: this budget is SHARED across all open workspaces — the cache
   * (`models`/`viewStates`/`baselines`) lives on the single persistent
   * component instance and is NOT partitioned per workspace. Eviction never
   * loses file content (that is held independently in `EditorService`'s
   * per-workspace `openTabs`); only Monaco's live undo buffer and scroll/cursor
   * view-state for the evicted file are dropped, and are rebuilt on next open.
   * The cap is set high (100) because models are lightweight text buffers, so
   * even heavy multi-workspace sessions rarely evict a file the user will
   * return to. Per-workspace partitioning is intentionally out of scope.
   */
  private static readonly MAX_MODELS = 100;

  private monacoApi: MonacoApi | null = null;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

  /** Per-file text-model cache keyed by normalized file path (LRU-capped). */
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  /** Per-file editor view state (scroll + cursor) keyed by normalized path. */
  private readonly viewStates = new Map<
    string,
    monaco.editor.ICodeEditorViewState
  >();
  /** Per-file clean baseline used to drive the local "Modified" badge. */
  private readonly baselines = new Map<string, string>();

  /** Normalized path of the model currently attached to the editor. */
  private currentModelPath: string | null = null;
  /** True while applying an external (non-user) content update to a model. */
  private applyingExternalEdit = false;

  private contentListener: monaco.IDisposable | null = null;
  private themeObserver: MutationObserver | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keydownTarget: HTMLElement | null = null;
  private destroyed = false;

  /**
   * Unique per-instance id used to namespace model URIs.
   *
   * The split editor mounts two component instances that can show the same
   * file, and Monaco's model registry is keyed GLOBALLY by URI: two instances
   * asking for the same URI would either collide ("model URI already in use")
   * or silently share one model, one undo stack and one cursor. Namespacing the
   * URI per instance gives each pane its own model identity — its own undo
   * history, selection and view state (C2 AC6).
   *
   * Model identity is all this buys. It is NOT an edit-independence policy:
   * since C2 the two panes no longer hold independent CONTENT for the same
   * file — the tab record owns that, both panes write through to it, and the
   * unfocused pane is mirrored from it.
   */
  private readonly instanceId = `ce-${(CodeEditorComponent.instanceCounter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  protected readonly editorContent = signal('');
  private lastSavedContent = '';

  readonly isDirty = signal(false);
  readonly showPreview = signal(false);
  readonly EyeIcon = Eye;
  readonly CodeIcon = Code;

  /** Whether the current file is a markdown file */
  readonly isMarkdownFile = computed(() => {
    const path = this.filePath();
    if (!path) return false;
    return path.toLowerCase().endsWith('.md');
  });

  readonly fileName = computed(() => {
    const path = this.filePath();
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  });

  constructor() {
    afterNextRender(() => {
      this.loader
        .load()
        .then((monacoApi) => {
          if (this.destroyed) return;
          this.createEditor(monacoApi);
          // Sync the current inputs now that the editor exists — the effect
          // below only re-runs on subsequent input changes.
          this.syncFile(this.filePath(), this.content());
        })
        .catch((err: unknown) => {
          // Monaco failing to load leaves the empty host in place — nothing to
          // recover here beyond not crashing the component.
          console.error(
            '[CodeEditorComponent] Monaco failed to load:',
            err instanceof Error ? err.message : String(err),
          );
        });
    });

    // React to file/content input changes. Reading both signals first keeps
    // them as dependencies even before the editor is ready.
    effect(() => {
      const path = this.filePath();
      const content = this.content();
      if (!this.editor) return;
      this.syncFile(path, content);
    });

    // Clean-baseline reconciliation for the split-pane same-file case (C2 AC4).
    //
    // When the OTHER pane saves, this pane's model already holds the saved text
    // (it was mirrored there) but its baseline still points at the last text it
    // was told was persisted, so its "Modified" badge would stay lit on a file
    // that is clean on disk. `contentIsPersisted` flipping to true is the
    // signal that whatever the shared file's panes are showing is now the
    // persisted state.
    //
    // This deliberately does NOT go through syncFile. syncFile compares the
    // `content` INPUT against the model, and in the primary pane that input
    // (`activeFileContent`) is intentionally stale while the user types —
    // re-running it on a dirty-flag change would push that stale text over the
    // user's edits. Baselines only; content is never touched here.
    effect(() => {
      const persisted = this.contentIsPersisted();
      if (persisted !== true) return;
      untracked(() => {
        const key = this.currentModelPath;
        const model = this.editor?.getModel();
        if (key === null || !model) return;
        const value = model.getValue();
        if (this.baselines.get(key) === value) return;
        this.baselines.set(key, value);
        this.lastSavedContent = value;
        this.isDirty.set(false);
      });
    });

    // Vim attach/detach follows enabled + focus, using the real editor.
    effect(() => {
      const enabled = this.vimModeService.enabled();
      const focused = this.isFocused();
      if (enabled && focused && this.editor) {
        Promise.resolve().then(() => {
          const bar = this.vimStatusBar()?.nativeElement;
          if (bar && this.editor) {
            this.vimModeService.attachToEditor(this.editor, bar);
          }
        });
      } else if (!enabled || !focused) {
        this.vimModeService.detach();
      }
    });

    // One-shot reveal-line coordination from the EditorService.
    effect(() => {
      const line = this.editorService.targetLine();
      if (line !== undefined && this.editor) {
        this.editor.revealLineInCenter(line);
        this.editor.setPosition({ lineNumber: line, column: 1 });
        this.editorService.clearTargetLine();
      }
    });

    this.destroyRef.onDestroy(() => this.dispose());
  }

  private createEditor(monacoApi: MonacoApi): void {
    const host = this.editorHost()?.nativeElement;
    if (!host) return;
    this.monacoApi = monacoApi;

    this.ngZone.runOutsideAngular(() => {
      const editor = monacoApi.editor.create(host, {
        theme: this.detectMonacoTheme(),
        automaticLayout: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: true },
        fontSize: 14,
        wordWrap: 'on',
        readOnly: false,
        model: null,
      });
      this.editor = editor;

      // Single editor-level content listener — fires for whichever model is
      // attached. Distinguishes user edits (emit + dirty) from our own
      // programmatic external updates (silent).
      this.contentListener = editor.onDidChangeModelContent(() =>
        this.onModelContentChange(),
      );

      this.attachKeydownHandler(host);

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

    if (this.vimModeService.enabled() && this.isFocused()) {
      Promise.resolve().then(() => {
        const bar = this.vimStatusBar()?.nativeElement;
        if (bar && this.editor) {
          this.vimModeService.attachToEditor(this.editor, bar);
        }
      });
    }
  }

  /**
   * Reconcile the editor with the given file path + external content.
   *
   * Handles file/workspace switches (setModel to a cached or new model, restore
   * view state) and external content updates for the active file (revert /
   * reread — apply via pushEditOperations, preserving undo). Never recreates
   * the editor.
   */
  private syncFile(path: string | undefined, content: string): void {
    if (!this.editor || !this.monacoApi) return;

    // No active file: detach the model and show the empty host.
    if (!path) {
      if (this.currentModelPath) {
        this.saveViewState(this.currentModelPath);
      }
      this.editor.setModel(null);
      this.currentModelPath = null;
      this.editorContent.set('');
      this.lastSavedContent = '';
      this.isDirty.set(false);
      return;
    }

    const key = this.normalizePath(path);
    const language = this.detectLanguage(path);

    let model = this.models.get(key);
    const isNewModel = !model;
    if (!model) {
      model = this.getOrCreateModel(key, content, language);
      this.baselines.set(key, content);
    }

    // Model switch: persist outgoing view state, attach the new model, restore
    // its view state. setModel does not fire a content-change event, so no
    // spurious contentChanged emission occurs here.
    if (this.currentModelPath !== key) {
      if (this.currentModelPath) {
        this.saveViewState(this.currentModelPath);
      }
      this.editor.setModel(model);
      this.restoreViewState(key);
      this.currentModelPath = key;
    }
    // Touch for LRU recency.
    this.models.delete(key);
    this.models.set(key, model);

    if (model.getLanguageId() !== language) {
      this.monacoApi.editor.setModelLanguage(model, language);
    }

    // External content update for an existing model (revert, reread, or a
    // mirror of the sibling split pane): a full-model replacement, so it MUST
    // NOT be reachable from this pane's own keystrokes or it would move the
    // cursor to the end of the buffer and flatten the undo stack.
    //
    // What keeps it unreachable is that nothing writes this pane's own edits
    // back into its `content` input. A user edit emits `contentChanged`, which
    // the panel routes to the TAB RECORD; the tab record is mirrored back out
    // only into the pane that does NOT have focus (C2). The one write into a
    // focused pane is the reconciliation on a focus CHANGE, which carries the
    // other pane's text and happens before the user can type.
    //
    // So any divergence seen here is still an outside change we must apply.
    if (!isNewModel && content !== model.getValue()) {
      // A mirror of the other pane's unsaved text is not a clean baseline.
      // Read untracked: the surrounding effect must depend on `filePath` and
      // `content` ONLY. Taking a dependency on the dirty-derived
      // `contentIsPersisted` would re-run syncFile on the first keystroke in
      // the primary pane, where `content` is the deliberately stale
      // `activeFileContent` — and push it straight over that keystroke.
      if (untracked(() => this.contentIsPersisted()) !== false) {
        this.baselines.set(key, content);
      }
      this.applyingExternalEdit = true;
      try {
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: content }],
          () => null,
        );
      } finally {
        this.applyingExternalEdit = false;
      }
    }

    // Mirror the previous effect's reset of transient UI on external/switch.
    this.showPreview.set(false);
    const value = model.getValue();
    this.editorContent.set(value);
    this.lastSavedContent = this.baselines.get(key) ?? value;
    this.isDirty.set(value !== this.lastSavedContent);
  }

  private getOrCreateModel(
    key: string,
    content: string,
    language: string,
  ): monaco.editor.ITextModel {
    const api = this.monacoApi;
    if (!api) throw new Error('Monaco API not loaded');
    const uri = api.Uri.parse(
      `ptah-model://${this.instanceId}/${encodeURIComponent(key)}`,
    );
    const existing = api.editor.getModel(uri);
    const model = existing ?? api.editor.createModel(content, language, uri);
    this.models.set(key, model);
    this.enforceModelCap(key);
    return model;
  }

  private enforceModelCap(justAddedKey: string): void {
    if (this.models.size <= CodeEditorComponent.MAX_MODELS) return;
    for (const key of [...this.models.keys()]) {
      if (this.models.size <= CodeEditorComponent.MAX_MODELS) break;
      if (key === justAddedKey || key === this.currentModelPath) continue;
      this.models.get(key)?.dispose();
      this.models.delete(key);
      this.viewStates.delete(key);
      this.baselines.delete(key);
    }
  }

  private saveViewState(key: string): void {
    const state = this.editor?.saveViewState();
    if (state) this.viewStates.set(key, state);
  }

  private restoreViewState(key: string): void {
    const state = this.viewStates.get(key);
    if (state) this.editor?.restoreViewState(state);
  }

  /**
   * Editor content changed. For user edits this updates the preview mirror,
   * recomputes the local dirty badge, and emits `contentChanged` so the parent
   * marks the tab dirty. Programmatic external updates are silent (no emit).
   */
  private onModelContentChange(): void {
    const model = this.editor?.getModel();
    if (!model) return;
    const value = model.getValue();
    this.ngZone.run(() => {
      this.editorContent.set(value);
      this.isDirty.set(value !== this.lastSavedContent);
    });
    if (this.applyingExternalEdit) return;
    this.contentChanged.emit(value);
  }

  private attachKeydownHandler(target: HTMLElement): void {
    if (this.keydownTarget === target) return;
    this.detachKeydownHandler();
    this.keydownHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        if (this.isFocused() && this.filePath()) {
          event.preventDefault();
          this.ngZone.run(() => this.saveFile());
        }
      }
    };
    target.addEventListener('keydown', this.keydownHandler);
    this.keydownTarget = target;
  }

  private detachKeydownHandler(): void {
    if (this.keydownHandler && this.keydownTarget) {
      this.keydownTarget.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = null;
    this.keydownTarget = null;
  }

  protected togglePreview(): void {
    const next = !this.showPreview();
    this.showPreview.set(next);
    // Coming back from preview: the host was hidden (invisible); relayout so
    // Monaco recomputes dimensions. Use requestAnimationFrame (not a bare
    // microtask) so layout() runs AFTER Angular flushes the `invisible` class
    // removal to the DOM — a microtask can fire before the DOM update lands,
    // leaving Monaco measuring stale (still-hidden) dimensions.
    if (!next && this.editor) {
      requestAnimationFrame(() => this.editor?.layout());
    }
  }

  private saveFile(): void {
    const path = this.filePath();
    if (!path) return;
    const value = this.editor?.getModel()?.getValue() ?? this.editorContent();
    this.lastSavedContent = value;
    if (this.currentModelPath) {
      this.baselines.set(this.currentModelPath, value);
    }
    this.isDirty.set(false);
    this.fileSaved.emit({ filePath: path, content: value });
  }

  private dispose(): void {
    this.destroyed = true;
    this.detachKeydownHandler();
    this.vimModeService.detach();
    this.contentListener?.dispose();
    this.contentListener = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    this.viewStates.clear();
    this.baselines.clear();
    this.currentModelPath = null;
    try {
      this.editor?.dispose();
    } catch {
      // Monaco can throw if the editor was already disposed elsewhere.
      void 0;
    }
    this.editor = null;
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  /**
   * Detect the Monaco theme from the host environment, mirroring
   * {@link DiffViewComponent} so both surfaces stay visually consistent.
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

  private detectLanguage(filePath?: string): string {
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
