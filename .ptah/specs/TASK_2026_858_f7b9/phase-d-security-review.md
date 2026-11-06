# Phase D Security Review — TASK_2026_858_f7b9 (Ptah remote workers)

Reviewer: Claude (independent of the Codex lanes that wrote the code). Protocol: review-security (OWASP-style).
Scope: `libs/backend/worker-runtime`, `libs/backend/worker-host`, `apps/ptah-electron/worker-host/*`, `validate-deps.js`, electron-builder/project.json changes, plus the protocol limits in `libs/worker-protocol` and the engine paths they call.
Method: static read only. No Nx/Jest, no sockets opened. Line numbers are against the worktree HEAD (3b7fbb05c). Where a line number is approximate it is marked `~`.

## Summary

| Metric  | Value                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- |
| Score   | **6.5 / 10**                                                                                    |
| Verdict | **NEEDS_REVISION** (fix findings 1 and 2 before shipping Phase D; 3 to 8 before external users) |
| High    | 2                                                                                               |
| Medium  | 6                                                                                               |
| Low     | 7                                                                                               |
| Info    | 3                                                                                               |

Threat model used: loopback listener on 41873, remote desktops arrive via `ssh -W`, but any local user or process on the worker machine can open the socket. Pairing code is a 40-bit code with a time window and 5 attempts. Admin key lives in `~/.ptah/worker/admin.key`.

## Security strengths (verified, with evidence)

- Loopback literal enforced, anything else throws: `worker-server.ts:21-22`. Upgrade requires exact path `/rpc`, no `Origin` header, and a `Host` of `127.0.0.1:<port>` or `localhost:<port>`: `worker-server.ts:33-53`. This blocks browser CSWSH and DNS rebinding. Non-browser local clients can still connect (by design).
- State machine denies everything except `hello`, then `pair.exchange`/`auth`, before authentication: `connection.ts:~169-182`. Pre-auth frames capped at 4 KiB, transport `maxPayload` 1 MiB: `worker-server.ts:28-31`, `frames.ts:34-40`. 10 s auth timeout.
- Every remote method goes through `dispatchWorkerMethod`, which parses params, runs `WorkerAuthorizer.check` against the token grant, and only then calls the handler: `worker-methods.ts:70-90`. `session.*` and `permission.respond` are `session` resources; `sessions.list`/`session.start` are `workspace` resources: `worker-methods.ts:46-57`. A client connection can never reach the admin branch because `admin` is derived from the connection state (`connection.ts:~182-189`) and `serve.ts:272-275` routes non-admin to `sessions.handle`.
- Admin methods exist only behind `state === 'admin'`, authenticated with a 32-byte key compared by `timingSafeEqual`: `admin-key.ts:20-29`, `connection.ts:~153-160`.
- Pairing: hash+salt of the code, constant-time compare, equalized work for "no window" (`pairing-window.ts:102-136`), 250 ms floor, exponential per-connection backoff and close after 3 failures (`connection.ts:~232-242`), window consumed on success so only one winner (synchronous section, no await between check and `close()`).
- Tokens: 256-bit secret, only SHA-256 stored, constant-time compare, dummy comparison when the token id is unknown (`token-store.ts:80-100`). File is 0600, written to a `wx` temp file and renamed (`token-store.ts:112-121`). `load()` refuses a token file with group/other bits (`token-store.ts:30-33`).
- Permission spoofing across sessions is closed: `PendingPermissionIndex.answer` requires `entry.sessionId === sessionId` and consumes the entry before calling the SDK handler (`pending-permissions.ts`, `answer`), and the dispatcher has already proved the session belongs to the caller's grant.
- Path traversal: session ids used as log file names are re-validated with `^[A-Za-z0-9_-]{1,256}$` (`session-event-log.ts:102`); workspace paths are `realpath`-canonicalized and ids are hashes (`workspace-registry.ts register`). Remote clients cannot supply a workspace path, only an id that must be in their grant.
- Errors returned to clients are mapped to a fixed allow-list of codes (`connection.ts:~206-228`); internals are not echoed.
- `--auto-approve` and `PTAH_AUTO_APPROVE=true` are refused in both `WorkerService.start` (`worker-service.ts:62-65`) and `serveCommand` (`serve.ts:77-80`). But see finding 1.

## Findings

### 1. HIGH — Auto-approve refusal is bypassed by persisted autopilot settings (CWE-863, CWE-693)

- Where: `serve.ts:77-80`, `pending-permissions.ts assertManualApproval`, `worker-service.ts:62-65` (the only guards); `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:140-157` (what actually decides).
- Evidence: the refusal only inspects `argv` and `PTAH_AUTO_APPROVE`. But `ConfigRpcHandlers` is registered in the CLI engine container (`cli-engine/src/lib/container.ts:895`) and on registration reads `autopilot.enabled` and `autopilot.permissionLevel` from the shared settings store and calls `permissionHandler.setPermissionLevel(...)`. `SdkPermissionHandler` then auto-approves every tool when the level is `yolo` and auto-approves file tools in `auto-edit` (`agent-sdk/src/lib/sdk-permission-handler.ts:521,596-609`). Nothing under `worker-runtime` or `worker-host` pins the level to `ask` (`grep autopilot|yolo` over both libs: no hits).
- Exploit sketch: the operator once enabled autopilot yolo in the desktop or CLI on the same machine (settings are per-user and shared). Starts `ptah-worker serve`. A paired remote client sends `session.start`; the engine runs shell and file tools without ever emitting `permission:request`. The operator's "manual approval only" guarantee (plan Round 6) is silently void, and `ptah-worker status` gives no signal.
- Fix: in `serveCommand` after the engine is up, force `permissions.setPermissionLevel('ask')` and make it sticky (re-assert on every `chat:start`/`chat:continue` via the `levelResolver`, or refuse `config:autopilot-*` writes in the worker host profile). Also refuse startup (or warn in readiness `checks`) when `autopilot.enabled` is true. Add a spec that starts the worker with a yolo setting and asserts a tool request produces `permission:request`.
- Confidence: medium-high. I did not run the worker; confirm the registration path in `host-profile/manifest.ts:229` is active for `host: 'worker'` (the worker profile sets `hostHandlers: {}` but uses the shared manifest).

### 2. HIGH — Token revocation and grant changes are not enforced on live connections; operator has no revoke (CWE-613, CWE-285)

- Where: `connection.ts:~170` (grant and tokenId snapshotted at `auth`, never re-read), `remote-sessions.ts:418-432` (`token.revokeSelf` closes only the caller's peer), `serve.ts:265-364` (admin surface is `pairing.open`, `grants.list`, `grants.add`, `status` only).
- Evidence: `TokenStore.authenticate` is consulted once per connection. `revokeSelf` sets `revokedAt` but another connection holding the same token keeps its snapshot and keeps working until it disconnects. There is no `admin.grants.revoke` or `admin.grants.remove` method, no CLI verb for it, and `grants add` only widens.
- Exploit sketch: a laptop is lost or a token is exfiltrated. The legitimate user cannot be reached to run `revokeSelf`. The operator can only hand-edit `tokens.json`, and the running worker never re-reads it (only `grants add` and `revokeSelf` call `tokens.load()`, `serve.ts:257-261,324`). The attacker keeps an open `ssh -W` tunnel session indefinitely (ping/pong keeps it alive) and keeps driving agents with the old grant.
- Fix: add `admin.grants.revoke <tokenId>` and `admin.grants.remove <tokenId> <workspace>`; on revoke, iterate `server.connections`, close every connection whose `tokenId` matches with the REVOKED close code. Re-evaluate the grant per request (`tokens.authenticate`-by-id at dispatch) instead of caching it for the connection life. Make `revokeSelf` close all connections of that token.

### 3. MEDIUM — Admin key and tokens are sent to whatever listens on the endpoint port; stale `endpoint.json` enables capture (CWE-296, CWE-319)

- Where: `status.ts:10-49` (`runningEndpoint`), `admin-client.ts:14-29`.
- Evidence: `runningEndpoint` trusts `endpoint.json` and only checks that a TCP connect succeeds, then `adminCall` sends `auth {admin: <key>}` over `ws://` with no proof that the peer is the worker. `endpoint.json` is removed only on clean shutdown (`worker-service.ts:159-160`), so after SIGKILL/OOM/power loss it stays. Port 41873 is unprivileged.
- Exploit sketch: worker is killed uncleanly. Another local user (or process) binds 127.0.0.1:41873 and answers the handshake. The operator runs `ptah-worker pair`. The squatter receives the 32-byte admin key in the `auth` frame and now owns the real admin channel for the key's lifetime (the key never rotates). The same squatter also receives pairing tokens from remote desktops that tunnel to 41873.
- Fix: the key must never be sent first. Use a challenge-response (server sends a nonce in the `hello` result, client sends HMAC(key, nonce || "admin")) so a squatter learns nothing reusable; check the peer pid/uid via `/proc/net/tcp` or a unix-socket admin channel in the 0700 directory. Also make the worker refuse to start when the previous `endpoint.json` points at a live non-worker, and rotate the admin key when `createAdminKey` is invoked by an explicit `ptah-worker rotate-key`.

### 4. MEDIUM — No limit on concurrent connections; receive queue is unbounded (CWE-400, CWE-770)

- Where: `worker-server.ts:42-59` (no cap, no per-IP cap; all ssh -W traffic is one source anyway), `connection.ts:~105` (`this.receiving = this.receiving.then(...)`), `connection.ts:~183` (`inFlight >= maxInFlightRequests`).
- Evidence: any local process can open unlimited sockets, each with two timers and a ws buffer (1 MiB frame ceiling at the transport, 4 KiB only enforced after the whole message is buffered and decoded, `connection.ts:~157-163`). Because the queue is a serial promise chain, `inFlight` can never exceed 1, so the `WORKER_BUSY` guard of 64 is dead code and nothing bounds queued frames while a slow handler runs (e.g. `session.start` waits up to 30 s, `remote-sessions.ts:44`). An authenticated client can stack thousands of 1 MiB frames in memory.
- Exploit sketch: loop of `new WebSocket(...)` until EMFILE, or an authed client streaming `sessions.list` frames while a `session.start` is pending, driving the worker to OOM and killing the other sessions' turns.
- Fix: cap connections (e.g. 32 total, 4 unauthenticated; drop oldest unauthenticated), set `socket.pause()`/count queued frames and close with `THROTTLED` beyond N; set transport `maxPayload` to the pre-auth size until authenticated (use `webSockets.options.maxPayload` per socket via `verifyClient` or close at `message` when `data.length` exceeds the bound before `toString()`); reorder the in-flight check so it counts queued, not running, requests.

### 5. MEDIUM — Local process can burn the pairing window; throttling is per connection only (CWE-307, CWE-770)

- Where: `pairing-window.ts:86` (`attemptsLeft: 5`, global to the window), `pairing-window.ts:124-128`, `connection.ts:~232-242` (backoff state lives on the connection object).
- Evidence: backoff and the 3-failure close are per connection; a new connection resets them. The only cross-connection limit is the global 5 attempts, which a local attacker consumes in about 2 seconds, closing the window before the legitimate user types the code. Brute force of the 40-bit code itself is infeasible (5/2^40), so this is availability, not takeover.
- Exploit sketch: operator runs `ptah-worker pair --ttl 300`; any local process loops hello + pair.exchange("AAAA-AAAA") x5. The window is gone; the operator must reopen it, forever.
- Fix: count only attempts that cannot be attributed to a verified-wrong code from a prior legitimate client is hard, so instead (a) require 10-20 attempts but rate-limit globally to 1 per second across connections, (b) show `attemptsLeft` and a "window burned by N failed attempts" line in `ptah-worker status`, and (c) emit a `pairing.failed` audit line with connectionId. Also reduce the damage of a guessed window: grant only the workspaces passed with `--workspace` unless `--all` is explicit (default is every registered workspace, `pairing-window.ts:77`).

### 6. MEDIUM — Token store has unlocked writers; revoked token can be resurrected, grants lost (CWE-362)

- Where: `token-store.ts:53-78` (`issue`, called from `connection.ts:~244` with no lock), `token-store.ts:102-112`, `serve.ts:313-341`, `serve.ts:257-261`.
- Evidence: `issue()` snapshots `this.records` synchronously, then awaits the file write; `revoke` and `grants add` run under `withFileLock` but `issue` does not, and they replace `this.records` (via `load()`/`save()`). Interleave: client A calls `token.revokeSelf` (writes revokedAt), meanwhile client B finishes `pair.exchange`; `issue()` renames its older array (without the revocation) over `tokens.json` and sets `this.records` to it. A revoked token is valid again and the revocation is silent. The same interleaving drops a freshly granted workspace.
- Additionally `grants add` re-implements the save with a fixed temp name and no `wx` (`serve.ts:333-337`).
- Fix: route `issue`, `revoke` and `grants add` through one `TokenStore.mutate(fn)` that takes the lock, reloads, applies, writes, and swaps `records` in one step. Do not mutate `this.records` outside it.

### 7. MEDIUM — `withFileLock` leaves a stale lock after a crash; revocation can become impossible (CWE-667, CWE-400)

- Where: `file-lock.ts` (mkdir lock, 2 s deadline, no staleness recovery, `rmdir` only in `finally`).
- Evidence: if the process dies (SIGKILL, power) between `mkdir(lock)` and `rmdir`, `tokens.json.lock` / `workspaces.json.lock` remains. Every later `revokeSelf`, `grants add`, `workspace add/remove` fails with "Worker file is busy" until a human deletes the directory. This is a security problem because the revocation path (`serve.ts:257-261`) then fails permanently. A local user cannot create the lock inside the 0700 directory, so this is not a remote DoS, but it is a persistent operational lockout.
- Fix: write the owner pid and timestamp into the lock directory and break it when the pid is dead or the lock is older than N seconds; or use `fs.open(..., 'wx')` on a lock file with `O_EXCL` plus pid check. Report the real reason to the operator (include the lock path in the CLI message only, not the wire).

### 8. MEDIUM — Workspace registry changes via CLI never reach the running worker (CWE-613)

- Where: `workspace.ts:57-90` (CLI edits `workspaces.json` on disk), `serve.ts:126` (`registry` loaded once at start), `remote-sessions.ts:163-164` (`workspaceById` reads the in-memory list), `worker-session-index.ts:12-21` (cached session to workspace map).
- Evidence: `ptah-worker workspace remove <path>` rewrites the file but the running worker keeps authorizing and starting sessions in the removed workspace until restart; `workspace add` is likewise invisible. The CLI prints success, so the operator believes access was withdrawn. `WorkerSessionIndex.sessions` also remembers session to workspace mappings indefinitely.
- Fix: send workspace changes over the admin channel (`admin.workspace.add/remove`) and mutate the live registry, or have `register`/`list` reload the file under the lock. Clear the session index entries for the removed workspace and close sessions it drives.

### 9. LOW — Log redaction is narrow, partially wired, and has known gaps (CWE-532)

- Where: `redact.ts:1-28`; sole use `in-process-rpc.ts:146`; `serve.ts:106-108` (logger writes raw messages to stderr); `serve.ts:365-386` (no `onError` passed, so connection errors are dropped).
- Evidence: the bare 8-char pairing code (no dash) is not matched (`PAIRING_CODE` requires `XXXX-XXXX`; `normalizePairingCode` accepts undashed input), `code` is not in `SECRET_FIELD` (`pair.exchange` params use `code`), and `redactLogRecord` is never called by anything. `systemd` journal collects stderr, so any future log of params or a ws error message would persist the code or token. `BARE_KEY` redaction hides 43-char runs only. Positively, the current logs use `error.name` only.
- Fix: add `code`, `authorization`, `cookie`, `password`, `apiKey` to `SECRET_FIELD`; match undashed 8-char codes only inside `code` keys; wire `redactLogRecord` into the single logger; wire `onError` to a logger that prints `error.name` and connection id (observability gap: transport and handler errors are currently invisible).

### 10. LOW — keytar optional fallback derives the master key from `username:hostname` (CWE-321, CWE-798)

- Where: `apps/ptah-electron/scripts/validate-deps.js` (`OPTIONAL_WORKER_HOST_IMPORTS = new Set(['keytar'])`), `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts:186-204`.
- Evidence: headless Linux workers usually have no libsecret, so the worker silently runs with an HKDF key whose only inputs are the username, the hostname and a constant salt in the shipped bundle. Anyone who can read the encrypted settings file (backup, snapshot, other admin) can decrypt it offline. Decision row 21 says workers use provider CLI logins only, which limits what is stored, but the fallback still protects whatever the engine stores.
- Fix: in worker readiness, report a `warn` check "master key is derived (no OS keychain)"; store a random 32-byte key in a 0600 file (`~/.ptah/worker/master.key`, created with `wx`) rather than a derivable one; keep the optional-import allowance only if that file key replaces HKDF for the worker host.

### 11. LOW — Launcher and systemd unit are not hardened (CWE-250, CWE-732)

- Where: `apps/ptah-electron/worker-host/ptah-worker.service`, `ptah-worker:~18-24`.
- Evidence: no `UMask=0077`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=`, `ProtectKernel*`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`. `WantedBy=default.target` is correct for a user unit, but nothing says so: copied into `/etc/systemd/system` the unit has no `User=` and runs the agent (shell tools) as root. The launcher exports `ELECTRON_RUN_AS_NODE=1` into the agent's environment, which every spawned tool and provider CLI inherits (any Electron binary a tool launches will run as plain Node). `NODE_OPTIONS` and `ELECTRON_*` from the caller are not cleared (same-user only, but relevant under `sudo -E`/systemd drop-ins). The launcher resolves its own location via `readlink`/`cd -P` correctly and `exec` passes `"$@"` quoted, so no injection there.
- Fix: add the sandbox directives above, `UMask=0077`, a comment "install as a user unit only", `ConditionUser=!root`, and unset `ELECTRON_RUN_AS_NODE` for child processes (set it only for the exec'd process via `env`, and have the worker delete it from `process.env` on start).

### 12. LOW — Worker directory ownership and mode are assumed, not verified (CWE-732, CWE-367)

- Where: `paths.ts:26-28`, `admin-key.ts:14-18`, `token-store.ts:30-33`, `worker-service.ts:82-88`.
- Evidence: `mkdir(..., {mode: 0o700})` only applies at creation. A pre-existing `~/.ptah/worker` at 0755 (created by an older build or by `mkdir`) leaves `endpoint.json`, `events/*.jsonl` (full conversation transcripts) readable by other users; `admin.key` is read with no mode or owner check (the token file is checked, the admin key is not). `createAdminKey` renames onto the final name without checking whether another process created it between `readAdminKey` ENOENT and the rename, so two first-run starts can hand out different keys (the loser still fails on the port, but its key file wins). Temp/rename writes have no `fsync`, so a crash can leave an empty `tokens.json`; `load()` then throws "Invalid worker token store" and the worker will not start (fail closed, but availability).
- Fix: `ensureWorkerDirectory` should `lstat` the directory, require `uid === process.getuid()`, not a symlink, and `chmod 0700`; check admin key mode like tokens; create the admin key with `link()`-style exclusive creation; `fsync` the temp file and directory before/after rename.

### 13. LOW — Session index refresh is an amplification primitive for authenticated clients (CWE-400)

- Where: `worker-session-index.ts:12-21`, `remote-sessions.ts:165-179`.
- Evidence: `workspaceOf` for an unknown session id re-lists every workspace in the grant (`session:list`, limit 500) through the engine on each call; `session.attach` and `session.stop` take caller-chosen ids, so unknown ids cost O(grant size x 500) engine work each, and `listSessions` also calls `workspaces.addFolder` every time.
- Fix: negative-cache unknown ids for a few seconds, rate-limit per connection, and avoid `addFolder` in the lookup path.

### 14. LOW — Event logs grow without bound and are fully read on open (CWE-770)

- Where: `session-event-log.ts:97-125` (`handle.readFile('utf8')` of the whole file on open and on `recoverLogs` at start, `worker-service.ts:126-144`).
- Evidence: a long agent session with large tool outputs produces a multi-hundred-MB jsonl; startup then reads every log into memory. Combined with `maxPayload` 1 MiB frames the disk can be filled by a granted client.
- Fix: size cap per session with rotation, stream the header/tail on open instead of `readFile`.

### 15. LOW — Predictable temp names and non-exclusive writes in admin paths (CWE-377)

- Where: `workspace.ts:85-87`, `serve.ts:333-337` (`<file>.<pid>.tmp`, no `wx`), `worker-service.ts:82-88` (`endpoint.json.<pid>.tmp` with `wx`; leftover from a recycled pid makes `wx` fail and the worker refuse to start).
- Evidence: inside a 0700 directory this is only a robustness issue, but if finding 12 occurs (loose directory) it becomes a symlink-following write. A recycled pid with a leftover `.tmp` makes `service.start()` throw EEXIST.
- Fix: use the same `randomBytes` suffix + `wx` helper in all writers (factor one `writeFileAtomic`), and delete stale temp files at startup.

### 16. INFO — Pre-auth `hello` discloses hostname, machine id and version

- Where: `connection.ts:~222-226` returns `options.identity` (`displayName: hostname()`, `machineId`, `ptahVersion`) to any unauthenticated local client. Harmless on loopback, but it fingerprints the build. Consider returning the identity only after `auth`.

### 17. INFO — Unbounded bookkeeping maps

- `permissionSessions` (`remote-sessions.ts:186`), `PendingPermissionIndex.pending`, `SessionDriver.early` keyed by tab (`session-driver.ts:42,72`) grow if requests are never answered or tabs never resolve; only the per-tab queue is capped (10 000). Add TTLs.

### 18. INFO — Pairing default scope

- `admin.pairing.open` without `--workspace` grants every registered workspace (`pairing-window.ts:72-77`, `serve.ts:281-289`). Principle of least privilege suggests requiring `--all` or printing the workspace list at confirmation. The printed workspaces in the result mitigate this.

## Security metrics

| Area                           | Score | Note                                                                             |
| ------------------------------ | ----- | -------------------------------------------------------------------------------- |
| Credential / secret management | 6/10  | Hashing and 0600 files good; admin key static and sent first; HKDF fallback (10) |
| Input validation               | 8/10  | Zod params, size caps, id regex; amplification (13)                              |
| Authentication / authorization | 6/10  | Per-method grant check solid; revocation and permission-level gaps (1, 2, 8)     |
| Data protection                | 6/10  | Transcripts depend on directory mode (12); redaction (9)                         |
| Network                        | 8/10  | Loopback literal, Origin/Host checks, path pinning; no connection caps (4)       |
| Business logic / races         | 5/10  | Token store races (6), stale locks (7), registry staleness (8)                   |

## Checks that came out clean

- Admin methods from a client token: not reachable (state-derived, `connection.ts:~182-189`; unknown names fail `Object.hasOwn` at `worker-methods.ts:77`).
- Permission response across sessions or connections of other grants: blocked (authorizer plus `entry.sessionId` match, ids consumed once).
- Pairing timing oracle and pairing brute force: no practical oracle; 40-bit code and 5 attempts.
- Path traversal through workspace registration or session ids: none (realpath, hash ids, regex on log names). Workspace registration is operator-only (CLI), not remote.
- Command injection in the launcher: none found.
- `--auto-approve` flag and `PTAH_AUTO_APPROVE=true`: refused (but see finding 1 for the settings route).

## Recommended order

1. Findings 1 and 2 (block release of Phase D remote use).
2. Findings 3, 6, 7, 8 (credential capture, token integrity, revocation reliability).
3. Findings 4, 5, then 9 to 15.
4. Add specs: yolo-setting start refusal; revoke closes all connections; stale lock recovery; concurrent `issue` + `revoke`; connection cap; `workspace remove` takes effect live.

## Residual uncertainty

Static review only; I did not execute the batch-18.3 security suite or open a socket. I did not read `transcript.ts`, `session-log-writer.ts`, `fan-out.ts`, `readiness.ts` or the `worker-protocol/client` code in full; `frames.ts` parse functions were read only for the size/shape gates. Finding 1 depends on the shared settings being the same store the operator edited; confirm in a test.
