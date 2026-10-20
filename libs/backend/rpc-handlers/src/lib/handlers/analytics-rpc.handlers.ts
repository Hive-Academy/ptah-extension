/**
 * Usage analytics RPC handlers (TASK_2026_707 PR 2).
 *
 * `analytics:spendSummary` validates `{ range, workspace? }`, confines the
 * workspace to an open folder exactly like `session:stats-batch`, asks the
 * usage-analytics service for the summary and validates the result before it
 * leaves the host. Failures are logged with a real Error and answered with a
 * fixed, coded RPC error: the transport returns a plain Error's message
 * verbatim, so no path or provider detail reaches the caller.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { USAGE_ANALYTICS_TOKENS } from '@ptah-extension/usage-analytics';
import type { UsageAnalyticsService } from '@ptah-extension/usage-analytics';
import {
  UsageSummaryParamsSchema,
  UsageSummarySchema,
} from '@ptah-extension/shared';
import type {
  RpcMethodName,
  UsageSummary,
  UsageSummaryParams,
} from '@ptah-extension/shared';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';

const METHOD = 'analytics:spendSummary';

/** Abort budget for one summary; the scan is bounded, the RPC must be too. */
const USAGE_SUMMARY_BUDGET_MS = 30_000;

@injectable()
export class AnalyticsRpcHandlers {
  static readonly METHODS = [
    METHOD,
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(USAGE_ANALYTICS_TOKENS.USAGE_ANALYTICS_SERVICE)
    private readonly usageAnalytics: UsageAnalyticsService,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<UsageSummaryParams, UsageSummary>(
      METHOD,
      async (params: unknown) => this.usageSummary(params),
    );
  }

  private async usageSummary(params: unknown): Promise<UsageSummary> {
    const parsed = UsageSummaryParamsSchema.safeParse(params);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((issue) => issue.path.join('.') || 'params')
        .join(', ');
      throw new RpcUserError(
        `Invalid ${METHOD} params (${fields})`,
        'INVALID_PARAMS',
      );
    }
    const request = parsed.data;

    const workspace = request.workspace ?? this.workspaceProvider.getWorkspaceRoot();
    if (workspace === undefined || workspace.length === 0) {
      throw new RpcUserError('No workspace is open.', 'WORKSPACE_NOT_OPEN');
    }
    if (!isAuthorizedWorkspace(workspace, this.workspaceProvider)) {
      this.logger.warn(
        `RPC: ${METHOD} rejected — workspace outside active workspace`,
      );
      throw new RpcUserError(
        'Workspace is not authorized.',
        'UNAUTHORIZED_WORKSPACE',
      );
    }

    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), USAGE_SUMMARY_BUDGET_MS);
    timer.unref?.();
    try {
      const summary = await this.usageAnalytics.summarize(
        request,
        workspace,
        budget.signal,
      );
      return UsageSummarySchema.parse(summary);
    } catch (error: unknown) {
      if (error instanceof RpcUserError) throw error;
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`RPC: ${METHOD} failed`, errorObj);
      throw new RpcUserError(
        'Usage summary is unavailable.',
        'PERSISTENCE_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
