/**
 * IPC sender policy for the main window.
 *
 * Pure predicate, deliberately free of any `electron` import so it can be
 * unit-tested without a BrowserWindow (same shape as
 * `windows/navigation-policy.ts`).
 *
 * `rpc`, `get-state`, `set-state` and `diag:cpu-profile` reach the whole
 * backend, so only the app's own windows may call them: the TOP frame of a
 * trusted webContents (the main window, and the detached Display window while
 * it is open — TASK_2026_853_3401), showing one of the app's own documents
 * (the Angular renderer or the preparing-workspace boot shell). A subframe,
 * another webContents, or a main frame after it navigated somewhere else is
 * refused. What each trusted window may call is decided by `IpcBridge`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

/** What `ipcMain` tells us about the caller. */
export interface IpcSenderIdentity {
  /** `event.sender.id`. */
  readonly webContentsId: number;
  /** `event.senderFrame?.url`; `undefined` when the frame is gone. */
  readonly frameUrl: string | undefined;
  /** `event.senderFrame === event.sender.mainFrame`. */
  readonly isMainFrame: boolean;
}

/** The senders allowed through. */
export interface TrustedIpcSender {
  /**
   * `webContents.id` of every trusted app window (main window, then the
   * detached Display window when open). Empty before a window exists.
   */
  readonly webContentsIds: readonly number[];
  /** Absolute filesystem paths of the documents the main window may show. */
  readonly documentPaths: readonly string[];
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    // degradation-audit: optional-capability - classifying an untrusted IPC
    // sender URL is optional; `undefined` makes the caller fail closed, which
    // drops the call.
    return undefined;
  }
}

/**
 * Filesystem path of a `file:` URL, or `undefined` when it has none.
 * Hash and query are not part of the result: `fileURLToPath` reads only the
 * host and pathname, so `index.html#/route` and `index.html?x` resolve to the
 * same document — the same widening `isSameDocumentNavigation` makes.
 */
function toFilePath(url: URL, windows: boolean): string | undefined {
  try {
    return fileURLToPath(url, { windows });
  } catch {
    // degradation-audit: optional-capability - a `file:` URL with a remote
    // host (POSIX) or an encoded separator has no local path; `undefined`
    // fails closed and drops the call.
    return undefined;
  }
}

function comparable(filePath: string, windows: boolean): string {
  if (!windows) return path.posix.normalize(filePath);
  // NTFS paths are case-insensitive; Electron and `path.join` can disagree on
  // the drive-letter case (`c:\` vs `C:\`).
  return path.win32.normalize(filePath).toLowerCase();
}

/**
 * Whether an IPC call comes from a trusted app-window document.
 *
 * Fail-closed: no window yet, another webContents, a subframe, a missing or
 * malformed frame URL, a non-`file:` URL, or a `file:` path outside
 * `trusted.documentPaths` are all false.
 *
 * @param platform - injectable for tests; defaults to the running platform.
 */
export function isTrustedIpcSender(
  sender: IpcSenderIdentity,
  trusted: TrustedIpcSender,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!trusted.webContentsIds.includes(sender.webContentsId)) return false;
  if (!sender.isMainFrame) return false;
  if (sender.frameUrl === undefined) return false;

  const url = parse(sender.frameUrl);
  if (!url || url.protocol !== 'file:') return false;

  const windows = platform === 'win32';
  const filePath = toFilePath(url, windows);
  if (filePath === undefined) return false;

  const candidate = comparable(filePath, windows);
  return trusted.documentPaths.some(
    (documentPath) => comparable(documentPath, windows) === candidate,
  );
}
