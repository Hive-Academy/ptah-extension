import { useCallback, useEffect, useState } from 'react';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AuthDeviceCodePayload,
  AuthLoginOutputPayload,
} from '@ptah-extension/shared';

import type { PushEventAdapter } from './use-push-events.js';

/**
 * Ring size for captured login output. Interactive device-auth CLIs print a
 * handful of lines; keeping the tail bounded stops a chatty command from
 * pushing the rest of the settings panel off the Ink frame.
 */
export const MAX_LOGIN_OUTPUT_LINES = 8;

export interface LoginProgress {
  /** Latest device code for `provider`, or null if none has arrived. */
  readonly deviceCode: AuthDeviceCodePayload | null;
  /** Tail of the login subprocess output for `provider`, oldest first. */
  readonly output: readonly string[];
  /** Drop everything — call before starting a fresh login attempt. */
  reset: () => void;
}

/**
 * Fold an `auth:deviceCode` event into the current state.
 *
 * Returns `prev` unchanged for events belonging to another provider. Fields
 * are merged rather than replaced because a CLI may print the verification URL
 * and the user code on separate lines, producing two events that each carry
 * only half the information.
 *
 * Pure and exported so the contract is unit-testable without a React renderer.
 */
export function mergeDeviceCode(
  prev: AuthDeviceCodePayload | null,
  event: AuthDeviceCodePayload | undefined,
  provider: string,
): AuthDeviceCodePayload | null {
  if (event?.provider !== provider) return prev;
  return {
    provider,
    userCode: event.userCode ?? prev?.userCode,
    verificationUri: event.verificationUri ?? prev?.verificationUri,
    expiresInSeconds: event.expiresInSeconds ?? prev?.expiresInSeconds,
  };
}

/**
 * Fold an `auth:loginOutput` event into the captured tail, dropping events for
 * other providers and capping the retained lines at
 * {@link MAX_LOGIN_OUTPUT_LINES}. Pure — see {@link mergeDeviceCode}.
 */
export function appendLoginOutput(
  prev: readonly string[],
  event: AuthLoginOutputPayload | undefined,
  provider: string,
): readonly string[] {
  if (event?.provider !== provider) return prev;
  return [...prev, event.line].slice(-MAX_LOGIN_OUTPUT_LINES);
}

/**
 * Subscribe to the backend's interactive-login push events for one provider.
 *
 * Both `auth:deviceCode` and `auth:loginOutput` are broadcast to every surface
 * and carry the provider id, so events for other providers are filtered out
 * here rather than at the emitter. Passing `provider: null` subscribes to
 * nothing, which is what a non-OAuth tile wants.
 *
 * Exists because the backend's only other way of surfacing a device code is
 * `IUserInteraction.showInformationMessage`, which the CLI implements as
 * `console.log` — and the TUI replaces `console.*` with a no-op sink to keep
 * the Ink frame intact. Without these events the code is simply invisible.
 */
export function useLoginProgress(
  pushAdapter: PushEventAdapter,
  provider: string | null,
): LoginProgress {
  const [deviceCode, setDeviceCode] = useState<AuthDeviceCodePayload | null>(
    null,
  );
  const [output, setOutput] = useState<readonly string[]>([]);

  const reset = useCallback((): void => {
    setDeviceCode(null);
    setOutput([]);
  }, []);

  useEffect(() => {
    if (provider === null) return;

    const handleDeviceCode = (payload: unknown): void => {
      setDeviceCode((prev) =>
        mergeDeviceCode(prev, payload as AuthDeviceCodePayload, provider),
      );
    };

    const handleOutput = (payload: unknown): void => {
      setOutput((prev) =>
        appendLoginOutput(prev, payload as AuthLoginOutputPayload, provider),
      );
    };

    pushAdapter.on(MESSAGE_TYPES.AUTH_DEVICE_CODE, handleDeviceCode);
    pushAdapter.on(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT, handleOutput);

    return () => {
      pushAdapter.off(MESSAGE_TYPES.AUTH_DEVICE_CODE, handleDeviceCode);
      pushAdapter.off(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT, handleOutput);
    };
  }, [pushAdapter, provider]);

  return { deviceCode, output, reset };
}
