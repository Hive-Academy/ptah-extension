import {
  MetadataGatewaySessionLister,
  type WorkspaceMetadataStorageLike,
} from './metadata-gateway-session-lister';

const KEY = 'ptah.sessionMetadata';
const ROOT = 'D:\\projects\\alpha';
const OTHER_ROOT = 'D:\\projects\\beta';

interface Entry {
  sessionId: string;
  name?: string;
  workspaceId: string;
  lastActiveAt?: number;
  isChildSession?: boolean;
  [extra: string]: unknown;
}

function entry(overrides: Partial<Entry> & { sessionId: string }): Entry {
  return {
    name: `session ${overrides.sessionId}`,
    workspaceId: ROOT,
    lastActiveAt: 1_000,
    ...overrides,
  };
}

function fakeStorage(args: {
  defaultEntries?: unknown;
  byWorkspace?: Record<string, unknown>;
}): WorkspaceMetadataStorageLike {
  const byWorkspace = args.byWorkspace ?? {};
  return {
    get: <T>(key: string): T | undefined =>
      key === KEY ? (args.defaultEntries as T | undefined) : undefined,
    getAllWorkspacePaths: () => Object.keys(byWorkspace),
    getStorageForWorkspace: (workspacePath: string) =>
      workspacePath in byWorkspace
        ? {
            get: <T>(key: string): T | undefined =>
              key === KEY ? (byWorkspace[workspacePath] as T) : undefined,
          }
        : undefined,
  };
}

describe('MetadataGatewaySessionLister', () => {
  it('aggregates the active/default delegate and every registered workspace storage', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [entry({ sessionId: 'aaa', lastActiveAt: 30 })],
        byWorkspace: {
          [ROOT]: [entry({ sessionId: 'bbb', lastActiveAt: 20 })],
          [OTHER_ROOT]: [entry({ sessionId: 'ccc', lastActiveAt: 10 })],
        },
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions.map((s) => s.sessionId)).toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('filters by normalized workspaceId — separators, case, trailing slash', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [
          entry({ sessionId: 'fwd', workspaceId: 'D:/projects/alpha' }),
          entry({ sessionId: 'case', workspaceId: 'd:\\PROJECTS\\Alpha' }),
          entry({ sessionId: 'trail', workspaceId: 'D:\\projects\\alpha\\' }),
          entry({ sessionId: 'other', workspaceId: OTHER_ROOT }),
        ],
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions.map((s) => s.sessionId).sort()).toEqual([
      'case',
      'fwd',
      'trail',
    ]);
  });

  it('excludes child sessions', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [
          entry({ sessionId: 'parent' }),
          entry({ sessionId: 'child', isChildSession: true }),
        ],
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions.map((s) => s.sessionId)).toEqual(['parent']);
  });

  it('dedupes by sessionId keeping the highest lastActiveAt', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [
          entry({ sessionId: 'dup', name: 'stale', lastActiveAt: 100 }),
        ],
        byWorkspace: {
          [ROOT]: [
            entry({ sessionId: 'dup', name: 'fresh', lastActiveAt: 200 }),
          ],
          [OTHER_ROOT]: [
            entry({ sessionId: 'dup', name: 'older', lastActiveAt: 50 }),
          ],
        },
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions).toEqual([
      { sessionId: 'dup', name: 'fresh', lastActiveAt: 200 },
    ]);
  });

  it('sorts most-recently-active first', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [
          entry({ sessionId: 'old', lastActiveAt: 1 }),
          entry({ sessionId: 'new', lastActiveAt: 300 }),
          entry({ sessionId: 'mid', lastActiveAt: 200 }),
        ],
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions.map((s) => s.sessionId)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('caps at 25 and reports truncated', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry({ sessionId: `s-${i}`, lastActiveAt: i }),
    );
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({ defaultEntries: many }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions).toHaveLength(25);
    expect(result.truncated).toBe(true);
    expect(result.sessions[0].sessionId).toBe('s-29');
    expect(result.sessions[24].sessionId).toBe('s-5');
  });

  it('skips malformed entries and tolerates non-array values', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({
        defaultEntries: [
          entry({ sessionId: 'good' }),
          { sessionId: 42, workspaceId: ROOT, lastActiveAt: 1 },
          { workspaceId: ROOT, lastActiveAt: 1 },
          { sessionId: 'no-timestamp', workspaceId: ROOT },
          'not-an-object',
          null,
        ],
        byWorkspace: { [ROOT]: 'corrupt-not-an-array' },
      }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions.map((s) => s.sessionId)).toEqual(['good']);
  });

  it('defaults a missing name to an empty string', async () => {
    const raw = { sessionId: 'unnamed', workspaceId: ROOT, lastActiveAt: 5 };
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({ defaultEntries: [raw] }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions).toEqual([
      { sessionId: 'unnamed', name: '', lastActiveAt: 5 },
    ]);
  });

  it('returns empty when no storage has the metadata key', async () => {
    const lister = new MetadataGatewaySessionLister(
      fakeStorage({ byWorkspace: { [ROOT]: undefined } }),
    );

    const result = await lister.listForWorkspace(ROOT);
    expect(result.sessions).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
