/**
 * Kimi Code provider types: the credential service contract shared by the
 * proxy, the auth strategy, the lane resolver, the proxy pool and the RPC
 * layer, and the in-app sign-in contract.
 */
import type {
  KimiCodeCredentialSource,
  KimiCodeLoginState,
} from '@ptah-extension/shared';

/** Registry id of the Kimi Code provider. */
export const KIMI_CODE_PROVIDER_ID = 'kimi-code';

/** Disk-only status of the Kimi Code credentials. Carries no secret. */
export interface KimiCodeAuthStatus {
  /** `~/.kimi-code` exists. */
  readonly cliDetected: boolean;
  /** A CLI login is present and not known to be dead. */
  readonly loggedIn: boolean;
  /** The CLI login's refresh was rejected; `kimi login` is needed again. */
  readonly stale: boolean;
  /** A Kimi Code API key is stored. */
  readonly hasApiKey: boolean;
  /** Which credential serves the next request. */
  readonly credentialSource: KimiCodeCredentialSource;
}

/** The credential for one upstream request. Never logged or returned by RPC. */
export type KimiCodeRequestCredential =
  | { readonly kind: 'oauth'; readonly accessToken: string }
  | { readonly kind: 'apiKey'; readonly apiKey: string };

export type KimiCodeUnavailableReason = 'signed-out' | 'stale';

/** The fixed, display-safe sign-in copy for a Kimi Code without credentials. */
export function kimiCodeUnavailableMessage(
  reason: KimiCodeUnavailableReason,
): string {
  return reason === 'stale'
    ? 'The Kimi Code CLI login has expired. Run `kimi login` again, or add a Kimi Code API key in Settings.'
    : 'Kimi Code is not signed in. Run `kimi login`, or add a Kimi Code API key in Settings.';
}

/** No CLI login and no stored key. The message is fixed, display-safe copy. */
export class KimiCodeAuthUnavailableError extends Error {
  constructor(readonly reason: KimiCodeUnavailableReason) {
    super(kimiCodeUnavailableMessage(reason));
    this.name = 'KimiCodeAuthUnavailableError';
  }
}

export interface IKimiCodeAuthService {
  /** Status from disk and the key store; no network I/O. */
  getStatus(): Promise<KimiCodeAuthStatus>;
  /**
   * The credential for the next request: a fresh CLI access token, else the
   * stored key.
   * @throws KimiCodeAuthUnavailableError when neither is usable.
   */
  resolveRequestCredential(): Promise<KimiCodeRequestCredential>;
  /** Refresh the CLI login if it expires soon. True when it is usable now. */
  ensureFresh(): Promise<boolean>;
  /**
   * Upstream rejected the current access token: re-read the file and refresh
   * unless another process already did. True when a different usable token
   * is now available.
   */
  forceRefresh(): Promise<boolean>;
  /** A CLI login or a stored key exists. */
  isAuthenticated(): Promise<boolean>;
  /** Drop cached disk reads. */
  clearCache(): void;
  /** Watch the CLI credentials for external changes. Idempotent. */
  startWatching(): void;
  /** Stop watching and clear the pending debounce. */
  stopWatching(): void;
}

/** In-app `kimi login` runner. One sign-in at a time per process. */
export interface IKimiCodeLoginService {
  /**
   * Start `kimi login` unless one is running. `onState` receives every state
   * change of the sign-in this call started; a call that joins a running
   * sign-in does not replace the original listener.
   * @returns the current state (running or terminal).
   */
  start(onState: (state: KimiCodeLoginState) => void): Promise<KimiCodeLoginState>;
  /** Stop the running sign-in. False when none was running. */
  cancel(): boolean;
  /** Stop any running sign-in; for host shutdown. */
  dispose(): void;
}
