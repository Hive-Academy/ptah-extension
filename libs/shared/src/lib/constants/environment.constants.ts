/**
 * Centralized environment configuration for the Ptah platform.
 *
 * Single source of truth for all production URLs and settings used across:
 * - VS Code extension host
 * - Frontend webview
 * - Landing page
 * - License server (fallback defaults)
 */

/** Log severity levels (shared across all layers) */
export type PtahLogLevel = 'debug' | 'info' | 'warn' | 'error';

export const PtahUrls = {
  /** Landing page / marketing site */
  FRONTEND_URL: 'https://ptah.live',
  /** License server API */
  API_URL: 'https://api.ptah.live',
  /** Pricing page */
  PRICING_URL: 'https://ptah.live/pricing',
  /** Signup page */
  SIGNUP_URL: 'https://ptah.live/signup',
} as const;

/** Production environment defaults */
export const PtahProdDefaults = {
  /** Minimum log level in production — suppresses debug noise */
  LOG_LEVEL: 'info' as PtahLogLevel,
  /** Whether to log to console in addition to output channel */
  LOG_TO_CONSOLE: false,
} as const;

/**
 * Development overrides (used when NODE_ENV !== 'production' or when debugging).
 * The extension reads these in dev; in production builds, PtahUrls is used directly.
 */
export const PtahDevUrls = {
  FRONTEND_URL: 'http://localhost:4200',
  API_URL: 'http://localhost:3000',
  PRICING_URL: 'http://localhost:4200/pricing',
  SIGNUP_URL: 'http://localhost:4200/signup',
} as const;

/** Development environment defaults */
export const PtahDevDefaults = {
  /** Minimum log level in development — show everything */
  LOG_LEVEL: 'debug' as PtahLogLevel,
  /** Whether to log to console in addition to output channel */
  LOG_TO_CONSOLE: true,
} as const;

/**
 * License response signing public key (Ed25519, base64-encoded DER SPKI).
 *
 * Used by the VS Code extension to verify license server responses,
 * preventing MITM attacks from faking valid license status.
 *
 * Generate a key pair with: npx ts-node scripts/generate-license-keys.ts
 * Set the private key as LICENSE_SIGNING_PRIVATE_KEY env var on the server.
 * Replace this placeholder with the generated public key before production.
 */
export const LICENSE_PUBLIC_KEY_BASE64 =
  'MCowBQYDK2VwAyEAy8PRu7wT/Fv2yGMPd/5kNyKfs0i42C7oAvsk63pV/MA=';

/**
 * Resolve the correct URL set and defaults for the current environment.
 *
 * @param isDevelopment - true when running in dev mode (e.g., VS Code ExtensionMode.Development)
 * @returns Resolved URLs and defaults for the active environment
 */
export function resolveEnvironment(isDevelopment: boolean) {
  return {
    urls: isDevelopment ? PtahDevUrls : PtahUrls,
    defaults: isDevelopment ? PtahDevDefaults : PtahProdDefaults,
  };
}
