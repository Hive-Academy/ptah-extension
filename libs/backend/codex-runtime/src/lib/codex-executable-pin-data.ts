import type { CodexExecutableManifestRow } from './codex-runtime-ports';

/** Reviewed portable identity; keep in sync with the protocol manifest via the pin spec. */
export const CODEX_EXECUTABLE_PIN_DATA: CodexExecutableManifestRow = Object.freeze({
  platform: 'win32',
  arch: 'x64',
  pinnedVersion: '0.155.1',
  version: 'codex-cli 0.155.1',
  binarySha256:
    'eba0f32c976667cb9298efafd98513e823eeda7b576a03ec658bb8be8d336316',
  schemaSha256:
    'd912e0edc7dace2843be975bee0ca39c3f9f37f11cad07101bd32eb622adf3db',
});
