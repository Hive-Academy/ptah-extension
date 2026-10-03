/**
 * Opt-in `bootSettings` override (Batch 36d.b): the Cursor key store as the host has it.
 *
 * In the shared fixture, `agent:setConfig` copies `{ cursorApiKey }` onto the config without touching
 * `cursorApiKeyStored`. Every Cursor Save therefore reads back as "not saved", and "Remove stored key" never shows.
 * With this override, a `cursorApiKey` write sets the stored flags, and Cursor's detection follows the key: Cursor runs
 * through the bundled SDK and is detected once a key resolves (`cursor-cli.adapter.ts:208-223`). So a saved key moves
 * the Cursor row to the installed group, and a removed key moves it back to Uninstalled.
 * `failCursorSave` answers the write with `success: false` (the host refused it), which drives the failed-save scene.
 * Every other `agent:setConfig` field behaves as in the shared fixture.
 */
import type { Page } from '@playwright/test';
import { getFixtureState } from './settings.fixtures';

export function cursorKeyStoreOverrides(page: Page, options: { readonly failCursorSave?: boolean } = {}): Record<string, unknown> {
  return {
    'agent:setConfig': (params: unknown) => {
      const state = getFixtureState(page);
      state.calls.push({ method: 'agent:setConfig', params });
      const { cursorApiKey, ...rest } = params as Record<string, unknown>;
      Object.assign(state.agentConfig, rest);
      if (typeof cursorApiKey === 'string') {
        if (options.failCursorSave) return { success: false };
        const stored = cursorApiKey.trim() !== '';
        state.agentConfig.cursorApiKeyStored = stored;
        state.agentConfig.cursorApiKeyConfigured = stored || state.agentConfig.cursorApiKeyEnvSet;
        const cursor = state.agentConfig.detectedClis.find((cli) => cli.cli === 'cursor') as Record<string, unknown> | undefined;
        if (cursor) {
          cursor['installed'] = state.agentConfig.cursorApiKeyConfigured;
          cursor['version'] = state.agentConfig.cursorApiKeyConfigured ? 'sdk' : undefined;
        }
      }
      return { success: true };
    },
  };
}
