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
});
