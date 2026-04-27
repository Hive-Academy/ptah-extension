/**
 * WebSearchRpcHandlers schema — unit specs (TASK_2025_294 W2.B5).
 *
 * Surface under test: the schema module extracted in W2.B5 — it exposes
 * `VALID_PROVIDERS` (runtime Set used by the handler's validateProvider()
 * throw-path), `SECRET_KEY_PREFIX` (SecretStorage namespace — changing it
 * would orphan already-stored end-user keys), and `WebSearchProviderSchema`
 * (a Zod mirror of the same enum for structured parse-style callsites).
 *
 * Behavioural contracts locked in here:
 *   - Provider set membership — only the three documented providers pass;
 *     casing / whitespace / empty / unrelated strings are rejected.
 *   - SECRET_KEY_PREFIX value stability — a regression here would silently
 *     invalidate credentials stored by prior extension versions.
 *   - Zod enum ↔ Set parity — `WebSearchProviderSchema.safeParse(x)` and
 *     `VALID_PROVIDERS.has(x)` must agree for every candidate.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.schema.ts`
 */

import 'reflect-metadata';

import {
  SECRET_KEY_PREFIX,
  VALID_PROVIDERS,
  WebSearchProviderSchema,
} from './web-search-rpc.schema';

describe('web-search-rpc.schema', () => {
  describe('SECRET_KEY_PREFIX', () => {
    it('is the stable public SecretStorage namespace', () => {
      // Changing this value would orphan API keys stored by older versions of
      // the extension. Lock it in verbatim.
      expect(SECRET_KEY_PREFIX).toBe('ptah.webSearch.apiKey');
    });
  });

  describe('VALID_PROVIDERS', () => {
    it.each(['tavily', 'serper', 'exa'])('accepts provider "%s"', (name) => {
      expect(VALID_PROVIDERS.has(name)).toBe(true);
    });

    it.each([
      'Tavily', // wrong case — Set is case-sensitive
      'TAVILY',
      'google', // unrelated provider
      'bing',
      '', // empty string
      ' tavily', // leading whitespace
      'tavily ',
      'openai', // trademarked name, must not appear in the allowlist
    ])('rejects unsupported / malformed provider "%s"', (name) => {
      expect(VALID_PROVIDERS.has(name)).toBe(false);
    });

    it('contains exactly the three documented providers', () => {
      // Guards against accidental additions — a new provider requires
      // handler/spec updates together (createProviderAdapter switch must
      // also be extended).
      expect(Array.from(VALID_PROVIDERS).sort()).toEqual(
        ['exa', 'serper', 'tavily'].sort(),
      );
    });
  });

  describe('WebSearchProviderSchema', () => {
    it.each(['tavily', 'serper', 'exa'] as const)(
      'parses provider "%s" as typed enum member',
      (name) => {
        const result = WebSearchProviderSchema.safeParse(name);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(name);
        }
      },
    );

    it.each(['google', 'bing', 'TAVILY', '', 'tavily ', 42, null, undefined])(
      'rejects "%p" with a ZodError',
      (value) => {
        const result = WebSearchProviderSchema.safeParse(value);
        expect(result.success).toBe(false);
      },
    );

    it('agrees with VALID_PROVIDERS for every tested candidate', () => {
      const candidates = [
        'tavily',
        'serper',
        'exa',
        'google',
        'TAVILY',
        '',
        'bing',
      ];
      for (const c of candidates) {
        const setSays = VALID_PROVIDERS.has(c);
        const zodSays = WebSearchProviderSchema.safeParse(c).success;
        expect({ candidate: c, zodSays }).toEqual({
          candidate: c,
          zodSays: setSays,
        });
      }
    });
  });
});
