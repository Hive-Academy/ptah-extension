/**
 * RPC fixtures for the Advanced and Search & Voice tabs (TASK_2026_555 Batch 49). Kept apart from
 * `settings.fixtures.ts` (at its size budget and edited by the other track): `bootSettings` merges them in
 * through {@link withAdvancedSearchVoice}.
 *
 * Every read answers from one mutable {@link AsvState}, and every write records its call in the boot's
 * `calls` list and updates that state, so a reach step can assert "the write went out" and "the next read
 * shows it". {@link AsvState.failures} makes the NEXT answer of a method a failure (an in-band
 * `{success:false}` / `{ok:false}` result, or a transport failure through `rpcError`), for the D15 scenes.
 *
 * Data: the reference set the team-leader used for the round-1 captures (enhanced prompt, four output styles,
 * Tavily + Exa web search, Local STT + ElevenLabs TTS, go vet off). Shapes follow
 * `libs/shared/src/lib/types/rpc.types.ts`, `rpc/rpc-output-style.types.ts` and `rpc/rpc-misc.types.ts`.
 */
import type { RecordedCall } from './settings.fixtures';

type Json = Record<string, unknown>;

/** A tiny silent WAV (header only) so the TTS preview has real audio bytes to decode. */
const SILENT_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** The ElevenLabs draft key the `voice:testConnection` fixture rejects (category `auth`). */
export const INVALID_VOICE_KEY = 'invalid-voice-key-e2e';

/** Raw host text every failure fixture carries: the UI must never show it (F1 / no host text). */
export const HOST_DETAIL = 'host detail';

const BUILTIN = { keepCodingInstructions: true, editable: false, deletable: false, immutableReason: 'Built-in styles cannot be edited' };

export const OUTPUT_STYLES = [
  { name: 'Explanatory', tier: 'builtin', description: 'Explains implementation choices as it works', ...BUILTIN },
  { name: 'Learning', tier: 'builtin', description: 'Pauses to let you write small pieces yourself', ...BUILTIN },
  { name: 'concise-reviewer', tier: 'user', description: 'Terse answers, review-first', keepCodingInstructions: true,
    editable: true, deletable: true, fileName: 'concise-reviewer.md', relativePath: '~/.claude/output-styles/concise-reviewer.md' },
  { name: 'team-house-style', tier: 'project', description: 'Team conventions for PR summaries', keepCodingInstructions: false,
    editable: true, deletable: true, fileName: 'team-house-style.md', relativePath: '.claude/output-styles/team-house-style.md' },
] as const;

const STYLE_BODY = 'Answer in at most three short paragraphs.\nLead with the risk, then the fix.\n';

const ELEVENLABS_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', category: 'premade' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', category: 'premade' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', category: 'premade' },
  { id: 'custom-clone-01', label: 'Team narrator', category: 'cloned' },
];
const LOCAL_VOICES = [
  { id: 'af_heart', label: 'Heart (US female)' },
  { id: 'am_michael', label: 'Michael (US male)' },
  { id: 'bf_emma', label: 'Emma (UK female)' },
];

export interface AsvState {
  prompt: { enabled: boolean; hasGeneratedPrompt: boolean };
  outputStyles: { active: { name: string | null; tier: string | null; missing: boolean }; invalid: Json[]; decision: Json };
  webSearch: { providers: string[]; maxResults: number; keys: Set<string> };
  voice: {
    stt: string; tts: string; unavailable: Record<string, string>;
    local: { whisperModel: string; modelSource: string; sttDownloaded: boolean; ttsDownloaded: boolean; ttsVoice: string };
    elevenlabs: { apiKeyConfigured: boolean; voiceId: string; ttsModelId: string; outputFormat: string; sttModelId: string };
  };
  goVet: { state: 'on' | 'off' | 'stale'; staleReason?: string };
  llm: { defaultProvider: string; defaultModel: string };
  license: Json;
  /** Next answer per method; consumed by the first call. */
  readonly failures: Map<string, unknown>;
}

export function createAsvState(): AsvState {
  return {
    prompt: { enabled: true, hasGeneratedPrompt: true },
    outputStyles: {
      active: { name: 'concise-reviewer', tier: 'user', missing: false },
      invalid: [],
      // 'flag', not 'inject': 'inject' shows the fallback-injection banner.
      decision: { path: 'flag', styleName: 'concise-reviewer' },
    },
    webSearch: { providers: ['tavily', 'exa'], maxResults: 5, keys: new Set(['tavily', 'exa']) },
    voice: {
      stt: 'local', tts: 'elevenlabs', unavailable: {},
      local: { whisperModel: 'base.en', modelSource: 'curated', sttDownloaded: true, ttsDownloaded: true, ttsVoice: 'af_heart' },
      elevenlabs: { apiKeyConfigured: true, voiceId: 'EXAVITQu4vr4xnSDxMaL', ttsModelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128', sttModelId: 'scribe_v1' },
    },
    goVet: { state: 'off' },
    llm: { defaultProvider: 'vscode-lm', defaultModel: 'copilot-gpt-4o' },
    license: { valid: true, tier: 'community', isPremium: false, isCommunity: true, daysRemaining: null },
    failures: new Map(),
  };
}

/** Writes and probes a D15 scene may fail. Reads stay plain answers. */
const FAILABLE = new Set([
  'config:effort-set', 'agent:setConfig', 'enhancedPrompts:setEnabled', 'outputStyle:activate', 'webSearch:setConfig',
  'webSearch:setApiKey', 'webSearch:deleteApiKey', 'voice:setConfig', 'voice:setTtsConfig', 'voice:setProviderConfig',
  'voice:setApiKey', 'voice:listVoices', 'diagnostics:go-vet-consent-set', 'llm:setDefaultModel',
]);

const owners = new WeakMap<object, AsvState>();

/** The state {@link withAdvancedSearchVoice} registered for `owner` (the boot's fixture state). */
export function asvStateFor(owner: object): AsvState {
  const state = owners.get(owner);
  if (!state) throw new Error('asvStateFor: withAdvancedSearchVoice() was never called for this boot.');
  return state;
}

function voiceProviders(state: AsvState): Json[] {
  return [
    { id: 'local', label: 'Local (Whisper / Kokoro)', kind: 'local', requiresDownload: true, requiresApiKey: false },
    { id: 'elevenlabs', label: 'ElevenLabs', kind: 'cloud', requiresDownload: false, requiresApiKey: true },
  ].map((provider) => {
    const reason = state.voice.unavailable[provider.id];
    return { ...provider, supports: { stt: true, tts: true }, available: !reason, ...(reason ? { unavailableReason: reason } : {}) };
  });
}

function goVetAnswer(state: AsvState): Json {
  return {
    supported: true, workspace: { root: 'C:\\ptah-e2e-ws-a' }, state: state.goVet.state,
    ...(state.goVet.staleReason ? { staleReason: state.goVet.staleReason } : {}),
    goBinary: 'C:\\Program Files\\Go\\bin\\go.exe', confirmToken: 'e2e-token-1',
  };
}

/** Reads of the two tabs: every answer comes from `state`. */
function readFixtures(state: AsvState): Record<string, (params: unknown) => unknown> {
  return {
    'license:getStatus': () => ({ ...state.license }),
    'enhancedPrompts:getStatus': () => ({
      ...state.prompt, generatedAt: state.prompt.hasGeneratedPrompt ? '2026-09-28T14:12:00.000Z' : null,
      detectedStack: state.prompt.hasGeneratedPrompt ? {
        languages: ['TypeScript'], frameworks: ['Angular', 'NestJS'], buildTools: ['Nx', 'esbuild'],
        testingFrameworks: ['Jest', 'Playwright'], additionalTools: ['ESLint'], projectType: 'Nx monorepo',
        configFiles: ['nx.json', 'tsconfig.base.json'],
      } : null,
      cacheValid: true,
    }),
    'enhancedPrompts:getPromptContent': () => ({
      content: '# Project context\n\nThis is an Nx monorepo (Angular + NestJS).\n\n## Conventions\n- Signals for state\n- OnPush everywhere\n',
    }),
    'outputStyle:list': () => ({ styles: [...OUTPUT_STYLES], invalid: [...state.outputStyles.invalid], active: { ...state.outputStyles.active } }),
    'outputStyle:diagnose': () => ({
      decision: state.outputStyles.decision, visibleTiers: ['builtin', 'user', 'project'],
      activeName: state.outputStyles.active.name, activeMissing: state.outputStyles.active.missing,
    }),
    'outputStyle:get': (params) => {
      const name = (params as { name?: string } | null)?.name;
      const style = OUTPUT_STYLES.find((candidate) => candidate.name === name) ?? OUTPUT_STYLES[2];
      return { style: { ...style, body: STYLE_BODY, mtime: 1727000000000, byteLength: STYLE_BODY.length } };
    },
    'webSearch:getConfig': () => ({ providers: [...state.webSearch.providers], maxResults: state.webSearch.maxResults }),
    'webSearch:getApiKeyStatus': (params) => ({ configured: state.webSearch.keys.has((params as { provider?: string } | null)?.provider ?? '') }),
    'voice:listProviders': () => ({ ok: true, providers: voiceProviders(state), active: { stt: state.voice.stt, tts: state.voice.tts } }),
    'voice:getProviderConfig': () => ({
      ok: true,
      config: { sttProvider: state.voice.stt, ttsProvider: state.voice.tts, local: { ...state.voice.local }, elevenlabs: { ...state.voice.elevenlabs } },
    }),
    'voice:getTtsConfig': () => ({
      ok: true, config: { voice: state.voice.local.ttsVoice, downloaded: state.voice.local.ttsDownloaded, modelSource: 'curated' },
    }),
    'voice:listVoices': (params) => ({
      ok: true, voices: (params as { providerId?: string } | null)?.providerId === 'elevenlabs' ? ELEVENLABS_VOICES : LOCAL_VOICES,
    }),
    // `workspace` must be non-null or the toggle is disabled; the card stays hidden until this answers.
    'diagnostics:go-vet-consent-get': () => goVetAnswer(state),
    'llm:getProviderStatus': () => ({
      providers: [{ provider: 'vscode-lm', displayName: 'VS Code Language Model', isConfigured: true,
        defaultModel: state.llm.defaultModel, capabilities: ['streaming', 'tool-use'] }],
      defaultProvider: state.llm.defaultProvider,
    }),
    'llm:listProviderModels': () => ({ models: [
      { id: 'copilot-gpt-4o', displayName: 'GitHub Copilot GPT-4o' },
      { id: 'copilot-claude-sonnet', displayName: 'GitHub Copilot Claude Sonnet' },
    ] }),
  };
}

/** Writes and probes of the two tabs: each records its call and updates `state`. */
function writeFixtures(state: AsvState, calls: RecordedCall[]): Record<string, (params: unknown) => unknown> {
  const write = (method: string, apply: (params: Json) => unknown) => (params: unknown) => {
    calls.push({ method, params });
    return apply((params ?? {}) as Json);
  };
  return {
    'enhancedPrompts:setEnabled': write('enhancedPrompts:setEnabled', (p) => {
      state.prompt.enabled = p['enabled'] === true;
      return { success: true };
    }),
    'enhancedPrompts:regenerate': write('enhancedPrompts:regenerate', () => ({ success: true })),
    'enhancedPrompts:download': write('enhancedPrompts:download', () => ({ success: true })),
    'outputStyle:activate': write('outputStyle:activate', (p) => {
      const name = (p['name'] as string | null) ?? null;
      const style = OUTPUT_STYLES.find((candidate) => candidate.name === name);
      state.outputStyles.active = { name: style ? name : null, tier: style?.tier ?? null, missing: false };
      return { success: true, decision: style ? { path: 'flag', styleName: name } : { path: 'none' } };
    }),
    'outputStyle:save': write('outputStyle:save', () => ({ success: true, path: '~/.claude/output-styles/e2e.md' })),
    'outputStyle:delete': write('outputStyle:delete', () => ({ success: true, clearedActive: false })),
    'webSearch:setConfig': write('webSearch:setConfig', (p) => {
      if (Array.isArray(p['providers'])) state.webSearch.providers = [...(p['providers'] as string[])];
      if (typeof p['maxResults'] === 'number') state.webSearch.maxResults = p['maxResults'];
      return { success: true };
    }),
    'webSearch:setApiKey': write('webSearch:setApiKey', (p) => {
      state.webSearch.keys.add(String(p['provider']));
      return { success: true };
    }),
    'webSearch:deleteApiKey': write('webSearch:deleteApiKey', (p) => {
      state.webSearch.keys.delete(String(p['provider']));
      return { success: true };
    }),
    'webSearch:test': write('webSearch:test', () => ({
      success: true,
      results: state.webSearch.providers.filter((id) => state.webSearch.keys.has(id)).map((provider) => ({ provider, success: true })),
    })),
    'voice:setProviderConfig': write('voice:setProviderConfig', (p) => {
      if (typeof p['sttProvider'] === 'string') state.voice.stt = p['sttProvider'];
      if (typeof p['ttsProvider'] === 'string') state.voice.tts = p['ttsProvider'];
      if (p['elevenlabs']) Object.assign(state.voice.elevenlabs, p['elevenlabs']);
      return { ok: true };
    }),
    'voice:setConfig': write('voice:setConfig', (p) => {
      if (typeof p['whisperModel'] === 'string') state.voice.local.whisperModel = p['whisperModel'];
      if (typeof p['modelSource'] === 'string') state.voice.local.modelSource = p['modelSource'];
      return { ok: true };
    }),
    'voice:setTtsConfig': write('voice:setTtsConfig', (p) => {
      if (typeof p['voice'] === 'string') state.voice.local.ttsVoice = p['voice'];
      return { ok: true };
    }),
    'voice:downloadModel': write('voice:downloadModel', () => {
      state.voice.local.sttDownloaded = true;
      return { ok: true };
    }),
    'voice:downloadTtsModel': write('voice:downloadTtsModel', () => {
      state.voice.local.ttsDownloaded = true;
      return { ok: true };
    }),
    'voice:synthesize': write('voice:synthesize', () => ({ ok: true, audioBase64: SILENT_WAV_BASE64, mimeType: 'audio/wav' })),
    'voice:testConnection': write('voice:testConnection', (p) => p['apiKey'] === INVALID_VOICE_KEY
      ? { ok: false, category: 'auth', error: HOST_DETAIL }
      : { ok: true }),
    'voice:setApiKey': write('voice:setApiKey', (p) => {
      state.voice.elevenlabs.apiKeyConfigured = String(p['apiKey'] ?? '') !== '';
      return { ok: true };
    }),
    'diagnostics:go-vet-consent-set': write('diagnostics:go-vet-consent-set', (p) => {
      state.goVet = { state: p['enabled'] === true ? 'on' : 'off' };
      return { success: true, state: state.goVet.state, goBinary: 'C:\\Program Files\\Go\\bin\\go.exe' };
    }),
    'llm:setDefaultModel': write('llm:setDefaultModel', (p) => {
      state.llm.defaultModel = String(p['model'] ?? '');
      return { success: true };
    }),
    'llm:setDefaultProvider': write('llm:setDefaultProvider', (p) => {
      state.llm.defaultProvider = String(p['provider'] ?? '');
      return { success: true };
    }),
    'command:execute': write('command:execute', () => ({ success: true })),
  };
}

/**
 * Merges the two tabs' fixtures into `fixtures` (the boot's own RPC map; these answers win) and makes every
 * {@link FAILABLE} method answer from {@link AsvState.failures} once when a failure is queued for it.
 * `owner` is the boot's fixture state: `calls` is shared with it, and {@link asvStateFor} finds this state by it.
 */
export function withAdvancedSearchVoice(
  owner: { readonly calls: RecordedCall[] },
  fixtures: Record<string, unknown>,
  configure?: (state: AsvState) => void,
): Record<string, unknown> {
  const state = createAsvState();
  configure?.(state);
  owners.set(owner, state);
  const merged: Record<string, unknown> = { ...fixtures, ...readFixtures(state), ...writeFixtures(state, owner.calls) };
  for (const method of FAILABLE) {
    const answer = merged[method];
    merged[method] = (params: unknown) => {
      if (state.failures.has(method)) {
        const failure = state.failures.get(method);
        state.failures.delete(method);
        owner.calls.push({ method, params });
        return failure;
      }
      return typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer;
    };
  }
  return merged;
}
