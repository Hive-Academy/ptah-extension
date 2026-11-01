import { Directive, ElementRef, inject, input, OnChanges, signal } from '@angular/core';
import { ENTRANCE_CAP, isTailSwap, planEntrance } from './transcript-entrance';

interface MessageIdentity {
  readonly id: string;
}

@Directive({
  selector: '[ptahTranscriptMotion]',
  exportAs: 'ptahTranscriptMotion',
})
export class TranscriptMotionDirective implements OnChanges {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly messages = input.required<readonly MessageIdentity[]>({
    alias: 'ptahTranscriptMotion',
  });
  readonly active = input.required<boolean>();
  readonly suppressed = input(false);
  readonly historyReplaying = input(false);
  readonly pinnedToBottom = input(false);

  private previousIds: readonly string[] = [];
  private wasActive = false;
  private readonly entrances = signal<ReadonlyMap<string, number>>(new Map());

  enterClass(id: string): string {
    return this.entrances().has(id) ? 'ptah-msg-enter' : '';
  }

  index(id: string): number | null {
    return this.entrances().get(id) ?? null;
  }

  ngOnChanges(): void {
    // Read the old DOM before Angular reconciles the descendant @for.
    const nextIds = this.messages().map((message) => message.id);
    const nextSet = new Set(nextIds);
    const active = this.active();
    // A first open batch may land on the activation edge. Catch-up appends to
    // an already populated tab still stay quiet.
    const activationCatchUp = !this.wasActive && active &&
      this.previousIds.some((id) => nextSet.has(id));
    const suppressed = this.suppressed() || !active || activationCatchUp;
    const next = planEntrance({
      previousIds: this.previousIds,
      nextIds,
      suppressed,
      replaying: this.historyReplaying(),
      pinned: this.pinnedToBottom(),
      cap: ENTRANCE_CAP,
    });
    const entrances = new Map<string, number>();
    for (const [id, index] of this.entrances()) {
      if (nextSet.has(id)) entrances.set(id, index);
    }
    for (const [id, index] of next) {
      if (!entrances.has(id)) entrances.set(id, index);
    }
    this.entrances.set(entrances);

    const removed = new Set(this.previousIds.filter((id) => !nextSet.has(id)));
    if (removed.size > 0) {
      const previousSet = new Set(this.previousIds);
      const replacement = nextIds.length > 0 && !nextIds.some((id) => previousSet.has(id));
      const cutAll = replacement || isTailSwap(this.previousIds, nextIds) ||
        suppressed || removed.size > ENTRANCE_CAP;
      const root = this.host.nativeElement;
      const rootRect = cutAll ? null : root.getBoundingClientRect();
      for (const item of root.querySelectorAll<HTMLElement>('.chat-msg-item[data-ptah-msg-item]')) {
        const id = item.dataset['ptahMsgItem'];
        if (!id || !removed.has(id)) continue;
        item.setAttribute('inert', '');
        item.setAttribute('aria-hidden', 'true');
        item.setAttribute('data-ptah-leaving', '');
        if (cutAll || (rootRect && !intersects(item.getBoundingClientRect(), rootRect))) {
          item.setAttribute('data-ptah-leave-cut', '');
        }
      }
    }

    this.previousIds = nextIds;
    this.wasActive = active;
  }
}

function intersects(item: DOMRect, root: DOMRect): boolean {
  return item.bottom > root.top && item.top < root.bottom;
}
