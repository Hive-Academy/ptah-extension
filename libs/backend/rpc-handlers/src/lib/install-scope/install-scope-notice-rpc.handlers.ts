/**
 * Install-scope migration notice RPC handlers (TASK_2026_853 Phase D,
 * implementation-plan D-6 step 5, design-spec §3, decision #16).
 *
 *   - `harness:get-install-migration-notice` — the one-time notice, or `null`
 *     until the migration completed, after it was dismissed, and when every
 *     count is 0. Never fails: an unreadable ledger reads as `null`.
 *   - `harness:dismiss-install-migration-notice` — records `noticeSeenAt`.
 *     A ledger write failure reaches the caller only as fixed copy; the cause
 *     (which names `~/.ptah/migrations/install-scope.json`) stays in the log.
 *
 * The service's ledger shape is mapped to the shared wire contract here:
 * `removed` is shown as `deleted`, kept rows carry only their path, and each
 * on-disk source is named by its kind and id instead of the ledger item id.
 */

import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  InstallMigrationNotice,
  InstallMigrationOnDiskEntry,
  InstallScopeRpcMethodRegistry,
  RpcMethodName,
} from '@ptah-extension/shared';

import {
  InstallScopeMigrationService,
  type InstallScopeMigrationNotice,
  type InstallScopeOnDiskSource,
} from './install-scope-migration.service';

type GetNoticeMethod =
  InstallScopeRpcMethodRegistry['harness:get-install-migration-notice'];
type DismissNoticeMethod =
  InstallScopeRpcMethodRegistry['harness:dismiss-install-migration-notice'];

/** Both methods take no parameters; anything else is refused. */
const NoticeParamsSchema = z.object({}).strict();

/** Refusal copy for parameters that do not match the empty contract. */
export const INSTALL_MIGRATION_NOTICE_INVALID_ERROR =
  'The migration notice request was not valid.';

/** The only text a failed dismissal shows; never the raw fs error or a path. */
export const INSTALL_MIGRATION_NOTICE_DISMISS_ERROR =
  'Ptah could not save that you dismissed the migration notice. It will be shown again next time.';

const MCP_ITEM_PREFIX = 'mcp:';
const SKILLS_SH_ITEM_PREFIX = 'skills-sh:';

function toOnDiskEntry(
  source: InstallScopeOnDiskSource,
): InstallMigrationOnDiskEntry {
  if (source.itemId.startsWith(MCP_ITEM_PREFIX)) {
    return {
      kind: 'mcp-home-entry',
      name: source.itemId.slice(MCP_ITEM_PREFIX.length),
      path: source.path,
    };
  }
  return {
    kind: 'skills-sh-root',
    name: source.itemId.startsWith(SKILLS_SH_ITEM_PREFIX)
      ? source.itemId.slice(SKILLS_SH_ITEM_PREFIX.length)
      : source.itemId,
    path: source.path,
  };
}

/** Map the service's ledger-derived notice to the shared wire contract. */
export function toInstallMigrationNotice(
  notice: InstallScopeMigrationNotice,
): InstallMigrationNotice {
  return {
    counts: {
      retired: notice.counts.retired,
      deleted: notice.counts.removed,
      kept: notice.counts.kept,
      onDisk: notice.counts.onDisk,
    },
    keptPaths: notice.keptPaths.map((row) => row.path),
    onDisk: notice.onDisk.map(toOnDiskEntry),
  };
}

@injectable()
export class InstallScopeNoticeRpcHandlers {
  static readonly METHODS = [
    'harness:get-install-migration-notice',
    'harness:dismiss-install-migration-notice',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(InstallScopeMigrationService)
    private readonly migration: InstallScopeMigrationService,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      GetNoticeMethod['params'],
      GetNoticeMethod['result']
    >('harness:get-install-migration-notice', async (params: unknown) => {
      this.assertParams(params);
      const notice = await this.migration.readNotice();
      return {
        notice: notice === null ? null : toInstallMigrationNotice(notice),
      };
    });

    this.rpcHandler.registerMethod<
      DismissNoticeMethod['params'],
      DismissNoticeMethod['result']
    >('harness:dismiss-install-migration-notice', async (params: unknown) => {
      this.assertParams(params);
      try {
        return { success: await this.migration.dismissNotice() };
      } catch (error: unknown) {
        // degradation-audit: reported - the cause is logged here; the caller
        // gets fixed copy (the fs error names the ledger path) and the notice
        // simply shows again on the next read.
        this.logger.error(
          'RPC: harness:dismiss-install-migration-notice failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw new RpcUserError(
          INSTALL_MIGRATION_NOTICE_DISMISS_ERROR,
          'PERSISTENCE_UNAVAILABLE',
        );
      }
    });
  }

  private assertParams(params: unknown): void {
    if (!NoticeParamsSchema.safeParse(params ?? {}).success) {
      throw new RpcUserError(
        INSTALL_MIGRATION_NOTICE_INVALID_ERROR,
        'INVALID_PARAMS',
      );
    }
  }
}
