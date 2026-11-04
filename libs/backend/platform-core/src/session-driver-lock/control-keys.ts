import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface ControlDiscovery {
  pid: number;
  kind: 'desktop' | 'worker' | 'cli';
  key: string;
}

export function controlKeyDirectory(): string {
  return `${os.homedir()}/.ptah/session-drivers`;
}
export function controlKeyPath(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid control pid');
  return `${controlKeyDirectory()}/${pid}.key`;
}

export function readControlKey(pid: number): ControlDiscovery | null {
  try {
    const file = controlKeyPath(pid);
    const stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
    )
      return null;
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const value = data as Partial<ControlDiscovery>;
    if (
      value.pid !== pid ||
      !['desktop', 'worker', 'cli'].includes(value.kind ?? '') ||
      typeof value.key !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.key)
    )
      return null;
    return value as ControlDiscovery;
  } catch {
    // degradation-audit: optional-capability — a missing, unreadable or
    // malformed discovery file means no discoverable holder (W10 stale discovery).
    return null;
  }
}

export function writeControlKey(
  kind: ControlDiscovery['kind'],
): ControlDiscovery {
  // Verify the endpoint name before writing a discovery file.
  controlEndpointName(process.pid);
  fs.mkdirSync(controlKeyDirectory(), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(controlKeyDirectory(), 0o700);
  const discovery = {
    pid: process.pid,
    kind,
    key: crypto.randomBytes(32).toString('base64url'),
  };
  const file = controlKeyPath(process.pid);
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  fs.writeFileSync(file, JSON.stringify(discovery), {
    flag: 'wx',
    mode: 0o600,
  });
  return discovery;
}

export function removeControlKey(key: string): void {
  const file = controlKeyPath(process.pid);
  if (readControlKey(process.pid)?.key === key) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function controlKeysEqual(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function controlEndpointName(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid control pid');
  const info = os.userInfo();
  let user = String(info.uid);
  if (process.platform === 'win32') {
    const sid = info.username.normalize('NFKC').toLowerCase();
    let hash = 2166136261;
    for (const char of sid)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    user = (hash >>> 0).toString(16);
  }
  const name = `ptah-ctl-${user}-${pid}`;
  if (process.platform === 'linux') return `\0${name}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  throw new Error('Session driver control unavailable on this platform');
}
