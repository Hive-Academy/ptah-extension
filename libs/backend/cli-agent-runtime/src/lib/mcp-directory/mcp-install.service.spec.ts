// `harness-sync`'s barrel reaches `vscode-core` and therefore tsyringe.
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  McpIntentStore,
  type HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import type {
  McpOAuthConnectedRecord,
  SmitheryInstalledRecord,
} from '@ptah-extension/shared';
import { McpInstallService } from './mcp-install.service';

/**
 * Every case runs against a temp directory used as BOTH the home dir and the
 * workspace root, so no facet, intent store or reader can reach the
 * developer's real `~/.mcp.json`, `~/.claude.json` or `~/.ptah`.
 */
describe('McpInstallService', () => {
  let tmp: string;
  let intents: McpIntentStore;
  let reconcileCalls: number;

  /** A reconciler that reports every requested target clean. */
  const cleanReconciler = (): HarnessReconcilerService =>
    ({
      reconcile: (_root: string, opts: { targets?: string[] }) => {
        reconcileCalls += 1;
        return Promise.resolve({
          targets: (opts.targets ?? []).map((target) => ({
            target,
            writeFailed: [],
          })),
        });
      },
    }) as unknown as HarnessReconcilerService;

  const service = (
    options: {
      smithery?: {
        filePath: string;
        list(): SmitheryInstalledRecord[];
      };
      oauth?: { filePath: string; list(): McpOAuthConnectedRecord[] };
    } = {},
  ): McpInstallService =>
    new McpInstallService(cleanReconciler(), intents, {
      homeDir: tmp,
      ...options,
    });

  const writeMcpJson = (servers: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify({ mcpServers: servers }),
      'utf-8',
    );
  };

  const readMcpJson = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8'))
      .mcpServers;

  /** `~/.claude.json` with a top-level (user) map and this workspace's map. */
  const writeClaudeJson = (maps: {
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  }): void => {
    fs.writeFileSync(
      path.join(tmp, '.claude.json'),
      JSON.stringify({
        ...(maps.user === undefined ? {} : { mcpServers: maps.user }),
        projects: { [tmp]: { mcpServers: maps.project ?? {} } },
      }),
      'utf-8',
    );
  };

  const httpServer = { type: 'http', url: 'https://example.test/mcp' };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-install-service-'));
    intents = new McpIntentStore(path.join(tmp, '.ptah', 'mcp-installed.json'));
    reconcileCalls = 0;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('listInstalled', () => {
    it('marks a harness-config key Ptah never recorded as removable only by force', () => {
      writeMcpJson({ handwritten: { command: 'node', args: ['s.js'] } });

      return service()
        .listInstalled(tmp)
        .then((rows) => {
          const row = rows.find((r) => r.serverKey === 'handwritten');
          expect(row).toBeDefined();
          expect(row?.origin).toBe('harness-config');
          expect(row?.target).toBe('claude');
          expect(row?.managedByPtah).toBe(false);
          expect(row?.removal).toBe('direct');
        });
    });

    it('marks a recorded key as ptah-managed', async () => {
      writeMcpJson({ owned: { command: 'node' } });
      intents.record('owned', 'io.github.x/owned', ['claude'], {
        type: 'stdio',
        command: 'node',
      });

      const rows = await service().listInstalled(tmp);
      const row = rows.find(
        (r) => r.serverKey === 'owned' && r.target === 'claude',
      );
      expect(row?.managedByPtah).toBe(true);
      expect(row?.removal).toBe('ptah-managed');
    });

    it('includes read-only ~/.claude.json rows with a reason naming the CLI command', async () => {
      fs.writeFileSync(
        path.join(tmp, '.claude.json'),
        JSON.stringify({
          projects: {
            [tmp]: {
              mcpServers: {
                sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
              },
            },
          },
        }),
        'utf-8',
      );

      const rows = await service().listInstalled(tmp);
      const row = rows.find((r) => r.origin === 'claude-user');
      expect(row?.serverKey).toBe('sentry');
      expect(row?.target).toBeUndefined();
      expect(row?.removal).toBe('none');
      expect(row?.removalBlockedReason).toContain('.claude.json');
      expect(row?.removalBlockedReason).toContain('claude mcp remove sentry');
      expect(row?.config).toEqual({
        type: 'http',
        url: 'https://mcp.sentry.dev/mcp',
      });
    });

    describe('removalFixCommand on ~/.claude.json rows', () => {
      const claudeRow = async (serverKey: string) =>
        (await service().listInstalled(tmp)).find(
          (r) => r.origin === 'claude-user' && r.serverKey === serverKey,
        );

      it('gives a project-scope row the bare command, and leaves the prose as it was', async () => {
        writeClaudeJson({ project: { sentry: httpServer } });

        const row = await claudeRow('sentry');
        expect(row?.removalFixCommand).toBe('claude mcp remove sentry');
        expect(row?.removalBlockedReason).toBe(
          `"sentry" is declared in ${path.join(tmp, '.claude.json')}, ` +
            'which belongs to the Claude CLI — Ptah reads it and never ' +
            'writes it. Remove it with `claude mcp remove sentry`.',
        );
      });

      it('adds --scope user for a user-scope row, exactly as the prose does', async () => {
        writeClaudeJson({ user: { github: httpServer } });

        const row = await claudeRow('github');
        expect(row?.removalFixCommand).toBe(
          'claude mcp remove github --scope user',
        );
        expect(row?.removalBlockedReason).toContain(
          '`claude mcp remove github --scope user`',
        );
      });

      it.each([
        'oauth-mcp.sentry',
        'smithery_owner_server',
        'node_repl',
        'io.github/user:server',
      ])('passes the plain key %j bare', async (serverKey) => {
        writeClaudeJson({ project: { [serverKey]: httpServer } });

        expect((await claudeRow(serverKey))?.removalFixCommand).toBe(
          `claude mcp remove ${serverKey}`,
        );
      });

      it.each([
        ['whitespace', 'my server'],
        ['a command separator', 'a;rm -rf ~'],
        ['a pipe and redirect', 'a|b>c'],
        ['an ampersand', 'a&b'],
        ['a glob', 'serv*'],
        ['a comment marker', 'a#b'],
        ['a leading tilde', '~home'],
        ['a PowerShell array comma', 'a,b'],
        ['a PowerShell splat', '@scope/server'],
        ['parentheses', 'fn(x)'],
        ['a single quote', "o'brien"],
        ['non-ASCII text', 'café'],
      ])('double-quotes a key with %s', async (_label, serverKey) => {
        writeClaudeJson({ user: { [serverKey]: httpServer } });

        expect((await claudeRow(serverKey))?.removalFixCommand).toBe(
          `claude mcp remove "${serverKey}" --scope user`,
        );
      });

      it.each([
        ['a double quote', 'say"hi"'],
        ['a newline', 'line\nbreak'],
        ['a carriage return', 'line\rbreak'],
        ['a tab', 'tab\there'],
        ['an escape character', 'esc\u001bseq'],
        ['a C1 control', 'c1\u0085next'],
        ['a Unicode line separator', 'ls next'],
        ['a dollar expansion', '$HOME'],
        ['a backtick', 'back`tick'],
        ['a backslash', 'a\\b'],
        ['a history bang', 'bang!'],
        ['a cmd percent', '%PATH%'],
        ['a leading dash, read as an option', '-rf'],
      ])('omits the command for a key with %s', async (_label, serverKey) => {
        writeClaudeJson({ project: { [serverKey]: httpServer } });

        const row = await claudeRow(serverKey);
        expect(row).toBeDefined();
        expect(row).not.toHaveProperty('removalFixCommand');
        // The reason still explains where the entry lives and what removes it.
        expect(row?.removal).toBe('none');
        expect(row?.removalBlockedReason).toContain('.claude.json');
      });

      it('gives no command to rows that have a local removal path', async () => {
        writeMcpJson({ handwritten: { command: 'node' } });
        const rows = await service({
          smithery: {
            filePath: path.join(tmp, '.ptah', 'smithery-installed.json'),
            list: () => [
              {
                source: 'smithery',
                qualifiedName: '@owner/server',
                serverKey: 'smithery_owner_server',
                namespace: 'ns',
                connectionId: 'owner-server',
                hasEncryptedConfig: true,
                installedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
          oauth: {
            filePath: path.join(tmp, '.ptah', 'mcp-oauth-installed.json'),
            list: () => [
              {
                serverKey: 'oauth-mcp.sentry',
                name: 'Sentry',
                serverUrl: 'https://mcp.sentry.dev/mcp',
                connectedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        }).listInstalled(tmp);

        const origins = new Set(rows.map((r) => r.origin));
        expect(origins).toEqual(
          new Set(['harness-config', 'smithery', 'oauth']),
        );
        for (const row of rows) {
          expect(row).not.toHaveProperty('removalFixCommand');
        }
      });
    });

    it('includes Smithery and OAuth records, with no harness target and no secrets', async () => {
      const smitheryPath = path.join(tmp, '.ptah', 'smithery-installed.json');
      const oauthPath = path.join(tmp, '.ptah', 'mcp-oauth-installed.json');

      const rows = await service({
        smithery: {
          filePath: smitheryPath,
          list: () => [
            {
              source: 'smithery',
              qualifiedName: '@owner/server',
              serverKey: 'smithery_owner_server',
              namespace: 'ns',
              connectionId: 'owner-server',
              hasEncryptedConfig: true,
              installedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        oauth: {
          filePath: oauthPath,
          list: () => [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: 'https://mcp.sentry.dev/mcp',
              connectedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }).listInstalled(tmp);

      const smithery = rows.find((r) => r.origin === 'smithery');
      expect(smithery?.removal).toBe('smithery');
      expect(smithery?.target).toBeUndefined();
      expect(smithery?.configPath).toBe(smitheryPath);
      expect(JSON.stringify(smithery?.config)).not.toContain('api_key');

      const oauth = rows.find((r) => r.origin === 'oauth');
      expect(oauth?.removal).toBe('oauth');
      expect(oauth?.configPath).toBe(oauthPath);
      expect(oauth?.config).toEqual({
        type: 'http',
        url: 'https://mcp.sentry.dev/mcp',
      });
    });

    it('keeps one row per config file for a key that lives in several', async () => {
      writeMcpJson({ shared: { command: 'a' } });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, '.cursor', 'mcp.json'),
        JSON.stringify({ mcpServers: { shared: { command: 'a' } } }),
        'utf-8',
      );

      const rows = (await service().listInstalled(tmp)).filter(
        (r) => r.serverKey === 'shared',
      );
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.target))).toEqual(
        new Set(['claude', 'cursor']),
      );
    });
  });

  describe('listDeclarations (the one inventory, TASK_2026_560 C4)', () => {
    it('classifies every row by scope: repository files are workspace, user files global', async () => {
      writeMcpJson({ repo: { command: 'node' } });
      writeClaudeJson({
        user: { mine: httpServer },
        project: { local: httpServer },
      });
      fs.mkdirSync(path.join(tmp, '.codex'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, '.codex', 'config.toml'),
        '[mcp_servers.cx]\ncommand = "node"\n',
        'utf-8',
      );

      const { declarations, sourceStatus } =
        await service().listDeclarations(tmp);

      const scopeOf = (key: string, origin: string) =>
        declarations.find((r) => r.serverKey === key && r.origin === origin)
          ?.scope;
      expect(scopeOf('repo', 'harness-config')).toBe('workspace');
      expect(scopeOf('cx', 'harness-config')).toBe('global');
      // Both `~/.claude.json` maps are per-user files (the existing
      // `entry.scope` still drives the removal command).
      expect(scopeOf('mine', 'claude-user')).toBe('global');
      expect(scopeOf('local', 'claude-user')).toBe('global');
      expect(sourceStatus.find((s) => s.target === 'claude')?.status).toBe(
        'ok',
      );
    });

    it('reports an unreadable config file as error instead of "declares nothing"', async () => {
      fs.writeFileSync(path.join(tmp, '.mcp.json'), '{ not json', 'utf-8');
      writeClaudeJson({ user: { mine: httpServer } });

      const { declarations, sourceStatus } =
        await service().listDeclarations(tmp);

      const claude = sourceStatus.find((s) => s.target === 'claude');
      expect(claude).toMatchObject({
        status: 'error',
        path: path.join(tmp, '.mcp.json'),
      });
      expect(claude?.error).toBeTruthy();
      // The other sources still answer.
      expect(declarations.map((r) => r.serverKey)).toContain('mine');
    });

    it('marks an absent file missing, and lists no file for an unresolvable scope', async () => {
      const withRoot = await service().listDeclarations(tmp);
      expect(
        withRoot.sourceStatus.find((s) => s.target === 'claude')?.status,
      ).toBe('missing');

      const noRoot = await service().listDeclarations();
      expect(noRoot.sourceStatus.some((s) => s.target === 'claude')).toBe(
        false,
      );
    });

    it('feeds listInstalled, which carries the scope on every row', async () => {
      writeMcpJson({ repo: { command: 'node' } });
      writeClaudeJson({ user: { mine: httpServer } });

      const rows = await service().listInstalled(tmp);
      expect(rows.find((r) => r.serverKey === 'repo')?.scope).toBe('workspace');
      expect(rows.find((r) => r.serverKey === 'mine')?.scope).toBe('global');
    });
  });

  describe('uninstall', () => {
    it('reports a refusal, not a success, when the reconciler left a user key alone', async () => {
      writeMcpJson({ handwritten: { command: 'node' } });

      const results = await service().uninstall('handwritten', ['claude'], tmp);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('handwritten');
      expect(results[0].error).toContain('user-owned');
      // The reconciler is correct to leave it: the entry is still there.
      expect(readMcpJson()).toHaveProperty('handwritten');
    });

    it('force removes an unowned key through the facet, without a reconcile', async () => {
      writeMcpJson({
        handwritten: { command: 'node' },
        untouched: { command: 'other' },
      });

      const results = await service().uninstall(
        'handwritten',
        ['claude'],
        tmp,
        {
          force: true,
        },
      );

      expect(results[0]).toMatchObject({ target: 'claude', success: true });
      expect(reconcileCalls).toBe(0);
      const after = readMcpJson();
      expect(after).not.toHaveProperty('handwritten');
      // The facet edits one key and leaves every other byte alone.
      expect(after).toHaveProperty('untouched');
    });

    it('force on a key Ptah DOES own still goes through the reconciler', async () => {
      writeMcpJson({ other: { command: 'x' } });
      intents.record('owned', 'io.github.x/owned', ['claude'], {
        type: 'stdio',
        command: 'node',
      });

      const results = await service().uninstall('owned', ['claude'], tmp, {
        force: true,
      });

      expect(reconcileCalls).toBe(1);
      expect(results[0].success).toBe(true);
      expect(intents.has('owned')).toBe(false);
    });

    it('reports a target whose config path cannot be resolved on the force path', async () => {
      // No workspace root, so every workspace-scoped facet resolves nothing.
      const results = await service().uninstall('handwritten', ['claude'], '', {
        force: true,
      });
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('claude');
    });
  });
});
