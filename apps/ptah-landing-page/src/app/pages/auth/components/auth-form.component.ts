import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import {
  CheckCircle,
  Eye,
  EyeOff,
  Lock,
  LucideAngularModule,
  Mail,
} from 'lucide-angular';
import {
  BUTTON_ANIMATION,
  EMAIL_INPUT_ANIMATION,
  PASSWORD_INPUT_ANIMATION,
} from '../config/auth-animation.configs';
import { AuthMode } from '../models/auth.types';
import {
  createEmailValidation,
  createFormValidation,
  createPasswordValidation,
  createStrongPasswordValidation,
  createPasswordRequirementsCheck,
  createSignupFormValidation,
} from '../utils/auth-validation.utils';

/**
 * AuthFormComponent - Email/Password input form
 *
 * Handles:
 * - Email input with validation indicator
 * - Password input with visibility toggle
 * - Submit button with loading state
 * - Emits form submission with credentials
 */
@Component({
  selector: 'ptah-auth-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Email Input -->
    <div viewportAnimation [viewportConfig]="emailInputConfig" class="mb-4">
      <div
        class="relative flex items-center bg-base-300/50 border border-neutral-content/10 rounded-xl px-4 py-3
               focus-within:border-secondary/50 focus-within:ring-2 focus-within:ring-secondary/20
               transition-all duration-300 hover:border-neutral-content/20"
      >
        <!-- Email Icon -->
        <lucide-angular
          [img]="MailIcon"
          class="w-5 h-5 text-neutral-content/50 mr-3 shrink-0 transition-colors duration-200"
          [class.text-secondary]="emailValue()"
          aria-hidden="true"
        />

        <div class="flex-1">
          <label
            for="email"
            class="block text-xs mb-0.5 transition-colors duration-200"
            [class.text-neutral-content]="!emailValue()"
            [class.opacity-50]="!emailValue()"
            [class.text-secondary]="emailValue()"
            [class.opacity-70]="emailValue()"
          >
            Email Address
          </label>
          <input
            type="email"
            id="email"
            name="email"
            [ngModel]="emailValue()"
            (ngModelChange)="updateEmail($event)"
            [disabled]="isLoading()"
            placeholder="your@email.com"
            class="w-full bg-transparent text-white placeholder-neutral-content/30 outline-none text-sm"
            autocomplete="email"
          />
        </div>

        <!-- Validation Checkmark -->
        <div
          class="transition-all duration-300 transform"
          [class.scale-100]="isEmailValid()"
          [class.scale-0]="!isEmailValid()"
          [class.opacity-100]="isEmailValid()"
          [class.opacity-0]="!isEmailValid()"
        >
          <lucide-angular
            [img]="CheckCircleIcon"
            class="w-5 h-5 text-success shrink-0 ml-2"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <!-- Password Input -->
    <div viewportAnimation [viewportConfig]="passwordInputConfig" class="mb-4">
      <div
        class="relative flex items-center bg-base-300/50 border border-neutral-content/10 rounded-xl px-4 py-3
               focus-within:border-secondary/50 focus-within:ring-2 focus-within:ring-secondary/20
               transition-all duration-300 hover:border-neutral-content/20"
      >
        <!-- Lock Icon -->
        <lucide-angular
          [img]="LockIcon"
          class="w-5 h-5 text-neutral-content/50 mr-3 shrink-0 transition-colors duration-200"
          [class.text-secondary]="passwordValue()"
          aria-hidden="true"
        />

        <div class="flex-1">
          <label
            for="password"
            class="block text-xs mb-0.5 transition-colors duration-200"
            [class.text-neutral-content]="!passwordValue()"
            [class.opacity-50]="!passwordValue()"
            [class.text-secondary]="passwordValue()"
            [class.opacity-70]="passwordValue()"
          >
            Password
          </label>
          <input
            [type]="showPassword() ? 'text' : 'password'"
            id="password"
            name="password"
            [(ngModel)]="passwordValue"
            [disabled]="isLoading()"
            [placeholder]="
              mode() === 'signup'
                ? 'Create a strong password'
                : 'Min. 8 characters'
            "
            class="w-full bg-transparent text-white placeholder-neutral-content/30 outline-none text-sm"
            [autocomplete]="
              mode() === 'signup' ? 'new-password' : 'current-password'
            "
          />
        </div>

        <!-- Toggle Password Visibility -->
        <button
          type="button"
          (click)="togglePasswordVisibility()"
          class="ml-2 p-1 rounded-lg text-neutral-content/50 hover:text-secondary transition-colors duration-200"
          [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
        >
          <lucide-angular
            [img]="showPassword() ? EyeOffIcon : EyeIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
        </button>

        <!-- Validation Checkmark -->
        <div
          class="transition-all duration-300 transform"
          [class.scale-100]="currentPasswordValid()"
          [class.scale-0]="!currentPasswordValid()"
          [class.opacity-100]="currentPasswordValid()"
          [class.opacity-0]="!currentPasswordValid()"
        >
          <lucide-angular
            [img]="CheckCircleIcon"
            class="w-5 h-5 text-success shrink-0 ml-1"
            aria-hidden="true"
          />
        </div>
      </div>

      <!-- Password Requirements (only for signup) -->
      @if (mode() === 'signup' && passwordValue()) {
      <div class="mt-2 px-2 text-xs space-y-1">
        <div
          class="flex items-center gap-2"
          [class]="
            passwordRequirements().minLength
              ? 'text-success'
              : 'text-neutral-content/50'
          "
        >
          <span>{{ passwordRequirements().minLength ? '✓' : '○' }}</span>
          <span>At least 8 characters</span>
        </div>
        <div
          class="flex items-center gap-2"
          [class]="
            passwordRequirements().hasUppercase
              ? 'text-success'
              : 'text-neutral-content/50'
          "
        >
          <span>{{ passwordRequirements().hasUppercase ? '✓' : '○' }}</span>
          <span>One uppercase letter</span>
        </div>
        <div
          class="flex items-center gap-2"
          [class]="
            passwordRequirements().hasLowercase
              ? 'text-success'
              : 'text-neutral-content/50'
          "
        >
          <span>{{ passwordRequirements().hasLowercase ? '✓' : '○' }}</span>
          <span>One lowercase letter</span>
        </div>
        <div
          class="flex items-center gap-2"
          [class]="
            passwordRequirements().hasNumber
              ? 'text-success'
              : 'text-neutral-content/50'
          "
        >
          <span>{{ passwordRequirements().hasNumber ? '✓' : '○' }}</span>
          <span>One number</span>
        </div>
        <div
          class="flex items-center gap-2"
          [class]="
            passwordRequirements().hasSpecialChar
              ? 'text-success'
              : 'text-neutral-content/50'
          "
        >
          <span>{{ passwordRequirements().hasSpecialChar ? '✓' : '○' }}</span>
          <span>One special character (!&#64;#$%^&*...)</span>
        </div>
      </div>
      }
    </div>

    <!-- Spacing before button -->
    <div class="mb-2"></div>

    <!-- Continue Button -->
    <div viewportAnimation [viewportConfig]="buttonConfig">
      <button
        type="button"
        (click)="handleSubmit()"
        [disabled]="isLoading() || !isFormValid()"
        class="w-full py-4 rounded-xl font-semibold text-base transition-all duration-300
               bg-gradient-to-r from-secondary to-amber-500 text-base-100
               hover:from-secondary/90 hover:to-amber-400 hover:shadow-lg hover:shadow-secondary/25
               hover:scale-[1.02] active:scale-[0.98]
               disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:scale-100"
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-sm mr-2"></span>
        Processing... } @else {
        {{ mode() === 'signin' ? 'Sign In' : 'Create Account' }}
        }
      </button>
    </div>
  `,
})
export class AuthFormComponent {
  /** Lucide icon references */
  public readonly MailIcon = Mail;
  public readonly LockIcon = Lock;
  public readonly EyeIcon = Eye;
  public readonly EyeOffIcon = EyeOff;
  public readonly CheckCircleIcon = CheckCircle;

  /** Animation configurations */
  public readonly emailInputConfig = EMAIL_INPUT_ANIMATION;
  public readonly passwordInputConfig = PASSWORD_INPUT_ANIMATION;
  public readonly buttonConfig = BUTTON_ANIMATION;

  public readonly mode = input.required<AuthMode>();

  public readonly isLoading = input<boolean>(false);

  /** Output: Form submission with credentials */
  public readonly formSubmit = output<{ email: string; password: string }>();

  /** Output: Email value changed (for magic link validation) */
  public readonly emailChange = output<string>();

  /** Form state */
  public readonly emailValue = signal('');
  public readonly passwordValue = signal('');
  public readonly showPassword = signal(false);

  /** Computed validations */
  public readonly isEmailValid = createEmailValidation(this.emailValue);
  public readonly isPasswordValid = createPasswordValidation(
    this.passwordValue
  );
  public readonly isStrongPasswordValid = createStrongPasswordValidation(
    this.passwordValue
  );
  public readonly passwordRequirements = createPasswordRequirementsCheck(
    this.passwordValue
  );

  /** Form validation for signin (basic) */
  public readonly isSigninFormValid = createFormValidation(
    this.emailValue,
    this.passwordValue
  );

  /** Form validation for signup (strong password) */
  public readonly isSignupFormValid = createSignupFormValidation(
    this.emailValue,
    this.passwordValue
  );

  /** Current form validation based on mode */
  public readonly isFormValid = computed(() =>
    this.mode() === 'signup'
      ? this.isSignupFormValid()
      : this.isSigninFormValid()
  );

  /** Current password validation based on mode */
  public readonly currentPasswordValid = computed(() =>
    this.mode() === 'signup'
      ? this.isStrongPasswordValid()
      : this.isPasswordValid()
  );

  /** Toggle password visibility */
  public togglePasswordVisibility(): void {
    this.showPassword.update((show) => !show);
  }

  /** Handle form submission */
  public handleSubmit(): void {
    if (this.isFormValid()) {
      this.formSubmit.emit({
        email: this.emailValue(),
        password: this.passwordValue(),
      });
    }
  }

  /** Update email and notify parent */
  public updateEmail(value: string): void {
    this.emailValue.set(value);
    this.emailChange.emit(value);
  }

  /** Get current email value (for parent access) */
  public getEmail(): string {
    return this.emailValue();
  }

  /** Reset form (called by parent after mode change) */
  public resetPassword(): void {
    this.passwordValue.set('');
  }
}
