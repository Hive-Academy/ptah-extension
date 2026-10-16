import 'reflect-metadata';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { FileLockTimeoutError } from '@ptah-extension/harness-sync';
import {
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
      getWorkspaceFolders: () => [root],
    } as IWorkspaceProvider;
    store = new HarnessProposalStore(
      logger as unknown as Logger,
      workspaceProvider,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('preserves every field across concurrent partial writes to one session', async () => {
    await Promise.all([
      store.save('session', { name: 'Alpha' }, false),
      store.save('session', { persona: { label: 'Reviewer' } as never }, false),
      store.save(
        'session',
        { prompt: { systemPrompt: 'Help' } as never },
        true,
      ),
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

  it('reads a stored root with different Windows casing and a trailing separator', async () => {
    const saved = await store.save('one', { name: 'First' }, false);
    await fs.writeFile(
      fileFor('one'),
      JSON.stringify({
        ...saved,
        workspaceRoot: `${root.toUpperCase()}${path.sep}`,
      }),
    );
    const platform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    try {
      expect((await store.get('one', root))?.configUpdates.name).toBe('First');
    } finally {
      Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
      });
    }
  });

  it('persists one exact revision per save with a unique write identity', async () => {
    const first = await store.save('one', { name: 'First' }, false);
    const second = await store.save('one', { name: 'Second' }, true);
    expect(first.revisions).toHaveLength(1);
    expect(second.revisions).toHaveLength(2);
    expect(
      second.revisions?.filter(
        (revision) => revision.updatedAt === second.updatedAt,
      ),
    ).toHaveLength(1);
    expect(second.revisions?.[1].configUpdates).toEqual({ name: 'Second' });
    expect(JSON.parse(await fs.readFile(fileFor('one'), 'utf8'))).toEqual(
      second,
    );
  });

  it('a T1 revision persisted after T3 leaves unchosen fields on T3', async () => {
    const t1 = '2026-10-15T10:00:00.000Z';
    const t3 = '2026-10-15T10:03:00.000Z';
    const firstSaved = await store.save('one', { name: 'T3' }, true, t3);
    const late = await store.save(
      'one',
      { name: 'T1', prompt: { systemPrompt: 'From T1' } as never },
      false,
      t1,
    );
    expect(late.revisions?.map((revision) => revision.turnStartedAt)).toEqual([
      t1,
      t3,
    ]);
    expect(late.configUpdates).toEqual({
      name: 'T3',
      prompt: { systemPrompt: 'From T1' },
    });
    expect(late.isConfigComplete).toBe(true);
    expect(
      late.revisions?.find((revision) => revision.updatedAt === late.updatedAt)
        ?.configUpdates.name,
    ).toBe('T1');
    expect(late.revisions?.[1].id).toBe(firstSaved.revisions?.[0].id);
    expect(await store.get('one')).toEqual(late);
  });

  it('reads a merged-only legacy record as one unattributed revision', async () => {
    const saved = await store.save('one', { name: 'Legacy' }, false);
    const legacy = { ...saved };
    delete legacy.revisions;
    await fs.writeFile(fileFor('one'), JSON.stringify(legacy));
    const loaded = await store.get('one');
    expect(loaded?.revisions).toEqual([
      {
        id: `legacy:one:${saved.updatedAt}`,
        configUpdates: { name: 'Legacy' },
        isConfigComplete: false,
        updatedAt: saved.updatedAt,
      },
    ]);
    const next = await store.save(
      'one',
      { name: 'Attributed' },
      true,
      new Date(Date.parse(saved.updatedAt) + 60_000).toISOString(),
    );
    expect(next.revisions).toHaveLength(2);
    expect(next.revisions?.[0].turnStartedAt).toBeUndefined();
    expect(next.configUpdates.name).toBe('Attributed');
  });

  it('lets a newer unattributed write override an older attributed turn', async () => {
    await store.save('one', { name: 'T3' }, true, '2026-10-15T10:03:00.000Z');
    const late = await store.save('one', { name: 'Unknown' }, false);
    expect(late.revisions?.[1].turnStartedAt).toBeUndefined();
    expect(late.configUpdates.name).toBe('Unknown');
    expect(late.isConfigComplete).toBe(false);
  });

  it('isolates sessions in the same workspace', async () => {
    await store.save('one', { name: 'First' }, false);
    await store.save('two', { name: 'Second' }, true);
    expect((await store.get('one'))?.configUpdates.name).toBe('First');
    expect((await store.get('two'))?.configUpdates.name).toBe('Second');
    expect(fileFor('one')).not.toBe(fileFor('two'));
  });

  it('persists under the pinned caller root when the active provider root differs', async () => {
    const callerRoot = path.join(root, 'caller');
    const getWorkspaceRoot = jest.fn((): string | undefined => {
      throw new Error('Active provider root must not be read');
    });
    const pinnedStore = new HarnessProposalStore(
      logger as unknown as Logger,
      {
        getWorkspaceRoot: () => getWorkspaceRoot(),
        getWorkspaceFolders: () => [root, callerRoot],
      } as IWorkspaceProvider,
    );
    const capture = pinnedStore.captureProposingTurnStartedAt(
      'one',
      callerRoot,
    );
    const saved = await pinnedStore.save(
      'one',
      { name: 'Caller' },
      false,
      capture.turnStartedAt,
      callerRoot,
    );
    capture.release();
    expect(getWorkspaceRoot).not.toHaveBeenCalled();
    expect(saved.workspaceRoot).toBe(callerRoot);
    expect(await pinnedStore.get('one', callerRoot)).toEqual(saved);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            callerRoot,
            '.ptah',
            'harness',
            'proposals',
            path.basename(fileFor('one')),
          ),
          'utf8',
        ),
      ),
    ).toEqual(saved);
    await expect(fs.access(fileFor('one'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses the open folder spelling for an equivalent pinned root', async () => {
    const pinnedRoot = `${root}${path.sep}`;
    const saved = await store.save(
      'one',
      { name: 'Open' },
      false,
      undefined,
      pinnedRoot,
    );
    expect(saved.workspaceRoot).toBe(root);
    expect(await store.get('one', pinnedRoot)).toEqual(saved);
    expect(JSON.parse(await fs.readFile(fileFor('one'), 'utf8'))).toEqual(
      saved,
    );
  });

  it('rejects a pinned root outside the open folders', async () => {
    const closedRoot = path.join(root, 'closed');
    expect(() =>
      store.captureProposingTurnStartedAt('one', closedRoot),
    ).toThrow(/not an open workspace folder/);
    await expect(
      store.save('one', {}, false, undefined, closedRoot),
    ).rejects.toThrow(/not an open workspace folder/);
    await expect(store.get('one', closedRoot)).rejects.toThrow(
      /not an open workspace folder/,
    );
    await expect(
      fs.access(path.join(closedRoot, '.ptah')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    '',
    'relative/workspace',
    '  ',
    `${path.sep}tmp${path.sep}..${path.sep}workspace`,
  ])('rejects an invalid pinned root %j before writing', async (callerRoot) => {
    expect(() =>
      store.captureProposingTurnStartedAt('one', callerRoot),
    ).toThrow(/absolute path without traversal/);
    await expect(
      store.save('one', {}, false, undefined, callerRoot),
    ).rejects.toThrow(/absolute path without traversal/);
    await expect(fs.access(fileFor('one'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
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
    expect(
      (await store.save('one', { name: 'New' }, false)).configUpdates,
    ).toEqual({
      name: 'New',
    });
  });

  it.each([
    ['sessionId', 'other'],
    ['workspaceRoot', '/different/workspace'],
  ] as const)('rejects a mismatched %s', async (field, value) => {
    const saved = await store.save('one', { name: 'Old' }, false);
    await fs.writeFile(
      fileFor('one'),
      JSON.stringify({ ...saved, [field]: value }),
    );
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
    await expect(fs.access(fileFor('old'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.get('new')).not.toBeNull();
  });

  it('rejects when another process holds the lock past the deadline', async () => {
    const file = fileFor('one');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      `${file}.lock`,
      JSON.stringify({ pid: 999999, at: Date.now() + 60_000 }),
      { flag: 'wx' },
    );
    let clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    await expect(
      store.save('one', { name: 'Blocked' }, false),
    ).rejects.toBeInstanceOf(FileLockTimeoutError);
    await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers an expired lock', async () => {
    const file = fileFor('one');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      `${file}.lock`,
      JSON.stringify({ pid: 999999, at: Date.now() - 11_000 }),
      { flag: 'wx' },
    );
    expect(
      (await store.save('one', { name: 'Recovered' }, false)).configUpdates
        .name,
    ).toBe('Recovered');
    await expect(fs.access(`${file}.lock`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
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
    expect(JSON.parse(await fs.readFile(fileFor('one'), 'utf8'))).toEqual(
      saved,
    );
  });

  it('completes a save when its lock disappears before release', async () => {
    const file = fileFor('one');
    const rename = fs.rename;
    jest
      .spyOn(require('fs/promises') as typeof import('fs/promises'), 'rename')
      .mockImplementation(async (from, to) => {
        await fs.rm(`${file}.lock`, { force: true });
        return rename(from, to);
      });
    const saved = await store.save('one', { name: 'Persisted' }, false);
    const restarted = new HarnessProposalStore(
      logger as unknown as Logger,
      workspaceProvider,
    );
    expect(await restarted.get('one')).toEqual(saved);
  });

  it('trims session ids before hashing and rejects invalid ids before file access', async () => {
    const saved = await store.save(' a ', { name: 'Trimmed' }, false);
    expect(saved.sessionId).toBe('a');
    expect(JSON.parse(await fs.readFile(fileFor('a'), 'utf8')).sessionId).toBe(
      'a',
    );
    expect(await store.get('a')).toEqual(saved);
    expect(await store.get(' a ')).toEqual(saved);

    const otherRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'harness-invalid-id-'),
    );
    try {
      const invalidStore = new HarnessProposalStore(
        logger as unknown as Logger,
        { getWorkspaceRoot: () => otherRoot } as IWorkspaceProvider,
      );
      for (const id of ['', '   ', 'x'.repeat(257)]) {
        await expect(invalidStore.save(id, {}, false)).rejects.toThrow();
        await expect(invalidStore.get(id)).rejects.toThrow();
      }
      await expect(
        fs.access(path.join(otherRoot, '.ptah', 'harness', 'proposals')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it('prunes old corrupt and expired valid records while retaining recent corrupt files', async () => {
    const old = await store.save('old', { name: 'Old' }, false);
    await fs.writeFile(
      fileFor('old'),
      JSON.stringify({ ...old, updatedAt: '2020-01-01T00:00:00.000Z' }),
    );
    const staleCorrupt = fileFor('corrupt');
    const recentCorrupt = fileFor('recent');
    await fs.writeFile(staleCorrupt, '{broken');
    await fs.writeFile(recentCorrupt, '{broken');
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(staleCorrupt, oldTime, oldTime);
    await store.save('new', { name: 'New' }, false);
    await expect(fs.access(staleCorrupt)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(fileFor('old'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(recentCorrupt)).resolves.toBeUndefined();
  });

  it('keeps a saved label when a later update explicitly contains undefined', async () => {
    await store.save('one', { persona: { label: 'Reviewer' } as never }, false);
    await store.save('one', { persona: { label: undefined } } as never, false);
    const restarted = new HarnessProposalStore(
      logger as unknown as Logger,
      workspaceProvider,
    );
    expect((await restarted.get('one'))?.configUpdates.persona?.label).toBe(
      'Reviewer',
    );
  });
});
