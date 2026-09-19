# Phase A — Antigravity stream-json two-way messaging

## Cause

`AntigravityCliAdapter` used stream-json only for output. It passed the whole task as the value after `--print`, closed stdin immediately, exposed no `continue`, and resolved `SdkHandle.done` only when the process closed. Consequently the live handle advertised no continuation capability and `ptah_agent_message` selected `unsupported`.

The live probe also showed that this lifecycle was incompatible with agy's protocol: stdin accepts one `event: "user"` NDJSON object per turn, `result` is emitted once per turn, and `result.usage` / `result.num_turns` are cumulative rather than per-turn.

## Change by file

### `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`

- `:97-185` replaces unchecked output casts with Zod schemas for the agy input and known output events. Known malformed events now surface an error; queued input is validated before any stdin write.
- `:234-304` capability-probes `agy --help` for `--input-format`, caches the result, and makes adapter detection report queue messaging only when the installed binary exposes the feature. I chose a capability probe rather than a version comparison because the supplied evidence spans 1.2.5 and 1.2.7 without establishing the first supporting release; probing the exact flag is both safer and directly tied to the required behavior.
- `:542-580` selects the multi-turn argv or the unchanged legacy one-shot argv. The direct-spawn argv item is `--print=`: this is the quote-free process-level equivalent of the shell spelling `--print=''`, so the empty value is attached and cannot consume the following flag.
- `:622-663` validates and writes `{"event":"user","message":{"content":"..."}}` lines, keeps stdin open during a turn, and schedules stdin closure after a settled turn. The `setImmediate` boundary lets the manager synchronously deliver an already-queued next turn before closure; if none arrives, stdin closes and agy exits.
- `:699-818` maps every `result` to the current turn's promise rather than process completion, exposes `supportsContinuation` / `continue` only on the stream-input path, and keeps all turns on the same child stdin. Spawn/close/error paths settle the active turn without leaving a hanging promise.
- `:831-915` parses the output boundary with Zod while preserving the prior non-JSON banner fallback and unknown-event informational fallback.
- `:946-996` emits text and per-turn usage from `step_update.step_type === "agent_response"`; cumulative usage on `result` is deliberately not emitted, preventing second-turn double counting.
- The existing MCP snapshot remains a local in `runSdk`; `configureMcpServer` and `cleanupMcpEntry` were not changed. Cleanup is still tied to actual process completion and still restores the prior `PTAH_SPAWN_MCP_KEY` value rather than deleting it unconditionally.

### `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts`

- `:167` proves feature detection is based on `--help`, not version-string ordering.
- `:228-280` pins the attached empty print argv, both stream-json flags, the exact first NDJSON input line, and the open stdin.
- `:483-528` proves two `result` events settle two distinct turn promises, the continuation uses the same stdin, cumulative result usage is ignored, and stdin closes after the final turn.
- `:530-574` proves an invalid queued message is refused before `stdin.write` and a known malformed output event is rejected at the Zod boundary.
- `:697` pins that cumulative `result.usage` is not reported.
- `:923-966` pins continuation capability on the supported path and the old one-shot/unsupported behavior when the capability probe is false.

### `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.mcp.spec.ts`

- `:56-72,102` extends the existing fake child with writable stdin and injects a positive capability-probe result. The filesystem-backed MCP write/restore assertions themselves are unchanged and all still pass.

## RED BEFORE

Before production changes, the new specs were run with:

```text
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache -- --runTestsByPath libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts
```

Result: exit 1; 62 suites ran, 61 passed and 1 failed; 943 tests total, 940 passed, 1 skipped, 2 failed.

The two failures were the intended behavioral gaps:

1. The argv contained separate `--print`, `<task prompt>` entries and no `--input-format`; the new attached-empty/NDJSON assertion failed.
2. The first `result` did not resolve a turn, so the two-turn continuation spec timed out after 5 seconds.

## Verification

Final commands were run after formatting the final files:

```text
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache
```

Exit 0. **62/62 suites passed; 946 tests passed, 1 skipped, 947 total; 0 snapshots.** Jest reported 34.352 s.

```text
npx nx typecheck @ptah-extension/cli-agent-runtime --skip-nx-cache
```

Exit 0. `tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json` completed successfully.

```text
npx nx lint @ptah-extension/cli-agent-runtime --skip-nx-cache
```

Exit 0. **0 errors, 39 warnings.** Thirty-eight are existing warnings elsewhere in the project. The changed adapter adds one soft `max-lines` warning: 707 counted lines against 700 (988 physical lines including comments/blanks). I kept the stream protocol beside its sole consumer rather than create a sub-150-line fragment solely to silence the soft cap; the file remains below the project's ~1000-line deliberate-review threshold and this report records the decision.

`git diff --check` also passed for the three changed source/spec files.

## Not verified

- I did not run a live Ptah host and therefore did not directly observe `ptah_agent_message` return `queue-next-turn`, the `ptah_agent_list` capability cell, or `ptah_agent_read` after completion. Those paths are covered indirectly by the existing capability-driven manager/router tests plus the new adapter handle specs, but this deliverable does not claim a live end-to-end proof.
- I did not launch a fresh live two-turn agy process; the supplied 1.2.7 probe is the protocol evidence, and the adapter tests replay that shape.
- I did not install an older agy binary. The no-`--input-format` fallback is proven with a negative capability probe in unit tests, not with a historical executable.
- I did not live-prove that the lane reaches `completed`. The adapter spec proves final `result` closes stdin and process close resolves, but the full host status transition was not exercised live.
- Phase B's opencode probe was outside the requested Phase A implementation and was not performed.

## Acceptance gaps

No Phase A behavior is knowingly omitted in code. Acceptance criteria 1–4 are covered at adapter/unit level, not by a live host run; therefore their live operational confirmation remains outstanding. The required test, typecheck, and lint commands passed as reported above.
