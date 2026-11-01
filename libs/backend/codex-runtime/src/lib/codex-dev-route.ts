export interface CodexDevRouteOverride {
  readonly consumers: readonly ('chat' | 'gateway')[];
  readonly source: 'PTAH_CODEX_RUNTIME_DEV';
}

export function codexDevRouteCovers(
  override: CodexDevRouteOverride | null | undefined,
  consumer: 'chat' | 'gateway' | 'lane',
): boolean {
  return consumer !== 'lane' && (override?.consumers.includes(consumer) ?? false);
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
    consumers: Object.freeze(['chat', 'gateway'] as const),
    source: 'PTAH_CODEX_RUNTIME_DEV',
  });
}
