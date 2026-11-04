import type { SettingScope } from '@ptah-extension/shared';
import {
  defaultMainConnectionTarget,
  mainConnectionTargetWritable,
  sessionsEndedCopy,
} from './main-connection-target';
import type { ProvidersSettingsStateService } from './providers-settings-state.service';

function state(
  status: 'ready' | 'loading',
  scopes: Record<string, readonly SettingScope[]>,
  source: SettingScope = 'global',
): Pick<ProvidersSettingsStateService, 'mainSources' | 'writeScopes'> {
  return {
    mainSources: () => ({
      status,
      data: {
        model: { key: 'model', scope: source },
        effort: { key: 'effort', scope: source },
      },
    }),
    writeScopes: (key: string) => scopes[key] ?? [],
  } as unknown as Pick<ProvidersSettingsStateService, 'mainSources' | 'writeScopes'>;
}

describe('main connection target', () => {
  const scopes = {
    model: ['global', 'workspace'] as SettingScope[],
    effort: ['workspace', 'global'] as SettingScope[],
    authMethod: ['workspace'] as SettingScope[],
  };

  it('keeps an offered choice, then defaults to workspace', () => {
    const current = state('ready', scopes);
    expect(defaultMainConnectionTarget(current, 'global')).toBe('global');
    expect(defaultMainConnectionTarget(current, 'app')).toBe('workspace');
    expect(defaultMainConnectionTarget(current)).toBe('workspace');
  });

  it('falls back to the model source or first offered target', () => {
    expect(defaultMainConnectionTarget(state('ready', {
      model: ['app', 'global'], effort: ['global', 'app'],
    }, 'global'))).toBe('global');
    expect(defaultMainConnectionTarget(state('ready', {
      model: ['app'], effort: ['app'],
    }, 'global'))).toBe('app');
  });

  it('never returns an unoffered target while loading or with no intersection', () => {
    expect(defaultMainConnectionTarget(state('loading', scopes))).toBeNull();
    expect(defaultMainConnectionTarget(state('ready', {
      model: ['app'], effort: ['global'],
    }))).toBeNull();
  });

  it('uses authMethod write scopes for provider changes', () => {
    const current = state('ready', scopes);
    expect(mainConnectionTargetWritable(current, 'workspace')).toBe(true);
    expect(mainConnectionTargetWritable(current, 'global')).toBe(false);
    expect(mainConnectionTargetWritable(current, null)).toBe(false);
  });

  it('uses scope-specific session-ending copy', () => {
    expect(sessionsEndedCopy('workspace')).toBe('in this workspace');
    expect(sessionsEndedCopy('global')).toBe('in every workspace');
    expect(sessionsEndedCopy('app')).toBe('in every workspace');
  });
});
