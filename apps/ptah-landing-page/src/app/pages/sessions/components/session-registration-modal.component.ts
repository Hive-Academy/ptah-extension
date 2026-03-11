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
      class="fixed inset-0 z-50 bg-base-100/80 backdrop-blur-sm flex items-center justify-center p-4"
      (click)="onBackdropClick($event)"
    >
      <!-- Modal -->
      <div
        class="bg-base-200 border border-secondary/20 rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl"
      >
        <h2 class="text-xl font-bold text-base-content mb-1">
          Register for Session
        </h2>
        <h3 class="text-secondary font-medium mb-4">{{ topic()!.title }}</h3>

        <!-- Session Info -->
        <div
          class="bg-base-300/50 border border-secondary/10 rounded-lg p-4 mb-6 space-y-2"
        >
          <div class="flex justify-between text-sm">
            <span class="text-neutral-content">Duration</span>
            <span class="text-base-content">{{ topic()!.duration }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-neutral-content">Difficulty</span>
            <span class="text-base-content capitalize">{{
              topic()!.difficulty
            }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-neutral-content">Price</span>
            @if (isFreeEligible()) {
            <span class="text-success font-semibold"
              >FREE &#x2014; Your first session is on us</span
            >
            } @else {
            <span class="text-base-content font-semibold"
              >$100 per session</span
            >
            }
          </div>
        </div>

        <!-- Notes -->
        <div class="mb-6">
          <label
            for="notes"
            class="block text-sm font-medium text-base-content mb-2"
            >Additional Notes (optional)</label
          >
          <textarea
            id="notes"
            class="textarea textarea-bordered w-full bg-base-300/50 border-secondary/10 text-base-content placeholder-neutral-content/30 focus:border-secondary/50 focus:outline-none min-h-[100px]"
            placeholder="Any specific topics or questions you'd like covered?"
            [(ngModel)]="notes"
          ></textarea>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            type="button"
            class="btn flex-1 btn-ghost"
            (click)="closeModal.emit()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn flex-1 btn-secondary font-semibold"
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
