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
 * `git-ui` is mocked at the module boundary: the real one drags in the whole
 * review shell, and the router's contract here is only WHICH calls it makes
 * in WHICH order. The class is declared inside the factory and read back
 * with `requireMock`, so the DI token the router resolves and the one the
 * TestBed provides are the same object.
 */
const mockOpenFile = jest.fn<
  void,
  [string, number | undefined, Record<string, unknown> | undefined]
>();
jest.mock('@ptah-extension/git-ui', () => {
  class ReviewNavigationService {
    openFile = mockOpenFile;
  }
  return { ReviewNavigationService };
});

/** The request the router asked `ReviewNavigationService.openFile` for. */
function openedRequest(): Record<string, unknown> | undefined {
  const call = mockOpenFile.mock.calls[0];
  if (!call) return undefined;
  const [path, line, options] = call;
  return {
    path,
    line,
    column: options?.['column'],
    workspaceRoot: options?.['workspaceRoot'],
    documentPath: options?.['documentPath'],
  };
}

/** Same boundary mock as `workspace-coordinator.service.spec.ts`. */
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

describe('FileLinkRouterService', () => {
  let setEditorPanelVisible: jest.Mock;
  let editorPanelVisible: jest.Mock;
  let findTabByIdAcrossWorkspaces: jest.Mock;
  let isElectron: boolean;

  function configure(workspaceRoot = 'D:/active'): FileLinkRouterService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        FileLinkRouterService,
        gitUi.ReviewNavigationService,
        {
          provide: VSCodeService,
          useValue: {
            get isElectron() {
              return isElectron;
            },
            config: () => ({ workspaceRoot }),
          },
        },
        {
          provide: ElectronLayoutService,
          useValue: { setEditorPanelVisible, editorPanelVisible },
        },
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
    mockOpenFile.mockReset();
    isElectron = true;
    setEditorPanelVisible = jest.fn();
    editorPanelVisible = jest.fn(() => false);
    findTabByIdAcrossWorkspaces = jest.fn(() => null);
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
      expect(openedRequest()).toEqual({
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
      expect(openedRequest()).toEqual(
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

      expect(openedRequest()).toEqual(
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

      expect(openedRequest()).toEqual({
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

      expect(openedRequest()).toEqual(
        expect.objectContaining({ workspaceRoot: 'D:/active' }),
      );
    });

    it('sends no root when the active workspace root is empty', async () => {
      const router = configure('');

      await router.open({ path: 'D:/abs/a.ts' });

      expect(openedRequest()).toEqual(
        expect.objectContaining({ workspaceRoot: undefined }),
      );
    });
  });

  describe('Electron branch', () => {
    it('reveals the dock, then opens the file read-only through ReviewNavigationService', async () => {
      const router = configure();

      await router.open({ path: 'src/a.ts', line: 12, column: 3 });

      expect(setEditorPanelVisible).toHaveBeenCalledWith(true);
      expect(mockOpenFile).toHaveBeenCalledTimes(1);
      expect(mockOpenFile).toHaveBeenCalledWith('src/a.ts', 12, {
        column: 3,
        workspaceRoot: 'D:/active',
        documentPath: undefined,
      });
      // Never editable: a chat link opens read-only (design-spec §7).
      expect(mockOpenFile.mock.calls[0]?.[2]).not.toHaveProperty('editable');
    });

    it('logs and rejects when the dock fails to open, leaving the failure visible', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('chunk load failed');
      mockOpenFile.mockImplementation(() => {
        throw failure;
      });
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).rejects.toThrow(failure);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FileLinkRouter]'),
        failure,
      );
      errorSpy.mockRestore();
    });

    // L-11. `setEditorPanelVisible(true)` runs before the dynamic import so the
    // two fetches overlap; on failure that reveal has to be undone, or the user
    // is left staring at a dock they did not open with nothing in it.
    it('hides the dock again when the open fails and the dock was hidden before', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      editorPanelVisible.mockReturnValue(false);
      mockOpenFile.mockImplementation(() => {
        throw new Error('chunk load failed');
      });
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).rejects.toThrow();

      expect(setEditorPanelVisible.mock.calls).toEqual([[true], [false]]);
      errorSpy.mockRestore();
    });

    it('leaves an ALREADY-open dock open when the open fails', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      editorPanelVisible.mockReturnValue(true);
      mockOpenFile.mockImplementation(() => {
        throw new Error('chunk load failed');
      });
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).rejects.toThrow();

      expect(setEditorPanelVisible).not.toHaveBeenCalledWith(false);
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
      expect(mockOpenFile).not.toHaveBeenCalled();
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

    // L-6. Cancelling the host's confirmation is a choice, not a fault. The
    // typed `cancelled` flag is the whole detection — the message is display
    // copy and is deliberately never matched on.
    it('RESOLVES when the user cancelled the host confirmation', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockRpcCall.mockResolvedValue({
        success: true,
        data: {
          success: false,
          cancelled: true,
          error: 'Opening that file was cancelled.',
        },
      });
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).resolves.toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    // L-8. An envelope that transported fine but carried no payload (handler
    // unregistered, response-shape drift) is NOT an opened file. Success is
    // asserted positively so this reports a failure instead of a silent no-op.
    it('rejects when the transport succeeded but the host returned no payload', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockRpcCall.mockResolvedValue({ success: true, data: undefined });
      const router = configure();

      await expect(router.open({ path: 'src/a.ts' })).rejects.toThrow(
        'Failed to open src/a.ts',
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

      expect(openedRequest()).toEqual({
        path: 'src/a.ts',
        line: 4,
        column: 2,
        workspaceRoot: 'D:/ws-2',
        documentPath: undefined,
      });
    });
  });
});
