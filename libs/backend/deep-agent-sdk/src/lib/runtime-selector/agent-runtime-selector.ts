/**
 * AgentRuntimeSelector — Implements IAgentAdapter by forwarding every
 * method call to either SdkAgentAdapter or DeepAgentAdapter, based on
 * the `ptah.runtime` configuration value and (in auto mode) CLI
 * availability.
 *
 * Phase 1 policy:
 *   - "claude-sdk"  → SDK always
 *   - "deep-agent"  → Deep always (will throw PHASE_2_MSG on session start
 *                      until streaming lands)
 *   - "auto"        → SDK (Phase 1 default — deep is not yet safe to
 *                      route to). Phase 2 flips this to the documented
 *                      Claude-vs-other heuristic.
 *
 * Event-sink callbacks are forwarded to BOTH inner adapters at
 * registration time so the dispatcher doesn't need to re-register
 * when runtime swaps.
 */

import { injectable, inject } from 'tsyringe';
import type {
  IAgentAdapter,
  AgentModelInfo,
  AgentPermissionLevel,
  AgentSessionStartConfig,
  AgentSessionResumeConfig,
  SlashCommandRunConfig,
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
  FlatStreamEventUnion,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  SessionId,
  AIMessageOptions,
} from '@ptah-extension/shared';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { DEEP_AGENT_TOKENS } from '../di/tokens';

export type RuntimeChoice = 'claude-sdk' | 'deep-agent';
export type RuntimeConfigValue = 'auto' | 'claude-sdk' | 'deep-agent';

@injectable()
export class AgentRuntimeSelector implements IAgentAdapter {
  readonly providerId: ProviderId;
  readonly info: ProviderInfo;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(DEEP_AGENT_TOKENS.DEEP_AGENT_ADAPTER)
    private readonly deepAdapter: IAgentAdapter,
  ) {
    // Expose the SDK adapter's identity by default — the deep adapter's
    // capabilities are a superset but we want existing provider wiring
    // (which reads providerId on init) to stay stable until Phase 2.
    this.providerId = this.sdkAdapter.providerId;
    this.info = this.sdkAdapter.info;
  }

  /** Read the user's runtime preference. */
  private readRuntimeConfig(): RuntimeConfigValue {
    const raw = this.config.get<string>('runtime');
    if (raw === 'claude-sdk' || raw === 'deep-agent' || raw === 'auto') {
      return raw;
    }
    return 'auto';
  }

  /**
   * Choose which runtime handles the current call.
   *
   *   claude-sdk  → always SDK
   *   deep-agent  → always Deep
   *   auto        → SDK if the active auth method is Claude-native
   *                 (apiKey / claudeCli / oauth), else Deep. This way
   *                 users on Ollama/LM Studio/OpenRouter get the Deep
   *                 runtime automatically, while Anthropic/Claude Code
   *                 users stay on the SDK.
   */
  private pickRuntime(): RuntimeChoice {
    const preference = this.readRuntimeConfig();
    if (preference === 'deep-agent') return 'deep-agent';
    if (preference === 'claude-sdk') return 'claude-sdk';
    // auto
    const authMethod = this.config.get<string>('authMethod') ?? 'apiKey';
    const isClaudeNative =
      authMethod === 'apiKey' ||
      authMethod === 'claudeCli' ||
      authMethod === 'oauth' ||
      authMethod === 'auto';
    return isClaudeNative ? 'claude-sdk' : 'deep-agent';
  }

  private active(): IAgentAdapter {
    return this.pickRuntime() === 'deep-agent'
      ? this.deepAdapter
      : this.sdkAdapter;
  }

  // -------- IAgentAdapter pass-throughs --------

  preloadSdk(): Promise<void> {
    // Preload BOTH — cheap, and avoids first-query latency whichever is picked.
    return Promise.all([
      this.sdkAdapter.preloadSdk().catch((e) => {
        this.logger.warn(
          '[RuntimeSelector] sdkAdapter.preloadSdk failed',
          e instanceof Error ? e : new Error(String(e)),
        );
      }),
      this.deepAdapter.preloadSdk().catch((e) => {
        this.logger.warn(
          '[RuntimeSelector] deepAdapter.preloadSdk failed',
          e instanceof Error ? e : new Error(String(e)),
        );
      }),
    ]).then(() => undefined);
  }

  async initialize(): Promise<boolean> {
    // Initialize both so either can serve. SDK result is the authoritative
    // "is the extension usable?" boolean since it's the Phase 1 default.
    const [sdkOk, deepOk] = await Promise.all([
      this.sdkAdapter.initialize(),
      this.deepAdapter.initialize().catch((e) => {
        this.logger.warn(
          '[RuntimeSelector] deepAdapter.initialize failed',
          e instanceof Error ? e : new Error(String(e)),
        );
        return false;
      }),
    ]);
    this.logger.info('[RuntimeSelector] Initialized', { sdkOk, deepOk });
    return sdkOk;
  }

  dispose(): void {
    this.sdkAdapter.dispose();
    this.deepAdapter.dispose();
  }

  verifyInstallation(): Promise<boolean> {
    return this.active().verifyInstallation();
  }

  getHealth(): ProviderHealth {
    return this.active().getHealth();
  }

  getCliJsPath(): string | null {
    return this.sdkAdapter.getCliJsPath();
  }

  getSupportedModels(): Promise<readonly AgentModelInfo[]> {
    return this.active().getSupportedModels();
  }

  getDefaultModel(): Promise<string> {
    return this.active().getDefaultModel();
  }

  getApiModels(): Promise<readonly AgentModelInfo[]> {
    return this.active().getApiModels();
  }

  reset(): Promise<void> {
    return this.active().reset();
  }

  startChatSession(
    config: AgentSessionStartConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.active().startChatSession(config);
  }

  endSession(sessionId: SessionId): void {
    // Best-effort end on both — whichever one owns it will clean up.
    this.sdkAdapter.endSession(sessionId);
    this.deepAdapter.endSession(sessionId);
  }

  sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions,
  ): Promise<void> {
    return this.active().sendMessageToSession(sessionId, content, options);
  }

  resumeSession(
    sessionId: SessionId,
    config?: AgentSessionResumeConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.active().resumeSession(sessionId, config);
  }

  isSessionActive(sessionId: SessionId): boolean {
    return (
      this.sdkAdapter.isSessionActive(sessionId) ||
      this.deepAdapter.isSessionActive(sessionId)
    );
  }

  executeSlashCommand(
    sessionId: SessionId,
    command: string,
    config: SlashCommandRunConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.active().executeSlashCommand(sessionId, command, config);
  }

  interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    return this.active().interruptCurrentTurn(sessionId);
  }

  interruptSession(sessionId: SessionId): Promise<void> {
    return this.active().interruptSession(sessionId);
  }

  setSessionPermissionLevel(
    sessionId: SessionId,
    level: AgentPermissionLevel,
  ): Promise<void> {
    return this.active().setSessionPermissionLevel(sessionId, level);
  }

  setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    return this.active().setSessionModel(sessionId, model);
  }

  // Callback sinks — forward to BOTH so either runtime emits correctly.
  setSessionIdResolvedCallback(cb: SessionIdResolvedCallback): void {
    this.sdkAdapter.setSessionIdResolvedCallback(cb);
    this.deepAdapter.setSessionIdResolvedCallback(cb);
  }
  setResultStatsCallback(cb: ResultStatsCallback): void {
    this.sdkAdapter.setResultStatsCallback(cb);
    this.deepAdapter.setResultStatsCallback(cb);
  }
  setCompactionStartCallback(cb: CompactionStartCallback): void {
    this.sdkAdapter.setCompactionStartCallback(cb);
    this.deepAdapter.setCompactionStartCallback(cb);
  }
  setWorktreeCreatedCallback(cb: WorktreeCreatedCallback): void {
    this.sdkAdapter.setWorktreeCreatedCallback(cb);
    this.deepAdapter.setWorktreeCreatedCallback(cb);
  }
  setWorktreeRemovedCallback(cb: WorktreeRemovedCallback): void {
    this.sdkAdapter.setWorktreeRemovedCallback(cb);
    this.deepAdapter.setWorktreeRemovedCallback(cb);
  }
}
