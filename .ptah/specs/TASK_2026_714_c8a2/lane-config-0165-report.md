# Binary version

`codex-cli 0.165.0`

# Model

GPT-6 (Codex agent); exact model ID unknown.

# Config keys set by the builder

`agents.enabled`
`features.plugins`
`features.apps`
`skills.include_instructions`
`model_auto_compact_token_limit`
`tool_output_token_limit`
`web_search`
`approval_policy`
`model_reasoning_effort`
`mcp_servers`
`mcp_servers.ptah.url`
`mcp_servers.ptah.tool_timeout_sec`
`developer_instructions`

# Start-up warnings

None seen about unknown, rejected, or ignored config keys.

# Ptah MCP tools

Yes.

# Result

Codex CLI 0.165.0 is present. The builder marks only 0.155 and 0.160 as verified versions, so it would warn that 0.165.0 is outside that list. Conditional keys above depend on builder input.

# Coordinator check (session 24)

- Lane: codex, model `gpt-6-sol`, effort low, spawned by the coordinator from W.
- The lane stdout and stderr (read with `ptah_agent_read`) have no config rejection, unknown key
  or ignored key line. The lane called `ptah_agent_report` with success, so the
  `mcp_servers.ptah.*` keys were accepted by codex-cli 0.165.0.
- Decision: add `0.165` to `CODEX_VERIFIED_VERSIONS`.
