/**
 * DI Token Tests - Token Convention Validation
 *
 * TASK_2025_140 Batch 2: Replaced broken container tests with token validation tests.
 *
 * Original tests imported DIContainer from './container' which no longer exists in
 * vscode-core (moved to apps/ptah-extension-vscode/src/di/container.ts).
 * These tests now validate the token definitions that DO exist in this directory.
 *
 * Tests validate:
 * 1. All TOKENS use Symbol.for() (not strings or plain Symbol())
 * 2. All Symbol.for() descriptions are unique
 * 3. TOKENS object is complete and consistent with individual exports
 */

import { TOKENS } from './tokens';
import * as allTokenExports from './tokens';

describe('DI Tokens - Symbol.for() Convention', () => {
  describe('Token Type Safety', () => {
    it('should export all tokens as symbols', () => {
      // Every entry in the TOKENS object must be a symbol
      for (const [key, value] of Object.entries(TOKENS)) {
        // Skip comment entries (keys starting with //)
        if (typeof key === 'string' && !key.startsWith('//')) {
          expect(typeof value).toBe('symbol');
        }
      }
    });

    it('should use Symbol.for() for all tokens (globally resolvable)', () => {
      // Symbol.for() creates symbols in the global symbol registry.
      // We can verify this by checking that Symbol.keyFor() returns the description.
      // Plain Symbol() would return undefined from Symbol.keyFor().
      for (const [key, value] of Object.entries(TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          expect(description).toBeDefined();
          expect(typeof description).toBe('string');
          // Verify the description matches what Symbol.for() would produce
          expect(Symbol.for(description!)).toBe(value);
        }
      }
    });

    it('should not use string tokens (regression guard)', () => {
      // No entry in TOKENS should be a string - this was the bug that TASK_2025_140 fixed
      for (const [, value] of Object.entries(TOKENS)) {
        expect(typeof value).not.toBe('string');
      }
    });
  });

  describe('Token Uniqueness', () => {
    it('should have unique Symbol.for() descriptions across all tokens', () => {
      const descriptions = new Map<string, string>();

      for (const [key, value] of Object.entries(TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          if (description) {
            if (descriptions.has(description)) {
              fail(
                `Duplicate Symbol.for() description "${description}" ` +
                  `found in TOKENS.${key} and TOKENS.${descriptions.get(
                    description
                  )}`
              );
            }
            descriptions.set(description, key);
          }
        }
      }

      // Verify we actually checked some tokens (guard against empty TOKENS)
      expect(descriptions.size).toBeGreaterThan(0);
    });
  });

  describe('Token Completeness', () => {
    it('should export TOKENS object with all individual token exports', () => {
      // Every individually exported Symbol constant should also be in TOKENS
      const individualExports = Object.entries(allTokenExports).filter(
        ([key, value]) =>
          key !== 'TOKENS' && key !== 'DIToken' && typeof value === 'symbol'
      );

      for (const [exportName, exportValue] of individualExports) {
        // Find matching entry in TOKENS by symbol identity
        const matchingEntry = Object.entries(TOKENS).find(
          ([, tokenValue]) => tokenValue === exportValue
        );
        expect(matchingEntry).toBeDefined();
      }
    });

    it('should include essential infrastructure tokens', () => {
      // Core tokens that must always exist
      expect(TOKENS.EXTENSION_CONTEXT).toBeDefined();
      expect(TOKENS.LOGGER).toBeDefined();
      expect(TOKENS.ERROR_HANDLER).toBeDefined();
      expect(TOKENS.CONFIG_MANAGER).toBeDefined();
      expect(TOKENS.RPC_HANDLER).toBeDefined();
      expect(TOKENS.COMMAND_MANAGER).toBeDefined();
      expect(TOKENS.WEBVIEW_MANAGER).toBeDefined();
      expect(TOKENS.OUTPUT_MANAGER).toBeDefined();
    });

    it('should not include deleted tokens', () => {
      // Tokens that were explicitly deleted should not exist
      // EVENT_BUS, MESSAGE_ROUTER, WEBVIEW_MESSAGE_BRIDGE - deleted (event system removed)
      // COMMAND_REGISTRY, WEBVIEW_PROVIDER - deleted in TASK_2025_078
      expect((TOKENS as Record<string, unknown>)['EVENT_BUS']).toBeUndefined();
      expect(
        (TOKENS as Record<string, unknown>)['MESSAGE_ROUTER']
      ).toBeUndefined();
      expect(
        (TOKENS as Record<string, unknown>)['WEBVIEW_MESSAGE_BRIDGE']
      ).toBeUndefined();
      expect(
        (TOKENS as Record<string, unknown>)['COMMAND_REGISTRY']
      ).toBeUndefined();
      expect(
        (TOKENS as Record<string, unknown>)['WEBVIEW_PROVIDER']
      ).toBeUndefined();
    });
  });

  describe('Cross-Module Resolution', () => {
    it('should resolve to same symbol when using Symbol.for() with same description', () => {
      // This is the core guarantee of Symbol.for() that makes cross-module DI work.
      // When agent-sdk creates Symbol.for('SdkAgentAdapter') and vscode-core creates
      // Symbol.for('SdkAgentAdapter'), they must be the same symbol.
      const description = Symbol.keyFor(TOKENS.SDK_AGENT_ADAPTER);
      expect(description).toBe('SdkAgentAdapter');
      expect(Symbol.for('SdkAgentAdapter')).toBe(TOKENS.SDK_AGENT_ADAPTER);
    });

    it('should resolve Logger token consistently', () => {
      // Context service uses local Symbol.for('Logger') to avoid circular dependency.
      // This must resolve to the same symbol as TOKENS.LOGGER.
      const localLoggerToken = Symbol.for('Logger');
      expect(localLoggerToken).toBe(TOKENS.LOGGER);
    });
  });
});
