import * as os from 'node:os';

/** OS-user identity, with a normalized username-derived name on Windows. */
function userKey(): string {
  const info = os.userInfo();
  if (process.platform !== 'win32') return String(info.uid);
  const sid = info.username.normalize('NFKC').toLowerCase();
  let hash = 2166136261;
  for (const char of sid) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function sessionDriverEndpoint(sessionId: string): string {
  // Session IDs are UUIDs. Reject an invalid ID instead of creating a name
  // that could be truncated or interpreted differently by an OS.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error('Invalid session driver lock ID');
  }
  const name = `ptah-driver-${userKey()}-${sessionId}`;
  if (process.platform === 'linux') return `\0${name}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  throw new Error('Session driver kernel lock unavailable on this platform');
}
