import type { FileViewFailureReason } from '@ptah-extension/shared';

export type FileViewTabStatus =
  | 'loading'
  | 'fresh'
  | 'refreshing'
  | 'blocked'
  | 'error';

/** A request to open one file read-only in the spot editor. */
export interface FileViewOpenRequest {
  path: string;
  line?: number;
  column?: number;
  workspaceRoot?: string;
  documentPath?: string;
}

/** The spot editor's read state for the one file it shows. */
export interface FileViewTabState {
  absolutePath: string;
  workspaceRoot: string | null;
  relativePath: string | null;
  content: string;
  sizeBytes: number | null;
  /**
   * From the last successful read: the decoding used, the sha256 of the raw
   * bytes (sent back as `expectedSha256` on save) and whether a BOM was
   * stripped. Absent until a read succeeds.
   */
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be';
  sha256?: string;
  bom?: boolean;
  isMarkdown: boolean;
  reveal: { line: number; column: number } | null;
  status: FileViewTabStatus;
  failure?: {
    reason: FileViewFailureReason;
    message: string;
    externalOpenAllowed: boolean;
  };
  request: FileViewOpenRequest;
  requestId: number;
}

/** Key for a read-only file view, normalized without resolving the path. */
export function fileViewTabKey(absoluteOrRequestPath: string): string {
  const normalized = absoluteOrRequestPath.replace(/\\/g, '/');
  const win32Shaped = /^[a-z]:\//i.test(normalized);
  return `view:${win32Shaped ? normalized.toLowerCase() : normalized}`;
}
