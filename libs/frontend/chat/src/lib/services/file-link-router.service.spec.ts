/**
 * `FileLinkRouterService` — the one implementation behind `FILE_LINK_OPENER`
 * and `MARKDOWN_FILE_LINK_HANDLER`.
 *
 * The fixtures build REAL DOM, because the whole contract of `resolveContext`
 * is which ancestor wins: a marker an agent authored inside its own rendered
 * markdown must never be the match (TASK_2026_413 R8).
 */
import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { FileLinkRouterService } from './file-link-router.service';

/**
 * `git-ui` is mocked at the module boundary: the real one drags in Monaco and
 * the whole dock, and the router's contract here is only WHICH calls it makes
 * in WHICH order. The classes are declared inside the factory and read back
 * with `requireMock`, so the DI tokens the router resolves and the ones the
 * TestBed provides are the same objects.
 */
const mockOpenFileView = jest.fn<Promise<void>, [unknown]>();
const mockSetMode = jest.fn();
jest.mock('@ptah-extension/git-ui', () => {
  class GitReviewService {
    setMode = mockSetMode;
  }
  class DiffTabsService {
    openFileView = mockOpenFileView;
  }
  return { GitReviewService, DiffTabsService };
});

/** Same boundary mock as `workspace-coordinator.service.spec.ts`. */
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

const gitUi = jest.requireMock<{
  GitReviewService: new () => unknown;
  DiffTabsService: new () => unknown;
}>('@ptah-extension/git-ui');

describe('FileLinkRouterService', () => {
  let setEditorPanelVisible: jest.Mock;
  let findTabByIdAcrossWorkspaces: jest.Mock;
  let isElectron: boolean;

  function configure(workspaceRoot = 'D:/active'): FileLinkRouterService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        FileLinkRouterService,
        gitUi.GitReviewService,
        gitUi.DiffTabsService,
        {
          provide: VSCodeService,
          useValue: {
            get isElectron() {
              return isElectron;
            },
            config: () => ({ workspaceRoot }),
          },
        },
        { provide: ElectronLayoutService, useValue: { setEditorPanelVisible } },
        {
          provide: TabManagerService,
          useValue: { findTabByIdAcrossWorkspaces },
        },
      ],
    });
    return TestBed.inject(FileLinkRouterService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    isElectron = true;
    setEditorPanelVisible = jest.fn();
    findTabByIdAcrossWorkspaces = jest.fn(() => null);
    mockOpenFileView.mockResolvedValue(undefined);
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * `<section data-ptah-file-links [markers]><markdown>…<a></markdown></section>`
   * — the shape an agent-output container plus ngx-markdown actually renders.
   */
  function renderAgentSurface(
    markers: Record<string, string>,
    innerHtml = '<p><a href="#">open</a></p>',
  ): HTMLAnchorElement {
    const surface = document.createElement('section');
    surface.setAttribute('data-ptah-file-links', '');
    for (const [name, value] of Object.entries(markers)) {
      surface.setAttribute(name, value);
    }
    const host = document.createElement('markdown');
    host.innerHTML = innerHtml;
    surface.appendChild(host);
    document.body.appendChild(surface);
    const anchor = host.querySelector('a');
    if (!anchor) throw new Error('fixture has no anchor');
    return anchor;
  }

  describe('context resolution', () => {
    it('resolves a background workspace root from the tab marker', async () => {
      findTabByIdAcrossWorkspaces.mockReturnValue({
        tab: { id: 'tab-bg' },
        workspacePath: 'D:/background-ws',
      });
      const router = configure();
      const anchor = renderAgentSurface({ 'data-ptah-tab-id': 'tab-bg' });

      await router.open({ path: 'src/a.ts', line: 12, origin: anchor });

      expect(findTabByIdAcrossWorkspaces).toHaveBeenCalledWith('tab-bg');
      expect(mockOpenFileView).toHaveBeenCalledWith({
        path: 'src/a.ts',
        line: 12,
        column: undefined,
        workspaceRoot: 'D:/background-ws',
        documentPath: undefined,
      });
    });

    it('IGNORES a tab marker an agent authored inside the rendered markdown', async () => {
      const router = configure('D:/active');
      const anchor = renderAgentSurface(
        {},
        '<div data-ptah-tab-id="forged"><a href="#">open</a></div>',
      );

      await router.open({ path: 'src/a.ts', origin: anchor });

      expect(findTabByIdAcrossWorkspaces).not.toHaveBeenCalled();
      expect(mockOpenFileView).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: 'D:/active' }),
      );
    });

    it('IGNORES a forged document marker inside the rendered markdown', async () => {
      const router = configure('D:/active');
      const anchor = renderAgentSurface(
        {},
        '<div data-ptah-link-document="D:/elsewhere/x.md" data-ptah-link-root="D:/elsewhere"><a href="#">open</a></div>',
      );

      await router.open({ path: 'src/a.ts', origin: anchor });

      expect(mockOpenFileView).toHaveBeenCalledWith(
        expect.objectContaining({
          documentPath: undefined,
          workspaceRoot: 'D:/active',
        }),
      );
    });

    it('passes documentPath and root from a previewed-document context', async () => {
      const router = configure();
      const anchor = renderAgentSurface({
        'data-ptah-link-document': 'D:/ws/docs/readme.md',
        'data-ptah-link-root': 'D:/ws',
      });

      await router.open({ path: './sibling.md', origin: anchor });

      expect(mockOpenFileView).toHaveBeenCalledWith({
        path: './sibling.md',
        line: undefined,
        column: undefined,
        workspaceRoot: 'D:/ws',
        documentPath: 'D:/ws/docs/readme.md',
      });
    });

    it('falls back to the active workspace root with no origin at all', async () => {
      const router = configure('D:/active');

      await router.open({ path: 'src/a.ts' });

      expect(mockOpenFileView).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: 'D:/active' }),
      );
    });

    it('sends no root when the active workspace root is empty', async () => {
      const router = configure('');

      await router.open({ path: 'D:/abs/a.ts' });

      expect(mockOpenFileView).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: undefined }),
      );
    });
  });

  describe('Electron branch', () => {
    it('reveals the dock, switches to working-tree mode, then opens the tab', async () => {
      const router = configure();

      await router.open({ path: 'src/a.ts', line: 12, column: 3 });

      expect(setEditorPanelVisible).toHaveBeenCalledWith(true);
      expect(mockSetMode).toHaveBeenCalledWith('working-tree');
      expect(mockOpenFileView).toHaveBeenCalledWith(
        expect.objectContaining({ line: 12, column: 3 }),
      );
    });

    it('logs and rejects when the dock fails to open, leaving the failure visible', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('chunk load failed');
      mockOpenFileView.mockRejectedValue(failure);
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).rejects.toThrow(failure);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileLinkRouter]'),
        failure,
      );
      errorSpy.mockRestore();
    });
  });

  describe('VS Code branch', () => {
    beforeEach(() => {
      isElectron = false;
    });

    it('calls file:open with line, column and the resolved root', async () => {
      findTabByIdAcrossWorkspaces.mockReturnValue({
        tab: { id: 'tab-1' },
        workspacePath: 'D:/ws-1',
      });
      const router = configure();
      const anchor = renderAgentSurface({ 'data-ptah-tab-id': 'tab-1' });

      await router.open({
        path: 'src/a.ts',
        line: 12,
        column: 3,
        origin: anchor,
      });

      expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), 'file:open', {
        path: 'src/a.ts',
        line: 12,
        column: 3,
        workspaceRoot: 'D:/ws-1',
      });
      expect(mockOpenFileView).not.toHaveBeenCalled();
    });

    it('rejects with the host reason when the RPC refuses the path', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockRpcCall.mockResolvedValue({
        success: true,
        data: { success: false, error: 'Path is outside the workspace' },
      });
      const router = configure();

      await expect(router.open({ path: 'D:/other/a.ts' })).rejects.toThrow(
        'Path is outside the workspace',
      );
      errorSpy.mockRestore();
    });
  });

  describe('MarkdownFileLinkHandler', () => {
    it('forwards the anchor as the origin', async () => {
      findTabByIdAcrossWorkspaces.mockReturnValue({
        tab: { id: 'tab-2' },
        workspacePath: 'D:/ws-2',
      });
      const router = configure();
      const anchor = renderAgentSurface({ 'data-ptah-tab-id': 'tab-2' });

      await router.handleMarkdownFileLink(
        { path: 'src/a.ts', line: 4, column: 2 },
        anchor,
      );

      expect(mockOpenFileView).toHaveBeenCalledWith({
        path: 'src/a.ts',
        line: 4,
        column: 2,
        workspaceRoot: 'D:/ws-2',
        documentPath: undefined,
      });
    });
  });
});
