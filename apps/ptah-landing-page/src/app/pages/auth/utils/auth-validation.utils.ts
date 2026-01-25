import { Signal, computed } from '@angular/core';
import {
  ValidationResult,
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERNS,
  PASSWORD_REQUIREMENTS,
  PasswordRequirementCheck,
} from '../models/auth.types';

/**
 * Auth Validation Utilities
 *
 * Reusable validation functions for authentication forms.
 * Uses Angular signals for reactive validation.
 */

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Check individual password requirements
 */
export function checkPasswordRequirements(
  password: string
): PasswordRequirementCheck {
  return {
    minLength: password.length >= PASSWORD_REQUIREMENTS.minLength,
    hasUppercase: PASSWORD_PATTERNS.uppercase.test(password),
    hasLowercase: PASSWORD_PATTERNS.lowercase.test(password),
    hasNumber: PASSWORD_PATTERNS.number.test(password),
    hasSpecialChar: PASSWORD_PATTERNS.specialChar.test(password),
  };
}

/**
 * Validate password meets all strength requirements (for signup)
 */
export function isStrongPassword(password: string): boolean {
  const checks = checkPasswordRequirements(password);
  return (
    checks.minLength &&
    checks.hasUppercase &&
    checks.hasLowercase &&
    checks.hasNumber &&
    checks.hasSpecialChar
  );
}

/**
 * Validate password meets minimum requirements (for signin - less strict)
 */
export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Create a computed signal for email validation
 */
export function createEmailValidation(
  emailSignal: Signal<string>
): Signal<boolean> {
  return computed(() => isValidEmail(emailSignal()));
}

/**
 * Create a computed signal for password validation (basic - signin)
 */
export function createPasswordValidation(
  passwordSignal: Signal<string>
): Signal<boolean> {
  return computed(() => isValidPassword(passwordSignal()));
}

/**
 * Create a computed signal for strong password validation (signup)
 */
export function createStrongPasswordValidation(
  passwordSignal: Signal<string>
): Signal<boolean> {
  return computed(() => isStrongPassword(passwordSignal()));
}

/**
 * Create a computed signal for password requirements check
 */
export function createPasswordRequirementsCheck(
  passwordSignal: Signal<string>
): Signal<PasswordRequirementCheck> {
  return computed(() => checkPasswordRequirements(passwordSignal()));
}

/**
 * Create a computed signal for complete form validation (signin)
 */
export function createFormValidation(
  emailSignal: Signal<string>,
  passwordSignal: Signal<string>
): Signal<boolean> {
  return computed(
    () => isValidEmail(emailSignal()) && isValidPassword(passwordSignal())
  );
}

/**
 * Create a computed signal for signup form validation (stricter)
 */
export function createSignupFormValidation(
  emailSignal: Signal<string>,
  passwordSignal: Signal<string>
): Signal<boolean> {
  return computed(
    () => isValidEmail(emailSignal()) && isStrongPassword(passwordSignal())
  );
}

/**
 * Get validation result with message
 */
export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { valid: false, message: 'Email is required' };
  }
  if (!isValidEmail(email)) {
    return { valid: false, message: 'Please enter a valid email address' };
  }
  return { valid: true };
}

/**
 * Get validation result with message for password (basic - signin)
 */
export function validatePassword(password: string): ValidationResult {
  if (!password) {
    return { valid: false, message: 'Password is required' };
  }
  if (!isValidPassword(password)) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  return { valid: true };
}

/**
 * Get validation result with detailed message for strong password (signup)
 */
export function validateStrongPassword(password: string): ValidationResult {
  if (!password) {
    return { valid: false, message: 'Password is required' };
  }

  const checks = checkPasswordRequirements(password);
  const missing: string[] = [];

  if (!checks.minLength) {
    missing.push('at least 8 characters');
  }
  if (!checks.hasUppercase) {
    missing.push('an uppercase letter');
  }
  if (!checks.hasLowercase) {
    missing.push('a lowercase letter');
  }
  if (!checks.hasNumber) {
    missing.push('a number');
  }
  if (!checks.hasSpecialChar) {
    missing.push('a special character (!@#$%^&*...)');
  }

  if (missing.length > 0) {
    return {
      valid: false,
      message: `Password must have: ${missing.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Validate entire auth form
 */
export function validateAuthForm(
  email: string,
  password: string
): ValidationResult {
  const emailResult = validateEmail(email);
  if (!emailResult.valid) {
    return emailResult;
  }

  const passwordResult = validatePassword(password);
  if (!passwordResult.valid) {
    return passwordResult;
  }

  return { valid: true };
}
