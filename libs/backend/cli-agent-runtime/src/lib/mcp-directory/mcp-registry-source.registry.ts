/**
 * Registry of MCP registry sources.
 *
 * Holds a `Map<McpRegistrySourceId, IMcpRegistrySource>` so the RPC layer can
 * select a source by id (e.g. the `source` param on `mcpDirectory:search`).
 * Sources register themselves once at construction; `get(id)` resolves them.
 */

import type {
  IMcpRegistrySource,
  McpRegistrySourceId,
} from './mcp-registry-source.interface';

export class McpRegistrySourceRegistry {
  private readonly sources = new Map<McpRegistrySourceId, IMcpRegistrySource>();

  /**
   * Register a source under its own `id`. A later registration with the same
   * id replaces the earlier one.
   */
  register(source: IMcpRegistrySource): void {
    this.sources.set(source.id, source);
  }

  /** Resolve a source by id, or `undefined` if none is registered. */
  get(id: McpRegistrySourceId): IMcpRegistrySource | undefined {
    return this.sources.get(id);
  }

  /** Whether a source is registered for the given id. */
  has(id: McpRegistrySourceId): boolean {
    return this.sources.has(id);
  }

  /** All registered sources, in insertion order. */
  list(): IMcpRegistrySource[] {
    return [...this.sources.values()];
  }
}
