# Batch B6a + B6b report

## Summary

Implemented the CLI native attention no-op adapter, registered its platform token, and attached the SDK attention coordinator to the actual CLI push adapter after SDK registration. The adapter observes sends and broadcasts before EventEmitter delivery, including zero-view operation, and supports disposable observer replacement.

## Files

- `libs/backend/platform-cli/src/implementations/cli-host-attention-notifications.ts` — no-op implementation.
- `libs/backend/platform-cli/src/implementations/cli-host-attention-notifications.spec.ts` — shared host attention contract with `noOp: true`.
- `libs/backend/platform-cli/src/registration.ts` — registers `HOST_ATTENTION_NOTIFICATIONS`.
- `libs/backend/platform-cli/src/index.ts` — exports the adapter.
- `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts` — pre-delivery ingress, observer replacement, sanitized Logger error handling.
- `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.spec.ts` — ingress order, broadcast once, detachment, and error-path coverage.
- `libs/backend/cli-engine/src/lib/container.ts` — resolves and attaches coordinator after SDK registration, disposes registration during host shutdown.
- `apps/ptah-cli/src/di/expected-resolvable.ts` — names the two attention DI tokens.
- `apps/ptah-cli/src/di/container.smoke.spec.ts` — checks platform adapter and coordinator resolution.

## Decisions

- Did not register `PTAH_VIEW_VISIBILITY`: `HostAttentionCoordinator` injects the host notification port, workspace provider, metadata store, and Logger; no CLI service in this path resolves the visibility token. Alternative was an unused always-hidden implementation. Reversible.
- Kept the CLI adapter stateless because no native CLI notification surface exists. Alternative was tracking generations with no consumer. The shared contract explicitly supports `noOp: true`. Reversible.
- Passed Logger when attaching the observer because the CLI push adapter is created before Logger registration. Alternative was changing bootstrap order. This preserves existing transport construction and logs only `error.name`. Reversible.

## Not done

- No Nx, Jest, TypeScript, lint, build, or diagnostic compiler checks were run, per the lane's memory-safe instruction. The orchestrator owns scoped verification.
