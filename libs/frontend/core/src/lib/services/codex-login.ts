import type { CodexLoginErrorCode, CodexLoginMode, CodexLoginState, CodexLoginStatus } from '@ptah-extension/shared';

const STATUSES: readonly CodexLoginStatus[] = ['starting', 'running', 'awaiting-user', 'succeeded', 'failed', 'cancelled'];
const MODES: readonly CodexLoginMode[] = ['browser', 'device'];
const ERRORS: readonly CodexLoginErrorCode[] = ['unavailable', 'spawn-failed', 'exited', 'timeout', 'no-credentials'];

export function isFinalCodexLogin(state: CodexLoginState | null): boolean {
  return state?.status === 'succeeded' || state?.status === 'failed' || state?.status === 'cancelled';
}

export function codexLoginRank(state: CodexLoginState | null): number {
  if (!state) return -1;
  if (state.status === 'starting') return 0;
  if (state.status === 'running') return 1;
  if (state.status === 'awaiting-user') return 2;
  return 3;
}

export function acceptsCodexLogin(current: CodexLoginState | null, next: CodexLoginState): boolean {
  if (current && current.attemptId !== next.attemptId) return false;
  if (isFinalCodexLogin(current)) return false;
  return codexLoginRank(next) >= codexLoginRank(current);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

/** Keep only validated, display-safe fields from the host snapshot. */
export function parseCodexLoginState(value: unknown): CodexLoginState | null {
  if (!isRecord(value)) return null;
  const attemptId = value['attemptId'];
  const status = STATUSES.find((entry) => entry === value['status']);
  const mode = MODES.find((entry) => entry === value['mode']);
  if (typeof attemptId !== 'string' || !attemptId || !status || !mode) return null;
  if (value['verificationUrl'] !== undefined && typeof value['verificationUrl'] !== 'string') return null;
  if (value['userCode'] !== undefined && typeof value['userCode'] !== 'string') return null;
  if (value['browserOpened'] !== undefined && typeof value['browserOpened'] !== 'boolean') return null;
  if (value['exitCode'] !== undefined && value['exitCode'] !== null && !Number.isInteger(value['exitCode'])) return null;
  const state: { -readonly [K in keyof CodexLoginState]: CodexLoginState[K] } = { attemptId, status, mode };
  const source = value['executableSource'];
  if (source === 'installed' || source === 'bundled') state.executableSource = source;
  const url = value['verificationUrl'];
  if (typeof url === 'string' && isHttpsUrl(url)) state.verificationUrl = url;
  if (typeof value['userCode'] === 'string' && value['userCode']) state.userCode = value['userCode'];
  if (typeof value['browserOpened'] === 'boolean') state.browserOpened = value['browserOpened'];
  const errorCode = ERRORS.find((entry) => entry === value['errorCode']);
  if (errorCode) state.errorCode = errorCode;
  if (value['exitCode'] === null || typeof value['exitCode'] === 'number') state.exitCode = value['exitCode'];
  return state;
}
