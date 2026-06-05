import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ITranslationProxy } from '../translation';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../providers/codex';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../providers/openrouter';
import { LOCAL_PROXY_TOKEN_PLACEHOLDER } from '../providers/local';

export interface CuratorProxyHandle {
  readonly url: string;
  readonly token: string;
}

interface CuratorProxyEntry {
  readonly proxy: ITranslationProxy;
  readonly token: string;
}

const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;

@injectable()
export class CuratorProxyManager {
  private readonly entries: ReadonlyMap<string, CuratorProxyEntry>;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResolvedProviderId: string | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_COPILOT_PROXY)
    copilotProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_CODEX_PROXY)
    codexProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_OPENROUTER_PROXY)
    openRouterProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_LM_STUDIO_PROXY)
    lmStudioProxy: ITranslationProxy,
    private readonly idleTtlMs: number = DEFAULT_IDLE_TTL_MS,
  ) {
    this.entries = new Map<string, CuratorProxyEntry>([
      [
        'github-copilot',
        { proxy: copilotProxy, token: COPILOT_PROXY_TOKEN_PLACEHOLDER },
      ],
      [
        'openai-codex',
        { proxy: codexProxy, token: CODEX_PROXY_TOKEN_PLACEHOLDER },
      ],
      [
        'openrouter',
        { proxy: openRouterProxy, token: OPENROUTER_PROXY_TOKEN_PLACEHOLDER },
      ],
      [
        'lm-studio',
        { proxy: lmStudioProxy, token: LOCAL_PROXY_TOKEN_PLACEHOLDER },
      ],
    ]);
  }

  isProxyProvider(providerId: string): boolean {
    return this.entries.has(providerId);
  }

  async ensureProxy(providerId: string): Promise<CuratorProxyHandle> {
    const entry = this.entries.get(providerId);
    if (!entry) {
      throw new Error(
        `[CuratorProxyManager] No curator proxy for provider: ${providerId}`,
      );
    }

    if (
      this.lastResolvedProviderId !== null &&
      this.lastResolvedProviderId !== providerId
    ) {
      await this.disposeProvider(this.lastResolvedProviderId);
    }
    this.lastResolvedProviderId = providerId;

    let url: string;
    if (entry.proxy.isRunning()) {
      const running = entry.proxy.getUrl();
      if (running) {
        url = running;
      } else {
        const started = await entry.proxy.start();
        url = started.url;
      }
    } else {
      const started = await entry.proxy.start();
      url = started.url;
      this.logger.info(
        `[CuratorProxyManager] Started curator proxy for ${providerId} at ${url}`,
      );
    }

    this.rearmIdleTimer();
    return { url, token: entry.token };
  }

  async disposeAll(): Promise<void> {
    this.clearIdleTimer();
    this.lastResolvedProviderId = null;
    for (const [providerId, entry] of this.entries) {
      await this.stopProxy(providerId, entry.proxy);
    }
  }

  private async disposeProvider(providerId: string): Promise<void> {
    const entry = this.entries.get(providerId);
    if (!entry) {
      return;
    }
    await this.stopProxy(providerId, entry.proxy);
  }

  private async stopProxy(
    providerId: string,
    proxy: ITranslationProxy,
  ): Promise<void> {
    if (!proxy.isRunning()) {
      return;
    }
    try {
      await proxy.stop();
      this.logger.info(
        `[CuratorProxyManager] Stopped curator proxy for ${providerId}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `[CuratorProxyManager] Failed to stop curator proxy for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private rearmIdleTimer(): void {
    this.clearIdleTimer();
    const timer = setTimeout(() => {
      void this.disposeAll();
    }, this.idleTtlMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.idleTimer = timer;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
