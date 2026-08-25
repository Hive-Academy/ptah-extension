/**
 * AI-provider runtime guards.
 *
 * `isProviderError` is the narrowing every provider `catch (error: unknown)`
 * runs before it reads `.suggestedAction` and shows it to the user. If it
 * accepts a plain object, the UI renders `undefined` as the recovery advice;
 * if it rejects a genuine `ProviderError`, the user gets the generic fallback
 * instead of the specific fix. Both are silent.
 */
import {
  PROVIDER_IDS,
  isProviderError,
  isValidProviderId,
  type ProviderError,
} from './ai-provider.types';

/** A real `ProviderError`: an Error subclass carrying the four fields. */
function makeProviderError(
  overrides: Partial<Record<keyof ProviderError, unknown>> = {},
): unknown {
  const error = new Error('upstream refused the request') as unknown as Record<
    string,
    unknown
  >;
  Object.assign(
    error,
    {
      type: 'authentication',
      providerId: 'claude-cli',
      recoverable: true,
      suggestedAction: 'Re-run authentication',
    },
    overrides,
  );
  return error;
}

describe('isProviderError', () => {
  it('accepts an Error carrying all four required fields', () => {
    expect(isProviderError(makeProviderError())).toBe(true);
  });

  it('accepts one that also carries the optional context', () => {
    expect(
      isProviderError(makeProviderError({ context: { status: 401 } })),
    ).toBe(true);
  });

  it.each(['type', 'providerId', 'recoverable', 'suggestedAction'] as const)(
    'rejects an Error missing %s',
    (field) => {
      const error = makeProviderError() as Record<string, unknown>;
      delete error[field];
      expect(isProviderError(error)).toBe(false);
    },
  );

  it('rejects a plain object carrying all four fields', () => {
    // Shape alone is not enough: the consumer does `error.stack` and expects
    // an Error. A duck-typed literal would render as `undefined` there.
    const duck = {
      type: 'authentication',
      providerId: 'claude-cli',
      recoverable: true,
      suggestedAction: 'Re-run authentication',
    };
    expect(isProviderError(duck)).toBe(false);
  });

  it('rejects a bare Error', () => {
    expect(isProviderError(new Error('boom'))).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'authentication failed'],
    ['a number', 500],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    expect(isProviderError(value)).toBe(false);
  });

  it('accepts an Error subclass', () => {
    class UpstreamError extends Error {}
    const error = new UpstreamError('nope') as unknown as Record<
      string,
      unknown
    >;
    Object.assign(error, {
      type: 'rate_limit',
      providerId: 'ptah-cli',
      recoverable: false,
      suggestedAction: 'Wait and retry',
    });
    expect(isProviderError(error)).toBe(true);
  });
});

describe('isValidProviderId', () => {
  it('accepts exactly the ids in PROVIDER_IDS', () => {
    for (const id of PROVIDER_IDS) {
      expect(isValidProviderId(id)).toBe(true);
    }
  });

  it('stays in step with PROVIDER_IDS', () => {
    // The guard is a hand-written disjunction; this is what catches an id
    // added to the constant and forgotten in the guard.
    expect(PROVIDER_IDS.filter((id) => isValidProviderId(id))).toEqual([
      ...PROVIDER_IDS,
    ]);
  });

  it.each([
    ['empty', ''],
    ['unknown id', 'openrouter'],
    ['wrong case', 'Claude-CLI'],
    ['padded', ' claude-cli '],
    ['near miss', 'claude-cli-2'],
  ])('rejects %s', (_label, id) => {
    expect(isValidProviderId(id)).toBe(false);
  });
});
