/**
 * RPC Registration Verification Helper
 *
 * Ensures that all RPC methods defined in the registry have corresponding
 * backend handlers registered. This provides runtime verification that
 * complements the compile-time type safety of RpcMethodRegistry.
 *
 * TASK_2025_074: RPC Type Safety Improvements
 *
 * Purpose:
 * - Detect missing handlers (frontend can call methods that backend doesn't handle)
 * - Detect orphan handlers (backend has handlers for methods not in registry)
 * - Provide clear error messages during development
 * - Future-proof against handler registration drift
 *
 * Usage:
 *   // After all RPC methods are registered
 *   const result = verifyRpcRegistration(rpcHandler, logger);
 *   if (!result.valid) {
 *     logger.error('RPC registration mismatch!', result);
 *   }
 */

import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import type { RpcHandler } from './rpc-handler';
import type { Logger } from '../logging/logger';

/**
 * Result of RPC registration verification
 */
export interface RpcVerificationResult {
  /** Whether all methods are correctly registered */
  valid: boolean;

  /** Methods in registry but missing handlers (CRITICAL - will cause frontend errors) */
  missingHandlers: string[];

  /** Handlers registered but not in registry (potential dead code) */
  orphanHandlers: string[];

  /** Methods correctly registered */
  registeredMethods: string[];

  /** Total methods expected from registry */
  expectedCount: number;

  /** Total handlers actually registered */
  actualCount: number;
}

/**
 * Verify that all RPC methods in the registry have handlers registered
 *
 * @param rpcHandler - The RpcHandler instance to verify
 * @param logger - Logger for reporting results
 * @returns Verification result with details about any mismatches
 *
 * @example
 * ```typescript
 * // After registering all RPC methods
 * const result = verifyRpcRegistration(rpcHandler, logger);
 *
 * if (!result.valid) {
 *   // In development: throw error to catch issues early
 *   if (isDevelopment) {
 *     throw new Error(`RPC registration incomplete: ${result.missingHandlers.join(', ')}`);
 *   }
 *
 *   // In production: log warning but continue
 *   logger.warn('RPC registration incomplete', {
 *     missing: result.missingHandlers,
 *     orphan: result.orphanHandlers
 *   });
 * }
 * ```
 */
export function verifyRpcRegistration(
  rpcHandler: RpcHandler,
  logger: Logger,
  excludeMethods?: string[],
): RpcVerificationResult {
  const registeredMethods = rpcHandler.getRegisteredMethods();

  // Use string Sets for comparison (runtime values are strings)
  const expectedMethods = new Set<string>(RPC_METHOD_NAMES);
  const actualMethods = new Set<string>(registeredMethods);

  // Remove platform-specific methods that are not applicable in this context
  if (excludeMethods) {
    for (const method of excludeMethods) {
      expectedMethods.delete(method);
    }
  }

  // Find methods in registry but missing handlers
  const missingHandlers: string[] = [];
  for (const method of expectedMethods) {
    if (!actualMethods.has(method)) {
      missingHandlers.push(method);
    }
  }

  // Find handlers registered but not in registry
  const orphanHandlers: string[] = [];
  for (const method of actualMethods) {
    if (!expectedMethods.has(method)) {
      orphanHandlers.push(method);
    }
  }

  const valid = missingHandlers.length === 0;

  const result: RpcVerificationResult = {
    valid,
    missingHandlers,
    orphanHandlers,
    registeredMethods,
    expectedCount: expectedMethods.size,
    actualCount: actualMethods.size,
  };

  // Log the verification result
  if (valid && orphanHandlers.length === 0) {
    logger.info(
      `[RPC Verification] All ${result.expectedCount} RPC methods correctly registered`,
    );
  } else {
    if (missingHandlers.length > 0) {
      logger.error(
        `[RPC Verification] CRITICAL: ${missingHandlers.length} methods missing handlers`,
        new Error(`Missing handlers: ${missingHandlers.join(', ')}`),
      );
    }

    if (orphanHandlers.length > 0) {
      logger.warn(
        `[RPC Verification] ${
          orphanHandlers.length
        } orphan handlers (not in registry): ${orphanHandlers.join(', ')}`,
      );
    }
  }

  return result;
}

/**
 * Assert that RPC registration is complete (throws on failure)
 *
 * Use this in development to catch registration issues early.
 * In production, use verifyRpcRegistration() and handle gracefully.
 *
 * @param rpcHandler - The RpcHandler instance to verify
 * @param logger - Logger for reporting results
 * @throws Error if any expected methods are missing handlers
 *
 * @example
 * ```typescript
 * // In extension activation (development mode)
 * if (process.env.NODE_ENV === 'development') {
 *   assertRpcRegistration(rpcHandler, logger);
 * }
 * ```
 */
export function assertRpcRegistration(
  rpcHandler: RpcHandler,
  logger: Logger,
  excludeMethods?: string[],
): void {
  const result = verifyRpcRegistration(rpcHandler, logger, excludeMethods);

  if (!result.valid) {
    throw new Error(
      `RPC registration incomplete! Missing handlers for: ${result.missingHandlers.join(
        ', ',
      )}\n` +
        `Expected ${result.expectedCount} methods, found ${result.actualCount} handlers.\n` +
        `This usually means a handler was not registered in RpcMethodRegistrationService.`,
    );
  }
}
