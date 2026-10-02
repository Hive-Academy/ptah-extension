import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  type ElementRef,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FileDiff,
  parseDiffFromFile,
  type FileContents,
  type FileDiffMetadata,
  type SupportedLanguages,
} from '@pierre/diffs';
import {
  createPierreDiffOptions,
  readDocumentThemeMode,
  registerPierreLanguages,
  type PierreThemeMode,
} from './pierre-config';

/**
 * TextDiffViewComponent — Unified read-only diff view for two in-memory strings
 * powered by `@pierre/diffs` (TASK_2026_576_e16a Requirement 8.3 / Batch 23).
 *
 * - Standalone and OnPush.
 * - Renders two text bodies in unified diff view without hunk toolbars or editing controls.
 * - Imperative `FileDiff` creation and cleanup in `afterRenderEffect`, disposed
 *   on destroy and on input change.
 * - Dispatches syntax-highlighting grammar registration via `registerPierreLanguages()`.
 * - Updates Pierre theme in place without recreating the diff instance.
 */
@Component({
  selector: 'ptah-text-diff-view',
  standalone: true,
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
  },
  template: `
    @if (error()) {
      <p
        class="px-2 py-1 text-xs text-base-content-muted"
        role="status"
        data-testid="text-diff-error"
      >
        This diff could not be displayed.
      </p>
    } @else if (unchanged()) {
      <p
        class="px-2 py-1 text-xs text-base-content-muted"
        role="status"
        data-testid="text-diff-unchanged"
      >
        No changes.
      </p>
    }
    <diffs-container #container class="block" />
  `,
})
export class TextDiffViewComponent {
  /** Left-hand side / original content. */
  readonly oldText = input<string | null>(null);

  /** Right-hand side / modified content. */
  readonly newText = input<string | null>(null);

  /** Optional file name, shown by Pierre and used to infer the language. */
  readonly fileName = input('');

  /**
   * Optional Shiki language id (e.g. `typescript`), forwarded as Pierre's
   * `FileContents.lang`; it takes precedence over the file-name inference.
   */
  readonly language = input<SupportedLanguages | ''>('');

  /**
   * Pierre theme mode. The default is read once at construction (same as
   * `PierreDiffHostComponent`); bind it to follow runtime theme switches.
   */
  readonly themeType = input<PierreThemeMode>(readDocumentThemeMode());

  private readonly _error = signal<string | null>(null);
  /** Holds parse or render error message, if any. */
  readonly error = this._error.asReadonly();

  private readonly _unchanged = signal(false);
  /** True when both sides parse to a diff with no hunks (identical texts). */
  readonly unchanged = this._unchanged.asReadonly();

  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('container');
  private instance: FileDiff | null = null;

  constructor() {
    registerPierreLanguages();

    // Content inputs: a fresh FileDiff per change; the cleanup disposes the
    // previous one first and runs again on destroy.
    afterRenderEffect((onCleanup) => {
      const container = this.container().nativeElement;
      const oldText = this.oldText();
      const newText = this.newText();
      const fileName = this.fileName();
      const language = this.language();

      untracked(() =>
        this.mount(container, { oldText, newText, fileName, language }),
      );
      onCleanup(() => this.dispose(container));
    });

    // Theme: applied to the live instance in place, no re-parse.
    afterRenderEffect(() => {
      const mode = this.themeType();
      untracked(() => this.instance?.setThemeType(mode));
    });
  }

  private mount(
    container: HTMLElement,
    source: {
      oldText: string | null;
      newText: string | null;
      fileName: string;
      language: SupportedLanguages | '';
    },
  ): void {
    // Nothing to compare yet (e.g. content still loading): stay an empty no-op.
    if (source.oldText === null && source.newText === null) {
      this._error.set(null);
      this._unchanged.set(false);
      return;
    }

    try {
      const name = source.fileName || 'untitled';
      const lang = source.language || undefined;
      const toFile = (contents: string | null): FileContents | null => {
        if (contents === null) return null;
        return lang ? { name, contents, lang } : { name, contents };
      };

      const fileDiff: FileDiffMetadata = parseDiffFromFile(
        toFile(source.oldText),
        toFile(source.newText),
        undefined,
        true,
      );

      this._error.set(null);
      if (fileDiff.hunks.length === 0) {
        this._unchanged.set(true);
        return;
      }
      this._unchanged.set(false);

      const instance = new FileDiff(
        createPierreDiffOptions('unified', untracked(this.themeType)),
        undefined,
        true,
      );
      this.instance = instance;
      instance.render({
        fileDiff,
        fileContainer: container,
      });
    } catch (err: unknown) {
      console.error('[TextDiffViewComponent] diff render failed', err);
      this._unchanged.set(false);
      this._error.set(err instanceof Error ? err.message : String(err));
    }
  }

  private dispose(container: HTMLElement): void {
    const instance = this.instance;
    this.instance = null;
    if (instance) {
      instance.cleanUp();
      container.shadowRoot?.replaceChildren();
    }
    this._error.set(null);
    this._unchanged.set(false);
  }
}
