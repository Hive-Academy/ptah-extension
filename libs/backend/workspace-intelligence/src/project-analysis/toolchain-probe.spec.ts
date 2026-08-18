import { getStackProfile } from '@ptah-extension/shared';
import type { StackProfile } from '@ptah-extension/shared';

import {
  compareVersions,
  parseProbeVersion,
  probeStackToolchain,
} from './toolchain-probe';

/** Clone a profile with a different probe command, leaving the registry alone. */
function withProbe(base: StackProfile, probe: string): StackProfile {
  return { ...base, toolchain: { ...base.toolchain, probe } };
}

describe('parseProbeVersion', () => {
  it.each([
    ['8.0.404', '8.0.404'],
    ['v22.11.0\n', '22.11.0'],
    ['Python 3.12.1\n', '3.12.1'],
    ['9.0.100-preview.1.24101.2', '9.0.100'],
    ['8.0', '8.0'],
  ])('reads %j as %j', (output, expected) => {
    expect(parseProbeVersion(output)).toBe(expected);
  });

  it('returns undefined when there is no version to find', () => {
    expect(parseProbeVersion('command not found')).toBeUndefined();
    expect(parseProbeVersion('')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    // The reason this is not a string compare: '10' < '9' as text.
    expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
  });

  it('treats missing components as zero', () => {
    expect(compareVersions('8.0', '8.0.0')).toBe(0);
  });

  it('treats a prerelease as satisfying its own version', () => {
    expect(compareVersions('9.0.100-preview.1', '8.0.0')).toBeGreaterThan(0);
  });

  it('reports older, equal and newer', () => {
    expect(compareVersions('6.0.0', '8.0.0')).toBeLessThan(0);
    expect(compareVersions('8.0.0', '8.0.0')).toBe(0);
    expect(compareVersions('8.0.1', '8.0.0')).toBeGreaterThan(0);
  });

  it('does not crash on unparseable components', () => {
    expect(compareVersions('八.0.0', '8.0.0')).toBeLessThan(0);
  });
});

describe('probeStackToolchain', () => {
  const nodeTs = getStackProfile('node-ts');

  it('reports an installed toolchain that satisfies its minimum', async () => {
    // `node` is the one binary guaranteed present wherever Jest is running,
    // and the repo requires Node >= 20, which is node-ts's own minVersion.
    const result = await probeStackToolchain(nodeTs);

    expect(result.profileId).toBe('node-ts');
    expect(result.command).toBe('node --version');
    expect(result.installed).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+/);
    expect(result.satisfiesMin).toBe(true);
  });

  it('reports a missing binary without throwing', async () => {
    const result = await probeStackToolchain(
      withProbe(nodeTs, 'ptah-no-such-toolchain-binary --version'),
    );

    expect(result.installed).toBe(false);
    expect(result.satisfiesMin).toBe(false);
    expect(result.version).toBeUndefined();
    // The result is self-contained: a caller can render it with no further
    // lookup, which is the whole point of carrying the hint.
    expect(result.installHint).toBe(nodeTs.toolchain.installHint);
    expect(result.minVersion).toBe(nodeTs.toolchain.minVersion);
  });

  it('reports a non-zero exit as not installed', async () => {
    const result = await probeStackToolchain(
      withProbe(nodeTs, 'node --this-flag-does-not-exist'),
    );
    expect(result.installed).toBe(false);
  });

  it('fails the minimum when the version cannot be read', async () => {
    // Installed, runs, exits zero, prints nothing parseable. Scaffolding must
    // not proceed on an unknown SDK.
    const result = await probeStackToolchain(
      withProbe(nodeTs, 'node -e console.log("ready")'),
    );

    expect(result.installed).toBe(true);
    expect(result.version).toBeUndefined();
    expect(result.satisfiesMin).toBe(false);
  });

  it('fails the minimum for an installed but too-old toolchain', async () => {
    const result = await probeStackToolchain({
      ...nodeTs,
      toolchain: { ...nodeTs.toolchain, minVersion: '9999.0.0' },
    });

    expect(result.installed).toBe(true);
    expect(result.satisfiesMin).toBe(false);
  });

  it('reports an empty probe command as not installed', async () => {
    const result = await probeStackToolchain(withProbe(nodeTs, '   '));
    expect(result.installed).toBe(false);
  });

  it('gives up on a probe that hangs', async () => {
    const result = await probeStackToolchain(
      withProbe(nodeTs, 'node -e setInterval(()=>{},1000)'),
      { timeoutMs: 300 },
    );
    expect(result.installed).toBe(false);
  });

  it.each(['dotnet', 'python'] as const)(
    'never throws probing the real %s toolchain, installed or not',
    async (id) => {
      const result = await probeStackToolchain(getStackProfile(id));
      expect(result.profileId).toBe(id);
      expect(typeof result.installed).toBe('boolean');
      expect(typeof result.satisfiesMin).toBe('boolean');
    },
  );
});
