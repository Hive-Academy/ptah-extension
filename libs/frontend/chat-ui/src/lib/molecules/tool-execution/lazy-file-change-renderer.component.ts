import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ComponentRef,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  ViewContainerRef,
  viewChild,
} from '@angular/core';
import type { FileChange } from '@ptah-extension/shared';
import type { PierreDiffHostComponent } from '@ptah-extension/git-ui/diff-renderer';

/** Keeps Pierre outside the eager chat bundle and mounts one file per host. */
@Component({
  selector: 'ptah-lazy-file-change-renderer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container #host />
    @if (fallback()) {
      <pre class="overflow-auto whitespace-pre-wrap break-words p-2 text-xs text-base-content">{{ change().diff || 'No patch text available.' }}</pre>
    }
  `,
})
export class LazyFileChangeRendererComponent {
  readonly change = input.required<FileChange>();
  readonly patch = input<string | null>(null);
  private readonly host = viewChild.required('host', { read: ViewContainerRef });
  private readonly renderer = signal<ComponentRef<PierreDiffHostComponent> | null>(null);
  protected readonly fallback = signal(false);
  /** Bumped on destroy so a load that resolves later does not mount. */
  private loadToken = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.loadToken++;
      this.renderer()?.destroy();
      this.renderer.set(null);
    });
    afterNextRender(() => void this.mount());
    effect(() => {
      const renderer = this.renderer();
      if (renderer?.instance.mappingError()) {
        this.host().clear();
        this.fallback.set(true);
      }
    });
  }

  private async mount(): Promise<void> {
    const change = this.change();
    if (!change.diff || (change.kind.type === 'update' && !this.patch())) {
      this.fallback.set(true);
      return;
    }
    const token = ++this.loadToken;
    try {
      const { PierreDiffHostComponent } =
        await import('@ptah-extension/git-ui/diff-renderer');
      if (token !== this.loadToken) return;
      const ref = this.host().createComponent(PierreDiffHostComponent);
      ref.setInput('fileName', change.path);
      ref.setInput('diffStyle', 'unified');
      if (change.kind.type === 'update') {
        ref.setInput('patch', this.patch());
      } else {
        ref.setInput('oldText', change.kind.type === 'delete' ? change.diff : '');
        ref.setInput('newText', change.kind.type === 'add' ? change.diff : '');
      }
      ref.changeDetectorRef.detectChanges();
      this.renderer.set(ref);
    } catch {
      // degradation-audit: reported - if Pierre cannot load, the raw escaped
      // patch text stays visible instead of the rendered diff.
      if (token !== this.loadToken) return;
      this.fallback.set(true);
    }
  }
}
