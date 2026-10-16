/**
 * Ollama readiness probe helpers (decision #42, part A §5).
 *
 * Moved out of `decision-model.config.ts` (FE-12a) with no behaviour change.
 * `DecisionEndpointProber` owns the fetch and the budget, the config class
 * owns the mark; these functions only build URLs and classify answers.
 */
import { z } from 'zod';
import { systemOneUrl } from './decision-endpoint.url';
import {
  OLLAMA_MIN_LAYA_VERSION,
  OLLAMA_MIN_SYSTEM_ONE_VERSION,
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelProbeResult,
  type DecisionModelSelection,
  type DecisionModelState,
} from './decision-model.types';
import { SYSTEM_ONE_PATH } from './system-one.client';

const OLLAMA_VERSION_PATH = '/api/version';
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OllamaVersionSchema = z.object({ version: z.string().min(1) });

export type ProbeAnswer =
  | {
      readonly kind: 'answered';
      readonly status: number;
      readonly body: string;
    }
  | { readonly kind: 'failed'; readonly detail: string };

/** Probe outcome → row state; the row state set is fixed (decision #46). */
export function toRowState(
  outcome: DecisionModelProbeResult['outcome'],
): DecisionModelState {
  switch (outcome) {
    case 'auth':
      return 'no-credential';
    case 'provider-error':
      return 'unreachable';
    default:
      return outcome;
  }
}

/** `null` when the version passes (the POSTs run next); else the probe result. */
export function checkVersion(
  answer: ProbeAnswer,
  model: string,
): DecisionModelProbeResult | null {
  if (answer.kind === 'failed') {
    return { outcome: 'unreachable', detail: answer.detail };
  }
  if (answer.status === 401 || answer.status === 403) {
    return {
      outcome: 'auth',
      detail: `version check answered http ${answer.status}`,
    };
  }
  if (answer.status === 404 || answer.status === 405) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `endpoint does not serve ${OLLAMA_VERSION_PATH}`,
    };
  }
  if (answer.status < 200 || answer.status >= 300) {
    return {
      outcome: 'provider-error',
      detail: `version check answered http ${answer.status}`,
    };
  }
  const parsed = OllamaVersionSchema.safeParse(parseJson(answer.body));
  if (!parsed.success) {
    return {
      outcome: 'provider-error',
      detail: 'version check answered an unreadable body',
    };
  }
  const minimum = model.toLowerCase().startsWith('laya')
    ? OLLAMA_MIN_LAYA_VERSION
    : OLLAMA_MIN_SYSTEM_ONE_VERSION;
  if (!isVersionAtLeast(parsed.data.version, minimum)) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `Ollama ${parsed.data.version} < ${minimum}`,
    };
  }
  return null;
}

/**
 * Route discriminator (decision #42, part A §5). 401/403 and other statuses
 * are not route evidence; otherwise an answer equal to the control's
 * normalised answer is ambiguous and therefore unsupported.
 */
export function discriminate(
  route: ProbeAnswer,
  control: ProbeAnswer,
): DecisionModelProbeResult {
  if (route.kind === 'failed') {
    return { outcome: 'unreachable', detail: route.detail };
  }
  const notFound = route.status === 404 || route.status === 405;
  if (route.status === 401 || route.status === 403) {
    return { outcome: 'auth', detail: `route answered http ${route.status}` };
  }
  const routeSpecific =
    (route.status >= 200 && route.status < 300) ||
    route.status === 400 ||
    route.status === 422;
  if (!routeSpecific && !notFound) {
    return {
      outcome: 'provider-error',
      detail: `route answered http ${route.status}`,
    };
  }
  if (control.kind === 'failed') {
    return notFound
      ? {
          outcome: 'unsupported-endpoint',
          detail: `endpoint does not serve ${SYSTEM_ONE_PATH} (route answered ${route.status}; control request failed: ${control.detail})`,
        }
      : { outcome: 'ready', detail: null };
  }
  const same =
    normaliseAnswer(route.status, route.body, SYSTEM_ONE_PATH) ===
    normaliseAnswer(control.status, control.body, SYSTEM_ONE_CONTROL_PATH);
  if (same) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `endpoint does not serve ${SYSTEM_ONE_PATH}`,
    };
  }
  return notFound
    ? { outcome: 'ready', detail: `route answered ${route.status}` }
    : { outcome: 'ready', detail: null };
}

/**
 * Probe URLs under the base, keeping its path (DC11): `https://host/gw`
 * probes `https://host/gw/v1/systemone`. `null` when the base does not parse.
 */
export function buildProbeUrls(
  baseUrl: string,
): { version: string; route: string; control: string } | null {
  if (!URL.canParse(baseUrl.trim())) {
    return null;
  }
  return {
    version: systemOneUrl(baseUrl, OLLAMA_VERSION_PATH),
    route: systemOneUrl(baseUrl, SYSTEM_ONE_PATH),
    control: systemOneUrl(baseUrl, SYSTEM_ONE_CONTROL_PATH),
  };
}

export function isLocalUrl(baseUrl: string): boolean {
  return (
    URL.canParse(baseUrl) && LOCAL_HOSTNAMES.has(new URL(baseUrl).hostname)
  );
}

export function normaliseBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Coalescing and mark key: canonical selection plus normalised base URL. */
export function keyOf(
  selection: DecisionModelSelection,
  baseUrl: string,
): string {
  return `${canonicalJson(selection)}|${normaliseBaseUrl(baseUrl)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : String(error);
}

/**
 * Status plus body with the request path masked as `<path>`; a JSON body is
 * compared by value (canonical key order), any other body as trimmed text.
 */
function normaliseAnswer(status: number, body: string, path: string): string {
  const masked = body.split(path).join('<path>').trim();
  const json = parseJson(masked);
  const value =
    json === NOT_JSON ? `text:${masked}` : `json:${canonicalJson(json)}`;
  return `${status}\n${value}`;
}

const NOT_JSON: unique symbol = Symbol('not-json');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body is a valid answer here: callers compare it as text or
    // reject it by schema. The sentinel is a unique symbol, never data.
    return NOT_JSON;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Same comparison as `ollama-model-discovery.service.ts:316-327`. */
function isVersionAtLeast(actual: string, minimum: string): boolean {
  const parse = (v: string): number[] =>
    v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(actual);
  const m = parse(minimum);
  for (let i = 0; i < Math.max(a.length, m.length); i++) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
