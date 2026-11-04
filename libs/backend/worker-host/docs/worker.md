# Ptah worker operator guide

## Install and prerequisites

Install the Ptah desktop Linux deb build on the worker machine. Its launcher is `/opt/Ptah/resources/bin/ptah-worker`; it uses the desktop package's bundled runtime. No separate Node or npm install is needed. AppImage, Windows, and macOS are not supported worker install paths.

Sign in to at least one provider CLI (`claude` or `codex`) as the worker user. Worker authentication uses provider CLI logins. Desktop API keys are not shared, and there is no `auth set-key` command. Ensure SSH access to the worker and allow SSH TCP forwarding.

Register an existing directory before pairing:

```sh
/opt/Ptah/resources/bin/ptah-worker workspace add /path/to/project
```

## Start and stop

```sh
mkdir -p ~/.config/systemd/user
cp /opt/Ptah/resources/bin/ptah-worker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ptah-worker
sudo loginctl enable-linger "$USER"
systemctl --user status ptah-worker
systemctl --user stop ptah-worker
systemctl --user start ptah-worker
```

The user unit runs `serve --port 41873`, restarts on failure, and stops on SIGTERM. Linger starts the user service at boot without an interactive login. The listener binds to loopback only. A second server on that port fails with a port-in-use error.

## Commands

Use the absolute launcher path above, or set `WORKER=/opt/Ptah/resources/bin/ptah-worker` in your shell. Commands that return data print formatted JSON by default; `--json` prints compact JSON. Successful commands exit 0. Argument, service, and operation errors print to stderr and exit 1. `serve` runs until stopped; it has no data result.

| Command                                           | Options and result                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptah-worker serve`                               | `--port <0-65535>` (default 41873), `--max-active-turns <1-1024>` (default 4). Starts the worker. `--auto-approve` and `PTAH_AUTO_APPROVE=true` are refused, and so is a persisted autopilot level of `yolo` or `auto-edit` (see below). |
| `ptah-worker status`                              | `--json`; reports readiness, pairing, and endpoint state. Requires the running service.                                                                                                                                                  |
| `ptah-worker pair`                                | `--ttl <60-900>` (default 300 seconds), repeat `--workspace <path-or-id>` to narrow the grant, `--json`. Opens a pairing window and returns its code and expiry. Requires the running service.                                           |
| `ptah-worker workspace add <path>`                | Registers an existing workspace; `--json` for compact output. Goes to the running service when it runs, so the change applies at once; otherwise edits the registry file.                                                                |
| `ptah-worker workspace remove <path-or-id>`       | Removes a registration; `--json` for compact output. Goes to the running service when it runs: grants stop covering the workspace at once. Otherwise edits the registry file.                                                            |
| `ptah-worker workspace list`                      | Lists registrations; `--json` for compact output.                                                                                                                                                                                        |
| `ptah-worker grants` or `grants list`             | Lists token grants; `--json` for compact output. Requires the running service.                                                                                                                                                           |
| `ptah-worker grants add <tokenId> <workspace...>` | Adds registered workspaces to a token grant; `--json` for compact output. Live connections of the token use the new grant from their next call. Requires the running service.                                                            |
| `ptah-worker grants revoke <tokenId>`             | Revokes the token and closes its live connections with `revoked` (4410); `--json` for compact output. Reports the revocation time and the number of connections closed. Requires the running service.                                    |
| `ptah-worker locks`                               | Lists local driver locks; `--json` for compact output.                                                                                                                                                                                   |
| `ptah-worker locks --self-test`                   | Checks acquisition, listing, and release of a local lock; `--json` for compact output.                                                                                                                                                   |
| `ptah-worker locks release <sessionId>`           | Requests release. Prompts on a TTY; use `--yes` in scripts. `--json` for compact output. Refuses an in-use or unavailable lock.                                                                                                          |

## Pairing and tokens

A pairing code is valid for 300 seconds by default, with a range of 60–900 seconds. Opening another window closes the prior one. A successful exchange closes the window. Five wrong exchanges close it; a connection closes after three failures with increasing delay. The default grant snapshots the workspaces registered when the window opens. Use `grants add` for workspaces registered later.

Issued tokens have no scheduled expiry. They remain valid until revoked, either by the operator with `grants revoke <tokenId>` or by a client with `token.revokeSelf`. A revocation closes every live connection of that token at once. `grants list` shows when each token last authenticated (`lastUsedAt`, updated at most once a minute). Tokens and grants live in `~/.ptah/worker/tokens.json`, which must be owner-readable only (mode 0600). Protect the pairing code and token as credentials.

Operator commands and the service change `tokens.json` and `workspaces.json` under a lock directory beside each file (`tokens.json.lock`, `workspaces.json.lock`) that records its owner's PID. A lock left by a process that died is taken over automatically, so no manual cleanup is needed after a crash. A lock held by a live process for more than two seconds fails the command with "Worker file is busy".

Before an operator command sends the admin key, it checks that `endpoint.json` names a live process of this user and that the listener reports this machine's worker ID. Otherwise the command fails and the key is not sent. An `endpoint.json` left by a stopped worker is treated as a stopped service.

## Sessions, permissions, and locks

Remote events are written in order to one JSONL file per session under `~/.ptah/worker/events/`. The worker writes before publishing an event and syncs at each turn end and at most once per second during a turn. This protects against a worker process crash, not power loss. On restart, a torn final line is removed and an unfinished turn is marked interrupted. A log append failure aborts the turn, degrades the session, and rejects later continuation until restart.

Permission answers use the existing SDK timeout. A request with `timeoutAt: 0` waits indefinitely; the first answer wins, and late or duplicate answers fail. Remote workers require manual approval. Because the worker shares `~/.ptah/settings.json` with the desktop, `serve` refuses to start while autopilot is enabled at `yolo` or `auto-edit`; turn autopilot off or set it to `ask` first (`plan` is allowed). The worker re-reads the setting before every remote turn and refuses the turn (`INTERNAL`, with the reason on the worker's stderr) if autopilot was switched to one of those levels while it runs.

The worker serves at most 64 connections at once; a further connection is closed with `throttled` (4429). Each connection may have 64 requests queued or running; a further request gets `WORKER_BUSY`.

The worker and desktop GUI share per-session kernel driver locks. A turn held by the GUI is refused on the worker, and vice versa; unavailable lock control fails closed. Attach can show a snapshot while another process drives. Use `locks` to inspect and `locks release` only for recovery. Native Codex (`codex-app-server`) sessions can be locked by the desktop, but this worker cannot drive them; continuation returns `CODEX_UNAVAILABLE`. Older desktop builds without worker mode must be updated before pairing.

The worker runs beside the desktop GUI. It does not take the GUI single-instance lock or open Electron userData. Both read `~/.ptah/settings.json` and share session state and provider CLI logins. A concurrent whole-cache settings write can revert a GUI edit; avoid editing settings in both processes at once. Only the worker owns port 41873.

## Remote capability table

The rows below are generated from `WORKER_CAPABILITIES` in `worker-capabilities.ts`. The companion spec checks them against the exported runtime data.

<!-- capability-table:start -->

| Capability         | Status               | Reason or phase                                                   | Remote methods                                                                                                                                                    |
| ------------------ | -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core chat/session  | supported            | —                                                                 | machine.info, workspaces.list, sessions.list, session.attach, session.detach, session.start, session.continue, session.stop, permission.respond, token.revokeSelf |
| memory             | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| skillSynthesis     | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| cron               | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| review             | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| gateway            | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| voice              | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| persistence        | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| workspaceLifecycle | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| editorLauncher     | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| fileOpen           | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| filePicker         | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| filePickerImages   | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| fileSystemAccess   | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| fileViewer         | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| fileEditor         | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| commandExecution   | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| appUpdater         | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| goVetDiagnostics   | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| lanePlanLimits     | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| providerAccounts   | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| gitRootWatch       | unsupported-remotely | Phase 1 exposes only the core chat and session methods.           | —                                                                                                                                                                 |
| remoteMachines     | not-applicable       | The worker is the remote endpoint; Electron owns SSH connections. | —                                                                                                                                                                 |

<!-- capability-table:end -->

## Phase 1 exit runbook

1. Install the Linux deb on a worker, sign in to a provider CLI, register a workspace, enable the user unit and linger, then confirm `status --json` reports readiness.
2. Open `pair --json` on the worker. Pair from the desktop and confirm its grant contains the intended workspace. Start a remote session, attach, answer a permission request, and reconnect to replay events.
3. **A1:** From the desktop machine, exercise a real SSH transport to the worker loopback listener: `ssh -o BatchMode=yes -W 127.0.0.1:41873 <alias>`. Use the desktop remote client over that Duplex and verify `/rpc` pairing, authentication, and a session event. Record the result; a bare SSH command will wait for protocol traffic.
4. **A10:** On the installed deb, run `ELECTRON_RUN_AS_NODE=1 /opt/Ptah/ptah-desktop /opt/Ptah/resources/app.asar/worker-host.mjs status --json` and the launcher `ptah-worker status --json`. Confirm bundled Node and `better-sqlite3` pass readiness. This validates node mode of the packaged binary, not a system Node install.
5. Stop the user unit, restart it, and confirm transcript recovery and lock release. Check the desktop GUI can start and stop independently.

## Uninstall

```sh
systemctl --user disable --now ptah-worker
rm -rf ~/.ptah/worker
```

The removal deletes worker tokens, grants, and event logs. Remove the copied user unit and run `systemctl --user daemon-reload` if the worker service is no longer needed. Disable linger separately if no other user services need it.
