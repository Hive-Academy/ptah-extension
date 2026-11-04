import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { IProcessSpawner, ProcessSpawnRequest, SpawnedProcessHandle } from '@ptah-extension/platform-core';

const pathSchema = z.string().min(1).refine(isAbsolute, 'absolute path required');
const configSchema = z.object({
  bwrap: pathSchema,
  snapshot: pathSchema,
  out: pathSchema,
  runtime: pathSchema,
  brokerSocket: pathSchema,
  brokerProxy: pathSchema,
  brokerPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  reachableCommitsHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type ReplayIsolationConfig = z.infer<typeof configSchema>;

export class ReplayIsolationError extends Error {
  readonly code = 'REPLAY_ISOLATION_UNAVAILABLE';
  constructor(reason: string) { super(reason); this.name = 'ReplayIsolationError'; }
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function canonical(path: string, directory: boolean): string {
  const actual = realpathSync(path);
  if (actual !== path || (directory ? !statSync(path).isDirectory() : !statSync(path).isFile()))
    throw new ReplayIsolationError('Noncanonical replay path or incorrect file type');
  return actual;
}

/** Build a single sealed process request. The proxy must bridge namespace loopback to the bound Unix socket. */
export function makeUbuntuBwrapRequest(input: unknown, request: ProcessSpawnRequest, platform = process.platform): ProcessSpawnRequest {
  if (platform !== 'linux') throw new ReplayIsolationError('Ubuntu replay requires Linux');
  const config = configSchema.parse(input);
  const snapshot = canonical(config.snapshot, true);
  const out = canonical(config.out, true);
  const runtime = canonical(config.runtime, true);
  const bwrap = canonical(config.bwrap, false);
  const brokerSocket = canonical(config.brokerSocket, false);
  const brokerProxy = canonical(config.brokerProxy, false);
  if (inside(snapshot, out) || inside(out, snapshot) || inside(snapshot, brokerSocket) || inside(out, brokerSocket))
    throw new ReplayIsolationError('Replay roots overlap');
  const command = canonical(request.command, false);
  if (!inside(runtime, command) || !inside(runtime, brokerProxy))
    throw new ReplayIsolationError('Executable is outside sealed runtime');
  if (request.cwd && !inside(snapshot, resolve(request.cwd)))
    throw new ReplayIsolationError('Working directory is outside snapshot');
  if (request.args.length !== 1 || request.args[0] !== 'app-server')
    throw new ReplayIsolationError('Only Codex App Server is eligible');
  const args = [
    '--die-with-parent', '--new-session', '--unshare-all',
    '--clearenv', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/run', '--dir', '/work',
    '--ro-bind', snapshot, '/work/src', '--bind', out, '/work/out',
    '--ro-bind', runtime, '/runtime', '--ro-bind', brokerSocket, '/run/model-broker.sock',
    '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'PATH', '/runtime/bin', '--setenv', 'CODEX_HOME', '/tmp/codex',
    '--setenv', 'HTTP_PROXY', 'http://127.0.0.1:8765',
    '--setenv', 'HTTPS_PROXY', 'http://127.0.0.1:8765',
    '--setenv', 'NO_PROXY', '127.0.0.1,localhost',
    '--chdir', '/work/src', '--', '/runtime/bin/model-broker-proxy',
    '--socket', '/run/model-broker.sock', '--listen', '127.0.0.1:8765',
    '--', `/runtime/${relative(runtime, command).replaceAll('\\', '/')}`, 'app-server',
  ];
  if (brokerProxy !== resolve(runtime, 'bin/model-broker-proxy'))
    throw new ReplayIsolationError('Broker proxy must be runtime/bin/model-broker-proxy');
  return { command: bwrap, args, cwd: '/', env: {}, detached: request.detached };
}

export function replayPolicyHash(request: ProcessSpawnRequest): string {
  return createHash('sha256').update(JSON.stringify([request.command, request.args, request.env])).digest('hex');
}

export function ubuntuReplaySpawner(delegate: IProcessSpawner, config: ReplayIsolationConfig, platform = process.platform): IProcessSpawner {
  return { spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
    return delegate.spawnProcess(makeUbuntuBwrapRequest(config, request, platform));
  } };
}
