/**
 * Provider base-URL validation — the ONE scheme check.
 *
 * Extracted verbatim from the inline block that `llm:setProviderBaseUrl`
 * carried (`libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts`)
 * so the user-defined-provider path (TASK_2026_236) applies exactly the same
 * rule instead of a second, drifting copy.
 *
 * What it checks, and deliberately nothing more:
 *   - the string parses as a URL,
 *   - the scheme is `http:` or `https:`.
 *
 * Known, documented gaps (plan.md decision 1, "Base-URL validation"):
 *   - NO loopback/LAN restriction. Self-hosted vLLM and LiteLLM boxes are a
 *     stated use case and are routinely on a LAN IP rather than 127.0.0.1.
 *   - NO redirect-chain following and NO SSRF hardening. Building speculative
 *     SSRF protection was explicitly deferred; this comment is the record that
 *     the gap is known rather than overlooked.
 */

/** A rejected base URL, with the message that should reach the user verbatim. */
export interface InvalidProviderBaseUrl {
  readonly ok: false;
  readonly error: string;
}

/** An accepted base URL plus its parsed form, so callers skip a second parse. */
export interface ValidProviderBaseUrl {
  readonly ok: true;
  readonly url: URL;
  /** The input with surrounding whitespace removed — persist THIS, not the raw input. */
  readonly normalized: string;
}

export type ProviderBaseUrlValidation =
  | ValidProviderBaseUrl
  | InvalidProviderBaseUrl;

/**
 * Validate a provider base URL.
 *
 * @param value - raw user input; leading/trailing whitespace is tolerated.
 */
export function validateProviderBaseUrl(
  value: string | undefined | null,
): ProviderBaseUrlValidation {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'baseUrl must not be empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `baseUrl is not a valid URL: ${trimmed}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `baseUrl must use http(s) scheme (got '${parsed.protocol}')`,
    };
  }

  return { ok: true, url: parsed, normalized: trimmed };
}

/** Convenience predicate for Zod refinements. */
export function isValidProviderBaseUrl(value: string): boolean {
  return validateProviderBaseUrl(value).ok;
}
