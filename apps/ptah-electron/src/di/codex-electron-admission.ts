import {
  CodexParityGate,
  codexDevRouteCovers,
  type CodexDevRouteOverride,
  type CodexParityPlatform,
} from '@ptah-extension/codex-runtime';

/** Electron admission from codex-parity-gate.ts:201-212 and D29/D30. */
export function isElectronCodexConsumerAdmitted(
  input: { readonly isPackaged: boolean; readonly platform: CodexParityPlatform },
  consumer: 'chat' | 'lane',
  devRoute: CodexDevRouteOverride | null = null,
): boolean {
  const gateEnabled = new CodexParityGate().isEnabled(consumer, input.platform);
  const packagedWindows = input.isPackaged && input.platform.platform === 'win32' &&
    input.platform.arch === 'x64';
  if (consumer === 'chat') {
    return gateEnabled || codexDevRouteCovers(devRoute, 'chat') || packagedWindows;
  }
  return !input.isPackaged || gateEnabled || packagedWindows;
}
