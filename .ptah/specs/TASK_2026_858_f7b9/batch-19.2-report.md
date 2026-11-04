## Files changed

- `libs/backend/worker-host/src/lib/dispatch.ts`: `node:util` argument parsing and lazy command imports. Platform core is initialized before any runtime barrel; operator commands do not import `cli-engine`.
- `libs/backend/worker-host/src/lib/commands/{serve,admin-client,locks,workspace}.ts`: serve boot, administrative WebSocket client, lock A8 smoke, and lazy value imports to satisfy Nx module boundaries. Existing `status`, `pair`, and `grants` commands remain in use.
- `libs/backend/worker-host/src/lib/{dispatch,worker-host-profile}.spec.ts` and `src/lib/commands/serve.spec.ts`: command JSON/exit coverage, in-process RPC parity, refusal checks, and a stub-bootstrap WebSocket integration spec.
- Existing `src/worker-host.entry.ts` and `src/index.ts` provide the command entry and exports.

## Decisions

- The dispatcher uses type-only runtime imports and loads each command inside its switch branch. It loads `platform-core` first to avoid the observed Jest `PLATFORM_TOKENS` initialization cycle. Serve loads the CLI engine only after preflight checks.
- Serve uses `withEngine({}, { mode: 'full', thoth: 'off', hostProfile: createWorkerRpcHostProfile(), pushAdapter, bootstrap? }, ...)` and `WorkerService` for loopback listening, endpoint publication, log recovery, and shutdown. `WorkerService` calls `createWorkerServer`.
- Serve calls `fixPath()`, refuses auto approval, Node < 22 and a failed `better-sqlite3` in-memory open, reads the package version beside the bundle, and supplies Claude CLI, auth route, SQLite, version, workspace, lock, and listener readiness ports. The bootstrap and preflight checks are injectable in specs.
- Pairing and grants use the admin WebSocket. `grants add` rewrites the token store atomically and reloads it. The lock self-test acquires, lists, requests release, and disposes a real platform lock.

## Spec coverage

| Requirement                                                                                                                   | Spec                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `serve` listener on port 0, stub `withEngine` bootstrap, real `ws` hello, shutdown                                            | `commands/serve.spec.ts`: `starts a loopback WebSocket through withEngine and stops on shutdown` |
| Auto approval flag/env, Node < 22, SQLite failure refusal before bootstrap                                                    | `commands/serve.spec.ts`: `refuses auto approval, old Node, and SQLite failure before bootstrap` |
| A8 lock command flow (platform lock calls mocked in the spec)                                                                 | `dispatch.spec.ts`: `emits one JSON line for a successful lock self-test`                        |
| CLI versus worker in-process registered RPC surface and host deltas                                                           | `worker-host-profile.spec.ts`: `matches the CLI registered methods and documented host deltas`   |
| One JSON stdout line and zero exit for status, pair, workspace list/add/remove, grants list/add, locks list/release/self-test | `dispatch.spec.ts`: JSON cases and lock cases                                                    |
| Non-TTY lock release refusal, stderr and nonzero exit                                                                         | `dispatch.spec.ts`: `refuses non-TTY release without --yes, with only stderr output`             |
| Invalid command failure exit and stderr                                                                                       | `dispatch.spec.ts`: `returns non-zero for an invalid command`                                    |
| Stopped service and in-use lock errors, stderr and nonzero exit                                                               | `dispatch.spec.ts`: stopped-service and in-use release cases                                     |
| Bundle-adjacent package version, real readiness ports, SIGTERM/SIGINT                                                         | Implemented in `serve.ts`; no focused behavioral spec yet                                        |

## Not done / Clarifications Needed

- **Task 19.2 remains incomplete:** authenticated remote session methods are not composed. The handler currently serves `machine.info` and `workspaces.list`, then rejects session and permission methods. Consequently `maxActiveTurns` is parsed but not applied; the push adapter tap and lock-release callback are placeholders. The listener can start but cannot drive remote turns.
- `admin.status` currently reports an empty locks array. The readiness auth route is built from a synthetic Claude CLI configuration instead of the engine's actual provider configuration. Pairing status does not update its attempt count after exchange.
- `workspace remove` and `grants add` perform host-side atomic file rewrites without a cross-process lock, so concurrent writes need review.
- Jest/Nx/`npm run verify` and sockets were not run in this sandbox, per instruction. The orchestrator must run `npm run verify -- -p @ptah-extension/worker-host` to confirm the module-load-order fix and WebSocket spec.
- Static checks passed: `npx tsc --noEmit -p libs/backend/worker-host/tsconfig.lib.json`, `npx tsc --noEmit -p libs/backend/worker-host/tsconfig.spec.json`, and `npx eslint libs/backend/worker-host/src`. `npx prettier --write` completed for every changed source/spec and this report.
