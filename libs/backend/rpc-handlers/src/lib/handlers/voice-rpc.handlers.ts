/**
 * Voice RPC Handlers
 *
 * Bridges the `voice:*` RPC methods to the provider-agnostic voice subsystem in
 * `@ptah-extension/voice-providers` via the `voice-contracts` selector/registry
 * ports. `voice:transcribe`/`voice:synthesize` route through the active provider
 * (selector); the local model-config methods route through `registry.get*('local')`.
 * Electron-only, registered alongside the `gateway:*` namespace.
 */

import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  RpcMethodName,
  VoiceDownloadModelParams,
  VoiceDownloadModelResult,
  VoiceGetConfigParams,
  VoiceGetConfigResult,
  VoiceSetConfigParams,
  VoiceSetConfigResult,
  VoiceTranscribeParams,
  VoiceTranscribeResult,
  VoiceGetTtsConfigParams,
  VoiceGetTtsConfigResult,
  VoiceSetTtsConfigParams,
  VoiceSetTtsConfigResult,
  VoiceDownloadTtsModelParams,
  VoiceDownloadTtsModelResult,
  VoiceSynthesizeParams,
  VoiceSynthesizeResult,
  VoiceListProvidersParams,
  VoiceListProvidersResult,
  VoiceListVoicesParams,
  VoiceListVoicesResult,
  VoiceGetProviderConfigParams,
  VoiceGetProviderConfigResult,
  VoiceSetProviderConfigParams,
  VoiceSetProviderConfigResult,
  VoiceSetApiKeyParams,
  VoiceSetApiKeyResult,
  VoiceTestConnectionParams,
  VoiceTestConnectionResult,
  VoiceProviderCapabilityDto,
  VoiceProviderErrorPayload,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  VOICE_CONTRACT_TOKENS,
  isVoiceProviderError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
  type IVoiceProviderRegistry,
  type IVoiceProviderSelector,
  type VoiceProviderError,
  type VoiceProviderCapability,
  type VoiceDirection,
  type VoiceDownloadEvent,
} from '@ptah-extension/voice-contracts';
import {
  resolveWhisperModel,
  resolveTtsVoice,
  VOICE_TOKENS,
  VOICE_WHISPER_MODEL_KEY,
  VOICE_WHISPER_MODEL_SOURCE_KEY,
  VOICE_WHISPER_CUSTOM_MODEL_KEY,
  VOICE_TTS_VOICE_KEY,
  VoiceSecretStore,
  ElevenLabsClient,
} from '@ptah-extension/voice-providers';
import {
  VoiceDownloadModelParamsSchema,
  VoiceSetConfigParamsSchema,
  VoiceTranscribeParamsSchema,
  VoiceSetTtsConfigParamsSchema,
  VoiceSynthesizeParamsSchema,
  VoiceListVoicesParamsSchema,
  VoiceSetProviderConfigParamsSchema,
  VoiceSetApiKeyParamsSchema,
  VoiceTestConnectionParamsSchema,
} from './voice-rpc.schema';

/**
 * Stable sentinel model id for the TTS download progress channel, so the
 * settings UI can distinguish Kokoro download ticks from Whisper ones (which
 * are keyed by the selected Whisper model name).
 */
const TTS_PROGRESS_MODEL = 'tts';

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
};

function extensionForMime(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_EXTENSIONS[base] ?? '.webm';
}

/** Map a download event's lifecycle kind to a broadcastable percent. */
function downloadPercent(evt: VoiceDownloadEvent): number | null {
  if (evt.kind === 'download:start') return 0;
  if (evt.kind === 'download:progress') return evt.percent;
  if (evt.kind === 'download:complete') return 100;
  return null;
}

/** ElevenLabs config defaults — mirror the adapter defaults (voice-providers). */
const EL_DEFAULT_TTS_MODEL_ID = 'eleven_multilingual_v2';
const EL_DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const EL_DEFAULT_STT_MODEL_ID = 'scribe_v1';
const EL_VOICE_ID_KEY = 'voice.elevenlabs.voiceId';
const EL_TTS_MODEL_KEY = 'voice.elevenlabs.ttsModelId';
const EL_OUTPUT_FORMAT_KEY = 'voice.elevenlabs.outputFormat';
const EL_STT_MODEL_KEY = 'voice.elevenlabs.sttModelId';

/** Categories that indicate a recoverable CLOUD provider failure (FR-7). */
const CLOUD_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  'auth',
  'quota',
  'network',
  'provider-error',
]);

/**
 * True when the error is a `VoiceProviderError` from a CLOUD provider with a
 * cloud category — the trigger for the FR-7 `voice:providerError` broadcast.
 * Local failures (assets-unavailable, process-crashed, model-invalid, or any
 * error whose `providerId` is `'local'`) are excluded — they never broadcast.
 */
function isCloudProviderFailure(error: unknown): error is VoiceProviderError {
  return (
    isVoiceProviderError(error) &&
    error.providerId !== 'local' &&
    CLOUD_ERROR_CATEGORIES.has(error.category)
  );
}

/** Project a domain capability onto the wire DTO (ids → string). */
function toCapabilityDto(
  cap: VoiceProviderCapability,
): VoiceProviderCapabilityDto {
  return {
    id: cap.id,
    label: cap.label,
    kind: cap.kind,
    requiresDownload: cap.requiresDownload,
    requiresApiKey: cap.requiresApiKey,
    supports: { tts: cap.supports.tts, stt: cap.supports.stt },
    available: cap.available,
    unavailableReason: cap.unavailableReason,
  };
}

@injectable()
export class VoiceRpcHandlers {
  static readonly METHODS = [
    'voice:transcribe',
    'voice:getConfig',
    'voice:setConfig',
    'voice:downloadModel',
    'voice:getTtsConfig',
    'voice:setTtsConfig',
    'voice:downloadTtsModel',
    'voice:synthesize',
    'voice:listProviders',
    'voice:listVoices',
    'voice:getProviderConfig',
    'voice:setProviderConfig',
    'voice:setApiKey',
    'voice:testConnection',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR)
    private readonly selector: IVoiceProviderSelector,
    @inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_REGISTRY)
    private readonly registry: IVoiceProviderRegistry,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: {
      broadcastMessage(type: string, payload: unknown): Promise<void>;
    },
    @inject(VOICE_TOKENS.VOICE_SECRET_STORE)
    private readonly secretStore: VoiceSecretStore,
    @inject(VOICE_TOKENS.ELEVENLABS_CLIENT)
    private readonly elevenLabsClient: ElevenLabsClient,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      VoiceTranscribeParams,
      VoiceTranscribeResult
    >('voice:transcribe', (params) => this.transcribe(params));

    this.rpcHandler.registerMethod<VoiceGetConfigParams, VoiceGetConfigResult>(
      'voice:getConfig',
      () => this.getConfig(),
    );

    this.rpcHandler.registerMethod<VoiceSetConfigParams, VoiceSetConfigResult>(
      'voice:setConfig',
      (params) => this.setConfig(params),
    );

    this.rpcHandler.registerMethod<
      VoiceDownloadModelParams,
      VoiceDownloadModelResult
    >('voice:downloadModel', (params) => this.downloadModel(params));

    this.rpcHandler.registerMethod<
      VoiceGetTtsConfigParams,
      VoiceGetTtsConfigResult
    >('voice:getTtsConfig', () => this.getTtsConfig());

    this.rpcHandler.registerMethod<
      VoiceSetTtsConfigParams,
      VoiceSetTtsConfigResult
    >('voice:setTtsConfig', (params) => this.setTtsConfig(params));

    this.rpcHandler.registerMethod<
      VoiceDownloadTtsModelParams,
      VoiceDownloadTtsModelResult
    >('voice:downloadTtsModel', () => this.downloadTtsModel());

    this.rpcHandler.registerMethod<
      VoiceSynthesizeParams,
      VoiceSynthesizeResult
    >('voice:synthesize', (params) => this.synthesize(params));

    this.rpcHandler.registerMethod<
      VoiceListProvidersParams,
      VoiceListProvidersResult
    >('voice:listProviders', () => this.listProviders());

    this.rpcHandler.registerMethod<
      VoiceListVoicesParams,
      VoiceListVoicesResult
    >('voice:listVoices', (params) => this.listVoices(params));

    this.rpcHandler.registerMethod<
      VoiceGetProviderConfigParams,
      VoiceGetProviderConfigResult
    >('voice:getProviderConfig', () => this.getProviderConfig());

    this.rpcHandler.registerMethod<
      VoiceSetProviderConfigParams,
      VoiceSetProviderConfigResult
    >('voice:setProviderConfig', (params) => this.setProviderConfig(params));

    this.rpcHandler.registerMethod<VoiceSetApiKeyParams, VoiceSetApiKeyResult>(
      'voice:setApiKey',
      (params) => this.setApiKey(params),
    );

    this.rpcHandler.registerMethod<
      VoiceTestConnectionParams,
      VoiceTestConnectionResult
    >('voice:testConnection', (params) => this.testConnection(params));

    this.logger.debug('Voice RPC handlers registered', {
      methods: VoiceRpcHandlers.METHODS,
    });
  }

  /**
   * Shared error mapping:
   * - local assets-unavailable keeps the historical `VOICE_ASSETS_UNAVAILABLE`
   *   code + remediation;
   * - cloud-category failures (FR-7) surface `code: 'VOICE_PROVIDER_ERROR'` +
   *   `category` + `providerId` (plus remediation when present);
   * - everything else surfaces just the sanitized message.
   *
   * All messages are already sanitized by `VoiceProviderError` — never a raw
   * response body, header, or key material.
   */
  private mapVoiceError(error: unknown): {
    ok: false;
    error: string;
    code?: string;
    remediation?: string;
    category?: string;
    providerId?: string;
  } {
    const message = error instanceof Error ? error.message : String(error);
    if (isVoiceProviderError(error)) {
      if (error.category === 'assets-unavailable') {
        return {
          ok: false,
          error: message,
          code: VOICE_ASSETS_UNAVAILABLE,
          remediation: VOICE_ASSETS_REMEDIATION,
        };
      }
      if (isCloudProviderFailure(error)) {
        return {
          ok: false,
          error: message,
          code: error.code,
          category: error.category,
          providerId: error.providerId,
          ...(error.remediation
            ? { remediation: error.remediation }
            : undefined),
        };
      }
    }
    return { ok: false, error: message };
  }

  /**
   * Map + log a transcribe/synthesize failure and, for CLOUD-category failures
   * only, broadcast the FR-7 `voice:providerError` push message. The error
   * result is still returned to the caller — NO retry, NO substitution.
   */
  private handleCallFailure(
    direction: VoiceDirection,
    error: unknown,
    context: string,
  ): ReturnType<VoiceRpcHandlers['mapVoiceError']> {
    const mapped = this.mapVoiceError(error);
    if (mapped.code === VOICE_ASSETS_UNAVAILABLE) {
      this.logger.warn(`[voice] ${context} assets unavailable`);
    } else if (isCloudProviderFailure(error)) {
      this.broadcastCloudError(direction, error);
      this.logger.warn(`[voice] ${context} cloud provider error`, {
        providerId: error.providerId,
        category: error.category,
      });
    } else {
      this.logger.error(
        `[voice] ${context} failed: ${mapped.error}`,
        error instanceof Error ? error : undefined,
      );
    }
    return mapped;
  }

  /** Broadcast a sanitized cloud-provider error to the webview (FR-7). */
  private broadcastCloudError(
    direction: VoiceDirection,
    error: VoiceProviderError,
  ): void {
    const payload: VoiceProviderErrorPayload = {
      direction,
      providerId: error.providerId,
      category: error.category as VoiceProviderErrorPayload['category'],
      message: error.message,
    };
    void this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.VOICE_PROVIDER_ERROR, payload)
      .catch(() => undefined);
  }

  private async getTtsConfig(): Promise<VoiceGetTtsConfigResult> {
    try {
      const voice = resolveTtsVoice(this.workspace);
      const downloaded = (await this.registry.getTts('local').isReady()).ready;
      return { ok: true, config: { voice, downloaded } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] getTtsConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async setTtsConfig(
    params: VoiceSetTtsConfigParams,
  ): Promise<VoiceSetTtsConfigResult> {
    const parsed = VoiceSetTtsConfigParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid setTtsConfig params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    try {
      await this.writeConfiguration(VOICE_TTS_VOICE_KEY, parsed.data.voice);
      this.logger.info('[voice] tts voice updated', {
        voice: parsed.data.voice,
      });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] setTtsConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async downloadTtsModel(): Promise<VoiceDownloadTtsModelResult> {
    const subscription = this.selector.downloadEvents.onDownload((evt) => {
      if (evt.direction !== 'tts') return;
      const percent = downloadPercent(evt);
      if (percent === null) return;
      void this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS, {
          model: TTS_PROGRESS_MODEL,
          percent,
        })
        .catch(() => undefined);
    });
    try {
      const { alreadyPresent } = await this.registry
        .getTts('local')
        .downloadModel();
      this.logger.info('[voice] tts model download complete', {
        alreadyPresent,
      });
      return { ok: true, alreadyPresent };
    } catch (error: unknown) {
      const mapped = this.mapVoiceError(error);
      if (mapped.code) {
        this.logger.warn('[voice] tts download assets unavailable');
      } else {
        this.logger.error(
          `[voice] tts model download failed: ${mapped.error}`,
          error instanceof Error ? error : undefined,
        );
      }
      return mapped;
    } finally {
      subscription.dispose();
    }
  }

  private async synthesize(
    params: VoiceSynthesizeParams,
  ): Promise<VoiceSynthesizeResult> {
    const parsed = VoiceSynthesizeParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid synthesize params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    try {
      const { audio, mimeType } = await this.selector
        .activeTts()
        .synthesize({ text: parsed.data.text, voice: parsed.data.voice });
      return {
        ok: true,
        audioBase64: Buffer.from(audio).toString('base64'),
        mimeType,
      };
    } catch (error: unknown) {
      return this.handleCallFailure('tts', error, 'synthesis');
    }
  }

  private async getConfig(): Promise<VoiceGetConfigResult> {
    try {
      const whisperModel = resolveWhisperModel(this.workspace);
      const downloaded = (await this.registry.getStt('local').isReady()).ready;
      return { ok: true, config: { whisperModel, downloaded } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] getConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async downloadModel(
    params: VoiceDownloadModelParams,
  ): Promise<VoiceDownloadModelResult> {
    const parsed = VoiceDownloadModelParamsSchema.safeParse(params ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid downloadModel params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    const model = parsed.data.model ?? resolveWhisperModel(this.workspace);
    const subscription = this.selector.downloadEvents.onDownload((evt) => {
      if (evt.direction !== 'stt') return;
      const percent = downloadPercent(evt);
      if (percent === null) return;
      void this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS, {
          model,
          percent,
        })
        .catch(() => undefined);
    });
    try {
      const { alreadyPresent } = await this.registry
        .getStt('local')
        .downloadModel(model);
      this.logger.info('[voice] model download complete', {
        model,
        alreadyPresent,
      });
      return { ok: true, alreadyPresent };
    } catch (error: unknown) {
      const mapped = this.mapVoiceError(error);
      if (mapped.code) {
        this.logger.warn('[voice] download assets unavailable', { model });
      } else {
        this.logger.error(
          `[voice] model download failed (${model}): ${mapped.error}`,
          error instanceof Error ? error : undefined,
        );
      }
      return mapped;
    } finally {
      subscription.dispose();
    }
  }

  private async setConfig(
    params: VoiceSetConfigParams,
  ): Promise<VoiceSetConfigResult> {
    const parsed = VoiceSetConfigParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid setConfig params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    try {
      await this.writeConfiguration(
        VOICE_WHISPER_MODEL_KEY,
        parsed.data.whisperModel,
      );
      // FR-4: persist the user model source + custom id/path when supplied.
      // Left untouched when absent so a bad custom source never clobbers the
      // last-known-good curated config (FR-4.4 recoverability).
      if (parsed.data.modelSource !== undefined) {
        await this.writeConfiguration(
          VOICE_WHISPER_MODEL_SOURCE_KEY,
          parsed.data.modelSource,
        );
      }
      if (parsed.data.customModel !== undefined) {
        await this.writeConfiguration(
          VOICE_WHISPER_CUSTOM_MODEL_KEY,
          parsed.data.customModel,
        );
      }
      this.logger.info('[voice] whisper model updated', {
        whisperModel: parsed.data.whisperModel,
        modelSource: parsed.data.modelSource,
      });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] setConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async writeConfiguration(key: string, value: unknown): Promise<void> {
    const provider = this.workspace as unknown as {
      setConfiguration?: (
        section: string,
        key: string,
        value: unknown,
      ) => Promise<void>;
    };

    if (typeof provider.setConfiguration === 'function') {
      await provider.setConfiguration('ptah', key, value);
    } else {
      this.logger.debug(
        '[voice] setConfiguration not available on this platform, skipping backend write',
        { key },
      );
    }
  }

  // --- Provider-agnostic surface (FR-8) ------------------------------------

  private async listProviders(): Promise<VoiceListProvidersResult> {
    try {
      const providers = this.registry.listProviders().map(toCapabilityDto);
      const active = {
        tts: this.selector.activeProviderId('tts'),
        stt: this.selector.activeProviderId('stt'),
      };
      return { ok: true, providers, active };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] listProviders failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async listVoices(
    params: VoiceListVoicesParams,
  ): Promise<VoiceListVoicesResult> {
    const parsed = VoiceListVoicesParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid listVoices params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    const { providerId } = parsed.data;
    try {
      const voices = await this.registry.getTts(providerId).listVoices();
      return {
        ok: true,
        voices: voices.map((v) => ({
          id: v.id,
          label: v.label,
          category: v.category,
        })),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const category = isVoiceProviderError(error) ? error.category : undefined;
      this.logger.warn('[voice] listVoices failed', { providerId, category });
      return { ok: false, error: message, category };
    }
  }

  private async getProviderConfig(): Promise<VoiceGetProviderConfigResult> {
    try {
      const [sttReady, ttsReady] = await Promise.all([
        this.registry.getStt('local').isReady(),
        this.registry.getTts('local').isReady(),
      ]);
      const config = {
        ttsProvider: this.selector.activeProviderId('tts'),
        sttProvider: this.selector.activeProviderId('stt'),
        local: {
          whisperModel: resolveWhisperModel(this.workspace),
          modelSource: this.readModelSource(VOICE_WHISPER_MODEL_SOURCE_KEY),
          customModel: this.readOptionalConfig(VOICE_WHISPER_CUSTOM_MODEL_KEY),
          sttDownloaded: sttReady.ready,
          ttsDownloaded: ttsReady.ready,
          ttsVoice: resolveTtsVoice(this.workspace),
        },
        elevenlabs: {
          // SECURITY: boolean only — never the key or its ciphertext.
          apiKeyConfigured: this.secretStore.isConfigured('elevenlabs'),
          voiceId: this.readOptionalConfig(EL_VOICE_ID_KEY),
          ttsModelId: this.readConfig(
            EL_TTS_MODEL_KEY,
            EL_DEFAULT_TTS_MODEL_ID,
          ),
          outputFormat: this.readConfig(
            EL_OUTPUT_FORMAT_KEY,
            EL_DEFAULT_OUTPUT_FORMAT,
          ),
          sttModelId: this.readConfig(
            EL_STT_MODEL_KEY,
            EL_DEFAULT_STT_MODEL_ID,
          ),
        },
      };
      return { ok: true, config };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] getProviderConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async setProviderConfig(
    params: VoiceSetProviderConfigParams,
  ): Promise<VoiceSetProviderConfigResult> {
    const parsed = VoiceSetProviderConfigParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid setProviderConfig params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    const { ttsProvider, sttProvider, elevenlabs } = parsed.data;
    try {
      if (ttsProvider) await this.selector.setProvider('tts', ttsProvider);
      if (sttProvider) await this.selector.setProvider('stt', sttProvider);
      if (elevenlabs) {
        if (elevenlabs.voiceId !== undefined) {
          await this.writeConfiguration(EL_VOICE_ID_KEY, elevenlabs.voiceId);
        }
        if (elevenlabs.ttsModelId !== undefined) {
          await this.writeConfiguration(
            EL_TTS_MODEL_KEY,
            elevenlabs.ttsModelId,
          );
        }
        if (elevenlabs.outputFormat !== undefined) {
          await this.writeConfiguration(
            EL_OUTPUT_FORMAT_KEY,
            elevenlabs.outputFormat,
          );
        }
        if (elevenlabs.sttModelId !== undefined) {
          await this.writeConfiguration(
            EL_STT_MODEL_KEY,
            elevenlabs.sttModelId,
          );
        }
      }
      this.logger.info('[voice] provider config updated', {
        ttsProvider,
        sttProvider,
      });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] setProviderConfig failed', { error: message });
      return { ok: false, error: message };
    }
  }

  private async setApiKey(
    params: VoiceSetApiKeyParams,
  ): Promise<VoiceSetApiKeyResult> {
    const parsed = VoiceSetApiKeyParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      // Never log the params object — it carries the plaintext key.
      this.logger.warn('[voice] rejected invalid setApiKey params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    try {
      // The key is passed straight to the vault-backed store; never logged.
      await this.secretStore.setKey(parsed.data.providerId, parsed.data.apiKey);
      this.logger.info('[voice] api key updated', {
        providerId: parsed.data.providerId,
        cleared: parsed.data.apiKey.length === 0,
      });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] setApiKey failed', {
        providerId: parsed.data.providerId,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  private async testConnection(
    params: VoiceTestConnectionParams,
  ): Promise<VoiceTestConnectionResult> {
    const parsed = VoiceTestConnectionParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      // Never log the params object — it may carry an unsaved plaintext key.
      this.logger.warn('[voice] rejected invalid testConnection params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    try {
      // `testConnection` throws a sanitized VoiceProviderError on failure.
      await this.elevenLabsClient.testConnection(parsed.data.apiKey);
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const category = isVoiceProviderError(error) ? error.category : undefined;
      this.logger.warn('[voice] testConnection failed', {
        providerId: parsed.data.providerId,
        category,
      });
      return { ok: false, error: message, category };
    }
  }

  /** Read a non-secret `ptah` setting as a trimmed string with a fallback. */
  private readConfig(key: string, fallback = ''): string {
    const value = this.workspace.getConfiguration<string>(
      'ptah',
      key,
      fallback,
    );
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : fallback;
  }

  /** Read a non-secret `ptah` setting; `undefined` when unset/blank. */
  private readOptionalConfig(key: string): string | undefined {
    const value = this.readConfig(key);
    return value.length > 0 ? value : undefined;
  }

  /** Read the model-source toggle, defaulting to `'curated'`. */
  private readModelSource(key: string): 'curated' | 'hf' | 'dir' {
    const value = this.readConfig(key, 'curated');
    return value === 'hf' || value === 'dir' ? value : 'curated';
  }

  private async transcribe(
    params: VoiceTranscribeParams,
  ): Promise<VoiceTranscribeResult> {
    const parsed = VoiceTranscribeParamsSchema.safeParse(params);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid params';
      this.logger.warn('[voice] rejected invalid transcribe params', {
        error: message,
      });
      return { ok: false, error: message };
    }

    const { audioBase64, mimeType } = parsed.data;
    const inputPath = path.join(
      os.tmpdir(),
      `ptah-voice-${randomUUID()}${extensionForMime(mimeType)}`,
    );

    try {
      await fs.writeFile(inputPath, Buffer.from(audioBase64, 'base64'));

      const { text } = await this.selector
        .activeStt()
        .transcribe({ audioPath: inputPath, mimeType });
      return { ok: true, transcript: text };
    } catch (error: unknown) {
      return this.handleCallFailure(
        'stt',
        error,
        `transcription (${mimeType})`,
      );
    } finally {
      await this.cleanup(inputPath);
    }
  }

  private async cleanup(filePath: string, recursive = false): Promise<void> {
    try {
      await fs.rm(filePath, { force: true, recursive });
    } catch (error: unknown) {
      this.logger.warn('[voice] temp file cleanup failed', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
