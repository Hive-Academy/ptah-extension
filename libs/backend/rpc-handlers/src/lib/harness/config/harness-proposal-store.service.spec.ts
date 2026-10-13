import 'reflect-metadata';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  HarnessProposalLockError,
  HarnessProposalStore,
  HarnessProposalWorkspaceError,
} from './harness-proposal-store.service';

describe('HarnessProposalStore', () => {
  let root: string;
  let logger: ReturnType<typeof createMockLogger>;
  let workspaceProvider: IWorkspaceProvider;
  let store: HarnessProposalStore;

  const fileFor = (sessionId: string): string =>
    path.join(
      root,
      '.ptah',
      'harness',
      'proposals',
      `${createHash('sha256').update(sessionId).digest('hex')}.json`,
    );

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-proposal-store-'));
    logger = createMockLogger();
    workspaceProvider = {
      getWorkspaceRoot: () => root,
    } as IWorkspaceProvider;
    store = new HarnessProposalStore(logger as unknown as Logger, workspaceProvider);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('preserves every field across concurrent partial writes to one session', async () => {
    await Promise.all([
      store.save('session', { name: 'Alpha' }, false),
      store.save('session', { persona: { label: 'Reviewer' } as never }, false),
      store.save('session', { prompt: { systemPrompt: 'Help' } as never }, true),
    ]);
    expect((await store.get('session'))?.configUpdates).toEqual({
      name: 'Alpha',
      persona: { label: 'Reviewer' },
      prompt: { systemPrompt: 'Help' },
    });
    expect((await store.get('session'))?.isConfigComplete).toBe(true);
  });

  it('merges successive updates for one session', async () => {
    await store.save('one', { name: 'First' }, false);
    const saved = await store.save('one', { name: 'Second' }, true);
    expect(saved.configUpdates.name).toBe('Second');
    expect(saved.isConfigComplete).toBe(true);
    expect(await store.get('one')).toEqual(saved);
  });

  it('isolates sessions in the same workspace', async () => {
    await store.save('one', { name: 'First' }, false);
    await store.save('two', { name: 'Second' }, true);
    expect((await store.get('one'))?.configUpdates.name).toBe('First');
    expect((await store.get('two'))?.configUpdates.name).toBe('Second');
    expect(fileFor('one')).not.toBe(fileFor('two'));
  });

  it('reads a proposal using a new store instance', async () => {
    const saved = await store.save('one', { name: 'Persisted' }, false);
    const restarted = new HarnessProposalStore(
      logger as unknown as Logger,
      workspaceProvider,
    );
    expect(await restarted.get('one')).toEqual(saved);
  });

  it('rejects corrupt records and replaces them on save', async () => {
    await store.save('one', { name: 'Old' }, false);
    await fs.writeFile(fileFor('one'), '{broken');
    expect(await store.get('one')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    expect((await store.save('one', { name: 'New' }, false)).configUpdates).toEqual({
      name: 'New',
    });
  });

  it.each([
    ['sessionId', 'other'],
    ['workspaceRoot', '/different/workspace'],
  ] as const)('rejects a mismatched %s', async (field, value) => {
    const saved = await store.save('one', { name: 'Old' }, false);
    await fs.writeFile(fileFor('one'), JSON.stringify({ ...saved, [field]: value }));
    expect(await store.get('one')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('prunes records older than 30 days during access', async () => {
    const old = await store.save('old', { name: 'Old' }, false);
    await fs.writeFile(
      fileFor('old'),
      JSON.stringify({ ...old, updatedAt: '2020-01-01T00:00:00.000Z' }),
    );
    await store.save('new', { name: 'New' }, false);
    await expect(fs.access(fileFor('old'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.get('new')).not.toBeNull();
  });

  it('rejects when another process holds the lock past the deadline', async () => {
    const file = fileFor('one');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.lock`, 'held', { flag: 'wx' });
    await expect(store.save('one', { name: 'Blocked' }, false)).rejects.toBeInstanceOf(
      HarnessProposalLockError,
    );
    await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers an expired lock', async () => {
    const file = fileFor('one');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.lock`, 'stale', { flag: 'wx' });
    const stale = new Date(Date.now() - 10_000);
    await fs.utimes(`${file}.lock`, stale, stale);
    expect((await store.save('one', { name: 'Recovered' }, false)).configUpdates.name).toBe(
      'Recovered',
    );
    await expect(fs.access(`${file}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws a typed error when no workspace is open', async () => {
    const noWorkspace = new HarnessProposalStore(
      logger as unknown as Logger,
      { getWorkspaceRoot: () => undefined } as IWorkspaceProvider,
    );
    await expect(noWorkspace.get('one')).rejects.toBeInstanceOf(
      HarnessProposalWorkspaceError,
    );
    await expect(noWorkspace.save('one', {}, false)).rejects.toBeInstanceOf(
      HarnessProposalWorkspaceError,
    );
  });

  it('round trips an already normalized skill selection unchanged', async () => {
    const saved = await store.save(
      'one',
      {
        skills: {
          selectedSkills: ['review'],
          selectedSkillRefs: [{ skillId: 'review', origin: 'local' }],
          createdSkills: [],
        },
      } as never,
      false,
    );
    expect(await store.get('one')).toEqual(saved);
    expect(JSON.parse(await fs.readFile(fileFor('one'), 'utf8'))).toEqual(saved);
  });
});
