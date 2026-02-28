import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { SessionTopic } from '../../../config/sessions.config';

@Component({
  selector: 'ptah-session-registration-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    @if (topic()) {
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      (click)="onBackdropClick($event)"
    >
      <!-- Modal -->
      <div
        class="bg-slate-900 border border-white/10 rounded-xl max-w-lg w-full p-6 sm:p-8 shadow-2xl"
      >
        <h2 class="text-xl font-bold text-white mb-1">Register for Session</h2>
        <h3 class="text-amber-400 font-medium mb-4">{{ topic()!.title }}</h3>

        <!-- Session Info -->
        <div
          class="bg-slate-800/50 border border-white/5 rounded-lg p-4 mb-6 space-y-2"
        >
          <div class="flex justify-between text-sm">
            <span class="text-white/50">Duration</span>
            <span class="text-white">{{ topic()!.duration }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/50">Difficulty</span>
            <span class="text-white capitalize">{{ topic()!.difficulty }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-white/50">Price</span>
            @if (isFreeEligible()) {
            <span class="text-green-400 font-semibold"
              >FREE — Your first session is on us</span
            >
            } @else {
            <span class="text-white font-semibold"
              >$100 per 2-hour session</span
            >
            }
          </div>
        </div>

        <!-- Notes -->
        <div class="mb-6">
          <label
            for="notes"
            class="block text-sm font-medium text-white/80 mb-2"
            >Additional Notes (optional)</label
          >
          <textarea
            id="notes"
            class="textarea textarea-bordered w-full bg-slate-800/50 border-white/10 text-white placeholder-white/30 focus:border-amber-500/50 focus:outline-none min-h-[100px]"
            placeholder="Any specific topics or questions you'd like covered?"
            [(ngModel)]="notes"
          ></textarea>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            type="button"
            class="btn flex-1 bg-transparent border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
            (click)="closeModal.emit()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn flex-1 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-semibold hover:from-amber-400 hover:to-amber-500 border-none"
            [disabled]="isSubmitting()"
            (click)="onSubmit()"
          >
            @if (isSubmitting()) {
            <span class="loading loading-spinner loading-sm"></span>
            } @else if (isFreeEligible()) { Submit Request } @else { Proceed to
            Payment }
          </button>
        </div>
      </div>
    </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class SessionRegistrationModalComponent {
  public readonly topic = input<SessionTopic | null>(null);
  public readonly isFreeEligible = input(false);
  public readonly isSubmitting = input(false);
  public readonly closeModal = output<void>();
  public readonly submitRequest = output<{ notes: string }>();

  public notes = '';

  public onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeModal.emit();
    }
  }

  public onSubmit(): void {
    this.submitRequest.emit({ notes: this.notes });
  }
}
