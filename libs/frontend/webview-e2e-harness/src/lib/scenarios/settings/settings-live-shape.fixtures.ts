/**
 * Opt-in `bootSettings` override (TASK_2026_555 Batch 52.4): live-shaped values from a real profile, as seen in the
 * Batch 37 Electron docs shots. The shared fixture's tidy values ("1.4.0", "claude-sonnet-4-6", one override) never
 * showed the defects 52.1-52.3.
 * - Detected versions are raw `--version` lines: "codex-cli 0.155.1", "GitHub Copilot CLI 1.0.83.", "opencode v2.0.12",
 *   and Antigravity's bare "1.2.14".
 * - The Antigravity model is a value saved by the earlier `agy models` parse: "claude-sonnet-4-6<TAB>Claude Sonnet 4.6
 *   (Thinking)".
 * - The Main Agent has three non-inherited layers: effort in the App layer, authentication and provider in the
 *   workspace. A cleared override (`config:clearScopeOverride`) reads back as inherited.
 * Writes still go through the shared fixture state.
 */
import type { Page } from '@playwright/test';
import { getFixtureState } from './settings.fixtures';

export const LIVE_VERSIONS: Readonly<Record<string, string>> = {
  codex: 'codex-cli 0.155.1',
  copilot: 'GitHub Copilot CLI 1.0.83.',
  opencode: 'opencode v2.0.12',
  antigravity: '1.2.14',
};
export const LIVE_ANTIGRAVITY_MODEL = 'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)';
/** The Main Agent's overridden layers, by key test. */
const LIVE_LAYERS: readonly { readonly test: (key: string) => boolean; readonly scope: 'app' | 'workspace' }[] = [
  { test: (key) => key.endsWith('.reasoningEffort'), scope: 'app' },
  { test: (key) => key === 'authMethod', scope: 'workspace' },
  { test: (key) => key === 'anthropicProviderId', scope: 'workspace' },
];

export function liveShapeOverrides(page: Page): Record<string, unknown> {
  let applied = false;
  /** Once per boot, on the first config read: later writes then read back as usual. */
  const applyLiveConfig = (): void => {
    if (applied) return;
    applied = true;
    const config = getFixtureState(page).agentConfig;
    for (const detected of config.detectedClis as Array<Record<string, unknown>>) {
      const version = LIVE_VERSIONS[detected['cli'] as string];
      if (version && detected['installed']) detected['version'] = version;
    }
    config.antigravityModel = LIVE_ANTIGRAVITY_MODEL;
  };
  return {
    'agent:getConfig': () => {
      applyLiveConfig();
      return { ...getFixtureState(page).agentConfig };
    },
    'agent:detectClis': () => {
      applyLiveConfig();
      return { clis: getFixtureState(page).agentConfig.detectedClis };
    },
    'config:getScopes': (params: unknown) => {
      const cleared = getFixtureState(page).clearedOverrides;
      const keys = (params as { keys?: readonly string[] } | null)?.keys ?? [];
      return {
        activePath: 'C:\\ptah-e2e-ws-a',
        entries: keys.map((key) => {
          const layer = LIVE_LAYERS.find((entry) => entry.test(key));
          const hasOverride = !!layer && !cleared.has(key);
          return {
            key, effectiveKey: key, hasOverride,
            scope: hasOverride && layer ? layer.scope : 'global',
            supportedTargets: ['global', 'app', 'workspace'],
            fallbackPreview: hasOverride ? { scope: 'global', value: null } : null,
            credentialSource: 'not-a-secret',
          };
        }),
      };
    },
  };
}
