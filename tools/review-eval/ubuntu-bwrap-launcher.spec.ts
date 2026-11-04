import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IProcessSpawner, ProcessSpawnRequest } from '@ptah-extension/platform-core';
import { makeUbuntuBwrapRequest, ReplayIsolationError, ubuntuReplaySpawner, type ReplayIsolationConfig } from './ubuntu-bwrap-launcher';

describe('Ubuntu bubblewrap request', () => {
  let root: string;
  let config: ReplayIsolationConfig;
  let request: ProcessSpawnRequest;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'replay-isolation-')));
    for (const dir of ['src', 'out', 'runtime', 'runtime/bin']) mkdirSync(join(root, dir), { recursive: true });
    for (const file of ['bwrap', 'broker.sock', 'runtime/bin/codex', 'runtime/bin/model-broker-proxy']) writeFileSync(join(root, file), 'fixture');
    config = { bwrap: join(root, 'bwrap'), snapshot: join(root, 'src'), out: join(root, 'out'),
      runtime: join(root, 'runtime'), brokerSocket: join(root, 'broker.sock'), brokerProxy: join(root, 'runtime/bin/model-broker-proxy'),
      brokerPolicyHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), reachableCommitsHash: 'c'.repeat(64) };
    request = { command: join(root, 'runtime/bin/codex'), args: ['app-server'], cwd: join(root, 'src'),
      env: { GH_TOKEN: 'secret', OPENAI_API_KEY: 'secret', PATH: '/usr/bin' } };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('rejects non Linux before spawning', () => {
    expect(() => makeUbuntuBwrapRequest(config, request, 'win32')).toThrow(ReplayIsolationError);
  });
  it('mounts only source read only, output writable, and private network', () => {
    const wrapped = makeUbuntuBwrapRequest(config, request, 'linux');
    expect(wrapped.command).toBe(config.bwrap);
    expect(wrapped.args).toEqual(expect.arrayContaining(['--unshare-all', '--clearenv', '--ro-bind', '--bind']));
    expect(wrapped.args).toContain('/work/src');
    expect(wrapped.args).toContain('/work/out');
    expect(wrapped.args).not.toContain('--share-net');
    expect(JSON.stringify(wrapped)).not.toMatch(/GH_TOKEN|OPENAI_API_KEY|secret|github|\/usr\/bin/);
    expect(wrapped.env).toEqual({});
  });
  it('denies command, cwd, root overlap, and non Codex argv', () => {
    expect(() => makeUbuntuBwrapRequest(config, { ...request, command: config.bwrap }, 'linux')).toThrow(ReplayIsolationError);
    expect(() => makeUbuntuBwrapRequest(config, { ...request, cwd: root }, 'linux')).toThrow(ReplayIsolationError);
    expect(() => makeUbuntuBwrapRequest({ ...config, out: config.snapshot }, request, 'linux')).toThrow(ReplayIsolationError);
    expect(() => makeUbuntuBwrapRequest(config, { ...request, args: ['exec', 'gh'] }, 'linux')).toThrow(ReplayIsolationError);
  });
  it('passes one sealed request to a fake spawner', () => {
    const delegate: IProcessSpawner = { spawnProcess: jest.fn(() => { throw new Error('fake spawn'); }) };
    expect(() => ubuntuReplaySpawner(delegate, config, 'linux').spawnProcess(request)).toThrow('fake spawn');
    expect(delegate.spawnProcess).toHaveBeenCalledWith(expect.objectContaining({ command: config.bwrap, env: {} }));
  });
});
