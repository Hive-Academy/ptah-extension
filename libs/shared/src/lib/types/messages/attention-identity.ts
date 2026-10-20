export type AttentionRequestKind = 'permission' | 'question' | 'lane-permission';

/** A path-free identity shared by host and renderer. */
export function attentionRequestKey(kind: AttentionRequestKind, requestId: string): string {
  if (/^[A-Za-z0-9._-]{1,200}$/.test(requestId)) return `${kind}:${requestId}`;
  const bytes = new TextEncoder().encode(requestId);
  let encoded = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63];
    if (i + 1 < bytes.length) encoded += alphabet[(value >>> 6) & 63];
    if (i + 2 < bytes.length) encoded += alphabet[value & 63];
  }
  return `${kind}:x-${encoded.slice(0, 191)}${hash53(requestId).toString(36).padStart(8, '0').slice(-8)}`;
}

/** FNV-1a folded to 53 bits so it remains an exact JavaScript integer. */
function hash53(value: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return Number(hash & ((1n << 53n) - 1n));
}

export function workspaceIdFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const canonical = /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
  return `ws-${hash53(canonical).toString(36)}`;
}
