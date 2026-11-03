import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService } from '@ptah-extension/core';
import { SessionGitDockOpener } from './session-git-dock-opener.service';

// git-ui is reached by dynamic import only (a static import would trip
// `@nx/enforce-module-boundaries`' dynamic-dependency guard), as in
// `workspace-coordinator.service.spec.ts`.
jest.mock('@pierre/diffs', () => ({}));
jest.mock('@pierre/diffs/worker', () => ({}));

describe('SessionGitDockOpener', () => {
  const calls: string[] = [];
  const store = {
    showSession: jest.fn((tabId: string) => calls.push(`show:${tabId}`)),
  };
  const navigation = {
    selectTab: jest.fn((tab: string) => calls.push(`tab:${tab}`)),
  };
  const layout = {
    setEditorPanelVisible: jest.fn((visible: boolean) =>
      calls.push(`dock:${visible}`),
    ),
  };

  beforeEach(async () => {
    calls.length = 0;
    jest.clearAllMocks();
    const { GitDockScopeStore, ReviewNavigationService } = await import(
      '@ptah-extension/git-ui/services'
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: GitDockScopeStore, useValue: store },
        { provide: ReviewNavigationService, useValue: navigation },
        { provide: ElectronLayoutService, useValue: layout },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('scopes the dock to the session, selects Changes and opens the dock', async () => {
    await TestBed.inject(SessionGitDockOpener).open('tab-7');

    expect(calls).toEqual(['show:tab-7', 'tab:changes', 'dock:true']);
  });

  it('logs and leaves the dock alone when the scope cannot be applied', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {
      /* expected */
    });
    store.showSession.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await TestBed.inject(SessionGitDockOpener).open('tab-7');

    expect(layout.setEditorPanelVisible).not.toHaveBeenCalledWith(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
