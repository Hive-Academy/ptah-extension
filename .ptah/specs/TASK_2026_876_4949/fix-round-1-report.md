# Fix round 1 report

## Findings

1. **Fast successor ID:** `session-handoff.service.ts` now registers a provisional bind before starting the successor, buffers an SDK ID reported during start, commits only on an on-time successful result, and deletes the bind on refusal or timeout. `session-handoff.service.spec.ts`: `commits an SDK id resolved during the awaited start`.
2. **Caller stop failure:** `session-handoff.service.ts` awaits `endSession` before marking either caller ID idle. A rejected stop logs the error and rearms the caller for the next flush; an in-progress stop cannot be invoked twice. `session-handoff.service.spec.ts`: `keeps caller live until stop resolves and retries a rejected stop on the next flush`.
3. **Lane parent alias:** `agent-monitor.store.ts` retains tab-to-SDK aliases and applies them when reparent messages arrive. `agent-monitor.store.spec.ts`: existing reparent-then-resolution case plus `uses the resolved SDK id when resolution arrives before reparenting`.
4. **Concurrent persistence:** `session-handoff-chain.store.ts` serializes appends and reads per workspace, writes copied link snapshots, and clears dirty only for the generation written. `session-handoff-chain.store.spec.ts`: `serializes overlapping appends and persists both immutable edges`.
5. **Cyclic links:** `session-handoff-chain.store.ts` rejects an edge when the successor already reaches the predecessor and drops cyclic edges on document load; branches remain supported. `session-handoff-chain.store.spec.ts`: `rejects cyclic edges while preserving branches` and `drops cyclic edges from a stored document`.

## Decisions

- Retained branches because the approved plan requires branch order by link time. Cycle checking uses directed reachability from successor to predecessor. Reversible: yes.
- Stop retry is driven by a subsequent flush event, with one attempt per event and no self-triggered loop. Reversible: yes.

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run verify -- -p @ptah-extension/cli-agent-runtime` | 1 | Nx daemon socket EPERM, then default and Jest/ESLint plugins failed to load with spawn EPERM. No tests ran; pass/fail counts unavailable. |
| `npm run verify -- -p @ptah-extension/chat-streaming` | pending when report written | Same Nx socket and plugin spawn EPERM. No tests ran; pass/fail counts unavailable. |
| `ptah_get_diagnostics` scoped to three changed source files | unavailable | TypeScript checker exceeded its 45-second tool timeout twice. |

## Limitations

The machine's Nx plugin spawn failure prevented compilation, lint and Jest confirmation. The new specs have been written but could not be executed.
