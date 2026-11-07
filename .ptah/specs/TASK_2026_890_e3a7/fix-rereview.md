# Review — scoped fixes

Verdict: APPROVED

Reviewer family: codex

## Fixed defect checks

| Defect id | Closed? | Page file:line | Note | Code evidence path:line |
|---|---|---|---|---|
| W2-1 | Yes | `mcp-and-skills/external-callers.md:6` | Correctly says a request without a token gets read-only access. No time-bound wording. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:333-340` |
| W2-2 | Yes | `mcp-and-skills/external-callers.md:16` | Correctly excepts the three lane-report tools from privileged-only access. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts:121-137` |
| W2-3 | Yes | `mcp-and-skills/built-in-mcp-server.md:41` | Correctly describes untokened read-only requests; no time-bound wording. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:333-340` |
| W2-4 | Yes | `mcp-and-skills/built-in-mcp-server.md:16` | Names Cursor, Codex, and Antigravity config files and conditions them on detection. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts:18-25,283-289` |
| W2-5 | Yes | `mcp-and-skills/built-in-mcp-server.md:48` | Limits privileged access to workspace config tokens; home config tokens remain read-only. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/mcp-caller-token-registry.ts:516-521` |
| W2-6 | Yes | `memory/maintenance.md:90` | Explicitly warns that the permanent purge includes matching pinned memories. | `libs/backend/memory-curator/src/lib/memory.store.ts:666-674` |
| W1/W3-1 | Yes | `canvas/session-inspector.md:42` | Names the visible **Models** button and accurately identifies its tooltip; the button appears with at least two models. | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:263-279` |

## New defects

None in the scoped fixed lines. No false new claim or prohibited time-bound wording found.

## Notes

- Read-only `git diff --` on all four named files showed the tracked `built-in-mcp-server.md` edits. The other fixed passages did not appear in that diff, so their current file lines were inspected directly.
- `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs`: sidebar and redirect targets OK; bad internal links: 0; frontmatter issues: 0; component import issues: 0.
- No prohibited build or test command was run. No matching locally installed review skill was available from prior skill discovery in this session.
