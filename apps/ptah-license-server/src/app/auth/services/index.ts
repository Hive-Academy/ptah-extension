/**
 * Auth Services Barrel Export
 *
 * Organized by domain:
 * - workos/  : WorkOS API operations
 * - token/   : JWT, PKCE, tickets, magic links
 * - sync/    : Database synchronization
 */

// Main orchestrator
export { AuthService, OAuthProvider } from './auth.service';

// Re-export from subdirectories
export * from './workos';
export * from './token';
export * from './sync';
