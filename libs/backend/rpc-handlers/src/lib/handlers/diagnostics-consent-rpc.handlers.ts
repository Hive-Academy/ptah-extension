/**
 * Diagnostics consent RPC handlers — the per-workspace opt-in for `go vet`
 * (TASK_2026_559 Batch 37b1c; O2 §3, §6; User Decisions 19 and 25).
 *
 *   - `diagnostics:go-vet-consent-get` — the active workspace, its consent
 *     state (`off` | `on` | `stale` + reason) and the Go binary on display.
 *   - `diagnostics:go-vet-consent-set` — grant or revoke for the ACTIVE root.
 *
 * Consent lives in host-owned per-workspace state through the workspace
 * intelligence `GoVetConsentStore`; no repository file is read or written.
 * The caller's `workspaceRoot` is a comparison token only (the root it last
 * showed the user): when it no longer names the active root the call refuses
 * with `workspace-changed` before anything is written or cleared. Success is
 * reported only after the new state is read back, and only then is the fixed
 * audit line written.
 *
 * Lane K closing review finding 4: GET also hands out a `confirmToken` that
 * binds the root's real path and file identity and the Go binary it shows.
 * An enabling SET must return it; if the folder was replaced or re-pointed
 * (`workspace-changed`) or the binary changed (`go-changed`) since that GET,
 * nothing is written. After the write, the binary is resolved again and the
 * committed record is checked against the confirmed root: a change in the
 * meantime removes the record and refuses, so a grant is never reported for
 * a target the user did not see.
 *
 * Host gating is data: the manifest entry requires `goVetDiagnostics`, which
 * only the Electron and CLI profiles enable. Refusals are the fixed codes of
 * `DiagnosticsGoVetConsentSetError`; no error text reaches the caller or the
 * log.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  isWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import type {
  IPlatformInfo,
  IStateStorage,
  IWorkspaceLifecycleProvider,
  IWorkspaceProvider,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import {
  GoVetConsentStore,
  isSameGoBinary,
  resolveGoBinary,
  type GoBinaryIdentity,
} from '@ptah-extension/workspace-intelligence';
import type {
  DiagnosticsGoVetConsentGetParams,
  DiagnosticsGoVetConsentGetResult,
  DiagnosticsGoVetConsentSetError,
  DiagnosticsGoVetConsentSetParams,
  DiagnosticsGoVetConsentSetResult,
  RpcMethodName,
} from '@ptah-extension/shared';

/** Upper bound on the displayed-root token; a longer value is not a path. */
const MAX_ROOT_LENGTH = 4096;

/** Upper bound on a confirm token (two 24-hex parts and a dot). */
const MAX_TOKEN_LENGTH = 128;

const GoVetConsentGetParamsSchema = z.object({}).strict();

const GoVetConsentSetParamsSchema = z
  .object({
    enabled: z.boolean(),
    workspaceRoot: z.string().min(1).max(MAX_ROOT_LENGTH),
    confirmToken: z.string().min(1).max(MAX_TOKEN_LENGTH).optional(),
    source: z.enum(['settings-ui', 'cli']),
  })
  .strict();

/** The active workspace as the host registered it. */
interface ActiveRoot {
  /** The registered storage key: the path consent is written under. */
  readonly root: string;
}

/** The root part of a confirm token (`<root>.<binary>`). */
function rootPart(token: string): string {
  return token.slice(0, token.indexOf('.'));
}

function refuse(
  error: DiagnosticsGoVetConsentSetError,
): DiagnosticsGoVetConsentSetResult {
  return { success: false, error };
}

@injectable()
export class DiagnosticsConsentRpcHandlers {
  static readonly METHODS = [
    'diagnostics:go-vet-consent-get',
    'diagnostics:go-vet-consent-set',
  ] as const satisfies readonly RpcMethodName[];

  private readonly consentStore: GoVetConsentStore;
  private readonly userDataPath: string;
  /** SET calls run one at a time, so each read-back sees its own write. */
  private setChain: Promise<unknown> = Promise.resolve();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER)
    private readonly workspaceLifecycle: IWorkspaceLifecycleProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private readonly workspaceState: IStateStorage,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    platformInfo: IPlatformInfo,
  ) {
    // The same user-data directory the checker's store uses
    // (`registerTypeScriptDiagnosticsProvider`), so both judge one record.
    this.userDataPath = platformInfo.globalStoragePath;
    this.consentStore = new GoVetConsentStore(workspaceState, {
      userDataPath: this.userDataPath,
    });
  }

  register(): void {
    this.rpcHandler.registerMethod<
      DiagnosticsGoVetConsentGetParams,
      DiagnosticsGoVetConsentGetResult
    >('diagnostics:go-vet-consent-get', async (params: unknown) =>
      this.getConsent(params),
    );
    this.rpcHandler.registerMethod<
      DiagnosticsGoVetConsentSetParams,
      DiagnosticsGoVetConsentSetResult
    >('diagnostics:go-vet-consent-set', async (params: unknown) => {
      const next = this.setChain.then(
        () => this.setConsent(params),
        () => this.setConsent(params),
      );
      this.setChain = next;
      return next;
    });
  }

  private getConsent(params: unknown): DiagnosticsGoVetConsentGetResult {
    if (!GoVetConsentGetParamsSchema.safeParse(params ?? {}).success) {
      throw new Error('invalid-params');
    }
    if (!isWorkspaceScopedStateStorage(this.workspaceState)) {
      return { supported: false, workspace: null, state: 'off' };
    }
    const active = this.activeRoot(this.workspaceState);
    if (active === null) {
      return { supported: true, workspace: null, state: 'off' };
    }
    const binary = this.currentGoBinary(active.root);
    const consent = this.consentStore.read(active.root, binary);
    const workspace = { root: active.root };
    const token = this.consentStore.confirmToken(active.root, binary);
    const confirm = token !== null ? { confirmToken: token } : {};
    if (consent.state === 'on') {
      return {
        supported: true,
        workspace,
        state: 'on',
        goBinary: consent.record.goBinary.path,
        ...confirm,
      };
    }
    return {
      supported: true,
      workspace,
      state: consent.state,
      ...(consent.state === 'stale' ? { staleReason: consent.reason } : {}),
      ...(binary !== null ? { goBinary: binary.path } : {}),
      ...confirm,
    };
  }

  /** O2 §3 check order 1-7; every refusal happens before any write. */
  private async setConsent(
    params: unknown,
  ): Promise<DiagnosticsGoVetConsentSetResult> {
    const parsed = GoVetConsentSetParamsSchema.safeParse(params);
    if (!parsed.success) return refuse('invalid-params');
    const { enabled, workspaceRoot, confirmToken, source } = parsed.data;
    if (enabled && confirmToken === undefined) return refuse('invalid-params');

    if (!isWorkspaceScopedStateStorage(this.workspaceState)) {
      return refuse('unsupported');
    }
    const active = this.activeRoot(this.workspaceState);
    if (active === null) return refuse('no-workspace');
    // Stale-UI guard: the caller value is compared, never written to.
    if (!this.samePath(workspaceRoot, active.root)) {
      return refuse('workspace-changed');
    }

    let binary: GoBinaryIdentity | null = null;
    if (enabled) {
      binary = this.currentGoBinary(active.root);
      if (binary === null) return refuse('no-go-binary');
      // The confirmed target: the root and binary the GET displayed.
      const current = this.consentStore.confirmToken(active.root, binary);
      if (
        current === null ||
        confirmToken === undefined ||
        rootPart(current) !== rootPart(confirmToken)
      ) {
        return refuse('workspace-changed');
      }
      if (current !== confirmToken) return refuse('go-changed');
    }

    try {
      if (binary !== null) {
        await this.consentStore.grant(active.root, binary);
      } else {
        await this.consentStore.revoke(active.root);
      }
    } catch (error: unknown) {
      // The refusal `persist-failed` is the caller's answer. The error text
      // may hold paths, so only the fixed line below is logged.
      void error;
      this.logger.warn('[Diagnostics] go vet consent write failed', {
        workspaceHash: workspaceHash(active.root),
        enabled,
      });
      return refuse('persist-failed');
    }

    if (binary !== null && confirmToken !== undefined) {
      const moved = this.targetMovedAfterGrant(
        active.root,
        binary,
        rootPart(confirmToken),
      );
      if (moved !== null) {
        await this.consentStore.revoke(active.root).catch((error: unknown) => {
          void error;
          this.logger.warn('[Diagnostics] go vet consent rollback failed', {
            workspaceHash: workspaceHash(active.root),
          });
        });
        return refuse(moved);
      }
    }

    if (!this.readBackMatches(active, enabled, binary)) {
      this.logger.warn('[Diagnostics] go vet consent read-back mismatch', {
        workspaceHash: workspaceHash(active.root),
        enabled,
      });
      return refuse('persist-failed');
    }

    this.logger.info('[Diagnostics] go vet consent changed', {
      workspaceHash: workspaceHash(active.root),
      enabled,
      source,
    });
    return enabled && binary !== null
      ? { success: true, state: 'on', goBinary: binary.path }
      : { success: true, state: 'off' };
  }

  /**
   * After an awaited write the target may have changed: the binary resolved
   * NOW must be the one recorded, and the committed record must bind the
   * root the user confirmed. `null` when both hold, else the refusal.
   */
  private targetMovedAfterGrant(
    root: string,
    binary: GoBinaryIdentity,
    confirmedRoot: string,
  ): 'workspace-changed' | 'go-changed' | null {
    const now = this.currentGoBinary(root);
    if (now === null || !isSameGoBinary(now, binary)) return 'go-changed';
    const consent = this.consentStore.read(root, now);
    if (
      consent.state === 'on' &&
      this.consentStore.recordRootToken(consent.record) !== confirmedRoot
    ) {
      return 'workspace-changed';
    }
    return null;
  }

  /**
   * Grant: the store must now judge the root `on` against the binary just
   * recorded. Revoke: the record file must be gone, and the store must judge
   * it `off` (a failed read also answers `off`, so the file check is what
   * proves the deletion).
   */
  private readBackMatches(
    active: ActiveRoot,
    enabled: boolean,
    binary: GoBinaryIdentity | null,
  ): boolean {
    if (enabled) {
      return this.consentStore.read(active.root, binary).state === 'on';
    }
    return (
      !this.consentStore.hasRecord(active.root) &&
      this.consentStore.read(active.root, this.currentGoBinary(active.root))
        .state === 'off'
    );
  }

  /**
   * The host's active root (`lifecycle.getActiveFolder() ??
   * getWorkspaceRoot()`, the expression both hosts use for their active
   * workspace source), matched to a registered storage key: exact
   * `path.resolve` spelling, then on win32 a case-folded match. A root with
   * no registered storage is `null`; there is no fallback to another scope.
   */
  private activeRoot(storage: IWorkspaceScopedStateStorage): ActiveRoot | null {
    const active =
      this.workspaceLifecycle.getActiveFolder() ??
      this.workspaceProvider.getWorkspaceRoot();
    if (active === undefined || active.length === 0) return null;
    const wanted = path.resolve(active);
    if (storage.getStorageForWorkspace(wanted) !== undefined) {
      return { root: wanted };
    }
    if (process.platform !== 'win32') return null;
    const registered = storage
      .getAllWorkspacePaths()
      .find((candidate) => this.samePath(candidate, wanted));
    if (registered === undefined) return null;
    return storage.getStorageForWorkspace(registered) === undefined
      ? null
      : { root: registered };
  }

  private samePath(a: string, b: string): boolean {
    const left = path.resolve(a);
    const right = path.resolve(b);
    return process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  }

  /** The binary the checker would run for `root` now (O2 §4.1), or `null`. */
  private currentGoBinary(root: string): GoBinaryIdentity | null {
    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: process.env,
      userDataPath: this.userDataPath,
    });
    return resolved === null
      ? null
      : { path: resolved.path, size: resolved.size, mtimeMs: resolved.mtimeMs };
  }
}

/** O2 §6: the root is logged only as a 16-hex sha256 of its resolved path. */
function workspaceHash(root: string): string {
  return createHash('sha256')
    .update(path.resolve(root))
    .digest('hex')
    .slice(0, 16);
}
