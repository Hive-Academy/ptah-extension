import { posix, win32 } from 'node:path';

/** Lexical identity only; composition resolves filesystem aliases before this boundary. */
export function normalizeCodexHomeKey(home: string, platform: string): string {
  const path = platform === 'win32' ? win32 : posix;
  if (
    !home.trim() ||
    home.includes('\0') ||
    !path.isAbsolute(home) ||
    (platform === 'win32' && /^[\\/](?![\\/])/.test(home))
  ) {
    throw new Error('Absolute Codex home required');
  }
  const normalized = path.normalize(home);
  const root = path.parse(normalized).root;
  const key =
    normalized.length > root.length
      ? normalized.replace(platform === 'win32' ? /[\\/]+$/ : /\/+$/, '')
      : normalized;
  return platform === 'win32' ? key.toLowerCase() : key;
}
