import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type GitInfoService,
  type Logger,
} from '@ptah-extension/vscode-core';
import type {
  GitCommitMessageUnavailableReason,
  GitGenerateCommitMessageResult,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import type { InternalQueryService } from '../internal-query';
import { USER_ACTION_QUERY_LANE } from '../internal-query/internal-query-concurrency-gate';
import {
  classifyThrownNetworkFailure,
  QueryNetworkObserver,
  type NetworkFailureSignal,
  type NetworkObservableMessage,
} from '../internal-query/network-failure';
import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import { AuthRequiredError, InternalQueryQueueTimeoutError } from '../errors';
import {
  isAssistantMessage,
  isErrorResult,
  isResultMessage,
  isTextBlock,
  type SDKAssistantMessage,
  type SDKMessage,
} from '../types/sdk-types/claude-sdk.types';
import {
  COMMIT_MESSAGE_SYSTEM_PROMPT,
  COMMIT_SUBJECT_MAX_CHARS,
  buildCommitMessageUserPrompt,
} from './commit-message-prompt';

/** How long one generation may take, queue wait included, before it is aborted. */
export const COMMIT_MESSAGE_TIMEOUT_MS = 45_000;

/**
 * A tier alias, not a model id, for the same reason as the curator's
 * `CURATOR_DEFAULT_MODEL_TIER`: the resolver maps a bare tier onto whichever
 * provider is active, where a pinned Anthropic id would 404 elsewhere.
 */
export const COMMIT_MESSAGE_MODEL_TIER = 'haiku';

/**
 * Matched by `name`, never `instanceof`: both classes live in
 * `auth-providers`, which depends on this lib. Same mirrors as the curator's
 * (`sdk-internal-query.curator-llm.ts`).
 */
const PROVIDER_AUTH_ERROR_NAME = 'ProviderAuthError';
const PROVIDER_QUOTA_ERROR_NAME = 'ProviderQuotaError';

const LOG_TAG = '[commit-message]';

type AuthDecision =
  | { readonly kind: 'ride-active' }
  | { readonly kind: 'override'; readonly auth: OneShotAuthOverride }
  | { readonly kind: 'rate-limited' };

/** What one query produced, before it becomes the public result. */
type QueryOutcome =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'unavailable';
      readonly reason: GitCommitMessageUnavailableReason;
    };

/** What the stream of one query said, read up to its `result` message. */
interface StreamReading {
  /** Text of the LAST assistant message: the reply the prompt asked for. */
  readonly lastAssistantText: string;
  readonly lastAssistantErrored: boolean;
  /** The query stopped on `error_max_turns`. */
  readonly hitTurnCeiling: boolean;
  readonly network: QueryNetworkObserver;
}

/**
 * Writes a commit message for the staged changes of one repository, on the
 * active provider (TASK_2026_576 Component 30, Gate 2 Clarification 2 (a)).
 *
 * Every failure is a named `unavailable` reason, never `''` and never a throw:
 * the composer shows "type your own" for all of them, and committing does not
 * depend on this service at all.
 *
 * Privacy: the only repository content sent is the staged diff, capped by
 * `GitInfoService.readStagedPatch`. The diff and the model's reply are never
 * logged.
 */
@injectable()
export class CommitMessageGenerator {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: InternalQueryService,
    @inject(TOKENS.GIT_INFO_SERVICE) private readonly gitInfo: GitInfoService,
    @inject(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER, { isOptional: true })
    private readonly resolver: IProviderAuthResolver | null = null,
  ) {}

  async generate(
    workspaceRoot: string,
  ): Promise<GitGenerateCommitMessageResult> {
    const staged = await this.gitInfo.readStagedPatch(workspaceRoot);
    if (staged.kind === 'none') return unavailable('no-staged-changes');
    // The reader already logged the git failure; the shared reason type
    // documents `unreachable` as covering an unreadable staged diff.
    if (staged.kind === 'failed') return unavailable('unreachable');

    if (!this.internalQuery.isInitialized()) {
      this.logger.info(`${LOG_TAG} no AI provider is initialised on this host`);
      return unavailable('no-provider');
    }

    const decision = await this.resolveAuth();
    if (decision.kind === 'rate-limited') return unavailable('rate-limited');

    this.logger.debug(`${LOG_TAG} generating a commit message`, {
      patchBytes: Buffer.byteLength(staged.patch, 'utf8'),
      truncated: staged.truncated,
    });
    const outcome = await this.runQuery(
      buildCommitMessageUserPrompt(staged.patch, staged.truncated),
      decision.kind === 'override' ? decision.auth : undefined,
    );
    if (outcome.kind === 'unavailable') return unavailable(outcome.reason);

    const message = this.toCommitMessage(outcome.text);
    if (message.length === 0) {
      this.logger.info(
        `${LOG_TAG} the provider answered without a usable message`,
      );
      return unavailable('empty');
    }
    return { status: 'generated', message };
  }

  /**
   * `''` asks for the active provider. A configured-but-unusable provider
   * (`ProviderAuthError`) rides the active one with no override, as the
   * curator does; a quota cooldown (`ProviderQuotaError`) stops, because the
   * provider a fallback would ride is the one that just refused.
   */
  private async resolveAuth(): Promise<AuthDecision> {
    if (!this.resolver) return { kind: 'ride-active' };
    try {
      const auth = await this.resolver.resolve('');
      return auth ? { kind: 'override', auth } : { kind: 'ride-active' };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === PROVIDER_QUOTA_ERROR_NAME) {
        this.logger.warn(`${LOG_TAG} the active provider is rate-limited`, {
          error: error.message,
        });
        return { kind: 'rate-limited' };
      }
      if (error instanceof Error && error.name === PROVIDER_AUTH_ERROR_NAME) {
        this.logger.warn(
          `${LOG_TAG} provider auth unavailable; riding the active provider`,
          { error: error.message },
        );
        return { kind: 'ride-active' };
      }
      // Anything else is not a decision the resolver made; the query itself
      // will report whether the active provider can be reached.
      this.logger.warn(
        `${LOG_TAG} provider auth resolution failed; riding the active provider`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      return { kind: 'ride-active' };
    }
  }

  private async runQuery(
    prompt: string,
    auth: OneShotAuthOverride | undefined,
  ): Promise<QueryOutcome> {
    const abortController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, COMMIT_MESSAGE_TIMEOUT_MS);
    timer.unref?.();

    try {
      const handle = await this.internalQuery.execute({
        // The model needs nothing from disk — the diff is in the prompt — so it
        // runs outside the repository, as the draft probe does.
        cwd: os.tmpdir(),
        model: COMMIT_MESSAGE_MODEL_TIER,
        prompt,
        systemPromptAppend: COMMIT_MESSAGE_SYSTEM_PROMPT,
        mcpServerRunning: false,
        maxTurns: 1,
        lane: USER_ACTION_QUERY_LANE,
        queueTimeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
        abortController,
        auth,
        // The prompt carries the staged diff, which anyone who can land a
        // file in the repository can write. No tool may run, whatever it says.
        toolAccess: 'none',
      });

      const reading = await this.readStream(handle.stream);
      if (timedOut) return this.timedOut();
      return this.toOutcome(reading);
    } catch (error: unknown) {
      if (timedOut) return this.timedOut();
      return this.thrownFailure(error);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read the stream up to its `result` message, as the curator does. */
  private async readStream(
    stream: AsyncIterable<SDKMessage>,
  ): Promise<StreamReading> {
    let lastAssistantText = '';
    let lastAssistantErrored = false;
    let hitTurnCeiling = false;
    const network = new QueryNetworkObserver();
    for await (const msg of stream) {
      const evidence: NetworkObservableMessage = msg;
      network.observe(evidence);
      if (isAssistantMessage(msg)) {
        lastAssistantErrored = evidence.error !== undefined;
        lastAssistantText = assistantText(msg.message.content);
      }
      if (isResultMessage(msg)) {
        hitTurnCeiling =
          isErrorResult(msg) && msg.subtype === 'error_max_turns';
        break;
      }
    }
    return { lastAssistantText, lastAssistantErrored, hitTurnCeiling, network };
  }

  private toOutcome(reading: StreamReading): QueryOutcome {
    const verdict = reading.network.verdict();
    if (verdict.kind === 'network-failure') {
      return this.networkFailure(verdict.signal);
    }
    // An error assistant message is the subprocess giving up, not the
    // model's answer. A turn-ceiling stop after a clean reply still carries
    // the reply (the model wrote text, then reached for a tool).
    const replied =
      verdict.kind === 'answered' ||
      (reading.hitTurnCeiling && !reading.lastAssistantErrored);
    if (!replied) {
      this.logger.warn(`${LOG_TAG} the provider returned an error result`);
      return { kind: 'unavailable', reason: 'unreachable' };
    }
    return { kind: 'text', text: reading.lastAssistantText };
  }

  private timedOut(): QueryOutcome {
    this.logger.warn(`${LOG_TAG} generation timed out`, {
      timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
    });
    return { kind: 'unavailable', reason: 'timeout' };
  }

  private networkFailure(signal: NetworkFailureSignal): QueryOutcome {
    this.logger.warn(`${LOG_TAG} the provider could not be reached`, {
      signal,
    });
    return {
      kind: 'unavailable',
      reason: signal === 'http-429' ? 'rate-limited' : 'unreachable',
    };
  }

  private thrownFailure(error: unknown): QueryOutcome {
    if (error instanceof AuthRequiredError) {
      this.logger.info(`${LOG_TAG} no AI provider is authenticated`);
      return { kind: 'unavailable', reason: 'no-provider' };
    }
    if (error instanceof InternalQueryQueueTimeoutError) {
      return this.timedOut();
    }
    const signal = classifyThrownNetworkFailure(error);
    if (signal) return this.networkFailure(signal);
    this.logger.warn(`${LOG_TAG} generation failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'unavailable', reason: 'unreachable' };
  }

  /**
   * The reply as a commit message: code fences and wrapping quotes removed, a
   * subject of at most {@link COMMIT_SUBJECT_MAX_CHARS} characters with no
   * trailing period, then a blank line and the body when there is one.
   * Returns `''` when no subject is left.
   */
  private toCommitMessage(reply: string): string {
    const lines = reply
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => !/^\s*```/.test(line))
      .map((line) => line.trimEnd());
    const subjectIndex = lines.findIndex((line) => line.trim().length > 0);
    if (subjectIndex < 0) return '';

    const subject = this.toSubject(lines[subjectIndex]);
    if (subject.length === 0) return '';

    const bodyLines = lines.slice(subjectIndex + 1);
    while (bodyLines.length > 0 && bodyLines[0].trim().length === 0) {
      bodyLines.shift();
    }
    while (bodyLines.length > 0 && bodyLines.at(-1)?.trim().length === 0) {
      bodyLines.pop();
    }
    return bodyLines.length > 0
      ? `${subject}\n\n${bodyLines.join('\n')}`
      : subject;
  }

  private toSubject(line: string): string {
    let subject = line
      .trim()
      .replace(/^(["'`])(.*)\1$/, '$2')
      .trim();
    if (subject.length > COMMIT_SUBJECT_MAX_CHARS) {
      const cut = subject.slice(0, COMMIT_SUBJECT_MAX_CHARS);
      const lastSpace = cut.lastIndexOf(' ');
      // Break on a word when one is close enough; otherwise cut hard.
      subject =
        lastSpace >= COMMIT_SUBJECT_MAX_CHARS / 2
          ? cut.slice(0, lastSpace)
          : cut;
    }
    return trimTrailingSpaceAndPeriods(subject);
  }
}

/** The text blocks of one assistant message, joined. */
function assistantText(
  content: SDKAssistantMessage['message']['content'],
): string {
  let text = '';
  for (const block of content) {
    if (isTextBlock(block)) text += block.text;
  }
  return text;
}

/** `value` without its trailing whitespace and periods; no regex, no backtracking. */
function trimTrailingSpaceAndPeriods(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === '.' || value[end - 1].trim() === '')) {
    end--;
  }
  return value.slice(0, end);
}

function unavailable(
  reason: GitCommitMessageUnavailableReason,
): GitGenerateCommitMessageResult {
  return { status: 'unavailable', reason };
}
