import * as crypto from 'node:crypto';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  McpCallerTokenRegistry,
  type McpCredentialLogger,
} from './mcp-caller-token-registry';
import { isToolPermitted } from '../mcp-core/mcp-caller-policy';

const STORE_KEY = 'ptah.mcp.callerCredentialHashes';

class MemoryState implements IStateStorage {
  private readonly entries = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (!this.entries.has(key)) return defaultValue;
    const value: unknown = this.entries.get(key);
    if (value === undefined) return defaultValue;
    return value as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.entries.keys()];
  }

  read(key: string): unknown {
    return this.entries.get(key);
  }
}

class FailingWriteState extends MemoryState {
  failNextUpdate = false;

  override async update(key: string, value: unknown): Promise<void> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('state write failed');
    }
    await super.update(key, value);
  }
}

function logger(): McpCredentialLogger & { readonly warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    debug(): void {
      return undefined;
    },
    info(): void {
      return undefined;
    },
    warn(message: string): void {
      warnings.push(message);
    },
    error(): void {
      return undefined;
    },
  };
}

function hashOf(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('base64');
}

describe('McpCallerTokenRegistry', () => {
  it('stores a hash, not the raw token, and authorizes by digest', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const token = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dumped = JSON.stringify(state.read(STORE_KEY));
    expect(dumped).not.toContain(token);
    expect(dumped).toContain(hashOf(token));

    const ok = registry.authorize({
      token,
      workspaceRoot: '/ws',
    });
    expect(ok).toMatchObject({ ok: true, legacy: false });

    const unknown = registry.authorize({
      token: 'c'.repeat(43),
      workspaceRoot: '/ws',
    });
    expect(unknown).toMatchObject({
      ok: false,
      failure: { httpStatus: 401, message: 'Authentication required' },
    });
  });

  it('rejects an expired lane token and a revoked subject', () => {
    const registry = new McpCallerTokenRegistry({
      logger: logger(),
      now: () => 5_000,
    });
    const expired = registry.issue(
      { kind: 'agent', agentId: 'lane-a', capability: 'privileged' },
      'lane-a',
      -1,
    );
    expect(
      registry.authorize({ token: expired, agentId: 'lane-a' }),
    ).toMatchObject({ ok: false, failure: { httpStatus: 401 } });

    const live = registry.issue(
      { kind: 'agent', agentId: 'lane-b', capability: 'privileged' },
      'lane-b',
      1_000,
    );
    expect(registry.authorize({ token: live, agentId: 'lane-b' }).ok).toBe(
      true,
    );
    registry.revokeSubject('lane-b');
    expect(registry.authorize({ token: live, agentId: 'lane-b' })).toMatchObject(
      { ok: false, failure: { httpStatus: 401 } },
    );
  });

  it('returns 403 when a valid token is presented on another identity', () => {
    const registry = new McpCallerTokenRegistry({ logger: logger() });
    const token = registry.issue(
      {
        kind: 'workspace',
        workspaceRoot: '/ws-a',
        capability: 'read-only',
      },
      'query-1',
      1_000,
    );
    expect(
      registry.authorize({ token, workspaceRoot: '/ws-b' }),
    ).toMatchObject({
      ok: false,
      failure: {
        httpStatus: 403,
        message: 'Caller is not allowed to use this resource',
      },
    });
    expect(registry.authorize({ token, workspaceRoot: '/ws-a' }).ok).toBe(true);
  });

  it('never stores a privileged persistent binding while the setting is read-only', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    await registry.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    const home = await registry.reconcilePersistent({
      configPath: '/home/codex.toml',
      kind: 'home',
      setting: 'full',
    });
    const dumped = JSON.stringify(state.read(STORE_KEY));
    expect(dumped).not.toContain('"capability":"privileged"');
    expect(dumped).toContain('"kind":"home"');
    expect(dumped).toContain('"capability":"read-only"');
    expect(registry.authorize({ token: home.token })).toMatchObject({
      ok: true,
      binding: { kind: 'home', capability: 'read-only' },
    });
  });

  it('keeps the same hash when the setting changes and when the file token matches', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const token = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    const first = await registry.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'full',
      fileToken: token,
    });
    expect(first.preserveFile).toBe(true);
    const afterFull = JSON.stringify(state.read(STORE_KEY));
    expect(afterFull).toContain(hashOf(token));
    expect(afterFull).toContain('"capability":"privileged"');
    expect(afterFull).not.toContain(token);

    const reloaded = new McpCallerTokenRegistry({
      state,
      logger: logger(),
      externalCallerAccess: 'full',
    });
    const second = await reloaded.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'full',
      fileToken: token,
    });
    expect(second.preserveFile).toBe(true);
    expect(JSON.stringify(state.read(STORE_KEY))).toBe(afterFull);
    expect(
      reloaded.authorize({ token, workspaceRoot: '/ws' }),
    ).toMatchObject({
      ok: true,
      binding: { capability: 'privileged', kind: 'workspace' },
    });
  });

  it('updates the same live token on downgrade and upgrade without restart', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const token = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'full',
    });
    const before = registry.authorize({ token, workspaceRoot: '/ws' });
    expect(before).toMatchObject({
      ok: true,
      binding: { capability: 'privileged' },
    });
    if (before.ok) {
      expect(isToolPermitted('execute_code', before.binding.capability)).toBe(
        true,
      );
    }

    await registry.applyExternalCallerAccess('read-only');

    const downgraded = registry.authorize({ token, workspaceRoot: '/ws' });
    expect(downgraded).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });
    if (downgraded.ok) {
      expect(
        isToolPermitted('execute_code', downgraded.binding.capability),
      ).toBe(false);
    }

    await registry.applyExternalCallerAccess('full');

    expect(registry.authorize({ token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'privileged' },
    });
    expect(JSON.stringify(state.read(STORE_KEY))).toContain(hashOf(token));
    expect(JSON.stringify(state.read(STORE_KEY))).not.toContain(token);
  });

  it('clamps every live persistent token when a downgrade state write fails', async () => {
    const state = new FailingWriteState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const first = await registry.issuePersistent({
      configPath: '/ws-a/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws-a',
      setting: 'full',
    });
    const second = await registry.issuePersistent({
      configPath: '/ws-b/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws-b',
      setting: 'full',
    });
    const home = await registry.issuePersistent({
      configPath: '/home/codex.toml',
      kind: 'home',
      setting: 'full',
    });

    state.failNextUpdate = true;
    await expect(
      registry.applyExternalCallerAccess('read-only'),
    ).rejects.toThrow('state write failed');

    for (const [token, workspaceRoot] of [
      [first, '/ws-a'],
      [second, '/ws-b'],
    ] as const) {
      const authorized = registry.authorize({ token, workspaceRoot });
      expect(authorized).toMatchObject({
        ok: true,
        binding: { capability: 'read-only' },
      });
      if (authorized.ok) {
        expect(
          isToolPermitted('execute_code', authorized.binding.capability),
        ).toBe(false);
      }
    }
    expect(registry.authorize({ token: home })).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });
  });

  it('keeps live tokens read-only when an upgrade state write fails', async () => {
    const state = new FailingWriteState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const token = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });

    state.failNextUpdate = true;
    await expect(registry.applyExternalCallerAccess('full')).rejects.toThrow(
      'state write failed',
    );

    expect(registry.authorize({ token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });
  });

  it('replaces an unknown file token and preserves the replacement on the next pass', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const unknown = 'd'.repeat(43);
    const replacement = await registry.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
      fileToken: unknown,
    });
    const first = JSON.stringify(state.read(STORE_KEY));
    expect(first).not.toContain(hashOf(unknown));
    expect(first).not.toContain(unknown);
    expect(first).toContain(hashOf(replacement.token));
    expect(replacement.preserveFile).toBe(false);
    const repeated = await registry.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
      fileToken: replacement.token,
    });
    expect(repeated).toEqual({ preserveFile: true, token: replacement.token });
    expect(JSON.stringify(state.read(STORE_KEY))).toBe(first);
    expect(
      registry.authorize({ token: unknown, workspaceRoot: '/ws' }).ok,
    ).toBe(false);
    expect(registry.authorize({ token: replacement.token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });
  });

  it('does not write a lane token into state', () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const token = registry.issue(
      { kind: 'session', sessionId: 'tab-1', capability: 'privileged' },
      'tab-1',
      1_000,
    );
    expect(state.read(STORE_KEY)).toBeUndefined();
    expect(token).not.toHaveLength(0);
    registry.revokeEphemeral();
    expect(registry.authorize({ token, sessionId: 'tab-1' }).ok).toBe(false);
  });

  it('warns once for an unmapped legacy caller and notices once', () => {
    const warnings = logger();
    const notices: string[] = [];
    const registry = new McpCallerTokenRegistry({
      logger: warnings,
      notice: {
        showInformationMessage(message: string): Promise<string | undefined> {
          notices.push(message);
          return Promise.resolve(undefined);
        },
      },
    });
    registry.authorize({ workspaceRoot: '/ws' });
    registry.authorize({ workspaceRoot: '/ws' });
    registry.authorize({});
    expect(warnings.warnings).toHaveLength(1);
    expect(warnings.warnings[0]).toContain('unmapped');
    expect(warnings.warnings.join('\n')).not.toContain('http://');
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toMatch(/[/\\]/);
    const legacy = registry.authorize({ agentId: 'lane-a' });
    expect(legacy).toMatchObject({
      ok: true,
      legacy: true,
      binding: { capability: 'read-only', kind: 'agent', agentId: 'lane-a' },
    });
  });

  it('warns once for each stored slot that matches the legacy workspace', async () => {
    const state = new MemoryState();
    const warnings = logger();
    const registry = new McpCallerTokenRegistry({ state, logger: warnings });
    await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    await registry.issuePersistent({
      configPath: '/ws/.cursor/mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    registry.authorize({ workspaceRoot: '/ws' });
    registry.authorize({ workspaceRoot: '/ws' });
    expect(warnings.warnings).toHaveLength(2);
    expect(warnings.warnings.join('\n')).toContain('/ws/.mcp.json');
    expect(warnings.warnings.join('\n')).toContain('/ws/.cursor/mcp.json');
  });

  it('fails closed on a downgrade write failure and after a restart', async () => {
    const state = new FailingWriteState();
    const warnings = logger();
    const registry = new McpCallerTokenRegistry({ state, logger: warnings });
    const token = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'full',
    });
    expect(registry.authorize({ token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'privileged' },
    });

    state.failNextUpdate = true;
    await expect(
      registry.reconcilePersistent({
        configPath: '/ws/.mcp.json',
        kind: 'workspace',
        workspaceRoot: '/ws',
        setting: 'read-only',
        fileToken: token,
      }),
    ).rejects.toThrow('state write failed');
    expect(registry.authorize({ token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });

    // The state still contains the old privileged record. A restart must clamp
    // it to the current read-only setting rather than trust that stale value.
    const restarted = new McpCallerTokenRegistry({ state, logger: warnings });
    expect(restarted.authorize({ token, workspaceRoot: '/ws' })).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });
    expect(warnings.warnings.join('\n')).toContain('state write failed');
  });

  it('keeps a staged file token authorized when its state commit fails', async () => {
    const state = new FailingWriteState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger() });
    const previousToken = await registry.issuePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
    });
    const prepared = await registry.preparePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
      fileToken: 'm'.repeat(43),
    });

    state.failNextUpdate = true;
    await expect(prepared.commit()).rejects.toThrow('state write failed');
    const restartedBeforeRetry = new McpCallerTokenRegistry({
      state, logger: logger(), externalCallerAccess: 'read-only',
    });
    expect(restartedBeforeRetry.authorize({
      token: prepared.token, workspaceRoot: '/ws',
    })).toMatchObject({ ok: true, binding: { capability: 'read-only' } });
    expect(
      registry.authorize({ token: prepared.token, workspaceRoot: '/ws' }),
    ).toMatchObject({
      ok: true,
      binding: { capability: 'read-only' },
    });

    const retry = await registry.reconcilePersistent({
      configPath: '/ws/.mcp.json',
      kind: 'workspace',
      workspaceRoot: '/ws',
      setting: 'read-only',
      fileToken: prepared.token,
    });
    expect(retry).toEqual({ preserveFile: true, token: prepared.token });
    expect(
      registry.authorize({ token: prepared.token, workspaceRoot: '/ws' }).ok,
    ).toBe(true);
    expect(
      registry.authorize({ token: previousToken, workspaceRoot: '/ws' }),
    ).toMatchObject({ ok: false, failure: { httpStatus: 401 } });
    const stored = JSON.stringify(state.read(STORE_KEY));
    expect(stored).toContain(hashOf(prepared.token));
    expect(stored).not.toContain(hashOf(previousToken));
  });

  it('keeps a published token read-only when registration and a failed reconcile overlap a downgrade', async () => {
    const state = new FailingWriteState();
    const registry = new McpCallerTokenRegistry({
      state, logger: logger(), externalCallerAccess: 'full',
    });
    const slot = { configPath: '/ws/.mcp.json', kind: 'workspace' as const, workspaceRoot: '/ws', setting: 'full' as const };
    const prepared = await registry.preparePersistent(slot);
    let finishWrite: (() => void) | undefined;
    const writing = new Promise<void>((resolve) => { finishWrite = resolve; });
    let fileToken: string | undefined;
    const registration = (async () => {
      await writing;
      fileToken = prepared.token;
      await prepared.commit();
    })();
    registry.clampExternalCallerAccess('read-only');
    state.failNextUpdate = true;
    await expect(registry.applyExternalCallerAccess('read-only')).rejects.toThrow('state write failed');
    finishWrite?.();
    await registration;
    expect(fileToken).toBe(prepared.token);
    expect(registry.authorize({ token: fileToken, workspaceRoot: '/ws' }))
      .toMatchObject({ ok: true, binding: { capability: 'read-only' } });
    const restarted = new McpCallerTokenRegistry({ state, logger: logger(), externalCallerAccess: 'read-only' });
    expect(restarted.authorize({ token: fileToken, workspaceRoot: '/ws' }))
      .toMatchObject({ ok: true, binding: { capability: 'read-only' } });
  });

  it('lets a downgrade win over an in-flight upgrade', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger(), externalCallerAccess: 'read-only' });
    const token = await registry.issuePersistent({ configPath: '/ws/.mcp.json', kind: 'workspace', workspaceRoot: '/ws', setting: 'read-only' });
    let release: (() => void) | undefined;
    const original = state.update.bind(state);
    state.update = async (key, value) => {
      if (release === undefined) await new Promise<void>((resolve) => { release = resolve; });
      await original(key, value);
    };
    const upgrade = registry.applyExternalCallerAccess('full');
    await Promise.resolve();
    registry.clampExternalCallerAccess('read-only');
    const downgrade = registry.applyExternalCallerAccess('read-only');
    release?.();
    await Promise.all([upgrade, downgrade]);
    expect(registry.authorize({ token, workspaceRoot: '/ws' }))
      .toMatchObject({ ok: true, binding: { capability: 'read-only' } });
    const restarted = new McpCallerTokenRegistry({ state, logger: logger(), externalCallerAccess: 'read-only' });
    expect(restarted.authorize({ token, workspaceRoot: '/ws' }))
      .toMatchObject({ ok: true, binding: { capability: 'read-only' } });
  });

  it('clamps a matching file token when its capability write races a downgrade', async () => {
    const state = new MemoryState();
    const registry = new McpCallerTokenRegistry({ state, logger: logger(), externalCallerAccess: 'read-only' });
    const slot = { configPath: '/ws/.mcp.json', kind: 'workspace' as const, workspaceRoot: '/ws' };
    const token = await registry.issuePersistent({ ...slot, setting: 'read-only' });
    registry.clampExternalCallerAccess('full');
    let release: (() => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const original = state.update.bind(state);
    state.update = async (key, value) => {
      markEntered?.();
      await new Promise<void>((resolve) => { release = resolve; });
      await original(key, value);
    };
    const matching = registry.preparePersistent({ ...slot, setting: 'full', fileToken: token });
    await entered;
    registry.clampExternalCallerAccess('read-only');
    release?.();
    await matching;
    expect(registry.authorize({ token, workspaceRoot: '/ws' }))
      .toMatchObject({ ok: true, binding: { capability: 'read-only' } });
  });
});
