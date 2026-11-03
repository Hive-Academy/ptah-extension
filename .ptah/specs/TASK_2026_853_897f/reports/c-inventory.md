# Phase C inventory gate — R1–R36

Checked against the current `ptah-core-prompt.ts`, the `_shared` partials, the MCP handshake, and the installed `claude_code` preset. No row is missing a planned retained home.

Path key:

- `CORE` = `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`
- `PARTIAL` = `libs/backend/agent-generation/templates/agents/_shared`
- `HANDSHAKE` = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts`
- `CLI` = `/home/amun/.local/share/claude/versions/2.1.312` (installed `claude_code` preset strings)

| Rule | Current location (file:line) | Retained home (file:line) | Status (OK / MISSING) |
| --- | --- | --- | --- |
| R1 | CORE:110-119 | CORE:110-119 | OK |
| R2 | CORE:123 | CLI:344705 | OK |
| R3 | CORE:124 | CORE:124,259-261 | OK |
| R4 | CORE:125 | CLI:344695 | OK |
| R5 | CORE:126 | CLI:345114 | OK |
| R6 | CORE:127 | CLI:344705 | OK |
| R7 | CORE:129-131 | N/A — intentional deletion, implementation-plan.md:237 | OK |
| R8 | CORE:133-135 | N/A — intentional deletion, implementation-plan.md:238 | OK |
| R9 | CORE:31-33 | CORE:31-33; PARTIAL/tooling-precedence.md:3; HANDSHAKE:36-38 | OK |
| R10 | CORE:35-54 | CORE:35-54; PARTIAL/tooling-precedence.md:6-15; HANDSHAKE:36-41 | OK |
| R11 | CORE:56-57,155-157 | CORE:56-57; PARTIAL/tooling-precedence.md:4,17; HANDSHAKE:37-38 | OK |
| R12 | CORE:59-60 | CORE:59-60 | OK |
| R13 | CORE:62-68 | CORE:62-68 | OK |
| R14 | CORE:51,70-71 | CORE:51,70-71 | OK |
| R15 | CORE:73-79 | CORE:42 (`ptah_lsp_references` row receives the refactor rule) | OK |
| R16 | CORE:81-83 | CORE:81-83 | OK |
| R17 | CORE:84 | CORE:81-87 (Token economy section, rewritten in place) | OK |
| R18 | CORE:85-86 | CORE:85-86 | OK |
| R19 | CORE:87 | CORE:48-49,87 | OK |
| R20 | CORE:155-157 | CORE:56-57; CLI:344695 | OK |
| R21 | CORE:141-143 | CORE:141-143 | OK |
| R22 | CORE:99,145 | CORE:99,145; PARTIAL/cli-delegation.md:1 | OK |
| R23 | CORE:98-102,147 | CORE:98-102,147; PARTIAL/cli-delegation.md:1 | OK |
| R24 | CORE:149 | CORE:149; PARTIAL/cli-delegation.md:1 | OK |
| R25 | CORE:151 | CORE:151 | OK |
| R26 | CORE:153 | CORE:153 | OK |
| R27 | CORE:161-176 | CORE:161-176; PARTIAL/clarification-protocol.md:1-3 | OK |
| R28 | CORE:178-180 | CORE:178-180; CLI:344695 | OK |
| R29 | CORE:182-184 | CORE:182-184 | OK |
| R30 | CORE:185-187 | CLI:340397; PARTIAL/replacement-policy.md:1 | OK |
| R31 | CORE:259-261 | CORE:259-261 (also receives R3) | OK |
| R32 | CORE:189-239 | CORE:189-239 | OK |
| R33 | CORE:241-243 | CORE:241-243 (Git section, rewritten in place); CLI:357815 | OK |
| R34 | CORE:245-247 | CLI:345222 | OK |
| R35 | CORE:249-257 | CLI:338067 | OK |
| R36 | CORE:280-288 | CORE:141-149 (R21–R24); the MANDATE wrapper is deleted | OK |

Gate result: **PASS**. Step 2 is permitted.
