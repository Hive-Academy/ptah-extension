## Files changed

- `libs/backend/worker-runtime/src/lib/connection.ts`, `worker-server.ts`, `readiness.ts`, `worker-service.ts`: added the WebSocket state machine, loopback HTTP server, seven injected readiness checks, and worker lifecycle composition.
- `libs/backend/worker-runtime/src/lib/connection.spec.ts`, `worker-server.spec.ts`, `readiness.spec.ts`, `worker-service.spec.ts`: focused protocol, transport, readiness, and lifecycle coverage.
- `libs/backend/worker-runtime/src/index.ts`: exports `createWorkerServer` and the new service/readiness contracts.

## Decisions

- **Internal `CODEX_UNAVAILABLE` → wire `INTERNAL`.** Options: add a new protocol code, map to `NO_PROVIDER_READY`, or use the W12 fallback. Evidence: W12 maps unlisted codes to `INTERNAL`; `NO_PROVIDER_READY` would incorrectly suggest a sign-in fix. This is reversible in a later protocol revision.
- **Keep host probes injected.** Options: import CLI/auth packages or pass their results through ports. Evidence: worker-runtime is `scope:extension`, and the plan requires the Claude CLI detector and effective auth route. The host supplies `claudeCli`, `authRoute`, `sqliteMemory`, and package version. Reversible.
- **Use root `ws`.** It and `@types/ws` are already in `package.json`; no dependency change. Reversible.
- **Startup readiness is required.** `WorkerServiceOptions.readiness` returns the seven-check report; start refuses to bind when any check fails. This gives the host control of its concrete probes. Reversible.

## Spec coverage

- Loopback literal/LAN bind refusal: `worker-server.spec.ts` (LAN bind).
- `noServer` `/rpc` upgrade, Host and Origin checks, other paths 404: `worker-server.spec.ts` (pre-auth socket, forged Host, Origin, HTTP 404).
- `EADDRINUSE` names port: `worker-server.spec.ts` (occupied port).
- First-frame hello, pre-auth method guard, fixed error mapping: `connection.spec.ts` (pre-auth dispatch spy, internal Codex refusal).
- Pairing failure throttling and 4429: `connection.spec.ts` (third failure); 1/2/4-second timing is implemented but lacks a clock assertion.
- Ping/pong and timer cleanup: connection implementation; no direct spec assertion.
- Readiness checks 1–7, Node 22/SQLite failure copy, package/protocol version, injected provider probes, AD-25 lock scope: `readiness.spec.ts` (seven checks, runtime failure, provider/workspace/lock failure).
- Start recovers logs, registers workspaces, binds, private endpoint, manual approval, readiness refusal, append-failure abort seam: `worker-service.spec.ts` (endpoint lifecycle, auto-approval, append failure, readiness refusal); log recovery is implemented but lacks a direct assertion.
- SIGTERM goodbye, flush, release locks, endpoint removal: `worker-service.spec.ts` (explicit shutdown release/removal); SIGTERM signal and goodbye frame lack direct assertions.

## Not done / Clarifications Needed

- Task 18.3 `worker-security.spec.ts` is reserved for the other executor and was not created.
- `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.lib.json`, `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.spec.json`, and `npx eslint libs/backend/worker-runtime/src` passed. All new TypeScript files and `src/index.ts` were formatted with Prettier. Scoped Ptah diagnostics timed out twice, so the direct TypeScript checks are the verification evidence.
- Jest and `npm run verify` were not run in this sandbox, per the task instruction. The orchestrator must run scoped verify.
- Security and integration coverage still needs the assertions listed above, especially liveness timer behavior, recovery, and SIGTERM goodbye.

## Notes for Task 18.3

- Start with `createWorkerServer({ host: '127.0.0.1', port: 0, identity, pairing, tokens, handle })`; use the returned `port` and close the server and client sockets in `afterEach`.
- Pass a `jest.fn()` as `handle` and send each `RPC_METHOD_NAMES` entry before auth; no call should reach it and the socket should close 4403. `WorkerConnection` also accepts this handler directly for a fake WebSocket.
- Pass `host: '0.0.0.0'` to assert LAN refusal before binding. Supply forged `Host` and any `Origin` through a `ws` client upgrade; assert rejection.

## Orchestrator corrections (verify)

- `readiness.spec.ts:49`: the check 2 fix text starts a sentence ("Update the Ptah desktop
  package ..."); the spec now matches the R6 wording without case.
- Result: `npm run verify -- -p @ptah-extension/worker-runtime` passed (23 suites, 62 tests).
