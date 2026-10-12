import {
  DestroyRef,
  Directive,
  EnvironmentInjector,
  Renderer2,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  effect,
  inject,
  input,
  untracked,
  type AfterRenderRef,
  type EmbeddedViewRef,
} from '@angular/core';

/**
 * Keeps one embedded view alive across a visibility condition. While the
 * condition is false the view is hidden at once, then taken out of the DOM and
 * out of change detection by a two-pass deferred detach: a `read`-phase fence
 * in the after-render pass that first observed the inactive state, and a
 * `write`-phase `detach()` in the pass after it. Activity-gated consumers inside
 * the view therefore see the inactive edge while their nodes are still in the
 * document. A return to `true` before the detach runs cancels it.
 */
@Directive({
  selector: '[ptahRetainWhile]',
  standalone: true,
})
export class RetainedViewDirective {
  readonly condition = input.required<boolean>({ alias: 'ptahRetainWhile' });

  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly container = inject(ViewContainerRef);
  private readonly renderer = inject(Renderer2);
  // Registering on the environment keeps the sequence off the retained view,
  // whose next refresh may never come while it is hidden.
  private readonly environment = inject(EnvironmentInjector);

  private view: EmbeddedViewRef<unknown> | null = null;
  private detached = false;
  private generation = 0;
  private pending: AfterRenderRef | null = null;

  constructor() {
    effect(() => {
      const retained = this.condition();
      untracked(() => (retained ? this.show() : this.hide()));
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  private show(): void {
    this.cancelPendingDetach();
    if (this.view === null) {
      this.view = this.container.createEmbeddedView(this.template);
      return;
    }
    if (this.detached) {
      this.container.insert(this.view);
      this.detached = false;
    }
    for (const element of this.rootElements()) {
      this.renderer.removeStyle(element, 'display');
    }
  }

  private hide(): void {
    if (this.view === null) return;
    for (const element of this.rootElements()) {
      this.renderer.setStyle(element, 'display', 'none');
    }
    this.cancelPendingDetach();
    const generation = this.generation;
    this.pending = afterNextRender(
      { read: (): void => this.fence(generation) },
      { injector: this.environment },
    );
  }

  /** Pass N: no DOM access. Hands over to the write-phase detach of pass N+1. */
  private fence(generation: number): void {
    if (generation !== this.generation) return;
    this.pending = afterNextRender(
      { write: (): void => this.detach(generation) },
      { injector: this.environment },
    );
  }

  private detach(generation: number): void {
    if (generation !== this.generation || this.view === null) return;
    this.pending = null;
    if (this.condition() || this.detached) return;
    const index = this.container.indexOf(this.view);
    if (index < 0) return;
    this.container.detach(index);
    this.detached = true;
  }

  private cancelPendingDetach(): void {
    this.generation++;
    this.pending?.destroy();
    this.pending = null;
  }

  private release(): void {
    this.cancelPendingDetach();
    // An attached view is destroyed with its container; a detached one is not.
    if (this.detached) this.view?.destroy();
    this.view = null;
  }

  private rootElements(): Element[] {
    const nodes: readonly unknown[] = this.view?.rootNodes ?? [];
    return nodes.filter((node): node is Element => node instanceof Element);
  }
}
