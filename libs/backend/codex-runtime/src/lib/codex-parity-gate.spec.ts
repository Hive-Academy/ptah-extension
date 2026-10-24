import {
  CODEX_PARITY_EVIDENCE,
  CodexParityGate,
  type CodexParityConsumer,
} from './codex-parity-gate';

describe('CodexParityGate', () => {
  const gate = new CodexParityGate();
  const consumers: CodexParityConsumer[] = ['chat', 'gateway', 'lane'];
  const platforms = [
    { platform: 'win32', arch: 'x64' },
    { platform: 'win32', arch: 'arm64' },
    { platform: 'linux', arch: 'x64' },
    { platform: 'darwin', arch: 'arm64' },
    { platform: 'unknown', arch: 'unknown' },
  ];

  it.each(consumers)('keeps %s disabled on every platform', (consumer) => {
    for (const platform of platforms) {
      expect(gate.isEnabled(consumer, platform)).toBe(false);
      const decision = gate.evaluate(consumer, platform);
      expect(decision).toMatchObject({
        consumer,
        platform,
        enabled: false,
        reason: 'production-routing-disabled',
      });
      expect(
        new Set(decision.unproved.map((item) => item.observation)),
      ).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    }
  });

  it('keeps partial successes separate from required parity proof', () => {
    const decision = gate.evaluate('chat', platforms[0]);
    expect(decision.unproved.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'always-allow-scope',
        'yolo-full-access',
        'profile-inputs',
        'configuration-auth-usage-isolation',
        'history-rewind',
        'subagents',
        'remote-mcp',
        'packaged-binaries',
        'permission-matrix',
      ]),
    );
    expect(
      CODEX_PARITY_EVIDENCE.filter((item) => item.status === 'proved').map(
        (item) => item.id,
      ),
    ).toEqual(
      expect.arrayContaining([
        'command-accept',
        'command-deny',
        'file-accept',
        'mcp-approval',
        'plan-read-only',
        'auto-edit-boundary',
        'yolo-interrupt',
        'edit-decline-and-steer',
        'compaction',
      ]),
    );
    expect(decision.unproved.every((item) => item.status !== 'proved')).toBe(
      true,
    );
    expect(
      CODEX_PARITY_EVIDENCE.every((item) => item.evidence.length > 0),
    ).toBe(true);
  });

  it('counts unsupported platforms as blockers and never treats a dev pin as packaged proof', () => {
    const supported = gate.evaluate('lane', platforms[0]);
    expect(
      supported.unproved.some((item) => item.id === 'platform-manifest'),
    ).toBe(false);
    expect(
      supported.unproved.some((item) => item.id === 'packaged-binaries'),
    ).toBe(true);
    const unsupported = gate.evaluate('lane', platforms[1]);
    expect(unsupported.unproved).toContainEqual(
      expect.objectContaining({
        id: 'platform-manifest',
        status: 'unsupported',
        observation: 7,
      }),
    );
    expect(unsupported.enabled).toBe(false);
  });

  it('protects evidence and decisions from mutation between consumers', () => {
    const platform = { platform: 'win32', arch: 'x64' };
    const decision = gate.evaluate('gateway', platform);
    platform.arch = 'arm64';
    expect(decision.platform.arch).toBe('x64');
    expect(Object.isFrozen(CODEX_PARITY_EVIDENCE)).toBe(true);
    expect(CODEX_PARITY_EVIDENCE.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.unproved)).toBe(true);
    expect(Object.isFrozen(decision.platform)).toBe(true);
    expect(gate.evaluate('gateway', platforms[0])).toEqual(decision);
  });
});
