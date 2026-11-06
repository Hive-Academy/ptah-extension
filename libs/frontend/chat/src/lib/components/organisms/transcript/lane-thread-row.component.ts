import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CircleCheckBig, CircleX, MessageSquareText, UserRound, Bot, LucideAngularModule } from 'lucide-angular';
import type { LaneThreadEntry } from './lane-thread';

@Component({
  selector: 'ptah-lane-thread-row', standalone: true, imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="listitem" class="border-l-2 px-3 py-2 text-sm"
      [class.border-primary]="entry().sender === 'You'"
      [class.border-info]="entry().sender.startsWith('Parent agent')"
      [class.border-success]="entry().sender !== 'You' && !entry().sender.startsWith('Parent agent')"
      [class.border-error]="entry().kind === 'completion' && entry().verdict === 'Failed'"
      [class.text-error]="entry().kind === 'completion' && entry().verdict === 'Failed'"
      [attr.aria-label]="entry().sender + ', ' + absoluteTime() + ', ' + entry().kind">
      <div class="flex min-w-0 items-center gap-2">
        <lucide-angular [img]="icon()" class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate font-semibold">{{ entry().sender }}</span>
        <time class="shrink-0 text-xs text-base-content-muted" [attr.datetime]="iso()" [title]="absoluteTime()">{{ shortTime() }}</time>
        @if (receiptLabel()) {
          <span class="ml-auto inline-block w-40 shrink-0 text-right text-xs text-base-content-muted">{{ receiptLabel() }}</span>
        }
      </div>
      @if (entry().body) { <p class="mt-1 whitespace-pre-wrap break-words text-base-content">{{ entry().body }}</p> }
      @if (entry().verdict) { <p class="mt-1 text-xs font-medium">{{ entry().verdict }}</p> }
      @if (entry().parentSignal) {
        <p class="mt-1 text-xs" [class.text-warning]="entry().parentSignal === 'Waiting for parent' || entry().parentSignal?.startsWith('Expired')">{{ entry().parentSignal }}</p>
      }
    </div>
  `,
})
export class LaneThreadRowComponent {
  readonly entry = input.required<LaneThreadEntry>();
  readonly receiptLabel = input('');
  protected readonly YouIcon = UserRound;
  protected readonly ParentIcon = Bot;
  protected readonly ReportIcon = MessageSquareText;
  protected readonly DoneIcon = CircleCheckBig;
  protected readonly FailIcon = CircleX;
  protected icon() {
    if (this.entry().kind === 'report') return this.ReportIcon;
    if (this.entry().kind === 'completion') return this.entry().verdict === 'Failed' ? this.FailIcon : this.DoneIcon;
    return this.entry().sender === 'You' ? this.YouIcon : this.ParentIcon;
  }
  protected iso(): string { return new Date(this.entry().timestamp).toISOString(); }
  protected absoluteTime(): string { return new Date(this.entry().timestamp).toLocaleString(); }
  protected shortTime(): string { return new Date(this.entry().timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
}
