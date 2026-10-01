/**
 * SessionOrganizationCaptureService — reachability specs.
 *
 * The cascade runs against a REAL `SessionMetadataStore` over fake state
 * storage, and the rekey against the REAL `SessionIdResolvedCallbackRegistry`,
 * so each spec proves the event actually reaches the service. The service is
 * real too; only its SQLite store is an in-memory fake that holds rows per
 * workspace, so "the rows are gone / moved" is observable.
 */
import 'reflect-metadata';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeWorkspaceRoot,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  SessionIdResolvedCallbackRegistry,
  SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { SessionMetadataChangedNotification } from '@ptah-extension/shared';
import {
  SessionOrganizationCaptureService,
  type SessionOrganizationMetadataEvents,
} from './session-organization-capture.service';
import {
  SessionOrganizationService,
  type SessionOrganizationChange,
} from './session-organization.service';
import type { SessionOrganizationStore } from './session-organization.store';

const ROOT = path.join(os.tmpdir(), 'ptah-session-org-capture-ws');
const KEY = normalizeWorkspaceRoot(ROOT);
const OTHER_KEY = normalizeWorkspaceRoot(
  path.join(os.tmpdir(), 'ptah-session-org-capture-other'),
);
const SESSION = '7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OLD_ID = '7a1c2b3d-0000-4a6b-8c7d-000000000001';
const NEW_ID = '7a1c2b3d-0000-4a6b-8c7d-000000000002';
const TAB_ID = 'tab_1727000000000_x7k2p';

/** Recorder and lifecycle work can run detached; let it settle. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** In-memory stand-in for the SQLite store: session ids per workspace key. */
class FakeOrganizationStore {
  ready = true;
  readonly rows = new Map<string, Set<string>>();

  readonly isReady = jest.fn(() => this.ready);

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
  store: FakeOrganizationStore;
  lines: string[];
  changes: SessionOrganizationChange[];
}

function setup(): Harness {
  const logger = createMockLogger() as unknown as ConstructorParameters<
    typeof SessionMetadataStore
  >[1];
  const metadata = new SessionMetadataStore(createMockStateStorage(), logger);
  const registry = new SessionIdResolvedCallbackRegistry(logger);
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
    output,
  );
  return { capture, metadata, registry, store, lines, changes };
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

    it('drops the cascade and logs once when the store is closed', async () => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.store.seed(KEY, SESSION);
      h.store.ready = false;
      h.capture.start();

      await h.metadata.delete(SESSION);
      await flush();

      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.has(KEY, SESSION)).toBe(true);
      expect(h.lines).toHaveLength(1);
      expect(h.lines[0]).toMatch(
        /^\[SessionOrganization\] removeSession dropped for 7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d: store not open$/,
      );
    });

    it('drops and logs a deleted event that names no workspace', () => {
      let listener:
        ((payload: SessionMetadataChangedNotification) => void) | undefined;
      const events: SessionOrganizationMetadataEvents = {
        onMetadataChanged: (fn) => {
          listener = fn;
          return () => undefined;
        },
      };
      const removeSession = jest.fn();
      const lines: string[] = [];
      const capture = new SessionOrganizationCaptureService(
        { removeSession, rekeySession: jest.fn() },
        events,
        h.registry,
        {
          appendLine: (l: string) => lines.push(l),
        } as unknown as IOutputChannel,
      );
      capture.start();

      listener?.({ kind: 'deleted', sessionId: SESSION, workspaceId: '' });

      expect(removeSession).not.toHaveBeenCalled();
      expect(lines).toEqual([
        `[SessionOrganization] delete cascade dropped for ${SESSION}: metadata named no workspace`,
      ]);
      capture.dispose();
    });
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

  describe('lifecycle', () => {
    it('subscribes once however often start() is called', () => {
      h.capture.start();
      h.capture.start();

      expect(h.registry.size).toBe(1);
    });

    it('releases every subscription on dispose() and tolerates a second dispose()', async () => {
      await h.metadata.create(SESSION, ROOT, 'Session');
      h.store.seed(KEY, SESSION);
      h.store.seed(KEY, OLD_ID);
      h.capture.start();

      h.capture.dispose();
      h.capture.dispose();
      expect(h.registry.size).toBe(0);

      await h.metadata.delete(SESSION);
      h.registry.notifyAll(resolved(OLD_ID));
      await flush();

      expect(h.store.deleteSession).not.toHaveBeenCalled();
      expect(h.store.rekeySession).not.toHaveBeenCalled();
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
