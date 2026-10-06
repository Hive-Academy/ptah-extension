import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type {
  EditorTarget,
  EditorTargetId,
  EditorOpenMergeFailureReason,
  EditorOpenMergeResult,
  EditorOpenResult,
} from '@ptah-extension/shared';
import type { OpenInRequest } from '../open-in/open-in-button.component';

const MERGE_LAUNCH_FAILED_COPY = 'The merge view could not be opened.';

const MERGE_LAUNCH_FAILED: EditorOpenMergeResult = {
  status: 'failed',
  reason: 'failed',
  error: MERGE_LAUNCH_FAILED_COPY,
};

const MERGE_FAILURE_REASONS: ReadonlySet<string> =
  new Set<EditorOpenMergeFailureReason>([
    'invalid-params',
    'invalid-path',
    'not-installed',
    'no-operation',
    'not-conflicted',
    'not-mergeable',
    'failed',
  ]);

/** Check an `editor:openMerge` reply's shape; anything else is a failure. */
function readOpenMergeResult(data: unknown): EditorOpenMergeResult {
  if (typeof data !== 'object' || data === null) return MERGE_LAUNCH_FAILED;
  const { status, reason, error } = data as Record<string, unknown>;
  if (status === 'ok' || status === 'unsupported') return { status };
  if (
    status === 'failed' &&
    typeof reason === 'string' &&
    MERGE_FAILURE_REASONS.has(reason)
  ) {
    return {
      status,
      reason: reason as EditorOpenMergeFailureReason,
      error:
        typeof error === 'string' && error !== ''
          ? error
          : MERGE_LAUNCH_FAILED_COPY,
    };
  }
  return MERGE_LAUNCH_FAILED;
}

/** How long a success status line stays before it clears itself. */
export const STATUS_AUTO_CLEAR_MS = 4_000;

/** The last segment of a workspace path, either separator, trailing one ignored. */
function folderName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || root;
}

export interface LaunchStatus {
  kind: 'success' | 'error';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class EditorLauncherService {
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly _targets = signal<readonly EditorTarget[]>([]);
  private readonly _loading = signal(false);
  private readonly _detectionError = signal<string | null>(null);
  private readonly _launchStatus = signal<LaunchStatus | null>(null);
  private detection: Promise<void> | null = null;
  private alive = true;
  /** Clears a success status; cancelled by every newer status and on destroy. */
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  readonly targets = this._targets.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly detectionError = this._detectionError.asReadonly();
  readonly launchStatus = this._launchStatus.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.alive = false;
      this.cancelClearTimer();
    });
  }

  detect(): Promise<void> {
    if (this.detection) return this.detection;
    this._loading.set(true);
    this.detection = rpcCall<{ targets: EditorTarget[] }>(
      this.vscode,
      'editor:detectTargets',
      {},
    )
      .then((response) => {
        if (!this.alive) return;
        if (response.success && response.data) {
          const targets: unknown = response.data.targets;
          if (Array.isArray(targets)) {
            this._targets.set(targets as EditorTarget[]);
            this._detectionError.set(null);
          } else {
            this._targets.set([]);
            this._detectionError.set('Editor detection returned invalid data.');
          }
        } else {
          this._detectionError.set(
            response.error ?? 'Editor detection failed.',
          );
        }
      })
      .catch((error: unknown) => {
        if (this.alive)
          this._detectionError.set(
            error instanceof Error ? error.message : 'Editor detection failed.',
          );
      })
      .finally(() => {
        if (this.alive) this._loading.set(false);
      });
    return this.detection;
  }

  async openWorkspace(target: EditorTargetId, root: string): Promise<boolean> {
    return this.launch(
      'editor:openWorkspace',
      { target, root },
      `Opened ${folderName(root)} in ${this.targetLabel(target)}.`,
    );
  }

  async openFile(
    target: EditorTargetId,
    workspaceRoot: string,
    path: string,
    line?: number,
  ): Promise<boolean> {
    return this.launch(
      'editor:openFile',
      { target, workspaceRoot, path, ...(line ? { line } : {}) },
      `Opened ${path} in ${this.targetLabel(target)}.`,
    );
  }

  /**
   * Open the three-way merge view of one conflicted, repository-relative
   * path (`editor:openMerge`). `ok` and `failed` publish a launch status;
   * `unsupported` publishes nothing, because the caller opens the file
   * instead. A transport failure or a malformed reply reads as `failed`.
   */
  async openMerge(
    target: EditorTargetId,
    workspaceRoot: string,
    path: string,
  ): Promise<EditorOpenMergeResult> {
    let result: EditorOpenMergeResult = MERGE_LAUNCH_FAILED;
    try {
      const response = await rpcCall<EditorOpenMergeResult>(
        this.vscode,
        'editor:openMerge',
        { target, path, workspaceRoot },
      );
      result = readOpenMergeResult(response.success ? response.data : null);
    } catch (error: unknown) {
      // degradation-audit: reported - published as a failed launch below,
      // which the header renders as a visible error.
      console.error('[EditorLauncherService] editor:openMerge threw', error);
    }
    if (result.status === 'ok') {
      this.setStatus({
        kind: 'success',
        message: `Opened the merge view for ${path}.`,
      });
    } else if (result.status === 'failed') {
      this.setStatus({ kind: 'error', message: result.error });
    }
    return result;
  }

  async openLinkedFile(request: OpenInRequest): Promise<boolean> {
    if (!request.path) {
      this.setStatus({
        kind: 'error',
        message: 'No file path was provided.',
      });
      return false;
    }
    return this.launch(
      'editor:openFile',
      {
        target: request.target,
        path: request.path,
        ...(request.line ? { line: request.line } : {}),
        scope: 'external-link',
      },
      `Opened ${request.path} in ${this.targetLabel(request.target)}.`,
    );
  }

  /** Dismiss the status line (the header's X on an error). */
  clearStatus(): void {
    this.cancelClearTimer();
    this._launchStatus.set(null);
  }

  /** The detected target's display name, or its id before detection lands. */
  private targetLabel(id: EditorTargetId): string {
    return (
      this._targets().find((target) => target.id === id)?.displayName ?? id
    );
  }

  /**
   * Publish a status. A success clears itself after
   * {@link STATUS_AUTO_CLEAR_MS}; an error stays until dismissed or replaced.
   */
  private setStatus(status: LaunchStatus): void {
    this.cancelClearTimer();
    this._launchStatus.set(status);
    if (status.kind !== 'success' || !this.alive) return;
    // Outside the zone so a pending clear never holds the app unstable; the
    // signal write still schedules change detection.
    this.clearTimer = this.zone.runOutsideAngular(() =>
      setTimeout(() => {
        this.clearTimer = null;
        this._launchStatus.set(null);
      }, STATUS_AUTO_CLEAR_MS),
    );
  }

  private cancelClearTimer(): void {
    if (this.clearTimer === null) return;
    clearTimeout(this.clearTimer);
    this.clearTimer = null;
  }

  private async launch(
    method: 'editor:openWorkspace' | 'editor:openFile',
    params: Record<string, unknown>,
    success: string,
  ): Promise<boolean> {
    try {
      const response = await rpcCall<EditorOpenResult>(
        this.vscode,
        method,
        params,
      );
      const result = response.data;
      if (!response.success || !result?.success) {
        this.setStatus({
          kind: 'error',
          message: result?.error ?? response.error ?? 'Editor launch failed.',
        });
        return false;
      }
      this.setStatus({ kind: 'success', message: success });
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - the failure is published through
      // launchStatus, which the dock renders as a visible error.
      this.setStatus({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Editor launch failed.',
      });
      return false;
    }
  }
}
