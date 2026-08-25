/**
 * `KNOWN_CONFIG_KEYS` — the enumerated config surface of a settings export.
 *
 * `SettingsExportService.collectConfigValues` (`../settings-export.service.ts:137-158`)
 * iterates this list and calls `getConfiguration('ptah', key)` with NO caller
 * default. `PtahFileSettingsManager.get` therefore falls through to the
 * registered `FILE_BASED_SETTINGS_DEFAULTS` entry
 * (`platform-core/src/file-settings-manager.ts:83-91`), so a key listed here
 * that carries a shipped default lands in EVERY export file — including one
 * taken from an install where the user never touched the setting.
 *
 * That is what made a dead key non-inert: membership of this list is not
 * passive documentation, it is a write into a user-facing artifact.
 */
import { KNOWN_CONFIG_KEYS } from './settings-export.types';

describe('KNOWN_CONFIG_KEYS', () => {
  describe('llm.vscode.model — removed dead key (TASK_2026_250 follow-up B)', () => {
    /**
     * The key selected a model for the VS Code Language Model API in
     * `vendor/family` form. Its only consumer, `VsCodeLmAdapter`, was deleted
     * in `096930b51`; the last reader anywhere in the product,
     * `skill-synthesis`'s `resolveJudgeModel`, was repointed in `8a578c124`.
     *
     * Removing it from this list is what stops the shipped
     * `'copilot/gpt-4o'` default being written into every export.
     */
    it('no longer enumerates the dead VS Code Language Model key', () => {
      expect(KNOWN_CONFIG_KEYS).not.toContain('llm.vscode.model');
    });

    /**
     * Scoped guard rather than an exact-list assertion: this list grows
     * legitimately and often (TASK_2026_160 added `piReasoningEffort`), so
     * pinning its full contents would be a maintenance tax that teaches
     * people to update the expectation without reading it. What must stay
     * true is narrower — no `ptah.llm.*` key survives except the live one.
     */
    it('keeps exactly one llm.* key, the live llm.defaultProvider', () => {
      const llmKeys = KNOWN_CONFIG_KEYS.filter((key) => key.startsWith('llm.'));
      expect(llmKeys).toEqual(['llm.defaultProvider']);
    });
  });

  describe('list hygiene', () => {
    it('contains no duplicate keys', () => {
      expect([...new Set(KNOWN_CONFIG_KEYS)]).toHaveLength(
        KNOWN_CONFIG_KEYS.length,
      );
    });

    /**
     * The auth pair that decides which provider's credentials and selected
     * model are read. Both must keep travelling with an export or a restored
     * machine silently answers to a different provider than the source did.
     */
    it('still carries the auth routing pair', () => {
      expect(KNOWN_CONFIG_KEYS).toContain('authMethod');
      expect(KNOWN_CONFIG_KEYS).toContain('anthropicProviderId');
    });
  });
});
