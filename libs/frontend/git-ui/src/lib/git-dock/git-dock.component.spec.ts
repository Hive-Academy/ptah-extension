/**
 * GitDockComponent — arming specs (TASK_2026_385 Batch 3.1).
 *
 * The constructor is the armer that `git-status.service.ts` has no other
 * caller for once `EditorPanelComponent`'s `ngOnInit`/`ngOnDestroy` stop
 * being the sole entry point in the Electron shell. These specs assert the
 * constructor arms both `GitStatusService` and `GitBranchesService`, and that
 * `destroyRef.onDestroy` (fired by `fixture.destroy()`) disarms both.
 *
 * Child components (`GitDockHeaderComponent`, `SourceControlPanelComponent`,
 * `DiffViewComponent`) are never instantiated in this suite — Angular only
 * creates them on the first `detectChanges()`, and this suite intentionally
 * never calls it, so the arming behaviour is exercised in isolation from
 * their own dependencies (`SourceControlService`, `WorktreeService`,
 * `MonacoLoaderService`, etc).
 *
 * `rpcCall` is mocked at the module boundary, matching the pattern in
 * `git-status.service.spec.ts` / `git-branches.service.spec.ts`.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitDockComponent } from './git-dock.component';
import { GitStatusService } from '../services/git-status.service';
import { GitBranchesService } from '../services/git-branches.service';
import { DiffTabsService } from '../services/diff-tabs.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

function makeVscodeStub() {
  const _config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: _config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

function makeGitStatusStub() {
  return {
    startListening: jest.fn(),
    stopListening: jest.fn(),
    files: jest.fn(() => []),
  };
}

function makeGitBranchesStub() {
  return {
    startListening: jest.fn(),
    stopListening: jest.fn(),
    refreshBranches: jest.fn(async () => undefined),
  };
}

function makeDiffTabsStub() {
  return {
    activeDiffTab: jest.fn(() => null),
    openDiffKeys: jest.fn(() => []),
    applyHunksFn: jest.fn(),
    openDiff: jest.fn(),
    refreshDiffTab: jest.fn(),
  };
}

describe('GitDockComponent — arm on construction, disarm on destroy', () => {
  let gitStatus: ReturnType<typeof makeGitStatusStub>;
  let gitBranches: ReturnType<typeof makeGitBranchesStub>;
  let diffTabs: ReturnType<typeof makeDiffTabsStub>;

  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });

    gitStatus = makeGitStatusStub();
    gitBranches = makeGitBranchesStub();
    diffTabs = makeDiffTabsStub();

    TestBed.configureTestingModule({
      imports: [GitDockComponent],
      providers: [
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: DiffTabsService, useValue: diffTabs },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
  });

  it('arms GitStatusService.startListening() on construction', () => {
    TestBed.createComponent(GitDockComponent);

    expect(gitStatus.startListening).toHaveBeenCalledTimes(1);
  });

  it('arms GitBranchesService.startListening() + refreshBranches() on construction', () => {
    TestBed.createComponent(GitDockComponent);

    expect(gitBranches.startListening).toHaveBeenCalledTimes(1);
    expect(gitBranches.refreshBranches).toHaveBeenCalledTimes(1);
  });

  it('disarms both services when the component is destroyed', () => {
    const fixture = TestBed.createComponent(GitDockComponent);
    expect(gitStatus.stopListening).not.toHaveBeenCalled();
    expect(gitBranches.stopListening).not.toHaveBeenCalled();

    fixture.destroy();

    expect(gitStatus.stopListening).toHaveBeenCalledTimes(1);
    expect(gitBranches.stopListening).toHaveBeenCalledTimes(1);
  });

  it('re-arms idempotently: a fresh instance after a prior destroy calls startListening again', () => {
    const first = TestBed.createComponent(GitDockComponent);
    first.destroy();

    TestBed.createComponent(GitDockComponent);

    expect(gitStatus.startListening).toHaveBeenCalledTimes(2);
    expect(gitBranches.startListening).toHaveBeenCalledTimes(2);
  });

  it('routes a file-name click to the file:open RPC', () => {
    const fixture = TestBed.createComponent(GitDockComponent);
    const component = fixture.componentInstance as unknown as {
      onFileClicked: (path: string) => void;
    };

    component.onFileClicked('src/a.ts');

    expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), 'file:open', {
      path: 'src/a.ts',
    });
  });
});
