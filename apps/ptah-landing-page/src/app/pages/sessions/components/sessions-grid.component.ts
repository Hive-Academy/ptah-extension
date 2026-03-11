import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, GraduationCap } from 'lucide-angular';
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
    LucideAngularModule,
    SessionCardComponent,
    SessionRegistrationModalComponent,
  ],
  template: `
    <div>
      <!-- Unified session card -->
      <div
        class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
      >
        <!-- Card header -->
        <div
          class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
        >
          <lucide-angular
            [img]="GraduationCapIcon"
            class="w-5 h-5 text-secondary"
            aria-hidden="true"
          />
          <h2 class="font-display text-lg font-semibold">Learning Sessions</h2>
        </div>

        <!-- Description + pricing -->
        <div class="px-6 py-5 border-b border-secondary/10">
          <p class="text-neutral-content text-sm max-w-lg">
            4&#x2013;5 hour live consulting deep-dives to help you master Ptah
            and supercharge your development workflow. Pick a topic below.
          </p>
          <div
            class="inline-flex items-center gap-3 mt-3 bg-base-300/50 border border-secondary/10 rounded-full px-4 py-2"
          >
            <span class="text-success font-medium text-sm"
              >First session FREE for community members</span
            >
            <span class="text-neutral-content/20">|</span>
            <span class="text-neutral-content text-sm"
              >$100 per session after</span
            >
          </div>
        </div>

        <!-- Topic sections -->
        <div class="divide-y divide-secondary/10">
          @for (topic of topics; track topic.id) {
          <ptah-session-card
            [topic]="topic"
            [isFreeEligible]="hasFreeSession()"
            (register)="onRegister($event)"
          />
          }
        </div>

        <!-- Card footer -->
        <div
          class="px-6 py-4 bg-base-300/30 border-t border-secondary/10 text-center"
        >
          <span class="text-neutral-content text-xs"
            >Sessions are conducted live via screen share. You'll receive
            scheduling details after registration.</span
          >
        </div>
      </div>

      @if (successMessage()) {
      <div class="mt-6">
        <div
          class="bg-success/10 border border-success/30 rounded-xl p-6 text-center"
        >
          <p class="text-success font-medium">{{ successMessage() }}</p>
        </div>
      </div>
      } @if (errorMessage()) {
      <div class="mt-6">
        <div
          class="bg-error/10 border border-error/30 rounded-xl p-6 text-center"
        >
          <p class="text-error">{{ errorMessage() }}</p>
        </div>
      </div>
      }
    </div>

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

  public readonly GraduationCapIcon = GraduationCap;

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
