import { afterNextRender, type Injector, type Renderer2 } from '@angular/core';
import { selectVisibleEntrance } from './transcript-entrance';
import type { TranscriptSlotDirective } from './transcript-slot.directive';

const ENTER_CAP = 6;
const MAX_RECT_READS = 24;

interface EntranceSources {
  readonly injector: Injector;
  readonly renderer: Renderer2;
  readonly entering: () => boolean;
  readonly workActive: () => boolean;
  readonly historyReplaying: () => boolean;
  readonly slotCount: () => number;
  readonly scroller: () => HTMLElement | undefined;
  readonly slots: () => readonly TranscriptSlotDirective[];
  readonly pinnedToBottom: () => boolean;
  readonly savedScrollTop: () => number | null;
}

type Selection =
  | { readonly kind: 'pane'; readonly scroller: HTMLElement }
  | { readonly kind: 'slots'; readonly marks: readonly { element: HTMLElement; index: number }[] }
  | null;

/** One per transcript. Owns the read/write pass and all entrance marks. */
export class TranscriptSessionEntrance {
  private generation = 0;
  private wasEntering = false;
  private enteredSlots: HTMLElement[] = [];
  private enteredPane: HTMLElement | null = null;

  constructor(private readonly sources: EntranceSources) {}

  setEntering(entering: boolean): void {
    if (entering === this.wasEntering) return;
    this.wasEntering = entering;
    const generation = ++this.generation;
    if (!entering) {
      this.clear();
      return;
    }
    afterNextRender(
      {
        earlyRead: () => this.read(generation),
        write: (selection) => this.write(generation, selection),
      },
      { injector: this.sources.injector },
    );
  }

  destroy(): void {
    this.generation++;
    this.clear();
  }

  private read(generation: number): Selection {
    const s = this.sources;
    if (generation !== this.generation || !s.entering() || !s.workActive()) return null;
    if (s.historyReplaying() || s.slotCount() === 0) return null;
    const scroller = s.scroller();
    if (!scroller) return null;
    if (!s.pinnedToBottom() && s.savedScrollTop() !== null) {
      return { kind: 'pane', scroller };
    }

    // Activation restores the bottom in a later frame. Measure its future viewport.
    const rect = scroller.getBoundingClientRect();
    const offset = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const viewport = DOMRectReadOnly.fromRect({
      x: rect.x, y: rect.y + offset, width: rect.width, height: rect.height,
    });
    const slots = s.slots();
    const elements = new Map<string, HTMLElement>();
    // Build at most 24 lightweight adapters. The selector reads each rect only
    // when its newest-first walk reaches it, then stops at the cap or top edge.
    const newestFirst = Array.from(
      { length: Math.min(slots.length, MAX_RECT_READS) },
      (_, i) => {
        const slot = slots[slots.length - 1 - i];
        const id = slot.messageId();
        let measuredRect: DOMRectReadOnly | null = null;
        elements.set(id, slot.element);
        return {
          id,
          get rect(): DOMRectReadOnly {
            return measuredRect ??= slot.element.getBoundingClientRect();
          },
        };
      },
    );
    const ids = selectVisibleEntrance(viewport, newestFirst, ENTER_CAP);
    const marks = ids.flatMap((id, index) => {
      const element = elements.get(id);
      return element ? [{ element, index }] : [];
    });
    return { kind: 'slots', marks };
  }

  private write(generation: number, selection: Selection): void {
    const s = this.sources;
    if (!selection || generation !== this.generation || !s.entering() || !s.workActive()) return;
    if (selection.kind === 'pane') {
      s.renderer.addClass(selection.scroller, 'ptah-pane-enter');
      this.enteredPane = selection.scroller;
      return;
    }
    for (const { element, index } of selection.marks) {
      element.style.setProperty('--i', String(index));
      s.renderer.setAttribute(element, 'data-enter-i', String(index));
      s.renderer.addClass(element, 'ptah-turn-enter');
      this.enteredSlots.push(element);
    }
  }

  private clear(): void {
    for (const element of this.enteredSlots) {
      this.sources.renderer.removeClass(element, 'ptah-turn-enter');
      element.style.removeProperty('--i');
      this.sources.renderer.removeAttribute(element, 'data-enter-i');
    }
    this.enteredSlots = [];
    if (this.enteredPane) {
      this.sources.renderer.removeClass(this.enteredPane, 'ptah-pane-enter');
      this.enteredPane = null;
    }
  }
}
