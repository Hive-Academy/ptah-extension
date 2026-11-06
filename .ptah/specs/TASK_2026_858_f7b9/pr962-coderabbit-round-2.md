# PR #962 CodeRabbit round 2

## Fixes

1. SSH deadline and output cap settle immediately, kill the child, detach stream listeners, and destroy streams; later events do nothing. `libs/backend/remote-machines/src/lib/ssh-worker-commands.ts:83`. Specs: `times out after 15 seconds and kills the child` and `maps thrown spawn and oversized stdout` (`ssh-worker-commands.spec.ts:53`, `:138`), both now omit `close` before asserting rejection.
2. A failed pairing exchange restores the normal retry schedule only for an eligible, existing paired connection, preserving the next backoff step. `libs/backend/remote-machines/src/lib/machine-connection.ts:383`. Spec: `restores the next backoff retry when pairing fails on an offline paired machine` (`machine-connection.regressions.spec.ts:132`).
3. Retry reloads a missing in-memory token for an unpaired connection when the registry still binds a worker identity, then connects. Credential-read errors are logged without raw error text or tokens. `libs/backend/remote-machines/src/lib/machines-service.ts:380`; token presence check at `machine-connection.ts:424`. Spec: `reloads a recovered credential on startup retry of a cached unpaired connection` (`machines-service.spec.ts:10`).

## Decisions

- Keep the existing connection cached and reload its credential during `retry()`. The startup flow calls `list()` then `retry()`, and the connection already owns the transport and state. Reversible.
- Preserve the child error listener after SSH settlement so a late `error` event cannot throw. Remove stream data and close listeners and destroy both streams. Reversible.
- Continue backoff from the failed connection attempt after exchange failure. `schedule()` already enforces one timer and one backoff increment. Reversible.

## Verification

- `npm run verify -- -p @ptah-extension/remote-machines -- --output-style=static`: exit=0; lint and typecheck succeeded; test succeeded; Tests: 74 passed, 74 total; no Failed tasks.
- Degradation audit: audit=0; `grep remote-machines/src /tmp/p-e-cr2-audit.log` returned no lines.
- DI lint: `di-lint OK: 2072 @inject sites all resolve to a registered token (936 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`.
- Prettier ran on all six changed TypeScript files. Ptah diagnostics timed out while checking; the scoped verify typecheck passed.
