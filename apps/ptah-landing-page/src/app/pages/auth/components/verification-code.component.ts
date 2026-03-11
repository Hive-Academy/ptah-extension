import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Mail,
  RefreshCw,
  ArrowLeft,
} from 'lucide-angular';
import {
  BUTTON_ANIMATION,
  CODE_INPUT_ANIMATION,
  VERIFICATION_MESSAGE_ANIMATION,
} from '../config/auth-animation.configs';

/**
 * VerificationCodeComponent - Email verification code input
 *
 * Displays after signup to collect the 6-digit verification code
 * sent to the user's email by WorkOS.
 *
 * Features:
 * - 6-digit code input
 * - Resend code button
 * - Back to signup button
 * - Loading states
 */
@Component({
  selector: 'ptah-verification-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Verification Message -->
    <div
      viewportAnimation
      [viewportConfig]="messageConfig"
      class="text-center mb-8"
    >
      <div
        class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-secondary/10 mb-4"
      >
        <lucide-angular
          [img]="MailIcon"
          class="w-8 h-8 text-secondary"
          aria-hidden="true"
        />
      </div>
      <h2 class="text-xl font-semibold text-white mb-2">Verify your email</h2>
      <p class="text-neutral-content/70 text-sm">
        We sent a 6-digit code to
        <span class="text-secondary font-medium">{{ email() }}</span>
      </p>
      <p class="text-neutral-content/50 text-xs mt-1">
        Enter the code below to complete your registration
      </p>
    </div>

    <!-- Code Input -->
    <div viewportAnimation [viewportConfig]="codeInputConfig" class="mb-6">
      <div
        class="relative flex items-center justify-center bg-base-300/50 border border-neutral-content/10 rounded-xl px-4 py-4
               focus-within:border-secondary/50 focus-within:ring-2 focus-within:ring-secondary/20
               transition-all duration-300 hover:border-neutral-content/20"
      >
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          [ngModel]="codeValue()"
          (ngModelChange)="onCodeChange($event)"
          [disabled]="isLoading()"
          placeholder="000000"
          class="w-full bg-transparent text-white text-center text-3xl font-mono tracking-[0.5em] placeholder-neutral-content/30 outline-none"
          autocomplete="one-time-code"
        />
      </div>
      <p class="text-center text-xs text-neutral-content/50 mt-2">
        Code expires in 10 minutes
      </p>
    </div>

    <!-- Verify Button -->
    <div viewportAnimation [viewportConfig]="buttonConfig" class="mb-4">
      <button
        type="button"
        (click)="handleVerify()"
        [disabled]="isLoading() || !isCodeValid()"
        class="w-full py-4 rounded-xl font-semibold text-base transition-all duration-300
               bg-gradient-to-r from-secondary to-amber-500 text-base-100
               hover:from-secondary/90 hover:to-amber-400 hover:shadow-lg hover:shadow-secondary/25
               hover:scale-[1.02] active:scale-[0.98]
               disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:scale-100"
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-sm mr-2"></span>
        Verifying... } @else { Verify Email }
      </button>
    </div>

    <!-- Resend & Back Actions -->
    <div class="flex items-center justify-between text-sm">
      <button
        type="button"
        (click)="handleBack()"
        [disabled]="isLoading()"
        class="flex items-center gap-1 text-neutral-content/70 hover:text-secondary transition-colors duration-200 disabled:opacity-50"
      >
        <lucide-angular [img]="ArrowLeftIcon" class="w-4 h-4" />
        Back
      </button>

      <button
        type="button"
        (click)="handleResend()"
        [disabled]="isLoading() || isResending()"
        class="flex items-center gap-1 text-neutral-content/70 hover:text-secondary transition-colors duration-200 disabled:opacity-50"
      >
        <lucide-angular
          [img]="RefreshIcon"
          class="w-4 h-4"
          [class.animate-spin]="isResending()"
        />
        {{ isResending() ? 'Sending...' : 'Resend code' }}
      </button>
    </div>
  `,
})
export class VerificationCodeComponent {
  /** Lucide icons */
  public readonly MailIcon = Mail;
  public readonly RefreshIcon = RefreshCw;
  public readonly ArrowLeftIcon = ArrowLeft;

  /** Animation configs */
  public readonly messageConfig = VERIFICATION_MESSAGE_ANIMATION;
  public readonly codeInputConfig = CODE_INPUT_ANIMATION;
  public readonly buttonConfig = BUTTON_ANIMATION;

  /** Input: User email for display */
  public readonly email = input.required<string>();

  /** Input: Loading state */
  public readonly isLoading = input<boolean>(false);

  /** Input: Resending state */
  public readonly isResending = input<boolean>(false);

  /** Output: Verify code */
  public readonly verify = output<string>();

  /** Output: Resend code */
  public readonly resend = output<void>();

  /** Output: Go back */
  public readonly back = output<void>();

  /** Code value */
  public readonly codeValue = signal('');

  /** Check if code is valid (6 digits) */
  public isCodeValid(): boolean {
    const code = this.codeValue();
    return /^\d{6}$/.test(code);
  }

  /** Handle code input change - only allow digits */
  public onCodeChange(value: string): void {
    // Remove non-digits
    const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
    this.codeValue.set(digitsOnly);
  }

  /** Handle verify button click */
  public handleVerify(): void {
    if (this.isCodeValid()) {
      this.verify.emit(this.codeValue());
    }
  }

  /** Handle resend button click */
  public handleResend(): void {
    this.resend.emit();
  }

  /** Handle back button click */
  public handleBack(): void {
    this.back.emit();
  }
}
