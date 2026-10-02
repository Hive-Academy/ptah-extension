/**
 * LazyDiffViewComponent — in-memory text diff, loaded only when a diff is asked
 * for.
 *
 * The renderer is `TextDiffViewComponent` from the
 * `@ptah-extension/git-ui/diff-renderer` secondary entry, which carries
 * `@pierre/diffs` and its syntax grammars. The Skills tab must not inherit that
 * bundle just because a drawer *can* show a diff, so the real component is
 * pulled in through a runtime `import()` and instantiated imperatively into a
 * `ViewContainerRef`. Nothing here is reachable from the Skills tab's static
 * import graph (the library's lint config forbids a static git-ui import).
 *
 * It is deliberately imperative rather than an `@defer` block: `@defer` would
 * still put `TextDiffViewComponent` in this component's static `imports`, which
 * drags `@ptah-extension/git-ui` into every unit test of this library.
 *
 * The diff is between two IN-MEMORY bodies (current vs proposed, or current vs
 * a history snapshot), rendered unified with no git header; the caller supplies
 * the surrounding context. Identical bodies render the renderer's own
 * "No changes." note.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  OnDestroy,
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

/** Load state of the dynamically-imported renderer chunk. */
type DiffLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The `TextDiffViewComponent` inputs this component sets. Declared
 * structurally so no value or type has to be imported from
 * `@ptah-extension/git-ui` (which would defeat the lazy boundary).
 */
interface TextDiffInputs {
  oldText: string;
  newText: string;
  fileName: string;
  themeType: 'light' | 'dark';
}

@Component({
  selector: 'ptah-lazy-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative h-full w-full" data-testid="lazy-diff-root">
      <ng-container #diffHost />

      @if (state() === 'loading' || state() === 'idle') {
        <div
          class="flex h-full min-h-[12rem] items-center justify-center gap-2 text-sm text-base-content-muted"
          role="status"
          data-testid="lazy-diff-loading"
        >
          <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
          Loading diff…
        </div>
      } @else if (state() === 'error') {
        <div
          class="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 p-4 text-center"
          role="alert"
          data-testid="lazy-diff-error"
        >
          <span class="text-sm font-medium text-error"
            >Could not load the diff viewer</span
          >
          <span class="max-w-md text-xs text-base-content-muted">{{
            errorMessage()
          }}</span>
          <button
            type="button"
            class="btn btn-outline btn-xs"
            data-testid="lazy-diff-retry"
            (click)="reload()"
          >
            Retry
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 12rem;
      }
    `,
  ],
})
export class LazyDiffViewComponent implements OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeService = inject(ThemeService);

  /** File name of the diffed body; Pierre infers the highlight language from it. */
  public readonly label = input.required<string>();

  /** Left-hand side. */
  public readonly original = input.required<string>();

  /** Right-hand side. */
  public readonly modified = input.required<string>();

  private readonly diffHost = viewChild.required('diffHost', {
    read: ViewContainerRef,
  });

  /** Follows the app theme so a runtime theme switch recolours the diff. */
  private readonly themeType = computed<'light' | 'dark'>(() =>
    this.themeService.isDarkMode() ? 'dark' : 'light',
  );

  protected readonly state = signal<DiffLoadState>('idle');
  protected readonly errorMessage = signal<string>('');

  private componentRef: ComponentRef<unknown> | null = null;
  private loadToken = 0;

  public constructor() {
    effect(() => {
      // Track every input so a body or theme change re-pushes the inputs.
      const inputs = this.currentInputs();
      if (this.componentRef) {
        this.applyInputs(this.componentRef, inputs);
        return;
      }
      // Untracked: reading `state` here would re-run this effect when a load
      // fails and retry the import in a loop. A failed load waits for Retry
      // or the next input change.
      const state = untracked(this.state);
      if (state === 'idle' || state === 'error') {
        void this.load(inputs);
      }
    });

    this.destroyRef.onDestroy(() => this.disposeComponent());
  }

  protected reload(): void {
    this.state.set('idle');
    void this.load(this.currentInputs());
  }

  private async load(inputs: TextDiffInputs): Promise<void> {
    const token = ++this.loadToken;
    this.state.set('loading');
    try {
      const rendererModule = await import(
        '@ptah-extension/git-ui/diff-renderer'
      );
      if (token !== this.loadToken) return;

      const host = this.diffHost();
      host.clear();
      const ref = host.createComponent(rendererModule.TextDiffViewComponent);
      this.applyInputs(ref, inputs);
      ref.changeDetectorRef.detectChanges();
      this.componentRef = ref;
      this.state.set('ready');
    } catch (error: unknown) {
      if (token !== this.loadToken) return;
      this.errorMessage.set(
        error instanceof Error ? error.message : String(error),
      );
      this.state.set('error');
    }
  }

  private currentInputs(): TextDiffInputs {
    return {
      oldText: this.original(),
      newText: this.modified(),
      fileName: this.label(),
      themeType: this.themeType(),
    };
  }

  private applyInputs(ref: ComponentRef<unknown>, inputs: TextDiffInputs): void {
    ref.setInput('oldText', inputs.oldText);
    ref.setInput('newText', inputs.newText);
    ref.setInput('fileName', inputs.fileName);
    ref.setInput('themeType', inputs.themeType);
  }

  private disposeComponent(): void {
    this.componentRef?.destroy();
    this.componentRef = null;
  }

  public ngOnDestroy(): void {
    this.loadToken++;
    this.disposeComponent();
  }
}
