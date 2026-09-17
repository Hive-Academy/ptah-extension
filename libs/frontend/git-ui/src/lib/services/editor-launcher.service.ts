import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type {
  EditorTarget,
  EditorTargetId,
  EditorOpenResult,
} from '@ptah-extension/shared';
import type { OpenInRequest } from '../open-in/open-in-button.component';

export interface LaunchStatus {
  kind: 'success' | 'error';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class EditorLauncherService {
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _targets = signal<readonly EditorTarget[]>([]);
  private readonly _loading = signal(false);
  private readonly _detectionError = signal<string | null>(null);
  private readonly _launchStatus = signal<LaunchStatus | null>(null);
  private detection: Promise<void> | null = null;
  private alive = true;

  readonly targets = this._targets.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly detectionError = this._detectionError.asReadonly();
  readonly launchStatus = this._launchStatus.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => (this.alive = false));
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
      `Opened workspace in ${target}.`,
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
      `Opened ${path} in ${target}.`,
    );
  }

  async openLinkedFile(request: OpenInRequest): Promise<boolean> {
    if (!request.path) {
      this._launchStatus.set({
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
      `Opened ${request.path} in ${request.target}.`,
    );
  }

  clearStatus(): void {
    this._launchStatus.set(null);
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
        this._launchStatus.set({
          kind: 'error',
          message: result?.error ?? response.error ?? 'Editor launch failed.',
        });
        return false;
      }
      this._launchStatus.set({ kind: 'success', message: success });
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - the failure is published through
      // launchStatus, which the dock renders as a visible error.
      this._launchStatus.set({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Editor launch failed.',
      });
      return false;
    }
  }
}
