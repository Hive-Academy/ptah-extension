import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector,
  afterNextRender, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { AttachmentTrayComponent } from '@ptah-extension/chat';
import { PROPOSAL_SESSION_PRESENTATION } from './proposal-session-status';
import { ProposalFlowStore } from './proposal-flow.store';
import { ReplyDraftStore } from './reply-draft.store';

@Component({
  selector: 'ptah-answer-dock',
  standalone: true,
  imports: [CdkTrapFocus, AttachmentTrayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-x-8 bottom-0 z-40 rounded-t-[14px] border border-base-300 bg-base-100 p-3 min-[721px]:hidden" data-glass-surface="chrome">
      <button #bar type="button" class="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        aria-controls="answer-dock-sheet" [attr.aria-expanded]="open()" (click)="openSheet()">
        <span class="min-w-0 flex-1"><strong>{{ status() }}</strong><span class="ml-2 line-clamp-1 text-sm">Tell the agent what to change</span></span>
        <span class="btn btn-sm shrink-0 px-4">Reply</span>
      </button>
    </div>
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-end bg-neutral/70 min-[721px]:hidden" (click)="backdrop($event)">
        <section id="answer-dock-sheet" role="dialog" aria-modal="true" aria-labelledby="answer-dock-sheet-title"
          class="mx-8 w-[calc(100%-4rem)] rounded-t-[22px] border border-base-300 bg-base-100 p-5"
          data-glass-surface="content" cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (keydown.escape)="closeSheet()">
          <div class="flex items-center justify-between">
            <h2 id="answer-dock-sheet-title" class="font-semibold">Reply to the agent</h2>
            <button type="button" class="btn btn-sm" (click)="closeSheet()">Close</button>
          </div>
          <p class="mt-2 text-sm text-base-content-muted">{{ status() }}</p>
          <label for="dock-sheet-reply" class="sr-only">Reply to the agent</label>
          <textarea #sheetReply id="dock-sheet-reply" aria-describedby="dock-sheet-attachment-hint"
            class="textarea textarea-bordered mt-4 w-full" [value]="draft.reply()" (input)="onReply($event)"
            (paste)="draft.attachments.onPaste($event)" (dragover)="$event.preventDefault()"
            (drop)="draft.attachments.onDrop($event)"></textarea>
          <ptah-attachment-tray />
          <p id="dock-sheet-attachment-hint" class="text-xs text-base-content-muted">Attachments are not saved if you leave this page</p>
          <button type="button" class="btn btn-primary mt-3 disabled:!bg-base-200 disabled:!text-base-content-muted disabled:!opacity-100"
            [disabled]="!draft.canSend()" (click)="send()">Send reply</button>
        </section>
      </div>
    }
    <span class="sr-only" role="status" aria-live="polite">{{ draft.announcement() }}</span>
  `,
})
export class AnswerDockComponent {
  readonly draft = inject(ReplyDraftStore);
  private readonly store = inject(ProposalFlowStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  readonly background = input<readonly HTMLElement[]>([]);
  readonly open = signal(false);
  private readonly bar = viewChild<ElementRef<HTMLButtonElement>>('bar');
  private readonly sheetReply = viewChild<ElementRef<HTMLTextAreaElement>>('sheetReply');
  readonly status = () => PROPOSAL_SESSION_PRESENTATION[this.store.sessionStatus()].title;

  constructor() {
    effect(() => {
      for (const element of this.background()) element.inert = this.open();
    });
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const wide = window.matchMedia('(min-width: 721px)');
      const onWidthChange = () => { if (wide.matches && this.open()) this.closeSheet(); };
      wide.addEventListener('change', onWidthChange);
      this.destroyRef.onDestroy(() => wide.removeEventListener('change', onWidthChange));
    }
    this.destroyRef.onDestroy(() => {
      for (const element of this.background()) element.inert = false;
    });
  }
  onReply(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.draft.setReply(target.value);
  }
  openSheet(): void {
    this.open.set(true);
    afterNextRender(() => this.sheetReply()?.nativeElement.focus(), { injector: this.injector });
  }
  closeSheet(): void {
    this.open.set(false);
    afterNextRender(() => this.bar()?.nativeElement.focus(), { injector: this.injector });
  }
  backdrop(event: Event): void {
    if (event.target === event.currentTarget) this.closeSheet();
  }
  async send(): Promise<void> {
    if (await this.draft.send() && this.open()) this.closeSheet();
  }
}
