import { Injectable, signal, type TemplateRef } from '@angular/core';

/**
 * Where a lane's control row renders. A host that provides it (the canvas
 * focus area) shows the row in its header strip, beside the agent dock, so
 * the lane's column starts with the transcript as the main chat does. Without
 * a provider a lane renders the row above its transcript.
 */
@Injectable()
export class LaneControlsOutlet {
  private readonly current = signal<TemplateRef<unknown> | null>(null);
  readonly template = this.current.asReadonly();

  /** Show `template`; the returned function removes it again. */
  attach(template: TemplateRef<unknown>): () => void {
    this.current.set(template);
    return () => {
      if (this.current() === template) this.current.set(null);
    };
  }
}
