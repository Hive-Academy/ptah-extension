import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CircleCheckBig, CircleX, MessageSquareText, UserRound, Bot, LucideAngularModule } from 'lucide-angular';
import { DeliveryStatusComponent } from '../../molecules/delivery-status/delivery-status.component';
import type { LaneThreadEntry } from './lane-thread';

@Component({
  selector: 'ptah-lane-thread-row', standalone: true, imports: [LucideAngularModule, DeliveryStatusComponent],
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
      </div>
      @if (entry().body) { <p class="mt-1 whitespace-pre-wrap break-words text-base-content">{{ entry().body }}</p> }
      @if (entry().verdict) { <p class="mt-1 text-xs font-medium">{{ entry().verdict }}</p> }
      @if (entry().receipt; as receipt) {
        <ptah-delivery-status class="mt-1" [receipt]="receipt" [subject]="'message to ' + laneLabel()" />
      } @else if (entry().parentDelivery; as delivery) {
        <ptah-delivery-status class="mt-1" [parentDelivery]="delivery" [subject]="subject()" />
      }
    </div>
  `,
})
export class LaneThreadRowComponent {
  readonly entry = input.required<LaneThreadEntry>();
  /** Lane name used in the accessible names of the delivery actions. */
  readonly laneLabel = input('lane');
  protected readonly YouIcon = UserRound;
  protected readonly ParentIcon = Bot;
  protected readonly ReportIcon = MessageSquareText;
  protected readonly DoneIcon = CircleCheckBig;
  protected readonly FailIcon = CircleX;
  protected readonly subject = computed(() => `${this.entry().kind} from ${this.laneLabel()} to the parent`);
  protected icon() {
    if (this.entry().kind === 'report') return this.ReportIcon;
    if (this.entry().kind === 'completion') return this.entry().verdict === 'Failed' ? this.FailIcon : this.DoneIcon;
    return this.entry().sender === 'You' ? this.YouIcon : this.ParentIcon;
  }
  protected iso(): string { return new Date(this.entry().timestamp).toISOString(); }
  protected absoluteTime(): string { return new Date(this.entry().timestamp).toLocaleString(); }
  protected shortTime(): string { return new Date(this.entry().timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
}
