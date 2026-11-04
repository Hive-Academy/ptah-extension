import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { KernelSessionDriverLock } from './kernel-session-driver-lock';
import type { DriverHolder } from '../interfaces/session-driver-lock.interface';

const supported = process.platform === 'linux' || process.platform === 'win32';
const owner: DriverHolder = {
  kind: 'desktop', hostname: 'parent', pid: process.pid,
  label: 'parent', acquiredAt: new Date().toISOString(), responding: true,
};

function startHolder(id: string): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const code = `
      const { KernelSessionDriverLock } = require(${JSON.stringify(require.resolve('./kernel-session-driver-lock'))});
      const lock = new KernelSessionDriverLock();
      lock.acquire(${JSON.stringify(id)}, {kind:'worker',hostname:'child',pid:process.pid,label:'child holder',acquiredAt:new Date().toISOString(),responding:true})
        .then(result => { if (!result.ok) process.exit(2); process.stdout.write('READY\\n'); });
    `;
    const child = spawn(process.execPath, ['-r', 'ts-node/register', '-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('child holder timeout')); }, 5000);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('READY\n')) { clearTimeout(timer); resolve(child); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`child exited ${code}`)); });
  });
}

(supported ? describe : describe.skip)('kernel session driver lock across processes (A8)', () => {
  it('refuses a live and paused holder, then acquires after its death', async () => {
    const id = `cross-${process.pid}-${Date.now()}`;
    const child = await startHolder(id);
    const lock = new KernelSessionDriverLock();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      const refused = await lock.acquire(id, owner);
      expect(refused.ok).toBe(false);
      if (!refused.ok && 'holder' in refused) expect(refused.holder.label).toBe('child holder');
      if (process.platform === 'linux') {
        child.kill('SIGSTOP');
        const paused = await lock.acquire(id, owner);
        expect(paused.ok).toBe(false);
        if (!paused.ok && 'holder' in paused) expect(paused.holder.responding).toBe(false);
      }
    } finally {
      if (process.platform === 'linux') child.kill('SIGCONT');
      child.kill();
    }
    await exited;
    const acquired = await lock.acquire(id, owner);
    expect(acquired.ok).toBe(true);
    if (acquired.ok) expect(await lock.release(id, acquired.nonce)).toBe('released');
    await lock.dispose();
  }, 15000);
});
