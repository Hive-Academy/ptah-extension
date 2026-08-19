import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { ProviderHealth, ProviderStatus } from '@ptah-extension/shared';

const INITIAL_HEALTH: ProviderHealth = {
  status: 'initializing' as ProviderStatus,
  lastCheck: 0,
};

@injectable()
export class SdkRuntimeStateService {
  private _cliJsPath: string | null = null;
  private _health: ProviderHealth = INITIAL_HEALTH;
  private _initialized = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  setCliJsPath(cliJsPath: string | null): void {
    this._cliJsPath = cliJsPath;
  }

  getCliJsPath(): string | null {
    return this._cliJsPath;
  }

  setHealth(health: ProviderHealth): void {
    this._health = health;
    this._initialized = true;
  }

  getHealth(): ProviderHealth {
    return { ...this._health };
  }

  /**
   * Whether `SdkAgentAdapter.initialize()` ever published a verdict in this
   * process.
   *
   * Deliberately NOT `getHealth().status === 'available'`. The two answer
   * different questions and only this one is unambiguous:
   *
   *  - `false` means the SDK was never initialized AT ALL. That is a permanent
   *    property of the host, not a phase of its startup: every CLI command that
   *    boots `withEngine({ requireSdk: false })` — `doctor`, the auth/config
   *    bootstrap verbs, `skill-synthesis` — stays here for its whole life by
   *    design, because those verbs must work before any credentials exist.
   *  - `true` covers BOTH `'available'` and `'error'`. An SDK that initialized
   *    and failed is a host that HAS an LLM and cannot reach it right now, which
   *    is a retryable transport condition; collapsing it into "no LLM here"
   *    would make a caller drop work a later retry could have completed.
   *
   * `setHealth` is called from exactly one place — the three terminal branches
   * of `initialize()` — so the flag cannot drift from the thing it reports.
   */
  hasInitialized(): boolean {
    return this._initialized;
  }

  reset(): void {
    this._cliJsPath = null;
    this._health = INITIAL_HEALTH;
    this._initialized = false;
  }
}
