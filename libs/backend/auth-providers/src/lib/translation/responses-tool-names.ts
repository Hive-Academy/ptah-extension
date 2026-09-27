/**
 * Responses tool-name guard: OpenAI rejects any tool name outside
 * `^[a-zA-Z0-9_-]{1,64}$` (for example long `mcp__server.with.dots__tool`
 * names). Invalid names go upstream under a deterministic compliant alias and
 * come back to the SDK under their original name.
 *
 * Pure: the input request is never mutated and nothing is cached across
 * requests. The alias depends only on the original name, so replayed history
 * gets the same alias on every turn without stored state. Library-internal.
 */

import { createHash } from 'node:crypto';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
  ResponsesToolDefinition,
} from './responses-request-translator';

const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const INVALID_TOOL_NAME_CHARS = /[^a-zA-Z0-9_-]/g;
/** 53 sanitized characters + `_` + 10 hex characters = 64, the upstream limit. */
const ALIAS_PREFIX_LENGTH = 53;
const ALIAS_HASH_LENGTH = 10;

/** Two tool names would reach the upstream under the same name. */
export class ResponsesToolNameCollisionError extends Error {
  constructor(public readonly alias: string) {
    super(`Tool name collision after Responses name normalization: ${alias}`);
    this.name = 'ResponsesToolNameCollisionError';
  }
}

export interface GuardedResponsesRequest {
  readonly request: OpenAIResponsesRequest;
  /** Maps an upstream tool name back to the original; unknown names pass through. */
  readonly toOriginalName: (upstream: string) => string;
}

function aliasFor(original: string): string {
  const sanitized = original.replace(INVALID_TOOL_NAME_CHARS, '_');
  // UTF-16LE is lossless for any JS string; UTF-8 would map every lone
  // surrogate to U+FFFD and give distinct originals one alias.
  const digest = createHash('sha256').update(original, 'utf16le').digest('hex');
  return `${sanitized.slice(0, ALIAS_PREFIX_LENGTH)}_${digest.slice(0, ALIAS_HASH_LENGTH)}`;
}

/**
 * Rewrites `tools[].name` and every `function_call` item in `input[]` (history
 * replay) to an upstream-compliant name, in one pass. Valid names are kept.
 *
 * @throws ResponsesToolNameCollisionError when two originals produce one alias,
 * or when an alias equals another tool's original name.
 */
export function guardResponsesToolNames(
  request: OpenAIResponsesRequest,
): GuardedResponsesRequest {
  // original -> upstream name; also memoises so each distinct invalid name is hashed once.
  const upstreamByOriginal = new Map<string, string>();
  const originalByAlias = new Map<string, string>();

  const upstreamName = (original: string): string => {
    const known = upstreamByOriginal.get(original);
    if (known !== undefined) return known;
    if (VALID_TOOL_NAME.test(original)) {
      upstreamByOriginal.set(original, original);
      return original;
    }
    const alias = aliasFor(original);
    if (originalByAlias.has(alias))
      throw new ResponsesToolNameCollisionError(alias);
    upstreamByOriginal.set(original, alias);
    originalByAlias.set(alias, original);
    return alias;
  };

  const tools = request.tools?.map((tool): ResponsesToolDefinition => {
    const name = upstreamName(tool.name);
    return name === tool.name ? tool : { ...tool, name };
  });
  const input = request.input.map((item): ResponsesInputItem => {
    if (!('type' in item) || item.type !== 'function_call') return item;
    const name = upstreamName(item.name);
    return name === item.name ? item : { ...item, name };
  });

  // An alias is always valid, so it can only clash with a valid original.
  // Checked after the pass because that original may appear after the alias.
  for (const alias of originalByAlias.keys()) {
    if (upstreamByOriginal.has(alias))
      throw new ResponsesToolNameCollisionError(alias);
  }

  return {
    request: { ...request, input, ...(tools ? { tools } : {}) },
    toOriginalName: (upstream) => originalByAlias.get(upstream) ?? upstream,
  };
}
