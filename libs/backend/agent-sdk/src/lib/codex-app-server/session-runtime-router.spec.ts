import type {
  SessionId,
  SessionRuntimeControls,
  SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import {
  SessionRuntimeRouter,
  SessionRuntimeRoutingError,
  type SessionRuntimeIdentityLookup,
} from './session-runtime-router';

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
  const native = controls();
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
    [undefined, 'unknown-session'],
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

  it('blocks follow-ups on false or thrown interrupt until a successful interrupt', async () => {
    const { router, native } = setup();
    native.interrupt
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('failed'));
    expect(router.canSendFollowUp(id)).toBe(true);
    await expect(router.interrupt(id)).resolves.toBe(false);
    expect(router.canSendFollowUp(id)).toBe(false);
    await expect(router.interrupt(id)).rejects.toThrow('failed');
    expect(router.canSendFollowUp(id)).toBe(false);
    await router.interrupt(id);
    expect(router.canSendFollowUp(id)).toBe(true);
  });

  it('does not let a late successful interrupt clear a newer failed attempt', async () => {
    const { router, native } = setup();
    let finish: (value: boolean) => void = () => {
      throw new Error('not started');
    };
    native.interrupt
      .mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce(false);
    const first = router.interrupt(id);
    expect(router.canSendFollowUp(id)).toBe(false);
    await router.interrupt(id);
    finish(true);
    await first;
    expect(router.canSendFollowUp(id)).toBe(false);
    router.releaseSession(id);
    expect(router.canSendFollowUp(id)).toBe(true);
  });
});
