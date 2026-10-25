import {
  sessionRuntimeIdentityMismatch,
  type IAgentAdapter,
  type RuntimeHostCapabilities,
  type SessionId,
} from '@ptah-extension/shared';
import {
  SessionRuntimeRoutingError,
  type SessionRuntimeIdentityLookup,
} from './session-runtime-router';

/** Capability is supplied by composition from the parity gate / DS1 override.
 * It is an admission hint only: CodexChatAdapter still uses the gated resolver.
 */
export class RoutingAgentAdapter implements IAgentAdapter {
  constructor(
    private readonly identities: SessionRuntimeIdentityLookup,
    private readonly legacy: IAgentAdapter,
    private readonly native: IAgentAdapter,
    private readonly capabilities: RuntimeHostCapabilities = {
      nativeCodex: false,
    },
  ) {}

  get providerId() {
    return this.legacy.providerId;
  }
  get info() {
    return this.legacy.info;
  }
  initialize(): Promise<boolean> {
    return this.legacy.initialize();
  }
  dispose(): void {
    try {
      this.native.dispose();
    } finally {
      this.legacy.dispose();
    }
  }
  preloadSdk(): Promise<void> {
    return this.legacy.preloadSdk();
  }
  getCliJsPath(): string | null {
    return this.legacy.getCliJsPath();
  }
  verifyInstallation(): Promise<boolean> {
    return this.legacy.verifyInstallation();
  }
  getHealth(): ReturnType<IAgentAdapter['getHealth']> {
    return this.legacy.getHealth();
  }
  async reset(): Promise<void> {
    await Promise.all([this.legacy.reset(), this.native.reset()]);
  }
  getSupportedModels(): ReturnType<IAgentAdapter['getSupportedModels']> {
    return this.legacy.getSupportedModels();
  }
  getDefaultModel(): Promise<string> {
    return this.legacy.getDefaultModel();
  }
  getApiModels(): ReturnType<IAgentAdapter['getApiModels']> {
    return this.legacy.getApiModels();
  }
  startChatSession(
    ...args: Parameters<IAgentAdapter['startChatSession']>
  ): ReturnType<IAgentAdapter['startChatSession']> {
    return (
      this.capabilities.nativeCodex ? this.native : this.legacy
    ).startChatSession(...args);
  }
  resumeSession(
    ...args: Parameters<IAgentAdapter['resumeSession']>
  ): ReturnType<IAgentAdapter['resumeSession']> {
    return this.adapter(args[0]).resumeSession(...args);
  }
  endSession(...args: Parameters<IAgentAdapter['endSession']>): void {
    this.adapter(args[0]).endSession(...args);
  }
  sendMessageToSession(
    ...args: Parameters<IAgentAdapter['sendMessageToSession']>
  ): ReturnType<IAgentAdapter['sendMessageToSession']> {
    return this.adapter(args[0]).sendMessageToSession(...args);
  }
  isSessionActive(
    ...args: Parameters<IAgentAdapter['isSessionActive']>
  ): boolean {
    return this.adapter(args[0]).isSessionActive(...args);
  }
  getSessionToken(
    ...args: Parameters<IAgentAdapter['getSessionToken']>
  ): string | null {
    return this.adapter(args[0]).getSessionToken(...args);
  }
  endSessionIfTokenMatches(
    ...args: Parameters<IAgentAdapter['endSessionIfTokenMatches']>
  ): ReturnType<IAgentAdapter['endSessionIfTokenMatches']> {
    return this.adapter(args[0]).endSessionIfTokenMatches(...args);
  }
  executeSlashCommand(
    ...args: Parameters<IAgentAdapter['executeSlashCommand']>
  ): ReturnType<IAgentAdapter['executeSlashCommand']> {
    return this.adapter(args[0]).executeSlashCommand(...args);
  }
  interruptCurrentTurn(
    ...args: Parameters<IAgentAdapter['interruptCurrentTurn']>
  ): Promise<boolean> {
    return this.adapter(args[0]).interruptCurrentTurn(...args);
  }
  interruptSession(
    ...args: Parameters<IAgentAdapter['interruptSession']>
  ): Promise<void> {
    return this.adapter(args[0]).interruptSession(...args);
  }
  setSessionPermissionLevel(
    ...args: Parameters<IAgentAdapter['setSessionPermissionLevel']>
  ): Promise<void> {
    return this.adapter(args[0]).setSessionPermissionLevel(...args);
  }
  setSessionModel(
    ...args: Parameters<IAgentAdapter['setSessionModel']>
  ): Promise<void> {
    return this.adapter(args[0]).setSessionModel(...args);
  }
  setSessionEffort(
    ...args: Parameters<IAgentAdapter['setSessionEffort']>
  ): Promise<void> {
    return this.adapter(args[0]).setSessionEffort(...args);
  }
  setSessionIdResolvedCallback(
    ...args: Parameters<IAgentAdapter['setSessionIdResolvedCallback']>
  ): void {
    this.legacy.setSessionIdResolvedCallback(...args);
    this.native.setSessionIdResolvedCallback(...args);
  }
  setResultStatsCallback(
    ...args: Parameters<IAgentAdapter['setResultStatsCallback']>
  ): void {
    this.legacy.setResultStatsCallback(...args);
    this.native.setResultStatsCallback(...args);
  }
  setCompactionStartCallback(
    ...args: Parameters<IAgentAdapter['setCompactionStartCallback']>
  ): void {
    this.legacy.setCompactionStartCallback(...args);
  }
  // Legacy-only event shapes have no native source. Native file/image/usage
  // observations are delivered by CodexChatAdapterPorts.callbacks instead.
  setLiveStatsCallback(
    ...args: Parameters<IAgentAdapter['setLiveStatsCallback']>
  ): void {
    this.legacy.setLiveStatsCallback(...args);
  }
  setWorktreeCreatedCallback(
    ...args: Parameters<IAgentAdapter['setWorktreeCreatedCallback']>
  ): void {
    this.legacy.setWorktreeCreatedCallback(...args);
  }
  setWorktreeRemovedCallback(
    ...args: Parameters<IAgentAdapter['setWorktreeRemovedCallback']>
  ): void {
    this.legacy.setWorktreeRemovedCallback(...args);
  }

  private adapter(id: SessionId): IAgentAdapter {
    const binding = this.identities.lookup(id);
    if (!binding) throw new SessionRuntimeRoutingError('unknown-session', id);
    const identity = binding.persisted ?? binding.live;
    if (!identity) throw new SessionRuntimeRoutingError('missing-identity', id);
    for (const candidate of [binding.live, binding.persisted]) {
      if (candidate && candidate.sessionId !== id)
        throw new SessionRuntimeRoutingError(
          'identity-mismatch',
          id,
          'sessionId',
        );
    }
    if (binding.live && binding.persisted) {
      const field = sessionRuntimeIdentityMismatch(
        binding.live,
        binding.persisted,
      );
      if (field)
        throw new SessionRuntimeRoutingError('identity-mismatch', id, field);
    }
    return identity.runtime === 'codex-app-server' ? this.native : this.legacy;
  }
}
