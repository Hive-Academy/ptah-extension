import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  DEFAULT_SESSION_CHILD_BASH_ALLOWLIST,
  readSessionChildSettings,
} from './session-child-settings';

type Config = Record<string, unknown>;

function workspaceWith(
  config: Config,
): Pick<IWorkspaceProvider, 'getConfiguration'> {
  return {
    getConfiguration: <T>(section: string, key: string, fallback?: T) => {
      expect(section).toBe('ptah');
      return (key in config ? config[key] : fallback) as T | undefined;
    },
  };
}

describe('readSessionChildSettings', () => {
  it('returns the documented defaults when nothing is configured', () => {
    expect(readSessionChildSettings(workspaceWith({}))).toEqual({
      maxConcurrent: 3,
      maxRuntimeMinutes: 120,
      permissionDenyWindowMs: 60_000,
      bashAllowlist: DEFAULT_SESSION_CHILD_BASH_ALLOWLIST,
    });
  });

  it('has no network client in the default allowlist', () => {
    for (const entry of DEFAULT_SESSION_CHILD_BASH_ALLOWLIST) {
      expect(entry).not.toMatch(/curl|wget|ssh|nc\b|git push|git fetch/);
    }
  });

  describe.each([
    // key, value, expected
    ['agentSessions.maxConcurrent', 'maxConcurrent', 0, 1],
    ['agentSessions.maxConcurrent', 'maxConcurrent', 1, 1],
    ['agentSessions.maxConcurrent', 'maxConcurrent', 4, 4],
    ['agentSessions.maxConcurrent', 'maxConcurrent', 5, 5],
    ['agentSessions.maxConcurrent', 'maxConcurrent', 99, 5],
    ['agentSessions.maxConcurrent', 'maxConcurrent', 2.9, 2],
    ['agentSessions.maxConcurrent', 'maxConcurrent', Number.NaN, 3],
    ['agentSessions.maxConcurrent', 'maxConcurrent', '4', 3],
    ['agentSessions.maxConcurrent', 'maxConcurrent', null, 3],
    ['agentSessions.maxRuntimeMinutes', 'maxRuntimeMinutes', 1, 5],
    ['agentSessions.maxRuntimeMinutes', 'maxRuntimeMinutes', 60, 60],
    ['agentSessions.maxRuntimeMinutes', 'maxRuntimeMinutes', 10_000, 720],
    [
      'agentSessions.maxRuntimeMinutes',
      'maxRuntimeMinutes',
      Number.POSITIVE_INFINITY,
      120,
    ],
    ['agentSessions.permissionDenyWindowMs', 'permissionDenyWindowMs', -5, 0],
    ['agentSessions.permissionDenyWindowMs', 'permissionDenyWindowMs', 0, 0],
    [
      'agentSessions.permissionDenyWindowMs',
      'permissionDenyWindowMs',
      30_000,
      30_000,
    ],
    [
      'agentSessions.permissionDenyWindowMs',
      'permissionDenyWindowMs',
      900_000,
      600_000,
    ],
    [
      'agentSessions.permissionDenyWindowMs',
      'permissionDenyWindowMs',
      true,
      60_000,
    ],
  ] as const)('%s = %p', (key, field, value, expected) => {
    it(`reads ${String(expected)}`, () => {
      const settings = readSessionChildSettings(
        workspaceWith({ [key]: value }),
      );
      expect(settings[field]).toBe(expected);
    });
  });

  describe('bashAllowlist', () => {
    it('trims entries and drops blank ones', () => {
      const settings = readSessionChildSettings(
        workspaceWith({
          'agentSessions.bashAllowlist': [
            '  git status ',
            '',
            '   ',
            'pnpm test',
          ],
        }),
      );
      expect(settings.bashAllowlist).toEqual(['git status', 'pnpm test']);
    });

    it('honours an explicit empty list', () => {
      const settings = readSessionChildSettings(
        workspaceWith({ 'agentSessions.bashAllowlist': [] }),
      );
      expect(settings.bashAllowlist).toEqual([]);
    });

    it.each([
      ['a string', 'git status'],
      ['an object', { 0: 'git status' }],
      ['a mixed array', ['git status', 42]],
      ['null', null],
    ])('falls back to the default for %s', (_label, value) => {
      const settings = readSessionChildSettings(
        workspaceWith({ 'agentSessions.bashAllowlist': value }),
      );
      expect(settings.bashAllowlist).toBe(DEFAULT_SESSION_CHILD_BASH_ALLOWLIST);
    });
  });
});
