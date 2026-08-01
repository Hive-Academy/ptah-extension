import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';

/**
 * DetailDrawer — reusable right-side slide-over shell (design spec §4.5, §8.5).
 *
 * A dumb chrome component: a fixed backdrop + a `max-w-lg` panel that slides in
 * from the right. Body content is projected via `<ng-content>`; footer actions
 * via `<ng-content select="[drawerFooter]">`. Open/close is fully controlled by
 * the parent (`[open]` in, `(closed)` out) so it stays reusable beyond the
 * Failed-Webhooks triage view that first consumes it.
 *
 * Focus-safe: moves focus into the panel when it opens, closes on Escape and on
 * backdrop click, and marks the panel `role="dialog" aria-modal="true"`.
 */
@Component({
  selector: 'ptah-admin-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './detail-drawer.html',
})
export class DetailDrawer {
  /** Whether the drawer is currently open. */
  public readonly open = input<boolean>(false);

  /** Accessible title shown in the header and used as the dialog label. */
  public readonly title = input<string>('Details');

  /** Emitted on Escape, backdrop click, or the close button. */
  public readonly closed = output<void>();

  protected readonly CloseIcon = X;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  public constructor() {
    // Move focus into the panel each time it opens (focus-safe). The panel is
    // always mounted (slide is a CSS transform), so the ref is resolved by the
    // time `open` flips true.
    effect(() => {
      if (this.open()) {
        const el = this.panel()?.nativeElement;
        if (el) queueMicrotask(() => el.focus());
      }
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  }
}
