import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SessionTopic } from '../../../config/sessions.config';

@Component({
  selector: 'ptah-session-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div
      class="px-6 py-5 hover:bg-base-300/30 transition-colors group cursor-pointer"
      (click)="register.emit(topic())"
    >
      <!-- Topic header -->
      <div class="flex items-start gap-4 mb-3">
        <div
          class="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-lg shrink-0 mt-0.5"
        >
          @switch (topic().icon) { @case ('layers') { &#x1F4DA; } @case
          ('git-branch') { &#x1F500; } @case ('rocket') { &#x1F680; } @default {
          &#x2728; } }
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3 mb-1 flex-wrap">
            <h3
              class="text-base font-semibold text-base-content group-hover:text-secondary transition-colors"
            >
              {{ topic().title }}
            </h3>
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              [ngClass]="{
                'bg-success/10 text-success': topic().difficulty === 'beginner',
                'bg-secondary/10 text-secondary':
                  topic().difficulty === 'intermediate',
                'bg-error/10 text-error': topic().difficulty === 'advanced'
              }"
            >
              {{ topic().difficulty }}
            </span>
          </div>
          <p class="text-neutral-content text-sm leading-relaxed">
            {{ topic().description }}
          </p>
        </div>
      </div>

      <!-- Topics grid -->
      <div class="ml-14 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        @for (item of topic().topics; track item) {
        <div class="flex items-center gap-2 text-sm text-neutral-content">
          <span class="text-success/70 shrink-0">&#x2713;</span>
          <span>{{ item }}</span>
        </div>
        }
      </div>

      <!-- Footer row -->
      <div class="ml-14 mt-4 flex items-center justify-between">
        <div class="flex items-center gap-2 text-xs text-neutral-content/50">
          <span>{{ topic().duration }}</span>
          <span class="opacity-30">&#xB7;</span>
          @if (isFreeEligible()) {
          <span class="text-success font-semibold text-sm">FREE</span>
          } @else {
          <span class="text-base-content font-semibold text-sm">$100</span>
          }
        </div>
        <span
          class="text-secondary text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
        >
          Register &#x2192;
        </span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }
    `,
  ],
})
export class SessionCardComponent {
  public readonly topic = input.required<SessionTopic>();
  public readonly isFreeEligible = input(false);
  public readonly register = output<SessionTopic>();
}
