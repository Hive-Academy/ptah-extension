import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Duplex } from 'node:stream';
import { validateSshAlias } from './ssh-alias';

export function createSshStdioTransport(
  alias: string,
  port = 41873,
  spawnChild: typeof spawn = spawn,
): Duplex {
  validateSshAlias(alias);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid worker port');
  const child: ChildProcessWithoutNullStreams = spawnChild(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'ExitOnForwardFailure=yes',
      '-W',
      `127.0.0.1:${port}`,
      '--',
      alias,
    ],
    { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  const transport = new Duplex({
    read() {
      child.stdout.resume();
    },
    write(chunk: Buffer, _encoding, callback) {
      child.stdin.write(chunk, callback);
    },
    final(callback) {
      child.stdin.end(callback);
    },
    destroy(error, callback) {
      child.kill();
      callback(error);
    },
  });
  child.stdout.on('data', (chunk: Buffer) => {
    if (!transport.push(chunk)) child.stdout.pause();
  });
  child.stdout.on('end', () => transport.push(null));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  const streamFailed = (part: string) => (error: Error) => {
    if (!transport.destroyed)
      transport.destroy(
        new Error(`SSH ${part} failed for ${alias}: ${error.message}`),
      );
  };
  child.stdin.on('error', streamFailed('stdin'));
  child.stdout.on('error', streamFailed('stdout'));
  child.stderr.on('error', streamFailed('stderr'));
  child.once('error', () =>
    transport.destroy(new Error(`SSH transport failed for ${alias}.`)),
  );
  child.once('close', (code) => {
    if (transport.destroyed) return;
    if (code === 0) transport.push(null);
    else
      transport.destroy(
        new Error(
          `SSH transport closed for ${alias}: ${stderr.trim() || `exit ${code}`}`,
        ),
      );
  });
  return transport;
}
