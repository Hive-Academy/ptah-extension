import * as fs from 'node:fs';
import * as net from 'node:net';
import type { DriverHolder } from '../interfaces/session-driver-lock.interface';
import { sessionDriverEndpoint } from './endpoint-names';
import {
  controlEndpointName,
  controlKeyDirectory,
  controlKeyPath,
  readControlKey,
} from './control-keys';
import type { ControlListing, ControlReleaseResult } from './control-endpoint';

interface WireFailure {
  ok: false;
  code: string;
}
interface WireRelease {
  ok: true;
  result: ControlReleaseResult;
}
export type LocalLockListing =
  ControlListing | { ok: false; pid: number; responding: false };

function request(
  endpoint: string,
  value?: unknown,
): Promise<{ value: unknown | null; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    let data = '';
    let socket: net.Socket;
    const finish = (result: {
      value: unknown | null;
      error?: string;
    }): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    try {
      socket = net.createConnection(endpoint);
    } catch (error) {
      // degradation-audit: reported — the error code goes back to the caller
      // in the result.
      resolve({ value: null, error: (error as NodeJS.ErrnoException).code });
      return;
    }
    socket.setTimeout(500, () => finish({ value: null, error: 'TIMEOUT' }));
    socket.on('connect', () => {
      if (value) socket.write(`${JSON.stringify(value)}\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 4096)
        return finish({ value: null, error: 'TOO_LARGE' });
      const newline = data.indexOf('\n');
      if (newline < 0) return;
      try {
        finish({ value: JSON.parse(data.slice(0, newline)) });
      } catch {
        finish({ value: null, error: 'BAD_RESPONSE' });
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) =>
      finish({ value: null, error: error.code ?? 'SOCKET_ERROR' }),
    );
    socket.on('end', () => finish({ value: null, error: 'CLOSED' }));
  });
}

function isListing(value: unknown, pid: number): value is ControlListing {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ControlListing>;
  return item.ok === true && item.pid === pid && Array.isArray(item.locks);
}

export async function listLocalDriverLocks(): Promise<LocalLockListing[]> {
  let names: string[];
  try {
    names = fs.readdirSync(controlKeyDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const listings: LocalLockListing[] = [];
  for (const name of names) {
    if (!/^[1-9][0-9]*\.key$/.test(name)) continue;
    const pid = Number(name.slice(0, -4));
    const discovery = readControlKey(pid);
    if (!discovery) continue;
    const result = await request(controlEndpointName(pid), {
      cmd: 'list',
      key: discovery.key,
    });
    if (isListing(result.value, pid)) listings.push(result.value);
    else if (result.error === 'TIMEOUT')
      listings.push({ ok: false, pid, responding: false });
    else if (result.error === 'ECONNREFUSED' || result.error === 'ENOENT') {
      // Only remove the file if it still carries the key we tried.
      if (readControlKey(pid)?.key === discovery.key) {
        try {
          fs.unlinkSync(controlKeyPath(pid));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
  }
  return listings;
}

export type RequestReleaseResult = ControlReleaseResult | 'unavailable';
export async function requestRelease(
  sessionId: string,
): Promise<RequestReleaseResult> {
  const holderReply = await request(sessionDriverEndpoint(sessionId));
  const holder = holderReply.value as Partial<DriverHolder> | null;
  if (!holder || !Number.isSafeInteger(holder.pid) || (holder.pid ?? 0) <= 0) {
    if (holderReply.error === 'ECONNREFUSED' || holderReply.error === 'ENOENT')
      return 'not-held';
    return 'unavailable';
  }
  const discovery = readControlKey(holder.pid!);
  if (!discovery) return 'unavailable';
  const reply = await request(controlEndpointName(holder.pid!), {
    cmd: 'release',
    sessionId,
    key: discovery.key,
  });
  const result = reply.value as WireRelease | WireFailure | null;
  if (
    result?.ok === true &&
    ['released', 'stranded', 'in-use', 'not-held'].includes(result.result)
  )
    return result.result;
  return 'unavailable';
}
