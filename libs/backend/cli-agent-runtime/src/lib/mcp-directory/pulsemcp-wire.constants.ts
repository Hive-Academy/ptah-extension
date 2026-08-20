/**
 * PulseMCP registry wire constants.
 *
 * PulseMCP (https://www.pulsemcp.com) is a trusted online MCP directory that
 * indexes vendor/community servers (e.g. Autodesk, IFC, Procore) that are NOT
 * present in the official MCP registry or Smithery. The public list/search API
 * requires NO API key.
 *
 * Mirrors `smithery-wire.constants.ts` — base URL, page size, cache TTL, and
 * request timeout live here so the source file stays focused on fetch/map logic
 * and the base URL is overridable for tests.
 */

/** Public PulseMCP API base (v0 beta). No API key required. */
export const PULSEMCP_DEFAULT_REGISTRY_BASE = 'https://api.pulsemcp.com/v0beta';

/** Default page size for listing servers. */
export const PULSEMCP_DEFAULT_PAGE_SIZE = 20;

/** Cache TTL for popular servers (10 minutes), matching the other sources. */
export const PULSEMCP_CACHE_TTL_MS = 10 * 60 * 1000;

/** HTTP request timeout (15 seconds), matching the other sources. */
export const PULSEMCP_REQUEST_TIMEOUT_MS = 15_000;

/** PulseMCP pagination is offset-based; the first page starts at offset 0. */
export const PULSEMCP_FIRST_OFFSET = 0;
