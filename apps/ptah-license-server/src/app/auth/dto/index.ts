/**
 * Auth DTOs
 *
 * All DTOs use class-validator decorators for input validation.
 * These are validated by the global ValidationPipe in main.ts.
 */
export { LoginDto } from './login.dto';
export { SignupDto } from './signup.dto';
export { VerifyEmailDto } from './verify-email.dto';
export { ResendVerificationDto } from './resend-verification.dto';
export { MagicLinkDto } from './magic-link.dto';
