import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { listLocalDriverLocks, requestRelease } from './local-lock-client';

const supported = process.platform === 'linux' || process.platform === 'win32';

function startHolder(
  id: string,
): Promise<{ child: ChildProcessWithoutNullStreams; home: string }> {
  return new Promise((resolve, reject) => {
    const code = `
      const { KernelSessionDriverLock } = require(${JSON.stringify(require.resolve('./kernel-session-driver-lock'))});
      let live = true;
      const lock = new KernelSessionDriverLock(() => live);
      process.stdin.on('data', () => { live = false; process.stdout.write('ORPHAN\\n'); });
      lock.acquire(${JSON.stringify(id)}, {kind:'worker',hostname:'child',pid:process.pid,label:'child holder',acquiredAt:new Date().toISOString(),responding:true})
        .then(result => { if (!result.ok) process.exit(2); process.stdout.write('READY\\n'); });
    `;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-driver-child-'));
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register', '-e', code],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          TS_NODE_TRANSPILE_ONLY: '1',
        },
      },
    );
    child.once('exit', () => fs.rmSync(home, { recursive: true, force: true }));
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('holder timeout'));
    }, 30000);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('READY\n')) {
        clearTimeout(timer);
        resolve({ child, home });
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited ${code}`));
    });
  });
}

(supported ? describe : describe.skip)(
  'control endpoint across processes',
  () => {
    it('lists a holder, refuses its live record, then releases its orphaned lock', async () => {
      const id = `control-cross-${process.pid}-${Date.now()}`;
      const { child, home } = await startHolder(id);
      // Jest sandboxes process.env, so setting HOME here never reaches the
      // native os.homedir(). Point the client at the child's home directly.
      try {
        jest
          .spyOn(jest.requireActual<typeof os>('node:os'), 'homedir')
          .mockReturnValue(home);
        const listings = await listLocalDriverLocks();
        expect(
          listings.some(
            (listing) =>
              listing.ok &&
              listing.pid === child.pid &&
              listing.locks.some(
                (lock) => lock.sessionId === id && lock.hasLiveRecord,
              ),
          ),
        ).toBe(true);
        expect(await requestRelease(id)).toBe('in-use');
        await new Promise<void>((resolve, reject) => {
          let output = '';
          child.stdout.on('data', (data: Buffer) => {
            output += data.toString();
            if (output.includes('ORPHAN\n')) resolve();
          });
          child.once('exit', () => reject(new Error('holder exited')));
          child.stdin.write('orphan\n');
        });
        expect(await requestRelease(id)).toBe('released');
        expect(await requestRelease(id)).toBe('not-held');
      } finally {
        jest.restoreAllMocks();
        child.kill('SIGKILL');
      }
    }, 45000);
  },
);
