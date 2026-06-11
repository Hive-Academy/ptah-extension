/**
 * Voice RPC Handlers
 *
 * Bridges the `voice:transcribe` RPC method to the shared voice pipeline in
 * `@ptah-extension/messaging-gateway` (FfmpegDecoder + WhisperTranscriber).
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
  VoiceGetConfigParams,
  VoiceGetConfigResult,
  VoiceSetConfigParams,
  VoiceSetConfigResult,
  VoiceTranscribeParams,
  VoiceTranscribeResult,
} from '@ptah-extension/shared';
import {
  GATEWAY_TOKENS,
  FfmpegDecoder,
  WhisperTranscriber,
  resolveWhisperModel,
  VOICE_WHISPER_MODEL_KEY,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
  isVoiceAssetsUnavailable,
} from '@ptah-extension/messaging-gateway';
import {
  VoiceSetConfigParamsSchema,
  VoiceTranscribeParamsSchema,
} from './voice-rpc.schema';

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

@injectable()
export class VoiceRpcHandlers {
  static readonly METHODS = [
    'voice:transcribe',
    'voice:getConfig',
    'voice:setConfig',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(GATEWAY_TOKENS.GATEWAY_FFMPEG_DECODER)
    private readonly ffmpeg: FfmpegDecoder,
    @inject(GATEWAY_TOKENS.GATEWAY_WHISPER_TRANSCRIBER)
    private readonly whisper: WhisperTranscriber,
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

    this.logger.debug('Voice RPC handlers registered', {
      methods: VoiceRpcHandlers.METHODS,
    });
  }

  private async getConfig(): Promise<VoiceGetConfigResult> {
    try {
      const whisperModel = resolveWhisperModel(this.workspace);
      return { ok: true, config: { whisperModel } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[voice] getConfig failed', { error: message });
      return { ok: false, error: message };
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
    let wavPath: string | null = null;

    try {
      await fs.writeFile(inputPath, Buffer.from(audioBase64, 'base64'));

      const modelName = resolveWhisperModel(this.workspace);
      if (modelName.length > 0) {
        this.whisper.configure({ modelName });
      }

      wavPath = await this.ffmpeg.decodeToPcm16Wav(inputPath);
      const transcript = await this.whisper.transcribe(wavPath);
      return { ok: true, transcript };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isVoiceAssetsUnavailable(error)) {
        this.logger.warn('[voice] transcription assets unavailable', {
          mimeType,
        });
        return {
          ok: false,
          error: message,
          code: VOICE_ASSETS_UNAVAILABLE,
          remediation: VOICE_ASSETS_REMEDIATION,
        };
      }
      this.logger.error('[voice] transcription failed', {
        error: message,
        mimeType,
      });
      return { ok: false, error: message };
    } finally {
      await this.cleanup(inputPath);
      if (wavPath) await this.cleanup(path.dirname(wavPath), true);
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
