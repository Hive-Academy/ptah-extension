/**
 * GitDockComponent — arming specs (TASK_2026_385 Batch 3.1).
 *
 * The constructor is the armer that `git-status.service.ts` has no other
 * caller for once `EditorPanelComponent`'s `ngOnInit`/`ngOnDestroy` stop
 * being the sole entry point in the Electron shell. These specs assert the
 * constructor arms both `GitStatusService` and `GitBranchesService`, and that
 * `destroyRef.onDestroy` (fired by `fixture.destroy()`) disarms both.
 *
 * Rendered tab-strip specs replace the three child surfaces with inert stubs,
 * keeping the dock tests isolated from `SourceControlService`,
 * `WorktreeService`, `MonacoLoaderService`, and their rendering concerns.
 *
 * `rpcCall` is mocked at the module boundary, matching the pattern in
 * `git-status.service.spec.ts` / `git-branches.service.spec.ts`.
 */

import { Component, computed, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GitFileStatus } from '@ptah-extension/shared';
import { GitStatusService } from '../services/git-status.service';
import { GitBranchesService } from '../services/git-branches.service';
import { DiffTabsService } from '../services/diff-tabs.service';
import type {
  EditorTab,
  HunkApplyFn,
  OpenDiffRequest,
} from '../types/diff-tab.types';

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
const { VSCodeService } = jest.requireActual('@ptah-extension/core');
const { GitDockComponent } = jest.requireActual(
  './git-dock.component',
) as typeof import('./git-dock.component');

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
  const tabs = signal<EditorTab[]>([]);
  const activeKey = signal<string | null>(null);
  const activateDiff = jest.fn((key: string) => {
    if (tabs().some((tab) => tab.filePath === key)) activeKey.set(key);
  });
  const closeDiff = jest.fn((key: string) => {
    const remaining = tabs().filter((tab) => tab.filePath !== key);
    if (remaining.length === tabs().length) return;
    tabs.set(remaining);
    if (activeKey() === key) activeKey.set(remaining.at(-1)?.filePath ?? null);
  });

  return {
    diffTabs: tabs.asReadonly(),
    activeDiffKey: activeKey.asReadonly(),
    activeDiffTab: computed(
      () => tabs().find((tab) => tab.filePath === activeKey()) ?? null,
    ),
    openDiffKeys: computed(() => tabs().map((tab) => tab.filePath)),
    applyHunksFn: jest.fn() as unknown as HunkApplyFn,
    openDiff: jest.fn(),
    activateDiff,
    closeDiff,
    refreshDiffTab: jest.fn(),
    setTabs(nextTabs: EditorTab[], nextActiveKey: string | null): void {
      tabs.set(nextTabs);
      activeKey.set(nextActiveKey);
    },
  };
}

function makeTab(filePath: string, fileName: string): EditorTab {
  return { filePath, fileName, content: '', isDirty: false };
}

@Component({ selector: 'ptah-git-dock-header', standalone: true, template: '' })
class GitDockHeaderStubComponent {}

@Component({
  selector: 'ptah-source-control-panel',
  standalone: true,
  template: '',
})
class SourceControlPanelStubComponent {
  readonly files = input.required<GitFileStatus[]>();
  readonly diffRequested = output<OpenDiffRequest>();
  readonly fileClicked = output<string>();
}

@Component({ selector: 'ptah-diff-view', standalone: true, template: '' })
class DiffViewStubComponent {
  readonly diffTab = input.required<EditorTab>();
  readonly openDiffKeys = input.required<readonly string[]>();
  readonly applyHunks = input.required<HunkApplyFn>();
  readonly retryRequested = output<string>();
}

describe('GitDockComponent', () => {
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

  function createRenderedDock() {
    TestBed.overrideComponent(GitDockComponent, {
      set: {
        imports: [
          GitDockHeaderStubComponent,
          SourceControlPanelStubComponent,
          DiffViewStubComponent,
        ],
      },
    });
    const fixture = TestBed.createComponent(GitDockComponent);
    fixture.detectChanges();
    return fixture;
  }

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

  it('renders one accessible tab per open diff, in open order', () => {
    diffTabs.setTabs(
      [makeTab('first-key', 'first.ts'), makeTab('second-key', 'second.ts')],
      'second-key',
    );
    const fixture = createRenderedDock();

    const tablist = fixture.nativeElement.querySelector('[role="tablist"]');
    const tabs = [
      ...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    const panel = fixture.nativeElement.querySelector(
      '[role="tabpanel"]',
    ) as HTMLElement;
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'first.ts',
      'second.ts',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    expect(
      tabs.every((tab) => tab.getAttribute('aria-controls') === panel.id),
    ).toBe(true);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1].id);
  });

  it('activates an inactive tab without opening or refreshing its diff', () => {
    diffTabs.setTabs(
      [makeTab('first-key', 'first.ts'), makeTab('second-key', 'second.ts')],
      'second-key',
    );
    const fixture = createRenderedDock();

    const firstTab = fixture.nativeElement.querySelector(
      '[role="tab"]',
    ) as HTMLButtonElement;
    firstTab.click();
    fixture.detectChanges();

    expect(diffTabs.activateDiff).toHaveBeenCalledWith('first-key');
    expect(diffTabs.openDiff).not.toHaveBeenCalled();
    expect(diffTabs.refreshDiffTab).not.toHaveBeenCalled();
    expect(firstTab.getAttribute('aria-selected')).toBe('true');
  });

  it('closes the tab whose sibling close button was clicked', () => {
    diffTabs.setTabs(
      [makeTab('first-key', 'first.ts'), makeTab('second-key', 'second.ts')],
      'second-key',
    );
    const fixture = createRenderedDock();

    const closeFirst = fixture.nativeElement.querySelector(
      'button[aria-label="Close diff for first.ts"]',
    ) as HTMLButtonElement;
    const activationControl = closeFirst.parentElement?.querySelector(
      '[role="tab"]',
    ) as HTMLButtonElement;
    expect(activationControl.contains(closeFirst)).toBe(false);
    closeFirst.click();
    fixture.detectChanges();

    expect(diffTabs.closeDiff).toHaveBeenCalledWith('first-key');
    expect(
      [...fixture.nativeElement.querySelectorAll('[role="tab"]')].map((tab) =>
        (tab as HTMLElement).textContent?.trim(),
      ),
    ).toEqual(['second.ts']);
  });

  it('falls back to the last remaining tab after closing the active tab', () => {
    diffTabs.setTabs(
      [makeTab('first-key', 'first.ts'), makeTab('second-key', 'second.ts')],
      'second-key',
    );
    const fixture = createRenderedDock();

    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Close diff for second.ts"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const remaining = fixture.nativeElement.querySelector(
      '[role="tab"]',
    ) as HTMLButtonElement;
    expect(diffTabs.activeDiffKey()).toBe('first-key');
    expect(remaining.getAttribute('aria-selected')).toBe('true');
  });

  it('hides the tab strip and diff panel after closing the final tab', () => {
    diffTabs.setTabs([makeTab('only-key', 'only.ts')], 'only-key');
    const fixture = createRenderedDock();

    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Close diff for only.ts"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it('moves between tabs with arrow keys and closes one with Delete', () => {
    diffTabs.setTabs(
      [makeTab('first-key', 'first.ts'), makeTab('second-key', 'second.ts')],
      'second-key',
    );
    const fixture = createRenderedDock();
    const tabs =
      fixture.nativeElement.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    tabs[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(diffTabs.activateDiff).toHaveBeenCalledWith('first-key');
    expect(document.activeElement).toBe(tabs[0]);

    tabs[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    expect(diffTabs.closeDiff).toHaveBeenCalledWith('first-key');
  });
});
