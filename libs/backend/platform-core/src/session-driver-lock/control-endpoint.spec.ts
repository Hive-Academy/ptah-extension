import * as fs from 'node:fs';
import * as net from 'node:net';
import { KernelSessionDriverLock } from './kernel-session-driver-lock';
import {
  controlEndpointName,
  controlKeyPath,
  readControlKey,
} from './control-keys';
import { listLocalDriverLocks, requestRelease } from './local-lock-client';

const supported = process.platform === 'linux' || process.platform === 'win32';
const owner = {
  kind: 'desktop' as const,
  hostname: 'local',
  pid: process.pid,
  label: 'local holder',
  acquiredAt: new Date().toISOString(),
  responding: true,
};

function send(value: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(controlEndpointName(process.pid));
    let response = '';
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.on('connect', () => socket.write(`${JSON.stringify(value)}\n`));
    socket.on('data', (data: Buffer) => {
      response += data.toString();
      if (response.includes('\n')) {
        socket.destroy();
        resolve(JSON.parse(response.split('\n')[0]));
      }
    });
    socket.on('error', reject);
  });
}

(supported ? describe : describe.skip)(
  'session driver control endpoint',
  () => {
    it('decides an operator release in the gate, not on an earlier liveness read', async () => {
      const lock = new KernelSessionDriverLock();
      const id = `control-race-${process.pid}-${Date.now()}`;
      // A liveness read says idle; an owner arrives before the release step.
      lock.setLiveRecordCheck(() => false);
      const gate = jest.fn(async () => 'in-use' as const);
      lock.setReleaseGate(gate);
      try {
        expect((await lock.acquire(id, owner)).ok).toBe(true);
        expect(await requestRelease(id)).toBe('in-use');
        expect(gate).toHaveBeenCalledWith(id, expect.any(Function));
        expect(lock.held()).toHaveLength(1);
      } finally {
        await lock.dispose();
      }
    });

    it('protects the key, refuses a live record, and releases an orphan', async () => {
      const live = new Set<string>();
      const lock = new KernelSessionDriverLock();
      lock.setLiveRecordCheck((id) => live.has(id));
      const id = `control-${process.pid}-${Date.now()}`;
      live.add(id);
      try {
        expect((await lock.acquire(id, owner)).ok).toBe(true);
        const discovery = readControlKey(process.pid);
        expect(discovery).not.toBeNull();
        if (process.platform !== 'win32')
          expect(fs.statSync(controlKeyPath(process.pid)).mode & 0o777).toBe(
            0o600,
          );
        expect(await send({ cmd: 'list', key: 'wrong' })).toEqual({
          ok: false,
          code: 'BAD_KEY',
        });
        expect(await requestRelease(id)).toBe('in-use');
        expect(
          (await listLocalDriverLocks())
            .flatMap((item) => (item.ok ? item.locks : []))
            .some((item) => item.sessionId === id && item.hasLiveRecord),
        ).toBe(true);
        live.delete(id);
        expect(await requestRelease(id)).toBe('released');
        expect(lock.held()).toHaveLength(0);
      } finally {
        await lock.dispose();
      }
    });
  },
);
