# Decisions — TASK_2026_859_b561

| # | Decision | Evidence | Ladder step |
|---|----------|----------|-------------|
| D1 | Type BUGFIX, depth Partial; no `ptah_route_decide` pre-flight call (no Routing reminder; user stated type explicitly) | User request prefix "BUGFIX:" | 1 evidence |
| D2 | Lanes `enabled`, approval mode `lane-review`; code-logic review on codex (OpenAI family) | Memory "use installed CLI lanes proactively, subagents as fallback/reviewers"; codex confirmed room | 1 evidence |
| D3 | Install-source priority keeps today's order: stdio package (npm → pypi → oci → nuget) first, then remote streamable-http, then remote sse. No behavior change in priority, only schema. | Current `generateConfig` in component.ts:576 and apps/ptah-cli mcp.ts:396 both use package-first; research left the order open (research-report §Disagreements) | 1 evidence |
| D4 | One pure mapper `registryEntryToInstallConfig` (+ coded error result) in `libs/shared`, used by the frontend component and `apps/ptah-cli/src/cli/commands/mcp.ts`; remove both duplicated `generateConfig` copies | research-report: duplicated old-shape logic in two places; the shared type change breaks the CLI host compile anyway (CLAUDE.md: keep every host compiling) | 1 evidence |
| D5 | Use list items (`version=latest` returns full server.json) for auto-detect; detail fetch uses `/v0.1/servers/{encodeURIComponent(name)}/versions/latest` | research-report Evidence rows 19, 25, 28 | 1 evidence |
| D6 | Fix pagination key `metadata.nextCursor` (part of fetch/parse path) | research-report L83 | 1 evidence |
| D7 | Unsupported shapes return coded errors: `MCP_REGISTRY_SHAPE_UNKNOWN` (schema parse failure), `MCP_NO_INSTALL_SOURCE`, `MCP_PACKAGE_TYPE_UNSUPPORTED` (mcpb, cargo, …), `MCP_PACKAGE_TRANSPORT_UNSUPPORTED` (package + http/sse). UI shows a user-safe message per code instead of "Could not auto-detect configuration". | User goal 4; research-report Options table | 1 evidence |
| D8 | Required env vars / headers / URL `{var}` without a value are surfaced as required inputs on the config result (names + description + isSecret), not as failure. Secrets are never logged. How the UI collects them stays inside existing detect/config preview code; no install-scope changes. | research-report L67; user constraint "do not touch install-scope code" | 1 evidence |
| D9 | `args` built as arrays, never shell strings; `runtimeHint` honored only from allowlist {npx, uvx, docker, dnx}, else per-registryType default | schema Argument command-injection warning; research-report L52, L71 | 1 evidence |
| D10 | Before screenshots: reuse TASK_2026_853 Phase D finding-8 evidence (same `main` code path, unchanged since) | Phase D visual-review-phase-d.md finding 8 | 1 evidence |
