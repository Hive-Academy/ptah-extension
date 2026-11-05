import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { z, ZodError } from 'zod';
import {
  ReviewRpcSchemas,
  type IGitHubReviewPort,
} from '@ptah-extension/review-contracts';
import {
  REVIEW_CORE_TOKENS,
  ReviewPollDisabledError,
  type IReviewArtifactReader,
  type IReviewQueryRepository,
  type IReviewSecretPresence,
  type IReviewSettingsStore,
  type ReviewQueueService,
  type ReviewOrchestratorService,
  ReviewPolicyService,
  type ReviewStageEnvironment,
} from '@ptah-extension/review-core';
import {
  PLATFORM_TOKENS,
  type ISecretStorage,
} from '@ptah-extension/platform-core';
import {
  REVIEW_GITHUB_TOKEN_KEY,
  REVIEW_GITHUB_TOKENS,
} from '@ptah-extension/review-github';
import {
  RpcUserError,
  TOKENS,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import type { RpcMethodName } from '@ptah-extension/shared';

const empty = z.object({}).strict();
const ok = z.object({ ok: z.literal(true) }).strict();
const tokenParams = z.object({ token: z.string().min(1).max(4096) }).strict();
const rerunParams = z
  .object({ attemptId: z.string().min(1).max(64), dryRun: z.boolean() })
  .strict();
const rerunResult = z.object({ attemptId: z.string().min(1).max(64) }).strict();
const identity = z
  .object({
    login: z.string().min(1).max(39),
    scopes: z.array(z.string()),
    connectedAt: z.string().datetime(),
    verifiedAt: z.string().datetime().nullable(),
    tokenStorage: z.enum(['encrypted', 'plaintext']),
  })
  .strict()
  .nullable();

@injectable()
export class ReviewRpcHandlers {
  private readonly refreshPolls = new Map<string, Promise<number>>();
  static readonly METHODS = [
    'review:getBotIdentity',
    'review:setBotToken',
    'review:clearBotToken',
    'review:rerun',
    'review:listRuns',
    'review:getRun',
    'review:listFindings',
    'review:listRepositories',
    'review:getSettings',
    'review:updateSettings',
    'review:setPublicationPause',
    'review:retryHead',
    'review:refresh',
    'review:exportRun',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'info'>,
    @inject(TOKENS.RPC_HANDLER)
    private readonly rpc: Pick<RpcHandler, 'registerMethod'>,
    @inject(REVIEW_CORE_TOKENS.QUERY_REPOSITORY)
    private readonly query: IReviewQueryRepository,
    @inject(REVIEW_CORE_TOKENS.SETTINGS_STORE)
    private readonly settings: IReviewSettingsStore,
    @inject(REVIEW_CORE_TOKENS.ARTIFACT_READER)
    private readonly artifacts: IReviewArtifactReader,
    @inject(REVIEW_CORE_TOKENS.SECRET_PRESENCE)
    private readonly secrets: IReviewSecretPresence,
    @inject(REVIEW_CORE_TOKENS.QUEUE_SERVICE)
    private readonly queue: Pick<ReviewQueueService, 'retry'>,
    @inject(REVIEW_CORE_TOKENS.ORCHESTRATOR)
    private readonly orchestrator: Pick<
      ReviewOrchestratorService,
      'pollAndRecord'
    >,
    @inject(REVIEW_CORE_TOKENS.GITHUB)
    private readonly github: Pick<IGitHubReviewPort, 'getPull'>,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly tokenStorage: ISecretStorage,
    @inject(REVIEW_GITHUB_TOKENS.FETCH) private readonly fetcher: typeof fetch,
    @inject(ReviewPolicyService) private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT)
    private readonly environment: ReviewStageEnvironment,
  ) {}

  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof RpcUserError) throw error;
      if (error instanceof ReviewPollDisabledError)
        throw new RpcUserError(
          'Review repository is disabled',
          'REVIEW_DISABLED',
        );
      if (error instanceof ZodError)
        throw new RpcUserError('Invalid review request', 'INVALID_PARAMS');
      // Never log an untrusted exception: an adapter error may include a credential.
      throw new RpcUserError(
        'Review service is unavailable',
        'PERSISTENCE_UNAVAILABLE',
      );
    }
  }

  private async botVerified(expectedLogin: string): Promise<boolean> {
    const token = await this.tokenStorage.get(REVIEW_GITHUB_TOKEN_KEY);
    if (!token) return false;
    const response = await this.fetcher('https://api.github.com/user', {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PtahReview/1.0',
      },
    });
    if (!response.ok) return false;
    const body = await response.text();
    if (body.length > 65_536) return false;
    const user = z
      .object({ login: z.string().min(1).max(39) })
      .safeParse(JSON.parse(body));
    return (
      user.success &&
      user.data.login.toLowerCase() === expectedLogin.toLowerCase()
    );
  }

  register(): void {
    this.rpc.registerMethod('review:getBotIdentity', (raw) =>
      this.safe(async () => {
        empty.parse(raw);
        const token = await this.tokenStorage.get(REVIEW_GITHUB_TOKEN_KEY);
        if (!token) return identity.parse(null);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          let response: Response;
          try {
            response = await this.fetcher('https://api.github.com/user', {
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'PtahReview/1.0',
              },
            });
          } catch (error: unknown) {
            if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
              throw new RpcUserError('GitHub bot verification timed out', 'REVIEW_DISABLED');
            throw new RpcUserError('Could not reach GitHub to verify the bot token', 'REVIEW_DISABLED');
          }
          if (response.status === 401 || response.status === 403)
            throw new RpcUserError('GitHub rejected the bot token or its permissions', 'REVIEW_DISABLED');
          if (!response.ok)
            throw new RpcUserError('GitHub bot verification is unavailable', 'REVIEW_DISABLED');
          const body = await response.text();
          if (body.length > 65_536)
            throw new Error('Bot identity response too large');
          const user = z
            .object({ login: z.string().min(1).max(39) })
            .parse(JSON.parse(body));
          const now = new Date().toISOString();
          const previous = await this.settings.getLiveGate();
          const settings = await this.settings.getSettings();
          const repo =
            settings?.repositories.find(
              (entry) =>
                entry.owner === previous?.repo.owner &&
                entry.name === previous?.repo.name,
            ) ??
            settings?.repositories[0] ??
            null;
          if (repo)
            await this.settings.setLiveGate({
              repo: { owner: repo.owner, name: repo.name },
              login: user.login,
              connectedAt:
                previous?.login === user.login ? previous.connectedAt : now,
              verifiedAt: now,
              attestation:
                previous?.login === user.login ? previous.attestation : null,
            });
          return identity.parse({
            login: user.login,
            scopes: (response.headers.get('x-oauth-scopes') ?? '')
              .split(',')
              .map((scope) => scope.trim())
              .filter(Boolean),
            connectedAt:
              previous?.login === user.login ? previous.connectedAt : now,
            verifiedAt: now,
            tokenStorage: this.tokenStorage.storageMode?.() ?? 'encrypted',
          });
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    this.rpc.registerMethod('review:setBotToken', (raw) =>
      this.safe(async () => {
        const { token } = tokenParams.parse(raw);
        await this.tokenStorage.store(REVIEW_GITHUB_TOKEN_KEY, token);
        await this.settings.setLiveGate(null);
        return ok.parse({ ok: true });
      }),
    );
    this.rpc.registerMethod('review:clearBotToken', (raw) =>
      this.safe(async () => {
        empty.parse(raw);
        await this.tokenStorage.delete(REVIEW_GITHUB_TOKEN_KEY);
        await this.settings.setLiveGate(null);
        return ok.parse({ ok: true });
      }),
    );
    this.rpc.registerMethod('review:rerun', (raw) =>
      this.safe(async () => {
        const { attemptId: priorId, dryRun } = rerunParams.parse(raw);
        const prior = await this.query.getRun(priorId);
        if (!prior)
          throw new RpcUserError('Review run not found', 'TASK_NOT_FOUND');
        const pull = await this.github.getPull(prior.repo, prior.prNumber);
        if (pull.headSha !== prior.headSha || pull.state !== 'open')
          throw new RpcUserError(
            'Pull request head changed',
            'REVIEW_DISABLED',
          );
        const settings = await this.settings.getSettings();
        const config = await this.environment.baseConfig(
          prior.repo,
          pull.baseSha,
        );
        const eligible = this.policy.eligibility({
          owner: prior.repo.owner,
          name: prior.repo.name,
          authorLogin: pull.authorLogin,
          state: pull.state,
          draft: pull.draft,
          headIsFork: pull.headIsFork,
          headRepoId: pull.headRepoId,
          baseRepoId: pull.baseRepoId,
          settings,
          baseConfig: config,
        }).eligible;
        const gate = await this.settings.getLiveGate();
        if (
          !eligible ||
          (!dryRun &&
            (!this.policy.publication(settings, config, prior.repo).allowed ||
              !gate?.attestation ||
              gate.repo.owner !== prior.repo.owner ||
              gate.repo.name !== prior.repo.name ||
              !(await this.botVerified(gate.login))))
        )
          throw new RpcUserError(
            'Review publication is unavailable',
            'REVIEW_DISABLED',
          );
        const attemptId = ulid();
        await this.queue.retry(
          { repo: prior.repo, prNumber: prior.prNumber, headSha: pull.headSha },
          attemptId,
          dryRun,
        );
        return rerunResult.parse({ attemptId });
      }),
    );
    this.rpc.registerMethod('review:listRuns', (raw) =>
      this.safe(async () => {
        const params = ReviewRpcSchemas['review:listRuns'].params.parse(raw);
        return ReviewRpcSchemas['review:listRuns'].result.parse(
          await this.query.listRuns(params),
        );
      }),
    );
    this.rpc.registerMethod('review:getRun', (raw) =>
      this.safe(async () => {
        const { attemptId } =
          ReviewRpcSchemas['review:getRun'].params.parse(raw);
        return ReviewRpcSchemas['review:getRun'].result.parse(
          await this.query.getRun(attemptId),
        );
      }),
    );
    this.rpc.registerMethod('review:listFindings', (raw) =>
      this.safe(async () => {
        const { attemptId } =
          ReviewRpcSchemas['review:listFindings'].params.parse(raw);
        if (!(await this.query.getRun(attemptId))) return { findings: [] };
        return ReviewRpcSchemas['review:listFindings'].result.parse({
          findings: await this.query.listFindings(attemptId),
        });
      }),
    );
    this.rpc.registerMethod('review:listRepositories', (raw) =>
      this.safe(async () => {
        ReviewRpcSchemas['review:listRepositories'].params.parse(raw);
        return ReviewRpcSchemas['review:listRepositories'].result.parse(
          await this.settings.listRepositories(),
        );
      }),
    );
    this.rpc.registerMethod('review:getSettings', (raw) =>
      this.safe(async () => {
        ReviewRpcSchemas['review:getSettings'].params.parse(raw);
        const settings = await this.settings.getSettings();
        return ReviewRpcSchemas['review:getSettings'].result.parse({
          settings,
          hasToken: await this.secrets.hasToken(),
          tokenStorage: this.tokenStorage.storageMode?.() ?? 'encrypted',
        });
      }),
    );
    this.rpc.registerMethod('review:updateSettings', (raw) =>
      this.safe(async () => {
        const { settings, attestation } =
          ReviewRpcSchemas['review:updateSettings'].params.parse(raw);
        if (
          settings.repositories.some((repo) => !repo.dryRun) &&
          !(await this.secrets.hasToken())
        )
          throw new RpcUserError(
            'Connect a bot token before enabling live publication',
            'REVIEW_DISABLED',
          );
        if (
          settings.repositories.filter((repo) => repo.enabled && !repo.dryRun)
            .length > 1
        )
          throw new RpcUserError(
            'Only one repository can publish live at a time',
            'REVIEW_DISABLED',
          );
        const liveRepo = settings.repositories.find((entry) => entry.enabled && !entry.dryRun);
        const previousGate = await this.settings.getLiveGate();
        let verifiedLogin: string | null = null;
        if (liveRepo) {
          const token = await this.tokenStorage.get(REVIEW_GITHUB_TOKEN_KEY);
          if (!token) throw new RpcUserError('Connect a bot token before enabling live publication', 'REVIEW_DISABLED');
          const response = await this.fetcher('https://api.github.com/user', {
            signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'PtahReview/1.0' },
          });
          if (!response.ok) throw new RpcUserError('Bot identity verification failed', 'REVIEW_DISABLED');
          const body = await response.text();
          if (body.length > 65_536) throw new RpcUserError('Bot identity verification failed', 'REVIEW_DISABLED');
          verifiedLogin = z.object({ login: z.string().min(1).max(39) }).parse(JSON.parse(body)).login;
          const sameRepo = previousGate?.repo.owner.toLowerCase() === liveRepo.owner.toLowerCase()
            && previousGate?.repo.name.toLowerCase() === liveRepo.name.toLowerCase();
          const permission = attestation ?? (sameRepo ? previousGate?.attestation : null);
          if (!permission || !settings.maintainerLogins.some((login) => login.toLowerCase() === permission.who.toLowerCase()))
            throw new RpcUserError('Permission attestation required for this repository', 'REVIEW_DISABLED');
        }
        const saved = await this.settings.updateSettings(settings);
        if (liveRepo && verifiedLogin) {
          const sameRepo = previousGate?.repo.owner.toLowerCase() === liveRepo.owner.toLowerCase()
            && previousGate?.repo.name.toLowerCase() === liveRepo.name.toLowerCase();
          await this.settings.setLiveGate({
            repo: { owner: liveRepo.owner, name: liveRepo.name },
            login: verifiedLogin,
            connectedAt: sameRepo && previousGate?.login.toLowerCase() === verifiedLogin.toLowerCase()
              ? previousGate.connectedAt : new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            attestation: attestation
              ? { ...attestation, when: new Date().toISOString() }
              : sameRepo ? previousGate?.attestation ?? null : null,
          });
        } else if (previousGate) {
          await this.settings.setLiveGate(null);
        }
        return ReviewRpcSchemas['review:updateSettings'].result.parse(saved);
      }),
    );
    this.rpc.registerMethod('review:setPublicationPause', (raw) =>
      this.safe(async () => {
        const { paused, repo } =
          ReviewRpcSchemas['review:setPublicationPause'].params.parse(raw);
        await this.settings.setPublicationPause(paused, repo);
        return ReviewRpcSchemas['review:setPublicationPause'].result.parse({
          ok: true,
        });
      }),
    );
    this.rpc.registerMethod('review:retryHead', (raw) =>
      this.safe(async () => {
        const { repo, prNumber } =
          ReviewRpcSchemas['review:retryHead'].params.parse(raw);
        const pull = await this.github.getPull(repo, prNumber);
        const attemptId = ulid();
        await this.queue.retry(
          { repo, prNumber, headSha: pull.headSha },
          attemptId,
        );
        return ReviewRpcSchemas['review:retryHead'].result.parse({
          ok: true,
          attemptId,
        });
      }),
    );
    this.rpc.registerMethod('review:refresh', (raw) =>
      this.safe(async () => {
        const { repo } = ReviewRpcSchemas['review:refresh'].params.parse(raw);
        const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
        if (!this.refreshPolls.has(key)) {
          const poll = this.orchestrator.pollAndRecord(repo);
          this.refreshPolls.set(key, poll);
          void poll.catch(() => {
            // degradation-audit: reported — pollAndRecord persists failure for the poll-status banner.
          }).finally(() => {
            if (this.refreshPolls.get(key) === poll) this.refreshPolls.delete(key);
          });
        }
        return ReviewRpcSchemas['review:refresh'].result.parse({ ok: true });
      }),
    );
    this.rpc.registerMethod('review:exportRun', (raw) =>
      this.safe(async () => {
        const { attemptId } =
          ReviewRpcSchemas['review:exportRun'].params.parse(raw);
        if (!(await this.query.getRun(attemptId)))
          throw new RpcUserError('Review run not found', 'TASK_NOT_FOUND');
        return ReviewRpcSchemas['review:exportRun'].result.parse(
          await this.artifacts.exportRun(attemptId),
        );
      }),
    );
    this.logger.info('[review] RPC handlers registered');
  }
}
