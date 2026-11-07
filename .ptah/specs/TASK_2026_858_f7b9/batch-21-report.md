## Task 21.1 — Files changed

- `libs/backend/remote-machines/src/lib/machine-connection.ts` and `.spec.ts`: WorkerClient over a `ws` socket with injected SSH Duplex transport, connection states, retry timer, session cursor tracking, and cleanup.
- `libs/backend/remote-machines/src/lib/machines-service.ts` and `.spec.ts`: registry and token coordination, serialized writes, pairing, online/offline removal, push broadcasts, local lock readiness, and disposal.
- `libs/backend/remote-machines/src/lib/machines-rpc.handlers.ts` and `.spec.ts`: registered all renderer methods, parsed zod parameters, mapped worker errors.
- `libs/backend/remote-machines/src/index.ts`: exported the new public API.

## Decisions

- Connection owns the `ws` adapter and transport. Options were a separate adapter or a direct wrapper; the existing WorkerClient factory seam and single host use favor the direct wrapper. Reversible.
- Registry operations use one promise chain. Options were a mutex or a promise chain; the registry has only three mutations and no existing lock abstraction. Reversible.
- Pairing token is persisted after authentication succeeds. Options were storing before or after connect; the requirement says a failed pairing must store nothing. Reversible.

## Task 21.1 — orchestrator round 1

1. Replaced the `worker-protocol` dynamic import in `machines-service.ts` with `WORKER_METHOD_SCHEMAS` from a static public import. Also replaced the `platform-core` dynamic import in local readiness with a static public import. A type-only `import()` in the new connection spec triggered the same Nx rule; it is now a static type import.
2. Removed the token non-null assertion in `machine-connection.ts` by narrowing after hello, and replaced the handler spec's non-null assertion with an explicit missing-handler failure.
3. Made `ptahVersion` required in `MachinesServiceOptions` and `MachineConnectionOptions`. Hello and the local version report now use it. Batch 22 must pass Electron's app version. Added an optional port used by the Duplex integration test; the production default remains 41873.
4. Added specs for online revoke/removal ordering, five-second revoke timeout, token persistence only after authenticated pairing, reconnect re-attach cursors for two sessions, and serialized renderer results without a token. The online removal spec asserts connection disposal; it does not run a real SSH child.

## Verification

- Ran exactly once: `npm run verify -- -p @ptah-extension/remote-machines -- --output-style=static > /tmp/p-e-b21-lane.log 2>&1; echo exit=$?` → `exit=1`.
- Ran `grep -E "Running target|Tests:|Failed tasks|Successfully ran|error" /tmp/p-e-b21-lane.log | head -30`. It showed `lint, typecheck` started; lint failed with seven Nx lazy-load import errors, all caused by a type-only `import()` in `machine-connection.spec.ts`; the test stage failed because `machines-service.spec.ts` lacked a `MachineConnection` import and the worker-runtime public barrel needed a reflect polyfill in the integration spec. The 31 tests in suites that compiled passed. The spec type import, missing import, and polyfill were corrected after this run. There was no second verify run, per the requested single-run limit.
- Scoped `ptah_get_diagnostics` after those corrections reported zero TypeScript errors and warnings for the changed specs. The earlier verify typecheck target completed without a reported error. Prettier ran on all changed TypeScript files.

## Known limits

- The final corrected state has not passed lint and tests in one verify run. The orchestrator should rerun scoped verification before accepting Batch 21.
- The online removal test verifies revoke, credential deletion, registry deletion and connection disposal through a fake; it does not inspect a spawned SSH child.
- The integration spec imports `createWorkerServer` from the worker-runtime public entry and connects with `net.connect` over a Duplex to the server's actual port. Its first run stopped at the missing reflect polyfill during module loading; this was corrected after the single verify run, so its behavior remains unconfirmed.
- No skill-loading tool or skill catalogue was listed for this lane.

## Task 21.2

Created `libs/backend/remote-machines/src/lib/machine-connection.integration.spec.ts` using the worker-runtime public entry, a real loopback server on port 0, issued token, and injected TCP Duplex. It asserts hello/auth reaches `connected`, a `workspaces.list` call round-trips, server closure schedules retry, and dispose/afterAll close handles. The module-boundary lint output did not reject the public worker-runtime import; the test needs a post-fix verify run.
