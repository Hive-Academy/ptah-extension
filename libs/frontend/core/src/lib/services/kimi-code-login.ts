import {
  KIMI_CODE_PROVIDER_ENTRY,
  type KimiCodeCredentialSource,
  type KimiCodeLoginErrorCode,
  type KimiCodeLoginState,
  type KimiCodeLoginStatus,
} from '@ptah-extension/shared';

/** The provider whose sign-in runs in the app (`auth:kimiCodeLogin`) instead of in a terminal. */
export const KIMI_CODE_ID = KIMI_CODE_PROVIDER_ENTRY.id;

const CREDENTIAL_SOURCES: readonly KimiCodeCredentialSource[] = [
  'cli-login',
  'api-key',
  'none',
];
const LOGIN_STATUSES: readonly KimiCodeLoginStatus[] = [
  'starting',
  'awaiting-browser',
  'succeeded',
  'failed',
  'cancelled',
];
const LOGIN_ERROR_CODES: readonly KimiCodeLoginErrorCode[] = [
  'not-installed',
  'spawn-failed',
  'exited',
  'timeout',
  'no-credentials',
];

/** Host data is not trusted to stay inside the type: anything unknown reads as `'none'`. */
export function kimiCredentialSource(value: unknown): KimiCodeCredentialSource {
  return CREDENTIAL_SOURCES.find((source) => source === value) ?? 'none';
}

/** `succeeded`, `failed` and `cancelled` end a sign-in. */
export function isFinalKimiLogin(state: KimiCodeLoginState | null): boolean {
  return (
    state?.status === 'succeeded' ||
    state?.status === 'failed' ||
    state?.status === 'cancelled'
  );
}

/** Order of the phases, so an older snapshot never replaces a newer one. */
export function kimiLoginRank(state: KimiCodeLoginState | null): number {
  if (!state) return -1;
  if (state.status === 'starting') return 0;
  if (state.status === 'awaiting-browser') return 1;
  return 2;
}

/**
 * Whether `next` may replace `current`, for pushes and start responses alike. A final phase is
 * sticky until an explicit new start resets it, so a delayed or repeated push never reopens or
 * re-finishes a sign-in; an older phase never replaces a newer one.
 */
export function acceptsKimiLogin(
  current: KimiCodeLoginState | null,
  next: KimiCodeLoginState,
): boolean {
  if (isFinalKimiLogin(current)) return false;
  return kimiLoginRank(next) >= kimiLoginRank(current);
}

const optionalString = (value: unknown) =>
  value === undefined || typeof value === 'string';

/**
 * Validates a pushed or returned sign-in snapshot before it reaches view state. A verification URL
 * that is not `https:` is dropped, so the UI never links to anything else. The host's `error` text
 * is validated but never kept: the UI shows only its own fixed copy, keyed by status and `errorCode`.
 */
export function parseKimiLoginState(value: unknown): KimiCodeLoginState | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const status = LOGIN_STATUSES.find((entry) => entry === raw['status']);
  if (
    !status ||
    !optionalString(raw['verificationUrl']) ||
    !optionalString(raw['userCode']) ||
    !optionalString(raw['error']) ||
    (raw['browserOpened'] !== undefined &&
      typeof raw['browserOpened'] !== 'boolean')
  )
    return null;
  const url = raw['verificationUrl'];
  const errorCode = LOGIN_ERROR_CODES.find((code) => code === raw['errorCode']);
  const state: {
    -readonly [K in keyof KimiCodeLoginState]: KimiCodeLoginState[K];
  } = { status };
  if (typeof url === 'string' && isHttpsUrl(url)) state.verificationUrl = url;
  if (typeof raw['userCode'] === 'string' && raw['userCode'])
    state.userCode = raw['userCode'];
  if (typeof raw['browserOpened'] === 'boolean')
    state.browserOpened = raw['browserOpened'];
  if (errorCode) state.errorCode = errorCode;
  return state;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    // degradation-audit: optional-capability - an unparseable URL is not
    // https, so it is never shown or opened.
    return false;
  }
}
