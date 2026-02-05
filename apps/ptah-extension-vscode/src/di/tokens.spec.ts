/**
 * DI Token Tests - Token Convention Validation
 *
 * TASK_2025_140 Batch 2: Replaced broken container tests with token validation tests.
 * Moved from libs/backend/vscode-core/src/di/container.spec.ts to app layer
 * to avoid circular dependency detection (apps can import all libraries).
 *
 * Tests validate:
 * 1. All TOKENS use Symbol.for() (not strings or plain Symbol())
 * 2. All Symbol.for() descriptions are unique
 * 3. TOKENS object is complete and consistent with individual exports
 * 4. SDK_TOKENS and AGENT_GENERATION_TOKENS follow the same conventions
 * 5. No Symbol.for() description collisions across all token files
 */

import { TOKENS } from '@ptah-extension/vscode-core';
import * as allTokenExports from '@ptah-extension/vscode-core';
// Test file needs static imports for token validation - override lazy-loading rule
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

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
      for (const [, value] of Object.entries(TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          expect(description).toBeDefined();
          expect(typeof description).toBe('string');
          // Verify the description matches what Symbol.for() would produce
          expect(Symbol.for(description as string)).toBe(value);
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

      for (const [, exportValue] of individualExports) {
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

describe('SDK_TOKENS - Symbol.for() Convention', () => {
  describe('Token Type Safety', () => {
    it('should export all tokens as symbols', () => {
      for (const [key, value] of Object.entries(SDK_TOKENS)) {
        if (typeof key === 'string' && !key.startsWith('//')) {
          expect(typeof value).toBe('symbol');
        }
      }
    });

    it('should use Symbol.for() for all tokens (globally resolvable)', () => {
      for (const [, value] of Object.entries(SDK_TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          expect(description).toBeDefined();
          expect(typeof description).toBe('string');
          expect(Symbol.for(description as string)).toBe(value);
        }
      }
    });

    it('should not use string tokens (regression guard)', () => {
      for (const [, value] of Object.entries(SDK_TOKENS)) {
        expect(typeof value).not.toBe('string');
      }
    });
  });

  describe('Token Uniqueness', () => {
    it('should have unique Symbol.for() descriptions across all SDK tokens', () => {
      const descriptions = new Map<string, string>();

      for (const [key, value] of Object.entries(SDK_TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          if (description) {
            if (descriptions.has(description)) {
              fail(
                `Duplicate Symbol.for() description "${description}" ` +
                  `found in SDK_TOKENS.${key} and SDK_TOKENS.${descriptions.get(
                    description
                  )}`
              );
            }
            descriptions.set(description, key);
          }
        }
      }

      expect(descriptions.size).toBeGreaterThan(0);
    });
  });

  describe('Token Naming Convention', () => {
    it('should use Sdk prefix for all Symbol.for() descriptions', () => {
      const violations: string[] = [];

      for (const [key, value] of Object.entries(SDK_TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          if (description && !description.startsWith('Sdk')) {
            violations.push(
              `SDK_TOKENS.${key} has description "${description}" which does not start with "Sdk"`
            );
          }
        }
      }

      if (violations.length > 0) {
        fail(`Token naming convention violations:\n${violations.join('\n')}`);
      }
    });
  });
});

describe('AGENT_GENERATION_TOKENS - Symbol.for() Convention', () => {
  describe('Token Type Safety', () => {
    it('should export all tokens as symbols', () => {
      for (const [key, value] of Object.entries(AGENT_GENERATION_TOKENS)) {
        if (typeof key === 'string' && !key.startsWith('//')) {
          expect(typeof value).toBe('symbol');
        }
      }
    });

    it('should use Symbol.for() for all tokens (globally resolvable)', () => {
      for (const [, value] of Object.entries(AGENT_GENERATION_TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          expect(description).toBeDefined();
          expect(typeof description).toBe('string');
          expect(Symbol.for(description as string)).toBe(value);
        }
      }
    });

    it('should not use string tokens (regression guard)', () => {
      for (const [, value] of Object.entries(AGENT_GENERATION_TOKENS)) {
        expect(typeof value).not.toBe('string');
      }
    });
  });

  describe('Token Uniqueness', () => {
    it('should have unique Symbol.for() descriptions across all agent-generation tokens', () => {
      const descriptions = new Map<string, string>();

      for (const [key, value] of Object.entries(AGENT_GENERATION_TOKENS)) {
        if (typeof value === 'symbol') {
          const description = Symbol.keyFor(value);
          if (description) {
            if (descriptions.has(description)) {
              fail(
                `Duplicate Symbol.for() description "${description}" ` +
                  `found in AGENT_GENERATION_TOKENS.${key} and AGENT_GENERATION_TOKENS.${descriptions.get(
                    description
                  )}`
              );
            }
            descriptions.set(description, key);
          }
        }
      }

      expect(descriptions.size).toBeGreaterThan(0);
    });
  });
});

describe('Cross-Token-File Collision Detection', () => {
  // Intentionally shared tokens (same Symbol.for() description for cross-library resolution)
  const INTENTIONAL_SHARES = new Set(['SdkAgentAdapter']);

  it('should not have Symbol.for() description collisions across TOKENS, SDK_TOKENS, and AGENT_GENERATION_TOKENS', () => {
    const allDescriptions = new Map<string, { file: string; key: string }>();
    const collisions: string[] = [];

    // Collect TOKENS descriptions
    for (const [key, value] of Object.entries(TOKENS)) {
      if (typeof value === 'symbol') {
        const description = Symbol.keyFor(value);
        if (description) {
          allDescriptions.set(description, { file: 'TOKENS', key });
        }
      }
    }

    // Check SDK_TOKENS for collisions
    for (const [key, value] of Object.entries(SDK_TOKENS)) {
      if (typeof value === 'symbol') {
        const description = Symbol.keyFor(value);
        if (description && allDescriptions.has(description)) {
          const existing = allDescriptions.get(description) as {
            file: string;
            key: string;
          };
          if (!INTENTIONAL_SHARES.has(description)) {
            collisions.push(
              `"${description}" collision: ${existing.file}.${existing.key} vs SDK_TOKENS.${key}`
            );
          }
        } else if (description) {
          allDescriptions.set(description, { file: 'SDK_TOKENS', key });
        }
      }
    }

    // Check AGENT_GENERATION_TOKENS for collisions
    for (const [key, value] of Object.entries(AGENT_GENERATION_TOKENS)) {
      if (typeof value === 'symbol') {
        const description = Symbol.keyFor(value);
        if (description && allDescriptions.has(description)) {
          const existing = allDescriptions.get(description) as {
            file: string;
            key: string;
          };
          if (!INTENTIONAL_SHARES.has(description)) {
            collisions.push(
              `"${description}" collision: ${existing.file}.${existing.key} vs AGENT_GENERATION_TOKENS.${key}`
            );
          }
        } else if (description) {
          allDescriptions.set(description, {
            file: 'AGENT_GENERATION_TOKENS',
            key,
          });
        }
      }
    }

    if (collisions.length > 0) {
      fail(
        `Symbol.for() description collisions detected:\n${collisions.join(
          '\n'
        )}`
      );
    }

    // Verify we actually checked tokens
    expect(allDescriptions.size).toBeGreaterThan(50);
  });

  it('should correctly identify intentional shares (SdkAgentAdapter)', () => {
    // TOKENS.SDK_AGENT_ADAPTER and SDK_TOKENS.SDK_AGENT_ADAPTER
    // should resolve to the same symbol (intentional cross-library resolution)
    expect(TOKENS.SDK_AGENT_ADAPTER).toBe(SDK_TOKENS.SDK_AGENT_ADAPTER);
    expect(Symbol.keyFor(TOKENS.SDK_AGENT_ADAPTER)).toBe('SdkAgentAdapter');
  });
});
