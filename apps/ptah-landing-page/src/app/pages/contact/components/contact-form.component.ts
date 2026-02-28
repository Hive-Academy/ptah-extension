import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'ptah-contact-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="pb-20 px-4 sm:px-6 lg:px-16">
      <div class="max-w-2xl mx-auto">
        @if (formState() === 'success') {
        <div
          class="bg-green-500/10 border border-green-500/30 rounded-xl p-6 text-center"
        >
          <div class="text-3xl mb-3">✅</div>
          <h3 class="text-lg font-semibold text-green-400 mb-2">
            Message Sent!
          </h3>
          <p class="text-white/60">
            We've received your message and will get back to you as soon as
            possible.
          </p>
          <button
            type="button"
            class="mt-4 text-amber-400 hover:text-amber-300 text-sm font-medium transition-colors"
            (click)="resetForm()"
          >
            Send another message
          </button>
        </div>
        } @else {
        <form
          class="bg-slate-900/50 border border-white/10 rounded-xl p-6 sm:p-8 space-y-6"
          (ngSubmit)="onSubmit()"
        >
          <!-- Subject -->
          <div>
            <label
              for="subject"
              class="block text-sm font-medium text-white/80 mb-2"
              >Subject</label
            >
            <input
              id="subject"
              type="text"
              class="input input-bordered w-full bg-slate-800/50 border-white/10 text-white placeholder-white/30 focus:border-amber-500/50 focus:outline-none"
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
              class="block text-sm font-medium text-white/80 mb-2"
              >Category</label
            >
            <select
              id="category"
              class="select select-bordered w-full bg-slate-800/50 border-white/10 text-white focus:border-amber-500/50 focus:outline-none"
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
              class="block text-sm font-medium text-white/80 mb-2"
              >Message</label
            >
            <textarea
              id="message"
              class="textarea textarea-bordered w-full bg-slate-800/50 border-white/10 text-white placeholder-white/30 focus:border-amber-500/50 focus:outline-none min-h-[160px]"
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
            class="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm"
          >
            {{ errorMessage() }}
          </div>
          }

          <!-- Submit -->
          <button
            type="submit"
            class="btn w-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-semibold hover:from-amber-400 hover:to-amber-500 border-none"
            [disabled]="formState() === 'submitting'"
          >
            @if (formState() === 'submitting') {
            <span class="loading loading-spinner loading-sm"></span>
            Sending... } @else { Send Message }
          </button>
        </form>
        }
      </div>
    </section>
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

  public subject = '';
  public message = '';
  public category = 'general';

  public readonly formState = signal<FormState>('idle');
  public readonly errorMessage = signal('');

  public onSubmit(): void {
    if (this.subject.length < 3 || this.message.length < 10) {
      this.formState.set('error');
      this.errorMessage.set(
        'Please fill in all required fields (subject: 3+ chars, message: 10+ chars).'
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
            err?.error?.message || 'Failed to send message. Please try again.'
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
