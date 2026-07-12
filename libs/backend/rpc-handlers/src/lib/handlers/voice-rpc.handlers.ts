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
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  VOICE_CONTRACT_TOKENS,
  isVoiceProviderError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
  type IVoiceProviderRegistry,
  type IVoiceProviderSelector,
  type VoiceDownloadEvent,
} from '@ptah-extension/voice-contracts';
import {
  resolveWhisperModel,
  resolveTtsVoice,
  VOICE_WHISPER_MODEL_KEY,
  VOICE_TTS_VOICE_KEY,
} from '@ptah-extension/voice-providers';
import {
  VoiceDownloadModelParamsSchema,
  VoiceSetConfigParamsSchema,
  VoiceTranscribeParamsSchema,
  VoiceSetTtsConfigParamsSchema,
  VoiceSynthesizeParamsSchema,
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

    this.logger.debug('Voice RPC handlers registered', {
      methods: VoiceRpcHandlers.METHODS,
    });
  }

  /**
   * Shared error mapping — local assets-unavailable keeps the historical
   * `VOICE_ASSETS_UNAVAILABLE` code + remediation; everything else surfaces the
   * sanitized message. (Cloud-category broadcasts are added in a later batch.)
   */
  private mapVoiceError(error: unknown): {
    ok: false;
    error: string;
    code?: string;
    remediation?: string;
  } {
    const message = error instanceof Error ? error.message : String(error);
    if (
      isVoiceProviderError(error) &&
      error.category === 'assets-unavailable'
    ) {
      return {
        ok: false,
        error: message,
        code: VOICE_ASSETS_UNAVAILABLE,
        remediation: VOICE_ASSETS_REMEDIATION,
      };
    }
    return { ok: false, error: message };
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
      const mapped = this.mapVoiceError(error);
      if (mapped.code) {
        this.logger.warn('[voice] synthesis assets unavailable');
      } else {
        this.logger.error(
          `[voice] synthesis failed: ${mapped.error}`,
          error instanceof Error ? error : undefined,
        );
      }
      return mapped;
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
      this.logger.info('[voice] whisper model updated', {
        whisperModel: parsed.data.whisperModel,
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
      const mapped = this.mapVoiceError(error);
      if (mapped.code) {
        this.logger.warn('[voice] transcription assets unavailable', {
          mimeType,
        });
      } else {
        this.logger.error(
          `[voice] transcription failed (${mimeType}): ${mapped.error}`,
          error instanceof Error ? error : undefined,
        );
      }
      return mapped;
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
