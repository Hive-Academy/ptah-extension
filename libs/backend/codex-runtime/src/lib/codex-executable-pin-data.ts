import type { CodexExecutableManifestRow } from './codex-runtime-ports';

/** Reviewed win32/x64 identity; all other platforms have no pin and fail closed.
 * Keep in sync with the protocol manifest via the pin spec. */
export const CODEX_EXECUTABLE_PIN_DATA: CodexExecutableManifestRow = Object.freeze({
  platform: 'win32',
  arch: 'x64',
  pinnedVersion: '0.165.0',
  version: 'codex-cli 0.165.0',
  binarySha256:
    'd4b2e6a054ea1dfe53217f9d8942c5f8a9f4b76171a1e0bb76ced5759915300a',
  schemaSha256:
    '127cc06ba9656187dbb3e3acceda86acfa22ebf056b2abdaedbb1d1fa6ab9618',
});
