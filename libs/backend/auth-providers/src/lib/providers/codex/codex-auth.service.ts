/** Default-home compatibility facade. Credential ownership lives in CodexHomeAuthService. */
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
  type IDisposable,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS, type SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import type { ICodexAuthService } from './codex-provider.types';
import { CodexHomeResolver } from './codex-home-resolver';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import {
  CodexHomeAuthService,
  resolveCodexHome,
} from './codex-home-auth.service';

@injectable()
export class CodexAuthService implements ICodexAuthService {
  private readonly owner: CodexHomeAuthService;
  private readonly home: string;
  private readonly delegate: ICodexAuthService;
  private subscription: IDisposable | undefined;

  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly events: SdkAdapterEvents,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER)
    codexHome: CodexHomeResolver = new CodexHomeResolver(),
  ) {
    // Preserve explicit injected homes; canonicalize the existing default resolver
    // without changing its registration (owned by batch 5c).
    this.home =
      codexHome.path === new CodexHomeResolver().path
        ? resolveCodexHome()
        : codexHome.path;
    this.owner = CodexHomeAuthService.forHost(logger, workspaceProvider);
    this.delegate = this.owner.forHome(this.home);
  }
  getAccountUsageEligibility() {
    return this.owner.getUsageEligibility(this.home);
  }
  isAuthenticated() {
    return this.owner.isAuthenticated(this.home);
  }
  getHeaders() {
    return this.delegate.getHeaders();
  }
  getApiEndpoint() {
    return this.delegate.getApiEndpoint();
  }
  listModels() {
    return this.delegate.listModels();
  }
  getTokenStatus() {
    return this.delegate.getTokenStatus();
  }
  clearCache(): void {
    this.delegate.clearCache();
  }
  ensureTokensFresh() {
    return this.owner.ensureTokensFresh(this.home);
  }
  startWatchingAuthFile(): void {
    if (this.subscription) {
      this.delegate.startWatchingAuthFile();
      return;
    }
    this.subscription = this.owner.watch(this.home, (event) => {
      // Legacy consumers historically receive external changes only.
      if (event.kind !== 'refreshed')
        this.events.emitAuthFileChanged({
          providerId: 'openai-codex',
          timestamp: Date.now(),
        });
    });
  }
  stopWatchingAuthFile(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
  }
}
