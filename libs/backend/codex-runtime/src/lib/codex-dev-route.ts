export interface CodexDevRouteOverride {
  readonly consumer: 'chat';
  readonly source: 'PTAH_CODEX_RUNTIME_DEV';
}

/** Hosts supply packaging and environment inputs; production always stays gated. */
export function readCodexDevRouteOverride(input: {
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}): CodexDevRouteOverride | null {
  if (
    input.isPackaged !== false ||
    input.env['PTAH_CODEX_RUNTIME_DEV'] !== '1'
  ) {
    return null;
  }
  return Object.freeze({
    consumer: 'chat',
    source: 'PTAH_CODEX_RUNTIME_DEV',
  });
}
