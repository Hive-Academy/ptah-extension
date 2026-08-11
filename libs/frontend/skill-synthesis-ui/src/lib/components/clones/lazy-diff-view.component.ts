/**
 * LazyDiffViewComponent — Monaco diff, loaded only when a diff is asked for.
 *
 * `DiffViewComponent` lives in `@ptah-extension/editor`, which pulls Monaco,
 * xterm and the whole editor surface. The Skills tab must not inherit that
 * bundle just because a drawer *can* show a diff, so the real component is
 * pulled in through a runtime `import()` and instantiated imperatively into a
 * `ViewContainerRef`. Nothing here is reachable from the Skills tab's static
 * import graph.
 *
 * It is deliberately imperative rather than an `@defer` block: `@defer` would
 * still put `DiffViewComponent` in this component's static `imports`, which
 * drags `@ptah-extension/editor` into every unit test of this library.
 *
 * The diff itself is between two IN-MEMORY bodies (current vs proposed, or
 * current vs a history snapshot), so the synthetic tab record is marked
 * `fresh`, non-binary, with both sides present — `DiffViewComponent` renders an
 * error overlay for any other combination. Its git header is switched off; the
 * caller supplies the surrounding context instead.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  OnDestroy,
  ViewContainerRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

/** Load state of the dynamically-imported editor chunk. */
type DiffLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The subset of `DiffViewComponent`'s `diffTab` input this component builds.
 * Declared structurally so the type never has to be imported from
 * `@ptah-extension/editor` (which would defeat the lazy boundary).
 */
interface SyntheticDiffTab {
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  diff: {
    comparison: 'worktree';
    path: string;
    originalPath: string;
    original: string;
    modified: string;
    originalRef: { kind: 'worktree' };
    modifiedRef: { kind: 'worktree' };
    snapshotToken: string;
    isBinary: false;
    status: 'fresh';
    requestId: number;
  };
}

let diffCounter = 0;

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
          data-testid="lazy-diff-loading"
        >
          <span class="loading loading-spinner loading-sm"></span>
          Loading diff editor…
        </div>
      } @else if (state() === 'error') {
        <div
          class="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 p-4 text-center"
          role="alert"
          data-testid="lazy-diff-error"
        >
          <span class="text-sm font-medium text-error"
            >Could not load the diff editor</span
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

  /** Label used as the diff's file identity (shown in Monaco's model URIs). */
  public readonly label = input.required<string>();

  /** Left-hand side. */
  public readonly original = input.required<string>();

  /** Right-hand side. */
  public readonly modified = input.required<string>();

  private readonly diffHost = viewChild.required('diffHost', {
    read: ViewContainerRef,
  });

  protected readonly state = signal<DiffLoadState>('idle');
  protected readonly errorMessage = signal<string>('');

  private componentRef: ComponentRef<unknown> | null = null;
  private readonly instanceId = `skill-diff-${diffCounter++}`;
  private requestId = 0;
  private loadToken = 0;

  public constructor() {
    effect(() => {
      // Track every input so a body change re-pushes the tab record.
      const tab = this.buildTab(this.label(), this.original(), this.modified());
      if (this.componentRef) {
        this.componentRef.setInput('diffTab', tab);
        this.componentRef.setInput('openDiffKeys', [tab.filePath]);
        return;
      }
      if (this.state() === 'idle' || this.state() === 'error') {
        void this.load(tab);
      }
    });

    this.destroyRef.onDestroy(() => this.disposeComponent());
  }

  protected reload(): void {
    this.state.set('idle');
    void this.load(
      this.buildTab(this.label(), this.original(), this.modified()),
    );
  }

  private async load(tab: SyntheticDiffTab): Promise<void> {
    const token = ++this.loadToken;
    this.state.set('loading');
    try {
      const editorModule = await import('@ptah-extension/editor');
      if (token !== this.loadToken) return;

      const host = this.diffHost();
      host.clear();
      const ref = host.createComponent(editorModule.DiffViewComponent);
      ref.setInput('diffTab', tab);
      ref.setInput('openDiffKeys', [tab.filePath]);
      ref.setInput('showHeader', false);
      ref.changeDetectorRef.detectChanges();
      this.componentRef = ref as unknown as ComponentRef<unknown>;
      this.state.set('ready');
    } catch (error: unknown) {
      if (token !== this.loadToken) return;
      this.errorMessage.set(
        error instanceof Error ? error.message : String(error),
      );
      this.state.set('error');
    }
  }

  private buildTab(
    label: string,
    original: string,
    modified: string,
  ): SyntheticDiffTab {
    const path = `${this.instanceId}/${label}`;
    return {
      filePath: `diff:worktree:${path}`,
      fileName: label,
      content: modified,
      isDirty: false,
      diff: {
        comparison: 'worktree',
        path,
        originalPath: path,
        original,
        modified,
        originalRef: { kind: 'worktree' },
        modifiedRef: { kind: 'worktree' },
        // Non-empty: an empty token is how the editor flags "never reached a
        // real read", which would render this as an error overlay.
        snapshotToken: `${this.instanceId}:${++this.requestId}`,
        isBinary: false,
        status: 'fresh',
        requestId: this.requestId,
      },
    };
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
