import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface DriverLockHolderProcess {
  result: 'ACQUIRED' | 'REFUSED';
  stop(): Promise<void>;
}

/** Runs a real kernel lock contender in a separate process for integration tests. */
export function spawnDriverLockHolder(
  sessionId: string,
): Promise<DriverLockHolderProcess> {
  return new Promise((resolve, reject) => {
    const modulePath =
      require.resolve('../session-driver-lock/kernel-session-driver-lock');
    const code = `
      const { KernelSessionDriverLock } = require(${JSON.stringify(modulePath)});
      const lock = new KernelSessionDriverLock();
      lock.acquire(${JSON.stringify(sessionId)}, {kind:'worker',hostname:'child',pid:process.pid,label:'child',acquiredAt:new Date().toISOString(),responding:true})
        .then(async result => {
          process.stdout.write(result.ok ? 'ACQUIRED' : 'REFUSED');
          await lock.dispose();
        }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
    `;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-driver-holder-'));
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register', '-e', code],
      { env: { ...process.env, HOME: home, TS_NODE_TRANSPILE_ONLY: '1' } },
    );
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Driver lock holder timed out'));
    }, 30000);
    child.stdout.on('data', (data: Buffer) => (output += data.toString()));
    child.stderr.on('data', (data: Buffer) => (errorOutput += data.toString()));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      if (code !== 0)
        return reject(
          new Error(`Driver lock holder exited ${code}: ${errorOutput}`),
        );
      if (output !== 'ACQUIRED' && output !== 'REFUSED')
        return reject(new Error(`Unexpected driver lock result: ${output}`));
      resolve({ result: output, stop: async () => undefined });
    });
  });
}
