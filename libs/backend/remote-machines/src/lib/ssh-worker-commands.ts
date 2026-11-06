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
      if (!workspace || workspace.startsWith('-'))
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
    let timedOut = false;
    let outputTooLarge = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (outputTooLarge) return;
      stdout += chunk;
      if (stdout.length > 1_000_000) {
        outputTooLarge = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(
        new SshWorkerCommandError(
          'unreachable',
          `SSH failed for ${machineLabel}.`,
        ),
      );
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (outputTooLarge) {
        reject(
          new SshWorkerCommandError(
            'invalid-output',
            `Worker output too large from ${machineLabel}.`,
          ),
        );
        return;
      }
      if (code === 127 || /not found/i.test(stderr)) {
        reject(
          new SshWorkerCommandError(
            'version-mismatch',
            `This Ptah build on ${machineLabel} has no worker mode. Update the Ptah desktop app there.`,
          ),
        );
        return;
      }
      if (timedOut || code !== 0) {
        reject(
          new SshWorkerCommandError(
            'unreachable',
            timedOut
              ? `SSH timed out for ${machineLabel}.`
              : `SSH command failed for ${machineLabel}.`,
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
    });
  });
}
