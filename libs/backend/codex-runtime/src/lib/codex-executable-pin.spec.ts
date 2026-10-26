import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCodexExecutablePin } from './codex-executable-pin';

describe('findCodexExecutablePin', () => {
  it('returns the reviewed win32/x64 manifest values without diagnostic fields', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(
        join(__dirname, 'protocol/codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    );
    const pin = findCodexExecutablePin('win32', 'x64');

    expect(pin).toBeDefined();
    expect(manifest).toEqual(expect.objectContaining(pin));
    expect(Object.keys(pin ?? {}).sort()).toEqual([
      'arch',
      'binarySha256',
      'pinnedVersion',
      'platform',
      'schemaSha256',
      'version',
    ]);
    expect(Object.isFrozen(pin)).toBe(true);
  });

  it.each([
    ['unknown', 'x64'],
    ['win32', 'unknown'],
    ['darwin', 'arm64'],
  ])('returns undefined for unreviewed %s/%s', (platform, arch) => {
    expect(findCodexExecutablePin(platform, arch)).toBeUndefined();
  });
});
