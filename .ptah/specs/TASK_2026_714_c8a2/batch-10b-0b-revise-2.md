# Batch 10b.0b revise 2

## Root cause of failure 2

Production event ordering lost the typed process failure. `codex-context.ts:129-135` registers the context's child `close` listener before `codex-app-server-process.ts:193` registers its own. The context listener starts `process.close()` (`codex-context.ts:926-969`), which previously rejected the pending `thread/start` request with a generic `Error('Codex process closed')` and cleared the pending map (`codex-app-server-process.ts:593-598`) before the process's `onClose`/`fail` path could recover its method (`codex-app-server-process.ts:518-539`). The runtime classifier requires a typed failure carrying `thread/start` or `thread/resume` (`codex-runtime.ts:140-147`), so it returned the generic open error. The stderr tail remains available after close (`codex-app-server-process.ts:100-103,505-508,623-634`); it was not the missing evidence.

## Fixes

- `codex-context.spec.ts:20-22`: Use `toHaveProperty(['mcp_servers.ptah'])` to check the literal dotted key while retaining the nested start/resume config assertions.
- `codex-app-server-process.ts:570-598`: When a child has exited with a request pending, capture a `CodexProcessFailureError` and its sole pending RPC method before close rejects and clears requests. Normal close without an exited child or pending request remains unchanged. The runtime still closes the context first (`codex-runtime.ts:104-105`), and its lane, thread method, and config evidence gates remain at `codex-runtime.ts:140-147`; the typed error contains no stderr or secret.
- `codex-runtime.spec.ts:149-155,2236-2254`: The fake sets exit code 1 and ends stdout/stderr before emitting `close`, matching the process-handle contract that close follows exit and drained stdio. The fake's stdin finalizer now skips a duplicate close after that exit. `process.close()` ends stdin, clears the request timer, and resolves when the close listener runs (`codex-app-server-process.ts:589-616`); the suite's `afterEach` closes the runtime (`codex-runtime.spec.ts:341-350`). This leaves no intentionally pending timer, promise, or fake stream in this case.

## Not done

- Tests, lint, typecheck, diagnostics, build, and other verification commands were not run under the lane rules. The open-handle cleanup is supported by source inspection, not a rerun of Jest.
- No files outside the stated scope were changed, apart from this required report.
