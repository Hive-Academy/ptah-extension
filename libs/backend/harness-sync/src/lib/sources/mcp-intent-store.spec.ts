/**
 * Source-under-test: `McpIntentStore` v2 (TASK_2026_853, D-1).
 *
 * Every case uses a temp store path and temp workspace roots carrying a `.git`
 * marker, so the canonical-root walk stops inside the temp tree and nothing
 * reaches the developer's real `~/.ptah`.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { McpServerConfig } from '@ptah-extension/shared';
import {
  MCP_INTENT_VERSION,
  McpIntentScopeError,
  McpIntentStore,
  mcpIntentWorkspaceKey,
} from './mcp-intent-store';

const stdio: McpServerConfig = { type: 'stdio', command: 'node' };
const http: McpServerConfig = { type: 'http', url: 'https://example.test' };

describe('McpIntentStore (v2)', () => {
  let tmp: string;
  let storePath: string;
  let wsA: string;
  let wsB: string;
  let warnings: string[];
  let store: McpIntentStore;

  const workspace = (name: string): string => {
    const root = join(tmp, name);
    mkdirSync(join(root, '.git'), { recursive: true });
    return root;
  };

  const readRaw = (): Record<string, unknown> =>
    JSON.parse(readFileSync(storePath, 'utf-8'));

  const writeRaw = (content: string): void => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, content, 'utf-8');
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-intent-store-'));
    storePath = join(tmp, 'home', '.ptah', 'mcp-installed.json');
    wsA = workspace('a');
    wsB = workspace('b');
    warnings = [];
    store = new McpIntentStore(storePath, (message) => {
      warnings.push(message);
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('round trip', () => {
    it('persists the exact v2 shape for a workspace record', () => {
      store.record({
        serverKey: 'github',
        registryName: 'io.github/github',
        config: stdio,
        targets: ['claude', 'vscode'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });

      const raw = readRaw();
      expect(MCP_INTENT_VERSION).toBe(2);
      expect(raw).toEqual({
        version: 2,
        servers: {
          github: {
            registryName: 'io.github/github',
            config: stdio,
            installedAt: expect.any(String),
            workspaces: {
              [mcpIntentWorkspaceKey(wsA)]: {
                root: wsA,
                targets: ['claude', 'vscode'],
              },
            },
          },
        },
        retired: {},
      });
      expect(new McpIntentStore(storePath).listFor(wsA)).toEqual([
        {
          serverKey: 'github',
          registryName: 'io.github/github',
          config: stdio,
          targets: ['claude', 'vscode'],
        },
      ]);
    });

    it('persists a global record under `global`', () => {
      store.record({
        serverKey: 'fetch',
        registryName: 'r/fetch',
        config: http,
        targets: ['codex'],
        scope: 'global',
      });

      const servers = readRaw()['servers'] as Record<string, unknown>;
      expect(servers['fetch']).toEqual({
        registryName: 'r/fetch',
        config: http,
        installedAt: expect.any(String),
        global: { targets: ['codex'] },
      });
    });

    it('writes atomically, leaving no temp file behind', () => {
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'global',
      });
      expect(readdirSync(dirname(storePath))).toEqual(['mcp-installed.json']);
    });
  });

  describe('canonical workspace key', () => {
    it('records a sub-directory cwd under its workspace root', () => {
      const nested = join(wsA, 'packages', 'app');
      mkdirSync(nested, { recursive: true });
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: nested,
      });

      expect(store.listFor(wsA).map((i) => i.serverKey)).toEqual(['k']);
      expect(store.scopeOf('k', wsA)).toBe('workspace');
      const servers = readRaw()['servers'] as Record<
        string,
        { workspaces: Record<string, { root: string }> }
      >;
      expect(Object.values(servers['k'].workspaces)).toEqual([
        { root: wsA, targets: ['claude'] },
      ]);
    });
  });

  describe('workspace isolation', () => {
    it('keeps an install in A out of B', () => {
      store.record({
        serverKey: 'only-a',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });

      expect(store.listFor(wsA).map((i) => i.serverKey)).toEqual(['only-a']);
      expect(store.listFor(wsB)).toEqual([]);
      expect(store.listFor('')).toEqual([]);
      expect(store.scopeOf('only-a', wsB)).toBeUndefined();
    });

    it('gives a global install to every workspace', () => {
      store.record({
        serverKey: 'everywhere',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'global',
      });

      expect(store.listFor(wsA).map((i) => i.serverKey)).toEqual([
        'everywhere',
      ]);
      expect(store.listFor(wsB).map((i) => i.serverKey)).toEqual([
        'everywhere',
      ]);
      expect(store.scopeOf('everywhere', wsB)).toBe('global');
    });
  });

  describe('merge rules', () => {
    it('merges targets within one scope instead of replacing them', () => {
      for (const target of ['claude', 'cursor', 'claude'] as const) {
        store.record({
          serverKey: 'k',
          registryName: 'r',
          config: stdio,
          targets: [target],
          scope: 'workspace',
          workspaceRoot: wsA,
        });
      }
      expect(store.targetsIn('k', 'workspace', wsA)).toEqual([
        'claude',
        'cursor',
      ]);
    });

    it('lists global ∪ this workspace, keeping scopes separate on disk', () => {
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['codex'],
        scope: 'global',
      });
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude', 'codex'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });

      expect(store.listFor(wsA)[0].targets).toEqual(['codex', 'claude']);
      expect(store.listFor(wsB)[0].targets).toEqual(['codex']);
      expect(store.targetsIn('k', 'global')).toEqual(['codex']);
      expect(store.scopeOf('k', wsA)).toBe('global');
    });
  });

  describe('workspace root is required', () => {
    it.each([undefined, '', '   '])(
      'refuses a workspace record with root %j and writes nothing',
      (workspaceRoot) => {
        expect(() =>
          store.record({
            serverKey: 'k',
            registryName: 'r',
            config: stdio,
            targets: ['claude'],
            scope: 'workspace',
            workspaceRoot,
          }),
        ).toThrow(McpIntentScopeError);
        expect(existsSync(storePath)).toBe(false);
      },
    );

    it('carries a typed code', () => {
      try {
        store.forget('k', { scope: 'workspace' });
        throw new Error('expected a throw');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(McpIntentScopeError);
        expect((error as McpIntentScopeError).code).toBe(
          'workspace-root-required',
        );
      }
    });
  });

  describe('forget', () => {
    beforeEach(() => {
      for (const root of [wsA, wsB]) {
        store.record({
          serverKey: 'k',
          registryName: 'r',
          config: stdio,
          targets: ['claude', 'cursor'],
          scope: 'workspace',
          workspaceRoot: root,
        });
      }
    });

    it('drops named targets from one workspace only', () => {
      store.forget('k', {
        scope: 'workspace',
        workspaceRoot: wsA,
        targets: ['claude'],
      });
      expect(store.targetsIn('k', 'workspace', wsA)).toEqual(['cursor']);
      expect(store.targetsIn('k', 'workspace', wsB)).toEqual([
        'claude',
        'cursor',
      ]);
    });

    it('deletes the server once no record remains', () => {
      store.forget('k', { scope: 'workspace', workspaceRoot: wsA });
      expect(store.has('k')).toBe(true);
      store.forget('k', { scope: 'workspace', workspaceRoot: wsB });
      expect(store.has('k')).toBe(false);
      expect(readRaw()['servers']).toEqual({});
    });

    it('leaves workspace records alone when forgetting global', () => {
      store.forget('k', { scope: 'global' });
      expect(store.listFor(wsA)[0].targets).toEqual(['claude', 'cursor']);
    });
  });

  describe('makeGlobal', () => {
    it('folds the workspace record into global with the opt-in home targets', () => {
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });

      expect(store.makeGlobal('k', wsA, ['codex'])).toEqual([
        'claude',
        'codex',
      ]);
      expect(store.scopeOf('k', wsA)).toBe('global');
      expect(store.targetsIn('k', 'workspace', wsA)).toEqual([]);
      expect(store.listFor(wsB)[0].targets).toEqual(['claude', 'codex']);
    });

    it('adds no home target unless asked', () => {
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });
      expect(store.makeGlobal('k', wsA, [])).toEqual(['claude']);
    });

    it('refuses a server this workspace never recorded, writing nothing', () => {
      store.record({
        serverKey: 'k',
        registryName: 'r',
        config: stdio,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });
      const before = readFileSync(storePath, 'utf-8');

      expect(() => store.makeGlobal('k', wsB, [])).toThrow(
        expect.objectContaining({ code: 'not-recorded' }),
      );
      expect(() => store.makeGlobal('missing', wsA, [])).toThrow(
        McpIntentScopeError,
      );
      expect(() => store.makeGlobal('k', '', [])).toThrow(
        expect.objectContaining({ code: 'workspace-root-required' }),
      );
      expect(readFileSync(storePath, 'utf-8')).toBe(before);
    });
  });

  describe('v1 retirement', () => {
    const v1 = {
      version: 1,
      servers: {
        old: {
          registryName: 'io.github/old',
          targets: ['claude', 'codex'],
          installedAt: '2026-01-01T00:00:00.000Z',
          config: stdio,
        },
      },
    };

    it('maps every v1 server into retired and none into an active scope', () => {
      writeRaw(JSON.stringify(v1));

      expect(store.listFor(wsA)).toEqual([]);
      expect(store.scopeOf('old', wsA)).toBeUndefined();
      expect(store.has('old')).toBe(true);
      expect(store.listRetired()).toEqual([
        {
          serverKey: 'old',
          registryName: 'io.github/old',
          config: stdio,
          targets: ['claude', 'codex'],
          retiredAt: expect.any(String),
        },
      ]);
    });

    it('persists v2 with the retired entries on the first write', () => {
      writeRaw(JSON.stringify(v1));
      store.record({
        serverKey: 'new',
        registryName: 'r',
        config: http,
        targets: ['claude'],
        scope: 'workspace',
        workspaceRoot: wsA,
      });

      const raw = readRaw();
      expect(raw['version']).toBe(2);
      expect(Object.keys(raw['servers'] as object)).toEqual(['new']);
      expect(raw['retired']).toEqual({
        old: {
          registryName: 'io.github/old',
          targets: ['claude', 'codex'],
          config: stdio,
          retiredAt: expect.any(String),
        },
      });
    });
  });

  describe('unreadable files never widen to global', () => {
    it.each([
      ['corrupt JSON', '{not json'],
      ['an unknown version', JSON.stringify({ version: 3, servers: {} })],
      [
        'a v2 workspace record with no root',
        JSON.stringify({
          version: 2,
          servers: {
            k: {
              registryName: 'r',
              config: stdio,
              installedAt: 'x',
              workspaces: { w: { targets: ['claude'] } },
            },
          },
          retired: {},
        }),
      ],
    ])('reads %s as empty and warns', (_label, content) => {
      writeRaw(content);

      expect(store.listFor(wsA)).toEqual([]);
      expect(store.listFor('')).toEqual([]);
      expect(store.listRetired()).toEqual([]);
      expect(store.has('k')).toBe(false);
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('reads a missing file as empty without a warning', () => {
      expect(store.listFor(wsA)).toEqual([]);
      expect(warnings).toEqual([]);
    });
  });
});
