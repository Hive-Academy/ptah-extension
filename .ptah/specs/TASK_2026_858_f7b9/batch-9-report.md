# Batch 9 report

## Files changed

- `libs/backend/platform-core/src/session-driver-lock/control-keys.ts`: discovery file lifecycle, endpoint naming, constant-time key check.
- `libs/backend/platform-core/src/session-driver-lock/control-endpoint.ts`: shared per-process control server, list and guarded release protocol.
- `libs/backend/platform-core/src/session-driver-lock/local-lock-client.ts`: discovery and operator release client.
- `libs/backend/platform-core/src/session-driver-lock/kernel-session-driver-lock.ts`: endpoint registration on first bind, injected live-record check, cleanup on dispose.
- `libs/backend/platform-core/src/index.ts`: public client and response type exports.
- `libs/backend/platform-core/src/session-driver-lock/control-endpoint.spec.ts` and `control-endpoint.cross-process.spec.ts`: behavior and process-boundary coverage.

## Acceptance

- `control-keys.ts:7-36,52-66`: `~/.ptah/session-drivers/<pid>.key` holds a 32-byte base64url key; POSIX directory and file modes are 0700/0600; control endpoint is `ptah-ctl-<uid>-<pid>` on Linux abstract socket or Windows pipe.
- `control-keys.ts:45-50`, `control-endpoint.ts:88`: key comparison uses `crypto.timingSafeEqual`; wrong keys receive `BAD_KEY`.
- `control-endpoint.ts:30-62`, `kernel-session-driver-lock.ts:51-58,170-172`: one process endpoint opens before the first session bind and unregisters on disposal; a failed open refuses acquisition.
- `control-endpoint.ts:89-108`: listing comes from held in-memory locks; release checks the injected live-record predicate, returns `in-use` on a live record or predicate failure, and otherwise calls the lock's existing release path. The constructor defaults to refusing operator release until a registry callback is supplied by the later lifecycle integration.
- `local-lock-client.ts:55-79`: discovery files are checked against live endpoints; refused or missing endpoints cause stale file removal after rechecking the key; timeouts are shown as unresponsive.
- `local-lock-client.ts:82-99`: release resolves the holder pid from the session endpoint before reading that pid's key and sending the control command.
- `control-endpoint.ts:65-80`, `local-lock-client.ts:14-39`: JSON-line protocol, 500 ms timeout, 4 KiB cap. Windows pipe access relies on the key rather than a pipe DACL.

## Tests and verification

- `control-endpoint.spec.ts:22-39`: key refusal, discovery, live-record refusal, and orphan release.
- `control-endpoint.cross-process.spec.ts:29-48`: child-process listing, live-record refusal, and release after its record is removed.
- Scoped `ptah_get_diagnostics` on changed TypeScript files: 0 errors, clean coverage after the final source edits.
- Required `npm run verify -- -p @ptah-extension/platform-core,ptah-electron,mcp-bench` was run once. Nx reported `connect EPERM` on its daemon socket and permission denied for its plugin worker socket; verification could not complete in this sandbox. The filtered command produced no test results. The orchestrator must verify.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Inject a live-record predicate into `KernelSessionDriverLock`, defaulting to `true` | Assume orphan / refuse until registry integration | Plan W10 requires release only when no live record; Batch 10 owns registry lifecycle wiring | Yes |
| Share one control server among lock instances in a process | One server per lock / shared server | Endpoint name is pid-scoped; multiple instances otherwise collide | Yes |
| Treat malformed discovery as absent and remove only files whose key still matches after endpoint refusal | Trust files / validate live endpoint | Plan W10 stale discovery and pid-reuse requirements | Yes |
