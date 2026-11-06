import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSshStdioTransport } from './ssh-stdio-transport';

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
}

it('spawns SSH forwarding with argv and kills it on destroy', () => {
  const child = fakeChild();
  const spawn = jest.fn(() => child);
  const stream = createSshStdioTransport('remote', 41873, spawn as never);
  expect(spawn).toHaveBeenCalledWith(
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
      '127.0.0.1:41873',
      '--',
      'remote',
    ],
    { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  stream.destroy();
  expect(child.kill).toHaveBeenCalled();
});

it('relays stdout to the Duplex reader and Duplex writes to stdin', async () => {
  const child = fakeChild();
  const stream = createSshStdioTransport(
    'remote',
    41873,
    (() => child) as never,
  );
  const received: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => received.push(chunk));
  const input: Buffer[] = [];
  child.stdin.on('data', (chunk: Buffer) => input.push(chunk));
  stream.write(Buffer.from('request'));
  child.stdout.write(Buffer.from('response'));
  await new Promise((resolve) => setImmediate(resolve));
  expect(Buffer.concat(input).toString()).toBe('request');
  expect(Buffer.concat(received).toString()).toBe('response');
  stream.destroy();
});

it('includes captured stderr on nonzero exit', async () => {
  const child = fakeChild();
  const stream = createSshStdioTransport(
    'remote',
    41873,
    (() => child) as never,
  );
  const error = new Promise<Error>((resolve) => stream.once('error', resolve));
  child.stderr.write('forward refused');
  child.emit('close', 255);
  await expect(error).resolves.toThrow('forward refused');
});

it('ends the readable side on exit zero', async () => {
  const child = fakeChild();
  const stream = createSshStdioTransport(
    'remote',
    41873,
    (() => child) as never,
  );
  stream.resume();
  const ended = new Promise<void>((resolve) => stream.once('end', resolve));
  child.emit('close', 0);
  await ended;
});

it('handles EPIPE after child close with one transport error', async () => {
  const child = fakeChild();
  const stream = createSshStdioTransport(
    'remote',
    41873,
    (() => child) as never,
  );
  const errors: Error[] = [];
  stream.on('error', (error: Error) => errors.push(error));
  child.emit('close', 0);
  expect(() => stream.write(Buffer.from('late write'))).not.toThrow();
  child.stdin.emit('error', new Error('EPIPE'));
  child.stdin.emit('error', new Error('EPIPE again'));
  await new Promise((resolve) => setImmediate(resolve));
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain('SSH stdin failed');
});
