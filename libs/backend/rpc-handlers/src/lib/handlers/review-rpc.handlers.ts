import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { ZodError } from 'zod';
import { ReviewRpcSchemas, type IGitHubReviewPort } from '@ptah-extension/review-contracts';
import {
  REVIEW_CORE_TOKENS, ReviewPollDisabledError, type IReviewArtifactReader, type IReviewQueryRepository,
  type IReviewSecretPresence, type IReviewSettingsStore, type ReviewQueueService,
  type ReviewOrchestratorService,
} from '@ptah-extension/review-core';
import { RpcUserError, TOKENS, type Logger, type RpcHandler } from '@ptah-extension/vscode-core';
import type { RpcMethodName } from '@ptah-extension/shared';

@injectable()
export class ReviewRpcHandlers {
  static readonly METHODS = [
    'review:listRuns', 'review:getRun', 'review:listFindings', 'review:listRepositories',
    'review:getSettings', 'review:updateSettings', 'review:setPublicationPause',
    'review:retryHead', 'review:refresh', 'review:exportRun',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'info'>,
    @inject(TOKENS.RPC_HANDLER) private readonly rpc: Pick<RpcHandler, 'registerMethod'>,
    @inject(REVIEW_CORE_TOKENS.QUERY_REPOSITORY) private readonly query: IReviewQueryRepository,
    @inject(REVIEW_CORE_TOKENS.SETTINGS_STORE) private readonly settings: IReviewSettingsStore,
    @inject(REVIEW_CORE_TOKENS.ARTIFACT_READER) private readonly artifacts: IReviewArtifactReader,
    @inject(REVIEW_CORE_TOKENS.SECRET_PRESENCE) private readonly secrets: IReviewSecretPresence,
    @inject(REVIEW_CORE_TOKENS.QUEUE_SERVICE) private readonly queue: Pick<ReviewQueueService, 'retry'>,
    @inject(REVIEW_CORE_TOKENS.ORCHESTRATOR) private readonly orchestrator: Pick<ReviewOrchestratorService, 'pollAndRecord'>,
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: Pick<IGitHubReviewPort, 'getPull'>,
  ) {}

  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error: unknown) {
      if (error instanceof RpcUserError) throw error;
      if (error instanceof ReviewPollDisabledError) throw new RpcUserError('Review repository is disabled', 'REVIEW_DISABLED');
      if (error instanceof ZodError) throw new RpcUserError('Invalid review request', 'INVALID_PARAMS');
      // Never log an untrusted exception: an adapter error may include a credential.
      throw new RpcUserError('Review service is unavailable', 'PERSISTENCE_UNAVAILABLE');
    }
  }

  register(): void {
    this.rpc.registerMethod('review:listRuns', (raw) => this.safe(async () => {
      const params = ReviewRpcSchemas['review:listRuns'].params.parse(raw);
      return ReviewRpcSchemas['review:listRuns'].result.parse(await this.query.listRuns(params));
    }));
    this.rpc.registerMethod('review:getRun', (raw) => this.safe(async () => {
      const { attemptId } = ReviewRpcSchemas['review:getRun'].params.parse(raw);
      return ReviewRpcSchemas['review:getRun'].result.parse(await this.query.getRun(attemptId));
    }));
    this.rpc.registerMethod('review:listFindings', (raw) => this.safe(async () => {
      const { attemptId } = ReviewRpcSchemas['review:listFindings'].params.parse(raw);
      if (!await this.query.getRun(attemptId)) return { findings: [] };
      return ReviewRpcSchemas['review:listFindings'].result.parse({ findings: await this.query.listFindings(attemptId) });
    }));
    this.rpc.registerMethod('review:listRepositories', (raw) => this.safe(async () => {
      ReviewRpcSchemas['review:listRepositories'].params.parse(raw);
      return ReviewRpcSchemas['review:listRepositories'].result.parse(await this.settings.listRepositories());
    }));
    this.rpc.registerMethod('review:getSettings', (raw) => this.safe(async () => {
      ReviewRpcSchemas['review:getSettings'].params.parse(raw);
      const settings = await this.settings.getSettings();
      return ReviewRpcSchemas['review:getSettings'].result.parse({ settings, hasToken: await this.secrets.hasToken() });
    }));
    this.rpc.registerMethod('review:updateSettings', (raw) => this.safe(async () => {
      const { settings } = ReviewRpcSchemas['review:updateSettings'].params.parse(raw);
      return ReviewRpcSchemas['review:updateSettings'].result.parse(await this.settings.updateSettings(settings));
    }));
    this.rpc.registerMethod('review:setPublicationPause', (raw) => this.safe(async () => {
      const { paused, repo } = ReviewRpcSchemas['review:setPublicationPause'].params.parse(raw);
      await this.settings.setPublicationPause(paused, repo);
      return ReviewRpcSchemas['review:setPublicationPause'].result.parse({ ok: true });
    }));
    this.rpc.registerMethod('review:retryHead', (raw) => this.safe(async () => {
      const { repo, prNumber } = ReviewRpcSchemas['review:retryHead'].params.parse(raw);
      const pull = await this.github.getPull(repo, prNumber);
      const attemptId = ulid();
      await this.queue.retry({ repo, prNumber, headSha: pull.headSha }, attemptId);
      return ReviewRpcSchemas['review:retryHead'].result.parse({ ok: true, attemptId });
    }));
    this.rpc.registerMethod('review:refresh', (raw) => this.safe(async () => {
      const { repo } = ReviewRpcSchemas['review:refresh'].params.parse(raw);
      await this.orchestrator.pollAndRecord(repo);
      return ReviewRpcSchemas['review:refresh'].result.parse({ ok: true });
    }));
    this.rpc.registerMethod('review:exportRun', (raw) => this.safe(async () => {
      const { attemptId } = ReviewRpcSchemas['review:exportRun'].params.parse(raw);
      if (!await this.query.getRun(attemptId)) throw new RpcUserError('Review run not found', 'TASK_NOT_FOUND');
      return ReviewRpcSchemas['review:exportRun'].result.parse(await this.artifacts.exportRun(attemptId));
    }));
    this.logger.info('[review] RPC handlers registered');
  }
}
