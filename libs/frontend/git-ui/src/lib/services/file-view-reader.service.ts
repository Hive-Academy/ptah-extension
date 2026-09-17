import { Injectable, inject } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type {
  FileViewContentParams,
  FileViewContentResult,
  FileViewFailureReason,
} from '@ptah-extension/shared';
import type {
  FileViewOpenRequest,
  FileViewTabState,
} from '../types/diff-tab.types';

const KNOWN_FAILURE_REASONS = new Set<FileViewFailureReason>([
  'invalid-request',
  'unsupported-path',
  'no-base-root',
  'root-not-open',
  'outside-roots',
  'not-found',
  'not-a-file',
  'too-large',
  'binary',
  'unsupported-encoding',
  'unreadable',
]);

const BLOCKED_REASONS = new Set<FileViewFailureReason>([
  'unsupported-path',
  'no-base-root',
  'root-not-open',
  'outside-roots',
]);

const GENERIC_READ_ERROR = 'This file could not be opened in the viewer.';

function isKnownFailureReason(value: unknown): value is FileViewFailureReason {
  return (
    typeof value === 'string' &&
    KNOWN_FAILURE_REASONS.has(value as FileViewFailureReason)
  );
}

function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/i.test(path);
}

function revealFor(
  request: FileViewOpenRequest,
): { line: number; column: number } | null {
  if (request.line === undefined && request.column === undefined) return null;
  return {
    line: Math.max(1, request.line ?? 1),
    column: Math.max(1, request.column ?? 1),
  };
}

@Injectable({ providedIn: 'root' })
export class FileViewReaderService {
  private readonly vscode = inject(VSCodeService);

  async read(
    request: FileViewOpenRequest,
    requestId: number,
    previous?: FileViewTabState,
  ): Promise<FileViewTabState> {
    const base = this.baseState(request, requestId, previous);
    try {
      const response = await rpcCall<FileViewContentResult>(
        this.vscode,
        'file:viewContent',
        {
          path: request.path,
          ...(request.workspaceRoot
            ? { workspaceRoot: request.workspaceRoot }
            : {}),
          ...(request.documentPath
            ? { documentPath: request.documentPath }
            : {}),
        } satisfies FileViewContentParams,
      );
      if (!response.success || !response.data) {
        return {
          ...base,
          status: 'error',
          failure: {
            reason: 'unreadable',
            message: GENERIC_READ_ERROR,
            externalOpenAllowed: false,
          },
        };
      }
      return this.mapResult(response.data, base);
    } catch {
      return {
        ...base,
        status: 'error',
        failure: {
          reason: 'unreadable',
          message: GENERIC_READ_ERROR,
          externalOpenAllowed: false,
        },
      };
    }
  }

  private baseState(
    request: FileViewOpenRequest,
    requestId: number,
    previous?: FileViewTabState,
  ): FileViewTabState {
    return {
      absolutePath: previous?.absolutePath ?? request.path,
      workspaceRoot: previous?.workspaceRoot ?? request.workspaceRoot ?? null,
      relativePath: previous?.relativePath ?? null,
      content: previous?.content ?? '',
      sizeBytes: previous?.sizeBytes ?? null,
      isMarkdown: previous?.isMarkdown ?? isMarkdownPath(request.path),
      reveal: revealFor(request),
      status: previous ? 'refreshing' : 'loading',
      request,
      requestId,
    };
  }

  private mapResult(
    result: FileViewContentResult,
    base: FileViewTabState,
  ): FileViewTabState {
    if (result.success) {
      return {
        ...base,
        absolutePath: result.absolutePath,
        workspaceRoot: result.workspaceRoot,
        relativePath: result.relativePath,
        content: result.content,
        sizeBytes: result.sizeBytes,
        isMarkdown: isMarkdownPath(result.absolutePath),
        status: 'fresh',
        failure: undefined,
      };
    }

    const reason = isKnownFailureReason(result.reason)
      ? result.reason
      : 'unreadable';
    const blocked = BLOCKED_REASONS.has(reason);
    return {
      ...base,
      absolutePath: result.absolutePath ?? base.absolutePath,
      content: blocked ? '' : base.content,
      sizeBytes: result.sizeBytes ?? base.sizeBytes,
      status: blocked ? 'blocked' : 'error',
      failure: {
        reason,
        message: isKnownFailureReason(result.reason)
          ? result.error
          : GENERIC_READ_ERROR,
        externalOpenAllowed: result.externalOpenAllowed,
      },
    };
  }
}
