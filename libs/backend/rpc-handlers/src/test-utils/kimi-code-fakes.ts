/**
 * Typed Kimi Code fakes for the auth RPC specs. Fake strings only; nothing
 * here reads `~/.kimi-code`.
 */
import type {
  IKimiCodeAuthService,
  IKimiCodeLoginService,
  KimiCodeAuthStatus,
} from '@ptah-extension/auth-providers';
import type { KimiCodeLoginState } from '@ptah-extension/shared';

export type FakeKimiCodeAuth = jest.Mocked<IKimiCodeAuthService>;

/** A credential service reporting `status` (default: no CLI, no key). */
export function createFakeKimiCodeAuth(
  status: Partial<KimiCodeAuthStatus> = {},
): FakeKimiCodeAuth {
  const full: KimiCodeAuthStatus = {
    cliDetected: false,
    loggedIn: false,
    stale: false,
    hasApiKey: false,
    credentialSource: 'none',
    ...status,
  };
  return {
    getStatus: jest.fn(async () => full),
    resolveRequestCredential: jest.fn(async () => ({
      kind: 'oauth' as const,
      accessToken: 'fake-access-token-1',
    })),
    ensureFresh: jest.fn(async () => full.loggedIn),
    forceRefresh: jest.fn(async () => false),
    isAuthenticated: jest.fn(async () => full.credentialSource !== 'none'),
    clearCache: jest.fn(),
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
  };
}

export interface FakeKimiCodeLogin extends IKimiCodeLoginService {
  readonly start: jest.Mock<
    Promise<KimiCodeLoginState>,
    [(state: KimiCodeLoginState) => void]
  >;
  readonly cancel: jest.Mock<boolean, []>;
  readonly dispose: jest.Mock<void, []>;
  /** The listener passed to the last `start` call. */
  emit(state: KimiCodeLoginState): void;
}

/** A sign-in runner whose `start` resolves to `initial`. */
export function createFakeKimiCodeLogin(
  initial: KimiCodeLoginState = { status: 'starting' },
): FakeKimiCodeLogin {
  let listener: ((state: KimiCodeLoginState) => void) | undefined;
  return {
    start: jest.fn(async (onState: (state: KimiCodeLoginState) => void) => {
      listener = onState;
      onState(initial);
      return initial;
    }),
    cancel: jest.fn(() => false),
    dispose: jest.fn(),
    emit(state: KimiCodeLoginState): void {
      listener?.(state);
    },
  };
}
