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

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  setCliJsPath(cliJsPath: string | null): void {
    this._cliJsPath = cliJsPath;
  }

  getCliJsPath(): string | null {
    return this._cliJsPath;
  }

  setHealth(health: ProviderHealth): void {
    this._health = health;
  }

  getHealth(): ProviderHealth {
    return { ...this._health };
  }

  reset(): void {
    this._cliJsPath = null;
    this._health = INITIAL_HEALTH;
  }
}
