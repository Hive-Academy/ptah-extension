import 'reflect-metadata';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountNamedRoute,
  ClaudeAccountResolvedResourceContext,
} from '@ptah-extension/auth-providers-tokens';
import { JsonlReaderService } from './jsonl-reader.service';
import { SessionImporterService } from '../../session-importer.service';
import type { SessionMetadataStore } from '../../session-metadata-store';
import { SessionStatsReaderService } from '../../session-stats/session-stats-reader.service';

const workspace = path.resolve('account-fixture-workspace');
const escaped = workspace.replace(/[:\\/]/g, '-');
const id = '11111111-1111-4111-8111-111111111111';

// Already-admitted test fixtures, matching the account-route-env specs.
function context(
  config: string,
  fingerprint = config,
): ClaudeAccountResolvedResourceContext {
  return {
    kind: 'named',
    route: {
      kind: 'named',
      provider: 'claude',
      profileId: 'fixture',
      canonicalConfigDir: config,
      routeFingerprint: fingerprint,
      routeRevision: 1,
      authEpoch: 1,
      runId: 'run',
    } as ClaudeAccountNamedRoute,
    accountDataDir: path.join(config, 'ptah'),
    filesystemIdentity: { volumeId: 'volume', fileId: fingerprint },
  };
}

function logger(): Logger {
  const value: Pick<Logger, 'info' | 'debug' | 'warn'> = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };
  return value as Logger;
}

describe('Claude account resource context', () => {
  let temp: string;
  let reader: JsonlReaderService;
  beforeEach(async () => {
    jest
      .mocked(os.homedir)
      .mockReset()
      .mockImplementation(
        jest.requireActual<typeof import('os')>('os').homedir,
      );
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-account-history-'));
    reader = new JsonlReaderService(logger());
  });
  afterEach(async () => {
    reader.dispose();
    jest.restoreAllMocks();
    await fs.rm(temp, { recursive: true, force: true });
  });

  async function root(name: string): Promise<string> {
    const config = path.join(temp, name);
    await fs.mkdir(path.join(config, 'projects', escaped), { recursive: true });
    return config;
  }

  it('keeps two roots for the same workspace separate', async () => {
    const a = await root('a');
    const b = await root('b');
    const first = await reader.findSessionsDirectory(workspace, context(a));
    const second = await reader.findSessionsDirectory(workspace, context(b));
    expect(first).toBe(await fs.realpath(path.join(a, 'projects', escaped)));
    expect(second).toBe(await fs.realpath(path.join(b, 'projects', escaped)));
    expect(first).not.toBe(second);
    expect(await reader.findSessionsDirectory(workspace, context(a))).toBe(
      first,
    );
  });

  it('reports missing named roots without consulting ambient home', async () => {
    const home = jest.mocked(os.homedir);
    const missing = context(path.join(temp, 'missing'));
    await expect(
      reader.findSessionsDirectory(workspace, missing),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(reader.listSessionsDirectories(missing)).rejects.toMatchObject(
      { code: 'unavailable' },
    );
    expect(home).not.toHaveBeenCalled();
  });

  it('preserves ambient lookup even when CLAUDE_CONFIG_DIR names another root', async () => {
    const home = path.join(temp, 'home');
    const expected = path.join(home, '.claude', 'projects', escaped);
    await fs.mkdir(expected, { recursive: true });
    jest.mocked(os.homedir).mockReturnValue(home);
    const previous = process.env['CLAUDE_CONFIG_DIR'];
    process.env['CLAUDE_CONFIG_DIR'] = path.join(temp, 'unrelated');
    try {
      expect(await reader.findSessionsDirectory(workspace)).toBe(expected);
      expect(await reader.listSessionsDirectories()).toEqual([expected]);
    } finally {
      if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
      else process.env['CLAUDE_CONFIG_DIR'] = previous;
    }
  });

  it('canonicalizes root aliases and deduplicates directory symlinks', async () => {
    const config = await root('physical');
    const alias = path.join(temp, 'alias');
    await fs.symlink(config, alias, 'junction');
    const dir = path.join(config, 'projects', escaped);
    await fs.symlink(
      dir,
      path.join(config, 'projects', 'duplicate'),
      'junction',
    );
    const physical = await reader.findSessionsDirectory(
      workspace,
      context(config, 'same-route'),
    );
    expect(
      await reader.findSessionsDirectory(
        workspace,
        context(alias, 'same-route'),
      ),
    ).toBe(physical);
    expect(
      await reader.listSessionsDirectories(context(alias, 'same-route')),
    ).toEqual([physical]);
    expect(reader['sessionsDirCache'].size).toBe(1);
  });

  it('refuses a session directory symlink escaping the selected root', async () => {
    const config = await root('selected');
    const dir = path.join(config, 'projects', escaped);
    await fs.rmdir(dir);
    const outside = path.join(temp, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, dir, 'junction');
    await expect(
      reader.findSessionsDirectory(workspace, context(config)),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses named import before reading or writing metadata, with a safe closed code', async () => {
    const metadata: Pick<
      SessionMetadataStore,
      'get' | 'save' | 'delete' | 'createChild' | 'getForWorkspace'
    > = {
      get: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createChild: jest.fn(),
      getForWorkspace: jest.fn(),
    };
    const importer = new SessionImporterService(
      logger(),
      metadata as SessionMetadataStore,
    );
    try {
      await expect(
        importer.scanAndImport(
          workspace,
          50,
          undefined,
          context(path.join(temp, 'secret')),
        ),
      ).rejects.toMatchObject({
        code: 'unsupported',
        message: 'Named Claude session import is not supported.',
      });
      for (const method of Object.values(metadata))
        expect(method).not.toHaveBeenCalled();
      jest.mocked(os.homedir).mockReturnValue(path.join(temp, 'empty-home'));
      await expect(importer.scanAndImport(workspace)).resolves.toBe(0);
    } finally {
      importer.dispose();
    }
  });

  it('stats propagates unavailable instead of presenting an empty success', async () => {
    const stats = new SessionStatsReaderService(logger(), reader);
    try {
      const scan = stats.scanDatedUsage(
        { workspacePath: workspace, since: 0, until: 1 },
        context(path.join(temp, 'missing')),
      );
      await expect(scan.next()).rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      stats.dispose();
    }
  });

  it('keeps same-session stats and event identities separate by route and disposes its cache', async () => {
    const a = await root('stats-a');
    const b = await root('stats-b');
    for (const [config, input] of [
      [a, 3],
      [b, 7],
    ] as const) {
      await fs.writeFile(
        path.join(config, 'projects', escaped, `${id}.jsonl`),
        JSON.stringify({
          type: 'assistant',
          sessionId: id,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: {
            id: 'same-message',
            role: 'assistant',
            model: 'fixture',
            usage: { input_tokens: input, output_tokens: 1 },
          },
        }) + '\n',
      );
    }
    const stats = new SessionStatsReaderService(logger(), reader);
    const request = {
      workspacePath: workspace,
      since: 0,
      until: Date.UTC(2027, 0, 1),
    };
    const first = await stats.scanDatedUsage(request, context(a)).next();
    const second = await stats.scanDatedUsage(request, context(b)).next();
    expect(first.value).toMatchObject({ kind: 'usage', record: { input: 3 } });
    expect(second.value).toMatchObject({ kind: 'usage', record: { input: 7 } });
    if (
      !first.done &&
      first.value.kind === 'usage' &&
      !second.done &&
      second.value.kind === 'usage'
    ) {
      expect(first.value.record.key).not.toBe(second.value.record.key);
    }
    expect(stats['cache'].size).toBe(2);
    stats.dispose();
    expect(stats['cache'].size).toBe(0);
    await expect(
      stats.scanDatedUsage(request, context(a)).next(),
    ).rejects.toThrow();
  });

  it('bounds route directory entries and clears both reader caches on disposal', async () => {
    const config = await root('bounded');
    for (let i = 0; i < 35; i++)
      await reader.findSessionsDirectory(
        workspace,
        context(config, `route-${i}`),
      );
    expect(reader['sessionsDirCache'].size).toBe(32);
    const file = path.join(config, 'projects', escaped, `${id}.jsonl`);
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'user',
        uuid: id,
        message: { role: 'user', content: 'hello' },
      }) + '\n',
    );
    await reader.readJsonlMessages(file, undefined, context(config));
    expect(reader['transcriptCache'].size).toBe(1);
    reader.dispose();
    expect(reader['sessionsDirCache'].size).toBe(0);
    expect(reader['transcriptCache'].size).toBe(0);
    expect(reader['transcriptCacheBytes']).toBe(0);
    await reader.findSessionsDirectory(workspace, context(config));
    expect(reader['sessionsDirCache'].size).toBe(0);
  });
});
