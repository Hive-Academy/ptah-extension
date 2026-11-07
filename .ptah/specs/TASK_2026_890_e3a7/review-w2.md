# Review — new PtahCode docs pages (Electron)

Verdict: REVISE

Reviewer family: codex

## Defects

| # | Severity (Blocking/Serious/Minor) | Page file:line | Claim | Problem | Code evidence (path:line) | Fix |
|---|---|---|---|---|---|---|
| 1 | Blocking | `mcp-and-skills/external-callers.md:6` | A caller sends a token. | Untokened POST requests are accepted with read-only capability. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts:14-15`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:333-340` | “A caller can send a token, which determines its access level. For now, a request without a token is accepted with read-only access.” |
| 2 | Blocking | `mcp-and-skills/external-callers.md:16` | A tool outside the read-only list needs privileged access. | Three lane-report tools work at lane-report level. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts:115-137` | “Outside the read-only tools, the three lane-report tools listed above accept lane-report access; other tools require privileged access.” |
| 3 | Blocking | `mcp-and-skills/built-in-mcp-server.md:41` | Each caller must send a token. | The active legacy switch accepts untokened requests as read-only. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts:14-15`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-http-gate.ts:116-122` | “Callers normally send a token; currently, requests without one are accepted with read-only access.” |
| 4 | Serious | `mcp-and-skills/built-in-mcp-server.md:16` | Server entry goes in `.mcp.json`. | This leaves out other token-bearing client configs. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts:18-25`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:1057-1062` | “Adds a token-bearing server entry to each open workspace's `.mcp.json`; when detected, it also configures Cursor, Codex, and Antigravity.” |
| 5 | Serious | `mcp-and-skills/built-in-mcp-server.md:48` | Full access lets external tools call privileged tools. | Home-folder tokens always remain read-only. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:516-521` | “Workspace-scoped external tokens can also call privileged tools, including `execute_code`; home-folder tokens remain read-only. Callers cannot cross workspaces.” |
| 6 | Serious | `memory/maintenance.md:89` | Permanent purge caution omits pinned memories. | Matching pinned memories are deleted because the SQL has no pinned filter. | `libs/backend/memory-curator/src/lib/memory.store.ts:646-674` | Add: “This also permanently deletes matching pinned memories.” |

## Checked claims

| Page | Claims checked | Confirmed | Result |
|---|---:|---:|---|
| `memory/timeline-and-corpus.md` | 30 | 30 | Memory tab is Electron-enabled (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:230-232,376`); timeline and corpus controls match the components. |
| `memory/maintenance.md` | 27 | 27 | Controls and purge behavior match; warning omission in defect 6. |
| `settings/search-and-voice.md` | 25 | 25 | Tab and Electron sections are wired (`libs/frontend/chat/src/lib/settings/settings.component.ts:204`; `libs/frontend/chat/src/lib/settings/search-voice-settings.component.ts:20-25`). |
| `settings/context-management.md` | 30 | 30 | Section order and Electron routing controls match (`libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:50-90`). |
| `mcp-and-skills/external-callers.md` | 20 | 18 | Two false claims; other access levels, paths, and request checks align. |
| Three added cross-links | 3 | 3 | All resolve. |

## Notes

- **A1 confirmed.** The legacy switch is true (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts:14-15`), and missing tokens receive read-only binding (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:333-340`). Exact existing-page fix: “Callers normally send a token; currently, requests without one are accepted with read-only access.” `external-callers.md:6` contradicts this.
- **A2 confirmed.** Slots include Cursor, trusted/untrusted Codex, and Antigravity (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts:18-25`); tokens go in Cursor's authorization header or other target URLs (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:1057-1062`). Exact existing-page fix: “Adds a token-bearing server entry to each open workspace's `.mcp.json`; when detected, it also configures Cursor, Codex, and Antigravity.” `external-callers.md:23-34` agrees.
- **A3 confirmed.** Home capability is unconditionally read-only (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:516-521`). Exact existing-page Full access effect: “Workspace-scoped external tokens can also call privileged tools, including `execute_code`; home-folder tokens remain read-only. Callers cannot cross workspaces.” `external-callers.md:50-52` already states the exception.
- **B confirmed.** Workspace purge SQL deletes by subject and workspace with no pinned predicate (`libs/backend/memory-curator/src/lib/memory.store.ts:646-674`). `memory/maintenance.md` **must explicitly warn** that matching pinned memories are permanently deleted. Its “every matching entry” wording is literally true, but it does not make the pin consequence clear at the irreversible action.
- **Links/rules:** The permitted link checker reported `bad: 0`, `frontmatter issues: 0`, valid sidebar slugs. Read-only `git diff` showed the three requested cross-links; they resolve. No prohibited host framing, relative links, dates, prices, or roadmap language found.
- No builds, tests, Nx commands, or writes outside this report were run. Skill discovery found no locally installed matching review skill.
