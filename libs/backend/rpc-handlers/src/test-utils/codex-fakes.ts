import type { ICodexLoginService, ICodexReadinessReader } from '@ptah-extension/auth-providers';
import type { AuthGetCodexReadinessResponse, CodexLoginState } from '@ptah-extension/shared';

export interface FakeCodexLogin extends ICodexLoginService {
  start: jest.Mock<Promise<CodexLoginState>, [
    { mode?: 'browser' | 'device'; restart?: boolean },
    (state: CodexLoginState) => void,
  ]>;
  cancel: jest.Mock<boolean, []>;
  emit(state: CodexLoginState): void;
}

export function createFakeCodexLogin(initial: CodexLoginState = {
  attemptId: 'fake-1', mode: 'browser', status: 'running',
}): FakeCodexLogin {
  let listener: ((state: CodexLoginState) => void) | undefined;
  return {
    start: jest.fn<Promise<CodexLoginState>, [
      { mode?: 'browser' | 'device'; restart?: boolean }, (state: CodexLoginState) => void,
    ]>(async (_options, onState) => { listener = onState; onState(initial); return initial; }),
    cancel: jest.fn<boolean, []>(() => false),
    isActive: jest.fn<boolean, []>(() => false),
    dispose: jest.fn<Promise<void>, []>(async () => undefined),
    emit(state): void { listener?.(state); },
  };
}

export function createFakeCodexReadiness(result: AuthGetCodexReadinessResponse = {
  binary: { state: 'unknown', reason: 'local' },
  signIn: { outcome: 'unreadable' },
  checkedAt: '2026-01-01T00:00:00.000Z',
}): jest.Mocked<ICodexReadinessReader> {
  return { read: jest.fn<Promise<AuthGetCodexReadinessResponse>, [Parameters<ICodexReadinessReader['read']>[0]]>(async () => result) };
}
