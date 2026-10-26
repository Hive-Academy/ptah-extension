import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ThemeService } from '@ptah-extension/core';
import {
  PACK_DIFF_UNAVAILABLE,
  WHAT_CHANGES_LABEL,
  WIZARD_DIFF_UNAVAILABLE,
} from './preview-decisions.state';

/**
 * The `TextDiffViewComponent` inputs set here, declared structurally so no
 * value or type is imported from `@ptah-extension/git-ui` (the import is
 * runtime-only to keep `@pierre/diffs` out of the wizard's static graph).
 */
interface TextDiffInputs {
  oldText: string;
  newText: string;
  fileName: string;
  themeType: 'light' | 'dark';
}

type DiffLoadState = 'idle' | 'loading' | 'ready' | 'error';

let nextDiffRegionId = 0;

/**
 * C3 DiffDisclosure: the "What changes" button and its region.
 *
 * - Wizard rows (`mode="unavailable"`): the region says the generated content
 *   is not known until generation runs.
 * - Pack rows (`mode="diff"`): the first expand loads
 *   `@ptah-extension/git-ui/diff-renderer` through a runtime `import()` (as
 *   `skill-synthesis-ui`'s lazy diff view does) and renders local vs incoming
 *   text. A failed load, or missing text, falls back to the unavailable state.
 *
 * The collapsed region is `hidden`, so dialog traps that skip `[hidden] *`
 * exclude it.
 */
@Component({
  selector: 'ptah-diff-disclosure',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="cursor-pointer bg-transparent px-0 py-0.5 text-xs text-base-content underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
      data-testid="diff-toggle"
      [attr.aria-expanded]="expanded()"
      [attr.aria-controls]="regionId"
      (click)="toggle()"
    >
      {{ label }}
    </button>
    <div
      class="mt-1.5 w-full basis-full overflow-hidden rounded-md border border-surface-border bg-surface-1 font-mono text-[11px]"
      data-testid="diff-region"
      [id]="regionId"
      [hidden]="!expanded()"
      [attr.aria-busy]="loadState() === 'loading' ? 'true' : null"
    >
      <ng-container #diffHost />
      @if (unavailableText(); as text) {
        <p
          class="px-2 py-1 text-base-content-muted"
          data-testid="diff-unavailable"
        >
          {{ text }}
        </p>
      } @else if (loadState() === 'loading' || loadState() === 'idle') {
        <p
          class="px-2 py-1 text-base-content-muted"
          role="status"
          data-testid="diff-loading"
        >
          Loading differences...
        </p>
      }
    </div>
  `,
  host: { class: 'contents' },
})
export class DiffDisclosureComponent {
  private readonly themeService = inject(ThemeService);

  /** `unavailable` for wizard rows; `diff` for pack rows with known bytes. */
  public readonly mode = input.required<'unavailable' | 'diff'>();
  /** File name; the renderer infers the highlight language from it. */
  public readonly fileName = input('');
  /** Current local text. */
  public readonly original = input<string | undefined>(undefined);
  /** Incoming text. */
  public readonly modified = input<string | undefined>(undefined);

  protected readonly label = WHAT_CHANGES_LABEL;
  protected readonly regionId = `ptah-diff-region-${++nextDiffRegionId}`;
  protected readonly expanded = signal(false);
  protected readonly loadState = signal<DiffLoadState>('idle');

  private readonly diffHost = viewChild.required('diffHost', {
    read: ViewContainerRef,
  });

  private readonly themeType = computed<'light' | 'dark'>(() =>
    this.themeService.isDarkMode() ? 'dark' : 'light',
  );

  /** Text pair for the renderer, or null when a diff cannot be shown. */
  private readonly texts = computed<TextDiffInputs | null>(() => {
    const original = this.original();
    const modified = this.modified();
    if (
      this.mode() !== 'diff' ||
      original === undefined ||
      modified === undefined
    )
      return null;
    return {
      oldText: original,
      newText: modified,
      fileName: this.fileName(),
      themeType: this.themeType(),
    };
  });

  protected readonly unavailableText = computed<string | null>(() => {
    if (this.mode() === 'unavailable') return WIZARD_DIFF_UNAVAILABLE;
    if (!this.texts() || this.loadState() === 'error')
      return PACK_DIFF_UNAVAILABLE;
    return null;
  });

  private componentRef: ComponentRef<unknown> | null = null;
  private loadToken = 0;
  /** Texts whose renderer load failed; a retry waits for different texts. */
  private failedFor: TextDiffInputs | null = null;

  public constructor() {
    effect(() => {
      const inputs = this.texts();
      if (!this.expanded() || !inputs) return;
      if (this.componentRef) {
        this.applyInputs(this.componentRef, inputs);
        return;
      }
      // Untracked: a failed load must not re-trigger itself. It stays in the
      // unavailable state until the texts change (a re-planned row).
      const state = untracked(this.loadState);
      if (state === 'loading') return;
      if (state === 'error' && this.failedFor === inputs) return;
      void this.load();
    });

    inject(DestroyRef).onDestroy(() => {
      this.loadToken++;
      this.componentRef?.destroy();
      this.componentRef = null;
    });
  }

  protected toggle(): void {
    this.expanded.update((value) => !value);
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loadState.set('loading');
    try {
      const rendererModule =
        await import('@ptah-extension/git-ui/diff-renderer');
      if (token !== this.loadToken) return;
      const inputs = this.texts();
      if (!inputs) {
        this.loadState.set('idle');
        return;
      }
      const host = this.diffHost();
      host.clear();
      const ref = host.createComponent(rendererModule.TextDiffViewComponent);
      this.applyInputs(ref, inputs);
      ref.changeDetectorRef.detectChanges();
      this.componentRef = ref;
      this.loadState.set('ready');
    } catch {
      // degradation-audit: reported - a renderer that fails to load shows the
      // row's "unavailable" text; the keep/replace choice is unaffected.
      if (token !== this.loadToken) return;
      this.failedFor = untracked(this.texts);
      this.loadState.set('error');
    }
  }

  private applyInputs(
    ref: ComponentRef<unknown>,
    inputs: TextDiffInputs,
  ): void {
    ref.setInput('oldText', inputs.oldText);
    ref.setInput('newText', inputs.newText);
    ref.setInput('fileName', inputs.fileName);
    ref.setInput('themeType', inputs.themeType);
  }
}
