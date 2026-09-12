/**
 * File RPC Handlers — `file:open` only.
 *
 * Reveals a path in the VS Code editor, with optional line/column navigation.
 * Picking and reading files moved to `@ptah-extension/rpc-handlers`; this
 * remainder follows in the editor-family migration.
 *
 * This handler is reachable from rendered agent markdown, so the path it
 * receives is untrusted. Three rules follow from that (TASK_2026_413 Batch 8a):
 *
 *  1. **A relative path resolves only under a checked root.** It used to be
 *     `fs.stat(params.path)` directly, which resolves against the EXTENSION
 *     HOST's `process.cwd()` — a directory the user never chose and that has
 *     nothing to do with the session the link came from.
 *  2. **An absolute path outside the open folders is not refused, it is
 *     CONFIRMED.** Refusing would regress a case that works today (a link into
 *     an unregistered sibling repo), so the user is shown the path the reveal
 *     will actually open — the resolved target, whenever a link makes it
 *     differ from what was requested — in a modal, and opens it deliberately.
 *     That path goes through
 *     `resolveForHostReveal`, which authorizes no root set but still applies
 *     the form gate, `realpath`, the credential deny-list and the file-kind
 *     check — so `~/.ssh/id_ed25519` and `\\server\share\x` are refused
 *     outright and never reach a confirm. `resolveForExternalOpen` is NOT used
 *     here: it is bounded to registered ∪ home ∪ temp, so a sibling repo on
 *     another drive was rejected before the confirm could run.
 *  3. **No raw `error.message` is returned.** Sentry still captures the real
 *     error; the caller gets a fixed sentence.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { FileOpenParams, FileOpenResult } from '@ptah-extension/shared';
import {
  FileLinkRootPolicy,
  FileOpenRpcParamsSchema,
  checkLinkedPathForm,
  type LinkedFileResolution,
} from '@ptah-extension/rpc-handlers';
import * as vscode from 'vscode';
import * as path from 'path';

/** Fixed copy. Never interpolates a path into a failure the caller sees. */
const MESSAGE = {
  invalidRequest: 'That file request was not valid.',
  unsupportedPath: 'That path form is not supported.',
  notResolvable:
    'That file could not be opened. It is not inside a workspace open in Ptah.',
  cancelled: 'Opening that file was cancelled.',
  openFailed: 'Could not open the file in VS Code.',
} as const;

/**
 * Whether two absolute paths name the same file, lexically.
 *
 * `path.normalize` first, so `D:\ws\.\a.ts` and `D:\ws\a.ts` are not reported
 * to the user as a redirection they have to reason about. Case-insensitive on
 * win32 and case-SENSITIVE elsewhere, matching the filesystems themselves.
 */
function samePath(a: string, b: string): boolean {
  const left = path.normalize(a);
  const right = path.normalize(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * RPC handlers for file operations
 */
@injectable()
export class FileRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(FileLinkRootPolicy)
    private readonly linkPolicy: FileLinkRootPolicy,
  ) {}

  /**
   * Register all file RPC methods
   */
  register(): void {
    this.rpcHandler.registerMethod<FileOpenParams, FileOpenResult>(
      'file:open',
      (params) => this.openFile(params),
    );

    this.logger.debug('File RPC handlers registered', {
      methods: ['file:open'],
    });
  }

  private async openFile(raw: unknown): Promise<FileOpenResult> {
    const parsed = FileOpenRpcParamsSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: MESSAGE.invalidRequest };
    }
    const { path: requested, line, column, workspaceRoot } = parsed.data;

    // Form gate FIRST: a UNC or device path must never reach `stat`.
    for (const value of [requested, workspaceRoot]) {
      if (value !== undefined && !checkLinkedPathForm(value).ok) {
        return this.warnAndFail(MESSAGE.unsupportedPath);
      }
    }

    const target = await this.resolveTarget(requested, workspaceRoot);
    if (target.kind === 'refused') {
      return this.warnAndFail(target.message);
    }
    if (target.kind === 'cancelled') {
      // `cancelled` is the typed discriminant the renderer detects. Without it
      // a deliberate "no" is indistinguishable from a failure and the tasks
      // board raises an error banner for it.
      return { success: false, cancelled: true, error: MESSAGE.cancelled };
    }

    return this.reveal(target.resolution, line, column);
  }

  /**
   * Turn an untrusted path into a resolved, authorized target.
   *
   * A relative path gets ONE chance, under the view roots. An absolute path
   * falls back to the host-reveal policy plus an explicit confirm, which is
   * what keeps today's "open a file in an unregistered sibling repo" working.
   */
  private async resolveTarget(
    requested: string,
    workspaceRoot: string | undefined,
  ): Promise<
    | { kind: 'resolved'; resolution: LinkedFileResolution }
    | { kind: 'refused'; message: string }
    | { kind: 'cancelled' }
  > {
    const viewOptions = {
      maxBytes: Number.POSITIVE_INFINITY,
      allowDirectory: true,
    };
    const inWorkspace = await this.linkPolicy.resolveForView(
      { path: requested, workspaceRoot },
      viewOptions,
    );
    if (inWorkspace.kind !== 'rejected') {
      return { kind: 'resolved', resolution: inWorkspace };
    }

    if (!path.isAbsolute(requested)) {
      // Never fall back to the process working directory.
      return { kind: 'refused', message: MESSAGE.notResolvable };
    }

    // A path that is LEXICALLY inside an open folder still reaches this
    // fallback, deliberately. The only way it gets here is that
    // `resolveForView` rejected it, and for an in-root path the reason is
    // almost always the realpath containment re-check: the path is a link out
    // of the workspace. Refusing it outright would be the cheaper guard, but a
    // symlinked docs folder or a junctioned dependency tree is an ordinary
    // developer setup, and refusing it would regress the same "a link into a
    // sibling checkout still opens" case Decision 3 exists to preserve — just
    // reached through a link instead of an absolute path. So it is CONFIRMED
    // rather than refused, and `confirmOutsideWorkspace` names the real target
    // so the user is deciding about the file that will actually open.
    const outside = await this.linkPolicy.resolveForHostReveal(requested, {
      allowDirectory: true,
    });
    if (outside.kind === 'rejected') {
      return { kind: 'refused', message: MESSAGE.notResolvable };
    }

    const confirmed = await this.confirmOutsideWorkspace(
      outside.lexicalPath,
      outside.realPath,
    );
    if (!confirmed) return { kind: 'cancelled' };
    return { kind: 'resolved', resolution: outside };
  }

  /**
   * Show the path that will actually be OPENED and require an explicit choice.
   *
   * Modal on purpose: this is the one moment the user can tell an intended
   * reference apart from a path an injected prompt talked the agent into
   * emitting, and a dismissible toast would be clicked past.
   *
   * The detail names the resolved target whenever it differs from the path
   * that was requested. A symlink planted inside an open folder — say
   * `D:\ws\notes.md` pointing at `C:\Users\me\secret.txt` — reaches this
   * confirm precisely BECAUSE `resolveForView` rejected it on the realpath
   * containment re-check, and showing only `D:\ws\notes.md` told the user the
   * file was in their workspace while `reveal()` opened the target. A gate the
   * user cannot read is not a gate.
   */
  private async confirmOutsideWorkspace(
    requestedPath: string,
    realPath: string,
  ): Promise<boolean> {
    const detail = samePath(requestedPath, realPath)
      ? requestedPath
      : `${requestedPath}\n\nThis is a link. It opens:\n${realPath}`;
    const choice = await vscode.window.showWarningMessage(
      'Open a file from outside your open workspaces?',
      { modal: true, detail },
      'Open',
    );
    return choice === 'Open';
  }

  private async reveal(
    resolution: LinkedFileResolution,
    line: number | undefined,
    column: number | undefined,
  ): Promise<FileOpenResult> {
    if (resolution.kind === 'rejected') {
      return { success: false, error: MESSAGE.notResolvable };
    }
    try {
      const uri = vscode.Uri.file(resolution.lexicalPath);

      if (resolution.kind === 'directory') {
        await vscode.commands.executeCommand('revealInExplorer', uri);
        return { success: true, isDirectory: true };
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      if (typeof line === 'number' && line > 0) {
        const position = new vscode.Position(line - 1, (column ?? 1) - 1);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
      return { success: true };
    } catch (error: unknown) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'FileRpcHandlers.openFile' },
      );
      this.logger.error(
        'RPC: file:open failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return { success: false, error: MESSAGE.openFailed };
    }
  }

  /** A refusal is user-visible: show it natively, then answer the caller. */
  private warnAndFail(message: string): FileOpenResult {
    void vscode.window.showWarningMessage(message);
    return { success: false, error: message };
  }
}
