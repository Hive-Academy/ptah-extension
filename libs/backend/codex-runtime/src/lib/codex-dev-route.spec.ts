import { codexDevRouteCovers, readCodexDevRouteOverride } from './codex-dev-route';

describe('readCodexDevRouteOverride', () => {
  it('covers chat and gateway with a frozen override in an unpackaged host', () => {
    const override = readCodexDevRouteOverride({
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
    });

    expect(override).toEqual({
      consumers: ['chat', 'gateway'],
      source: 'PTAH_CODEX_RUNTIME_DEV',
    });
    expect(Object.isFrozen(override)).toBe(true);
    expect(Object.isFrozen(override?.consumers)).toBe(true);
    expect(codexDevRouteCovers(override, 'chat')).toBe(true);
    expect(codexDevRouteCovers(override, 'gateway')).toBe(true);
    expect(codexDevRouteCovers(override, 'lane')).toBe(false);
    expect(codexDevRouteCovers(null, 'gateway')).toBe(false);
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

  it.each([{}, { isPackaged: undefined }])(
    'rejects a host with missing or undefined packaging state: %p',
    (host) => {
      expect(
        readCodexDevRouteOverride({
          ...host,
          env: { PTAH_CODEX_RUNTIME_DEV: '1' },
        } as never),
      ).toBeNull();
    },
  );
});
