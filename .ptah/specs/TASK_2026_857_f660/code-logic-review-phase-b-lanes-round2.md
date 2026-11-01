# Code Logic Review - Phase B lanes, round 2 (Electron quit path, d5cf5bb72)

## Verdict

APPROVED, 9/10. The will-quit finding from round 1 is fixed. Scope: only `git show d5cf5bb72 -- apps/ptah-electron`, read at HEAD. I ran no verification.

## Fix verification

- **Never constructed at quit.** `phase-4-handlers.ts` no longer imports `app` or `CHAT_TOKENS` and has no will-quit listener. The only resolve of `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` on the quit path is gone. `wire-runtime.ts` (~:650-670) resolves it once at boot, inside `captureShutdownHandles` (called at `wire-runtime.ts:537`), and only if `container.isRegistered(...)`. `shutdown.ts:254-256` reads `refs.hostRouting?.dispose()`, and the ref is `null` when the boot was aborted or never reached the capture. Nothing is built at quit.
- **A throw cannot skip the flushes or the chain.**
  - Capture: the resolve is wrapped in try/catch and sets the ref to `null` on failure, so a throw at boot cannot abort boot.
  - Quit: the dispose runs through `nonFatal(...)` (`shutdown.ts:192-201`), which catches everything and only warns. `disposeBeforePersistence` therefore continues to the gateway stop, the child-session end, the agent reap, the SQLite close and the flushes (`shutdown.ts:499-604`). The spec `main.quit-path.spec.ts` "a throwing host routing dispose skips neither the flushes nor the chain" asserts that `flushWorkspacePersistence`, `flushSessionMetadataStores` and the full remaining order all still run.
  - The quit-during-boot path (`shutdown.ts:632`, `disposeBeforePersistence`) uses the same guarded call.
- **Same singleton as the chat path.** `registerHostRouting` uses `registerSingleton(CHAT_TOKENS.HOST_ROUTING_COORDINATOR, HostRoutingCoordinator)` (`register-host-routing.ts:68-71`), so any later or earlier resolve returns the same instance. The boot capture runs right after the `chatSessions` capture. Resolution order is irrelevant for identity. It only needs to happen before shutdown, and it does. If it were resolved first by the capture, `ChatSessionService` would receive that same instance through its optional inject.
- **Disposal order is safe.** `hostRouting` is disposed in `disposeBeforePersistence`, right after `chatBridge` and before `messagingGateway`, which the spec's `EXPECTED_LIFO_ORDER` pins. The SDK adapter, the session-id registry and the SQLite connection are torn down later (chat sessions and the SQLite close come after), so the coordinator unsubscribes from live producers. `dispose` is synchronous and touches no SQLite (it releases subscriptions and clears maps).
- **No prompt text in the warning.** The capture warning logs a fixed label plus `hostRoutingError.name` only (or `'unknown'`). The `nonFatal` warning logs `error.message` of a dispose throw. `dispose` only runs release callbacks and `Map.clear()`, so its errors carry no user text. No scope or prompt text is reachable.

## Findings

1. **Minor (no action needed).** `shutdown.ts:192-201` logs `error.message` for a dispose failure (generic helper, not specific to this fix). The coordinator's `dispose` handles no user text, so there is no privacy impact. If the dispose body later grows to touch prompts, log `error.name` instead.
2. **Minor, informational.** After `dispose()`, a still-in-flight scope check or pre-flight can complete and call `queue.put` or `cache.put` on in-memory structures. That is harmless during quit (no persistence) and is covered by the coordinator's epoch guards, which belong to the codex-reviewed part.

No Critical, Serious or Moderate findings.
