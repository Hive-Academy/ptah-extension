# Phase E fix round 1

## Fixes

| Finding | Change and location | Regression spec / status |
| --- | --- | --- |
| S1 | Store `workerMachineId` after pair; compare hello identity before auth in `machine-connection.ts:254` and `machines-service.ts:186` | `machine-connection.integration.spec.ts`: real worker match and mismatch; UI reason limitation below |
| S2 | Compare grant ID with hello worker ID, leaving local entry ID separate (`machines-service.ts:186`) | `machines-service.spec.ts`: mismatched grant stores nothing |
| S3 | Validate workspace remote argv with a strict allowlist (`ssh-worker-commands.ts:46`) | `ssh-worker-commands.spec.ts`: semicolon, substitution, backtick, space, newline |
| S4 | Fixed text for worker errors (`machines-rpc.handlers.ts:17`) | `machines-rpc.handlers.spec.ts`: hostile detail absent |
| S5 | Keep capped stderr on separate error property (`ssh-stdio-transport.ts:72`) | `ssh-stdio-transport.spec.ts`: stderr separate |
| S7 | Set `ws` maxPayload to protocol limit (`machine-connection.ts:85`) | `machine-connection.regressions.spec.ts`: S7 checks `maxPayload` at WebSocket creation |
| S8 | Cap registry read at 256 KiB and machine count at 256 (`machine-registry.ts:22,39`) | `machine-registry.spec.ts`: both caps |
| S9 | Use crypto UUID for temp name (`machine-registry.ts:63`) | Existing atomic write spec; no UUID assertion |
| L1 | Drop a failed reattach while retaining the connection (`machine-connection.ts:266`) | `machine-connection.regressions.spec.ts`: L1 failed reattach drops cursor, remains connected |
| L2 | Suppress self-close callback during failed open (`machine-connection.ts:291`) | `machine-connection.regressions.spec.ts`: L2 own close yields 1/2/5/10/30/30 s |
| L3 | Serialize `list()` and check dispose around token read (`machines-service.ts:74,120`) | `machines-service.spec.ts`: concurrent lists create once |
| L4 | Write registry before token deletion; always dispose in finally (`machines-service.ts:269`) | `machines-service.spec.ts`: deletion failure disposes |
| L5 | Typed service and SSH errors map to fixed W11 codes (`machines-rpc.handlers.ts:30`) | `machines-rpc.handlers.spec.ts`: worker and SSH mapping; existing error map cases |
| L6 | Track cursor before attach and dedupe same-epoch events (`machine-connection.ts:194,363`) | `machine-connection.regressions.spec.ts`: L6 early replay, duplicate suppression, reconnect cursor |
| L7 | Capture socket generation and ignore stale callbacks (`machine-connection.ts:100,130`) | `machine-connection.regressions.spec.ts`: L7 old socket close/error cannot affect new transport |
| L8 | In-flight retry returns unchanged promise; disposed checks after open awaits (`machine-connection.ts:209,235`) | `machine-connection.regressions.spec.ts`: L8 exact in-flight promise and dispose during open |
| L9 | Reject connected pair; best-effort revoke new token when persistence fails (`machines-service.ts:180,194`) | `machines-service.spec.ts`: L9 connected pair preserves link; failed storage calls revokeSelf |
| L10 | Remote readiness failure yields `remote: null` and local self-test (`machines-service.ts:289`) | `machines-service.spec.ts`: L10 remote failure still returns local readiness |
| L11 | Set local version before hello (`machine-connection.ts:231`) | `machine-connection.regressions.spec.ts`: L11 hello mismatch retains local version |
| L12 | 4401/4410 clears memory token and requests keyring deletion (`machine-connection.ts:164`) | `machine-connection.regressions.spec.ts`: L12 both close codes clear token and request deletion |
| L13 | Catch both fire-and-forget broadcast rejections (`machines-service.ts:92`) | `machines-service.spec.ts`: L13 rejected event/state broadcasts settle without unhandled rejection |

## Decisions

- `grant.machineId` and `hello.worker.machineId` are both worker identity by the worker-protocol schemas and worker-runtime identity flow. The registry's `machineId` remains a local key. Existing unpaired entries have no worker ID until paired; this preserves registry compatibility. Reversible via registry migration.
- `invalid-output` maps to `MACHINE_VERSION_MISMATCH`, since malformed worker command output is incompatible with this client. Reversible by changing the mapping.
- Removal writes the registry before deleting the keyring token, then disposes even on failure. This avoids leaving a live connection after credential deletion. Reversible within the service.

## Deferred

- S6 renderer payload sanitizing belongs to Phase F.
- The `machines:state` reason field is deferred to Phase F (shared contract and Machines view). The connection currently records the alias mismatch reason internally.
- S10 pairViaSsh read race is benign as reviewed.
- Cross-process registry locking was excluded from this round.
- Existing loose directory permissions are not tightened; the registry contains no token.

## Verification

Command: `npm run verify -- -p @ptah-extension/remote-machines -- --output-style=static > /tmp/p-e-fix1b-lane.log 2>&1; echo exit=$?`

Final run: `exit=0`; `Successfully ran targets lint, typecheck`; `58 passed, 58 total`; `Successfully ran target test`; no `Failed tasks` line. The first run stopped at spec fixture type errors; the second exposed the `ws` type declaration's net.Socket constraint and one lint issue. Both were corrected before the final run. No app files changed. Prettier ran on the changed source and spec files.

New spec exposed a production bug: the `async` wrapper on `connect()` returned a different promise from the in-flight operation, so `retry()` could not return the same promise. `connect()` now returns its tracked promise directly (`machine-connection.ts`). The socket factory was also made injectable to prove generation handling and the `maxPayload` option without real SSH. The ws `createConnection` declaration accepts `net.Socket`, while the working transport is a Duplex; an explicit type assertion is confined to that boundary.

## Clarifications Needed

None for this scoped spec follow-up. The renderer reason field was deferred to Phase F by the orchestrator.

Pre-existing changes not made here: `.ptah/specs/TASK_2026_858_f7b9/decisions.md` was already modified, and both review files were untracked when this lane started. No matching coding skill was available through this CLI's skill mechanism; the Ptah skill search tool is harness inventory only.
