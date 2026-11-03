import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  CodexLoginService,
  CodexReadinessReader,
  type ICodexAuthService,
} from '@ptah-extension/auth-providers';
import {
  CODEX_MIN_SUPPORTED_VERSION,
  CODEX_RUNTIME_TOKENS,
  CodexExecutableUnavailableError,
  type CodexSelectionSnapshotPort,
} from '@ptah-extension/codex-runtime';
import { PLATFORM_TOKENS, type IProcessSpawner, type IUserInteraction } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

let created: CodexLoginService | undefined;

export const codexSignInQuitHandle: {
  isActive(): boolean;
  stop(): Promise<void>;
} = {
  isActive: () => created?.isActive() ?? false,
  stop: () => created?.dispose() ?? Promise.resolve(),
};

/** Electron owns the login process; selecting its executable happens only on use. */
export function registerElectronCodexReadinessAndLogin(
  container: DependencyContainer,
  logger: Logger,
): void {
  const selection = () => {
    if (!container.isRegistered(CODEX_RUNTIME_TOKENS.SelectionSnapshot, true)) {
      throw new CodexExecutableUnavailableError(CODEX_MIN_SUPPORTED_VERSION);
    }
    return container.resolve<CodexSelectionSnapshotPort>(
      CODEX_RUNTIME_TOKENS.SelectionSnapshot,
    ).selectForOpen();
  };

  container.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN, {
    useFactory: instanceCachingFactory((c) => {
      created = new CodexLoginService({
        selection,
        codexAuth: c.resolve<ICodexAuthService>(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH),
        spawner: c.resolve<IProcessSpawner>(SDK_TOKENS.SDK_PROCESS_SPAWNER),
        userInteraction: c.resolve<IUserInteraction>(PLATFORM_TOKENS.USER_INTERACTION),
        logger,
      });
      return created;
    }),
  });
  container.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS, {
    useFactory: instanceCachingFactory((c) => new CodexReadinessReader(
      selection,
      c.resolve<ICodexAuthService>(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH),
      logger,
    )),
  });
}
