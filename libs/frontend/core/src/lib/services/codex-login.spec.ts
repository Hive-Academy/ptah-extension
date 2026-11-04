import type { CodexLoginState } from '@ptah-extension/shared';
import { acceptsCodexLogin, parseCodexLoginState } from './codex-login';
import { codexTerminalLoginCommand } from './codex-commands';

const running: CodexLoginState = { attemptId: 'a', status: 'running', mode: 'browser' };

describe('Codex login boundary', () => {
  it('validates enums and HTTPS URL, and drops host error text', () => {
    expect(parseCodexLoginState({ ...running, verificationUrl: 'http://example.com', error: 'secret' }))
      .toEqual(running);
    expect(parseCodexLoginState({ ...running, verificationUrl: 'https://example.com', error: 'secret' }))
      .toEqual({ ...running, verificationUrl: 'https://example.com' });
    expect(parseCodexLoginState({ ...running, mode: 'other' })).toBeNull();
    expect(parseCodexLoginState({ ...running, status: 'other' })).toBeNull();
  });

  it('accepts only ordered states for the same attempt and keeps final states sticky', () => {
    expect(acceptsCodexLogin(running, { ...running, status: 'starting' })).toBe(false);
    expect(acceptsCodexLogin(running, { ...running, status: 'awaiting-user' })).toBe(true);
    expect(acceptsCodexLogin(running, { ...running, attemptId: 'b' })).toBe(false);
    expect(acceptsCodexLogin({ ...running, status: 'cancelled' }, running)).toBe(false);
  });

  it('quotes a bundled path for POSIX and omits unsupported command sentences', () => {
    expect(codexTerminalLoginCommand({ path: "/a b/cod'ex", source: 'bundled' }, 'linux'))
      .toBe("'/a b/cod'\\''ex' login");
    expect(codexTerminalLoginCommand({ path: 'C:\\codex.exe', source: 'bundled' }, 'win32')).toBeNull();
    expect(codexTerminalLoginCommand({ path: '/a"b', source: 'bundled' }, 'linux')).toBeNull();
    expect(codexTerminalLoginCommand({ path: '/usr/bin/codex', source: 'installed' }, 'linux')).toBe('codex login');
  });
});
