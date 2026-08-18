/**
 * The JSON dialect shared by four of the five MCP config files, plus the
 * content hash that gives an MCP entry an identity the manifest can own.
 *
 * Carried over from `mcp-config-io.utils.ts` (cli-agent-runtime, deleted in
 * TASK_2026_278 Batch 2). The behaviour is unchanged — same root keys, same
 * `type`-field rule, same transport inference — because these files are read by
 * tools Ptah does not control and any "improvement" here is a compatibility
 * break somewhere else.
 */

import { createHash } from 'crypto';
import type { McpServerConfig } from '@ptah-extension/shared';

/**
 * Serialize a transport config into the shape a config file expects.
 *
 * `includeType` is per-target and not cosmetic: VS Code uses `type` to pick a
 * transport, while Claude, Cursor and Copilot infer it from the presence of
 * `command` versus `url` and treat an unexpected key as a schema error.
 */
export function configToJson(
  config: McpServerConfig,
  includeType: boolean,
): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  if (includeType) json['type'] = config.type;

  switch (config.type) {
    case 'stdio':
      json['command'] = config.command;
      if (config.args !== undefined && config.args.length > 0) {
        json['args'] = config.args;
      }
      break;
    case 'http':
    case 'sse':
      json['url'] = config.url;
      if (
        config.headers !== undefined &&
        Object.keys(config.headers).length > 0
      ) {
        json['headers'] = config.headers;
      }
      break;
  }

  if (config.env !== undefined && Object.keys(config.env).length > 0) {
    json['env'] = config.env;
  }
  return json;
}

/** Parse a raw config-file entry back into a transport config. */
export function jsonToConfig(raw: Record<string, unknown>): McpServerConfig {
  const declaredType = raw['type'];
  const type =
    typeof declaredType === 'string' ? declaredType : inferTransportType(raw);
  const env = asStringRecord(raw['env']);

  if (type === 'stdio') {
    const args = raw['args'];
    return {
      type: 'stdio',
      command: typeof raw['command'] === 'string' ? raw['command'] : '',
      ...(Array.isArray(args)
        ? { args: args.filter((a): a is string => typeof a === 'string') }
        : {}),
      ...(env === undefined ? {} : { env }),
    };
  }

  const headers = asStringRecord(raw['headers']);
  return {
    type: type === 'sse' ? 'sse' : 'http',
    url: typeof raw['url'] === 'string' ? raw['url'] : '',
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
  };
}

function inferTransportType(raw: Record<string, unknown>): string {
  if (typeof raw['command'] === 'string') return 'stdio';
  if (typeof raw['url'] === 'string' && raw['url'].includes('/sse'))
    return 'sse';
  return 'http';
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Content hash of one MCP entry.
 *
 * Keys are sorted at every level so two configs that differ only in property
 * order hash the same; otherwise a reconcile would rewrite the config file on
 * every pass and the "cheap no-op" promise would be false for MCP alone.
 */
export function hashMcpConfig(config: McpServerConfig): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const pairs = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${pairs.join(',')}}`;
}
