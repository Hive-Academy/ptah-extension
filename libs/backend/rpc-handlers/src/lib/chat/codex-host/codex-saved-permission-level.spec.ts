import 'reflect-metadata';

import { resolveSavedCodexPermissionLevel } from './codex-saved-permission-level';
import { CodexSessionSettingsError } from './codex-session-settings-record';

const invalidSettings = (): never => {
  throw new CodexSessionSettingsError('invalid-settings');
};

function settingsRead(stored: Readonly<Record<string, unknown>>) {
  return jest.fn((key: string): unknown => stored[key]);
}

describe('resolveSavedCodexPermissionLevel', () => {
  it('returns ask when autopilot.enabled is false', () => {
    const read = settingsRead({
      'autopilot.enabled': false,
      'autopilot.permissionLevel': 'yolo',
    });
    expect(resolveSavedCodexPermissionLevel(read, invalidSettings)).toBe(
      'ask',
    );
  });

  it('returns ask when autopilot.enabled is absent', () => {
    const read = settingsRead({ 'autopilot.permissionLevel': 'plan' });
    expect(resolveSavedCodexPermissionLevel(read, invalidSettings)).toBe(
      'ask',
    );
  });

  it('returns ask when autopilot.enabled is the string true', () => {
    const read = settingsRead({
      'autopilot.enabled': 'true',
      'autopilot.permissionLevel': 'auto-edit',
    });
    expect(resolveSavedCodexPermissionLevel(read, invalidSettings)).toBe(
      'ask',
    );
  });

  it('returns ask, plan, auto-edit, and yolo when autopilot is enabled', () => {
    for (const level of ['ask', 'plan', 'auto-edit', 'yolo'] as const) {
      const read = settingsRead({
        'autopilot.enabled': true,
        'autopilot.permissionLevel': level,
      });
      expect(resolveSavedCodexPermissionLevel(read, invalidSettings)).toBe(
        level,
      );
    }
  });

  it('throws invalid-settings when autopilot is enabled and the level is missing', () => {
    const read = settingsRead({ 'autopilot.enabled': true });
    expect(() =>
      resolveSavedCodexPermissionLevel(read, invalidSettings),
    ).toThrow(CodexSessionSettingsError);
    expect(() =>
      resolveSavedCodexPermissionLevel(read, invalidSettings),
    ).toThrow(expect.objectContaining({ code: 'invalid-settings' }));
  });

  it('throws invalid-settings when autopilot is enabled and the level is full-auto', () => {
    const read = settingsRead({
      'autopilot.enabled': true,
      'autopilot.permissionLevel': 'full-auto',
    });
    expect(() =>
      resolveSavedCodexPermissionLevel(read, invalidSettings),
    ).toThrow(new CodexSessionSettingsError('invalid-settings'));
    expect(() =>
      resolveSavedCodexPermissionLevel(read, invalidSettings),
    ).toThrow(expect.objectContaining({ code: 'invalid-settings' }));
  });

  it('reads autopilot.enabled then autopilot.permissionLevel', () => {
    const cases = [
      { enabled: false, level: 'ask' },
      { enabled: undefined, level: 'ask' },
      { enabled: 'true', level: 'ask' },
      { enabled: true, level: 'yolo' },
    ] as const;
    for (const entry of cases) {
      const read = settingsRead({
        ...(entry.enabled === undefined
          ? {}
          : { 'autopilot.enabled': entry.enabled }),
        'autopilot.permissionLevel': 'yolo',
      });
      expect(resolveSavedCodexPermissionLevel(read, invalidSettings)).toBe(
        entry.level,
      );
      expect(read.mock.calls).toEqual([
        ['autopilot.enabled'],
        ['autopilot.permissionLevel'],
      ]);
    }
  });
});
