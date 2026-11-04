# Requirements - TASK_2026_858_f7b9

Remote workers and a mobile-first Ptah PWA.

## Context

The user runs Ptah on three LAN machines (Horus, Anubis, Chappie) as well as the main machine
(amun-PC). They want to control all of them from one interface without remote desktop. A
fourth machine, Gatsby, only serves the `d3:4b` decision model through an SSH tunnel and runs no
Ptah. The product goal goes beyond the user's own fleet: an installable, mobile-first PWA that
sits beside Ptah and that any Ptah user can open from a phone or another machine, from anywhere.
In it they start and watch sessions, approve tool use, and get notifications. The user named
t3code remote access as the reference product. Each worker must also keep a full local Ptah that
someone at that machine's keyboard can use
(`.ptah/specs/council-remote-machines/HANDOFF.md`, "Goal").

A Council of two vendors (codex and kimi) reached a shared verdict. Each worker runs its own
headless Ptah service. Electron is the first unified client and a browser comes later. Each
machine owns its own state and secrets. Transport starts with SSH, then moves to Tailscale or
TLS with pairing and scoped tokens. Events go into a durable log with dedupe and snapshots. The
worker gets a new composition root whose host profile is audited against Electron's
(`P1-critique.md` "Revise?", `P2-critique.md` "Revise?" and flaw 5). The two vendors disagreed on
Phase 1 (see Risks R1 and User decision U1).

Today's code has these gaps and pieces to build on:

- No remote access to a full Ptah exists. `ptah interact` (`apps/ptah-cli/src/cli/commands/interact.ts`)
  is a stdio JSON-RPC loop with one chat session per process. It rejects only an overlapping
  in-flight turn (`interact.ts:414-418`). It shuts down on stdin EOF, and its `rpc.call` forwards
  any registered method string with no per-method authorization (`P1-critique.md` flaws 4 and 7).
- `session.history` returns no transcript (`interact.ts:516-541`), because `session:load` returns
  `messages: []` by design (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:744`).
- Electron's `sendToRenderer` reports a stream event as delivered when it is only queued
  (`apps/ptah-electron/src/ipc/ipc-bridge.ts:205-210`). A remote client therefore cannot rely on
  host-side "delivered" flags.
- The webview's RPC goes through one seam, `ClaudeRpcService`
  (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:108`), which posts through
  `VSCodeService` (`:247-250`).
- Electron declares its RPC capability set in `apps/ptah-electron/src/rpc-host-profile.ts:19-55`
  and composes it through `registerRpcSurface()`, called at
  `apps/ptah-electron/src/activation/wire-runtime.ts:337` (`apps/ptah-electron/src/di/phase-4-handlers.ts`
  only registers the handler classes).
- `electron-http-server-provider.ts` (`libs/backend/platform-electron/src/implementations/`) binds
  short-lived loopback listeners.
- `chat:resume` already refuses a webview resume of a session that a messaging binding drives
  (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:278-283`, error
  `SESSION_ATTACHED_TO_GATEWAY`). The guard behind it, `AttachedSessionRegistry`, is an
  in-memory map, so the refusal holds only inside one process
  (`libs/backend/messaging-gateway/src/lib/attached-session-registry.ts:1-14,19-44`).
- No PWA, web manifest or service worker exists in the repository (`apps/` has no such app). No
  `ptah fleet` command exists in `apps/ptah-cli/src/cli/commands/`.

## Classification

- Type: FEATURE. A new capability (remote control and a new client surface), with no existing
  surface replaced.
- Estimate: XL. It spans a new worker runtime and composition root, a network RPC with auth, a
  durable event log, an Electron view, a CLI provisioning command, a new PWA app with push, and
  three transports. Each phase below is sized separately (Phase 1: L).
- Priority: not defined here. The repository has no priority scale for tasks.

## Scope

Tags: `user-requested` traces to the user's own words in HANDOFF "Goal" and "Decisions the user
already made". `pm-proposed` is a recommendation (from the Council, the HANDOFF recommendation
the user has not decided, or this document); the user may change it. `project-rule` is CLAUDE.md.

The scope below is the **recommended** scope. It assumes the recommended answer to each user
decision U1-U5. "Scope under each user decision" (after Phases) lists the clauses that change
for every other answer. Until the user answers, the alternatives stay open.

In scope (delivered across the phases below):

- A headless worker service per machine that runs a full Ptah backend (sessions, agents,
  permissions) without a display, alongside an optional local desktop Ptah. `user-requested`
  (control workers from one interface; local Ptah stays usable). The service as the mechanism
  is `pm-proposed` (Council verdict, D1).
- A worker RPC that does not depend on the transport, with pairing and scoped tokens.
  `pm-proposed` (HANDOFF recommendation; conditional on U2)
- A durable per-session event log with sequence numbers, replay, dedupe and snapshots.
  `pm-proposed` (Council)
- Session transcripts available to remote clients. `user-requested` (watch sessions)
- A Machines view in Electron. `user-requested` (one interface) with `project-rule` (Electron
  first)
- Transports, recommended order SSH, then Tailscale, then Cloudflare Tunnel with Cloudflare
  Access plus the Ptah pairing token. `pm-proposed` (recommendation, conditional on U2). The
  user raised Cloudflare Tunnel as an idea; the selection and order are undecided.
- A provisioning command `ptah fleet add`. `pm-proposed` (the fleet is the user's first real
  use; the command is the recommended way to set it up)
- The VPS case: a worker on a Linux server with no desktop. `pm-proposed` (VPS users appear in
  the HANDOFF transport recommendation)
- An installable, mobile-first PWA that starts and watches sessions, approves tool use, and
  sends push notifications. `user-requested`
- Phase 0 measurement of CPU per process tree on amun-PC and the cost of the worker service on a
  worker. `pm-proposed` (Council Phase 0)

Out of scope:

- Remote desktop or screen sharing. The user rejected it (HANDOFF "Goal").
- Remote CLI lanes, that is, running a CLI-lane agent process on a worker through an SSH stdio
  adapter, beyond a throwaway proof. This is CPU offload for lanes and not remote session
  control. It needs its own lane protocol work (`P2-critique.md` flaws 2-4). Raise a follow-up
  task if Phase 0 shows that lane CPU on amun-PC is the bottleneck. **Conditional on U1**: under
  U1 option 3 a one-lane SSH stdio proof enters scope as a spike (see "Scope under each user
  decision").
- Remote use of Electron capabilities beyond starting, watching, approving and notifying, for
  example remote file browsing, remote settings and remote provider-account management. The
  user's remote actions are those four (HANDOFF "Goal"). The capability document marks them
  "unsupported remotely" (1.2; "Phase 1 minimum capability set", list (b)). A separate task can
  add them.
- Changing the response of `session.history` in `ptah interact`. Its empty `messages` is
  documented behaviour for existing A2A callers (`interact.ts:516-541`). Remote clients get
  transcripts from the worker transcript endpoint (5.1, 5.2). A separate task can change the
  CLI contract (Decision D8).
- Syncing uncommitted worktree contents, ignored or generated files between machines, and any
  shared filesystem. Sessions run against the worker's own workspaces (`P1-critique.md` flaw 6).
  This would be a separate task.
- A central scheduler that places work across machines automatically, and a LAN-wide Nx cache or
  verify lock. Both are separate infrastructure (`P1-critique.md` flaw 6; `nx.json`,
  `scripts/verify-lock.mjs`).
- Fixing `ipc-bridge.ts:205-210` for local Electron delivery. The remote path recovers through
  sequence gaps (Req 4), so this is a separate BUGFIX task.
- TUI (`apps/ptah-tui`) and VS Code extension clients for remote machines. This is a project rule
  (CLAUDE.md "Product focus: Electron first"). Both hosts must still compile.
- Windows and macOS workers. The fleet and the VPS case are Linux (HANDOFF "Fleet state"). The
  design must not preclude them, but they are not verified here.
- Multi-user or team accounts and shared machines between different people. Pairing is
  single-owner. Teams would be a SaaS task.
- Fleet operations: copying config, Ollama binding, upgrades, and decision-model placement (see
  "Operational decisions for the user").
- Licensing or paid gating of the feature. **Conditional on U5**: out of scope under the
  recommended answer (build ungated, decide before Phase 3 release) and under option 3 (free).
  Under option 2 (gate from Phase 1) gating enters Phase 1 scope.

## Phases

This is the **recommended plan**, not a settled one. It assumes the recommended answers to U1
(Phase 1 slice), U2 (exposure model), U4 (PWA origin) and U5 (licensing). Each phase can ship on
its own, and each has its own acceptance criteria (in Requirements, tagged by phase). The user
approves or changes the order (Decision D3, a recommendation tied to U1 and U2).

| Phase | Delivers | Requirements |
| --- | --- | --- |
| 0 — Measure | A measurement report: CPU and RSS per process tree on amun-PC during a normal workload. The idle and active cost of a headless Ptah backend on one 4-core / 15 GB worker. | 10 |
| 1 — One remote machine from Electron (thin) | The Phase 1 minimum capability set (below) on one preprovisioned Linux worker: a documented install and readiness check, a loopback RPC listener, a pairing bootstrap and one token per client with resource checks, an event log with cursor replay, a transcript endpoint. The Electron Machines view reaches it through an SSH alias. | 1.1-1.7, 1.8-1.9, 2.1-2.4, 2.8-2.10, 3.1-3.4, 3.6-3.7, 4.1-4.2, 4.4, 4.7, 5, 6, 8.1 |
| 2 — Fleet | `ptah fleet add` with a worker doctor, many machines in the Machines view, Tailscale transport, scoped tokens and token management (list and revoke), browser Origin checks, multi-client delivery, snapshot fallback, the VPS/headless install, version handshake | 2.5-2.7, 3.5, 4.3, 4.5-4.6, 7, 8.2-8.3 |
| 3 — PWA | An installable mobile-first PWA over an HTTPS origin (Tailscale first under U2 option 1) with start, watch and approve, and Web Push notifications | 9 |
| 4 — From anywhere | Cloudflare Tunnel with Cloudflare Access plus the Ptah pairing token, hardening for internet exposure (under U2 options 1 and 3) | 8.4-8.6 |

### Phase 1 minimum capability set

Phase 1 supports only these worker capabilities. Every other Electron capability is listed in
the capability document (1.2) either as (a) "deferred" with the phase of this task that adds it,
or as (b) "unsupported remotely" or "not applicable" with a reason. Only the items in list (a)
below are planned in this task.

- Pairing (2.3) and one token per paired client. The Phase 1 grant covers that worker and the
  workspaces registered on it (2.10). Scoped tokens arrive in Phase 2.
- List the worker's registered workspaces and their sessions.
- Open an existing session with its transcript (5.1).
- Start a session in a registered workspace; continue it with a follow-up; interrupt or stop it.
- Stream session events, with cursor replay after a reconnect (4.1, 4.2, 4.4). The worker keeps
  the whole log of each session in Phase 1, so no snapshot fallback is needed until Phase 2
  (4.3).
- Answer permission requests (6).
- A local readiness check on the worker (1.9).

(a) Deferred to a later phase of this task (phases as in the recommended plan; "Scope under each
user decision" moves some of them):

- Phase 2: fleet provisioning and the worker doctor (7.1-7.6), including service survival
  across reboot and logout (7.1); the multi-machine view (3.5); scoped tokens, revocation and
  Origin checks (2.5-2.7); snapshot fallback (4.3); multi-client delivery and first-answer-wins
  approvals (4.5-4.6); Tailscale and transport switching (8.2-8.3).
- Phase 3: the PWA, including Web Push (9).
- Phase 4: Cloudflare Tunnel with Cloudflare Access and the outside-access opt-in (8.4-8.5).
  Under U2 option 3 these move to Phase 2; under option 2 they leave scope.

(b) Unsupported remotely or out of scope for this task. The capability document marks each one
"unsupported remotely" or "not applicable", with the reason, and no phase of this task adds it:

- CLI lanes on a worker (remote lane offload). Out of scope ("Out of scope", "Remote CLI lanes";
  D2). The only exception is the conditional U1 option 3 spike, a throwaway Phase 1a proof that
  does not become a supported worker capability.
- Every other Electron capability outside the Phase 1 list and list (a), for example remote file
  browsing, remote settings and remote provider-account management. The user's remote actions
  are start, watch, approve and notify (HANDOFF "Goal"); these need a separate task (see "Out of
  scope").

Phase 1 exit (checkable): on Chappie (after O3) or another preprovisioned Linux worker, a reviewer
follows the documented Phase 1 install procedure and the readiness check reports ready (1.8,
1.9). From Electron on amun-PC, the reviewer adds the worker by SSH alias and pairs it (2.3,
3.1). They start a session on it, see it stream, approve a tool permission, and drop and restore
the network. After cursor replay the rendered session shows every event once, in order, with no
gap and no duplicate (4.2). The worker's local desktop Ptah keeps working throughout (1.4).

### Scope under each user decision

The recommended answer is option 1 in each case. This table lists what changes for every other
answer. The software-architect plans for the recommended answers and must not build anything that
rules out an alternative before the user answers.

| Decision | Answer | Scope and phase clauses that change |
| --- | --- | --- |
| U1 Phase 1 slice | 1 (Recommended) worker service directly | As written. |
| U1 | 2 `ptah interact` spike first | Adds a Phase 1a spike: one chat session through `ssh <alias> ptah interact`, with no replay, transcript or Machines view claims (`P1-critique.md` "Phase 1"). The spike code is not kept. The Phase 1 exit above moves to Phase 1b. Requirements 1-6 are unchanged. |
| U1 | 3 SSH stdio lane proof first | Adds a Phase 1a spike: one CLI lane on a worker through an SSH stdio adapter, with the worker clone, dependencies and provider login preprovisioned (`P2-critique.md` flaw 4). The "Remote CLI lanes" out-of-scope item narrows to "beyond the spike". D2 changes to "spike in, product lane adapter out". The Phase 1 exit above moves to Phase 1b. |
| U2 Exposure model | 1 (Recommended) Tailscale, then Cloudflare opt-in | As written: 8.2-8.3 in Phase 2, 8.4-8.6 in Phase 4. |
| U2 | 2 Tailscale only | 8.4 and 8.5 leave scope and Phase 4 is dropped. 8.6 stays (it applies to every transport). Outside access needs Tailscale on the client device, which affects the PWA "from anywhere" promise (stakeholder row 2). |
| U2 | 3 Cloudflare for everything | 8.2 leaves scope. 8.4-8.5 move from Phase 4 to Phase 2, and the security review (R4) runs before Phase 2 ships. Phase 3's HTTPS origin comes from Cloudflare. |
| U3 Push content | 1 (Recommended) no content / 2 tool name and summary | Only 9.5 changes: the notification payload. |
| U4 PWA origin | 1 (Recommended) user's own worker or Electron host | 9.7 as written. |
| U4 | 2 static Ptah-hosted site | 9.7 changes: the PWA shell is served from a Ptah-controlled origin, every worker must accept that origin under 2.7, and the pairing flow (9.3) asks for the worker endpoint. Publishing the site is an outward-facing action and becomes part of Phase 3 delivery. Session data still never passes through a Ptah-hosted backend. |
| U5 Licensing | 1 (Recommended) decide before Phase 3 release / 3 free | Licensing stays out of scope. |
| U5 | 2 gate from Phase 1 | Licensing enters Phase 1: the worker service and the Machines view check the user's tier through the existing license path (`apps/ptah-license-server`). The architect adds the criteria. |

## Requirements

### 1. Worker service (Phase 1)

Requirement: the worker machine runs a headless Ptah service that owns its sessions, workspaces
and secrets. A remote client can drive that service, and the machine's local Ptah stays usable at
the keyboard. `user-requested`

Acceptance criteria:

1. When the worker service starts on a Linux host with no display server, it shall start without
   error and serve sessions: start, continue, interrupt or stop, list, and permission responses.
   `user-requested` (workers run Ptah sessions); the no-display condition is `pm-proposed` (VPS
   case)
2. When the worker service runs, it shall expose a capability set that is documented against
   `apps/ptah-electron/src/rpc-host-profile.ts`. Each Electron capability shall be marked
   supported; deferred, only for a capability in list (a) of "Phase 1 minimum capability set",
   with the phase of this task that adds it; unsupported remotely, for list (b), with a reason
   (CLI lanes and every capability outside the Phase 1 list and list (a)); or not applicable,
   with a reason. A capability shall not be marked deferred without a named phase. In Phase 1
   only the "Phase 1 minimum capability set" is marked supported. A test shall fail when the
   registered RPC surface differs from that document. `project-rule` (Council verdict;
   `registerRpcSurface()` parity)
3. When a client calls a method that is not in the worker's allowed method set, the service shall
   reject it with an error and shall not invoke the handler. `pm-proposed` (`P1-critique.md` flaw 7)
4. When the worker service and the machine's desktop Ptah both run, a user at the keyboard shall
   still be able to open the desktop app and run local sessions. `user-requested`
5. When one session is being driven by a remote client and someone tries to drive the same
   session from the local desktop app (or the reverse), the system shall refuse the second driver
   with a visible message naming who owns the session. It shall not corrupt the session file.
   `pm-proposed` (`AttachedSessionRegistry` is process-local today)
6. When the worker service crashes or restarts, sessions that were idle shall still be listed
   after it comes back. A turn that was in flight shall be reported as interrupted, not as
   completed. `pm-proposed`
7. When the service starts, it shall store its state and secrets only on that machine. It shall
   not require credentials from the client machine. `pm-proposed` (Council: each machine owns
   its state and secrets)
8. When a reviewer follows the documented Phase 1 install procedure on a preprovisioned Linux
   worker, the worker service shall start on that worker. "Preprovisioned" is defined in the
   procedure: the supported Linux distribution, the required Node and Ptah versions, a checkout
   or installed Ptah package, and at least one provider CLI that is installed and signed in on
   that worker. The procedure shall also state how to stop and uninstall the service. In
   Phase 1 the service need not survive reboot or logout (that is 7.1). `pm-proposed`
   (`P1-critique.md` "Phase 1": a committed, installed worker clone)
9. When the operator runs the worker's local readiness check on the worker, it shall report
   either "ready" with the listener's loopback address, the Ptah and protocol versions and the
   ready providers, or each missing prerequisite from 1.8 by name with how to fix it. The
   service shall refuse to start a session when no provider is ready, with an error naming the
   missing provider login. `pm-proposed`

### 2. Loopback RPC, pairing and authorization (Phase 1; 2.5-2.7 in Phase 2)

Requirement: remote clients reach the worker through one RPC listener that binds only to
loopback. Every transport forwards to it. Apart from the bounded pairing exchange (2.3), no
request reaches the worker's RPC handlers without a valid token, and every request is checked
against that token's grant. `pm-proposed` (HANDOFF recommendation "never expose an
unauthenticated port", not yet decided by the user; `P1-critique.md` "authorization boundary").
WebSocket is the HANDOFF recommendation; the architect may choose another framing that meets
these criteria.

Acceptance criteria:

1. When the worker service starts, its RPC listener shall bind only to a loopback address. A
   connection attempt to the machine's LAN address (or any non-loopback address) on that port
   shall fail. `pm-proposed`
2. When a client connects without a valid token, or with a revoked or expired one, the service
   shall accept only the pairing exchange (2.3) on that connection. Any other message shall
   close the connection without invoking an RPC handler and without sending any session data,
   event or workspace name. `pm-proposed`
3. Pairing bootstrap. `pm-proposed`
   1. When the operator opens a pairing window on the worker, by running a local command at the
      worker's keyboard or over the operator's own SSH session, or from the worker's local
      desktop app, the worker shall show a one-time pairing code and its expiry. The code
      reaches the client only through the operator: they read it and type it into the client.
      Under SSH transport, Electron may instead run the local pairing command over the user's
      existing SSH login and read the code from its output, because that login already proves
      access to the worker's OS account.
   2. While no pairing window is open, the service shall refuse every pairing exchange, so an
      unpaired client can do nothing at all.
   3. While a window is open, an unpaired client may send only one kind of request: exchange a
      code for a token. A correct, unexpired, unused code shall issue that client one token and
      close the window. A reused, expired or wrong code shall be rejected with a result that does
      not say which of the three it was.
   4. The pairing exchange shall never invoke a handler of the registered RPC surface. A test
      shall send every registered method name on an unauthenticated connection and show that
      none of the handlers runs.
   5. The code's lifetime and the window's lifetime shall be documented, and the window shall
      close by itself when its lifetime ends.
4. When pairing attempts with wrong codes repeat, the service shall throttle further attempts
   per connection and per source, close the pairing window after a documented number of
   failures, and log each failure without the code (2.8). `pm-proposed`
5. When a token is issued, it shall carry a scope: `watch` (read sessions and events),
   `drive` (start and continue sessions), `approve` (answer permission requests) and
   `admin` (manage tokens). The service shall reject any RPC outside the token's scope.
   `pm-proposed` (scoped tokens are in the Council verdict and the HANDOFF recommendation;
   the scope names are D7) (Phase 2)
6. When the user lists or revokes tokens on the worker or from an `admin` client, a revoked
   token's open connections shall close and the token shall not reconnect. `pm-proposed`
7. When a browser connects, the service shall reject an `Origin` that is not on the worker's
   allowed list. `pm-proposed` (`P1-critique.md` flaw 7)
8. When the service logs requests, it shall not write token values or pairing codes in plain
   text. `pm-proposed`
9. Resource authorization. When an authenticated request names a machine, workspace, session or
   permission request, the service shall check that resource against the token's grant before
   the handler runs. `pm-proposed` (`P1-critique.md` "authorization boundary": each method and
   resource)
   1. A request for a machine other than the worker that issued the token shall be rejected.
   2. A request for a workspace outside the grant, or for a session whose workspace is outside
      the grant, shall be rejected.
   3. A permission response shall be accepted only when its request belongs to a session inside
      the grant and is still pending on that session.
   4. A rejected request shall return the same "not found or not permitted" error whether the
      resource exists or not, and the handler shall not run. A test shall set up a token whose
      grant excludes a second workspace that exists on the same worker, and a session in that
      workspace (2.10 says how a Phase 1 grant can exclude one). For each allowed method that
      accepts a workspace ID, session ID or permission-request ID, the test shall pass the ID of
      that outside-grant resource and show the rejection, and shall pass the ID of an inside-grant
      resource and show the method succeeds. It shall also pass a nonexistent ID and show the
      same error.
   5. Event streams and list results shall contain only resources inside the grant.
10. When a client pairs in Phase 1, its grant shall cover the issuing worker and a fixed set of
    workspaces, with full Phase 1 rights. By default the set is every workspace registered on
    that worker when the pairing window opens; the operator may narrow it to a subset when
    opening the window (2.3.1). A workspace registered after pairing is outside the grant until
    the operator extends the grant on the worker. A workspace outside the grant, and its
    sessions, are therefore available to the 2.9.4 test. Scoped grants (2.5) replace this in
    Phase 2. The grant shall be shown in the worker's readiness check (1.9). `pm-proposed`

### 3. Electron Machines view (Phase 1; 3.5 in Phase 2)

Requirement: as the Ptah desktop user, I want one view that lists my machines and lets me work
in their sessions, so that I can control the fleet without remote desktop. `user-requested`

Acceptance criteria:

1. When the user adds a machine with an SSH alias from `~/.ssh/config` and completes pairing
   (2.3), Electron shall reach the worker's loopback RPC through SSH, with no manual tunnel
   command. It shall show the machine as connected. `pm-proposed` (SSH first: Council verdict
   and U2)
2. When a machine is connected, the view shall list its sessions and workspaces as the worker
   reports them. `user-requested`
3. When the user opens, starts, continues or stops a remote session, Electron shall show the
   streamed output, tool calls and permission requests the same way it does for a local session.
   Any difference shall be listed in the capability document (1.2). `user-requested`
4. When the worker is unreachable, the view shall show the machine as offline or reconnecting,
   distinct from a failed session. It shall not mark running sessions as failed. `pm-proposed`
   (`P2-critique.md` "Disconnect and event recovery")
5. When more than one machine is registered, the view shall show each machine's connection
   state and running-session count. `user-requested` (Phase 2)
6. When the user removes a machine, Electron shall delete its stored token and stop its
   tunnel. `pm-proposed`
7. Local sessions on amun-PC shall keep working unchanged whether or not any machine is
   registered. `pm-proposed`

### 4. Event log, replay and multi-client delivery (Phase 1; 4.3, 4.5-4.6 in Phase 2)

Requirement: the worker records every session event durably with a sequence number (event ID).
A client that disconnects and reconnects ends up with the same rendered session as one that never
disconnected: no gap and no duplicate. A transport may deliver an event more than once across a
reconnect race; the client removes duplicates by event ID. `pm-proposed` (Council: durable event
log with dedupe and snapshots)

Acceptance criteria:

1. When a session emits an event, the worker shall write it to the session's log with a
   strictly increasing sequence number before it sends the event to any client. `pm-proposed`
   (`P1-critique.md` flaw 5: persist before ack)
2. When a client reconnects with its last seen sequence number, the worker shall send every
   retained later event in sequence order. The client shall drop any event whose ID it has
   already applied. After replay, the rendered session shall equal the session rendered by a
   client that never disconnected, with no gap and no duplicate. A test shall deliver some
   events twice across a simulated reconnect and compare the two rendered states.
   `pm-proposed`
3. When the requested sequence number is older than the retained log, the worker shall send a
   snapshot of the session state and then the events after it, and the client shall replace
   its view. The rendered result shall meet the same gap-free, duplicate-free check as 4.2.
   The retention bound shall be documented. `pm-proposed` (Phase 2; Phase 1 keeps the whole
   log)
4. When a client detects a sequence gap, it shall request replay from the gap rather than
   render out of order. `pm-proposed`
5. When two clients watch the same session (for example Electron and, later, the PWA), both
   shall receive the same events in the same order. `user-requested` (one interface, several
   clients) (Phase 2)
6. When two clients answer the same permission request, the first answer shall apply. The
   second client shall get an "already answered" result, and both shall then show the final
   state. `pm-proposed` (Phase 2)
7. When a second client submits a turn while one is in flight on that session, the worker shall
   reject it with an error naming the turn in flight. This keeps the current behaviour of
   `interact.ts:414-418`. `pm-proposed`

### 5. Transcripts (Phase 1)

Requirement: a remote client that opens an existing session sees its full conversation, not
an empty pane. `user-requested`

Acceptance criteria:

1. When a client attaches to an existing session, the worker shall return the session's
   transcript (user messages, assistant messages, tool calls and results, and permission
   outcomes) before the live events. The transcript shall join the live stream with no overlap
   or gap. `user-requested`
2. The worker shall provide its own transcript endpoint on the worker RPC. When an authorized
   client (2.9) requests the transcript of a session in its grant, the endpoint shall return
   the transcript with the sequence number it ends at, so the client can join the live stream
   from there (5.1, 4.2). This is required in Phase 1 regardless of the `ptah interact`
   contract. `user-requested` (watch sessions); the endpoint is `pm-proposed`. The `ptah
   interact` `session.history` response is not changed by this task (Decision D8).
3. When a session file is corrupt or missing, the worker shall return an error that names the
   session. It shall not return an empty transcript as if the session had succeeded.
   `pm-proposed`

### 6. Tool-use approval remotely (Phase 1)

Requirement: as a user away from the worker, I want to approve or deny tool use from my client,
so that sessions do not stall until I reach the machine. `user-requested`

Acceptance criteria:

1. When a session on a worker requests permission, every connected client with `approve` scope
   shall show the request with the tool name, its arguments and the machine name. `user-requested`
2. When a client whose grant does not cover the request's session (2.9, Phase 1) or, from
   Phase 2, whose token lacks `approve` scope (2.5) tries to answer, the worker shall reject the
   answer. `pm-proposed`
3. When no client answers, the request shall stay pending and follow the same timeout and default
   behaviour as a local permission request. That behaviour shall be documented. `pm-proposed`

### 7. Provisioning and worker doctor: `ptah fleet add` (Phase 2)

Requirement: the operator provisions a worker from the main machine with one command instead of
manual SSH steps. `pm-proposed` (the fleet is the user's first real use; HANDOFF "Goal")

Acceptance criteria:

1. When the user runs `ptah fleet add <ssh-alias>`, the command shall check over SSH that the
   worker has a supported OS, the required Node runtime and Ptah version. It shall then install
   or start the worker service so that it survives reboot and logout, run pairing, and register
   the machine for the Machines view, after the doctor (7.6) passes. `pm-proposed`
2. When a check fails (no SSH access, wrong version, no disk space, no sudo when it is needed),
   the command shall stop, change nothing further, and print the failed check and how to fix it.
   `pm-proposed`
3. When the command runs, it shall not copy provider credentials or the user's config to the
   worker. It shall report which provider logins the worker is missing. `project-rule` (Council:
   each machine owns its secrets; copying config is U-ops O1)
4. When `ptah fleet add` runs for a machine that is already registered, it shall report the
   current state and change nothing unless the user passes an explicit re-pair or upgrade
   option. `pm-proposed`
5. When the user runs `ptah fleet list` or `ptah fleet remove <alias>`, the command shall list or
   remove registered machines, and removal shall revoke the client's token. `pm-proposed`
6. Worker doctor. Before `ptah fleet add` registers a machine, and before the worker service
   starts a session, a worker readiness check (the "doctor") shall check each prerequisite and
   report each one as passed or failed. A failed item shall name what is missing and the command
   or step that fixes it. Registration shall not complete while a required item fails, and a
   session shall not start on a worker whose doctor fails; neither shall fall back silently to
   running on amun-PC. The doctor shall also run on its own on demand (`ptah fleet doctor
   <alias>` or an equivalent the architect names). `pm-proposed` (`P2-critique.md` flaw 12;
   `P1-critique.md` "worker economics") It checks:
   1. the supported OS and the required Node runtime version (`package.json` engines);
   2. the Ptah version and protocol version, against the client's (version-skew NFR);
   3. the worker's checkout or installed Ptah package, and each workspace the user registers;
   4. installed dependencies, including native modules that load on that worker;
   5. the provider CLIs the worker is configured to use, and that each is installed;
   6. provider authentication for each of them, reported as signed in or missing. The doctor
      reports a missing login and how to sign in on the worker. It shall not copy credentials or
      config from the client (7.3; copying is ops item O1).
   7. disk space and the worker service's state (installed, running, survives reboot).

### 8. Transports (recommended: SSH in Phase 1; Tailscale in Phase 2; Cloudflare in Phase 4)

Requirement: the same worker RPC is reachable through each transport the user selects under U2.
The recommended set is SSH, Tailscale, and Cloudflare Tunnel with Cloudflare Access. The pairing
token is required on every transport. `pm-proposed` (HANDOFF recommendation, not yet decided;
the user raised Cloudflare Tunnel as an idea). The clauses that change under U2 options 2 and 3
are in "Scope under each user decision".

Acceptance criteria:

1. When a machine is reached through SSH, the system shall use the user's existing SSH config
   and keys. The worker shall open no network-facing port for this feature: its only listener is
   the loopback RPC listener (2.1), which the SSH connection forwards to. A port scan of the
   worker's non-loopback addresses shall show no port opened by the worker service.
   `pm-proposed` (Phase 1)
2. When a machine is reached through Tailscale, the client shall connect over the tailnet to an
   endpoint that is not reachable from the LAN or the internet, and it shall still need a valid
   token. `pm-proposed` (U2 options 1 and 2; Phase 2)
3. When the client switches transport for the same machine, sessions and tokens shall be
   unchanged. `pm-proposed` (transport-independent; Phase 2)
4. When the worker is published through Cloudflare Tunnel, a request without a valid Cloudflare
   Access identity shall be refused at Cloudflare, and a request without a valid Ptah token shall
   be refused at the worker. Both shall be shown in tests or a reviewer runbook. `pm-proposed`
   (U2 options 1 and 3; Phase 4 under option 1, Phase 2 under option 3)
5. When the user enables outside access, the system shall require an explicit opt-in on the worker
   and show which hostname is exposed. Turning it off shall stop the exposure. `pm-proposed`
6. No configuration path of the feature shall expose the worker RPC on a non-loopback interface
   without authentication. `pm-proposed` (HANDOFF recommendation "never expose an
   unauthenticated port"; applies under every U2 answer)

### 9. Mobile-first PWA (Phase 3)

Requirement: as a Ptah user away from my desk, I want an installable app on my phone to start
and watch sessions, approve tool use and receive notifications, so that work keeps moving
without a computer. `user-requested`

Acceptance criteria:

1. When the user opens the PWA URL over HTTPS on a browser in the support floor (set by the
   researcher-expert before Phase 3 design; see Open questions), the user shall be able to
   install it by following the documented install flow for that browser. The flow may be a
   browser prompt, an in-app install button, or the browser's menu (for example "Add to Home
   Screen"). After install, launching it from the home screen or app list shall open it
   standalone, without browser chrome. A reviewer checks each browser in the floor.
   `user-requested` (installable PWA)
2. When opened on a 360 px-wide viewport, every Phase 3 screen (machines, sessions, session view,
   approval prompt, pairing) shall be usable without horizontal scrolling. `user-requested`
   (mobile-first)
3. When paired with one or more workers, the PWA shall list machines and sessions, start a session
   in a chosen workspace, stream it, send follow-ups, stop it, and approve or deny permissions,
   with the same rules as Requirements 4 and 6. `user-requested`
4. When the device is offline, the PWA shall open its shell and show the last known state marked
   as stale. On reconnect it shall replay per Requirement 4. `pm-proposed`
5. When a session on a paired worker requests permission or finishes while the PWA is closed,
   the user shall receive a push notification that opens that session. The notification's
   content shall follow User decision U3. `user-requested`
6. When the user unpairs the PWA or revokes its token, push notifications to that device shall
   stop. `pm-proposed`
7. When the PWA is served, it shall come from the origin chosen under U4. Under the recommended
   answer that is an origin the user's own deployment controls (the worker or Electron host);
   under U4 option 2 it is a static Ptah-hosted site (see "Scope under each user decision").
   Under either answer it shall not need a Ptah-hosted backend for session data: session data
   flows only between the PWA and the user's workers. `pm-proposed` (conditional on U4)

### 10. Phase 0 measurement (Phase 0)

Requirement: before Phase 1 commits to a footprint, the team knows what the worker service costs
on a 4-core / 15 GB worker and where amun-PC spends CPU today. `pm-proposed` (Council Phase 0)

Acceptance criteria:

1. When Phase 0 completes, a report in the task folder shall give CPU and RSS per process tree
   on amun-PC under a normal workload: Electron, CLI lanes, Nx/Jest, and Ollama clients.
   `pm-proposed`
2. When Phase 0 completes, the report shall give the idle and one-active-session CPU and RSS of a
   headless Ptah backend on one worker. That is the baseline for the NFR "Resource cost".
   `pm-proposed`

## Non-functional requirements

- Security: loopback-only listener and no network-facing port (2.1, 8.1); no RPC handler
  reachable before authentication except the bounded pairing exchange (2.2-2.4); token on every
  transport (8.6); method allow list (1.3) and resource authorization against the token grant
  (2.9, 2.10); scoped tokens with revocation (2.5, 2.6); Origin checks (2.7); no secrets in logs
  (2.8); worker-owned secrets (1.7, 7.3). `pm-proposed` as tagged above.
- Offline and reconnect: after cursor replay or snapshot fallback, the rendered session has no
  gap, no duplicate and no out-of-order event, using event IDs and client dedupe (4.2-4.4). The
  transport is not required to deliver each event exactly once.
  This matters because Gatsby and Chappie are on USB Wi-Fi (HANDOFF "Open problems" 5).
  `pm-proposed`
- Multi-client concurrency: many watchers, one driver per turn, first-answer-wins approvals,
  single owner per session across local and remote (1.5, 4.5-4.7). `pm-proposed`
- Resource cost on 4-core / 15 GB workers: the worker service's idle and one-session cost shall be
  measured (10.2) and reported in each phase's review. The architect proposes a budget from
  that baseline, and the user approves it at Gate 2. No threshold is set here, because none is
  supported by evidence yet. `pm-proposed`
- Compatibility: Electron is the first and verified client. The TUI, the VS Code extension and the
  CLI shall keep compiling and passing their tests for every shared lib touched. Verification
  uses only `npm run verify -- -p <changed projects>`. `project-rule` (CLAUDE.md)
- Version skew: when a client and a worker run protocol versions that cannot work together, the
  client shall show both versions and refuse to connect rather than fail mid-session. This matters
  because Chappie runs 0.1.60 and the others 0.1.70. `pm-proposed`

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| The user as fleet operator (amun-PC to Horus, Anubis, Chappie) | Drive sessions on workers from one Electron window | Phase 1 exit scenario passes on a real worker |
| Ptah users away from their desk | Start, watch and approve from a phone, from anywhere | Phase 3 PWA criteria on a real phone; Phase 4 from outside the LAN |
| A person at a worker's keyboard | The local Ptah keeps working and is not taken over silently | 1.4 and 1.5 hold during a remote session |
| VPS users | A worker with no desktop | 1.1 on a headless Linux server |
| Maintainers | No drift between the worker and Electron RPC surfaces; all hosts compile | Capability-document test (1.2); scoped verify green |

## Risks

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Phase 1 is built on the wrong slice. The Council disputed it: remote chat through `ptah interact` versus an SSH stdio adapter for CLI lanes. | HIGH | HIGH | The user decides U1 at Gate 1; options 2 and 3 add a Phase 1a spike (see "Scope under each user decision"). Recommendation (U1 option 1): neither as the product slice. `ptah interact` over SSH ends at stdin EOF (`interact.ts:229-239,387-391`), has no transcript (`:516-541`) and forwards any method through `rpc.call`. None of these satisfy Req 2, 4 or 5, so it would be thrown away. The SSH stdio lane adapter proves CPU offload, which is not session control, and needs new lane wiring (`P2-critique.md` flaws 2-4). Under the recommendation, Phase 1 builds the worker service directly, uses SSH only as a pipe to its loopback port, and keeps lane offload out of scope. Owner: the orchestrator records the user's U1 answer in `context.md`; the software-architect designs Phase 1 for that answer in implementation-plan.md. |
| R9 | An unauthenticated client reaches an RPC handler through the pairing path, or an authenticated client reads another workspace's sessions by passing its ID | MEDIUM | HIGH | Criteria 2.2-2.4 and 2.9 each carry a test (every method name on an unauthenticated connection; second workspace and session IDs through each allowed method). Owner: senior-tester writes them in Phase 1; team-leader schedules `review-security` before Phase 1 ships. |
| R2 | The worker capability set drifts from Electron's and leaves features silently missing | MEDIUM | HIGH | Criterion 1.2: a capability document plus a test against the registered surface. Owner: architect defines it, and the tester pins it. |
| R3 | The local desktop Ptah and the worker service drive the same session file at once | MEDIUM | HIGH | Criterion 1.5. The architect must choose a cross-process owner guard, because `AttachedSessionRegistry` is process-local (`attached-session-registry.ts:11-14`). |
| R4 | Token or port exposure through a misconfigured transport | LOW | HIGH | Criteria 2.1, 8.4-8.6. The security review runs before Phase 2 and Phase 4 ship (owner: team-leader schedules `review-security`). |
| R5 | Resource pressure on 4-core workers that also run Ollama on 0.0.0.0 | MEDIUM | MEDIUM | The Phase 0 baseline (10.2) is set before the Phase 1 design is fixed. The architect sizes the session cap per worker from it. |
| R6 | Web Push is limited on some mobile browsers (iOS needs an installed PWA) and goes through vendor push services | MEDIUM | MEDIUM | Before Phase 3 design, a researcher-expert confirms platform support and the payload privacy implications, which inform U3. |
| R7 | The user expects remote sessions to see amun-PC's uncommitted edits | MEDIUM | MEDIUM | The scope excludes this. Starting a remote session requires a workspace that exists on the worker (3.2). The Machines view shows the worker's workspaces, not amun-PC's. |
| R8 | Version skew (Chappie 0.1.60) breaks connections mid-session | HIGH | LOW | The version-skew NFR (handshake refuses up front). The upgrade is ops item O3. |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Worker-owned headless service with its own composition root; Electron is client 1 and the PWA is client 2 | Worker daemon / extend `ptah interact` / Electron-only remote | Council verdict, both vendors (`P1-critique.md`, `P2-critique.md` "Revise?") | yes, before Phase 1 code |
| D2 | Recommendation, pending U1: a product remote CLI-lane offload (SSH stdio adapter) is out of scope | In / out / spike only | The user's stated goal is session control and the PWA (HANDOFF "Goal"). The lane adapter is a different protocol (`P2-critique.md` flaw 4). Under U1 option 3 a one-lane spike enters as Phase 1a. | yes, by the U1 answer or as a follow-up task |
| D3 | Recommendation, pending U1 and U2: phase order 0 Measure, 1 single machine in Electron over SSH, 2 Fleet and Tailscale, 3 PWA, 4 Cloudflare | PWA before fleet / fleet before PWA; U1 options 2-3 add Phase 1a; U2 options 2-3 drop Phase 4 or move Cloudflare to Phase 2 | CLAUDE.md "Electron first". The PWA needs an HTTPS origin, and Tailscale (Phase 2) gives one before internet exposure. The fleet is the first real use (HANDOFF "Goal"). | yes |
| D4 | Pairing tokens are required even over SSH and Tailscale | Token on every transport / transport auth only | HANDOFF recommendation "never expose an unauthenticated port" (given to the user, not yet decided). Transport independence (8.3) means auth cannot live in the transport. | yes |
| D5 | No `parity-inventory.md` | Write one / not | The task adds surfaces and replaces none. The `ptah interact` `session.history` response is unchanged (D8). | yes |
| D6 | Fixing the `ipc-bridge.ts:205-210` delivery flag is a separate task | Fix here / separate | The remote path detects gaps by sequence (4.4). The local fix touches every Electron stream. | yes |
| D7 | Scope names `watch / drive / approve / admin` | Coarse read/write / per-method | The four map to the user's actions: watch, start, approve, manage (HANDOFF "Goal"). The architect may refine them. | yes |
| D8 | Changing `ptah interact`'s `session.history` to return a transcript moves to a separate task. Phase 1 instead requires a worker transcript endpoint (5.2). | Change it here, tagged `pm-proposed`, with compatibility criteria / separate task | The user asked for remote transcripts, not a CLI contract change. The empty `messages` is documented in the code for current A2A callers (`interact.ts:516-541`). Under D1 remote clients talk to the worker RPC, not to `ptah interact`, so the worker endpoint meets the need without touching the CLI contract. | yes, a follow-up task can change the CLI |
| D9 | Phase 1 grant is one token per client covering the issuing worker and its registered workspaces; scopes arrive in Phase 2 | Scopes in Phase 1 / single full grant in Phase 1 | Keeps Phase 1 thin (review Serious 1) while resource checks (2.9) still apply from the first token. | yes |

## User decisions (reserved)

These are reserved for the user: security and exposure, outward-facing actions, money, and the
disputed Phase 1. Each lists options with the recommended one first. All options stay live until
the user answers. The scope and phase clauses that each answer changes are in "Scope under each
user decision" (after Phases). The orchestrator records each answer in `context.md`, and this
document is amended to match.

- U1 — Phase 1 slice (Council dispute).
  1. (Recommended) Build the worker service directly with a loopback RPC listener, reached from
     Electron over SSH (the recommended Phase 1). The evidence is in R1.
  2. Throwaway spike: `ptah interact` over SSH for one chat session, then build the service.
  3. SSH stdio adapter for one CLI lane (CPU offload proof), then build the service.
- U2 — Exposure model for access from outside the LAN.
  1. (Recommended) Tailscale for the fleet and the PWA (Phase 2/3). Cloudflare Tunnel with
     Access plus the Ptah token only as an opt-in for internet and VPS access (Phase 4).
  2. Tailscale only; drop Cloudflare.
  3. Cloudflare for everything, including the LAN fleet.
- U3 — Push notification content. Push payloads pass through browser vendors' push services.
  1. (Recommended) No content: "Approval needed on Chappie". Details load after the app opens.
  2. Tool name and a short summary in the notification.
- U4 — Where the PWA is served from (outward-facing).
  1. (Recommended) From the user's own worker or Electron host, at the same origin as the RPC
     endpoint.
  2. A static Ptah-hosted site (for example on the existing landing or docs domain), with the
     user's endpoints entered at pairing.
- U5 — Licensing (money): is remote access or the PWA a paid tier feature? The repository has
  `apps/ptah-license-server`.
  1. (Recommended) Decide before Phase 3 release. Build it ungated until then.
  2. Gate it from Phase 1.
  3. Free in all tiers.

## Operational decisions for the user

These are fleet operations, not code. They are not part of the code scope and the team does not
do them without the user's answer.

- O1 — Copy the user's Ptah and Claude config to Horus, Anubis and Chappie, with backups? This is
  still unanswered (HANDOFF "Open problems" 2). Note that criterion 7.3 means `ptah fleet add`
  will not do this.
- O2 — Rebind Ollama on Horus, Anubis and Chappie from 0.0.0.0 to loopback? This is still
  unanswered (HANDOFF "Open problems" 3). Recommended, in line with the "no unauthenticated port"
  principle.
- O3 — Upgrade Chappie's Ptah from 0.1.60 to 0.1.70, first checking that Ptah is not running
  (HANDOFF "Next steps" 3). This is needed before Phase 1 is tested on Chappie.
- O4 — Move the decision model `d3:4b` from Gatsby to Chappie? Chappie benchmarked 2x faster
  (warm 5.5-5.9 s against ~11.2 s, cold 11.8 s against 22-28 s, same answer; `context.md` "Fleet
  benchmark"). The user said to move it only if Chappie is clearly faster, and it is. If it moves,
  the SSH tunnel target changes, and Chappie, as a Ptah worker, also carries the model's ~7.1 GB
  RAM. That weighs on R5.
- O5 — Ethernet cables for Gatsby and Chappie, which are on USB Wi-Fi, and an investigation of
  the ~3.4 MB/s download speed (HANDOFF "Open problems" 5-6).
- O6 — Configure the decision model in Ptah as kind `custom`, base URL `http://127.0.0.1:11435`,
  timeout 20 s (HANDOFF "Open problems" 7).

## Open questions

- Should a worker without a desktop session (VPS) also host the PWA static files, or only the
  RPC? This depends on U4. The software-architect answers after U4.
- Which mobile browsers are the support floor for the PWA and Web Push? researcher-expert, before
  Phase 3.
- Should `ptah fleet add` install the full desktop package or a headless-only package on VPS
  workers? software-architect, with the Phase 0 numbers.

## Handoff

- Next specialist: software-architect, with Phase 1 designed in full and Phases 2-4 outlined.
  A researcher-expert covers Web Push and Cloudflare Access specifics before Phase 3 and
  Phase 4.
- Why: the open question is the shape of the system: the worker composition root against
  `rpc-host-profile.ts` and `registerRpcSurface()`, reuse of `ClaudeRpcService` as the client
  seam, the HTTP server provider, the event log, and the cross-process session owner. These facts
  are internal, not external.
- Project rules for every downstream artifact and lane:
  - Electron first. No TUI or VS Code feature work; keep every host compiling.
  - Verify only with `npm run verify -- -p <changed projects>`. Never run workspace-wide checks,
    and never run build, serve, dev, e2e or package targets.
  - No code changes before the user approves the plan at Gate 2.
  - The architect designs for the recommended answers to U1-U5 unless the user has answered,
    and keeps the alternatives in "Scope under each user decision" possible.

## Revision log

Round 1 (2026-11-01), answering `task-description-review.md` (Verdict REVISE).

| Review item | Resolution |
| --- | --- |
| Blocking 1: reserved choices written as settled | Scope and Phases are now marked as the recommended plan. Added "Scope under each user decision" listing the clauses each U1-U5 answer changes. The transport selection, the worker RPC, the event log, provisioning and the VPS case are retagged `pm-proposed`. "Never expose an unauthenticated port" is cited as the HANDOFF recommendation, not a user decision (2.1, 8.6, D4). The lane exclusion (U1), licensing exclusion (U5) and PWA origin (9.7, U4) are conditional. D2 and D3 are recommendations tied to U1 and U2. |
| Blocking 2: first-token enrollment vs authentication | 2.2 now allows only the pairing exchange on an unauthenticated connection. New 2.3 defines the bootstrap: a pairing window opened locally on the worker, the code passed by the operator (or read over the user's SSH login), a single code-for-token request, rejection outside a window, and a test that no RPC handler runs unauthenticated. 2.4 adds per-source throttling and window closure. 8.1 now separates the loopback listener from a network-facing port. |
| Serious 1: Phase 1 install, readiness and scope | Added 1.8 (documented install procedure on a preprovisioned Linux worker) and 1.9 (local readiness check). Added "Phase 1 minimum capability set" and the deferred list. Moved 4.3, 4.5-4.6 and 8.2-8.3 to Phase 2. 1.2 marks deferred capabilities. The Phase 1 exit starts from the install procedure. |
| Serious 2: method-only authorization | Added 2.9 (machine, workspace, session and permission-response checks against the grant before the handler, uniform rejection, filtered lists and streams, with a test) and 2.10 (Phase 1 grant). Added R9 and D9. |
| Serious 3: provisioning omits worker readiness | Added 7.6, the worker doctor: OS and Node, Ptah and protocol versions, checkout, dependencies and native modules, provider CLIs, provider authentication, disk and service state, with actionable failures and no silent local fallback. 7.1 registers only after the doctor passes. Credential copying stays O1. |
| Serious 4: unrequested `session.history` change | Decided to move it to a separate task (D8, out-of-scope item). 5.2 now requires a worker transcript endpoint in Phase 1. |
| Minor 1: citations | `registerRpcSurface()` cited at `apps/ptah-electron/src/activation/wire-runtime.ts:337`. The refusal is cited at `chat-rpc.handlers.ts:278-283`; the registry citation now supports only "in-memory, process-local". |
| Minor 2: install prompt | 9.1 now requires a documented install flow per browser in the researched support floor (prompt, button or menu) and a standalone launch. |
| Minor 3: replay overpromise | The Requirement 4 statement, 4.2, 4.3 and the reconnect NFR now require gap-free, duplicate-free rendered state using event IDs and client dedupe, with a duplicate-delivery test. |

Round 2 (2026-11-01), answering the "Round 1 re-review" in `task-description-review.md`.

| Review item | Resolution |
| --- | --- |
| New Serious 1: deferred list adds excluded scope | "Phase 1 minimum capability set" now splits (a) capabilities deferred to a named later phase of this task (Phase 2, 3 or 4, each listed) from (b) capabilities unsupported remotely or out of scope. CLI lanes are in (b), except the conditional U1 option 3 spike, which is a throwaway proof and not a supported capability. 1.2 allows "deferred" only for list (a) with a named phase and marks list (b) "unsupported remotely". To keep "Out of scope" consistent with list (b), one bullet was added there for remote file browsing, settings and provider-account management. |
| New Minor 1: authorization test needs an outside-grant resource | 2.10 now fixes the Phase 1 grant to a set of workspaces at pairing, which the operator may narrow; workspaces registered later are outside it. 2.9.4 now requires the test to use a workspace and session that exist on the same worker but are outside the tested token's grant. It must pass those IDs through each allowed method that accepts a workspace, session or permission-request ID, and compare them with an inside-grant ID and a nonexistent ID. |
