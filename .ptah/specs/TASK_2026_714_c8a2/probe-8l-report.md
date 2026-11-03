# Probe after Round 8l (2026-10-28, head def0ac005 + probe `--mcp` option)

Command (from W, no model turn, free):
`npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --model gpt-5.6-luna [--no-user-mcp | --mcp]`

| Variant | Result |
| --- | --- |
| base | OK open + close, thread 01a182e9, 5288 ms |
| `--no-user-mcp` | OK, suppressed `["node_repl","ptah"]`, 5150 ms |
| `--mcp` | OK. `ptah_probe` startupStatus `["starting","failed"]` (unbound loopback port 9, expected failure) |

## Findings

1. Risk 8l (a) CLOSED: the App Server APPLIES the thread `config` dotted `mcp_servers.<name>` keys
   on `thread/start`. `ptah_probe` exists only in the thread config and the App Server started it.
   The process `-c` fallback is NOT needed.
2. Risk 8l (b) PARTLY CLOSED: the fake secret header value was in none of the 15 files under
   `~/.codex` that changed during the open (no turn, so no rollout file is written yet). The
   rollout check after a real turn stays for live test p8f.
3. Other servers seen in the same open: `codex_apps`, `node_repl`, `cua_repl` ready; the synced
   `ptah` (from `~/.codex/config.toml`) only `starting` (no Ptah app running). In chat the
   per-thread `ptah` entry must override the synced one (P8 D13); live test p8f checks that
   `ptah_*` calls reach the session-scoped URL.

## Probe change

`--mcp` adds a `ptah_probe` http server with a fake secret header through the profile and the
per-open secrets map, reads `mcpServer/startupStatus/updated` from the raw stdout lines (the
runtime drops it), and scans files under CODEX_HOME changed since start for the secret.
