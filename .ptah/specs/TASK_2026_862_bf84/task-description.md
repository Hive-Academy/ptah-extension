# Task description: use the user's Codex binary

## Objective

Electron chat, Electron lanes, and CLI/TUI lanes should use the user's installed Codex when it meets a single minimum version, regardless of OS. The bundled binary remains the fallback. New models supplied by Codex must be runnable without a Ptah release or a rate-card update.

## In scope

- A host-neutral, installed-first executable selector shared by all Codex entry points, including the default lane probe; PATH and common install locations on Windows, macOS and Linux; Windows npm shims resolved to a native executable before spawn; version probing with a timeout. Use one minimum version, **0.165.0**, including account model discovery. Re-select and re-read the version on each new runtime open, with no long-lived selection cache. Keep the same Codex home for installed and bundled processes.
- Remove exact SHA, exact-version and platform pin checks, the parity gate, dev-route flag, packaged-platform admission and dead evidence code. Keep session-level `RuntimeAdmissionPort`, Codex home verification and security validation.
- Tolerate additive inbound protocol fields, unknown notifications, unknown model identifiers and new optional enum values. Identify missing required methods by JSON-RPC `-32601` at first use; fall back once from installed to bundled when safe. Keep outbound request validation and malformed core-envelope rejection.
- Dynamic `model/list` catalogs for chat, lanes and provider discovery. Accept partial entries with `id`/`model`; normalize missing display name to `model`, default flag to false and efforts to `[]` in both chat and lane consumers. Remove release-maintained lane defaults/fallback model IDs and provider ID filters; allow user-specified future model IDs through to Codex. Unknown rates yield tokens and a visible “Not priced” cost state.
- Surface source, version and reason in existing Codex status/settings UI and lane detection through a host-scoped selection snapshot port; preserve Codex login/subscription through the existing `CODEX_HOME` and auth flow.
- Grouped automatic updates for the Codex SDK, CLI and six platform packages, with review of the exact-text SDK patch.
- Unit and integration tests for selection, version parsing, fallback, protocol tolerance, model discovery, auth home and unknown-model pricing. Update Electron DI and RPC surface guards when contracts change.

## Out of scope

- A new Codex UI screen, a live paid Codex turn, a broader provider rewrite, unrelated Plan Limits/usage follow-ups and `tools/mcp-bench`.
- Adding a VS Code host absent from this worktree. If that host reappears, it should consume the same selector and contracts.
- Running builds, tests or package installation during this planning task.

## Reviewer-checkable acceptance criteria

1. With a valid installed Codex at or above 0.165.0, all host entry points choose it and report its version/source/reason. A 0.165.0 prerelease is below the stable floor; a prerelease with a higher numeric version is accepted. With an old, malformed, inaccessible or missing install, they choose a valid bundled binary and explain why. A new runtime open detects an in-place upgrade. If both are unusable, the user sees a version/path-safe actionable error.
2. Windows x64/ARM64, macOS x64/ARM64 and Linux x64/ARM64 no longer depend on a win32/x64 SHA row, a parity flag, packaging state or `PTAH_CODEX_RUNTIME_DEV`. The installed process path is a real native executable, not an npm `.cmd`/JavaScript shim.
3. A newer compatible Codex with extra fields, unknown notifications, new models and optional enum values can initialize, list models and run turns. An unknown server request with additive envelope fields still receives a method-not-found reply. A missing required method yields a named capability error and exactly one safe bundled retry when recognized as JSON-RPC `-32601`; other error codes remain terminal until classified by a live check. Malformed required data still fails clearly.
4. A future model returned by `model/list` appears in the catalog; an arbitrary requested model reaches Codex unchanged. Discovery failure shows an explicit unavailable state instead of seven stale models. Unknown rate-card ID retains token counts and displays “Not priced” with null cost, never zero.
5. Both selected binary sources use the same authenticated `CODEX_HOME` (default `~/.codex`) and preserve existing home-mismatch protection. Tests cover OAuth/subscription and API-key paths without reading real credentials.
6. Dependency automation groups Codex updates in the relevant manifests; a routine bump does not require editing a SHA row, generated pin or platform admission list. Scoped CI catches patch drift. Agent SDK and CLI DI guard specs compile after the gate/token cleanup.

## Risks and controls

- **Handshake cannot enumerate every supported method:** `initialize` plus an early `model/list` probe verifies read capability; other required methods are checked on their first `-32601` response. Retry only before any turn side effect and close the failed process.
- **Unknown method reply code may differ from `-32601`:** until a live Codex check confirms that response, treat other codes as terminal method failures with a clear message; do not replay an uncertain turn.
- **New inbound shapes can carry invalid core data:** allow unknown optional data but retain required IDs, numeric usage and framing checks. Skip malformed individual catalog entries with bounded, redacted diagnostics.
- **Installed executable may change between selection and spawn:** avoid SHA admission but retain path existence/executable checks, a bounded version probe and process-start failure handling; report the source actually launched.
- **Installed executable may upgrade in place:** selection and version are refreshed for each new runtime open; the active open retains its selected version only until it closes or safely falls back.
- **Auth divergence:** do not switch home based on binary location; retain `CODEX_HOME` propagation and response-home verification.
- **SDK patch drift on automated bump:** the current Windows hide patch matches exact SDK text/version. A grouped bump requires patch review and scoped typecheck; automation must not auto-merge it.
- **Static provider defaults may be referenced elsewhere:** remove only execution/catalog filtering and inspect tier fallback behavior before deleting static entries; retain user-configured tier selections.
