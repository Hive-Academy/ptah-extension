/**
 * TranslationProxyBase helpers — stateless HTTP/JSON utilities.
 *
 * Extracted from `translation-proxy-base.ts` as .
 *
 * These helpers have no instance dependencies; the translation proxy class
 * continues to own the HTTP server, auth flow, and request counter.
 * Library-internal module.
 */

import * as http from 'http';
import { z } from 'zod';

const responsesUsageSchema = z.object({
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
  input_tokens_details: z.object({
    cached_tokens: z.number().nonnegative().optional(),
  }).nullish(),
}).nullish();

/** Responses input includes cache hits; Anthropic input excludes them.
 * Output already includes reasoning tokens, so never add reasoning details.
 */
export function translateResponsesUsage(value: unknown): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
} {
  const usage = responsesUsageSchema.parse(value);
  const input = usage?.input_tokens ?? 0;
  const cached = usage?.input_tokens_details?.cached_tokens;
  const cacheRead = Math.min(input, cached ?? 0);
  return {
    input_tokens: input - cacheRead,
    output_tokens: usage?.output_tokens ?? 0,
    ...(cached !== undefined ? { cache_read_input_tokens: cacheRead } : {}),
  };
}

/** Maximum request body size (50 MB) */
export const MAX_BODY_SIZE = 50 * 1024 * 1024;

/**
 * Read the full body of an incoming HTTP request.
 *
 * Rejects with a size-limit error if the body exceeds MAX_BODY_SIZE.
 */
export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response with optional extra headers.
 */
export function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
    ...extraHeaders,
  });
  res.end(json);
}

/**
 * Send an Anthropic-format error response with optional extra headers.
 */
export function sendErrorResponse(
  res: http.ServerResponse,
  statusCode: number,
  errorType: string,
  message: string,
  extraHeaders?: Record<string, string>,
): void {
  sendJson(
    res,
    statusCode,
    {
      type: 'error',
      error: {
        type: errorType,
        message,
      },
    },
    extraHeaders,
  );
}

/**
 * Build the full upstream URL by joining the base endpoint and path.
 *
 * Unlike `new URL(path, base)` which replaces the base path when path starts
 * with '/', this method properly concatenates them:
 *   'https://api.openai.com/v1' + '/responses' → 'https://api.openai.com/v1/responses'
 */
export function buildUpstreamUrl(baseEndpoint: string, path: string): URL {
  const base = baseEndpoint.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return new URL(`${base}/${suffix}`);
}

/**
 * Safely parse JSON, returning the parsed value or an empty object on failure.
 */
export function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
