import { SessionId } from '@ptah-extension/shared';
import { createLegacyCodexSessionSettings } from './codex-legacy-session-settings';

jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>(
    '@ptah-extension/platform-core',
  ),
  resolveAuthProviderKey: jest.fn(() => 'openai-codex'),
}));

const sessionId = SessionId.from('550e8400-e29b-41d4-a716-446655440000');

function fixture() {
  const find = jest.fn();
  const lookup = jest.fn().mockReturnValue({ persisted: { workspaceId: '/work' } });
  const readForPath = jest.fn();
  const resolveActiveAuthForPath = jest.fn().mockReturnValue({
    authMethod: 'openai-codex', providerId: 'openai-codex',
  });
  const settings = createLegacyCodexSessionSettings({
    sessions: { find },
    identities: { lookup },
    scopeResolver: { readForPath },
    auth: { resolveActiveAuthForPath },
  });
  return { find, readForPath, settings, resolveActiveAuthForPath };
}

describe('legacy Codex session settings', () => {
  it('maps saved model, effort and enabled autopilot permission', () => {
    const { readForPath, settings, resolveActiveAuthForPath } = fixture();
    readForPath
      .mockReturnValueOnce('gpt-5')
      .mockReturnValueOnce('high')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce('auto-edit');
    expect(settings(sessionId)).toEqual({
      workspacePath: '/work', authKey: 'openai-codex', model: 'gpt-5',
      effort: 'high', permissionLevel: 'auto-edit',
    });
    expect(resolveActiveAuthForPath).toHaveBeenCalledWith('/work');
    expect(readForPath).toHaveBeenCalledWith('autopilot.permissionLevel', '/work', true);
  });

  it('maps empty saved effort to undefined and disabled autopilot to ask', () => {
    const { readForPath, settings } = fixture();
    readForPath.mockReturnValueOnce('gpt-5').mockReturnValueOnce('').mockReturnValueOnce(false);
    expect(settings(sessionId)).toMatchObject({ effort: undefined, permissionLevel: 'ask' });
  });

  it.each([
    { values: ['gpt-5', 'SECRET-effort'], message: 'Legacy session effort unavailable' },
    { values: ['gpt-5', 'low', true, 'SECRET-permission'], message: 'Legacy session permission unavailable' },
    { values: [{ secret: 'SECRET-model' }], message: 'Legacy session model unavailable' },
  ])('redacts invalid stored values: $message', ({ values, message }) => {
    const { readForPath, settings } = fixture();
    for (const value of values) readForPath.mockReturnValueOnce(value);
    let caught: unknown;
    try {
      settings(sessionId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toEqual(new Error(message));
    expect(String(caught)).not.toContain('SECRET');
    expect(caught).not.toHaveProperty('issues');
  });

  it('uses live session values without reading invalid saved fallbacks', () => {
    const { find, readForPath, settings } = fixture();
    find.mockReturnValue({
      config: { projectPath: '/live', effort: 'low' },
      currentModel: 'gpt-live', permissionLevel: 'plan',
    });
    readForPath.mockReturnValue('SECRET-invalid');
    expect(settings(sessionId)).toEqual({
      workspacePath: '/live', authKey: 'openai-codex', model: 'gpt-live',
      effort: 'low', permissionLevel: 'plan',
    });
    expect(readForPath).not.toHaveBeenCalled();
  });

  it('preserves an explicitly unset live effort', () => {
    const { find, readForPath, settings } = fixture();
    find.mockReturnValue({
      config: { projectPath: '/live' }, currentModel: 'gpt-live', permissionLevel: 'ask',
    });
    readForPath.mockReturnValue('high');
    expect(settings(sessionId).effort).toBeUndefined();
    expect(readForPath).not.toHaveBeenCalled();
  });
});
