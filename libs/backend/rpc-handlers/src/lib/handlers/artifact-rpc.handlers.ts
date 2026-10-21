import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { z } from 'zod';
import { SDK_TOKENS, type SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  ArtifactStoreError,
  type IArtifactStore,
  type IUserInteraction,
} from '@ptah-extension/platform-core';
import {
  ArtifactListRequestSchema,
  ArtifactListResponseSchema,
  ArtifactOpenLinkMessageSchema,
} from '@ptah-extension/shared/mcp-apps-contracts';
import type { ArtifactListResponse, RpcMethodName } from '@ptah-extension/shared';
import { TOKENS, RpcUserError, type Logger, type RpcHandler } from '@ptah-extension/vscode-core';

export function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    // degradation-audit: reported — invalid URLs are refused by the caller.
    return false;
  }
}

const OpenLinkParamsSchema = ArtifactOpenLinkMessageSchema.shape.url;
type OpenLinkParams = { url: string };
type OpenLinkResult = { opened: boolean };

@injectable()
export class ArtifactRpcHandlers {
  static readonly METHODS = ['artifacts:list', 'artifacts:openLink'] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER) private readonly container: DependencyContainer,
    @inject(PLATFORM_TOKENS.USER_INTERACTION) private readonly interaction: IUserInteraction,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<{ sessionId: string }, ArtifactListResponse>(
      'artifacts:list', async (params: unknown) => this.list(params),
    );
    this.rpcHandler.registerMethod<OpenLinkParams, OpenLinkResult>(
      'artifacts:openLink', async (params: unknown) => this.openLink(params),
    );
  }

  private async list(params: unknown): Promise<ArtifactListResponse> {
    const parsed = ArtifactListRequestSchema.safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError('artifacts:list: invalid params', 'INVALID_PARAMS');
    }
    if (!this.container.isRegistered(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, true)) {
      return { artifacts: [] };
    }
    const session = this.container.resolve<SessionLifecycleManager>(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
      .find(parsed.data.sessionId);
    const workspaceRoot = session?.config?.projectPath;
    const sessionId = session?.tabId;
    if (!workspaceRoot || !sessionId || !this.container.isRegistered(PLATFORM_TOKENS.ARTIFACT_STORE, true)) {
      return { artifacts: [] };
    }
    const store = this.container.resolve<IArtifactStore>(PLATFORM_TOKENS.ARTIFACT_STORE);
    try {
      const result = await store.list({ workspaceRoot, sessionId });
      return ArtifactListResponseSchema.parse(result);
    } catch (error: unknown) {
      if (error instanceof ArtifactStoreError) {
        throw new RpcUserError('Artifact storage is unavailable.', 'PERSISTENCE_UNAVAILABLE');
      }
      throw error;
    }
  }

  private async openLink(params: unknown): Promise<OpenLinkResult> {
    const parsed = z.strictObject({ url: OpenLinkParamsSchema }).safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError('artifacts:openLink: invalid params', 'INVALID_PARAMS');
    }
    if (!isSafeExternalUrl(parsed.data.url)) return { opened: false };
    try {
      return { opened: await this.interaction.openExternal(parsed.data.url) };
    } catch (error: unknown) {
      // degradation-audit: optional-capability - an external opener can be unavailable on this host.
      this.logger.warn('artifacts:openLink failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { opened: false };
    }
  }
}
