import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { SESSION_TOPICS, SessionTopic } from '../../../config/sessions.config';
import { SessionCardComponent } from './session-card.component';
import { SessionRegistrationModalComponent } from './session-registration-modal.component';
import { PaddleCheckoutService } from '../../../services/paddle-checkout.service';
import { PADDLE_CONFIG } from '../../../config/paddle.config';

@Component({
  selector: 'ptah-sessions-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    SessionCardComponent,
    SessionRegistrationModalComponent,
  ],
  template: `
    <section class="pb-20 px-4 sm:px-6 lg:px-16">
      <div
        class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        @for (topic of topics; track topic.id) {
        <ptah-session-card
          [topic]="topic"
          [isFreeEligible]="hasFreeSession()"
          (register)="onRegister($event)"
        />
        }
      </div>

      @if (successMessage()) {
      <div class="max-w-2xl mx-auto mt-8">
        <div
          class="bg-green-500/10 border border-green-500/30 rounded-xl p-6 text-center"
        >
          <div class="text-3xl mb-3">✅</div>
          <p class="text-green-400 font-medium">{{ successMessage() }}</p>
        </div>
      </div>
      } @if (errorMessage()) {
      <div class="max-w-2xl mx-auto mt-8">
        <div
          class="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center"
        >
          <p class="text-red-400">{{ errorMessage() }}</p>
        </div>
      </div>
      }
    </section>

    <!-- Registration Modal -->
    <ptah-session-registration-modal
      [topic]="selectedTopic()"
      [isFreeEligible]="hasFreeSession()"
      [isSubmitting]="isSubmitting()"
      (closeModal)="closeModal()"
      (submitRequest)="onModalSubmit($event)"
    />
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
export class SessionsGridComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly paddleCheckout = inject(PaddleCheckoutService);
  private readonly paddleConfig = inject(PADDLE_CONFIG);

  public readonly topics = SESSION_TOPICS;
  public readonly hasFreeSession = signal(false);
  public readonly selectedTopic = signal<SessionTopic | null>(null);
  public readonly isSubmitting = signal(false);
  public readonly successMessage = signal('');
  public readonly errorMessage = signal('');

  public ngOnInit(): void {
    this.fetchEligibility();
  }

  private fetchEligibility(): void {
    this.http
      .get<{ hasFreeSession: boolean }>('/api/v1/sessions/eligibility')
      .subscribe({
        next: (res) => this.hasFreeSession.set(res.hasFreeSession),
        error: () => this.hasFreeSession.set(false),
      });
  }

  public onRegister(topic: SessionTopic): void {
    this.successMessage.set('');
    this.errorMessage.set('');
    this.selectedTopic.set(topic);
  }

  public closeModal(): void {
    this.selectedTopic.set(null);
  }

  public onModalSubmit(event: { notes: string }): void {
    const topic = this.selectedTopic();
    if (!topic) return;

    if (this.hasFreeSession()) {
      this.submitFreeRequest(topic, event.notes);
    } else {
      this.startPaidCheckout(topic, event.notes);
    }
  }

  private submitFreeRequest(topic: SessionTopic, notes: string): void {
    this.isSubmitting.set(true);

    this.http
      .post<{ success: boolean; message: string }>('/api/v1/sessions/request', {
        sessionTopicId: topic.id,
        additionalNotes: notes || undefined,
      })
      .subscribe({
        next: (res) => {
          this.isSubmitting.set(false);
          this.selectedTopic.set(null);
          this.successMessage.set(res.message);
          this.fetchEligibility();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(
            err?.error?.message || 'Failed to submit request. Please try again.'
          );
        },
      });
  }

  private async startPaidCheckout(
    topic: SessionTopic,
    notes: string
  ): Promise<void> {
    const sessionPriceId = this.paddleConfig.sessionPriceId;
    if (!sessionPriceId) {
      this.errorMessage.set(
        'Session payments are not configured yet. Please contact us.'
      );
      this.selectedTopic.set(null);
      return;
    }

    this.isSubmitting.set(true);
    this.selectedTopic.set(null);

    try {
      await this.paddleCheckout.initialize();
      await this.paddleCheckout.openCheckout({
        priceId: sessionPriceId,
        onComplete: (transactionId?: string) => {
          this.submitPaidRequest(topic, notes, transactionId);
        },
      });
      this.isSubmitting.set(false);
    } catch {
      this.isSubmitting.set(false);
      this.errorMessage.set(
        'Payment system unavailable. Please try again later.'
      );
    }
  }

  private submitPaidRequest(
    topic: SessionTopic,
    notes: string,
    transactionId?: string
  ): void {
    this.isSubmitting.set(true);

    this.http
      .post<{ success: boolean; message: string }>('/api/v1/sessions/request', {
        sessionTopicId: topic.id,
        additionalNotes: notes || undefined,
        paddleTransactionId: transactionId,
      })
      .subscribe({
        next: (res) => {
          this.isSubmitting.set(false);
          this.successMessage.set(res.message);
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(
            err?.error?.message || 'Failed to submit request. Please try again.'
          );
        },
      });
  }
}
