/**
 * Platform Core DI Barrel
 *
 * Re-exports the DI tokens for platform abstraction.
 * `platform-core` has no `register.ts` — it is an interface/contract library.
 * Concrete implementations (platform-vscode, platform-electron, platform-cli)
 * own their own registration functions and register against PLATFORM_TOKENS.
 */

export { PLATFORM_TOKENS } from './tokens';
