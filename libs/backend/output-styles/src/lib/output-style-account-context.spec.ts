import 'reflect-metadata';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import type { ClaudeAccountResolvedResourceContext } from '@ptah-extension/auth-providers-tokens';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  OutputStyleDiscoveryService,
  userOutputStyleDirectory,
  boundOutputStyleDirectory,
} from './output-style-discovery.service';
import { OutputStyleFileWriter } from './output-style-file.writer';
import { OutputStyleSessionActivationService } from './output-style-session-activation.service';
import { OutputStyleActivationResolver } from './output-style-activation.resolver';

// Load only the leaf readers, avoiding the runtime composition barrel in this
// cross-library regression spec (Batch 13 owns this single spec file).
const { readClaudeUserMcpServers } = jest.requireActual<{
  readClaudeUserMcpServers: (
    workspace: string,
    options: { homeDir: string },
    context?: ClaudeAccountResolvedResourceContext,
  ) => { serverKey: string }[] | { status: 'unsupported'; code: 'unsupported' };
}>('../../../cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader');
const { ClaudeApprovalReader } = jest.requireActual<{
  ClaudeApprovalReader: new (options: { homeDir: string }) => {
    read: (
      workspace: string,
      context?: ClaudeAccountResolvedResourceContext,
    ) => Promise<{
      status: 'ok' | 'error';
      code?: 'unsupported';
      approvals: object[];
    }>;
  };
}>('../../../cli-agent-runtime/src/lib/capabilities/claude-approval.reader');

const workspaceRoot = path.resolve('account-style-workspace');
const configRoot = path.resolve('account-style-config');
const context = {
  kind: 'named',
  route: {
    kind: 'named',
    provider: 'claude',
    profileId: 'selected',
    canonicalConfigDir: configRoot,
    routeFingerprint: 'route-a',
    routeRevision: 1,
    authEpoch: 1,
    runId: 'run-a',
  },
  accountDataDir: path.resolve('account-style-data'),
  filesystemIdentity: { volumeId: 'volume', fileId: 'file' },
} as ClaudeAccountResolvedResourceContext;
const ambient = {
  kind: 'ambient',
  route: { kind: 'ambient' },
} as ClaudeAccountResolvedResourceContext;
const params = {
  tier: 'user' as const,
  name: 'Terse',
  description: 'Short answers',
  keepCodingInstructions: false,
  body: 'Selected account body.',
};

function harness() {
  const files = createMockFileSystemProvider();
  const workspace = {
    getWorkspaceRoot: () => workspaceRoot,
  } as IWorkspaceProvider;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const discovery = new OutputStyleDiscoveryService(
    files,
    workspace,
    logger as never,
  );
  const writer = new OutputStyleFileWriter(files, workspace, logger as never);
  const settings = { readGlobal: jest.fn(() => 'Terse') };
  const activation = new OutputStyleSessionActivationService(
    logger as never,
    discovery,
    new OutputStyleActivationResolver(),
    settings as never,
  );
  return { files, discovery, writer, activation, logger };
}

describe('selected Claude output styles', () => {
  beforeEach(() => {
    // The content port is in-memory; model matching canonical host directories.
    jest
      .spyOn(fs, 'realpath')
      .mockImplementation(async (target) => String(target));
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses opaque named paths and prevents opening rows through ambient editor routes', async () => {
    const { files, writer, discovery } = harness();
    expect(await writer.save(params, context)).toMatchObject({
      ok: true,
      location: { displayPath: 'account:output-styles/terse.md' },
    });
    await files.writeFile(
      path.join(configRoot, 'output-styles', 'broken.md'),
      '---\nname: [invalid\n---\nBody',
    );
    const result = await discovery.discover({}, context);
    expect(result.styles.find((style) => style.name === 'Terse')).toMatchObject(
      {
        relativePath: 'account:output-styles/terse.md',
        editable: false,
      },
    );
    expect(result.invalid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'account:output-styles/broken.md',
          openable: false,
        }),
      ]),
    );
    for (const row of [...result.styles, ...result.invalid]) {
      expect(row.relativePath?.startsWith('~/.claude')).not.toBe(true);
    }
    expect(
      await writer.stat({ tier: 'user', name: 'Terse' }, context),
    ).toMatchObject({
      ok: true,
      location: { displayPath: 'account:output-styles/terse.md' },
    });
    expect(
      await writer.delete({ tier: 'user', name: 'Terse' }, context),
    ).toMatchObject({
      ok: true,
      location: { displayPath: 'account:output-styles/terse.md' },
    });
    expect(await writer.save(params)).toMatchObject({
      ok: true,
      location: { displayPath: '~/.claude/output-styles/terse.md' },
    });
  });

  it('refuses an escaping named directory before discovery, save, stat or delete I/O', async () => {
    const { files, writer, discovery } = harness();
    jest
      .spyOn(fs, 'realpath')
      .mockImplementation(async (target) =>
        String(target) === configRoot ? configRoot : userOutputStyleDirectory(),
      );
    await expect(discovery.discover({}, context)).rejects.toMatchObject({
      code: 'unavailable',
    });
    for (const operation of [
      () => writer.save(params, context),
      () => writer.stat({ tier: 'user', name: 'Terse' }, context),
      () => writer.delete({ tier: 'user', name: 'Terse' }, context),
    ]) {
      expect(await operation()).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(files.readDirectory).not.toHaveBeenCalled();
    expect(files.readFile).not.toHaveBeenCalled();
    expect(files.writeFile).not.toHaveBeenCalled();
    expect(files.delete).not.toHaveBeenCalled();
  });

  it('bounds real directory junctions and allows a genuinely absent style directory', async () => {
    jest.restoreAllMocks();
    const root = await fs.mkdtemp(path.join(tmpdir(), 'ptah-style-bound-'));
    const account = path.join(root, 'account');
    const outside = path.join(root, 'account-other');
    const directory = path.join(account, 'output-styles');
    if (context.kind !== 'named') throw new Error('Expected named fixture');
    const selected = {
      ...context,
      route: { ...context.route, canonicalConfigDir: account },
    };
    try {
      await fs.mkdir(account);
      await fs.mkdir(outside);
      expect(await boundOutputStyleDirectory(directory, 'user', selected)).toBe(
        path.join(await fs.realpath(account), 'output-styles'),
      );
      await fs.symlink(outside, directory, 'junction');
      await expect(
        boundOutputStyleDirectory(directory, 'user', selected),
      ).rejects.toMatchObject({ code: 'unavailable' });
      await fs.unlink(directory);
      const inside = path.join(account, 'styles');
      await fs.mkdir(inside);
      await fs.symlink(inside, directory, 'junction');
      expect(await boundOutputStyleDirectory(directory, 'user', selected)).toBe(
        await fs.realpath(inside),
      );
      await fs.rmdir(inside);
      await expect(
        boundOutputStyleDirectory(directory, 'user', selected),
      ).rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('logs only a code and basename for named directory and file read errors', async () => {
    const { files, writer, discovery, logger } = harness();
    await writer.save(params, context);
    const error = { code: 'EACCES', message: `denied ${configRoot}/secret` };
    files.readDirectory.mockRejectedValueOnce(error);
    await discovery.discover({}, context);
    expect(logger.debug).toHaveBeenCalledWith(
      '[output-styles] tier directory not readable',
      { code: 'EACCES', fileName: 'output-styles' },
    );
    files.readFile.mockRejectedValueOnce(error);
    await discovery.discover({}, context);
    expect(logger.warn).toHaveBeenCalledWith(
      '[output-styles] style file unreadable',
      { code: 'EACCES', fileName: 'terse.md' },
    );
    expect(
      JSON.stringify([logger.debug.mock.calls, logger.warn.mock.calls]),
    ).not.toContain(configRoot);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('denied');
  });

  it('writes, discovers, activates, stats, renames and deletes in the selected config root', async () => {
    const { files, writer, discovery, activation } = harness();
    const saved = await writer.save(params, context);
    expect(saved).toMatchObject({
      ok: true,
      location: {
        absolutePath: path.join(configRoot, 'output-styles', 'terse.md'),
      },
    });
    expect((await discovery.discover({}, context)).styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Terse',
          tier: 'user',
          body: expect.stringContaining(params.body),
        }),
      ]),
    );
    expect(
      await activation.resolveSessionFields(
        { userSettingSourceIncluded: false },
        context,
      ),
    ).toEqual({ outputStyleBody: expect.stringContaining(params.body) });
    expect(
      await activation.resolveSessionFields(
        { userSettingSourceIncluded: true },
        context,
      ),
    ).toEqual({ outputStyleName: 'Terse' });
    expect(
      await writer.stat({ tier: 'user', name: 'Terse' }, context),
    ).toMatchObject({ ok: true });
    expect(
      await writer.save(
        { ...params, name: 'Brief', originalName: 'Terse' },
        context,
      ),
    ).toMatchObject({ ok: true, renamedFrom: 'Terse' });
    expect(
      await writer.delete({ tier: 'user', name: 'Brief' }, context),
    ).toMatchObject({ ok: true });
    for (const [writtenPath] of files.writeFile.mock.calls) {
      expect(path.dirname(writtenPath)).toBe(
        path.join(configRoot, 'output-styles'),
      );
    }
    expect(
      files.__state.files.has(
        path.join(userOutputStyleDirectory(), 'terse.md'),
      ),
    ).toBe(false);
  });

  it('keeps project assets workspace-owned and project precedence unchanged', async () => {
    const { writer, discovery, activation } = harness();
    await writer.save(params, context);
    expect(
      await writer.save(
        { ...params, tier: 'project', body: 'Workspace body.' },
        context,
      ),
    ).toMatchObject({
      ok: true,
      location: {
        absolutePath: path.join(
          workspaceRoot,
          '.claude',
          'output-styles',
          'terse.md',
        ),
      },
    });
    const result = await discovery.discover({}, context);
    expect(
      result.styles.find(
        (style) => style.name === 'Terse' && style.tier === 'user',
      )?.shadowed,
    ).toBe(true);
    expect(
      await activation.resolveSessionFields(
        { userSettingSourceIncluded: false },
        context,
      ),
    ).toEqual({ outputStyleName: 'Terse' });
  });

  it('keeps ambient calls compatible and never substitutes their user styles for a named account', async () => {
    const { writer, discovery, activation, logger } = harness();
    await writer.save(params);
    expect(userOutputStyleDirectory(ambient)).toBe(userOutputStyleDirectory());
    expect(
      (await discovery.discover()).styles.some(
        (style) => style.name === 'Terse',
      ),
    ).toBe(true);
    expect(
      (await discovery.discover({}, context)).styles.some(
        (style) => style.name === 'Terse',
      ),
    ).toBe(false);
    expect(await activation.resolveSessionFields({}, context)).toEqual({
      outputStyleUnavailable: true,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[OutputStyleSessionActivation] selected style unavailable for this account; starting without a style',
    );
    expect(await activation.resolveSessionFields()).toEqual({
      outputStyleName: 'Terse',
    });
  });

  it.each(['', 'relative-config'])(
    'refuses invalid selected roots (%s) without writing ambient files',
    async (config) => {
      if (context.kind !== 'named') throw new Error('Expected named fixture');
      const invalid = {
        ...context,
        route: { ...context.route, canonicalConfigDir: config },
      };
      const { files, writer, discovery, activation } = harness();
      expect(await writer.save(params, invalid)).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      await expect(discovery.discover({}, invalid)).rejects.toMatchObject({
        code: 'unavailable',
      });
      await expect(
        activation.resolveSessionFields({}, invalid),
      ).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(files.writeFile).not.toHaveBeenCalled();
    },
  );
});

describe('selected Claude imported user-state support', () => {
  let homeDir: string;
  let workspace: string;
  let state: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(tmpdir(), 'ptah-account-state-'));
    workspace = path.join(homeDir, 'workspace');
    state = JSON.stringify({
      mcpServers: { ambient: { command: 'ambient-server' } },
      projects: { [workspace]: { enabledMcpjsonServers: ['ambient'] } },
    });
    await fs.writeFile(path.join(homeDir, '.claude.json'), state);
  });
  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('returns unsupported instead of importing ambient MCP for a named context', () => {
    expect(
      readClaudeUserMcpServers(workspace, { homeDir }, context),
    ).toMatchObject({ status: 'unsupported', code: 'unsupported' });
    expect(readClaudeUserMcpServers(workspace, { homeDir })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverKey: 'ambient' }),
      ]),
    );
    expect(readClaudeUserMcpServers(workspace, { homeDir }, ambient)).toEqual(
      readClaudeUserMcpServers(workspace, { homeDir }),
    );
  });

  it('fails approval import closed while preserving ambient reads and source contents', async () => {
    const reader = new ClaudeApprovalReader({ homeDir });
    expect(await reader.read(workspace, context)).toMatchObject({
      status: 'error',
      code: 'unsupported',
      approvals: [],
    });
    const oldResult = await reader.read(workspace);
    expect(oldResult.status).toBe('ok');
    expect(oldResult.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabledMcpjsonServers: ['ambient'] }),
      ]),
    );
    expect(await reader.read(workspace, ambient)).toEqual(oldResult);
    expect(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8')).toBe(
      state,
    );
  });
});
