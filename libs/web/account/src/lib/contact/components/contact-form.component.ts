import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, MessageSquare } from 'lucide-angular';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'ptah-contact-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div>
      @if (formState() === 'success') {
        <div
          class="bg-success/10 border border-success/30 rounded-2xl p-6 text-center"
        >
          <h3 class="text-lg font-semibold text-success mb-2">Message Sent!</h3>
          <p class="text-neutral-content">
            We've received your message and will get back to you as soon as
            possible.
          </p>
          <button
            type="button"
            class="mt-4 text-secondary hover:text-secondary/80 text-sm font-medium transition-colors"
            (click)="resetForm()"
          >
            Send another message
          </button>
        </div>
      } @else {
        <div
          class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
        >
          <!-- Card header -->
          <div
            class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
          >
            <lucide-angular
              [img]="MessageSquareIcon"
              class="w-5 h-5 text-secondary"
              aria-hidden="true"
            />
            <h2 class="font-display text-lg font-semibold">Get in Touch</h2>
          </div>

          <form class="p-6 space-y-5" (ngSubmit)="onSubmit()">
            <p class="text-neutral-content text-sm">
              Have a question, feedback, or need help? We'd love to hear from
              you.
            </p>

            <!-- Subject -->
            <div>
              <label
                for="subject"
                class="block text-sm font-medium text-base-content mb-2"
                >Subject</label
              >
              <input
                id="subject"
                type="text"
                class="input input-bordered w-full bg-base-300/50 border-secondary/10 text-base-content placeholder-neutral-content/30 focus:border-secondary/50 focus:outline-none"
                placeholder="What is this about?"
                [(ngModel)]="subject"
                name="subject"
                required
                minlength="3"
                maxlength="200"
              />
            </div>

            <!-- Category -->
            <div>
              <label
                for="category"
                class="block text-sm font-medium text-base-content mb-2"
                >Category</label
              >
              <select
                id="category"
                class="select select-bordered w-full bg-base-300/50 border-secondary/10 text-base-content focus:border-secondary/50 focus:outline-none"
                [(ngModel)]="category"
                name="category"
              >
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="feature-request">Feature Request</option>
                <option value="other">Other</option>
              </select>
            </div>

            <!-- Message -->
            <div>
              <label
                for="message"
                class="block text-sm font-medium text-base-content mb-2"
                >Message</label
              >
              <textarea
                id="message"
                class="textarea textarea-bordered w-full bg-base-300/50 border-secondary/10 text-base-content placeholder-neutral-content/30 focus:border-secondary/50 focus:outline-none min-h-[160px]"
                placeholder="Tell us more..."
                [(ngModel)]="message"
                name="message"
                required
                minlength="10"
                maxlength="5000"
              ></textarea>
            </div>

            @if (formState() === 'error') {
              <div
                class="bg-error/10 border border-error/30 rounded-lg p-3 text-error text-sm"
              >
                {{ errorMessage() }}
              </div>
            }

            <!-- Submit -->
            <button
              type="submit"
              class="btn w-full btn-secondary font-semibold"
              [disabled]="formState() === 'submitting'"
            >
              @if (formState() === 'submitting') {
                <span class="loading loading-spinner loading-sm"></span>
                Sending...
              } @else {
                Send Message
              }
            </button>
          </form>
        </div>
      }
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
export class ContactFormComponent {
  private readonly http = inject(HttpClient);

  public readonly MessageSquareIcon = MessageSquare;

  public subject = '';
  public message = '';
  public category = 'general';

  public readonly formState = signal<FormState>('idle');
  public readonly errorMessage = signal('');

  public onSubmit(): void {
    if (this.subject.length < 3 || this.message.length < 10) {
      this.formState.set('error');
      this.errorMessage.set(
        'Please fill in all required fields (subject: 3+ chars, message: 10+ chars).',
      );
      return;
    }

    this.formState.set('submitting');

    this.http
      .post<{ success: boolean; message: string }>('/api/v1/contact', {
        subject: this.subject,
        message: this.message,
        category: this.category,
      })
      .subscribe({
        next: () => {
          this.formState.set('success');
        },
        error: (err) => {
          this.formState.set('error');
          this.errorMessage.set(
            err?.error?.message || 'Failed to send message. Please try again.',
          );
        },
      });
  }

  public resetForm(): void {
    this.subject = '';
    this.message = '';
    this.category = 'general';
    this.formState.set('idle');
    this.errorMessage.set('');
  }
}
