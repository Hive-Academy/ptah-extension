import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileCodexLaneCredentialProbe } from './codex-app-server-lane-auth';

describe('FileCodexLaneCredentialProbe', () => {
  const originalHome = process.env['CODEX_HOME'];
  const originalUserHome = process.env['HOME'];
  let root: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'codex-lane-auth-')); });
  afterEach(async () => {
    if (originalHome === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = originalHome;
    if (originalUserHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalUserHome;
    await rm(root, { recursive: true, force: true });
  });

  it('uses explicit CODEX_HOME and never falls back to the default account', async () => {
    const defaultHome = join(root, '.codex');
    await mkdir(defaultHome);
    await writeFile(join(defaultHome, 'auth.json'), JSON.stringify({ openai_api_key: 'default' }));
    process.env['HOME'] = root;
    process.env['CODEX_HOME'] = join(root, 'other-account');
    const probe = new FileCodexLaneCredentialProbe();
    await expect(probe.check()).resolves.toBe('missing');
    await mkdir(process.env['CODEX_HOME']);
    await writeFile(join(process.env['CODEX_HOME'], 'auth.json'),
      JSON.stringify({ openai_api_key: 'selected' }));
    await expect(probe.check()).resolves.toBe('fresh');
  });

  it('treats an empty explicit CODEX_HOME as unreadable without default-home fallback', async () => {
    await mkdir(join(root, '.codex'));
    await writeFile(join(root, '.codex', 'auth.json'), JSON.stringify({ openai_api_key: 'default' }));
    process.env['HOME'] = root;
    process.env['CODEX_HOME'] = '';
    await expect(new FileCodexLaneCredentialProbe().check()).resolves.toBe('unreadable');
  });

  it('checks the resolved lane home even when the process environment selects another account', async () => {
    const laneHome = join(root, 'lane-account');
    await mkdir(laneHome);
    await writeFile(join(laneHome, 'auth.json'), JSON.stringify({ openai_api_key: 'lane' }));
    process.env['CODEX_HOME'] = join(root, 'other-account');
    await expect(new FileCodexLaneCredentialProbe().check(laneHome)).resolves.toBe('fresh');
  });

  it('treats an auth path beneath a file as missing', async () => {
    const file = join(root, 'not-a-directory');
    await writeFile(file, 'fixture');
    process.env['CODEX_HOME'] = file;
    await expect(new FileCodexLaneCredentialProbe().check()).resolves.toBe('missing');
  });

  it('reports stale and unreadable auth without refreshing either', async () => {
    process.env['CODEX_HOME'] = root;
    const authPath = join(root, 'auth.json');
    const probe = new FileCodexLaneCredentialProbe();
    await writeFile(authPath, JSON.stringify({
      tokens: { access_token: 'opaque-token' },
      last_refresh: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }));
    await expect(probe.check()).resolves.toBe('stale');
    await writeFile(authPath, '{invalid');
    await expect(probe.check()).resolves.toBe('unreadable');
  });
});
