import * as path from 'path';

import { resolveAgentModel } from '@ptah-extension/shared';
import type { IDisposable } from '@ptah-extension/platform-core';

import type { ISettingsStore } from '../ports/settings-store.interface';
import type { IActiveWorkspaceSource } from '../scope/active-workspace-source';
import { WorkspaceScopeResolver } from '../scope/workspace-scope-resolver';
import {
  AGENT_MODEL_SETTINGS_KEY,
  AgentModelSettings,
} from './agent-model-settings';

interface TestStore extends ISettingsStore {
  data: Record<string, unknown>;
  writes: Array<{ key: string; value: unknown }>;
  /** When set, the next writeGlobal rejects with it and stores nothing. */
  failNext?: Error;
}

/**
 * In-memory store that, like the real file store, hands back its cached
 * object from readGlobal and only commits after an async gap, so an unqueued
 * read-modify-write would lose updates.
 */
function makeStore(seed: Record<string, unknown> = {}): TestStore {
  const store: TestStore = {
    data: { ...seed },
    writes: [],
    readGlobal<T>(key: string): T | undefined {
      return store.data[key] as T | undefined;
    },
    async writeGlobal<T>(key: string, value: T): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (store.failNext) {
        const error = store.failNext;
        store.failNext = undefined;
        throw error;
      }
      store.writes.push({ key, value });
      if (value === undefined) {
        delete store.data[key];
        return;
      }
      store.data[key] = value;
    },
    readSecret: () => Promise.resolve(undefined),
    writeSecret: () => Promise.resolve(),
    deleteSecret: () => Promise.resolve(),
    watchGlobal: (): IDisposable => ({ dispose: () => undefined }),
    watchSecret: (): IDisposable => ({ dispose: () => undefined }),
    flushSync: () => undefined,
  };
  return store;
}

function makeSource(activePath: string | undefined): IActiveWorkspaceSource {
  return {
    getActivePath: () => activePath,
    onDidChange: () => ({ dispose: () => undefined }),
  };
}

const WS_A = path.resolve(
  process.platform === 'win32' ? 'C:\\agentModelsA' : '/agentModelsA',
);
const WS_B = path.resolve(
  process.platform === 'win32' ? 'C:\\agentModelsB' : '/agentModelsB',
);

function setup(seed: Record<string, unknown> = {}, active?: string) {
  const store = makeStore(seed);
  const resolver = new WorkspaceScopeResolver(store, makeSource(active));
  const settings = new AgentModelSettings(store, resolver);
  const wsKey = (ws: string) =>
    resolver.inspectForPath(AGENT_MODEL_SETTINGS_KEY, ws).key;
  return { store, resolver, settings, wsKey };
}

describe('AgentModelSettings', () => {
  describe('layersForPath', () => {
    it('returns the raw workspace and machine layers', async () => {
      const { settings, resolver } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: { '*': { codex: 'gpt-5' } },
      });
      await resolver.writeForPath(AGENT_MODEL_SETTINGS_KEY, WS_A, {
        reviewer: { claude: 'opus' },
      });

      expect(settings.layersForPath(WS_A)).toEqual({
        workspace: { reviewer: { claude: 'opus' } },
        machine: { '*': { codex: 'gpt-5' } },
      });
    });

    it('reports no workspace layer for a workspace without its own value', () => {
      const { settings } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: { '*': { codex: 'gpt-5' } },
      });

      expect(settings.layersForPath(WS_A)).toEqual({
        workspace: undefined,
        machine: { '*': { codex: 'gpt-5' } },
      });
    });

    it('reads the requested workspace, not the active one', async () => {
      const { settings } = setup({}, WS_B);
      await settings.update(WS_A, 'reviewer', 'claude', 'opus', 'workspace');

      expect(settings.layersForPath(WS_A).workspace).toEqual({
        reviewer: { claude: 'opus' },
      });
      expect(settings.layersForPath(WS_B).workspace).toBeUndefined();
    });

    it('throws on an empty workspace path', () => {
      const { settings } = setup();
      expect(() => settings.layersForPath('')).toThrow(
        /workspace path is required/,
      );
    });

    it('feeds resolveAgentModel with workspace-over-machine precedence', async () => {
      const { settings } = setup();
      await settings.update(WS_A, '*', 'codex', 'gpt-5', 'machine');
      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace');

      const layers = settings.layersForPath(WS_A);
      expect(resolveAgentModel(layers, 'reviewer', 'codex')).toEqual({
        value: 'o3',
        scope: 'workspace',
        wildcard: false,
      });
      expect(resolveAgentModel(layers, 'other', 'codex')).toEqual({
        value: 'gpt-5',
        scope: 'machine',
        wildcard: true,
      });
    });
  });

  describe('update — target key', () => {
    it('workspace scope writes only the workspace key', async () => {
      const { settings, store, wsKey } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: { '*': { codex: 'gpt-5' } },
      });

      await settings.update(WS_A, 'reviewer', 'claude', 'opus', 'workspace');

      expect(store.writes.map((w) => w.key)).toEqual([wsKey(WS_A)]);
      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        '*': { codex: 'gpt-5' },
      });
      expect(store.data[wsKey(WS_A)]).toEqual({ reviewer: { claude: 'opus' } });
    });

    it('machine scope writes only the global key', async () => {
      const { settings, store, resolver, wsKey } = setup();
      await resolver.writeForPath(AGENT_MODEL_SETTINGS_KEY, WS_A, {
        reviewer: { claude: 'opus' },
      });
      store.writes.length = 0;

      await settings.update(WS_A, 'reviewer', 'claude', 'haiku', 'machine');

      expect(store.writes.map((w) => w.key)).toEqual([
        AGENT_MODEL_SETTINGS_KEY,
      ]);
      expect(store.data[wsKey(WS_A)]).toEqual({ reviewer: { claude: 'opus' } });
      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        reviewer: { claude: 'haiku' },
      });
    });

    it.each([[''], ['   ']])(
      'workspace scope with path %j throws and changes nothing, global key included',
      async (bad) => {
        const seed = {
          [AGENT_MODEL_SETTINGS_KEY]: { '*': { codex: 'gpt-5' } },
        };
        const { settings, store } = setup(seed, WS_A);

        await expect(
          settings.update(bad, 'reviewer', 'codex', 'o3', 'workspace'),
        ).rejects.toThrow(/workspace path is required/);
        expect(store.writes).toHaveLength(0);
        expect(store.data).toEqual(seed);
      },
    );

    it('rejects an empty slug and an unknown provider without writing', async () => {
      const { settings, store } = setup();

      await expect(
        settings.update(WS_A, ' ', 'codex', 'o3', 'workspace'),
      ).rejects.toThrow(/slug is required/);
      await expect(
        settings.update(
          WS_A,
          'reviewer',
          'gemini' as unknown as 'codex',
          'x',
          'workspace',
        ),
      ).rejects.toThrow(/Unknown agent model provider/);
      expect(store.writes).toHaveLength(0);
    });
  });

  describe('update — read-modify-write', () => {
    it('preserves unrelated slugs and providers', async () => {
      const { settings, store, resolver, wsKey } = setup();
      await resolver.writeForPath(AGENT_MODEL_SETTINGS_KEY, WS_A, {
        '*': { codex: 'gpt-5' },
        reviewer: { claude: 'opus', cursor: 'auto' },
        writer: { opencode: 'anthropic/claude-sonnet-4' },
      });

      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace');

      expect(store.data[wsKey(WS_A)]).toEqual({
        '*': { codex: 'gpt-5' },
        reviewer: { claude: 'opus', cursor: 'auto', codex: 'o3' },
        writer: { opencode: 'anthropic/claude-sonnet-4' },
      });
    });

    it('two concurrent updates on different providers of one slug both persist', async () => {
      const { settings, store, wsKey } = setup();

      await Promise.all([
        settings.update(WS_A, 'reviewer', 'claude', 'opus', 'workspace'),
        settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace'),
      ]);

      expect(store.data[wsKey(WS_A)]).toEqual({
        reviewer: { claude: 'opus', codex: 'o3' },
      });
    });

    it('concurrent updates on different slugs and on the machine key all persist', async () => {
      const { settings, store, wsKey } = setup();

      await Promise.all([
        settings.update(WS_A, 'reviewer', 'claude', 'opus', 'workspace'),
        settings.update(WS_A, 'writer', 'cursor', 'auto', 'workspace'),
        settings.update(WS_A, '*', 'codex', 'gpt-5', 'machine'),
        settings.update(WS_A, 'writer', 'claude', 'haiku', 'machine'),
      ]);

      expect(store.data[wsKey(WS_A)]).toEqual({
        reviewer: { claude: 'opus' },
        writer: { cursor: 'auto' },
      });
      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        '*': { codex: 'gpt-5' },
        writer: { claude: 'haiku' },
      });
    });

    it('clearing a leaf keeps siblings, drops an emptied slug, then the key', async () => {
      const { settings, store, wsKey } = setup();
      await settings.update(WS_A, 'reviewer', 'claude', 'opus', 'workspace');
      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace');

      await settings.update(WS_A, 'reviewer', 'claude', null, 'workspace');
      expect(store.data[wsKey(WS_A)]).toEqual({ reviewer: { codex: 'o3' } });

      await settings.update(WS_A, 'reviewer', 'codex', '  ', 'workspace');
      expect(Object.keys(store.data)).not.toContain(wsKey(WS_A));
    });

    it('clearing an absent leaf leaves the stored value as it was', async () => {
      const { settings, store } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: { writer: { codex: 'o3' } },
      });

      await settings.update(WS_A, 'reviewer', 'codex', null, 'machine');

      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        writer: { codex: 'o3' },
      });
    });

    it('replaces a hand-edited non-object value instead of throwing', async () => {
      const { settings, store } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: ['not', 'a', 'map'],
      });

      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'machine');

      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        reviewer: { codex: 'o3' },
      });
    });

    it('stores a `__proto__` slug as an own key without touching prototypes', async () => {
      const { settings, store } = setup();

      await settings.update(WS_A, '__proto__', 'codex', 'o3', 'machine');

      const stored = store.data[AGENT_MODEL_SETTINGS_KEY] as object;
      expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(
        true,
      );
      expect(JSON.parse(JSON.stringify(stored))).toEqual(
        JSON.parse('{"__proto__":{"codex":"o3"}}'),
      );
      expect(({} as Record<string, unknown>)['codex']).toBeUndefined();
    });
  });

  describe('update — isolation and failure', () => {
    it('keeps two workspaces isolated (AC6)', async () => {
      const { settings, wsKey, store } = setup();

      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace');
      await settings.update(WS_B, 'reviewer', 'codex', 'gpt-5', 'workspace');
      await settings.update(WS_A, 'reviewer', 'codex', null, 'workspace');

      expect(Object.keys(store.data)).not.toContain(wsKey(WS_A));
      expect(store.data[wsKey(WS_B)]).toEqual({ reviewer: { codex: 'gpt-5' } });
      expect(
        resolveAgentModel(settings.layersForPath(WS_A), 'reviewer', 'codex'),
      ).toBeUndefined();
    });

    it('a failed write keeps the prior value, unmutated, and the queue keeps working', async () => {
      const prior = { reviewer: { claude: 'opus' }, writer: { codex: 'o3' } };
      const { settings, store } = setup({ [AGENT_MODEL_SETTINGS_KEY]: prior });
      const before = JSON.stringify(prior);
      store.failNext = new Error('disk full');

      const failing = settings.update(
        WS_A,
        'reviewer',
        'claude',
        'haiku',
        'machine',
      );
      const following = settings.update(
        WS_A,
        'writer',
        'cursor',
        'auto',
        'machine',
      );

      await expect(failing).rejects.toThrow('disk full');
      // The store hands back its cached object; it must not have been mutated.
      expect(JSON.stringify(prior)).toBe(before);
      await following;
      expect(store.data[AGENT_MODEL_SETTINGS_KEY]).toEqual({
        reviewer: { claude: 'opus' },
        writer: { codex: 'o3', cursor: 'auto' },
      });
    });

    it('a failed workspace write leaves the workspace and machine keys unchanged', async () => {
      const { settings, store, wsKey } = setup({
        [AGENT_MODEL_SETTINGS_KEY]: { '*': { codex: 'gpt-5' } },
      });
      await settings.update(WS_A, 'reviewer', 'codex', 'o3', 'workspace');
      const before = JSON.stringify(store.data);
      store.failNext = new Error('EACCES');

      await expect(
        settings.update(WS_A, 'reviewer', 'codex', null, 'workspace'),
      ).rejects.toThrow('EACCES');

      expect(JSON.stringify(store.data)).toBe(before);
      expect(store.data[wsKey(WS_A)]).toEqual({ reviewer: { codex: 'o3' } });
    });
  });
});
