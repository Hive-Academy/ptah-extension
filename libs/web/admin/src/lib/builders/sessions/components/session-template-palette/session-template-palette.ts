import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Draggable } from 'fullcalendar/interaction';

import type { SessionTemplate } from '../../session-templates';

/**
 * SessionTemplatePalette — the row of cohort chips an admin drags onto the
 * calendar to schedule a session.
 *
 * The chips are ordinary DOM. FullCalendar's `Draggable` attaches native drag
 * behaviour to them and hands the drop off to any calendar with
 * `droppable: true`, which is why this component needs no reference to the
 * calendar and the two can sit anywhere on the page relative to each other.
 *
 * `Draggable` is imperative and lives outside Angular's lifecycle, so it is
 * built once the container exists and torn down in `ngOnDestroy`. Without that
 * teardown its document-level pointer listeners would outlive the component and
 * keep firing after the admin routed away.
 *
 * Clicking a chip does the same thing as dragging it to "now-ish" — the
 * keyboard and touch path to the same outcome, since a drag is not operable
 * without a pointer.
 */
@Component({
  selector: 'ptah-admin-session-template-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-template-palette.html',
})
export class SessionTemplatePalette implements OnDestroy {
  public readonly templates = input.required<SessionTemplate[]>();

  /** A chip was activated by click/keyboard rather than dragged. */
  public readonly templatePicked = output<SessionTemplate>();

  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('paletteContainer');

  private draggable: Draggable | null = null;

  public constructor() {
    effect(() => {
      const host = this.container().nativeElement;
      // Rebuilt whenever the chip set changes: Draggable resolves its items
      // through `itemSelector` at drag time, but re-registering keeps its
      // internal element cache from holding nodes Angular has since removed.
      this.draggable?.destroy();
      this.draggable = new Draggable(host, {
        itemSelector: '[data-session-template]',
        eventData: (el: HTMLElement) => ({
          title: el.dataset['templateTitle'] ?? '',
          duration: { minutes: Number(el.dataset['templateDuration'] ?? 60) },
          color: el.dataset['templateColor'],
          // Read back in the calendar's `eventReceive` to recover which chip
          // was dropped — FullCalendar carries `extendedProps` through the drag
          // but not arbitrary element state.
          extendedProps: { templateId: el.dataset['sessionTemplate'] },
        }),
      });
      // Referencing templates() registers the dependency that drives the rebuild.
      void this.templates();
    });
  }

  public ngOnDestroy(): void {
    this.draggable?.destroy();
    this.draggable = null;
  }

  protected onPick(template: SessionTemplate): void {
    this.templatePicked.emit(template);
  }
}
