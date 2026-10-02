/**
 * Gate G entries for the Search & Voice tab (TASK_2026_555 Batch 49): one per capability of the pattern
 * map's preserve list (pattern-map-advanced-search-voice.md §4, rows V1-V29). Voice and go vet are
 * Electron-only (`search-voice-settings.component.ts`): in VS Code those entries assert that the section is
 * absent, which is the capability there. Every entry restores the fixture it changed.
 */
import { expect, type Page } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import { getFixtureState } from './settings.fixtures';
import { visibleEnabled } from './settings-drawer.reach';
import { INVALID_VOICE_KEY, HOST_DETAIL } from './settings-advanced-search-voice.fixtures';
import {
  asvState, chooseVoiceProvider, closeDrawers, dismissToast, expectSavedThenUndo, expectWrite, isElectron, openVoiceDrawer,
  remountTab, searchVoiceTab, withAsvChange,
} from './settings-advanced-search-voice.reach';

const before = (page: Page): number => getFixtureState(page).calls.length;
const ws = (page: Page, testId: string) => page.locator(`[data-testid="settings-web-search-${testId}"]`);
const provider = (page: Page, id: string) => page.locator(`[data-testid="settings-toggle-web-search-provider-${id}"]`);

/** Runs `body` on Electron; in VS Code asserts the Electron-only sections are not rendered at all. */
async function electronOnly(page: Page, body: () => Promise<void>): Promise<void> {
  await searchVoiceTab(page);
  if (!(await isElectron(page))) {
    await expect(page.locator('ptah-web-search-config')).toBeVisible();
    await expect(page.locator('ptah-voice-config')).toHaveCount(0);
    await expect(page.locator('ptah-go-vet-consent-config')).toHaveCount(0);
    return;
  }
  await body();
}

/** Like {@link electronOnly}, with drawer D-VOICE open on `direction`; the drawer is closed afterwards. */
const inVoiceDrawer = (page: Page, direction: 'stt' | 'tts', body: () => Promise<void>) => electronOnly(page, async () => {
  try {
    await openVoiceDrawer(page, direction);
    await body();
  } finally {
    await closeDrawers(page);
  }
});

const webSearch: readonly ReachabilityEntry[] = [
  { id: 'SV-1', capability: 'Web search: several providers on at once (save on selection, Undo); at least one stays on', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      await expect(page.locator('ptah-web-search-config')).toContainText('At least one provider must stay selected.');
      await expect(provider(page, 'tavily')).toBeChecked();
      const start = before(page);
      await provider(page, 'serper').click();
      await expectWrite(page, start, 'webSearch:setConfig', { providers: ['tavily', 'exa', 'serper'] });
      await expect(provider(page, 'serper')).toBeChecked();
      await expectSavedThenUndo(page, 'web search providers', 'webSearch:setConfig', { providers: ['tavily', 'exa'] });
      await expect(provider(page, 'serper')).not.toBeChecked();
    } },
  { id: 'SV-2', capability: 'Web search: key status per provider and the signup links', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      await expect(ws(page, 'key-status-tavily')).toContainText('Key set');
      await expect(ws(page, 'key-status-serper')).toContainText('No key');
      for (const id of ['tavily', 'serper', 'exa']) await expect(ws(page, `signup-${id}`)).toHaveAttribute('href', /^https:\/\//);
    } },
  { id: 'SV-3', capability: 'Web search: set a key in its popover (masked, show/hide), saved without being shown', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      await ws(page, 'key-btn-serper').click();
      const input = ws(page, 'key-input');
      await expect(input).toHaveAttribute('type', 'password');
      await input.fill('serper-e2e-key');
      await ws(page, 'key-visibility').click();
      await expect(input).toHaveAttribute('type', 'text');
      const start = before(page);
      await ws(page, 'key-save').click();
      await expectWrite(page, start, 'webSearch:setApiKey', { provider: 'serper', apiKey: 'serper-e2e-key' });
      await expect(ws(page, 'key-status-serper')).toContainText('Key set');
      await expect(page.locator('ptah-web-search-config')).not.toContainText('serper-e2e-key');
      await dismissToast(page, 'Saved Serper API key.');
    } },
  { id: 'SV-4', capability: 'Web search: clear a key behind an inline confirm (no Undo)', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      const clear = ws(page, 'clear-btn-serper');
      await clear.click();
      await expect(ws(page, 'clear-group-serper')).toBeVisible();
      await ws(page, 'clear-cancel-serper').click();
      await expect(ws(page, 'clear-group-serper')).toHaveCount(0);
      await expect(clear).toBeFocused();
      await clear.click();
      const start = before(page);
      await ws(page, 'clear-confirm-serper').click();
      await expectWrite(page, start, 'webSearch:deleteApiKey', { provider: 'serper' });
      await expect(ws(page, 'key-status-serper')).toContainText('No key');
      await expect(page.locator('[data-testid="settings-toast-message"]')).toHaveText('Saved removal of the Serper API key.');
      await expect(page.locator('[data-testid="settings-toast-undo"]')).toHaveCount(0);
      await dismissToast(page);
    } },
  { id: 'SV-5', capability: 'Web search: Test connection fills the per-provider status', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      const start = before(page);
      await ws(page, 'test').click();
      await expectWrite(page, start, 'webSearch:test', {});
      await expect(ws(page, 'status-tavily')).toContainText('Works');
    } },
  { id: 'SV-6', capability: 'Web search: max results slider (save on release, Undo)', status: 'restored',
    reach: async (page) => {
      await searchVoiceTab(page);
      const slider = ws(page, 'max-results');
      await expect(slider).toHaveValue('5');
      const start = before(page);
      await slider.fill('8');
      await expectWrite(page, start, 'webSearch:setConfig', { maxResults: 8 });
      await expectSavedThenUndo(page, 'web search max results', 'webSearch:setConfig', { maxResults: 5 });
      await expect(slider).toHaveValue('5');
    } },
];

const voice: readonly ReachabilityEntry[] = [
  { id: 'SV-7', capability: 'Voice and go vet render on Electron only (absent in VS Code)', status: 'restored',
    reach: (page) => electronOnly(page, async () => {
      await expect(page.locator('[data-testid="voice-engines-matrix"]')).toBeVisible();
      await expect(page.locator('[data-testid="go-vet-consent-card"]')).toBeVisible();
    }) },
  { id: 'SV-8', capability: 'Voice engines: status and model/voice per direction (Local base.en ready, ElevenLabs Sarah)', status: 'restored',
    reach: (page) => electronOnly(page, async () => {
      await expect(page.locator('[data-testid="voice-engine-model-stt"]')).toHaveText('base.en');
      await expect(page.locator('[data-testid="voice-engine-status-stt"]')).toContainText('Ready');
      await expect(page.locator('[data-testid="voice-engine-model-tts"]')).toHaveText('Sarah');
      await expect(page.locator('[data-testid="voice-engine-status-tts"]')).toContainText('Ready');
    }) },
  { id: 'SV-9', capability: 'Voice: an unavailable provider is disabled with its reason shown as text', status: 'restored',
    reach: (page) => electronOnly(page, () => withAsvChange(page, 'Search & Voice', (state) => {
      state.voice.unavailable = { elevenlabs: 'API key not configured' };
      return () => { state.voice.unavailable = {}; };
    }, async () => {
      await page.locator('[data-testid="voice-provider-btn-stt"]').click();
      await expect(page.locator('[data-testid="voice-provider-option-stt-elevenlabs"]')).toBeDisabled();
      await expect(page.locator('[data-testid="voice-provider-reason-stt-elevenlabs"]')).toHaveText('Unavailable: API key not configured');
      await page.keyboard.press('Escape');
    })) },
  { id: 'SV-10', capability: 'Voice: speech-to-text provider choice (save on selection, Undo); ElevenLabs STT model in the drawer', status: 'restored',
    reach: (page) => electronOnly(page, async () => {
      const start = before(page);
      await chooseVoiceProvider(page, 'stt', 'elevenlabs');
      await expectWrite(page, start, 'voice:setProviderConfig', { sttProvider: 'elevenlabs' });
      await expect(page.locator('[data-testid="voice-provider-btn-stt"]')).toContainText('ElevenLabs');
      await expectSavedThenUndo(page, 'speech-to-text provider', 'voice:setProviderConfig', { sttProvider: 'local' });
      await expect(page.locator('[data-testid="voice-provider-btn-stt"]')).toContainText('Local');
    }) },
  { id: 'SV-11', capability: 'Local STT: Whisper model (save on selection, Undo), download status', status: 'restored',
    reach: (page) => inVoiceDrawer(page, 'stt', async () => {
      await expect(page.locator('[data-testid="local-stt-download-status"]').first()).toContainText('Downloaded');
      const select = page.locator('[data-testid="local-stt-model-select"]');
      await expect(select).toHaveValue('base.en');
      const start = before(page);
      await select.selectOption('small.en');
      await expectWrite(page, start, 'voice:setConfig', { whisperModel: 'small.en', modelSource: 'curated' });
      await expectSavedThenUndo(page, 'speech-to-text model', 'voice:setConfig', { whisperModel: 'base.en' });
      await expect(select).toHaveValue('base.en');
    }) },
  { id: 'SV-12', capability: 'Local STT: Hugging Face / folder source with id validation; back to Curated', status: 'restored',
    reach: (page) => inVoiceDrawer(page, 'stt', async () => {
      await page.locator('[data-testid="local-stt-source-hf"]').click();
      const input = page.locator('[data-testid="local-stt-custom-input"]');
      await input.fill('not a repo id');
      await expect(page.locator('[data-testid="local-stt-custom-hint"]')).toBeVisible();
      await expect(page.locator('[data-testid="local-stt-custom-save"]')).toBeDisabled();
      await input.fill('openai/whisper-small');
      await expect(page.locator('[data-testid="local-stt-custom-save"]')).toBeEnabled();
      await page.locator('[data-testid="local-stt-source-curated"]').click();
      await expect(page.locator('[data-testid="local-stt-model-select"]')).toBeVisible();
    }) },
  { id: 'SV-13', capability: 'Local STT: download a model that is not downloaded yet', status: 'restored',
    reach: (page) => electronOnly(page, () => withAsvChange(page, 'Search & Voice', (state) => {
      state.voice.local.sttDownloaded = false;
      return () => { state.voice.local.sttDownloaded = true; };
    }, async () => {
      await expect(page.locator('[data-testid="voice-engine-status-stt"]')).toContainText('Not downloaded');
      try {
        await openVoiceDrawer(page, 'stt');
        const start = before(page);
        await page.locator('[data-testid="local-stt-download-btn"]').click();
        await expectWrite(page, start, 'voice:downloadModel', { model: 'base.en' });
      } finally {
        await closeDrawers(page);
      }
    })) },
  { id: 'SV-14', capability: 'Local TTS: Kokoro voice (save on selection, Undo), preview, custom source', status: 'restored',
    reach: (page) => electronOnly(page, async () => {
      let start = before(page);
      await chooseVoiceProvider(page, 'tts', 'local');
      await expectWrite(page, start, 'voice:setProviderConfig', { ttsProvider: 'local' });
      await dismissToast(page, 'Saved text-to-speech provider.');
      try {
        await openVoiceDrawer(page, 'tts');
        const select = page.locator('[data-testid="local-tts-voice-select"]');
        await expect(select).toHaveValue('af_heart');
        start = before(page);
        await select.selectOption('am_michael');
        await expectWrite(page, start, 'voice:setTtsConfig', { voice: 'am_michael' });
        await expectSavedThenUndo(page, 'text-to-speech voice', 'voice:setTtsConfig', { voice: 'af_heart' });
        start = before(page);
        await page.locator('[data-testid="local-tts-preview-btn"]').click();
        await expectWrite(page, start, 'voice:synthesize', { voice: 'af_heart' });
        await page.locator('[data-testid="local-tts-source-dir"]').click();
        await visibleEnabled(page.locator('[data-testid="local-tts-custom-input"]'));
        await page.locator('[data-testid="local-tts-source-curated"]').click();
      } finally {
        await closeDrawers(page);
        start = before(page);
        await chooseVoiceProvider(page, 'tts', 'elevenlabs');
        await expectWrite(page, start, 'voice:setProviderConfig', { ttsProvider: 'elevenlabs' });
        await dismissToast(page, 'Saved text-to-speech provider.');
      }
    }) },
  { id: 'SV-15', capability: 'ElevenLabs key: test first (fixed category sentence), Save only after a passing test; Clear asks first', status: 'restored',
    reach: (page) => inVoiceDrawer(page, 'tts', async () => {
      await expect(page.locator('[data-testid="elevenlabs-key-configured"]')).toBeVisible();
      const input = page.locator('[data-testid="elevenlabs-key-input"]');
      const save = page.locator('[data-testid="elevenlabs-key-save"]');
      await input.fill(INVALID_VOICE_KEY);
      await page.locator('[data-testid="elevenlabs-test-btn"]').click();
      await expect(page.locator('[data-testid="elevenlabs-test-result"]')).toHaveText('Authentication: ElevenLabs rejected the key.');
      await expect(page.locator('ptah-elevenlabs-panel')).not.toContainText(HOST_DETAIL);
      await expect(save).toBeDisabled();
      await input.fill('el-e2e-good-key');
      await page.locator('[data-testid="elevenlabs-test-btn"]').click();
      await expect(page.locator('[data-testid="elevenlabs-test-result"]')).toHaveText('Connection works.');
      const start = before(page);
      await save.click();
      await expectWrite(page, start, 'voice:setApiKey', { providerId: 'elevenlabs', apiKey: 'el-e2e-good-key' });
      await dismissToast(page, 'Saved ElevenLabs API key.');
      await page.locator('[data-testid="elevenlabs-key-clear"]').click();
      await expect(page.locator('[data-testid="elevenlabs-clear-group"]')).toBeVisible();
      await page.locator('[data-testid="elevenlabs-clear-cancel"]').click();
      await expect(page.locator('[data-testid="elevenlabs-clear-group"]')).toHaveCount(0);
    }) },
  { id: 'SV-16', capability: 'ElevenLabs: voice (save on selection, Undo), TTS model and output format', status: 'restored',
    reach: (page) => inVoiceDrawer(page, 'tts', async () => {
      await expect(page.locator('[data-testid="elevenlabs-tts-model-select"]')).toBeVisible();
      await expect(page.locator('[data-testid="elevenlabs-output-format-select"]')).toBeVisible();
      const select = page.locator('[data-testid="elevenlabs-voice-select"]');
      await expect(select).toHaveValue('EXAVITQu4vr4xnSDxMaL');
      const start = before(page);
      await select.selectOption('21m00Tcm4TlvDq8ikWAM');
      await expectWrite(page, start, 'voice:setProviderConfig', { elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM' } });
      await expectSavedThenUndo(page, 'ElevenLabs voice', 'voice:setProviderConfig', { elevenlabs: { voiceId: 'EXAVITQu4vr4xnSDxMaL' } });
    }) },
  { id: 'SV-17', capability: 'ElevenLabs: the voice list shows a fixed sentence on failure and loads on Retry', status: 'restored',
    // The TTS panel outlives a closed drawer (it only reloads its voices when it is created): remount the tab,
    // let the matrix make its own voice-name read, then queue the failure for the new panel's first read.
    reach: (page) => electronOnly(page, async () => {
      await remountTab(page, 'Search & Voice');
      await expect(page.locator('[data-testid="voice-engine-model-tts"]')).toHaveText('Sarah');
      asvState(page).failures.set('voice:listVoices', { ok: false, error: HOST_DETAIL });
      try {
        await openVoiceDrawer(page, 'tts');
        await expect(page.locator('[data-testid="elevenlabs-voices-error"]')).toContainText('Could not load your ElevenLabs voices.');
        await expect(page.locator('ptah-elevenlabs-panel')).not.toContainText(HOST_DETAIL);
        await page.locator('[data-testid="elevenlabs-voices-retry"]').click();
        await expect(page.locator('[data-testid="elevenlabs-voice-select"]')).toBeVisible();
      } finally {
        asvState(page).failures.delete('voice:listVoices');
        await closeDrawers(page);
      }
    }) },
];

const goVet: readonly ReachabilityEntry[] = [
  { id: 'SV-18', capability: 'go vet: workspace and binary readout; enabling names the root in a confirm; disabling saves', status: 'restored',
    reach: (page) => electronOnly(page, async () => {
      await expect(page.locator('[data-testid="go-vet-consent-root"]')).toContainText('ptah-e2e-ws-a');
      await expect(page.locator('[data-testid="go-vet-consent-binary"]')).toContainText('go.exe');
      const toggle = page.locator('[data-testid="go-vet-consent-toggle"]');
      await toggle.click();
      await expect(page.locator('[data-testid="go-vet-consent-confirm-root"]')).toContainText('ptah-e2e-ws-a');
      await page.locator('[data-testid="go-vet-consent-cancel"]').click();
      await expect(page.locator('[data-testid="go-vet-consent-confirm"]')).toHaveCount(0);
      await expect(toggle).toBeFocused();
      let start = before(page);
      await toggle.click();
      await page.locator('[data-testid="go-vet-consent-allow"]').click();
      await expectWrite(page, start, 'diagnostics:go-vet-consent-set', { enabled: true, confirmToken: 'e2e-token-1' });
      await expect(page.locator('[data-testid="go-vet-consent-state"]')).toContainText('On');
      start = before(page);
      await toggle.click();
      await expectWrite(page, start, 'diagnostics:go-vet-consent-set', { enabled: false });
      await expect(page.locator('[data-testid="go-vet-consent-state"]')).toContainText('Off');
    }) },
  { id: 'SV-19', capability: 'go vet: an out-of-date consent says why, in the card', status: 'restored',
    reach: (page) => electronOnly(page, () => withAsvChange(page, 'Search & Voice', (state) => {
      state.goVet = { state: 'stale', staleReason: 'go-changed' };
      return () => { state.goVet = { state: 'off' }; };
    }, async () => {
      await expect(page.locator('[data-testid="go-vet-consent-stale"]')).toContainText('the Go toolchain changed since consent was given');
      await expect(page.locator('[data-testid="go-vet-consent-state"]')).toContainText('Out of date');
    })) },
];

/** Every Search & Voice entry, in tab order. */
export const SEARCH_VOICE_ENTRIES: readonly ReachabilityEntry[] = [...webSearch, ...voice, ...goVet];
