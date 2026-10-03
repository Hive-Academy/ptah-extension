/**
 * SessionOrganizationCaptureService — reachability specs.
 *
 * The cascade runs against a REAL `SessionMetadataStore` over fake state
 * storage, the rekey against the REAL `SessionIdResolvedCallbackRegistry`, and
 * the PR capture against the REAL `PostToolUseCallbackRegistry` fed by the
 * REAL `PostToolUseHookHandler`, so each spec proves the event actually
 * reaches the service. The service is real too; only its SQLite store is an
 * in-memory fake that holds rows per workspace, so "the rows are gone / moved
 * / linked" is observable.
 */
import 'reflect-metadata';
import * as os from 'os';
import * as path from 'path';
import { container as rootContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  createMockOutputChannel,
  createMockStateStorage,
} from '@ptah-extension/platform-core/testing';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  PostToolUseCallbackRegistry,
  PostToolUseHookHandler,
  SDK_TOKENS,
  SessionIdResolvedCallbackRegistry,
  SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { SessionMetadataChangedNotification } from '@ptah-extension/shared';
import {
  SessionOrganizationCaptureService,
  type SessionOrganizationLifecycleSink,
  type SessionOrganizationMetadataEvents,
  type SessionOrganizationPostToolUseSource,
  type SessionOrganizationSessionIdResolvedSource,
} from './session-organization-capture.service';
import {
  SessionOrganizationService,
  type SessionOrganizationChange,
} from './session-organization.service';
import type { SessionOrganizationStore } from './session-organization.store';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import { registerSessionOrganizationServices } from './di/register';
import { startSessionOrganization } from './di/start';

const ROOT = path.join(os.tmpdir(), 'ptah-session-org-capture-ws');
const KEY = normalizeWorkspaceRoot(ROOT);
const OTHER_KEY = normalizeWorkspaceRoot(
  path.join(os.tmpdir(), 'ptah-session-org-capture-other'),
);
const SESSION = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OLD_ID = '7a1c2b3d-0000-4a6b-8c7d-000000000001';
const NEW_ID = '7a1c2b3d-0000-4a6b-8c7d-000000000002';
const TAB_ID = 'tab_1727000000000_x7k2p';
const PR_URL = 'https://github.com/Hive-Academy/ptah-extension/pull/614';

/** Recorder and lifecycle work can run detached; let it settle. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

type RegistryLogger = ConstructorParameters<
  typeof SessionIdResolvedCallbackRegistry
>[0];

type PostToolUseHook = NonNullable<
  ReturnType<PostToolUseHookHandler['createHooks']>['PostToolUse']
>[number]['hooks'][number];
type HookInputArg = Parameters<PostToolUseHook>[0];

/** In-memory stand-in for the SQLite store: session ids per workspace key. */
class FakeOrganizationStore {
  ready = true;
  readonly rows = new Map<string, Set<string>>();

  readonly isReady = jest.fn(() => this.ready);

  private readonly openListeners = new Set<() => void>();

  readonly onDidOpen = jest.fn((listener: () => void) => {
    this.openListeners.add(listener);
    return { dispose: () => this.openListeners.delete(listener) };
  });

  /** The connection finished `openAndMigrate`. */
  open(): void {
    this.ready = true;
    for (const listener of [...this.openListeners]) listener();
  }

  readonly deleteSession = jest.fn((root: string, sessionId: string) => {
    return this.rows.get(root)?.delete(sessionId) ?? false;
  });

  readonly rekeySession = jest.fn((oldId: string, newId: string) => {
    const roots: string[] = [];
    for (const [root, ids] of this.rows) {
      if (ids.delete(oldId)) {
        ids.add(newId);
        roots.push(root);
      }
    }
    return roots;
  });

  readonly addPrLink = jest.fn();

  seed(root: string, sessionId: string): void {
    const ids = this.rows.get(root) ?? new Set<string>();
    ids.add(sessionId);
    this.rows.set(root, ids);
  }

  has(root: string, sessionId: string): boolean {
    return this.rows.get(root)?.has(sessionId) ?? false;
  }
}

interface Harness {
  capture: SessionOrganizationCaptureService;
  metadata: SessionMetadataStore;
  registry: SessionIdResolvedCallbackRegistry;
  postToolUse: PostToolUseCallbackRegistry;
  store: FakeOrganizationStore;
  lines: string[];
  changes: SessionOrganizationChange[];
}

function setup(): Harness {
  const logger = createMockLogger() as unknown as RegistryLogger;
  const metadata = new SessionMetadataStore(createMockStateStorage(), logger);
  const registry = new SessionIdResolvedCallbackRegistry(logger);
  const postToolUse = new PostToolUseCallbackRegistry(logger);
  const store = new FakeOrganizationStore();
  const lines: string[] = [];
  const output = {
    appendLine: (line: string) => lines.push(line),
  } as unknown as IOutputChannel;
  const service = new SessionOrganizationService(
    store as unknown as SessionOrganizationStore,
    metadata,
    output,
  );
  const changes: SessionOrganizationChange[] = [];
  service.onDidChange((e) => changes.push(e));
  const capture = new SessionOrganizationCaptureService(
    service,
    metadata,
    registry,
    postToolUse,
    output,
  );
  return { capture, metadata, registry, postToolUse, store, lines, changes };
}

/** A capture service over fake event sources, for the handler edge cases. */
function isolated(
  overrides: {
    sessionIdResolved?: SessionOrganizationSessionIdResolvedSource;
    postToolUse?: SessionOrganizationPostToolUseSource;
  } = {},
) {
  let metadataListener:
    ((payload: SessionMetadataChangedNotification) => void) | undefined;
  const metadataRelease = jest.fn();
  const metadataSubscribe = jest.fn(
    (fn: (payload: SessionMetadataChangedNotification) => void) => {
      metadataListener = fn;
      return metadataRelease;
    },
  );
  const events: SessionOrganizationMetadataEvents = {
    onMetadataChanged: metadataSubscribe,
  };
  const sink: { [K in keyof SessionOrganizationLifecycleSink]: jest.Mock } = {
    removeSession: jest.fn(),
    rekeySession: jest.fn(),
    addPrLink: jest.fn(),
  };
  const lines: string[] = [];
  const capture = new SessionOrganizationCaptureService(
    sink,
    events,
    overrides.sessionIdResolved ?? { register: jest.fn(() => jest.fn()) },
    overrides.postToolUse ?? { register: jest.fn(() => jest.fn()) },
    { appendLine: (l: string) => lines.push(l) } as unknown as IOutputChannel,
  );
  return {
    capture,
    sink,
    lines,
    metadataRelease,
    metadataSubscribe,
    emitMetadata: (payload: SessionMetadataChangedNotification) =>
      metadataListener?.(payload),
  };
}

function postToolUsePayload(
  overrides: Partial<{
    toolName: string;
    command: string;
    toolOutput: unknown;
    success: boolean;
    sessionId: string;
  }> = {},
) {
  return {
    toolName: overrides.toolName ?? 'Bash',
    toolInput: { command: overrides.command ?? 'gh pr create --fill' },
    toolOutput: overrides.toolOutput ?? `${PR_URL}\n`,
    exitCode: 0,
    success: overrides.success ?? true,
    sessionId: overrides.sessionId ?? SESSION,
    workspaceRoot: ROOT,
    timestamp: Date.now(),
  };
}

function resolved(previousSessionId?: string, realSessionId = NEW_ID) {
  return {
    tabId: TAB_ID,
    realSessionId,
    previousSessionId,
    timestamp: Date.now(),
  };
}

describe('SessionOrganizationCaptureService', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  afterEach(() => {
    h.capture.dispose();
  });

  describe('delete cascade (AC6)', () => {
    it('removes the deleted session rows in its workspace and emits a delete change', async () => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.store.seed(KEY, SESSION);
      h.store.seed(OTHER_KEY, SESSION);
      h.capture.start();

      await h.metadata.delete(SESSION);
      await flush();

      expect(h.store.deleteSession).toHaveBeenCalledTimes(1);
      expect(h.store.deleteSession).toHaveBeenCalledWith(KEY, SESSION);
      expect(h.store.has(KEY, SESSION)).toBe(false);
      expect(h.store.has(OTHER_KEY, SESSION)).toBe(true);
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [SESSION], reason: 'delete' },
      ]);
    });

    it('ignores created and updated metadata events', async () => {
      h.store.seed(KEY, SESSION);
      h.capture.start();

      await h.metadata.create(SESSION, ROOT, 'Session');
      await h.metadata.rename(SESSION, 'Renamed');
      await flush();

      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.has(KEY, SESSION)).toBe(true);
    });

    it('defers a delete received while the store is closed and removes the rows when it opens (F1)', async () => {
      const KEPT = '7a1c2b3d-4e5f-4a6b-8c7d-000000000099';
      await h.metadata.create(SESSION, ROOT, 'Session');
      await h.metadata.create(KEPT, ROOT, 'Kept');
      h.store.seed(KEY, SESSION);
      h.store.seed(KEY, KEPT);
      h.store.seed(OTHER_KEY, SESSION);
      h.store.ready = false;
      h.capture.start();

      await h.metadata.delete(SESSION);
      await flush();

      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.has(KEY, SESSION)).toBe(true);
      expect(h.lines).toEqual([
        `[SessionOrganization] removeSession deferred for ${SESSION}: store not open; applied when it opens`,
      ]);

      h.store.open();
      await flush();

      expect(h.store.deleteSession).toHaveBeenCalledTimes(1);
      expect(h.store.has(KEY, SESSION)).toBe(false);
      // Other sessions, and the same id in another workspace, are untouched.
      expect(h.store.has(KEY, KEPT)).toBe(true);
      expect(h.store.has(OTHER_KEY, SESSION)).toBe(true);
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [SESSION], reason: 'delete' },
      ]);
    });

    it.each([
      ['empty', ''],
      ['whitespace-only', ' \t\n '],
    ])(
      'drops and logs a deleted event whose workspace is %s',
      (_label, workspaceId) => {
        const s = isolated();
        s.capture.start();

        s.emitMetadata({ kind: 'deleted', sessionId: SESSION, workspaceId });

        expect(s.sink.removeSession).not.toHaveBeenCalled();
        expect(s.lines).toEqual([
          `[SessionOrganization] delete cascade dropped for ${SESSION}: metadata named no workspace`,
        ]);
        s.capture.dispose();
      },
    );
  });

  describe('rekey on session id resolved (G1)', () => {
    it('moves the rows from previousSessionId to realSessionId', async () => {
      h.store.seed(KEY, OLD_ID);
      h.capture.start();

      h.registry.notifyAll(resolved(OLD_ID));
      await flush();

      expect(h.store.rekeySession).toHaveBeenCalledTimes(1);
      expect(h.store.rekeySession).toHaveBeenCalledWith(OLD_ID, NEW_ID);
      expect(h.store.has(KEY, OLD_ID)).toBe(false);
      expect(h.store.has(KEY, NEW_ID)).toBe(true);
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [OLD_ID, NEW_ID], reason: 'capture' },
      ]);
    });

    it.each([
      ['previousSessionId is absent', resolved(undefined)],
      ['previousSessionId equals realSessionId', resolved(NEW_ID)],
      ['previousSessionId is empty', resolved('')],
      ['previousSessionId is whitespace-only', resolved('   ')],
    ])('does nothing when %s', async (_label, payload) => {
      h.store.seed(KEY, OLD_ID);
      h.capture.start();

      h.registry.notifyAll(payload);
      await flush();

      expect(h.store.rekeySession).not.toHaveBeenCalled();
      expect(h.store.isReady).not.toHaveBeenCalled();
      expect(h.changes).toEqual([]);
      expect(h.lines).toEqual([]);
    });

    it('drops the rekey and logs once when the store is closed', async () => {
      h.store.seed(KEY, OLD_ID);
      h.store.ready = false;
      h.capture.start();

      h.registry.notifyAll(resolved(OLD_ID));
      await flush();

      expect(h.store.rekeySession).not.toHaveBeenCalled();
      expect(h.store.has(KEY, OLD_ID)).toBe(true);
      expect(h.lines).toEqual([
        `[SessionOrganization] rekeySession dropped (${OLD_ID} -> ${NEW_ID}): store not open`,
      ]);
    });
  });

  describe('PR capture on PostToolUse (AC3, lane L7)', () => {
    it('links the PR a successful gh pr create created, as an agent link', async () => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.capture.start();

      h.postToolUse.notifyAll(
        postToolUsePayload({ command: 'gh pr create --draft --fill' }),
      );
      await flush();

      expect(h.store.addPrLink).toHaveBeenCalledTimes(1);
      expect(h.store.addPrLink).toHaveBeenCalledWith(
        KEY,
        SESSION,
        {
          url: PR_URL,
          number: 614,
          repo: 'Hive-Academy/ptah-extension',
          state: 'draft',
          source: 'agent',
        },
        expect.any(Number),
      );
      expect(h.changes).toEqual([
        { workspaceRoot: KEY, sessionIds: [SESSION], reason: 'capture' },
      ]);
    });

    it.each([
      ['a non-Bash tool', postToolUsePayload({ toolName: 'Edit' })],
      ['a failed command', postToolUsePayload({ success: false })],
      ['gh pr view', postToolUsePayload({ command: 'gh pr view 614' })],
      ['no PR URL', postToolUsePayload({ toolOutput: 'nothing created' })],
    ])('links nothing for %s', async (_label, payload) => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.capture.start();

      h.postToolUse.notifyAll(payload);
      await flush();

      expect(h.store.addPrLink).not.toHaveBeenCalled();
      expect(h.lines).toEqual([]);
    });

    it('catches and logs a sink that throws, without reaching the registry', () => {
      const s = isolated({
        postToolUse: h.postToolUse,
      });
      s.sink.addPrLink.mockImplementation(() => {
        throw new Error('sink exploded');
      });
      s.capture.start();

      expect(() => h.postToolUse.notifyAll(postToolUsePayload())).not.toThrow();

      expect(s.lines).toEqual([
        `[SessionOrganization] PR capture failed for ${SESSION}: sink exploded`,
      ]);
      s.capture.dispose();
    });
  });

  describe('PR capture reachability through startSessionOrganization (AC8)', () => {
    interface Host {
      hook: (sessionId: string | undefined) => PostToolUseHook;
      store: FakeOrganizationStore;
      metadata: SessionMetadataStore;
      lines: string[];
      dispose: () => void;
    }

    function host(): Host {
      const c = rootContainer.createChildContainer();
      const logger = createMockLogger() as unknown as RegistryLogger;
      const metadata = new SessionMetadataStore(
        createMockStateStorage(),
        logger,
      );
      const postToolUse = new PostToolUseCallbackRegistry(logger);
      const output = createMockOutputChannel();
      const store = new FakeOrganizationStore();
      c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
        useValue: { isOpen: true },
      });
      c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: metadata });
      c.register(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY, {
        useValue: new SessionIdResolvedCallbackRegistry(logger),
      });
      c.register(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY, {
        useValue: postToolUse,
      });
      c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, { useValue: output });
      registerSessionOrganizationServices(c);
      // Only the SQLite store is faked; the service and capture are real.
      c.register(SESSION_ORGANIZATION_TOKENS.STORE, { useValue: store });
      const handle = startSessionOrganization(c);
      const handler = new PostToolUseHookHandler(
        logger as unknown as ConstructorParameters<
          typeof PostToolUseHookHandler
        >[0],
        postToolUse,
      );
      return {
        hook: (sessionId) => {
          const matcher = handler.createHooks(sessionId, ROOT).PostToolUse?.[0];
          const fn = matcher?.hooks[0];
          if (!fn) throw new Error('PostToolUse hook not built');
          return fn;
        },
        store,
        metadata,
        lines: output.__state.lines,
        dispose: () => handle.dispose(),
      };
    }

    function hookInput(sessionId: string | undefined): HookInputArg {
      return {
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_input: { command: 'gh pr create --title "Fix" --body "Body"' },
        tool_response: {
          stdout: `Creating pull request\n${PR_URL}\n`,
          exit_code: 0,
        },
        tool_use_id: 'tu-1',
      } as unknown as HookInputArg;
    }

    const signal = (): { signal: AbortSignal } => ({
      signal: new AbortController().signal,
    });

    it('a gh pr create hook input calls addPrLink with the SDK session id and source agent', async () => {
      const x = host();
      await x.metadata.create(SESSION, ROOT, 'Session');

      await x.hook(TAB_ID)(hookInput(SESSION), 'tu-1', signal());
      await flush();

      expect(x.store.addPrLink).toHaveBeenCalledTimes(1);
      expect(x.store.addPrLink).toHaveBeenCalledWith(
        KEY,
        SESSION,
        expect.objectContaining({
          url: PR_URL,
          state: 'open',
          source: 'agent',
        }),
        expect.any(Number),
      );
      expect(x.lines).toEqual([]);
      x.dispose();
    });

    it('a hook input without session_id falls back to the tab id: no store call, one drop line', async () => {
      const x = host();
      await x.metadata.create(SESSION, ROOT, 'Session');

      await x.hook(TAB_ID)(hookInput(undefined), 'tu-1', signal());
      await flush();

      expect(x.store.addPrLink).not.toHaveBeenCalled();
      expect(x.store.isReady).not.toHaveBeenCalled();
      expect(x.lines).toEqual([
        `[SessionOrganization] addPrLink dropped for ${TAB_ID}: session id has no metadata (likely a tab id or a session not bound yet)`,
      ]);
      x.dispose();
    });
  });

  describe('lifecycle', () => {
    it('subscribes once however often start() is called', () => {
      h.capture.start();
      h.capture.start();

      expect(h.registry.size).toBe(1);
      expect(h.postToolUse.size).toBe(1);
    });

    it('a subscription that throws releases the earlier ones, stays un-started, and a later start() subscribes again', () => {
      const failing = { register: jest.fn() };
      failing.register.mockImplementationOnce(() => {
        throw new Error('registry offline');
      });
      failing.register.mockImplementation(() => jest.fn());
      const s = isolated({
        sessionIdResolved: failing,
        postToolUse: h.postToolUse,
      });

      expect(() => s.capture.start()).toThrow('registry offline');

      expect(s.metadataSubscribe).toHaveBeenCalledTimes(1);
      expect(s.metadataRelease).toHaveBeenCalledTimes(1);
      expect(h.postToolUse.size).toBe(0);

      s.capture.dispose();
      expect(s.metadataRelease).toHaveBeenCalledTimes(1);

      s.capture.start();
      expect(s.metadataSubscribe).toHaveBeenCalledTimes(2);
      expect(failing.register).toHaveBeenCalledTimes(2);
      expect(h.postToolUse.size).toBe(1);

      s.capture.dispose();
      expect(s.metadataRelease).toHaveBeenCalledTimes(2);
      expect(h.postToolUse.size).toBe(0);
    });

    it('releases every subscription on dispose() and tolerates a second dispose()', async () => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.store.seed(KEY, SESSION);
      h.store.seed(KEY, OLD_ID);
      h.capture.start();

      h.capture.dispose();
      h.capture.dispose();
      expect(h.registry.size).toBe(0);
      expect(h.postToolUse.size).toBe(0);

      await h.metadata.delete(SESSION);
      h.registry.notifyAll(resolved(OLD_ID));
      await flush();

      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.rekeySession).not.toHaveBeenCalled();
    });

    it('a disposer that throws is logged and the remaining disposers still run', () => {
      const secondRelease = jest.fn();
      const thirdRelease = jest.fn();
      const s = isolated({
        sessionIdResolved: { register: jest.fn(() => secondRelease) },
        postToolUse: { register: jest.fn(() => thirdRelease) },
      });
      s.metadataRelease.mockImplementation(() => {
        throw new Error('release exploded');
      });
      s.capture.start();

      expect(() => s.capture.dispose()).not.toThrow();

      expect(s.metadataRelease).toHaveBeenCalledTimes(1);
      expect(secondRelease).toHaveBeenCalledTimes(1);
      expect(thirdRelease).toHaveBeenCalledTimes(1);
      expect(s.lines).toEqual([
        '[SessionOrganization] releasing a subscription failed: release exploded',
      ]);
    });

    it('dispose() before start() is a no-op, and start() after dispose() resubscribes', () => {
      h.capture.dispose();
      h.capture.start();
      h.capture.dispose();
      h.capture.start();

      expect(h.registry.size).toBe(1);
    });
  });
});
