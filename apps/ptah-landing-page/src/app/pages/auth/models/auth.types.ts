/**
 * Auth Types - Type-safe authentication models
 *
 * Aligns with backend Prisma models and API response types
 * from ptah-license-server
 */

// ============================================
// Auth Modes & Providers
// ============================================

/** Authentication mode - signin or signup */
export type AuthMode = 'signin' | 'signup';

/** Supported OAuth providers (matches backend OAuthProvider type) */
export type OAuthProvider = 'github' | 'google';

// ============================================
// User Types (aligned with Prisma User model)
// ============================================

/**
 * User tier levels (matches backend tier system)
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': Free tier
 * - 'pro': Paid Pro tier ($5/mo or $50/year)
 * - 'trial_pro': Pro trial period (30 days)
 * - 'expired': Subscription expired
 */
export type UserTier = 'community' | 'pro' | 'trial_pro' | 'expired';

/**
 * User response from authentication endpoints
 * Matches backend response structure
 */
export interface AuthUser {
  /** UUID from Prisma User.id */
  id: string;
  /** User email address */
  email: string;
  /** User roles (e.g., ['user'], ['admin']) */
  roles: string[];
  /** Subscription tier */
  tier: UserTier;
  /** First name (optional) */
  firstName?: string;
  /** Last name (optional) */
  lastName?: string;
}

// ============================================
// Request DTOs (match backend DTOs)
// ============================================

/**
 * Email/Password login request
 * POST /api/auth/login/email
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * User signup request
 * POST /api/auth/signup
 */
export interface SignupRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Magic link request
 * POST /api/auth/magic-link
 */
export interface MagicLinkRequest {
  email: string;
  /** Optional return URL for post-auth redirect */
  returnUrl?: string;
  /** Optional plan key for auto-checkout (e.g., 'pro-monthly', 'pro-yearly') */
  plan?: string;
}

// ============================================
// Response Types (match backend responses)
// ============================================

/**
 * Successful authentication response
 * Returned from /api/auth/login/email and /api/auth/verify-email
 */
export interface AuthSuccessResponse {
  success: true;
  user: AuthUser;
}

/**
 * Signup response - pending verification
 * Returned from /api/auth/signup
 */
export interface SignupPendingResponse {
  success: true;
  pendingVerification: true;
  userId: string;
  email: string;
  message: string;
}

/**
 * Failed authentication response
 */
export interface AuthErrorResponse {
  success?: false;
  message: string;
  error?: string;
  /** Error code for programmatic handling */
  code?: string;
  /** User ID if email verification is required */
  userId?: string;
  /** Email if email verification is required */
  email?: string;
}

/**
 * Email verification request
 */
export interface VerifyEmailRequest {
  userId: string;
  code: string;
}

/**
 * Resend verification request
 */
export interface ResendVerificationRequest {
  userId: string;
}

/**
 * Resend verification response
 */
export interface ResendVerificationResponse {
  success: boolean;
  message: string;
}

/**
 * Magic link response
 * Always returns success to prevent email enumeration
 */
export interface MagicLinkResponse {
  success: boolean;
  message: string;
}

/**
 * Union type for auth responses
 */
export type AuthResponse = AuthSuccessResponse | AuthErrorResponse;

// ============================================
// URL Error Codes (from backend redirects)
// ============================================

/**
 * Error codes passed via URL query params
 * from magic link verification failures
 */
export type AuthUrlErrorCode =
  | 'token_missing'
  | 'token_expired'
  | 'token_invalid'
  | 'user_not_found';

/**
 * Mapping of URL error codes to user-friendly messages
 */
export const AUTH_ERROR_MESSAGES: Record<AuthUrlErrorCode | string, string> = {
  token_missing: 'Magic link token is missing. Please request a new one.',
  token_expired: 'Magic link has expired. Please request a new one.',
  token_invalid: 'Invalid magic link. Please request a new one.',
  user_not_found: 'User not found. Please sign up first.',
};

// ============================================
// Form Validation Types
// ============================================

/**
 * Form validation result
 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Email validation regex pattern
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimum password length
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Password strength requirements (matches WorkOS requirements)
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
} as const;

/**
 * Password validation patterns
 */
export const PASSWORD_PATTERNS = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /[0-9]/,
  specialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/,
} as const;

/**
 * Password requirement check result
 */
export interface PasswordRequirementCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}
