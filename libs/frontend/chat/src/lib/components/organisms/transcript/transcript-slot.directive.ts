import {
  Directive,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { TranscriptRenderWindow } from './transcript-render-window';

/**
 * TranscriptSlotDirective — attaches one transcript slot element to the
 * `TranscriptRenderWindow`'s observer for the life of that element, and
 * detaches it on destroy. It holds no policy: the window decides what mounts.
 *
 * Applied to the persistent per-message wrapper in the transcript's `@for`, so
 * the observed element survives its bubble being unmounted — otherwise an
 * unmounted message could never be observed back into the window.
 *
 * A missing `TranscriptRenderWindow` throws at construction. There is no silent
 * no-op path: a directive that quietly stopped registering would produce a
 * transcript that mounts only its tail and looks like data loss.
 */
@Directive({
  selector: '[ptahTranscriptSlot]',
})
export class TranscriptSlotDirective {
  private readonly renderWindow = inject(TranscriptRenderWindow);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Id of the message this slot holds. */
  readonly messageId = input.required<string>({ alias: 'ptahTranscriptSlot' });

  constructor() {
    effect(() => {
      const id = this.messageId();
      untracked(() => {
        this.renderWindow.register(id, this.host.nativeElement);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.renderWindow.unregister(this.host.nativeElement);
    });
  }
}
