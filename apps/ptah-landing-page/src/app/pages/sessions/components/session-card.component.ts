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
      class="bg-slate-900/50 border border-white/10 rounded-xl p-6 flex flex-col h-full hover:border-amber-500/30 transition-colors"
    >
      <!-- Header -->
      <div class="flex items-center gap-3 mb-4">
        <div
          class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-lg"
        >
          @switch (topic().icon) { @case ('layers') { &#x1F4DA; } @case
          ('git-branch') { &#x1F500; } @case ('rocket') { &#x1F680; } @default {
          &#x2728; } }
        </div>
        <div>
          <h3 class="text-lg font-semibold text-white">{{ topic().title }}</h3>
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            [ngClass]="{
              'bg-green-500/10 text-green-400':
                topic().difficulty === 'beginner',
              'bg-amber-500/10 text-amber-400':
                topic().difficulty === 'intermediate',
              'bg-red-500/10 text-red-400': topic().difficulty === 'advanced'
            }"
          >
            {{ topic().difficulty }}
          </span>
        </div>
      </div>

      <!-- Description -->
      <p class="text-white/60 text-sm mb-4 flex-grow">
        {{ topic().description }}
      </p>

      <!-- Topics Checklist -->
      <ul class="space-y-2 mb-6">
        @for (item of topic().topics; track item) {
        <li class="flex items-start gap-2 text-sm text-white/70">
          <span class="text-green-400 mt-0.5 shrink-0">&#x2713;</span>
          <span>{{ item }}</span>
        </li>
        }
      </ul>

      <!-- Footer -->
      <div
        class="flex items-center justify-between pt-4 border-t border-white/5"
      >
        <div>
          <span class="text-white/40 text-xs block">{{
            topic().duration
          }}</span>
          @if (isFreeEligible()) {
          <span class="text-green-400 font-bold text-lg">FREE</span>
          } @else {
          <span class="text-white font-bold text-lg">$100</span>
          }
        </div>
        <button
          type="button"
          class="btn btn-sm bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-semibold hover:from-amber-400 hover:to-amber-500 border-none"
          (click)="register.emit(topic())"
        >
          Register
        </button>
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
