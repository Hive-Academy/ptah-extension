import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ProposalFlowStore } from './proposal-flow.store';

@Component({
  selector: 'ptah-answer-dock',
  standalone: true,
  imports: [CdkTrapFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="hidden min-[721px]:block min-[861px]:sticky min-[861px]:top-4 min-[861px]:w-[300px]"
      aria-labelledby="dock-title"
      data-testid="answer-dock"
    >
      <div
        class="space-y-3 rounded-[22px] border border-base-300 p-4"
        data-glass-surface="content"
      >
        <h2 id="dock-title" class="font-semibold">Reply to the agent</h2>
        <p class="text-sm text-base-content-muted">{{ status() }}</p>
        @if (message()) {
          <p class="line-clamp-5 whitespace-pre-wrap text-sm">
            {{ message() }}
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            (click)="showFull()"
          >
            Show full message
          </button>
        }
        <label for="dock-reply" class="sr-only">Reply to the agent</label
        ><textarea
          #desktopReply
          id="dock-reply"
          class="textarea textarea-bordered w-full"
          [value]="reply()"
          (input)="onReply($event)"
        ></textarea
        ><button
          type="button"
          class="btn btn-primary btn-sm disabled:!bg-base-200 disabled:!text-base-content-muted disabled:!opacity-100"
          [disabled]="!reply().trim() || sending()"
          (click)="send()"
        >
          Send reply
        </button>
      </div>
    </aside>
    <div
      class="fixed inset-x-8 bottom-0 z-40 rounded-t-[14px] border border-base-300 bg-base-100 p-3 min-[721px]:hidden"
      data-glass-surface="chrome"
    >
      <button
        #bar
        type="button"
        class="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        aria-controls="answer-dock-sheet"
        [attr.aria-expanded]="open()"
        (click)="openSheet()"
      >
        <span class="min-w-0 flex-1"
          ><strong>{{ status() }}</strong
          ><span class="ml-2 line-clamp-1 text-sm">{{
            message() || 'Tell the agent what to change'
          }}</span></span
        ><span class="btn btn-sm shrink-0 px-4">Reply</span>
      </button>
    </div>
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-end bg-neutral/70 min-[721px]:hidden"
        (click)="backdrop($event)"
      >
        <section
          id="answer-dock-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="answer-dock-sheet-title"
          class="mx-8 w-[calc(100%-4rem)] rounded-t-[22px] border border-base-300 bg-base-100 p-5"
          data-glass-surface="content"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          (keydown.escape)="closeSheet()"
        >
          <div class="flex items-center justify-between">
            <h2 id="answer-dock-sheet-title" class="font-semibold">
              Reply to the agent
            </h2>
            <button type="button" class="btn btn-sm" (click)="closeSheet()">
              Close
            </button>
          </div>
          <p class="mt-2 text-sm text-base-content-muted">{{ status() }}</p>
          @if (message()) {
            <p class="mt-3 max-h-32 overflow-auto whitespace-pre-wrap text-sm">
              {{ message() }}
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="showFull()"
            >
              Show full message
            </button>
          }
          <label for="dock-sheet-reply" class="sr-only"
            >Reply to the agent</label
          ><textarea
            #sheetReply
            id="dock-sheet-reply"
            class="textarea textarea-bordered mt-4 w-full"
            [value]="reply()"
            (input)="onReply($event)"
          ></textarea
          ><button
            type="button"
            class="btn btn-primary mt-3 disabled:!bg-base-200 disabled:!text-base-content-muted disabled:!opacity-100"
            [disabled]="!reply().trim() || sending()"
            (click)="send()"
          >
            Send reply
          </button>
        </section>
      </div>
    }
    <span class="sr-only" role="status" aria-live="polite">{{
      announcement()
    }}</span>
  `,
})
export class AnswerDockComponent {
  private readonly store = inject(ProposalFlowStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  readonly background = input<readonly HTMLElement[]>([]);
  readonly showDetails = output<void>();
  readonly open = signal(false);
  readonly reply = signal('');
  readonly sending = signal(false);
  readonly announcement = signal('');
  private readonly bar = viewChild<ElementRef<HTMLButtonElement>>('bar');
  private readonly sheetReply =
    viewChild<ElementRef<HTMLTextAreaElement>>('sheetReply');
  private readonly desktopReply =
    viewChild<ElementRef<HTMLTextAreaElement>>('desktopReply');
  readonly message = () =>
    this.store.session.latestAssistantMessage()?.text ?? '';
  readonly status = () =>
    this.store.session.phase() === 'failed'
      ? 'Not connected'
      : this.store.session.phase() === 'busy' ||
          this.store.session.phase() === 'sending'
        ? 'Agent is working'
        : this.message()
          ? 'Agent replied'
          : 'Ready to reply';
  constructor() {
    effect(() => {
      for (const element of this.background()) element.inert = this.open();
    });
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const wide = window.matchMedia('(min-width: 721px)');
      const onWidthChange = () => {
        if (wide.matches && this.open()) this.closeSheet();
      };
      wide.addEventListener('change', onWidthChange);
      this.destroyRef.onDestroy(() =>
        wide.removeEventListener('change', onWidthChange),
      );
    }
    this.destroyRef.onDestroy(() => {
      for (const element of this.background()) element.inert = false;
    });
  }
  onReply(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.reply.set(target.value);
  }
  openSheet(): void {
    this.open.set(true);
    afterNextRender(() => this.sheetReply()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
  prefill(text: string): void {
    this.reply.set(text);
    if (typeof window !== 'undefined' && window.innerWidth <= 720)
      this.openSheet();
    else this.desktopReply()?.nativeElement.focus();
  }
  closeSheet(): void {
    this.open.set(false);
    afterNextRender(() => this.bar()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
  showFull(): void {
    if (this.open()) {
      this.open.set(false);
      afterNextRender(() => this.showDetails.emit(), {
        injector: this.injector,
      });
    } else this.showDetails.emit();
  }
  backdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeSheet();
  }
  async send(): Promise<void> {
    const text = this.reply().trim();
    if (!text || this.sending()) return;
    this.sending.set(true);
    const sent = await this.store.session.send(text);
    if (this.destroyRef.destroyed) return;
    this.sending.set(false);
    if (sent) {
      this.reply.set('');
      this.announcement.set('Reply sent');
      if (this.open()) this.closeSheet();
    } else this.announcement.set('Reply could not be sent. Try again.');
  }
}
