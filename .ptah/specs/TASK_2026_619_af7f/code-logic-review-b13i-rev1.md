# Code Logic Review — TASK_2026_619 Batch 13i rev 1 (commit 5f40c8730)

Verdict: APPROVE (0 blocking, 0 serious, 3 minor). Read-only review; no specs, typecheck or build were run. I relied on the lane's reported Jest result and checked it by reading code and git history.

Base path: `libs/backend/vscode-lm-tools/src/lib/code-execution/`

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S1: note only on cap expiry | FIXED | `mcp-core/agent-wait.tool.ts` `headerOf` (~l.197): `capNote` needs `result.timedOut && cappedFromTimeoutSec !== undefined && running > 0`. Early `any`, completed-all, cancelled and zero-second waits get no note. |
| S2: per-transport descriptions | FIXED | `buildAgentWaitTool({transport})` and `buildAgentSpawnTool({transport})` default to `'http'`. `mcp-stdio/tool-builders.ts` passes `'stdio'` for `agent_wait` and `agent_spawn`. The stdio wait description, the `timeoutSec` field description and the spawn text carry no HTTP wording. HTTP says "capped at 45 s" in both the description and the `timeoutSec` field. |
| M1: tests | FIXED | New specs: `any` early end, `timedOut:false` with a cap set, cancelled with a real `AbortController`, `timeoutSec:0`, stdio reply has no `WAIT CAPPED` or `HTTP`, stdio description and schema have no `HTTP`, and the HTTP cap wording is present. |
| M3: capped header | FIXED, one regression (see m1) | The capped reply now starts `WAIT CAPPED at 45 s on the HTTP transport (requested 600 s): ...`. Ordinary timeouts keep `TIMED OUT`. |

Defaulting `transport` to `'http'` is the safe direction: any caller that is not stdio-aware keeps the HTTP wording.

## Description budget fix: guidance check

The tightening only reworded text. Compared with 4f3578b6c:
- Spawn: "make one ptah_agent_wait call, never a ptah_agent_status loop" became "call ptah_agent_wait; never poll ptah_agent_status". The meaning is the same.
- Spawn, HTTP only: "Over HTTP each wait call lasts at most 45 s, so repeat ptah_agent_wait while lanes remain running" became "HTTP calls wait at most 45 s, so repeat while lanes run". The instruction and the number are kept.
- Wait: "the last output lines" became "last output". The per-lane report list, the deliverables-on-disk statement, the partial-result-on-timeout statement and "safe to repeat" are all retained.
- The mode semantics and the pointer to `ptah_agent_read` are retained.

No important guidance was dropped.

## Minor items (non-blocking)

**m1. The capped reply loses the standard timeout header content.**
- `agent-wait.tool.ts` ~l.197-201: `if (capNote) return capNote.trim();` returns before the `TIMED OUT` branch, which says "N of M known lane(s) ended, K still running. Partial result; ...".
- The capped header gives only "K lane(s) still running". It drops the ended count, the total, the mode and the partial-result wording.
- The per-lane body still carries the state, so nothing is lost silently, but the header is less informative than a normal timeout.
- Suggested fix: append the ended and total counts to the cap note.

**m2. Dead code after the early return.**
- `capNote +` remains in the cancelled branch (~l.205) and the timed-out branch (~l.212). `capNote` is always `''` there. Remove it so it does not suggest a reachable combination.

**m3. The "45 s" literal in `tool-description.builder.ts` (the spawn text) duplicates `HTTP_MAX_AGENT_WAIT_SEC`.**
- The wait tool interpolates the constant. If the cap changes, the spawn text drifts.
- Also, stdio text still names `ptah_agent_wait` and `ptah_agent_status`, although the stdio tools are `agent_wait` and `agent_status`. This predates 13i.

## Freshness test (protocol-dispatcher.spec.ts)

Test: "ptah_code_search_symbols runs the freshness check and surfaces the index block" (`mcp-core/protocol-dispatcher.spec.ts:5467`).

**Conclusion: the lane is right that 13i did not cause it. The cause is Batch 13b, commit `ce290b460`, "one census per root".**

What I checked:
- The test builds `buildCodeNamespace` with a stub indexer that has only `indexWorkspace` (spec l.5473-5480). The path is `ptah_code_search_symbols` → `code.ensureIndexFresh` → `checkFreshness`.
- `ce290b460` changed `code-namespace.builder.ts` and replaced the local `inFlight` set with `runIsActive(root)`, which is `indexer.isIndexing(root)`.
- `checkFreshness` now calls `runIsActive(hostRoot)` before the stale and start check. With the stub, `indexer.isIndexing` is not a function, so it throws a `TypeError`.
- `ensureIndexFresh` (`code-namespace.builder.ts:338-359`) catches it, logs, and returns `reindexStarted:false`. So `indexWorkspace` is called zero times, and the `index` block would also differ from the expected `reindexStarted:true, reindexInFlight:true`.
- `ce290b460` updated `namespace-builders/code-namespace.builder.spec.ts`, whose stub has `isIndexing`: 4 occurrences at l.221-249. It did not touch `protocol-dispatcher.spec.ts`: 0 occurrences of `isIndexing`, and no commit from 13b touches that file. The last commits to that spec are `3fe7a030e`, `73f882d8c` and `746601373`, all older.
- 13i never touched this path. `git diff --stat 4f3578b6c^ 5f40c8730` over `namespace-builders/`, `mcp-core/protocol-dispatcher.spec.ts` and `libs/backend/workspace-intelligence` is empty.

One correction to the lane's reasoning: `4f3578b6c` did change `protocol-dispatcher.ts`, but only the `ptah_agent_wait` case and an import. The `ptah_code_search_symbols` handler is unaffected. The lane said only "batches and agent wait/spawn files", which omits this file but does not change the conclusion.

Fix, owned by a 13b follow-up and not by 13i: give the dispatcher spec stub `isIndexing: jest.fn(() => ...)`. The expected `reindexInFlight:true` needs it to return true after `indexWorkspace` starts, as the builder-spec stub does.

Residual risk: nothing in the production code is wrong here. The failure is stale test scaffolding. The 13b batch reported "442 passed" for its own specs, so it likely did not run the dispatcher spec.

## Five logic questions

1. Silent failure: none new. The cap note is now truthful.
2. Unexpected user action: `any` mode, a long timeout, and a lane that ends early are now handled and tested.
3. Wrong-answer input: none found. `timeoutSec:0` is pinned.
4. Dependency failure: unchanged from the first review.
5. Missing: the capped header counts (m1), and the unchanged observations on `run_check` and `web_search`.

## Verdict

APPROVE, confidence HIGH on the 13i logic. The freshness failure is a 13b spec gap and should be fixed before the branch merges, but it does not block 13i.
