import type { SettingScope } from '@ptah-extension/shared';
import type { ProvidersSettingsStateService } from './providers-settings-state.service';

/** The popover's offered targets are the intersection of model and effort write scopes. */
export function defaultMainConnectionTarget(
  state: Pick<ProvidersSettingsStateService, 'mainSources' | 'writeScopes'>,
  chosen?: SettingScope | null,
): SettingScope | null {
  const sources = state.mainSources();
  if (sources.status !== 'ready' || !sources.data?.model || !sources.data.effort) return null;
  const effort = state.writeScopes(sources.data.effort.key);
  const targets = state.writeScopes(sources.data.model.key).filter((target) => effort.includes(target));
  if (chosen && targets.includes(chosen)) return chosen;
  if (targets.includes('workspace')) return 'workspace';
  const source = sources.data.model.scope;
  return source && targets.includes(source) ? source : targets[0] ?? null;
}

export function mainConnectionTargetWritable(
  state: Pick<ProvidersSettingsStateService, 'writeScopes'>,
  target: SettingScope | null,
): boolean {
  return target !== null && state.writeScopes('authMethod').includes(target);
}

export function sessionsEndedCopy(target: SettingScope): string {
  return target === 'workspace' ? 'in this workspace' : 'in every workspace';
}
