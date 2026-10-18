/**
 * SessionOrganizerService (TASK_2026_679, Batch 3 Task 3.1).
 *
 * Covers which session the organization editor shows: the loaded row, the
 * last copy when it leaves the list, a session read with
 * `session:getOrganization` when it is outside the loaded list, the push
 * refresh of that read, and the latest-request-wins rules (R1) for a close,
 * a second open or a push while a read is in flight. Focus restore runs
 * after the close renders (R2).
 */
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  LoggingService,
  RpcResult,
} from '@ptah-extension/core';
import {
  SessionId,
  type ChatSessionSummary,
  type SessionGetOrganizationResult,
  type SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { SessionOrganizerService } from './session-organizer.service';

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function row(
  id: SessionId,
  name: string,
  extra: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    id,
    name,
    createdAt: 1,
    lastActivityAt: 2,
    messageCount: 3,
    isActive: false,
    organization: organization(),
    ...extra,
  };
}

type Read = RpcResult<SessionGetOrganizationResult>;

function okRead(summary: SessionOrganizationSummary): Read {
  return new RpcResult<SessionGetOrganizationResult>(true, {
    ok: true,
    organization: summary,
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let awaited RPC results and the code after them run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('SessionOrganizerService', () => {
  const A = SessionId.create();
  const B = SessionId.create();

  let sessions: WritableSignal<readonly ChatSessionSummary[]>;
  let organizationAvailable: WritableSignal<boolean>;
  let call: jest.Mock<Promise<Read>, [string, { sessionId: string }]>;
  let logger: { error: jest.Mock; warn: jest.Mock };
  let service: SessionOrganizerService;

  beforeEach(() => {
    sessions = signal<readonly ChatSessionSummary[]>([]);
    organizationAvailable = signal(true);
    call = jest.fn();
    logger = { error: jest.fn(), warn: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: { sessions, organizationAvailable } },
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
      ],
    });
    service = TestBed.inject(SessionOrganizerService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  function render(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  describe('loaded rows', () => {
    it('shows the loaded row and follows the list when it reloads', () => {
      sessions.set([row(A, 'Alpha')]);
      service.open(A, jest.fn());

      expect(service.isOpen()).toBe(true);
      expect(service.session()?.name).toBe('Alpha');

      sessions.set([row(A, 'Alpha renamed')]);
      expect(service.session()?.name).toBe('Alpha renamed');
    });

    it('keeps the editor open with the last copy when its row leaves the list', () => {
      sessions.set([row(A, 'Alpha')]);
      service.open(A, jest.fn());
      expect(service.session()?.id).toBe(A);

      sessions.set([]);

      expect(service.isOpen()).toBe(true);
      expect(service.session()?.name).toBe('Alpha');
    });

    it('reports a loaded row with organization through rowFor', () => {
      sessions.set([
        row(A, 'Alpha'),
        row(B, 'Beta', { organization: undefined }),
      ]);
      expect(service.rowFor(A)?.name).toBe('Alpha');
      expect(service.rowFor(B)).toBeNull();
      expect(service.rowFor(SessionId.create())).toBeNull();
    });

    it('is exposed as available from the store', () => {
      expect(service.available()).toBe(true);
      organizationAvailable.set(false);
      expect(service.available()).toBe(false);
    });
  });

  describe('close and focus restore', () => {
    it('restores focus after the close renders, once the editor is gone', () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      sessions.set([row(A, 'Alpha')]);
      let openWhenRestored: boolean | null = null;
      const restore = jest.fn(() => {
        openWhenRestored = service.isOpen();
        opener.focus();
      });
      service.open(A, restore);

      service.close();

      expect(service.isOpen()).toBe(false);
      expect(restore).not.toHaveBeenCalled();
      render();
      expect(restore).toHaveBeenCalledTimes(1);
      expect(openWhenRestored).toBe(false);
      expect(document.activeElement).toBe(opener);

      render();
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('closes through closeIfShowing only for the session it shows', () => {
      sessions.set([row(A, 'Alpha'), row(B, 'Beta')]);
      const restore = jest.fn();
      service.open(A, restore);

      service.closeIfShowing(B);
      expect(service.session()?.id).toBe(A);

      service.closeIfShowing(A);
      expect(service.isOpen()).toBe(false);
      render();
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('cancels the restore of a close when another editor opens before it renders', () => {
      sessions.set([row(A, 'Alpha'), row(B, 'Beta')]);
      const restoreA = jest.fn();
      const restoreB = jest.fn();
      service.open(A, restoreA);
      service.close();

      service.open(B, restoreB);
      render();

      expect(restoreA).not.toHaveBeenCalled();
      expect(service.session()?.id).toBe(B);

      service.close();
      render();
      expect(restoreA).not.toHaveBeenCalled();
      expect(restoreB).toHaveBeenCalledTimes(1);
    });

    it('cancels the restore of a close when openForSession reopens before it renders', async () => {
      sessions.set([row(A, 'Alpha'), row(B, 'Beta')]);
      const restoreA = jest.fn();
      service.open(A, restoreA);
      service.close();

      await expect(service.openForSession(B, 'Beta', jest.fn())).resolves.toBe(
        'opened',
      );
      render();

      expect(restoreA).not.toHaveBeenCalled();
    });
  });

  describe('openForSession (a persisted session outside the loaded list)', () => {
    it('opens a loaded row without a read', async () => {
      sessions.set([row(A, 'Alpha')]);

      await expect(service.openForSession(A, 'Alpha', jest.fn())).resolves.toBe(
        'opened',
      );
      expect(call).not.toHaveBeenCalled();
      expect(service.session()?.messageCount).toBe(3);
    });

    it('answers unavailable without a read when the host has no organization', async () => {
      organizationAvailable.set(false);

      await expect(service.openForSession(A, 'Alpha', jest.fn())).resolves.toBe(
        'unavailable',
      );
      expect(call).not.toHaveBeenCalled();
      expect(service.isOpen()).toBe(false);
    });

    it('reads the summary and opens the editor with the fetched values', async () => {
      call.mockResolvedValueOnce(okRead(organization({ priority: 'high' })));

      await expect(
        service.openForSession(A, 'Rail session', jest.fn()),
      ).resolves.toBe('opened');

      expect(call).toHaveBeenCalledWith('session:getOrganization', {
        sessionId: A,
      });
      expect(service.isOpen()).toBe(true);
      expect(service.session()).toEqual({
        id: A,
        name: 'Rail session',
        organization: organization({ priority: 'high' }),
        messageCount: 0,
        createdAt: 0,
        lastActivityAt: 0,
        isActive: false,
      });
    });

    it('empties the fetched entry on close', async () => {
      call.mockResolvedValueOnce(okRead(organization()));
      await service.openForSession(A, 'Rail session', jest.fn());

      service.close();
      expect(service.session()).toBeNull();

      // Re-opening by id alone finds nothing: the fetched entry is gone.
      service.open(A, jest.fn());
      expect(service.session()).toBeNull();
      expect(service.isOpen()).toBe(false);
    });

    it('restores focus after the close of a fetched session renders', async () => {
      call.mockResolvedValueOnce(okRead(organization()));
      const restore = jest.fn();
      await service.openForSession(A, 'Rail session', restore);

      service.close();
      expect(restore).not.toHaveBeenCalled();
      render();
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('fails, logs and stays closed on ok:false', async () => {
      call.mockResolvedValueOnce(
        new RpcResult<SessionGetOrganizationResult>(true, {
          ok: false,
          reason: 'session-not-found',
          message: 'no metadata',
        }),
      );

      await expect(service.openForSession(A, 'Rail', jest.fn())).resolves.toBe(
        'failed',
      );
      expect(service.isOpen()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'SessionOrganizer',
        'Failed to read session organization',
        expect.objectContaining({ reason: 'session-not-found' }),
      );
    });

    it('answers unavailable, logs and stays closed when the host reports organization-unavailable', async () => {
      call.mockResolvedValueOnce(
        new RpcResult<SessionGetOrganizationResult>(true, {
          ok: false,
          reason: 'organization-unavailable',
          message: 'no store',
        }),
      );

      await expect(service.openForSession(A, 'Rail', jest.fn())).resolves.toBe(
        'unavailable',
      );
      expect(service.isOpen()).toBe(false);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('fails, logs and stays closed on a transport error result', async () => {
      call.mockResolvedValueOnce(
        new RpcResult<SessionGetOrganizationResult>(
          false,
          undefined,
          'RPC timeout',
        ),
      );

      await expect(service.openForSession(A, 'Rail', jest.fn())).resolves.toBe(
        'failed',
      );
      expect(service.isOpen()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'SessionOrganizer',
        'Failed to read session organization',
        'RPC timeout',
      );
    });

    it('fails, logs and stays closed when the call throws', async () => {
      const error = new Error('transport down');
      call.mockRejectedValueOnce(error);

      await expect(service.openForSession(A, 'Rail', jest.fn())).resolves.toBe(
        'failed',
      );
      expect(service.isOpen()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'SessionOrganizer',
        'Failed to read session organization',
        error,
      );
    });

    it('follows the loaded row when it arrives while the read is in flight', async () => {
      const read = deferred<Read>();
      call.mockReturnValueOnce(read.promise);
      const pending = service.openForSession(A, 'Rail', jest.fn());

      sessions.set([row(A, 'Loaded Alpha')]);
      read.resolve(okRead(organization({ priority: 'high' })));

      await expect(pending).resolves.toBe('opened');
      expect(service.session()?.name).toBe('Loaded Alpha');
    });
  });

  describe('latest request wins (R1)', () => {
    it('does not open the editor when it is closed while the read is in flight', async () => {
      const read = deferred<Read>();
      call.mockReturnValueOnce(read.promise);
      const restore = jest.fn();
      const pending = service.openForSession(A, 'Rail', restore);

      service.close();
      read.resolve(okRead(organization()));

      await expect(pending).resolves.toBe('cancelled');
      expect(service.isOpen()).toBe(false);
      render();
      expect(restore).not.toHaveBeenCalled();
    });

    it('does not open the editor when its session is deleted while the read is in flight', async () => {
      const read = deferred<Read>();
      call.mockReturnValueOnce(read.promise);
      const pending = service.openForSession(A, 'Rail', jest.fn());

      service.closeIfShowing(A);
      read.resolve(okRead(organization()));

      await expect(pending).resolves.toBe('cancelled');
      expect(service.isOpen()).toBe(false);
    });

    it('lets a second openForSession supersede the first', async () => {
      const first = deferred<Read>();
      const second = deferred<Read>();
      call
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const restoreA = jest.fn();
      const restoreB = jest.fn();

      const openA = service.openForSession(A, 'Alpha', restoreA);
      const openB = service.openForSession(B, 'Beta', restoreB);

      first.resolve(okRead(organization({ priority: 'high' })));
      await expect(openA).resolves.toBe('cancelled');
      expect(service.isOpen()).toBe(false);

      second.resolve(okRead(organization({ priority: 'low' })));
      await expect(openB).resolves.toBe('opened');
      expect(service.session()?.id).toBe(B);
      expect(service.session()?.organization?.priority).toBe('low');

      service.close();
      render();
      expect(restoreA).not.toHaveBeenCalled();
      expect(restoreB).toHaveBeenCalledTimes(1);
    });

    it('reads again when a push for the in-flight id arrives, so the stale result never opens', async () => {
      const stale = deferred<Read>();
      const fresh = deferred<Read>();
      call
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise);

      const pending = service.openForSession(A, 'Rail', jest.fn());
      service.onOrganizationChanged([A]);

      stale.resolve(okRead(organization({ status: 'active' })));
      await settle();
      expect(service.isOpen()).toBe(false);
      expect(call).toHaveBeenCalledTimes(2);

      fresh.resolve(okRead(organization({ status: 'waiting' })));
      await expect(pending).resolves.toBe('opened');
      expect(service.session()?.organization?.status).toBe('waiting');
    });

    it('ignores a push for another id while the read is in flight', async () => {
      const read = deferred<Read>();
      call.mockReturnValueOnce(read.promise);
      const pending = service.openForSession(A, 'Rail', jest.fn());

      service.onOrganizationChanged([B]);
      read.resolve(okRead(organization()));

      await expect(pending).resolves.toBe('opened');
      expect(call).toHaveBeenCalledTimes(1);
    });
  });

  describe('onOrganizationChanged (push refresh)', () => {
    async function openFetched(summary: SessionOrganizationSummary) {
      call.mockResolvedValueOnce(okRead(summary));
      await service.openForSession(A, 'Rail session', jest.fn());
      call.mockReset();
    }

    it('reads a shown fetched session again when the push names it', async () => {
      await openFetched(organization({ pinned: false }));
      call.mockResolvedValueOnce(okRead(organization({ pinned: true })));

      service.onOrganizationChanged([B, A]);
      await settle();

      expect(call).toHaveBeenCalledWith('session:getOrganization', {
        sessionId: A,
      });
      expect(service.session()?.organization?.pinned).toBe(true);
      expect(service.session()?.name).toBe('Rail session');
    });

    it('does not read when the push names other sessions', async () => {
      await openFetched(organization());

      service.onOrganizationChanged([B]);
      await settle();

      expect(call).not.toHaveBeenCalled();
    });

    it('does not read for a loaded row; the list reload refreshes it', async () => {
      sessions.set([row(A, 'Alpha')]);
      service.open(A, jest.fn());

      service.onOrganizationChanged([A]);
      await settle();

      expect(call).not.toHaveBeenCalled();
    });

    it('keeps the last copy when the refresh read fails', async () => {
      await openFetched(organization({ priority: 'high' }));
      call.mockRejectedValueOnce(new Error('transport down'));

      service.onOrganizationChanged([A]);
      await settle();

      expect(service.isOpen()).toBe(true);
      expect(service.session()?.organization?.priority).toBe('high');
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('lets the latest refresh win when two overlap', async () => {
      await openFetched(organization());
      const older = deferred<Read>();
      const newer = deferred<Read>();
      call
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);

      service.onOrganizationChanged([A]);
      service.onOrganizationChanged([A]);
      newer.resolve(okRead(organization({ status: 'waiting' })));
      await settle();
      older.resolve(okRead(organization({ status: 'active' })));
      await settle();

      expect(service.session()?.organization?.status).toBe('waiting');
    });

    it('drops a refresh that resolves after the editor closed', async () => {
      await openFetched(organization());
      const read = deferred<Read>();
      call.mockReturnValueOnce(read.promise);

      service.onOrganizationChanged([A]);
      service.close();
      read.resolve(okRead(organization({ pinned: true })));
      await settle();

      expect(service.isOpen()).toBe(false);
      service.open(A, jest.fn());
      expect(service.session()).toBeNull();
    });
  });
});
