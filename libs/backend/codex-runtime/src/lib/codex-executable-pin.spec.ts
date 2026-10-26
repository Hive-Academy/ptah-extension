import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCodexExecutablePin } from './codex-executable-pin';
import { CODEX_EXECUTABLE_PIN_DATA } from './codex-executable-pin-data';

describe('findCodexExecutablePin', () => {
  it('keeps the reviewed pin data equal to the portable manifest projection', () => {
    const manifest: Record<string, unknown> = JSON.parse(
      readFileSync(
        join(__dirname, 'protocol/codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    );

    expect(CODEX_EXECUTABLE_PIN_DATA).toEqual({
      platform: manifest['platform'],
      arch: manifest['arch'],
      pinnedVersion: manifest['pinnedVersion'],
      version: manifest['version'],
      binarySha256: manifest['binarySha256'],
      schemaSha256: manifest['schemaSha256'],
    });
  });

  it('reuses the validated pin across lookups', () => {
    const pin = findCodexExecutablePin('win32', 'x64');

    expect(pin).toBeDefined();
    expect(findCodexExecutablePin('win32', 'x64')).toBe(pin);
  });

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
