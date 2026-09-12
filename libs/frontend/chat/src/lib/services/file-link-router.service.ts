import { Injectable, Injector, inject } from '@angular/core';
import {
  ElectronLayoutService,
  VSCodeService,
  rpcCall,
  type FileLinkOpenRequest,
  type IFileLinkOpener,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  MarkdownFileLinkHandler,
  MarkdownFileLinkTarget,
} from '@ptah-extension/markdown';
import type { FileOpenResult } from '@ptah-extension/shared';

const LOG_PREFIX = '[FileLinkRouter]';

/** Hosts rendered markdown. The context search deliberately starts OUTSIDE it. */
const MARKDOWN_HOST_SELECTOR = 'markdown, [markdown]';

/** Previewed-document context (git-ui file view) or agent-output tab context. */
const LINK_CONTEXT_SELECTOR = '[data-ptah-link-document], [data-ptah-tab-id]';

const DOCUMENT_ATTR = 'data-ptah-link-document';
const ROOT_ATTR = 'data-ptah-link-root';
const TAB_ID_ATTR = 'data-ptah-tab-id';

/** Everything the DOM can tell us about where a clicked link came from. */
interface LinkContext {
  /** The previewed markdown document the link was written in, if any. */
  readonly documentPath?: string;
  /** The workspace the path should resolve against, if one is known. */
  readonly workspaceRoot?: string;
}

/**
 * Routes a clicked file link to the right surface for the host.
 *
 * It is the one implementation behind two ports:
 * - {@link IFileLinkOpener} (`FILE_LINK_OPENER`), used by the tool-call
 *   `FilePathLinkComponent` and the tasks board;
 * - `MarkdownFileLinkHandler` (`MARKDOWN_FILE_LINK_HANDLER`), used by the
 *   markdown library's document-level link listener.
 *
 * The composition root binds both tokens to this single instance, so every
 * entry point resolves context and routes identically.
 *
 * ## Why the context search starts outside `<markdown>`
 *
 * A path is usually workspace-relative, so it only means something against a
 * root. The root comes from a DOM marker written by an Angular host binding on
 * an agent-output container. Rendered agent markdown can contain arbitrary
 * attributes, so the search starts at the markdown host's PARENT: an attribute
 * the agent authored inside its own output is never the match. The backend
 * re-authorizes every path regardless — this only stops a wrong-root read.
 *
 * ## Why git-ui is imported dynamically
 *
 * `@ptah-extension/git-ui` carries Monaco and the whole dock. A static import
 * here would pull it into the eager chat chunk, and chat loads on every host
 * including VS Code, where the dock does not exist. Same pattern as
 * `WorkspaceCoordinatorService.resolveGitServices`.
 */
@Injectable({ providedIn: 'root' })
export class FileLinkRouterService
  implements IFileLinkOpener, MarkdownFileLinkHandler
{
  private readonly vscode = inject(VSCodeService);
  private readonly layout = inject(ElectronLayoutService);
  private readonly tabManager = inject(TabManagerService);
  private readonly injector = inject(Injector);

  /**
   * `MarkdownFileLinkHandler`. The listener has already called
   * `preventDefault()`, so the navigation is gone whatever happens here; the
   * returned promise lets the listener log a rejection.
   */
  handleMarkdownFileLink(
    target: MarkdownFileLinkTarget,
    anchor: HTMLAnchorElement,
  ): Promise<void> {
    return this.open({ ...target, origin: anchor });
  }

  /**
   * `IFileLinkOpener`. Rejects when the file could not be routed, so a caller
   * that shows an error (the tasks board) shows it only on a real failure.
   *
   * A backend refusal is NOT a rejection on Electron: the dock renders a
   * blocked tab with the reason. On VS Code the host shows a native warning.
   */
  async open(request: FileLinkOpenRequest): Promise<void> {
    const context = this.resolveContext(request.origin ?? null);
    if (this.vscode.isElectron) {
      await this.openInDock(request, context);
      return;
    }
    await this.openInVsCode(request, context);
  }

  /**
   * Reveal the dock, put it in working-tree mode, and add a read-only tab.
   *
   * `setEditorPanelVisible` runs FIRST and synchronously: it is what triggers
   * the shell's lazy dock load, so the dock chunk and this import fetch in
   * parallel rather than in series.
   */
  private async openInDock(
    request: FileLinkOpenRequest,
    context: LinkContext,
  ): Promise<void> {
    this.layout.setEditorPanelVisible(true);
    try {
      const git = await import('@ptah-extension/git-ui');
      this.injector.get(git.GitReviewService).setMode('working-tree');
      await this.injector.get(git.DiffTabsService).openFileView({
        path: request.path,
        line: request.line,
        column: request.column,
        workspaceRoot: context.workspaceRoot,
        documentPath: context.documentPath,
      });
    } catch (error: unknown) {
      console.error(`${LOG_PREFIX} Failed to open ${request.path}`, error);
      throw error instanceof Error
        ? error
        : new Error(`Failed to open ${request.path}`);
    }
  }

  /**
   * VS Code opens the file natively. `documentPath` has no VS Code producer —
   * the markdown preview is an Electron dock surface — so it is not sent.
   */
  private async openInVsCode(
    request: FileLinkOpenRequest,
    context: LinkContext,
  ): Promise<void> {
    const result = await rpcCall<FileOpenResult>(this.vscode, 'file:open', {
      path: request.path,
      line: request.line,
      column: request.column,
      workspaceRoot: context.workspaceRoot,
    });
    if (result.success && result.data?.success !== false) return;

    const reason =
      result.data?.error ?? result.error ?? `Failed to open ${request.path}`;
    console.error(`${LOG_PREFIX} ${reason}`);
    throw new Error(reason);
  }

  /**
   * Walk up from the click to the nearest context marker, starting outside any
   * rendered markdown.
   *
   * Order: a previewed document wins (its own directory is the base), then a
   * session tab's workspace — including a BACKGROUND workspace, which is why
   * the lookup is `findTabByIdAcrossWorkspaces` and not the active tab list —
   * then the active workspace root.
   */
  private resolveContext(origin: Element | null): LinkContext {
    const start =
      origin?.closest(MARKDOWN_HOST_SELECTOR)?.parentElement ?? origin;
    const marker = start?.closest(LINK_CONTEXT_SELECTOR) ?? null;

    const documentPath = marker?.getAttribute(DOCUMENT_ATTR) ?? null;
    if (documentPath) {
      return {
        documentPath,
        workspaceRoot:
          marker?.getAttribute(ROOT_ATTR) ?? this.activeWorkspaceRoot(),
      };
    }

    const tabId = marker?.getAttribute(TAB_ID_ATTR) ?? null;
    const tabRoot = tabId
      ? this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.workspacePath
      : undefined;

    return { workspaceRoot: tabRoot ?? this.activeWorkspaceRoot() };
  }

  /** `WebviewConfig.workspaceRoot` defaults to `''`; an empty root is no root. */
  private activeWorkspaceRoot(): string | undefined {
    return this.vscode.config().workspaceRoot || undefined;
  }
}
