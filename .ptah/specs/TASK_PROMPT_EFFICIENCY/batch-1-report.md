# Batch 1 — R2, R3, R4, R5, R8 + usage reporting

Worktree `.claude-worktrees/prompt-token-efficiency`. Nothing committed.

## Files changed

| File | Change |
|---|---|
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` | R2 + R3: `NATIVE_AGENT_TOOL_POLICY` gains a vendor-independent cost policy (scoped `-p` verification, small tool output, background + ONE completion check, no wait loops, AST/targeted reads). `TWO_WAY_MESSAGING_GUIDANCE` untouched. |
| `…/cli-adapter.utils.spec.ts` | Policy pin updated; new argv-budget case (`< 1000` bytes). The 826-byte `TWO_WAY_MESSAGING_GUIDANCE` pin still passes unchanged. |
| `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` | R8: MCP section extracted to `PTAH_MCP_SUBSTITUTION_SECTION`, interpolated by both prompts (duplicate removed). R4: `CLI_DELEGATION_PATTERN` is Spawn → `<agent-lane-completed>` push signal → Read, with `ptah_agent_status` as a one-off. New `### Token economy` block. Header comment carries the measured figure. |
| `…/ptah-core-prompt.spec.ts` (new) | Pins the ≤4,000-token budget, the single table copy, the retained audit §4 rules, the no-poll pattern and the token-economy rules. |
| `libs/backend/agent-generation/…/enhanced-prompts.service.ts` | R5: `capProjectGuidance` caps `getProjectGuidanceContent` at 4,000 bytes including the truncation notice, cutting on the last heading (fallback: last newline). |
| `…/enhanced-prompts.service.spec.ts` | New case for oversized guidance. |
| `libs/backend/cli-agent-runtime/…/codex-cli.adapter.ts` | Usage line now `Usage: N input (M cached), K output tokens`. |
| `…/codex-cli.adapter.spec.ts` | Two pins updated; the first now uses a non-zero cached value. |
| `scripts/codex-usage-report.mjs` → `scripts/agent-usage-report.mjs` | Same argv (`days`, `top`). Adds a `claude` vendor section from `~/.claude/projects/**/*.jsonl`; per-vendor sessions, requests, avg context/request, total input, cached share, aggregates and top sessions. |

## Byte deltas

| String | Before | After | Δ |
|---|---|---|---|
| `NATIVE_AGENT_TOOL_POLICY` | 196 | 756 | +560 (budget was ~600; argv limit 8,191) |
| `PTAH_CORE_SYSTEM_PROMPT` | 18,057 B ≈ 4,514 tok | 16,050 B / 15,974 chars ≈ **3,994 tok** | −2,007 B, now inside the declared ~4,000-token budget |
| `PTAH_MCP_MANDATE_PROMPT` | 5,693 | 5,945 | +252 (gains the token-economy and delegation blocks; its table is now the shared constant, so the pair no longer ships two copies) |
| Shared `PTAH_MCP_SUBSTITUTION_SECTION` | — | 4,740 | one copy in source, was written out twice |
| Project guidance per spawn | unbounded | ≤ 4,000 | — |

## Verification

- `npx nx run-many -t test -p cli-agent-runtime agent-sdk agent-generation --skip-nx-cache` → **Successfully ran target test for 3 projects.** (An earlier run failed `agent-generation:test`; Nx itself flagged the task as flaky and the isolated re-run passed 32 suites / 1,028 tests.)
- `npx nx run-many -t lint -p cli-agent-runtime agent-sdk agent-generation` → **success**, 42 pre-existing warnings, 0 errors.
- `node scripts/agent-usage-report.mjs 7 5` → runs; codex 159 sessions / 10,853 requests / 115k avg context, claude 357 sessions / 36,811 requests / 199k avg context, 95% cached.

## Notes for the next batch

- The claude figures the new report surfaces are worse than the codex ones the audit was built on: 199k average context per request and 13,270 requests above 200k in seven days. R1 (shared agent preamble) and R10 (per-lane cost model) are where that is paid.
- `ptah-system-prompt.constant.ts` (R7) still carries a third near-copy of the MCP table; it is outside this batch's ownership.
