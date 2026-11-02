# D9 fix 5: Codex resume follow-up

## Changes against the review

1. **Frame limits:** `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:26-28,110-113,141,335-344,529,594-596` separates a 16 MiB inbound cap from the existing 1 MiB outbound cap. The read buffer starts at 1 MiB and grows only for larger frames. An inbound overrun still fails as `Codex invalid protocol frame`; process failure metadata now carries the attempted `byteSize`.
2. **History page size:** `libs/backend/codex-runtime/src/lib/codex-session-history.ts:54-56,119,133` requests 25 turns or items per page. Cursor traversal remains in `pages()`; the page ceiling rises to 400 to preserve the former 10,000-row history ceiling.
3. **Partial descendant recovery:** `libs/backend/codex-runtime/src/lib/codex-session-history.ts:158-185,200-257` collects failures from archived list calls and child hydration, including the parent metadata mismatch. Each catch calls `assertOpen()` first. One discovery WARN records archived values or thread IDs, reason codes, JSON-encoded Zod issue paths, and `partialListing` plus completed/failed list counts. Root history and successfully hydrated children remain available after an auxiliary failure.
4. **Experimental list filter:** `libs/backend/codex-runtime/src/lib/codex-session-history.ts:188-210` documents `ancestorThreadId` as an experimental Codex 0.165.0 parameter verified by the prior lane's live probe. The process enables `experimentalApi` during initialize at `codex-app-server-process.ts:234`. JSON-RPC invalid params (`-32602`) retries that archived value once without the parameter. The retry still follows cursors; the parent-chain closure at `codex-session-history.ts:223-238` filters unrelated rows.
5. **Synthetic specs:** `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts:64-75` validates an unseen string source and a `subAgent.thread_spawn` source. `codex-app-server-process.spec.ts:653-694` checks acceptance above 1 MiB and rejection above 16 MiB with byte metadata. `codex-session-history.spec.ts:103-117,146-171,193-284` checks 25-row cursor paging, aggregated and partial list warnings, invalid-params retry with paged parent-chain filtering, child validation failure and parent mismatch preserving another child, and abort propagation. The stale captured-sample comment was corrected at `codex-session-history.spec.ts:5`.

## Changed files

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-session-history.ts`
- `libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix5-report.md`

## Evidence and limits

Reviewed `code-logic-review-D9-fix4.md`, the current process and history paths, and the edited source and spec lines. All new fixtures use invented IDs and content. The coordinator-excluded private sample and live spec were neither read nor recreated. Tests, type checking, lint, builds, and live Electron resume were not run because the task explicitly prohibits those commands. CI and the live resume remain to be checked by the coordinator.
