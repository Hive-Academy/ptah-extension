import { SessionId, type SessionRuntimeIdentity } from '@ptah-extension/shared';
import {
  legacyClaudeSessionRuntimeIdentity,
  resolveSessionRuntimeIdentity,
  SessionRuntimeRoutingError,
} from './session-runtime-identity';

const id = SessionId.from('33333333-3333-4333-8333-333333333333');
const native: SessionRuntimeIdentity = {
  version: 1,
  sessionId: id,
  providerId: 'openai-codex',
  workspaceId: '/workspace',
  runtime: 'codex-app-server',
  codex: { normalizedHome: '/home' },
};
const legacy: SessionRuntimeIdentity = {
  version: 1,
  sessionId: id,
  providerId: 'anthropic',
  workspaceId: '/workspace',
  runtime: 'claude-sdk',
};

describe('legacyClaudeSessionRuntimeIdentity', () => {
  it('uses the Claude CLI provider when metadata has no provider', () => {
    expect(legacyClaudeSessionRuntimeIdentity({ sessionId: id, workspaceId: '/workspace' }))
      .toEqual({
        version: 1,
        sessionId: id,
        runtime: 'claude-sdk',
        providerId: 'claude-cli',
        workspaceId: '/workspace',
      });
  });

  it('preserves a stored provider', () => {
    expect(legacyClaudeSessionRuntimeIdentity({
      sessionId: id,
      workspaceId: '/workspace',
      providerId: 'anthropic',
    })).toEqual(legacy);
  });
});

describe('resolveSessionRuntimeIdentity', () => {
  it('allows unknown tab and pre-metadata session ids to use legacy', () => {
    const lookup = jest.fn(() => undefined);
    expect(
      resolveSessionRuntimeIdentity({ lookup }, 'tab' as SessionId),
    ).toBeUndefined();
    expect(resolveSessionRuntimeIdentity({ lookup }, id)).toBeUndefined();
    expect(lookup).toHaveBeenNthCalledWith(1, 'tab');
    expect(lookup).toHaveBeenNthCalledWith(2, id);
  });

  it.each([native, legacy])(
    'resolves live, persisted and matching bindings for $runtime',
    (identity) => {
      expect(
        resolveSessionRuntimeIdentity(
          { lookup: () => ({ live: identity }) },
          id,
        ),
      ).toBe(identity);
      expect(
        resolveSessionRuntimeIdentity(
          { lookup: () => ({ persisted: identity }) },
          id,
        ),
      ).toBe(identity);
      expect(
        resolveSessionRuntimeIdentity(
          { lookup: () => ({ live: identity, persisted: { ...identity } }) },
          id,
        ),
      ).toBe(identity);
    },
  );

  it('rejects a known binding with missing identity', () => {
    expect(() =>
      resolveSessionRuntimeIdentity({ lookup: () => ({}) }, id),
    ).toThrow(new SessionRuntimeRoutingError('missing-identity', id));
  });

  it.each([
    [{ live: native, persisted: legacy }, 'providerId'],
    [{ live: { ...native, sessionId: 'other' as SessionId } }, 'sessionId'],
    [
      { persisted: { ...native, sessionId: 'other' as SessionId } },
      'sessionId',
    ],
    [
      {
        live: native,
        persisted: { ...native, codex: { normalizedHome: '/other' } },
      },
      'normalizedHome',
    ],
  ] as const)(
    'rejects inconsistent bindings without losing the error code',
    (binding, field) => {
      try {
        resolveSessionRuntimeIdentity({ lookup: () => binding }, id);
        throw new Error('Expected routing failure');
      } catch (error) {
        expect(error).toBeInstanceOf(SessionRuntimeRoutingError);
        expect(error).toMatchObject({
          code: 'identity-mismatch',
          sessionId: id,
          field,
        });
      }
    },
  );

  it('propagates lookup failures', () => {
    const error = new Error('lookup failed');
    expect(() =>
      resolveSessionRuntimeIdentity(
        {
          lookup: () => {
            throw error;
          },
        },
        id,
      ),
    ).toThrow(error);
  });
});
