import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  WORKER_METHOD_SCHEMAS,
  WORKER_REMOTE_COMMAND,
} from '@ptah-extension/worker-protocol';
import { validateSshAlias } from './ssh-alias';

type Spawn = typeof spawn;
export class SshWorkerCommandError extends Error {
  constructor(
    readonly code: 'version-mismatch' | 'unreachable' | 'invalid-output',
    message: string,
  ) {
    super(message);
  }
}

export interface PairOptions {
  workspaces?: string[];
  ttlSeconds?: number;
}

export async function runSshWorkerCommand(
  alias: string,
  command: 'status' | 'pair',
  options: PairOptions = {},
  spawnChild: Spawn = spawn,
  machineLabel = alias,
): Promise<unknown> {
  validateSshAlias(alias);
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '--',
    alias,
    WORKER_REMOTE_COMMAND,
    command,
    '--json',
  ];
  if (command === 'pair') {
    for (const workspace of options.workspaces ?? []) {
      if (
        !/^[A-Za-z0-9_./:@-]{1,256}$/.test(workspace) ||
        workspace.startsWith('-')
      )
        throw new Error('Invalid workspace option');
      args.push('--workspace', workspace);
    }
    if (options.ttlSeconds !== undefined) {
      if (
        !Number.isInteger(options.ttlSeconds) ||
        options.ttlSeconds < 60 ||
        options.ttlSeconds > 900
      )
        throw new Error('TTL must be between 60 and 900 seconds');
      args.push('--ttl', String(options.ttlSeconds));
    }
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawnChild('ssh', args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // degradation-audit: reported - the caller receives the spawn failure as a
      // typed 'unreachable' rejection; `return` only stops this executor.
      reject(
        new SshWorkerCommandError(
          'unreachable',
          `Could not start SSH for ${machineLabel}.`,
        ),
      );
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
      child.removeListener('close', onClose);
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const fail = (error: SshWorkerCommandError, kill = false) => {
      if (settled) return;
      settled = true;
      if (kill) child.kill();
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(
        new SshWorkerCommandError(
          'unreachable',
          `SSH timed out for ${machineLabel}.`,
        ),
        true,
      );
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const onStdout = (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      if (stdout.length > 1_000_000) {
        fail(
          new SshWorkerCommandError(
            'invalid-output',
            `Worker output too large from ${machineLabel}.`,
          ),
          true,
        );
      }
    };
    const onStderr = (chunk: string) => {
      if (settled) return;
      stderr = (stderr + chunk).slice(-4096);
    };
    const onError = () => {
      fail(
        new SshWorkerCommandError(
          'unreachable',
          `SSH failed for ${machineLabel}.`,
        ),
      );
    };
    const onClose = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 127 || /not found/i.test(stderr)) {
        reject(
          new SshWorkerCommandError(
            'version-mismatch',
            `This Ptah build on ${machineLabel} has no worker mode. Update the Ptah desktop app there.`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new SshWorkerCommandError(
            'unreachable',
            `SSH command failed for ${machineLabel}.`,
          ),
        );
        return;
      }
      try {
        const schema =
          command === 'status'
            ? WORKER_METHOD_SCHEMAS['admin.status'].result
            : WORKER_METHOD_SCHEMAS['admin.pairing.open'].result;
        resolve(schema.parse(JSON.parse(stdout)));
      } catch {
        reject(
          new SshWorkerCommandError(
            'invalid-output',
            `Invalid worker ${command} output from ${machineLabel}. Update Ptah on both machines.`,
          ),
        );
      }
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    // Keep an inert error listener after settlement: a late child error must not throw.
    child.on('error', onError);
    child.once('close', onClose);
  });
}
