/**
 * Per-method RPC timeout budget for the marketplace surfaces (skills.sh, MCP
 * registry / Smithery, external plugin marketplaces).
 *
 * Each value is the backend's worst case (per-request limit × sequential
 * requests or retry attempts) plus a margin, so the webview never gives up
 * while the backend is still working and would go on to succeed. The
 * ClaudeRpcService default of 30s is shorter than every one of these.
 *
 * - SKILL_INSTALL_MS: one `npx skills add` run (a full GitHub clone), capped
 *   at 120s by the backend, plus the local adopt/propagate steps.
 * - SKILL_SEARCH_MS: the skills.sh API makes up to 3 attempts of 30s with
 *   1.2s of backoff, then a 6s description probe; if the API still fails the
 *   handler falls back to a 15s `npx skills find`.
 * - SKILL_POPULAR_MS: one 15s `npx skills find` plus a local status read.
 * - MCP_SINGLE_REQUEST_MS: one MCP registry or Smithery request (30s, no
 *   retry) — search, popular, details, resolve, account, uninstall.
 * - MCP_TWO_REQUEST_MS: two sequential Smithery requests (namespace lookup,
 *   then the connection call) — installSmithery, listSmitheryConnections,
 *   openSmitherySetup, smitheryConnectionStatus.
 * - PLUGIN_MANIFEST_MS: one GitHub request (60s) for a marketplace manifest —
 *   add and browse.
 * - PLUGIN_INSTALL_MS: plan = manifest + repository tree + one batch of up to
 *   10 parallel file downloads, three sequential 60s GitHub requests. A plugin
 *   with more than 10 files, or a repository whose HEAD tree 404s, makes more
 *   requests; this budget covers the common case, not an unbounded one.
 * - OAUTH_CONNECT_MS: mcpDirectory:connectOAuth is bounded by the backend at
 *   45s (discovery + client registration deadline) + 5 min (browser sign-in
 *   callback) + 15s (token exchange) = 360s, plus a 30s margin.
 */
export const MARKETPLACE_RPC_TIMEOUTS = {
  SKILL_INSTALL_MS: 150_000,
  SKILL_SEARCH_MS: 135_000,
  SKILL_POPULAR_MS: 45_000,
  MCP_SINGLE_REQUEST_MS: 45_000,
  MCP_TWO_REQUEST_MS: 75_000,
  PLUGIN_MANIFEST_MS: 90_000,
  PLUGIN_INSTALL_MS: 210_000,
  OAUTH_CONNECT_MS: 390_000,
} as const;
