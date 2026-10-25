/**
 * IPC sender policy for the main window.
 *
 * Pure predicate, deliberately free of any `electron` import so it can be
 * unit-tested without a BrowserWindow (same shape as
 * `windows/navigation-policy.ts`).
 *
 * `rpc`, `get-state`, `set-state` and `diag:cpu-profile` reach the whole
 * backend, so only one sender may call them: the main window's TOP frame,
 * showing one of the app's own documents (the Angular renderer or the
 * preparing-workspace boot shell). A subframe, another webContents, or the
 * main frame after it navigated somewhere else is refused.
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

/** The only sender allowed through. */
export interface TrustedIpcSender {
  /** The main window's `webContents.id`; `null` before a window exists. */
  readonly webContentsId: number | null;
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
 * Whether an IPC call comes from the trusted main-window document.
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
  if (trusted.webContentsId === null) return false;
  if (sender.webContentsId !== trusted.webContentsId) return false;
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
