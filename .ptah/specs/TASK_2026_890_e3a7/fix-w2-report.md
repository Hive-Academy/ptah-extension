# Writer lane W2 — fix report (review-w2.md defects 1-6)

All six defects are confirmed in the code. Each fix states the behavior as a present fact
(no "for now", "currently", "legacy" or other time-bound words).

`CE` = `libs/backend/vscode-lm-tools/src/lib/code-execution`. `D` = `apps/ptah-docs/src/content/docs`.

| # | Confirmed | File:line changed | New text (short) | Evidence (path:line) |
|---|---|---|---|---|
| 1 | yes | `D/mcp-and-skills/external-callers.md:6` | "A caller can send a token … A request without a token gets read-only access." | `CE/mcp-core/mcp-caller-policy.ts:14-15` (`MCP_LEGACY_UNTOKENED_READ_ONLY = true`); `CE/mcp-http/mcp-caller-token-registry.ts:333-339` (no token → `legacyReadOnlyBinding`) |
| 2 | yes | `D/mcp-and-skills/external-callers.md:16` | "Outside the read-only tools, the three lane report tools above accept the lane report level. All other tools need privileged access." | `CE/mcp-core/mcp-caller-policy.ts:121-137` (`LANE_REPORT_TOOLS`, `isToolPermitted`) |
| 3 | yes | `D/mcp-and-skills/built-in-mcp-server.md:41` | "A caller of the server can send a token. A request without a token gets read-only access." | `CE/mcp-core/mcp-caller-policy.ts:14-15`; `CE/mcp-http/mcp-http-gate.ts:116-123`; `CE/mcp-http/mcp-caller-token-registry.ts:333-339` |
| 4 | yes | `D/mcp-and-skills/built-in-mcp-server.md:16` | "Adds itself, with a token, to the `.mcp.json` … When PtahCode finds Cursor, Codex, or Antigravity on your computer, it also adds itself to their config files." | `CE/mcp-http/ptah-mcp-slots.ts:18-25`; `CE/mcp-http/http-mcp-server.service.ts:1057-1062` |
| 5 | yes | `D/mcp-and-skills/built-in-mcp-server.md:48` | Full access row: "External tools with a token from a workspace config file can also call privileged tools, including `execute_code`. Tokens in config files in your home folder stay read-only. Callers cannot cross workspaces" | `CE/mcp-http/mcp-caller-token-registry.ts:516-521` (`capabilityFor`: home → read-only) |
| 6 | yes | `D/memory/maintenance.md:90` | Caution: "It also permanently deletes matching pinned memories." | `libs/backend/memory-curator/src/lib/memory.store.ts:646-674` (DELETE by subject and workspace, no pinned filter; SQL at `:666-667`) |

## Checks

- `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs`: internal links bad: 0, frontmatter issues: 0, component import issues: 0, sidebar slugs OK.
- Only the three permitted files were edited. No builds, tests, Nx or git writes.
- `pages-w2-report.md` updated: external-callers rows 1 and 5; maintenance row 20; Cross-links row for built-in-mcp-server.md; Decisions 5 and 6.
