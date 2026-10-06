import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { DraftVerificationService } from '@ptah-extension/auth-providers';
import type {
  AuthCancelDraftVerificationParams,
  AuthCancelDraftVerificationResult,
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
} from '@ptah-extension/shared';

export interface DraftVerificationMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly draftVerification: DraftVerificationService;
}

/** `auth:verifyDraftConnection` and `auth:cancelDraftVerification`. */
export class DraftVerificationMethods {
  constructor(private readonly deps: DraftVerificationMethodsDeps) {}

  /**
   * auth:verifyDraftConnection - Probe a draft connection BEFORE it is saved.
   *
   * Delegates to `DraftVerificationService.verify`, which exercises the DRAFT
   * (via `ProviderAuthResolver.buildDraftOverride`) and never the persisted
   * route, writes nothing to disk, and returns a sanitized diagnostic. The
   * draft credential is transient: it is passed through this handler to the
   * service and is never logged, echoed back, or persisted here.
   */
  registerVerifyDraftConnection(): void {
    const { logger, sentryService, draftVerification } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthVerifyDraftConnectionParams,
      AuthVerifyDraftConnectionResult
    >(
      'auth:verifyDraftConnection',
      async (params: AuthVerifyDraftConnectionParams) => {
        try {
          logger.debug('RPC: auth:verifyDraftConnection called');
          return await draftVerification.verify(params);
        } catch (error) {
          logger.error(
            'RPC: auth:verifyDraftConnection failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerVerifyDraftConnection' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * auth:cancelDraftVerification - Abort an in-flight draft probe by id.
   *
   * Infallible by design: an unknown or already-settled `probeId` answers
   * `{ cancelled: false }` rather than throwing, because the frontend issues
   * cancel on a fire-and-forget basis (the transport carries no per-request
   * cancel token) and must not surface an error for a benign race.
   */
  registerCancelDraftVerification(): void {
    const { logger, draftVerification } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthCancelDraftVerificationParams,
      AuthCancelDraftVerificationResult
    >(
      'auth:cancelDraftVerification',
      async (params: AuthCancelDraftVerificationParams) => {
        try {
          return await draftVerification.cancel(params);
        } catch (error) {
          logger.warn(
            'RPC: auth:cancelDraftVerification failed (non-fatal)',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { cancelled: false };
        }
      },
    );
  }
}
