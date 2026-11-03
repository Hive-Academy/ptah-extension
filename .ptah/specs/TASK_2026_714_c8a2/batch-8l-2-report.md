# Batch 8l-2 report — the user's MCP servers natively; D6 strip and notice removed

Written 2026-10-28 by the team-leader (session 20). W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `9b364c658` (`feat(rpc-handlers): attach the user's MCP servers to Codex chat (8l-2)`).

## Executor

In-process `backend-developer` subagent (Claude); same reason as 8l-1c. `git status` after the
subagent: only the 7 declared files.

## Files (R = libs/backend/rpc-handlers/src/lib/chat/)

- `R/codex-host/codex-chat-profile-options.ts` (+ spec): `mcpServerRunning` and
  `mcpServersOverride` are supported keys; `mcpServerNames` removed. `workflowsDisabled`,
  `includePartialMessages`, `thinking`, `outputStyleName` stay stripped.
- `R/codex-host/codex-chat-host-ports.ts` (+ spec): `userMcpServers()` maps every override to a
  Codex http server: name -> `[A-Za-z0-9_-]` with `_`, collision after mapping ->
  `CodexChatMcpServerNameError` (`codex-mcp-server-name-collision`, original names only);
  invalid / non-http(s) URL -> `CodexChatMcpServerUrlError` (`codex-mcp-server-url-invalid`,
  server name only); header values -> `headerReferences` `mcp.<name>.header.<index>`; a URL with
  query, userinfo or hash -> `url` origin+path plus `urlReference` `mcp.<name>.url`. Mapping runs
  before resume and provider resolution. A user `ptah` replaces Ptah's entry. `profile()` returns
  `secrets` only when non-empty. One info log `codex-user-mcp-attached` with names and transports.
  The `codex-user-mcp-not-attached` log is gone.
- `R/session/chat-runtime-profile.service.ts` (+ spec): only the "MCP servers not attached"
  notice line is removed; model and output-style notices stay.
- `R/session/chat-session.native.spec.ts`: real start path through `buildMcpServersOverride` with
  stubbed Smithery (legacy query URL) and OAuth resolvers; profile holds `ptah`, `smithery`,
  `oauth` with references; secrets map holds the three values; nothing secret in profile,
  fingerprint, logs or notice.

Specs cover: headers -> references + secrets; query URL -> urlReference resolved by the real
`buildCodexMcpConfigOverrides` (url and `http_headers` restored); dotted name mapping; collision
error without secrets; invalid and ftp URLs; user `ptah` override; no secrets returned when none;
no secret value in any logger call, profile JSON, fingerprint, resume identity, `metadata.save`
call or broadcast; fingerprint unchanged on resume.

## Verify

`npm run verify -- -p @ptah-extension/rpc-handlers`: `NX 3 tasks: 3 succeeded` (lint, test,
typecheck x 1 project), EXIT 0.

## Findings and decisions (recorded under P8 D13 in decisions.md)

- Resume carries `mcpServerRunning` but no `mcpServersOverride` (`AgentSessionResumeConfig`
  has no such field; chat-session.service.ts ~:1720-1735), so a RESUMED Codex thread gets Ptah
  MCP but not the user's servers. Claude's resume builds no overrides either (only the start path,
  chat-session.service.ts:943-974, calls `buildMcpServersOverride`), so this is parity with
  Claude, not a Codex regression. Kept as is; listed for the P8 re-review / live test.
- An empty header value is skipped (the runtime refuses empty secrets) rather than sent.
- An empty server name is refused by the core profile schema (not a host coded error).

## Risks carried

- The App Server applying thread `config` dotted keys is still UNPROVEN (coordinator probe).
- Whether Codex writes thread config values (secrets) into rollout files is unverified (probe).
