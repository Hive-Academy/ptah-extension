import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { listLocalDriverLocks, requestRelease } from './local-lock-client';

const supported = process.platform === 'linux' || process.platform === 'win32';

function startHolder(id: string): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const code = `
      const { KernelSessionDriverLock } = require(${JSON.stringify(require.resolve('./kernel-session-driver-lock'))});
      let live = true;
      const lock = new KernelSessionDriverLock(() => live);
      process.stdin.on('data', () => { live = false; process.stdout.write('ORPHAN\\n'); });
      lock.acquire(${JSON.stringify(id)}, {kind:'worker',hostname:'child',pid:process.pid,label:'child holder',acquiredAt:new Date().toISOString(),responding:true})
        .then(result => { if (!result.ok) process.exit(2); process.stdout.write('READY\\n'); });
    `;
    const child = spawn(process.execPath, ['-r', 'ts-node/register', '-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('holder timeout')); }, 5000);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('READY\n')) { clearTimeout(timer); resolve(child); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`child exited ${code}`)); });
  });
}

(supported ? describe : describe.skip)('control endpoint across processes', () => {
  it('lists a holder, refuses its live record, then releases its orphaned lock', async () => {
    const id = `control-cross-${process.pid}-${Date.now()}`;
    const child = await startHolder(id);
    try {
      const listings = await listLocalDriverLocks();
      expect(listings.some((listing) => listing.ok && listing.pid === child.pid && listing.locks.some((lock) => lock.sessionId === id && lock.hasLiveRecord))).toBe(true);
      expect(await requestRelease(id)).toBe('in-use');
      await new Promise<void>((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (data: Buffer) => { output += data.toString(); if (output.includes('ORPHAN\n')) resolve(); });
        child.once('exit', () => reject(new Error('holder exited')));
        child.stdin.write('orphan\n');
      });
      expect(await requestRelease(id)).toBe('released');
      expect(await requestRelease(id)).toBe('not-held');
    } finally { child.kill(); }
  }, 15000);
});
