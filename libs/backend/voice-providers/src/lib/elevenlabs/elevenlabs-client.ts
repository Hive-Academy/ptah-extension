/**
 * ElevenLabsClient — shared fetch-based HTTP core for the ElevenLabs cloud
 * adapters. The single place in the codebase that talks to api.elevenlabs.io.
 *
 * SECURITY (R6): `mapElevenLabsError` is the ONLY error factory on the failure
 * path. Every thrown message is generic — never a response body, a header, or
 * key material. The `xi-api-key` value is attached solely to the outbound
 * request headers; it never appears in a thrown error, a log line, or a return
 * value. `catch (error: unknown)` + `instanceof` narrowing throughout.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { VoiceProviderError } from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import { VoiceSecretStore } from '../voice-secret-store';
import {
  ErrorBodySchema,
  SttResponseSchema,
  VoicesResponseSchema,
  type ElevenLabsErrorDetail,
  type ElevenLabsVoicesResponse,
} from './elevenlabs.schema';

const BASE_URL = 'https://api.elevenlabs.io';
const PROVIDER_ID = 'elevenlabs' as const;

/** Request timeouts (ms): generous for media ops, short for metadata probes. */
export const SYNTH_TIMEOUT_MS = 30_000;
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
export const LIST_TIMEOUT_MS = 10_000;
export const TEST_TIMEOUT_MS = 10_000;

const RE_ENTER_KEY_REMEDIATION =
  'Re-enter your ElevenLabs API key in Voice settings.';

/** Zod-parseable schema surface (avoids leaking the concrete Zod type). */
interface ResponseSchema<T> {
  parse(value: unknown): T;
}

/**
 * The single sanitizing error chokepoint (R6). Maps a transport/HTTP failure to
 * a categorized {@link VoiceProviderError} carrying a generic, body-free
 * message.
 *
 * - fetch `TypeError` / `AbortError` / `TimeoutError` → `network`
 * - 401 / 403 → `auth` (unless the body indicates `quota_exceeded` → `quota`)
 * - 402 / 429 → `quota`
 * - anything else → `provider-error` with `"ElevenLabs request failed (HTTP <status>)"`
 */
export function mapElevenLabsError(input: {
  status?: number;
  detail?: ElevenLabsErrorDetail;
  cause?: unknown;
}): VoiceProviderError {
  const { status, detail, cause } = input;

  if (isNetworkCause(cause)) {
    return new VoiceProviderError(
      'network',
      PROVIDER_ID,
      'Could not reach ElevenLabs. Check your network connection and try again.',
      undefined,
      cause,
    );
  }

  if (status === 401 || status === 403) {
    if (detail?.status === 'quota_exceeded') {
      return new VoiceProviderError(
        'quota',
        PROVIDER_ID,
        'ElevenLabs quota exceeded. Check your plan usage and try again.',
      );
    }
    return new VoiceProviderError(
      'auth',
      PROVIDER_ID,
      'ElevenLabs rejected the API key (authentication failed).',
      RE_ENTER_KEY_REMEDIATION,
    );
  }

  if (status === 402 || status === 429) {
    return new VoiceProviderError(
      'quota',
      PROVIDER_ID,
      'ElevenLabs quota exceeded. Check your plan usage and try again.',
    );
  }

  const suffix = typeof status === 'number' ? ` (HTTP ${status})` : '';
  return new VoiceProviderError(
    'provider-error',
    PROVIDER_ID,
    `ElevenLabs request failed${suffix}.`,
    undefined,
    cause,
  );
}

/** True for fetch transport failures and aborts/timeouts (no body involved). */
function isNetworkCause(cause: unknown): boolean {
  if (cause instanceof TypeError) return true;
  if (typeof cause === 'object' && cause !== null && 'name' in cause) {
    const name = (cause as { name?: unknown }).name;
    if (name === 'AbortError' || name === 'TimeoutError') return true;
  }
  return false;
}

@injectable()
export class ElevenLabsClient {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(VOICE_TOKENS.VOICE_SECRET_STORE)
    private readonly secretStore: VoiceSecretStore,
  ) {}

  /** POST /v1/text-to-speech/{voiceId} → raw encoded audio bytes. */
  async synthesize(params: {
    voiceId: string;
    text: string;
    modelId: string;
    outputFormat: string;
  }): Promise<Uint8Array> {
    const key = this.requireKey();
    const path =
      `/v1/text-to-speech/${encodeURIComponent(params.voiceId)}` +
      `?output_format=${encodeURIComponent(params.outputFormat)}`;
    const response = await this.fetchOk(
      path,
      {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'content-type': 'application/json',
          accept: 'audio/*',
        },
        body: JSON.stringify({ text: params.text, model_id: params.modelId }),
      },
      SYNTH_TIMEOUT_MS,
    );
    return this.readBytes(response);
  }

  /** GET /v1/voices → the account's voice catalogue (Zod-validated). */
  async listVoices(): Promise<ElevenLabsVoicesResponse> {
    const key = this.requireKey();
    const response = await this.fetchOk(
      '/v1/voices',
      {
        method: 'GET',
        headers: { 'xi-api-key': key, accept: 'application/json' },
      },
      LIST_TIMEOUT_MS,
    );
    return this.parseJson(response, VoicesResponseSchema);
  }

  /** POST /v1/speech-to-text (Scribe) multipart → transcript text. */
  async transcribe(params: {
    audio: Uint8Array;
    mimeType: string;
    fileName: string;
    modelId: string;
  }): Promise<{ text: string }> {
    const key = this.requireKey();
    const form = new FormData();
    form.append('model_id', params.modelId);
    form.append(
      'file',
      new Blob([params.audio as BlobPart], { type: params.mimeType }),
      params.fileName,
    );
    const response = await this.fetchOk(
      '/v1/speech-to-text',
      {
        method: 'POST',
        headers: { 'xi-api-key': key, accept: 'application/json' },
        body: form,
      },
      TRANSCRIBE_TIMEOUT_MS,
    );
    const parsed = await this.parseJson(response, SttResponseSchema);
    return { text: parsed.text };
  }

  /**
   * Live connectivity probe (GET /v1/user) used by `voice:testConnection`.
   * Accepts an unsaved key for a pre-save probe. Throws a sanitized
   * {@link VoiceProviderError} on failure; resolves on success.
   */
  async testConnection(apiKeyOverride?: string): Promise<void> {
    const key = this.resolveKey(apiKeyOverride);
    await this.fetchOk(
      '/v1/user',
      {
        method: 'GET',
        headers: { 'xi-api-key': key, accept: 'application/json' },
      },
      TEST_TIMEOUT_MS,
    );
  }

  /** The stored plaintext key, or throw `auth` when unconfigured/undecryptable. */
  private requireKey(): string {
    const key = this.secretStore.getKey(PROVIDER_ID);
    if (!key) {
      throw new VoiceProviderError(
        'auth',
        PROVIDER_ID,
        'ElevenLabs API key is not configured.',
        RE_ENTER_KEY_REMEDIATION,
      );
    }
    return key;
  }

  /** Prefer an explicit override (pre-save probe), else the stored key. */
  private resolveKey(override?: string): string {
    if (override && override.length > 0) return override;
    return this.requireKey();
  }

  private async fetchOk(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    // `path` carries only voice ids / output-format query — never key material.
    this.logger.debug('[voice-providers] elevenlabs request', { path });
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      // Transport failure / abort / timeout — the raw error may embed request
      // context; funnel it through the chokepoint so nothing leaks.
      throw mapElevenLabsError({ cause: error });
    }
    if (!response.ok) {
      throw await this.toHttpError(response);
    }
    return response;
  }

  /** Read the error body best-effort for categorization only (never forwarded). */
  private async toHttpError(response: Response): Promise<VoiceProviderError> {
    let detail: ElevenLabsErrorDetail;
    try {
      const body: unknown = await response.clone().json();
      const parsed = ErrorBodySchema.safeParse(body);
      if (parsed.success) {
        detail = parsed.data.detail;
      }
    } catch {
      // Body was not JSON / unreadable. It is never forwarded regardless — fall
      // back to status-only categorization.
    }
    return mapElevenLabsError({ status: response.status, detail });
  }

  private async parseJson<T>(
    response: Response,
    schema: ResponseSchema<T>,
  ): Promise<T> {
    const body: unknown = await response.json();
    // Zod throws on drift (R4) — a loud local signal. The response body carries
    // no key material, so a validation error cannot leak the secret.
    return schema.parse(body);
  }

  private async readBytes(response: Response): Promise<Uint8Array> {
    try {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error: unknown) {
      throw mapElevenLabsError({ cause: error });
    }
  }
}
