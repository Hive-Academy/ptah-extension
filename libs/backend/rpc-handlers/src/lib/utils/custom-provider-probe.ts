/**
 * Real connection probe for USER-DEFINED provider entries (TASK_2026_236, C3).
 *
 * ## Why this exists
 *
 * `auth:testConnection` does not make a network call at all — it polls
 * `SdkAgentAdapter.getHealth()`, which reflects local SDK-adapter init state.
 * That is a tolerable gap for the eight built-in providers whose base URLs ship
 * in Ptah's own source. It is NOT tolerable once the base URL is typed by the
 * user: a typo, an unreachable LAN box, or something that is not an LLM gateway
 * at all would all report "connected" and then fail on the first chat turn.
 *
 * ## Why a TOOL call and not `GET /v1/models`
 *
 * A models listing proves only that something answers HTTP. Every agent turn
 * depends on tool calling, and a gateway that happily returns a model list
 * while ignoring the `tools` field fails 100% of real turns. So the probe sends
 * one minimal request WITH a trivial tool definition and a forced tool choice,
 * then asserts the response actually contains the tool call. That specific
 * failure — "responded but did not honour the tool definition" — is the whole
 * point of the probe.
 *
 * ## Scope
 *
 * Custom entries ONLY. `auth:testConnection` behaviour for built-in providers
 * is deliberately untouched (plan.md decision 1).
 */

import {
  validateProviderBaseUrl,
  type CustomProviderEntry,
} from '@ptah-extension/shared';

/** Default budget for the whole probe, per plan.md decision 1 (~10s). */
export const CUSTOM_PROVIDER_PROBE_TIMEOUT_MS = 10_000;

/** The tool the endpoint is asked to call. Trivial on purpose. */
const PROBE_TOOL_NAME = 'ptah_connection_probe';
const PROBE_TOOL_DESCRIPTION =
  'Connectivity probe. Call this tool once with ok=true.';
const PROBE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'Always true.' },
  },
  required: ['ok'],
} as const;

const PROBE_PROMPT = 'Call the ptah_connection_probe tool with ok set to true.';

/**
 * Stable failure classification.
 *
 * Separate from the human message so tests can assert the CLASS of failure
 * without pinning prose, and so future telemetry has something to group on.
 */
export type CustomProviderProbeFailure =
  | 'invalid-base-url'
  | 'no-model'
  | 'timeout'
  | 'dns'
  | 'unreachable'
  | 'tls'
  | 'unauthorized'
  | 'not-found'
  | 'rejected-request'
  | 'server-error'
  | 'malformed-response'
  | 'no-tool-support'
  | 'unknown';

export interface CustomProviderProbeResult {
  readonly ok: boolean;
  /** Specific and actionable — this string is shown to the user verbatim. */
  readonly message: string;
  /** Round-trip time of the probe request; absent when no request was made. */
  readonly latencyMs?: number;
  /** Absent on success. */
  readonly failure?: CustomProviderProbeFailure;
}

/** The slice of `fetch` this module uses — injectable so tests need no network. */
export type ProbeFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<ProbeResponse>;

/** The slice of `Response` this module reads. */
export interface ProbeResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface ProbeOptions {
  /** Overall budget in ms. Defaults to {@link CUSTOM_PROVIDER_PROBE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: ProbeFetch;
  /** Injected for tests so latency assertions are deterministic. */
  readonly now?: () => number;
}

/**
 * Run one real round-trip through the entry's declared lane.
 *
 * @param entry  - the user-defined entry, already validated by its schema.
 * @param apiKey - key from SecretStorage. When absent the request is sent
 *   unauthenticated, so a gateway that requires a key answers 401 and the user
 *   gets told the key is missing rather than a generic failure.
 */
export async function probeCustomProvider(
  entry: CustomProviderEntry,
  apiKey: string | undefined,
  options: ProbeOptions = {},
): Promise<CustomProviderProbeResult> {
  const baseUrl = validateProviderBaseUrl(entry.baseUrl);
  if (!baseUrl.ok) {
    return {
      ok: false,
      failure: 'invalid-base-url',
      message: `${entry.name}: ${baseUrl.error}`,
    };
  }

  const timeoutMs = options.timeoutMs ?? CUSTOM_PROVIDER_PROBE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const now = options.now ?? (() => Date.now());

  const deadline = now() + timeoutMs;

  const model = await resolveProbeModel(
    entry,
    baseUrl.normalized,
    apiKey,
    fetchImpl,
    Math.max(1, deadline - now()),
  );
  if (!model.ok) {
    return { ok: false, failure: 'no-model', message: model.message };
  }

  const request =
    entry.lane === 'anthropic'
      ? buildAnthropicRequest(baseUrl.normalized, entry, apiKey, model.modelId)
      : buildOpenAiRequest(baseUrl.normalized, entry, apiKey, model.modelId);

  const startedAt = now();
  let response: ProbeResponse;
  try {
    response = await withTimeout(
      (signal) =>
        fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal,
        }),
      Math.max(1, deadline - now()),
    );
  } catch (error: unknown) {
    return {
      ...classifyTransportError(error, entry, request.url, timeoutMs),
      latencyMs: now() - startedAt,
    };
  }
  const latencyMs = now() - startedAt;

  const bodyText = await safeText(response);

  if (!response.ok) {
    return {
      ...classifyHttpStatus(response.status, entry, request.url, bodyText),
      latencyMs,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      failure: 'malformed-response',
      latencyMs,
      message:
        `${entry.name} answered ${request.url} with HTTP ${response.status} but the body was not JSON. ` +
        `That usually means the base URL points at a web page or a proxy, not an LLM API.`,
    };
  }

  const honoured =
    entry.lane === 'anthropic'
      ? anthropicHonouredTool(parsed)
      : openAiHonouredTool(parsed);

  if (!honoured) {
    return {
      ok: false,
      failure: 'no-tool-support',
      latencyMs,
      message:
        `${entry.name} responded, but ignored the tool definition — no tool call came back for '${PROBE_TOOL_NAME}'. ` +
        `Every Ptah turn depends on tool calling, so this endpoint will fail on the first real message. ` +
        (entry.lane === 'openai'
          ? `If this is a self-hosted vLLM server, start it with --enable-auto-tool-choice and a --tool-call-parser.`
          : `Check that the gateway forwards the 'tools' field on /v1/messages instead of stripping it.`),
    };
  }

  return {
    ok: true,
    latencyMs,
    message: `${entry.name} answered a tool call on model '${model.modelId}' in ${latencyMs}ms.`,
  };
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

interface ProbeRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Auth header for the entry.
 *
 * `authEnvVar` is the same discriminator the registry already uses:
 * `ANTHROPIC_API_KEY` → `x-api-key`, `ANTHROPIC_AUTH_TOKEN` → `Bearer`.
 */
function authHeaders(
  entry: CustomProviderEntry,
  apiKey: string | undefined,
): Record<string, string> {
  if (!apiKey) return {};
  if (entry.lane === 'anthropic' && entry.authEnvVar === 'ANTHROPIC_API_KEY') {
    return { 'x-api-key': apiKey };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function buildAnthropicRequest(
  baseUrl: string,
  entry: CustomProviderEntry,
  apiKey: string | undefined,
  model: string,
): ProbeRequest {
  return {
    url: joinUrl(baseUrl, 'v1/messages'),
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...authHeaders(entry, apiKey),
    },
    body: {
      model,
      max_tokens: 64,
      tools: [
        {
          name: PROBE_TOOL_NAME,
          description: PROBE_TOOL_DESCRIPTION,
          input_schema: PROBE_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: PROBE_TOOL_NAME },
      messages: [{ role: 'user', content: PROBE_PROMPT }],
    },
  };
}

function buildOpenAiRequest(
  baseUrl: string,
  entry: CustomProviderEntry,
  apiKey: string | undefined,
  model: string,
): ProbeRequest {
  return {
    url: joinUrl(baseUrl, 'v1/chat/completions'),
    headers: {
      'content-type': 'application/json',
      ...authHeaders(entry, apiKey),
    },
    body: {
      model,
      max_tokens: 64,
      tools: [
        {
          type: 'function',
          function: {
            name: PROBE_TOOL_NAME,
            description: PROBE_TOOL_DESCRIPTION,
            parameters: PROBE_TOOL_SCHEMA,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: PROBE_TOOL_NAME } },
      messages: [{ role: 'user', content: PROBE_PROMPT }],
    },
  };
}

// ---------------------------------------------------------------------------
// Response inspection
// ---------------------------------------------------------------------------

/** Anthropic Messages: a `tool_use` content block naming the probe tool. */
function anthropicHonouredTool(parsed: unknown): boolean {
  const content = readPath(parsed, ['content']);
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      readPath(block, ['type']) === 'tool_use' &&
      readPath(block, ['name']) === PROBE_TOOL_NAME,
  );
}

/** OpenAI chat-completions: a `tool_calls` entry naming the probe tool. */
function openAiHonouredTool(parsed: unknown): boolean {
  const choices = readPath(parsed, ['choices']);
  if (!Array.isArray(choices)) return false;
  return choices.some((choice) => {
    const calls = readPath(choice, ['message', 'tool_calls']);
    if (!Array.isArray(calls)) return false;
    return calls.some(
      (call) => readPath(call, ['function', 'name']) === PROBE_TOOL_NAME,
    );
  });
}

/** Safe nested property read — the response body is untrusted. */
function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

type ModelResolution =
  | { ok: true; modelId: string }
  | { ok: false; message: string };

/**
 * Pick a model id to probe with.
 *
 * Preference order: the entry's own tier mapping (cheapest tier first, since
 * the user pays for this round-trip), then the first id from the endpoint's
 * model listing. If neither yields anything there is nothing meaningful to
 * send, and saying so is more useful than sending a guessed slug that 404s.
 */
async function resolveProbeModel(
  entry: CustomProviderEntry,
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: ProbeFetch,
  budgetMs: number,
): Promise<ModelResolution> {
  const tiers = entry.defaultTiers;
  const fromTiers = tiers?.haiku || tiers?.sonnet || tiers?.opus;
  if (fromTiers) return { ok: true, modelId: fromTiers };

  const modelsUrl = entry.modelsEndpoint || joinUrl(baseUrl, 'v1/models');
  try {
    const response = await withTimeout(
      (signal) =>
        fetchImpl(modelsUrl, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...authHeaders(entry, apiKey),
          },
          signal,
        }),
      budgetMs,
    );
    if (!response.ok) {
      return {
        ok: false,
        message:
          `${entry.name}: no model is mapped to a tier, and ${modelsUrl} returned HTTP ${response.status}. ` +
          `Map a model to the Sonnet tier (or fix the models endpoint) and test again.`,
      };
    }
    const parsed: unknown = JSON.parse(await response.text());
    const data = readPath(parsed, ['data']);
    const first = Array.isArray(data) ? readPath(data[0], ['id']) : undefined;
    if (typeof first === 'string' && first.length > 0) {
      return { ok: true, modelId: first };
    }
    return {
      ok: false,
      message:
        `${entry.name}: no model is mapped to a tier, and ${modelsUrl} returned no usable model ids. ` +
        `Map a model to the Sonnet tier and test again.`,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        `${entry.name}: no model is mapped to a tier, and the model list at ${modelsUrl} could not be read (${describeError(error)}). ` +
        `Map a model to the Sonnet tier and test again.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/** Node's TLS failures surface as these `code` values on the error cause. */
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'EPROTO',
]);

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

const UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

/**
 * Turn a thrown transport error into a specific, actionable message.
 *
 * Node's `fetch` wraps the real cause: the thrown value is a bland
 * `TypeError: fetch failed` and the `code` that says WHY lives on
 * `error.cause` (sometimes nested further). Reading only the top-level message
 * is exactly how a TLS failure ends up reported as "network error".
 */
export function classifyTransportError(
  error: unknown,
  entry: CustomProviderEntry,
  url: string,
  timeoutMs: number,
): CustomProviderProbeResult {
  if (isAbortError(error)) {
    return {
      ok: false,
      failure: 'timeout',
      message: `${entry.name} did not respond within ${Math.round(timeoutMs / 1000)}s at ${url}. The host may be slow, firewalled, or the wrong address.`,
    };
  }

  const code = findErrorCode(error);

  if (code && TLS_ERROR_CODES.has(code)) {
    return {
      ok: false,
      failure: 'tls',
      message: `${entry.name}: TLS handshake failed for ${url} (${code}). The certificate is invalid, expired, or does not match the host. Use http:// for a plain-HTTP LAN gateway, or fix the certificate.`,
    };
  }

  if (code && DNS_ERROR_CODES.has(code)) {
    return {
      ok: false,
      failure: 'dns',
      message: `${entry.name}: the host in ${url} could not be resolved (${code}). Check the base URL for a typo.`,
    };
  }

  if (code && UNREACHABLE_ERROR_CODES.has(code)) {
    return {
      ok: false,
      failure: 'unreachable',
      message: `${entry.name}: could not connect to ${url} (${code}). Check the host is running and reachable from this machine, including the port.`,
    };
  }

  return {
    ok: false,
    failure: 'unknown',
    message: `${entry.name}: the request to ${url} failed (${describeError(error)}).`,
  };
}

/** Map an HTTP status onto the specific thing the user has to fix. */
export function classifyHttpStatus(
  status: number,
  entry: CustomProviderEntry,
  url: string,
  bodyText: string,
): CustomProviderProbeResult {
  const detail = summariseBody(bodyText);

  if (status === 401 || status === 403) {
    return {
      ok: false,
      failure: 'unauthorized',
      message: `${entry.name} rejected the API key (HTTP ${status} at ${url}). Re-enter the key from ${entry.helpUrl || 'the provider dashboard'}${detail}`,
    };
  }

  if (status === 404) {
    return {
      ok: false,
      failure: 'not-found',
      message: `${entry.name}: ${url} returned HTTP 404. The base URL is probably wrong — check whether the provider's endpoint already includes a version segment such as /v1${detail}`,
    };
  }

  if (status >= 500) {
    return {
      ok: false,
      failure: 'server-error',
      message: `${entry.name} returned HTTP ${status} at ${url}. The endpoint is reachable but failing on its own side${detail}`,
    };
  }

  return {
    ok: false,
    failure: 'rejected-request',
    message: `${entry.name} rejected the probe request with HTTP ${status} at ${url}. The endpoint answered but did not accept a request carrying a tool definition${detail}`,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Join a base URL with a path without producing `/v1/v1/...`.
 *
 * Real entries land on both sides of this: Requesty's base is
 * `https://router.requesty.ai` while Sakana's is `https://api.sakana.ai/v1`.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  if (suffix.startsWith('v1/') && base.endsWith('/v1')) {
    return `${base}/${suffix.slice('v1/'.length)}`;
  }
  return `${base}/${suffix}`;
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const defaultFetch: ProbeFetch = (input, init) =>
  (globalThis.fetch as unknown as ProbeFetch)(input, init);

async function safeText(response: ProbeResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Walk the `cause` chain looking for the `code` that explains the failure. */
function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error || typeof current === 'object') {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return undefined;
}

function describeError(error: unknown): string {
  const code = findErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}

/** Append a short, truncated slice of the error body — never the whole thing. */
function summariseBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) return '.';
  const clipped = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  return `. Response: ${clipped}`;
}
