import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';
import { CircleCheck, CircleDashed, LucideAngularModule, MessageCircleQuestion, TrendingUp } from 'lucide-angular';
import type { StatusCounts } from './scene-placement';

@Component({
  selector: 'ptah-command-status-groups',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './command-status-groups.component.css',
  template: `
    <section class="groups" aria-label="Status overview">
      <div class="group progress" data-status-card="inProgress" role="group" aria-label="In progress">
        <div class="title"><lucide-icon [img]="TrendingUp" [size]="16" aria-hidden="true" /> In progress</div>
        <div class="metric">{{ counts().inProgress }} <span>active</span></div>
        <div class="sub">Running and starting</div>
      </div>
      <div class="group waiting" data-status-card="waiting" role="group" aria-label="Waiting for you">
        <div class="title"><lucide-icon [img]="MessageCircleQuestion" [size]="16" aria-hidden="true" /> Waiting for you</div>
        <div class="metric">{{ counts().waiting }} <span>input</span></div>
        <div class="sub">Response needed</div>
      </div>
      <div class="group finished" data-status-card="finished" role="group" aria-label="Finished">
        <div class="title"><lucide-icon [img]="CircleCheck" [size]="16" aria-hidden="true" /> Finished</div>
        <div class="metric">{{ counts().finished }} <span>done</span></div>
        <div class="sub">Completed work</div>
      </div>
      <div class="group other" data-status-card="other" role="group" aria-label="Other work">
        <div class="title"><lucide-icon [img]="CircleDashed" [size]="16" aria-hidden="true" /> Other work</div>
        <div class="metric">{{ counts().other }} <span>other</span></div>
        <div class="sub">Queued, idle, unknown, <span class="failed">failed or cancelled</span></div>
      </div>
    </section>
  `,
})
export class CommandStatusGroupsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  public measurementElements(): NodeListOf<HTMLElement> {
    return this.host.nativeElement.querySelectorAll<HTMLElement>('[data-status-card]');
  }
  public readonly counts = input<StatusCounts>({ inProgress: 0, waiting: 0, finished: 0, other: 0 });
  public readonly TrendingUp = TrendingUp;
  public readonly MessageCircleQuestion = MessageCircleQuestion;
  public readonly CircleCheck = CircleCheck;
  public readonly CircleDashed = CircleDashed;
}
