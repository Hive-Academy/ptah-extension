import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  verifyCodexBinary,
  type CodexBinaryIdentity,
} from './codex-protocol-manifest';

const manifest = z
  .object({
    pinnedVersion: z.string(),
    platform: z.string(),
    arch: z.string(),
    binarySha256: z.string(),
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(__dirname, 'protocol/codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    ),
  );
const binary: CodexBinaryIdentity = {
  executablePath: '/bundled/codex',
  versionOutput: 'codex-cli 0.165.0\r\n',
  sha256: manifest.binarySha256,
  platform: manifest.platform,
  arch: manifest.arch,
};

describe('verifyCodexBinary', () => {
  it('accepts the pinned binary at a different installation path', () => {
    expect(manifest.pinnedVersion).toBe('0.165.0');
    expect(verifyCodexBinary(binary, manifest)).toEqual({ status: 'ok' });
  });
  it('rejects global 0.163.0 despite matching digest and path', () => {
    expect(
      verifyCodexBinary(
        {
          ...binary,
          executablePath: '/another/codex',
          versionOutput: 'codex-cli 0.163.0',
        },
        manifest,
      ),
    ).toEqual({ status: 'mismatch', reason: 'versionMismatch' });
  });
  it.each(['0.165.0', 'codex-cli 0.165.00', 'codex-cli 0.165.0\nextra', ''])(
    'rejects malformed or different version output %j',
    (versionOutput) => {
      expect(verifyCodexBinary({ ...binary, versionOutput }, manifest)).toEqual(
        { status: 'mismatch', reason: 'versionMismatch' },
      );
    },
  );
  it.each(['0'.repeat(64), '', 'not-a-digest'])(
    'rejects a wrong or malformed hash %j',
    (sha256) => {
      expect(verifyCodexBinary({ ...binary, sha256 }, manifest)).toEqual({
        status: 'mismatch',
        reason: 'sha256Mismatch',
      });
    },
  );
  it('compares digest hex without case sensitivity', () => {
    expect(
      verifyCodexBinary(
        { ...binary, sha256: binary.sha256.toUpperCase() },
        manifest,
      ),
    ).toEqual({ status: 'ok' });
  });
  it.each([{ platform: 'linux' }, { arch: 'arm64' }])(
    'rejects absent platform/architecture rows %j',
    (change) => {
      expect(verifyCodexBinary({ ...binary, ...change }, manifest)).toEqual({
        status: 'mismatch',
        reason: 'unsupportedPlatform',
      });
    },
  );
  it('does not mutate or regenerate the manifest on mismatch', () => {
    const snapshot = JSON.stringify(manifest);
    verifyCodexBinary(
      { ...binary, versionOutput: 'codex-cli 0.163.0' },
      Object.freeze(manifest),
    );
    expect(JSON.stringify(manifest)).toBe(snapshot);
  });
});
