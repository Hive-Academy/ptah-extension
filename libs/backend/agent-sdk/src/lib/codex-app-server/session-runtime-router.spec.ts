import type {
  SessionId,
  SessionRuntimeControls,
  SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import {
  SessionRuntimeRouter,
  type NativeSessionControls,
} from './session-runtime-router';
import {
  SessionRuntimeRoutingError,
  type SessionRuntimeIdentityLookup,
} from './session-runtime-identity';

const id = 'session' as SessionId;
const legacyIdentity: SessionRuntimeIdentity = {
  version: 1,
  sessionId: id,
  providerId: 'anthropic',
  workspaceId: '/workspace',
  runtime: 'claude-sdk',
};
const nativeIdentity: SessionRuntimeIdentity = {
  ...legacyIdentity,
  providerId: 'openai-codex',
  runtime: 'codex-app-server',
  codex: { normalizedHome: '/codex' },
};

function controls(): jest.Mocked<SessionRuntimeControls> {
  return {
    setPermission: jest
      .fn()
      .mockResolvedValue({ timing: 'effectiveNow', revision: 1 }),
    setModel: jest.fn().mockResolvedValue({ timing: 'nextTurn', revision: 2 }),
    setEffort: jest.fn().mockResolvedValue({ timing: 'nextTurn', revision: 3 }),
    interrupt: jest.fn().mockResolvedValue(true),
    compact: jest.fn().mockResolvedValue(undefined),
  };
}

function setup(
  binding: ReturnType<SessionRuntimeIdentityLookup['lookup']> = {
    live: nativeIdentity,
  },
) {
  const lookup = jest.fn(() => binding);
  const legacy = controls();
  const native: jest.Mocked<NativeSessionControls> = {
    ...controls(),
    canSendFollowUp: jest.fn().mockReturnValue(true),
    releaseSession: jest.fn(),
  };
  return {
    router: new SessionRuntimeRouter({ lookup }, legacy, native),
    lookup,
    legacy,
    native,
  };
}

describe('SessionRuntimeRouter', () => {
  it.each([legacyIdentity, nativeIdentity])(
    'dispatches all controls using $runtime identity, preserving timing',
    async (identity) => {
      const { router, legacy, native } = setup({ persisted: identity });
      const target = identity.runtime === 'claude-sdk' ? legacy : native;
      const other = identity.runtime === 'claude-sdk' ? native : legacy;
      await expect(router.setPermission(id, 'yolo')).resolves.toEqual({
        timing: 'effectiveNow',
        revision: 1,
      });
      await expect(router.setModel(id, '')).resolves.toEqual({
        timing: 'nextTurn',
        revision: 2,
      });
      await expect(router.setEffort(id, 'max')).resolves.toEqual({
        timing: 'nextTurn',
        revision: 3,
      });
      await router.setEffort(id, undefined);
      await router.compact(id);
      await router.interrupt(id);
      expect(target.setPermission).toHaveBeenCalledWith(id, 'yolo');
      expect(target.setModel).toHaveBeenCalledWith(id, '');
      expect(target.setEffort).toHaveBeenLastCalledWith(id, undefined);
      expect(target.compact).toHaveBeenCalledWith(id);
      expect(target.interrupt).toHaveBeenCalledWith(id);
      for (const call of Object.values(other))
        expect(call).not.toHaveBeenCalled();
    },
  );

  it('does not consult a focused provider when the persisted identity selects native', async () => {
    const { router, legacy, native, lookup } = setup({
      persisted: nativeIdentity,
    });
    // The lookup may carry UI context; only its session identity is consumed.
    const context = {
      persisted: nativeIdentity,
      focusedProviderId: 'anthropic',
    };
    lookup.mockReturnValue(context);
    await router.setPermission(id, 'yolo');
    expect(native.setPermission).toHaveBeenCalledWith(id, 'yolo');
    expect(legacy.setPermission).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'missing-identity'],
    [{ live: nativeIdentity, persisted: legacyIdentity }, 'identity-mismatch'],
    [
      { live: { ...nativeIdentity, sessionId: 'other' as SessionId } },
      'identity-mismatch',
    ],
    [
      {
        live: nativeIdentity,
        persisted: { ...nativeIdentity, codex: { normalizedHome: '/other' } },
      },
      'identity-mismatch',
    ],
  ] as const)(
    'rejects invalid identity bindings without fallback (%s)',
    async (binding, code) => {
      const { router, legacy, native } = setup({});
      const invalid = new SessionRuntimeRouter(
        { lookup: () => binding },
        legacy,
        native,
      );
      await expect(invalid.setModel(id, 'model')).rejects.toMatchObject({
        name: 'SessionRuntimeRoutingError',
        code,
      });
      expect(() => invalid.canSendFollowUp(id)).toThrow(
        SessionRuntimeRoutingError,
      );
      expect(legacy.setModel).not.toHaveBeenCalled();
      expect(native.setModel).not.toHaveBeenCalled();
      expect(() => router.canSendFollowUp(id)).toThrow(
        SessionRuntimeRoutingError,
      );
    },
  );

  it('never falls back when the selected runtime fails', async () => {
    const { router, native, legacy } = setup();
    native.setModel.mockRejectedValue(new Error('native unavailable'));
    await expect(router.setModel(id, 'model')).rejects.toThrow(
      'native unavailable',
    );
    expect(legacy.setModel).not.toHaveBeenCalled();
  });

  it.each(['tab', 'pre-metadata-claude'])(
    'routes unknown %s to legacy controls',
    async (value) => {
      const { legacy, native } = setup();
      const router = new SessionRuntimeRouter(
        { lookup: () => undefined },
        legacy,
        native,
      );
      const sessionId = value as SessionId;
      await router.setModel(sessionId, 'model');
      await router.interrupt(sessionId);
      expect(router.canSendFollowUp(sessionId)).toBe(true);
      expect(legacy.setModel).toHaveBeenCalledWith(sessionId, 'model');
      expect(legacy.interrupt).toHaveBeenCalledWith(sessionId);
      expect(native.setModel).not.toHaveBeenCalled();
      expect(native.interrupt).not.toHaveBeenCalled();
      expect(native.canSendFollowUp).not.toHaveBeenCalled();
    },
  );

  it('does not block Claude follow-ups after an interrupt timeout or failure', async () => {
    const { router, legacy, native } = setup({ persisted: legacyIdentity });
    legacy.interrupt
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('failed'));
    await expect(router.interrupt(id)).resolves.toBe(false);
    expect(router.canSendFollowUp(id)).toBe(true);
    await expect(router.interrupt(id)).rejects.toThrow('failed');
    expect(router.canSendFollowUp(id)).toBe(true);
    expect(native.canSendFollowUp).not.toHaveBeenCalled();
  });

  it('delegates native gating so turn end clears failed interrupt blocks', async () => {
    const { router, native, legacy } = setup();
    native.interrupt
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('failed'));
    native.canSendFollowUp.mockReturnValue(false);
    await expect(router.interrupt(id)).resolves.toBe(false);
    expect(router.canSendFollowUp(id)).toBe(false);
    await expect(router.interrupt(id)).rejects.toThrow('failed');
    expect(router.canSendFollowUp(id)).toBe(false);
    // Native controls observe turn end without a second successful interrupt.
    native.canSendFollowUp.mockReturnValue(true);
    expect(router.canSendFollowUp(id)).toBe(true);
    expect(native.canSendFollowUp).toHaveBeenCalledWith(id);
    expect(legacy.interrupt).not.toHaveBeenCalled();
  });

  it('releases native lifecycle state without retaining router state', () => {
    const { router, native, lookup } = setup();
    router.releaseSession(id);
    expect(native.releaseSession).toHaveBeenCalledWith(id);
    lookup.mockReturnValue({ persisted: legacyIdentity });
    router.releaseSession(id);
    expect(native.releaseSession).toHaveBeenCalledTimes(1);
    expect(router.canSendFollowUp(id)).toBe(true);
  });
  it('accepts a stream-less follow-up only for an idle native session', () => {
    const { router, native, lookup } = setup({ persisted: nativeIdentity });
    expect(router.acceptsFollowUpWithoutStream(id)).toBe(true);
    native.canSendFollowUp.mockReturnValue(false);
    expect(router.acceptsFollowUpWithoutStream(id)).toBe(false);
    native.canSendFollowUp.mockClear();
    lookup.mockReturnValue({ persisted: legacyIdentity });
    expect(router.acceptsFollowUpWithoutStream(id)).toBe(false);
    const legacy = controls();
    const unknown = new SessionRuntimeRouter(
      { lookup: () => undefined },
      legacy,
      native,
    );
    expect(unknown.acceptsFollowUpWithoutStream(id)).toBe(false);
    expect(native.canSendFollowUp).not.toHaveBeenCalled();
  });

  it.each([legacyIdentity, nativeIdentity])('forwards persistence scope to $runtime', async (identity) => {
    const { router, legacy, native } = setup({ persisted: identity });
    const target = identity.runtime === 'claude-sdk' ? legacy : native;
    const options = { applyTo: 'workspace' } as const;
    await router.setModel(id, 'new', options);
    await router.setEffort(id, 'max', options);
    await router.setPermission(id, 'plan', options);
    expect(target.setModel).toHaveBeenCalledWith(id, 'new', options);
    expect(target.setEffort).toHaveBeenCalledWith(id, 'max', options);
    expect(target.setPermission).toHaveBeenCalledWith(id, 'plan', options);
  });

});
