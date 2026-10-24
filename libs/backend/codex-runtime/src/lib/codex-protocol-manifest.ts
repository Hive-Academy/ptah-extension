import type { CodexExecutableManifestRow } from './codex-runtime-ports';

export interface CodexBinaryIdentity {
  readonly executablePath: string;
  readonly versionOutput: string;
  readonly sha256: string;
  readonly platform: string;
  readonly arch: string;
}
export type CodexBinaryVerification =
  | { readonly status: 'ok' }
  | {
      readonly status: 'mismatch';
      readonly reason:
        'unsupportedPlatform' | 'versionMismatch' | 'sha256Mismatch';
    };

/** Pure identity check. Paths are diagnostic only; never regenerate on a mismatch. */
export function verifyCodexBinary(
  binary: CodexBinaryIdentity,
  manifest: Pick<
    CodexExecutableManifestRow,
    'pinnedVersion' | 'platform' | 'arch' | 'binarySha256'
  >,
): CodexBinaryVerification {
  if (binary.platform !== manifest.platform || binary.arch !== manifest.arch) {
    return { status: 'mismatch', reason: 'unsupportedPlatform' };
  }
  if (binary.versionOutput.trim() !== `codex-cli ${manifest.pinnedVersion}`) {
    return { status: 'mismatch', reason: 'versionMismatch' };
  }
  if (
    !/^[a-f0-9]{64}$/i.test(binary.sha256) ||
    !/^[a-f0-9]{64}$/i.test(manifest.binarySha256) ||
    binary.sha256.toLowerCase() !== manifest.binarySha256.toLowerCase()
  ) {
    return { status: 'mismatch', reason: 'sha256Mismatch' };
  }
  return { status: 'ok' };
}
