import {
  authOperationContextSchema,
  type AuthOperationContext,
} from './auth-strategy.types';
import { resolveCodexProxyPolicy } from './codex-proxy-policy';

describe('CodexProxyPolicy', () => {
  const reasons: AuthOperationContext['reason'][] = [
    'startup',
    'provider-selection',
    'reauth',
    'auth-file-changed',
    'legacy-session-start',
  ];

  it('preserves the legacy path when context is omitted', () => {
    expect(resolveCodexProxyPolicy()).toBe('legacy-strategy');
  });

  it.each(reasons)(
    'keeps native-disabled hosts on the legacy path for %s',
    (reason) => {
      expect(
        resolveCodexProxyPolicy({
          reason,
          providerId: 'openai-codex',
          hostNativeCodex: false,
        }),
      ).toBe('legacy-strategy');
    },
  );

  it.each(reasons)('applies explicit native intent for %s', (reason) => {
    expect(
      resolveCodexProxyPolicy({
        reason,
        providerId: 'openai-codex',
        hostNativeCodex: true,
      }),
    ).toBe(
      reason === 'legacy-session-start' ? 'legacy-strategy' : 'native-return',
    );
  });

  it.each(['github-copilot', 'anthropic', 'openrouter'])(
    'does not change %s',
    (providerId) => {
      expect(
        resolveCodexProxyPolicy({
          reason: 'startup',
          providerId,
          hostNativeCodex: true,
        }),
      ).toBe('legacy-strategy');
    },
  );

  it('defaults the host flag to false at the boundary', () => {
    const context = authOperationContextSchema.parse({
      reason: 'startup',
      providerId: 'openai-codex',
    });
    expect(context.hostNativeCodex).toBe(false);
    expect(resolveCodexProxyPolicy(context)).toBe('legacy-strategy');
  });

  it.each([
    { reason: 'invalid', providerId: 'openai-codex' },
    { reason: 'startup', providerId: '' },
    { reason: 'startup', providerId: 'openai-codex', hostNativeCodex: 'true' },
    { reason: 'startup', providerId: 'openai-codex', normalizedHome: '' },
  ])('rejects malformed intent', (value) => {
    expect(authOperationContextSchema.safeParse(value).success).toBe(false);
  });
});
