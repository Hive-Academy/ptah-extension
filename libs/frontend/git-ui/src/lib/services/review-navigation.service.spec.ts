import { TestBed } from '@angular/core/testing';
import type { GitReviewChangesResult } from '@ptah-extension/shared';
import { ReviewNavigationService } from './review-navigation.service';
import { GitStatusService } from './git-status.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  VSCodeService: class VSCodeService {},
}));
const { VSCodeService } = jest.requireMock('@ptah-extension/core');

const SHA = 'a'.repeat(40);
const PARENT = 'p'.repeat(40);

function reviewChanges(
  overrides: Partial<GitReviewChangesResult> = {},
): GitReviewChangesResult {
  return {
    success: true,
    base: { name: `${SHA}^`, sha: PARENT },
    head: { name: SHA, sha: SHA },
    mergeBaseSha: PARENT,
    files: [
      {
        path: 'src/a.ts',
        status: 'M',
        additions: 3,
        deletions: 1,
        binary: false,
      },
    ],
    totals: { additions: 3, deletions: 1, binaryFiles: 0 },
    ...overrides,
  };
}

function makeService() {
  const active: { path: string | null } = { path: '/ws' };
  TestBed.configureTestingModule({
    providers: [
      { provide: VSCodeService, useValue: {} },
      {
        provide: GitStatusService,
        useValue: { activeWorkspacePath: () => active.path },
      },
    ],
  });
  return { service: TestBed.inject(ReviewNavigationService), active };
}

beforeEach(() => mockRpcCall.mockReset());

describe('ReviewNavigationService', () => {
  it('starts on the Changes tab comparing the working tree, with no target', () => {
    const { service } = makeService();
    expect(service.current()).toEqual({
      seq: 0,
      tab: 'changes',
      scope: { kind: 'worktree' },
      target: { kind: 'none' },
    });
  });

  it('openChangeSet points the Changes tab at the turn files in the working tree', () => {
    const { service } = makeService();
    service.openChangeSet({
      workspaceRoot: '/ws',
      files: [{ path: 'a.ts' }, { path: 'b.ts', origPath: 'old-b.ts' }],
      ownerSessionId: 'session-1',
    });
    expect(service.current()).toEqual({
      seq: 1,
      tab: 'changes',
      scope: { kind: 'worktree' },
      target: {
        kind: 'change-set',
        workspaceRoot: '/ws',
        files: [{ path: 'a.ts' }, { path: 'b.ts', origPath: 'old-b.ts' }],
        ownerSessionId: 'session-1',
      },
    });
  });

  it('openChangeSet without an owner session leaves ownerSessionId out', () => {
    const { service } = makeService();
    service.openChangeSet({ workspaceRoot: '/ws', files: [] });
    expect(service.current().target).not.toHaveProperty('ownerSessionId');
  });

  it('openFile opens the spot editor and keeps the comparison; backToReview returns', () => {
    const { service } = makeService();
    service.selectComparison('staged');
    service.selectTab('history');
    service.openFile('/ws/src/a.ts', 12);
    expect(service.current().tab).toBe('changes');
    expect(service.current().scope).toEqual({ kind: 'staged' });
    expect(service.current().target).toEqual({
      kind: 'file',
      request: { path: '/ws/src/a.ts', line: 12 },
    });

    service.backToReview();
    expect(service.current().scope).toEqual({ kind: 'staged' });
    expect(service.current().target).toEqual({ kind: 'none' });
  });

  it('openFile marks the target editable only when asked (the canvas Edit action)', () => {
    const { service } = makeService();
    service.openFile('/ws/a.ts', undefined, { editable: true });
    expect(service.current().target).toEqual({
      kind: 'file',
      request: { path: '/ws/a.ts' },
      editable: true,
    });
    service.openFile('/ws/a.ts', 3, { editable: false });
    expect(service.current().target).not.toHaveProperty('editable');
  });

  it('a repeated request for the same target still bumps seq', () => {
    const { service } = makeService();
    service.openFile('/ws/a.ts');
    const first = service.current().seq;
    service.openFile('/ws/a.ts');
    expect(service.current().seq).toBe(first + 1);
    expect(service.current().target).toEqual({
      kind: 'file',
      request: { path: '/ws/a.ts' },
    });
  });

  it('openFile carries a link context (column, workspace root, document) into the request', () => {
    const { service } = makeService();
    service.openFile('./b.md', 4, {
      column: 2,
      workspaceRoot: '/ws',
      documentPath: '/ws/docs/a.md',
    });
    expect(service.current().target).toEqual({
      kind: 'file',
      request: {
        path: './b.md',
        line: 4,
        column: 2,
        workspaceRoot: '/ws',
        documentPath: '/ws/docs/a.md',
      },
    });

    service.openFile('/ws/c.ts', undefined, {
      editable: true,
      workspaceRoot: '',
    });
    expect(service.current().target).toEqual({
      kind: 'file',
      request: { path: '/ws/c.ts' },
      editable: true,
    });
  });

  it('selectTab is a no-op for the tab already shown', () => {
    const { service } = makeService();
    service.selectTab('changes');
    expect(service.current().seq).toBe(0);
    service.selectTab('commit');
    expect(service.current()).toMatchObject({ seq: 1, tab: 'commit' });
  });

  it('openStashFile shows one stash file read-only against its parent', async () => {
    const { service } = makeService();
    mockRpcCall.mockResolvedValue({ success: false, error: 'down' });
    await service.openStashFile({
      base: { name: 'abc^1', sha: PARENT },
      head: { name: 'abc', sha: SHA },
      label: 'WIP on main · abc1234',
      file: { path: 'new.ts', status: 'R', oldPath: 'old.ts' },
    });
    expect(service.current()).toEqual({
      seq: 1,
      tab: 'changes',
      scope: {
        kind: 'historical',
        base: { name: 'abc^1', sha: PARENT },
        head: { name: 'abc', sha: SHA },
        label: 'WIP on main · abc1234',
        files: [
          {
            path: 'new.ts',
            originalPath: 'old.ts',
            status: 'R',
            additions: null,
            deletions: null,
            binary: false,
          },
        ],
      },
      target: { kind: 'diff', path: 'new.ts', originalPath: 'old.ts' },
    });
  });

  it("openStashFile takes the file's counts and binary flag from git:reviewChanges over the stash commits", async () => {
    const { service } = makeService();
    const row = {
      path: 'logo.png',
      status: 'M' as const,
      additions: null,
      deletions: null,
      binary: true,
    };
    mockRpcCall.mockResolvedValue({
      success: true,
      data: reviewChanges({ files: [row] }),
    });

    await service.openStashFile({
      base: { name: 'abc^1', sha: PARENT },
      head: { name: 'abc', sha: SHA },
      label: 'WIP on main · abc1234',
      file: { path: 'logo.png', status: 'M' },
    });

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:reviewChanges',
      { workspaceRoot: '/ws', base: PARENT, head: SHA },
    );
    expect(service.current().scope).toMatchObject({
      kind: 'historical',
      files: [row],
    });
  });

  it('openStashFile yields to a navigation made while its read was in flight', async () => {
    const { service } = makeService();
    let resolve!: (value: unknown) => void;
    mockRpcCall.mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = service.openStashFile({
      base: { name: 'abc^1', sha: PARENT },
      head: { name: 'abc', sha: SHA },
      label: 'WIP on main · abc1234',
      file: { path: 'a.ts', status: 'M' },
    });
    service.selectComparison('staged');
    resolve({ success: true, data: reviewChanges() });
    await pending;

    expect(service.current().scope).toEqual({ kind: 'staged' });
  });

  describe('openHistorical', () => {
    it('resolves <sha>^..<sha> read-only and navigates to the commit', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue({ success: true, data: reviewChanges() });

      const outcome = await service.openHistorical(SHA);

      expect(outcome).toEqual({ opened: true });
      expect(mockRpcCall).toHaveBeenCalledWith(
        expect.anything(),
        'git:reviewChanges',
        { workspaceRoot: '/ws', base: `${SHA}^`, head: SHA },
      );
      expect(service.current().scope).toEqual({
        kind: 'historical',
        base: { name: `${SHA}^`, sha: PARENT },
        head: { name: SHA, sha: SHA },
        label: SHA.slice(0, 7),
        files: reviewChanges().files,
      });
      expect(service.current().tab).toBe('changes');
    });

    it('a refused read (root commit) leaves the view unchanged and returns the reason', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue({
        success: true,
        data: reviewChanges({
          success: false,
          error: 'Unknown revision.',
          base: undefined,
          head: undefined,
          files: [],
        }),
      });
      const outcome = await service.openHistorical(SHA);
      expect(outcome).toEqual({ opened: false, error: 'Unknown revision.' });
      expect(service.current().seq).toBe(0);
    });

    it('a transport failure or a throw returns an error and does not navigate', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValueOnce({ success: false, error: 'timed out' });
      expect(await service.openHistorical(SHA)).toEqual({
        opened: false,
        error: 'timed out',
      });

      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockRpcCall.mockRejectedValueOnce(new Error('down'));
      expect(await service.openHistorical(SHA)).toEqual({
        opened: false,
        error: 'Could not read this commit.',
      });
      errorSpy.mockRestore();
      expect(service.current().seq).toBe(0);
    });

    it('rejects a value that is not a commit id without calling git', async () => {
      const { service } = makeService();
      expect(await service.openHistorical('--output=/tmp/x')).toEqual({
        opened: false,
        error: 'That is not a commit id.',
      });
      expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it('needs an active workspace', async () => {
      const { service, active } = makeService();
      active.path = null;
      const outcome = await service.openHistorical(SHA);
      expect(outcome).toMatchObject({ opened: false });
      expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it('a navigation made while the read was in flight wins', async () => {
      const { service } = makeService();
      let resolve!: (value: unknown) => void;
      mockRpcCall.mockReturnValue(new Promise((res) => (resolve = res)));
      const pending = service.openHistorical(SHA);

      service.openFile('/ws/a.ts');
      resolve({ success: true, data: reviewChanges() });

      expect(await pending).toEqual({ opened: false, error: null });
      expect(service.current().target.kind).toBe('file');
    });

    it('a workspace switch while the read was in flight drops it', async () => {
      const { service, active } = makeService();
      let resolve!: (value: unknown) => void;
      mockRpcCall.mockReturnValue(new Promise((res) => (resolve = res)));
      const pending = service.openHistorical(SHA);

      active.path = '/other';
      resolve({ success: true, data: reviewChanges() });

      expect(await pending).toEqual({ opened: false, error: null });
      expect(service.current().seq).toBe(0);
    });
  });

  describe('leave guard (unsaved spot-editor edits)', () => {
    const STASH = {
      base: { name: 'abc^1', sha: PARENT },
      head: { name: 'abc', sha: SHA },
      label: 'WIP on main · abc1234',
      file: { path: 'a.ts', status: 'M' as const },
    };

    function deferred(): {
      promise: Promise<boolean>;
      resolve: (value: boolean) => void;
      reject: (error: unknown) => void;
    } {
      let resolve!: (value: boolean) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<boolean>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('is not asked while the spot editor is not showing', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);

      service.openChangeSet({ workspaceRoot: '/ws', files: [] });
      service.selectComparison('staged');

      expect(guard).not.toHaveBeenCalled();
      expect(service.current().scope).toEqual({ kind: 'staged' });
    });

    it('is not asked for file-to-file navigation or for Back to review', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);

      service.openFile('/ws/a.ts');
      service.openFile('/ws/b.ts');
      expect(service.current().target).toMatchObject({
        request: { path: '/ws/b.ts' },
      });
      service.backToReview();

      expect(guard).not.toHaveBeenCalled();
      expect(service.current().target).toEqual({ kind: 'none' });
    });

    it('Keep editing cancels a change set and a comparison', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts');
      const before = service.current();

      service.openChangeSet({
        workspaceRoot: '/ws',
        files: [{ path: 'a.ts' }],
      });
      service.selectComparison('staged');

      expect(guard).toHaveBeenCalledTimes(2);
      expect(service.current()).toBe(before);
    });

    it('a tab-only switch from a file target is not asked and keeps the file', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts', 3);
      const target = service.current().target;

      service.selectTab('commit');
      expect(service.current()).toMatchObject({ tab: 'commit', target });
      service.selectTab('changes');

      expect(guard).not.toHaveBeenCalled();
      expect(service.current()).toMatchObject({ tab: 'changes', target });
    });

    it('still asks when the file target is replaced after a tab switch', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts');
      service.selectTab('history');
      const before = service.current();

      service.selectComparison('staged');

      expect(guard).toHaveBeenCalledTimes(1);
      expect(service.current()).toBe(before);
    });

    it('Discard lets a change set land', () => {
      const { service } = makeService();
      service.registerLeaveGuard(() => true);
      service.openFile('/ws/a.ts');

      service.openChangeSet({
        workspaceRoot: '/ws',
        files: [{ path: 'a.ts' }],
      });

      expect(service.current().target.kind).toBe('change-set');
    });

    it('an asynchronous answer lands the navigation only when it says leave', async () => {
      const { service } = makeService();
      const answer = deferred();
      service.registerLeaveGuard(() => answer.promise);
      service.openFile('/ws/a.ts');

      service.selectComparison('staged');
      expect(service.current().target.kind).toBe('file');
      answer.resolve(true);
      await answer.promise;
      await Promise.resolve();

      expect(service.current()).toMatchObject({
        scope: { kind: 'staged' },
        target: { kind: 'none' },
      });
    });

    it('openStashFile asks before replacing the editor, and Keep editing keeps it', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue({ success: false, error: 'down' });
      const guard = jest.fn(async () => false);
      service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts');

      await service.openStashFile(STASH);

      expect(guard).toHaveBeenCalledTimes(1);
      expect(service.current().target.kind).toBe('file');
    });

    it('openHistorical reports Keep editing as not opened, without an error', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue({ success: true, data: reviewChanges() });
      service.registerLeaveGuard(async () => false);
      service.openFile('/ws/a.ts');

      expect(await service.openHistorical(SHA)).toEqual({
        opened: false,
        error: null,
      });
      expect(service.current().target.kind).toBe('file');
    });

    it('openHistorical lands after Discard', async () => {
      const { service } = makeService();
      mockRpcCall.mockResolvedValue({ success: true, data: reviewChanges() });
      service.registerLeaveGuard(async () => true);
      service.openFile('/ws/a.ts');

      expect(await service.openHistorical(SHA)).toEqual({ opened: true });
      expect(service.current().scope.kind).toBe('historical');
    });

    it('while an answer is pending, the latest guarded navigation wins', async () => {
      const { service } = makeService();
      const first = deferred();
      const second = deferred();
      const answers = [first, second];
      service.registerLeaveGuard(() => answers.shift()?.promise ?? false);
      service.openFile('/ws/a.ts');

      service.selectComparison('staged');
      service.selectComparison('branch');
      first.resolve(true);
      second.resolve(true);
      await Promise.all([first.promise, second.promise]);
      await Promise.resolve();

      expect(service.current().scope).toEqual({ kind: 'branch' });
    });

    it('a navigation made while the answer is pending supersedes it', async () => {
      const { service } = makeService();
      const answer = deferred();
      service.registerLeaveGuard(() => answer.promise);
      service.openFile('/ws/a.ts');

      service.selectComparison('staged');
      service.openFile('/ws/b.ts');
      answer.resolve(true);
      await answer.promise;
      await Promise.resolve();

      expect(service.current().target).toMatchObject({
        kind: 'file',
        request: { path: '/ws/b.ts' },
      });
    });

    it('a guard that throws or rejects keeps the editor', async () => {
      const { service } = makeService();
      const error = jest.spyOn(console, 'error').mockImplementation(() => {
        // Expected: the failure is logged.
      });
      service.registerLeaveGuard(() => {
        throw new Error('boom');
      });
      service.openFile('/ws/a.ts');
      service.selectComparison('staged');
      expect(service.current().target.kind).toBe('file');

      const rejected = deferred();
      service.registerLeaveGuard(() => rejected.promise);
      service.selectComparison('staged');
      rejected.reject(new Error('boom'));
      await rejected.promise.catch(() => undefined);
      await Promise.resolve();

      expect(service.current().target.kind).toBe('file');
      expect(error).toHaveBeenCalledTimes(2);
      error.mockRestore();
    });

    it('an older open still waiting on the leave guard does not land over a newer open', async () => {
      const { service } = makeService();
      const OTHER = 'b'.repeat(40);
      const olderAnswer = deferred();
      const answers: (boolean | Promise<boolean>)[] = [
        olderAnswer.promise,
        true,
      ];
      service.registerLeaveGuard(() => answers.shift() ?? false);
      service.openFile('/ws/a.ts');
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: reviewChanges(),
      });
      const older = service.openHistorical(SHA);
      // Let the older read land; it now waits on the guard.
      await new Promise((res) => setTimeout(res, 0));
      let resolveNewer!: (value: unknown) => void;
      mockRpcCall.mockReturnValueOnce(
        new Promise((res) => (resolveNewer = res)),
      );
      const newer = service.openHistorical(OTHER);

      olderAnswer.resolve(true);
      expect(await older).toEqual({ opened: false, error: null });
      expect(service.current().target.kind).toBe('file');

      resolveNewer({
        success: true,
        data: reviewChanges({ head: { name: OTHER, sha: OTHER } }),
      });
      expect(await newer).toEqual({ opened: true });
      expect(service.current().scope).toMatchObject({ head: { sha: OTHER } });
    });

    it('a pending workspace-reset answer does not drop an open started in the new workspace', async () => {
      const { service, active } = makeService();
      const resetAnswer = deferred();
      const answers: (boolean | Promise<boolean>)[] = [
        resetAnswer.promise,
        true,
      ];
      service.registerLeaveGuard(() => answers.shift() ?? false);
      service.openFile('/ws/a.ts');
      active.path = '/other';
      service.switchWorkspace('/other');
      let resolveRead!: (value: unknown) => void;
      mockRpcCall.mockReturnValueOnce(
        new Promise((res) => (resolveRead = res)),
      );
      const open = service.openHistorical(SHA);

      resetAnswer.resolve(true);
      await resetAnswer.promise;
      await Promise.resolve();
      expect(service.current().target.kind).toBe('file');

      resolveRead({ success: true, data: reviewChanges() });
      expect(await open).toEqual({ opened: true });
      expect(service.current()).toMatchObject({
        scope: { kind: 'historical', head: { sha: SHA } },
        target: { kind: 'none' },
      });
    });

    it('a released guard is no longer asked', () => {
      const { service } = makeService();
      const guard = jest.fn(() => false);
      const release = service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts');

      release();
      service.selectComparison('staged');

      expect(guard).not.toHaveBeenCalled();
      expect(service.current().scope).toEqual({ kind: 'staged' });
    });
  });

  describe('in-flight opens (latest click wins)', () => {
    function holdNextRead(): (value: unknown) => void {
      let resolve!: (value: unknown) => void;
      mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      return resolve;
    }
    const stash = (path: string) => ({
      base: { name: 'abc^1', sha: PARENT },
      head: { name: 'abc', sha: SHA },
      label: 'WIP on main · abc1234',
      file: { path, status: 'M' as const },
    });

    it('a slower earlier commit read does not replace a later one', async () => {
      const { service } = makeService();
      const OTHER = 'b'.repeat(40);
      const resolveFirst = holdNextRead();
      const resolveSecond = holdNextRead();
      const first = service.openHistorical(SHA);
      const second = service.openHistorical(OTHER);

      resolveSecond({
        success: true,
        data: reviewChanges({ head: { name: OTHER, sha: OTHER } }),
      });
      expect(await second).toEqual({ opened: true });
      resolveFirst({ success: true, data: reviewChanges() });

      expect(await first).toEqual({ opened: false, error: null });
      expect(service.current().scope).toMatchObject({
        kind: 'historical',
        head: { sha: OTHER },
      });
    });

    it('a slower earlier stash file read does not replace a later one', async () => {
      const { service } = makeService();
      const resolveFirst = holdNextRead();
      const resolveSecond = holdNextRead();
      const first = service.openStashFile(stash('a.ts'));
      const second = service.openStashFile(stash('b.ts'));

      resolveSecond({ success: false, error: 'down' });
      await second;
      resolveFirst({ success: false, error: 'down' });
      await first;

      expect(service.current().target).toEqual({ kind: 'diff', path: 'b.ts' });
      expect(service.current().seq).toBe(1);
    });

    it('a stash file read is superseded by a later commit open', async () => {
      const { service } = makeService();
      const resolveStash = holdNextRead();
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: reviewChanges(),
      });
      const stashOpen = service.openStashFile(stash('a.ts'));
      const commitOpen = service.openHistorical(SHA);
      expect(await commitOpen).toEqual({ opened: true });
      resolveStash({ success: false, error: 'down' });
      await stashOpen;

      expect(service.current().target).toEqual({ kind: 'none' });
      expect(service.current().scope).toMatchObject({ label: SHA.slice(0, 7) });
    });
  });

  describe('workspace switch and removal', () => {
    async function openCommitIn(
      service: ReviewNavigationService,
    ): Promise<void> {
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: reviewChanges(),
      });
      expect(await service.openHistorical(SHA)).toEqual({ opened: true });
    }

    it('a switch drops a commit comparison opened in the previous workspace', async () => {
      const { service, active } = makeService();
      service.selectTab('history');
      await openCommitIn(service);

      active.path = '/other';
      service.switchWorkspace('/other');

      expect(service.current()).toMatchObject({
        tab: 'changes',
        scope: { kind: 'worktree' },
        target: { kind: 'none' },
      });
    });

    it('a switch drops a change set and a diff target but keeps a generic comparison and the tab', () => {
      const { service, active } = makeService();
      service.selectComparison('staged');
      service.openChangeSet({ workspaceRoot: '/ws', files: [{ path: 'a' }] });
      active.path = '/other';
      service.switchWorkspace('/other');
      expect(service.current().target).toEqual({ kind: 'none' });

      active.path = '/ws';
      service.selectComparison('staged');
      service.selectTab('task');
      const seq = service.current().seq;
      active.path = '/other';
      service.switchWorkspace('/other');

      expect(service.current()).toMatchObject({
        seq,
        tab: 'task',
        scope: { kind: 'staged' },
      });
    });

    it('a switch to the workspace the state belongs to changes nothing', async () => {
      const { service } = makeService();
      await openCommitIn(service);
      const before = service.current();
      service.switchWorkspace('/ws');
      expect(service.current()).toBe(before);
    });

    it('a switch asks before dropping the spot editor; Keep editing keeps it but drops the commit comparison', async () => {
      const { service, active } = makeService();
      await openCommitIn(service);
      service.openFile('/ws/a.ts');
      const guard = jest.fn(() => false);
      service.registerLeaveGuard(guard);

      active.path = '/other';
      service.switchWorkspace('/other');

      expect(guard).toHaveBeenCalledTimes(1);
      expect(service.current().scope).toEqual({ kind: 'worktree' });
      expect(service.current().target).toMatchObject({
        kind: 'file',
        request: { path: '/ws/a.ts' },
      });
    });

    it('a kept editor stays owned by its workspace across tab switches, so removing it still asks', () => {
      const { service, active } = makeService();
      const guard = jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
      service.registerLeaveGuard(guard);
      service.openFile('/ws/a.ts');

      active.path = '/other';
      service.switchWorkspace('/other'); // Keep editing
      service.selectTab('history');
      service.selectTab('changes');
      expect(service.current().target.kind).toBe('file');

      service.removeWorkspaceState('/ws');

      expect(guard).toHaveBeenCalledTimes(2);
      expect(service.current().target).toEqual({ kind: 'none' });
    });

    it('a switch drops the spot editor after Discard', () => {
      const { service, active } = makeService();
      service.openFile('/ws/a.ts');
      service.registerLeaveGuard(() => true);

      active.path = '/other';
      service.switchWorkspace('/other');

      expect(service.current().target).toEqual({ kind: 'none' });
    });

    it('a switch supersedes an open still reading the previous workspace', async () => {
      const { service } = makeService();
      let resolve!: (value: unknown) => void;
      mockRpcCall.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      const pending = service.openHistorical(SHA);

      // A rapid A -> B -> A switch leaves the active path where it started.
      service.switchWorkspace('/other');
      service.switchWorkspace('/ws');
      resolve({ success: true, data: reviewChanges() });

      expect(await pending).toEqual({ opened: false, error: null });
      expect(service.current().seq).toBe(0);
    });

    it('removing the workspace the state belongs to resets it; another workspace does not', async () => {
      const { service, active } = makeService();
      await openCommitIn(service);

      service.removeWorkspaceState('/elsewhere');
      expect(service.current().scope.kind).toBe('historical');

      active.path = null;
      service.removeWorkspaceState('/ws');
      expect(service.current()).toMatchObject({
        scope: { kind: 'worktree' },
        target: { kind: 'none' },
      });
    });
  });
});
