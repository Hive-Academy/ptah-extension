import 'reflect-metadata';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  SessionTranscriptLocator,
  type SessionsDirectoryLister,
} from './session-transcript-locator';

jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, stat: jest.fn(actual.stat) };
});

const actualStat =
  jest.requireActual<typeof import('fs/promises')>('fs/promises').stat;
const mockedStat = fsPromises.stat as jest.MockedFunction<
  typeof fsPromises.stat
>;

describe('SessionTranscriptLocator', () => {
  const tempRoots: string[] = [];

  beforeEach(() => mockedStat.mockImplementation(actualStat));

  function tempRoot(): string {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'thoth-session-locator-'),
    );
    tempRoots.push(root);
    return root;
  }

  function directory(root: string, name: string): string {
    const result = path.join(root, name);
    fs.mkdirSync(result, { recursive: false });
    return result;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a file in the second folder and stops before the third', async () => {
    const root = tempRoot();
    const folders = ['one', 'two', 'three'].map((name) =>
      directory(root, name),
    );
    const found = path.join(folders[1], 'session-1.jsonl');
    fs.writeFileSync(found, '{}\n');
    const lister = { listSessionsDirectories: jest.fn(async () => folders) };
    const lookup = new SessionTranscriptLocator(lister).createRunLookup();

    await expect(lookup.locate('session-1')).resolves.toEqual({
      kind: 'found',
      path: found,
    });
    expect(lookup.stats()).toEqual({
      directoryListings: 1,
      pathStats: 2,
      cacheHits: 0,
    });
  });

  it('reports absent after checking every folder', async () => {
    const root = tempRoot();
    const folders = ['one', 'two', 'three'].map((name) =>
      directory(root, name),
    );
    const lookup = new SessionTranscriptLocator({
      listSessionsDirectories: async () => folders,
    }).createRunLookup();

    await expect(lookup.locate('missing')).resolves.toEqual({ kind: 'absent' });
    expect(lookup.stats().pathStats).toBe(3);
  });

  it.each([
    ['a null listing', { listSessionsDirectories: async () => null }],
    ['a reader without the optional method', {}],
  ])('reports unavailable for %s without stats', async (_label, lister) => {
    const lookup = new SessionTranscriptLocator(
      lister as SessionsDirectoryLister,
    ).createRunLookup();
    await expect(lookup.locate('session-1')).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(lookup.stats().pathStats).toBe(0);
  });

  it('reports unavailable when the directory listing is empty', async () => {
    const lookup = new SessionTranscriptLocator({
      listSessionsDirectories: async () => [],
    }).createRunLookup();

    await expect(lookup.locate('session-1')).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(lookup.stats()).toEqual({
      directoryListings: 1,
      pathStats: 0,
      cacheHits: 0,
    });
  });

  it('does not treat a matching directory as a transcript file', async () => {
    const root = tempRoot();
    const folder = directory(root, 'sessions');
    directory(folder, 'session-1.jsonl');
    const lookup = new SessionTranscriptLocator({
      listSessionsDirectories: async () => [folder],
    }).createRunLookup();
    await expect(lookup.locate('session-1')).resolves.toEqual({
      kind: 'absent',
    });
  });

  it('reports unavailable when stat fails with EBUSY and no folder hits', async () => {
    const root = tempRoot();
    const folder = directory(root, 'sessions');
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    mockedStat.mockRejectedValueOnce(busy);
    const lookup = new SessionTranscriptLocator({
      listSessionsDirectories: async () => [folder],
    }).createRunLookup();
    await expect(lookup.locate('session-1')).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it.each(['../x', 'a/b', 'a\\b', ''])(
    '%j is unavailable without I/O',
    async (id) => {
      const lister = { listSessionsDirectories: jest.fn(async () => []) };
      const lookup = new SessionTranscriptLocator(lister).createRunLookup();
      await expect(lookup.locate(id)).resolves.toEqual({ kind: 'unavailable' });
      expect(lister.listSessionsDirectories).not.toHaveBeenCalled();
      expect(lookup.stats().pathStats).toBe(0);
    },
  );

  it('caches a session result within one run lookup', async () => {
    const root = tempRoot();
    const folder = directory(root, 'sessions');
    const transcript = path.join(folder, 'shared.jsonl');
    fs.writeFileSync(transcript, '{}\n');
    const lister = { listSessionsDirectories: jest.fn(async () => [folder]) };
    const lookup = new SessionTranscriptLocator(lister).createRunLookup();
    await lookup.locate('shared');
    const afterFirst = lookup.stats().pathStats;
    await lookup.locate('shared');
    expect(lookup.stats()).toEqual({
      directoryListings: 1,
      pathStats: afterFirst,
      cacheHits: 1,
    });
  });
});
