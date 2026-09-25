import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import type {
  CapabilityEntry,
  CapabilitiesGetStateResult,
  CapabilityPolicyReason,
} from '@ptah-extension/shared';
import {
  CapabilityTogglesStore,
  optimisticEntry,
} from './capability-toggles.store';

/**
 * CapabilityTogglesStore specs (TASK_2026_560, Task 13.1).
 *
 * Loading is lazy and superseded loads publish nothing; a toggle is optimistic
 * and is reconciled with the persisted entry, or reverted with an error that
 * names the item (AC-1.4); an unverified policy becomes the banner listing
 * each unreadable path; a workspace switch drops the old rows.
 */

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess(): boolean {
      return data !== undefined;
    },
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess(): boolean {
      return false;
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function entry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    kind: 'mcp',
    id: 'github',
    label: 'github',
    sources: [{ scope: 'global', path: '/home/u/.claude.json' }],
    effectiveEnabled: true,
    inheritedFrom: 'default',
    defaultReason: 'user-scope',
    ...overrides,
  };
}

const GITHUB = entry();
const SENTRY = entry({ id: 'sentry', label: 'sentry' });

const BAD_ITEM: CapabilityPolicyReason = {
  path: '/home/u/.ptah/capabilities/global/mcp__github.json',
  error: 'invalid JSON',
};
const BAD_WORKSPACE: CapabilityPolicyReason = {
  path: '/home/u/.ptah/capabilities/workspaces/abc/imported.json',
  error: 'EACCES',
};

function inventory(
  entries: CapabilityEntry[],
  overrides: Partial<CapabilitiesGetStateResult> = {},
): CapabilitiesGetStateResult {
  return { status: 'verified', reasons: [], entries, ...overrides };
}

describe('CapabilityTogglesStore', () => {
  let store: CapabilityTogglesStore;
  let injector: EnvironmentInjector;
  let injectorDestroyed: boolean;
  let calls: { method: string; params: unknown }[];
  let responders: Map<string, (params: unknown) => unknown>;
  /** Raw failure text is expected on the console only. */
  let warn: jest.SpyInstance;

  const setResponder = (
    method: string,
    factory: (params: unknown) => unknown,
  ): void => {
    responders.set(method, factory);
  };

  const callsTo = (method: string) => calls.filter((c) => c.method === method);

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) return Promise.resolve(fail(`No responder for ${method}`));
      try {
        return Promise.resolve(factory(params));
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    }),
  };

  const createStore = (): void => {
    injector = createEnvironmentInjector(
      [CapabilityTogglesStore],
      TestBed.inject(EnvironmentInjector),
    );
    injectorDestroyed = false;
    store = injector.get(CapabilityTogglesStore);
  };

  const destroyStore = (): void => {
    if (injectorDestroyed) return;
    injectorDestroyed = true;
    injector.destroy();
  };

  const createLoadedStore = async (): Promise<void> => {
    createStore();
    await store.ensure();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setResponder('capabilities:getState', () =>
      ok(inventory([GITHUB, SENTRY])),
    );
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => {
    destroyStore();
    warn.mockRestore();
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  describe('loading', () => {
    it('constructs without a single RPC and stays idle', () => {
      createStore();
      TestBed.tick();

      expect(calls).toHaveLength(0);
      expect(store.state()).toBe('idle');
      expect(store.policyBanner()).toBeNull();
    });

    it('ensure reads getState once, and a second ensure is a no-op', async () => {
      await createLoadedStore();
      await store.ensure();

      expect(store.state()).toBe('ready');
      expect(store.entries()).toEqual([GITHUB, SENTRY]);
      expect(store.status()).toBe('verified');
      expect(callsTo('capabilities:getState')).toHaveLength(1);
      expect(callsTo('capabilities:getState')[0].params).toEqual({});
    });

    it('a failed read is the error state', async () => {
      setResponder('capabilities:getState', () => fail('boom'));
      await createLoadedStore();

      expect(store.state()).toBe('error');
      expect(store.loadError()).toBe('Failed to load capability settings');
    });

    it('a thrown read is the error state with the fixed text only', async () => {
      setResponder('capabilities:getState', () => {
        throw new Error('socket closed');
      });
      await createLoadedStore();

      expect(store.state()).toBe('error');
      expect(store.loadError()).toBe('Failed to load capability settings');
    });

    it('a load superseded by a newer one publishes nothing', async () => {
      const slow = deferred<unknown>();
      setResponder('capabilities:getState', () => slow.promise);
      createStore();
      const first = store.ensure();

      setResponder('capabilities:getState', () => ok(inventory([SENTRY])));
      await store.reload();
      slow.resolve(ok(inventory([GITHUB, SENTRY])));
      await first;

      expect(store.entries()).toEqual([SENTRY]);
    });
  });

  // ── Fail-closed banner ─────────────────────────────────────────────────────

  describe('policy banner', () => {
    it('lists every unreadable path while the policy is unverified', async () => {
      setResponder('capabilities:getState', () =>
        ok(
          inventory([{ ...GITHUB, effectiveEnabled: null }], {
            status: 'unverified',
            reasons: [BAD_ITEM, BAD_WORKSPACE],
          }),
        ),
      );
      await createLoadedStore();

      expect(store.policyBanner()).toEqual({
        reasons: [BAD_ITEM, BAD_WORKSPACE],
      });
    });

    it('is null for a verified policy', async () => {
      await createLoadedStore();

      expect(store.policyBanner()).toBeNull();
    });

    it('a write while unverified re-reads the state, so a fixed file clears the banner', async () => {
      setResponder('capabilities:getState', () =>
        ok(
          inventory([{ ...GITHUB, effectiveEnabled: null }], {
            status: 'unverified',
            reasons: [BAD_ITEM],
          }),
        ),
      );
      await createLoadedStore();
      setResponder('capabilities:setEnabled', () =>
        ok({ entry: { ...GITHUB, effectiveEnabled: false } }),
      );
      setResponder('capabilities:getState', () => ok(inventory([GITHUB])));

      await store.setEnabled(GITHUB, 'global', false);
      await settle();

      expect(callsTo('capabilities:getState')).toHaveLength(2);
      expect(store.policyBanner()).toBeNull();
    });
  });

  // ── setEnabled ─────────────────────────────────────────────────────────────

  describe('setEnabled', () => {
    it('flips the row at once, sends the toggle, then shows the persisted entry', async () => {
      await createLoadedStore();
      const pending = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => pending.promise);

      const outcome = store.setEnabled(GITHUB, 'workspace', false);

      expect(store.entryOf(GITHUB)?.effectiveEnabled).toBe(false);
      expect(store.entryOf(GITHUB)?.inheritedFrom).toBe('workspace');
      expect(store.isPending(GITHUB)).toBe(true);
      expect(callsTo('capabilities:setEnabled')[0].params).toEqual({
        scope: 'workspace',
        kind: 'mcp',
        id: 'github',
        enabled: false,
      });

      const persisted = entry({
        effectiveEnabled: false,
        workspaceEnabled: false,
        inheritedFrom: 'workspace',
        globalEnabled: true,
      });
      pending.resolve(ok({ entry: persisted }));

      expect(await outcome).toBe('saved');
      expect(store.entryOf(GITHUB)).toBe(persisted);
      expect(store.isPending(GITHUB)).toBe(false);
      expect(store.actionError()).toBeNull();
      expect(store.entryOf(SENTRY)).toBe(SENTRY);
    });

    it('a failed write reverts the row and names the item, never echoing the backend text (AC-1.4)', async () => {
      await createLoadedStore();
      setResponder('capabilities:setEnabled', () =>
        fail(
          'EACCES writing /home/u/.ptah/capabilities/global/mcp__github.json',
        ),
      );

      const outcome = await store.setEnabled(GITHUB, 'workspace', false);

      expect(outcome).toBe('reverted');
      expect(store.entryOf(GITHUB)).toBe(GITHUB);
      expect(store.errorFor(GITHUB)).toBe(
        "Couldn't turn github off. The change wasn't saved; try again.",
      );
      expect(store.errorFor(GITHUB)).not.toContain('EACCES');
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        'EACCES writing /home/u/.ptah/capabilities/global/mcp__github.json',
      );
      expect(store.errorFor(SENTRY)).toBeNull();
      expect(store.isPending(GITHUB)).toBe(false);
    });

    it('a thrown write reverts with the fixed text naming the item and logs the raw error', async () => {
      const thrown = new Error('transport down');
      await createLoadedStore();
      setResponder('capabilities:setEnabled', () => {
        throw thrown;
      });

      const outcome = await store.setEnabled(SENTRY, 'global', false);

      expect(outcome).toBe('reverted');
      expect(store.entryOf(SENTRY)).toBe(SENTRY);
      expect(store.errorFor(SENTRY)).toBe(
        "Couldn't turn sentry off. The change wasn't saved; try again.",
      );
      expect(warn).toHaveBeenCalledWith(expect.any(String), thrown);
    });

    it('never sends a second write for a row already in flight', async () => {
      await createLoadedStore();
      const pending = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => pending.promise);

      const first = store.setEnabled(GITHUB, 'workspace', false);
      const second = await store.setEnabled(GITHUB, 'workspace', true);

      expect(second).toBe('skipped');
      expect(callsTo('capabilities:setEnabled')).toHaveLength(1);

      pending.resolve(ok({ entry: GITHUB }));
      await first;
    });

    it('skips a row the store does not hold', async () => {
      await createLoadedStore();

      const outcome = await store.setEnabled(
        { kind: 'skill', id: 'missing' },
        'workspace',
        true,
      );

      expect(outcome).toBe('skipped');
      expect(callsTo('capabilities:setEnabled')).toHaveLength(0);
    });

    it('clears the previous error when the next toggle starts', async () => {
      await createLoadedStore();
      setResponder('capabilities:setEnabled', () => fail('denied'));
      await store.setEnabled(GITHUB, 'workspace', false);
      expect(store.actionError()).not.toBeNull();

      setResponder('capabilities:setEnabled', () => ok({ entry: GITHUB }));
      await store.setEnabled(GITHUB, 'workspace', true);

      expect(store.actionError()).toBeNull();
    });

    it('does not overwrite a fresher row that a reload brought in meanwhile', async () => {
      await createLoadedStore();
      const pending = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => pending.promise);
      const reloaded = entry({ label: 'github (reloaded)' });
      setResponder('capabilities:getState', () =>
        ok(inventory([reloaded, SENTRY])),
      );

      const outcome = store.setEnabled(GITHUB, 'workspace', false);
      await store.reload();
      pending.resolve(fail('denied'));

      expect(await outcome).toBe('reverted');
      expect(store.entryOf(GITHUB)).toBe(reloaded);
    });
  });

  // ── Workspace switch ───────────────────────────────────────────────────────

  describe('workspace switch', () => {
    it('drops the old rows and re-reads a loaded store', async () => {
      await createLoadedStore();
      setResponder('capabilities:getState', () => ok(inventory([SENTRY])));

      TestBed.inject(WorkspaceScopeService).switchTo('/ws/b');
      TestBed.tick();

      expect(store.entries()).toEqual([]);
      expect(store.state()).toBe('loading');
      await settle();
      expect(store.entries()).toEqual([SENTRY]);
    });

    it('keeps an idle store idle', () => {
      createStore();
      TestBed.tick();

      TestBed.inject(WorkspaceScopeService).switchTo('/ws/b');
      TestBed.tick();

      expect(calls).toHaveLength(0);
      expect(store.state()).toBe('idle');
    });

    it('drops the answer of a write sent under the previous workspace', async () => {
      await createLoadedStore();
      const pending = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => pending.promise);
      const outcome = store.setEnabled(GITHUB, 'workspace', false);

      TestBed.inject(WorkspaceScopeService).switchTo('/ws/b');
      TestBed.tick();
      await settle();
      pending.resolve(ok({ entry: entry({ effectiveEnabled: false }) }));

      expect(await outcome).toBe('skipped');
      expect(store.entryOf(GITHUB)).toBe(GITHUB);
    });

    it("a write from the previous workspace leaves the new workspace's pending flag alone", async () => {
      await createLoadedStore();
      const inA = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => inA.promise);
      const writeA = store.setEnabled(GITHUB, 'workspace', false);

      TestBed.inject(WorkspaceScopeService).switchTo('/ws/b');
      TestBed.tick();
      await settle();

      const inB = deferred<unknown>();
      setResponder('capabilities:setEnabled', () => inB.promise);
      const writeB = store.setEnabled(GITHUB, 'workspace', true);
      expect(store.isPending(GITHUB)).toBe(true);

      inA.resolve(ok({ entry: GITHUB }));
      expect(await writeA).toBe('skipped');

      expect(store.isPending(GITHUB)).toBe(true);
      expect(await store.setEnabled(GITHUB, 'workspace', false)).toBe(
        'skipped',
      );
      expect(callsTo('capabilities:setEnabled')).toHaveLength(2);

      inB.resolve(ok({ entry: GITHUB }));
      expect(await writeB).toBe('saved');
      expect(store.isPending(GITHUB)).toBe(false);
    });
  });
});

describe('optimisticEntry', () => {
  it('a workspace write decides the row', () => {
    expect(optimisticEntry(GITHUB, 'workspace', false)).toMatchObject({
      workspaceEnabled: false,
      effectiveEnabled: false,
      inheritedFrom: 'workspace',
    });
  });

  it('a skill of a plugin that is off stays off', () => {
    const skill = entry({
      kind: 'skill',
      id: 'p:s',
      effectiveEnabled: false,
      inheritedFrom: 'parent-plugin',
    });

    expect(optimisticEntry(skill, 'workspace', true)).toMatchObject({
      workspaceEnabled: true,
      effectiveEnabled: false,
      inheritedFrom: 'parent-plugin',
    });
  });

  it('a global write moves a row that follows global', () => {
    expect(optimisticEntry(GITHUB, 'global', false)).toMatchObject({
      globalEnabled: false,
      effectiveEnabled: false,
      inheritedFrom: 'global',
    });
  });

  it('a global write leaves a workspace override in effect', () => {
    const overridden = entry({
      workspaceEnabled: true,
      inheritedFrom: 'workspace',
    });

    expect(optimisticEntry(overridden, 'global', false)).toMatchObject({
      globalEnabled: false,
      effectiveEnabled: true,
      inheritedFrom: 'workspace',
    });
  });

  it('an unknown row stays unknown and records the scope value', () => {
    const unknown = entry({ effectiveEnabled: null });

    expect(optimisticEntry(unknown, 'workspace', false)).toMatchObject({
      workspaceEnabled: false,
      effectiveEnabled: null,
    });
  });
});
