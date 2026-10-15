/**
 * Structured-output decision adapter (plan part A §10).
 *
 * `lane-routing` owns the port and must not import this package. Hosts bind
 * this class to `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`.
 *
 * `complete` returns the model's structured payload, unvalidated. The port
 * declares no failure type (`structured-decision.port.ts`); failures throw
 * {@link StructuredDecisionError}. `kind` is one of the Req 12.7 causes part
 * A §10 names: resolver throw → `auth`, network-class → `unreachable`, no
 * structured output → `bad-output`. An aborted signal throws `AbortError`
 * and is not one of those causes.
 *
 * `toolAccess: 'none'` because the prompt carries the caller's request text.
 * `cwd` is the OS temp directory, as the commit-message one-shot does: the
 * model has no tools and needs nothing from the repository.
 */

import * as os from 'node:os';

import { inject, injectable } from 'tsyringe';
import type {
  StructuredDecisionCompleter,
  StructuredDecisionRequest,
} from '@ptah-extension/lane-routing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import {
  USER_ACTION_QUERY_LANE,
  classifyThrownNetworkFailure,
  QueryNetworkObserver,
} from '../internal-query';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from '../internal-query';
import { SDK_TOKENS } from '../di/tokens';
import {
  isResultMessage,
  isSuccessResult,
} from '../types/sdk-types/claude-sdk.types';

/** Req 12.7 causes this adapter reports. The port does not declare them. */
export type StructuredDecisionFailureKind =
  'auth' | 'unreachable' | 'bad-output';

/**
 * A classified failure of one structured completion.
 *
 * `lane-routing` cannot import this class. Callers recognise it by
 * `name === 'StructuredDecisionError'` and read `kind`.
 */
export class StructuredDecisionError extends Error {
  readonly kind: StructuredDecisionFailureKind;

  constructor(kind: StructuredDecisionFailureKind, detail: string) {
    super(detail);
    this.name = 'StructuredDecisionError';
    this.kind = kind;
  }
}

/** The slice of the internal query service this adapter calls. */
interface StructuredDecisionQuery {
  execute(config: InternalQueryConfig): Promise<InternalQueryHandle>;
}

const PROVIDER_AUTH_ERROR_NAME = 'ProviderAuthError';
const LOG_TAG = '[structured-decision]';
/** One round-trip. The SDK retries a schema miss itself. No tools run. */
const STRUCTURED_DECISION_MAX_TURNS = 1;

@injectable()
export class StructuredDecisionAdapter implements StructuredDecisionCompleter {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Pick<Logger, 'warn' | 'debug'>,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly query: StructuredDecisionQuery,
    /**
     * Registered by `auth-providers`, which depends on this package, so the
     * binding is optional here. A host that registered auth-providers before
     * the first resolve still receives the resolver.
     */
    @inject(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER, { isOptional: true })
    private readonly resolver: IProviderAuthResolver | null = null,
  ) {}

  /**
   * True when the provider can answer: the resolver returned a credential
   * snapshot, or `null` (this provider is the active one, so no extra
   * credential is required). `ProviderAuthError` is not ready. Any other
   * throw propagates; the settings probe maps that to `unreachable`.
   */
  async isReady(providerId: string): Promise<boolean> {
    if (!this.resolver) return false;
    try {
      await this.resolver.resolve(providerId);
      return true;
    } catch (error: unknown) {
      if (isProviderAuthError(error)) {
        this.logger.debug(`${LOG_TAG} provider has no usable credential`, {
          providerId: providerLabel(providerId),
        });
        return false;
      }
      this.logger.warn(`${LOG_TAG} provider readiness failed`, {
        providerId: providerLabel(providerId),
        error: errorName(error),
      });
      throw error instanceof Error
        ? error
        : new Error('provider readiness failed');
    }
  }

  async complete(request: StructuredDecisionRequest): Promise<unknown> {
    if (request.signal.aborted) throw abortFailure();
    const auth = await this.resolveAuth(request.providerId);
    if (request.signal.aborted) throw abortFailure();

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const handle = await this.query.execute({
        cwd: os.tmpdir(),
        model: request.model,
        prompt: request.prompt,
        mcpServerRunning: false,
        maxTurns: STRUCTURED_DECISION_MAX_TURNS,
        outputFormat: { type: 'json_schema', schema: request.jsonSchema },
        abortController,
        lane: USER_ACTION_QUERY_LANE,
        auth,
        toolAccess: 'none',
      });
      return await this.readStructured(handle, request.signal);
    } catch (error: unknown) {
      if (request.signal.aborted || isAbortError(error)) {
        throw isAbortError(error) ? error : abortFailure();
      }
      if (error instanceof StructuredDecisionError) throw error;
      if (classifyThrownNetworkFailure(error)) {
        this.logger.warn(`${LOG_TAG} provider unreachable`, {
          providerId: providerLabel(request.providerId),
          error: errorName(error),
        });
        throw new StructuredDecisionError(
          'unreachable',
          'provider network failure',
        );
      }
      this.logger.warn(`${LOG_TAG} provider returned no structured output`, {
        providerId: providerLabel(request.providerId),
        error: errorName(error),
      });
      throw new StructuredDecisionError(
        'bad-output',
        'the provider returned no structured output',
      );
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * `null` from the resolver means ride the active provider (the requested
   * id is that provider). A throw, including a missing resolver, is `auth`:
   * this call is pinned to `providerId` and must not spend the active quota
   * on a provider it could not authenticate.
   */
  private async resolveAuth(
    providerId: string,
  ): Promise<OneShotAuthOverride | undefined> {
    if (!this.resolver) {
      throw new StructuredDecisionError(
        'auth',
        `provider ${providerLabel(providerId)} auth resolver is not registered`,
      );
    }
    try {
      const auth = await this.resolver.resolve(providerId);
      return auth ?? undefined;
    } catch (error: unknown) {
      this.logger.warn(`${LOG_TAG} provider auth failed`, {
        providerId: providerLabel(providerId),
        error: errorName(error),
      });
      throw new StructuredDecisionError(
        'auth',
        `provider ${providerLabel(providerId)} is not authenticated`,
      );
    }
  }

  private async readStructured(
    handle: InternalQueryHandle,
    signal: AbortSignal,
  ): Promise<unknown> {
    const network = new QueryNetworkObserver();
    let structured: unknown;
    let sawStructured = false;
    for await (const msg of handle.stream) {
      if (signal.aborted) throw abortFailure();
      network.observe(msg);
      if (
        isSuccessResult(msg) &&
        msg.structured_output !== undefined &&
        msg.structured_output !== null
      ) {
        structured = msg.structured_output;
        sawStructured = true;
      }
      if (isResultMessage(msg)) break;
    }
    if (signal.aborted) throw abortFailure();
    const verdict = network.verdict();
    if (verdict.kind === 'network-failure') {
      this.logger.warn(`${LOG_TAG} provider unreachable`, {
        signal: verdict.signal,
      });
      throw new StructuredDecisionError(
        'unreachable',
        `provider network failure (${verdict.signal})`,
      );
    }
    if (!sawStructured) {
      throw new StructuredDecisionError(
        'bad-output',
        'the provider returned no structured output',
      );
    }
    return structured;
  }
}

function abortFailure(): Error {
  const error = new Error('The structured decision was aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isProviderAuthError(error: unknown): boolean {
  return error instanceof Error && error.name === PROVIDER_AUTH_ERROR_NAME;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

function providerLabel(providerId: string): string {
  return providerId.slice(0, 64);
}
