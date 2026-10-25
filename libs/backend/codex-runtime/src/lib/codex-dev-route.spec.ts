import { readCodexDevRouteOverride } from './codex-dev-route';

describe('readCodexDevRouteOverride', () => {
  it('enables only chat with a frozen override in an unpackaged host', () => {
    const override = readCodexDevRouteOverride({
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
    });

    expect(override).toEqual({
      consumer: 'chat',
      source: 'PTAH_CODEX_RUNTIME_DEV',
    });
    expect(Object.isFrozen(override)).toBe(true);
  });

  it.each(['1', 'true', '0', ' 1', '1 ', '', undefined])(
    'rejects packaged hosts with switch value %p',
    (value) => {
      expect(
        readCodexDevRouteOverride({
          isPackaged: true,
          env: { PTAH_CODEX_RUNTIME_DEV: value },
        }),
      ).toBeNull();
    },
  );

  it.each(['true', '0', ' 1', '1 ', '', undefined])(
    'rejects unpackaged hosts with switch value %p',
    (value) => {
      expect(
        readCodexDevRouteOverride({
          isPackaged: false,
          env: { PTAH_CODEX_RUNTIME_DEV: value },
        }),
      ).toBeNull();
    },
  );
});
