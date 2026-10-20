# Implementation report

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts` — emits each streamed tool call after its input completes, parses JSON fragments with a safe fallback, includes the call ID and full input, and flushes pending calls at assistant, result, and stream end. Non-streamed calls now carry the same metadata.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts` — covers completed streamed input, two distinct Grep inputs, invalid JSON fallback, an unstopped block, non-streamed metadata, and no duplicate when the assistant message follows a streamed call.
- `.ptah/specs/TASK_2026_709_rpg/implementation-report.md` — this report.

## Verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.inbound-peer.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.spec.ts --coverage=false --maxWorkers=2` — **PASS: 3 suites, 65 tests**. PowerShell used `Select-Object -Last 40` in place of unavailable `tail -40`.
- `npx nx typecheck cli-agent-runtime --parallel=1` — **PASS: Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime**. Nx Cloud reported a separate disabled-organization notice; command exit code was 0.
- Scoped `ptah_get_diagnostics` — **PASS: 0 errors, 0 warnings**.

## Decisions

- **Decision:** Keep pending streamed input by block index and emit on `content_block_stop`; flush at assistant, result, and stream end. **Options:** emit at start or after input completion. **Evidence:** `content_block_start` has empty input in streaming, while `input_json_delta` carries the arguments; the budget guard keys on `toolInput`. **Reversible:** yes.
- **Decision:** Use the start block's input when fragments are empty, invalid JSON, or not a JSON object. **Options:** throw, drop the call, or use start input. **Evidence:** the SDK tool-use block exposes object input, and dropped calls would hide lane activity. **Reversible:** yes.
- **Decision:** Track emitted tool segment IDs until the result so the non-streamed assistant message cannot duplicate streamed calls. **Options:** rely on the text-delta flag or track call IDs. **Evidence:** the existing flag can be false for streamed tool calls without text. **Reversible:** yes.

## Not done

- No lane budget threshold or semantic changes. The existing guard suite already covers varied tool inputs, so no guard spec was added.
- The task folder had no existing planning documents to read.
