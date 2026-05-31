/**
 * Resolves a Smithery server + collected config into a session-time
 * `McpHttpConfig`. Separate from `IMcpRegistrySource` because the official
 * registry has no resolve analog.
 *
 * SECURITY: reads the API key backend-side; NEVER logs the key or built URL.
 */

import type { McpHttpConfig } from '@ptah-extension/shared';
import type { SmitheryRegistrySource } from './smithery-registry.source';
import {
  SmitheryConfigInvalidError,
  SmitheryKeyMissingError,
} from './smithery-errors';
import {
  SMITHERY_DEFAULT_CONNECTION_HOST,
  buildSmitheryUrl,
} from './smithery-wire.constants';

export interface SmitheryResolveInput {
  qualifiedName: string;
  config: Record<string, unknown>;
  profile?: string;
}

export interface SmitheryConnectionResolverOptions {
  /** Override the connection host (for the Batch 0 spike / tests). */
  connectionHost?: string;
}

interface JsonSchemaLike {
  type?: string;
  required?: unknown;
  properties?: Record<string, { type?: string } | undefined>;
}

export class SmitheryConnectionResolver {
  private readonly connectionHost: string;

  constructor(
    private readonly getApiKey: () => Promise<string | null>,
    private readonly registry: SmitheryRegistrySource,
    options?: SmitheryConnectionResolverOptions,
  ) {
    this.connectionHost =
      options?.connectionHost ?? SMITHERY_DEFAULT_CONNECTION_HOST;
  }

  async resolve(input: SmitheryResolveInput): Promise<McpHttpConfig> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new SmitheryKeyMissingError();

    const detail = await this.registry.getServerDetails(input.qualifiedName);
    const configSchema = detail?.connections?.find(
      (c) => c.configSchema,
    )?.configSchema;

    if (configSchema) {
      validateConfigAgainstSchema(input.config, configSchema);
    }

    const built = buildSmitheryUrl({
      connectionHost: this.connectionHost,
      qualifiedName: input.qualifiedName,
      config: input.config,
      apiKey,
      profile: input.profile,
    });

    return {
      type: 'http',
      url: built.url,
      headers:
        Object.keys(built.headers).length > 0 ? built.headers : undefined,
    };
  }
}

/**
 * Lightweight, dependency-free validation: enforces `required` presence and a
 * primitive type match for declared properties. Intentionally permissive —
 * unknown keywords are ignored rather than rejected (third-party schemas may
 * use keywords we do not model). Builds nothing on failure (fail safe).
 */
function validateConfigAgainstSchema(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
): void {
  const s = schema as JsonSchemaLike;

  const required = Array.isArray(s.required)
    ? s.required.filter((r): r is string => typeof r === 'string')
    : [];
  const missing = required.filter(
    (key) => config[key] === undefined || config[key] === null,
  );
  if (missing.length > 0) {
    throw new SmitheryConfigInvalidError(
      `Missing required config field(s): ${missing.join(', ')}`,
    );
  }

  const properties = s.properties ?? {};
  for (const [key, value] of Object.entries(config)) {
    const expectedType = properties[key]?.type;
    if (!expectedType) continue;
    if (!matchesJsonType(value, expectedType)) {
      throw new SmitheryConfigInvalidError(
        `Config field "${key}" must be of type "${expectedType}"`,
      );
    }
  }
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}
