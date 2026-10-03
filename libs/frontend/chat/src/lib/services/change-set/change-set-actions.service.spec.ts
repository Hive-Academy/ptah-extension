/**
 * `ChangeSetActionsService` — VS Code command names and arguments, and the
 * Electron dock path (TASK_2026_576, Component 20).
 *
 * `git-ui` and `rpcCall` are mocked at their module boundaries, the same way
 * `file-link-router.service.spec.ts` does it.
 */
import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import type { TurnChangeSet } from '@ptah-extension/shared';
import {
  ChangeSetActionsService,
  REVIEW_COMMANDS,
} from './change-set-actions.service';
import { ChangeSetStore, type ChangeSetMarks } from './change-set.store';

const mockOpenChangeSet = jest.fn();
const mockOpenFile = jest.fn();
const mockSelectComparison = jest.fn();
jest.mock('@ptah-extension/git-ui', () => {
  class ReviewNavigationService {
    openChangeSet = mockOpenChangeSet;
    openFile = mockOpenFile;
    selectComparison = mockSelectComparison;
  }
  return { ReviewNavigationService };
});

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

const gitUi = jest.requireMock<{
  ReviewNavigationService: new () => unknown;
}>('@ptah-extension/git-ui');

const CHANGE_SET: TurnChangeSet = {
  sessionId: 's1',
  workspaceRoot: 'D:/repo',
  turnStartedAt: 1,
  turnEndedAt: 2,
  files: [
    { path: 'src/a.ts', status: 'M', additions: 1, deletions: 1 },
    {
      path: 'src/new-name.ts',
      origPath: 'src/old-name.ts',
      status: 'R',
      additions: 0,
      deletions: 0,
    },
    { path: 'src/conflict.ts', status: 'U', additions: null, deletions: null },
  ],
  truncatedCount: 0,
  totals: { files: 3, additions: 1, deletions: 1 },
  countsUnavailable: false,
};

const NO_MARKS: ChangeSetMarks = {
  reconciled: new Set(),
  conflicted: new Set(),
};

describe('ChangeSetActionsService', () => {
  let isElectron: boolean;
  let marks: ChangeSetMarks;
  let setEditorPanelVisible: jest.Mock;
  let editorPanelVisible: jest.Mock;
  let error: jest.SpyInstance;

  function create(): ChangeSetActionsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        gitUi.ReviewNavigationService,
        {
          provide: VSCodeService,
          useValue: {
            get isElectron() {
              return isElectron;
            },
          },
        },
        {
          provide: ElectronLayoutService,
          useValue: { setEditorPanelVisible, editorPanelVisible },
        },
        { provide: ChangeSetStore, useValue: { marksFor: () => marks } },
      ],
    });
    return TestBed.inject(ChangeSetActionsService);
  }

  function commandCall(): unknown {
    return mockRpcCall.mock.calls[0]?.[2];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenChangeSet.mockReset();
    mockOpenFile.mockReset();
    mockSelectComparison.mockReset();
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    isElectron = false;
    marks = NO_MARKS;
    setEditorPanelVisible = jest.fn();
    editorPanelVisible = jest.fn(() => false);
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });
  });

  afterEach(() => error.mockRestore());

  describe('VS Code', () => {
    it('reviews the whole set with ptah.review.openChanges', async () => {
      await create().review(CHANGE_SET);

      expect(mockRpcCall).toHaveBeenCalledWith(
        expect.anything(),
        'command:execute',
        {
          command: REVIEW_COMMANDS.openChanges,
          args: [
            {
              workspaceRoot: 'D:/repo',
              files: [
                { path: 'src/a.ts', status: 'M' },
                {
                  path: 'src/new-name.ts',
                  origPath: 'src/old-name.ts',
                  status: 'R',
                },
                { path: 'src/conflict.ts', status: 'U' },
              ],
            },
          ],
        },
        30_000,
      );
    });

    it('opens a file with ptah.review.openDiff, passing the rename source', async () => {
      await create().openFile(CHANGE_SET, 'src/new-name.ts');

      expect(commandCall()).toEqual({
        command: REVIEW_COMMANDS.openDiff,
        args: [
          {
            workspaceRoot: 'D:/repo',
            path: 'src/new-name.ts',
            origPath: 'src/old-name.ts',
            status: 'R',
          },
        ],
      });
    });

    it('opens a recorded U file with ptah.review.openMerge while the store marks it conflicted', async () => {
      // The store's fallback when no trustworthy status exists.
      marks = {
        reconciled: new Set(),
        conflicted: new Set(['src/conflict.ts']),
      };

      await create().openFile(CHANGE_SET, 'src/conflict.ts');

      expect(commandCall()).toEqual({
        command: REVIEW_COMMANDS.openMerge,
        args: [
          { workspaceRoot: 'D:/repo', path: 'src/conflict.ts', status: 'U' },
        ],
      });
    });

    it('opens a file the current status reports conflicted with openMerge', async () => {
      marks = { reconciled: new Set(), conflicted: new Set(['src/a.ts']) };

      await create().openFile(CHANGE_SET, 'src/a.ts');

      expect(commandCall()).toEqual(
        expect.objectContaining({ command: REVIEW_COMMANDS.openMerge }),
      );
    });

    it('opens the diff of a recorded U file whose conflict the current status no longer reports', async () => {
      marks = {
        reconciled: new Set(['src/conflict.ts']),
        conflicted: new Set(),
      };

      await create().openFile(CHANGE_SET, 'src/conflict.ts');

      expect(commandCall()).toEqual(
        expect.objectContaining({ command: REVIEW_COMMANDS.openDiff }),
      );
    });

    it('opens Source Control with ptah.review.openScm', async () => {
      await create().openScm();

      expect(commandCall()).toEqual({
        command: REVIEW_COMMANDS.openScm,
        args: [],
      });
    });

    it('rejects with the host reason when the command fails', async () => {
      mockRpcCall.mockResolvedValue({
        success: true,
        data: { success: false, error: 'Path is outside the workspace.' },
      });

      await expect(create().review(CHANGE_SET)).rejects.toThrow(
        'Path is outside the workspace.',
      );
    });

    it('rejects when the transport returns no result', async () => {
      mockRpcCall.mockResolvedValue({ success: true, data: undefined });

      await expect(create().openScm()).rejects.toThrow(
        'The review could not be opened.',
      );
    });

    it('rejects a path that is not in the set without calling the host', async () => {
      await expect(
        create().openFile(CHANGE_SET, 'elsewhere.ts'),
      ).rejects.toThrow('elsewhere.ts is not part of this change set.');
      expect(mockRpcCall).not.toHaveBeenCalled();
    });
  });

  describe('Electron', () => {
    beforeEach(() => {
      isElectron = true;
    });

    it('reveals the dock on the Changes tab narrowed to the turn, drafts owned by its session', async () => {
      await create().review(CHANGE_SET);

      expect(setEditorPanelVisible).toHaveBeenCalledWith(true);
      expect(mockOpenChangeSet).toHaveBeenCalledWith({
        workspaceRoot: 'D:/repo',
        files: [
          { path: 'src/a.ts' },
          { path: 'src/new-name.ts', origPath: 'src/old-name.ts' },
          { path: 'src/conflict.ts' },
        ],
        ownerSessionId: 's1',
      });
      expect(mockOpenFile).not.toHaveBeenCalled();
      expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it('opens one file in the spot editor rooted at the set working directory', async () => {
      await create().openFile(CHANGE_SET, 'src/a.ts');

      expect(setEditorPanelVisible).toHaveBeenCalledWith(true);
      expect(mockOpenFile).toHaveBeenCalledWith('src/a.ts', undefined, {
        workspaceRoot: 'D:/repo',
      });
      expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it('opens Source Control as the working-tree comparison', async () => {
      await create().openScm();

      expect(setEditorPanelVisible).toHaveBeenCalledWith(true);
      expect(mockSelectComparison).toHaveBeenCalledWith('worktree');
      expect(mockRpcCall).not.toHaveBeenCalled();
    });

    it('hides a dock it revealed when the open fails', async () => {
      mockOpenFile.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(create().openFile(CHANGE_SET, 'src/a.ts')).rejects.toThrow(
        'Could not open src/a.ts.',
      );
      expect(setEditorPanelVisible).toHaveBeenLastCalledWith(false);
    });

    it('leaves an already visible dock visible when the review fails', async () => {
      editorPanelVisible.mockReturnValue(true);
      mockOpenChangeSet.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(create().review(CHANGE_SET)).rejects.toThrow(
        'Could not open the review.',
      );
      expect(setEditorPanelVisible).not.toHaveBeenCalledWith(false);
    });
  });
});
