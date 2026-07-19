import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CircleCheckBig, LucideAngularModule, Mail } from 'lucide-angular';
import {
  WaitlistService,
  WaitlistSource,
} from '../../services/waitlist.service';

type WaitlistFormState =
  | 'idle'
  | 'submitting'
  | 'joined'
  | 'already_joined'
  | 'error';

/** Deliberately permissive — server-side `class-validator @IsEmail` is the real gate. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * WaitlistFormComponent — the live "Join the Waitlist" scroll target for the
 * `#waitlist` anchor used by the Builders section CTA (and any other page
 * linking to `/#waitlist`). POSTs to `POST /api/v1/waitlist` via
 * {@link WaitlistService}.
 *
 * States (signals): idle → submitting → joined | already_joined | error.
 * `source` is an input so each mount (landing, pricing, profile, ...) tags
 * where the lead came from per the license-server contract.
 */
@Component({
  selector: 'ptah-waitlist-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <section
      id="waitlist"
      aria-label="Join the Ptah Builders waitlist"
      class="relative scroll-mt-24 bg-ink-950 pb-24 sm:pb-32"
    >
      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div
          class="mx-auto max-w-xl rounded-2xl border border-amber-500/25 bg-ink-900/70 p-7 sm:p-10 shadow-xl text-center"
        >
          @switch (state()) {
            @case ('joined') {
              <div role="status" aria-live="polite" class="py-2">
                <lucide-angular
                  [img]="checkIcon"
                  class="w-9 h-9 text-amber-500 mx-auto"
                  aria-hidden="true"
                />
                <h3 class="mt-4 text-xl font-bold text-white">
                  You're a founding member — watch your inbox
                </h3>
                <p class="mt-2 text-sm text-ink-400 leading-relaxed">
                  We'll email your founding invite the moment Ptah Builders
                  opens: 35% off monthly (first 12 months) or 50% off yearly
                  (first year), plus a 30-day money-back guarantee.
                </p>
              </div>
            }
            @case ('already_joined') {
              <div role="status" aria-live="polite" class="py-2">
                <lucide-angular
                  [img]="checkIcon"
                  class="w-9 h-9 text-amber-500 mx-auto"
                  aria-hidden="true"
                />
                <h3 class="mt-4 text-xl font-bold text-white">
                  You're already a founding member
                </h3>
                <p class="mt-2 text-sm text-ink-400 leading-relaxed">
                  We'll email your founding invite the moment Ptah Builders
                  opens.
                </p>
              </div>
            }
            @default {
              <span
                class="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80"
              >
                Ptah Builders — Founding Waitlist
              </span>
              <h3 class="mt-3 text-xl sm:text-2xl font-bold text-white">
                Claim a founding member spot
              </h3>
              <p class="mt-2 text-sm text-ink-400 leading-relaxed">
                Join now and lock in 35% off monthly (first 12 months) or 50%
                off yearly (first year) at launch, plus early access. No spam —
                membership isn't purchasable yet, just a single invite email
                when it opens.
              </p>

              <form
                class="mt-6 flex flex-col sm:flex-row gap-3"
                novalidate
                (ngSubmit)="onSubmit()"
              >
                <label for="waitlist-email" class="sr-only"
                  >Email address</label
                >
                <div class="relative flex-1">
                  <lucide-angular
                    [img]="mailIcon"
                    class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500"
                    aria-hidden="true"
                  />
                  <input
                    id="waitlist-email"
                    type="email"
                    name="waitlist-email"
                    autocomplete="email"
                    placeholder="you@company.com"
                    required
                    [(ngModel)]="email"
                    [attr.aria-invalid]="state() === 'error'"
                    [attr.aria-describedby]="
                      state() === 'error' ? 'waitlist-error' : null
                    "
                    class="w-full rounded-lg border border-ink-700 bg-ink-950/60 pl-10 pr-3.5 py-3 text-sm text-white placeholder-ink-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40"
                  />
                </div>
                <button
                  type="submit"
                  [disabled]="state() === 'submitting'"
                  class="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 disabled:opacity-60 disabled:pointer-events-none"
                >
                  @if (state() === 'submitting') {
                    <span
                      class="w-4 h-4 rounded-full border-2 border-ink-950/40 border-t-ink-950 animate-spin"
                      aria-hidden="true"
                    ></span>
                    Joining…
                  } @else {
                    Join the Waitlist
                  }
                </button>
              </form>

              @if (state() === 'error') {
                <p
                  id="waitlist-error"
                  role="alert"
                  class="mt-3 text-sm text-red-400"
                >
                  {{ errorMessage() }}
                </p>
              }
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class WaitlistFormComponent {
  /** Tags which page/surface this mount posted from (license-server `source` field). */
  public readonly source = input<WaitlistSource>('landing');

  private readonly waitlistService = inject(WaitlistService);

  protected readonly mailIcon = Mail;
  protected readonly checkIcon = CircleCheckBig;

  protected email = '';

  protected readonly state = signal<WaitlistFormState>('idle');
  protected readonly errorMessage = signal('');

  protected onSubmit(): void {
    if (this.state() === 'submitting') return;

    const trimmed = this.email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      this.state.set('error');
      this.errorMessage.set('Enter a valid email address.');
      return;
    }

    this.state.set('submitting');
    this.errorMessage.set('');

    this.waitlistService
      .join({ email: trimmed, source: this.source() })
      .subscribe({
        next: (res) => {
          this.state.set(res.status);
        },
        error: (err: unknown) => {
          this.state.set('error');
          this.errorMessage.set(
            this.extractErrorMessage(err) ??
              'Something went wrong. Please try again.',
          );
        },
      });
  }

  private extractErrorMessage(err: unknown): string | null {
    if (
      err &&
      typeof err === 'object' &&
      'error' in err &&
      err.error &&
      typeof err.error === 'object' &&
      'message' in err.error &&
      typeof (err.error as { message: unknown }).message === 'string'
    ) {
      return (err.error as { message: string }).message;
    }
    return null;
  }
}
