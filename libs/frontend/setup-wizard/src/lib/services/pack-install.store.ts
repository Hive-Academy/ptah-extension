import { Injectable, inject, signal } from '@angular/core';
import type {
  FileOutcome,
  GenerationTargetChoice,
  GenerationTargetInfo,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import {
  packInstallFinished,
  type PackFileStatus,
  type PackInstallFinished,
  type PackInstallRequest,
} from '../components/pack-install/pack-install-result';
import {
  WizardRpcService,
  type PackInstallDecisions,
} from './wizard-rpc.service';

/** The surface a pack install belongs to; each keeps its own history. */
export type PackHostScope = 'wizard' | 'sidebar';

/** Per-file state: in flight, or the terminal status of the last install. */
export type PackFileState = 'installing' | PackFileStatus;

/** One file's last known install state. */
export interface PackFileRecord {
  readonly state: PackFileState;
  /** Terminal outcome as the server reported it; null while installing. */
  readonly outcome: FileOutcome | null;
  /** Safe failure copy for a failed file, or null. */
  readonly failure: string | null;
  /** Roots of the install that produced this state. */
  readonly target: GenerationTargetInfo;
}

/** A confirmed install: the request, its plan and the Replace decisions. */
export interface PackInstallJob {
  readonly request: PackInstallRequest;
  readonly plan: WizardPlanPackInstallResult;
  readonly decisions: NonNullable<PackInstallDecisions['decisions']>;
}

interface ScopeState {
  /** Keyed by `source::file`. */
  readonly files: Readonly<Record<string, PackFileRecord>>;
  /** Last terminal result per pack source, for the results line. */
  readonly results: Readonly<Record<string, PackInstallFinished>>;
  /** Roots of the last finished install; the next prompt starts there. */
  readonly target: GenerationTargetInfo | null;
}

const EMPTY_SCOPE: ScopeState = { files: {}, results: {}, target: null };

export function packFileKey(source: string, file: string): string {
  return `${source}::${file}`;
}

/**
 * Owns community-pack install operations and their terminal per-file
 * outcomes (TASK_2026_701_9e4b B2, B4). The operation runs here, not in the
 * prompt or its host, so navigating away while a download is pending cannot
 * strand files on "installing" or lose the result: a re-created host reads
 * the same state. Kept and failed are real terminal states with the target
 * and a safe failure detail. The store never holds a keep/replace choice:
 * every newly opened prompt still starts on Keep.
 */
@Injectable({ providedIn: 'root' })
export class PackInstallStore {
  private readonly rpc = inject(WizardRpcService);
  private readonly scopes = signal<Readonly<Record<PackHostScope, ScopeState>>>(
    { wizard: EMPTY_SCOPE, sidebar: EMPTY_SCOPE },
  );

  fileState(
    scope: PackHostScope,
    source: string,
    file: string,
  ): PackFileState | null {
    return this.scopes()[scope].files[packFileKey(source, file)]?.state ?? null;
  }

  failure(scope: PackHostScope, source: string, file: string): string {
    return this.scopes()[scope].files[packFileKey(source, file)]?.failure ?? '';
  }

  result(scope: PackHostScope, source: string): PackInstallFinished | null {
    return this.scopes()[scope].results[source] ?? null;
  }

  targetInfo(scope: PackHostScope): GenerationTargetInfo | null {
    return this.scopes()[scope].target;
  }

  /** Root of the last finished install; null = the server default. */
  lastTarget(scope: PackHostScope): GenerationTargetChoice | null {
    return this.scopes()[scope].target?.chosen ?? null;
  }

  isInstalling(scope: PackHostScope, source?: string): boolean {
    return Object.entries(this.scopes()[scope].files).some(
      ([key, record]) =>
        record.state === 'installing' &&
        (source === undefined || key.startsWith(`${source}::`)),
    );
  }

  installedCount(scope: PackHostScope): number {
    return Object.values(this.scopes()[scope].files).filter(
      (record) => record.state === 'installed',
    ).length;
  }

  /**
   * Run a confirmed install. Files are marked installing synchronously; the
   * returned promise always settles with a terminal result, never rejects.
   */
  async install(
    scope: PackHostScope,
    job: PackInstallJob,
  ): Promise<PackInstallFinished> {
    const { request, plan, decisions } = job;
    const files = [...request.files];
    this.markInstalling(scope, request.source, files, plan.target);
    let result: WizardInstallPackAgentsResult;
    try {
      result = await this.rpc.installPackAgents(request.source, files, {
        planToken: plan.planToken,
        decisions,
        target: plan.target.chosen,
      });
    } catch (error: unknown) {
      // degradation-audit: reported - a transport failure becomes a failed
      // terminal result that every host shows per file with Retry.
      result = {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        ...(error instanceof Error ? { error: error.message } : {}),
      };
    }
    if (!result.success) {
      // Raw detail goes to the diagnostic log only; views get safe copy.
      console.warn('[PackInstallStore] pack install failed', {
        source: request.source,
        error: result.error,
      });
    }
    const finished = packInstallFinished(request, files, plan.target, result);
    this.settle(scope, finished);
    return finished;
  }

  private markInstalling(
    scope: PackHostScope,
    source: string,
    files: readonly string[],
    target: GenerationTargetInfo,
  ): void {
    this.updateScope(scope, (current) => {
      const next = { ...current.files };
      for (const file of files) {
        next[packFileKey(source, file)] = {
          state: 'installing',
          outcome: null,
          failure: null,
          target,
        };
      }
      return { ...current, files: next };
    });
  }

  private settle(scope: PackHostScope, finished: PackInstallFinished): void {
    this.updateScope(scope, (current) => {
      const next = { ...current.files };
      for (const file of finished.files) {
        const state = finished.statuses[file] ?? 'failed';
        next[packFileKey(finished.source, file)] = {
          state,
          outcome: finished.outcomes[file] ?? 'failed',
          failure: state === 'failed' ? finished.failure : null,
          target: finished.target,
        };
      }
      return {
        files: next,
        results: { ...current.results, [finished.source]: finished },
        target: finished.target,
      };
    });
  }

  private updateScope(
    scope: PackHostScope,
    change: (current: ScopeState) => ScopeState,
  ): void {
    this.scopes.update((all) => ({ ...all, [scope]: change(all[scope]) }));
  }
}
