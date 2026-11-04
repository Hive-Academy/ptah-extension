# Independent architecture plan review — TASK_2026_858_f7b9

Verdict: REVISE

## Round 1 re-review

Verdict: REVISE

The findings below the round 1 section are retained as the original review. This section records their current status; its verdict supersedes the original Checks.

1. **Blocking 1 — resolved in the revised lock contract** (W10, lines 361-434; C4a/C4b, lines 567-609). `BEGIN IMMEDIATE` serializes acquisition and stale reclaim, a live PID is never displaced for age alone, nonce-qualified deletion prevents late release, and lock-store errors refuse turns. Registry removal notifications and cross-process cases are specified. A crash leaves a row, but the next process can reclaim it after proving the PID dead or its start time changed. The Node 20 binding and release-failure issues below remain open.
2. **Serious 1 — not resolved** (W8, lines 330-352; W7 replay, lines 320-326). The latest baseline is written only when the worker next acquires the lock. If the desktop drives a previously logged session after the worker releases it, `session.attach` before the next worker turn replays the old baseline and worker log, omitting the desktop turn. The listed interleaving test checks the later worker baseline, not this attach window. Requirement 5.1 still needs the complete conversation at attach. Refresh the baseline from read-only history at a proven idle boundary, or return an explicit fresh snapshot and a defined sequence join; test attach immediately after an intervening desktop turn.
3. **Serious 2 — resolved** (W7, lines 291-326; C5, lines 615-625): the ordered writer sends only after append and signals mid-turn failure to abort and degrade the session.
4. **Serious 3 — resolved** (W12, lines 443-469): the per-method adapter unwraps nested chat failures, validates results, and maps errors to fixed client copy with a local reference.
5. **Serious 4 — resolved** (W3, lines 212-241): all four unauthenticated pairing failures use the same code and body; the attempts count moves to SSH-authenticated status, subject to Q2.
6. **Serious 5 — resolved as a user-reserved choice** (AD-9, line 1040; C10/C11, lines 755-810; Q1, lines 1058-1067): C10 waits for the user's decision between an approved design revision and the Phase 1 bridge. The plan does not silently change design 4.9.
7. **Serious 6 — resolved** (C0, lines 500-525; handoff, lines 978-1025; verify table, lines 936-955): C0 owns shared configuration, component files are disjoint, and the sampler is a scoped Nx tool project.
8. **Serious 7 — resolved as a user-reserved choice** (U5 delta, line 920; Q5, lines 1079-1085): the paid capability set is left to the user, with server-side checks and tests specified for the selected set.
9. **Minor 1 — resolved** (C6, lines 680-686): capability/profile parity and the remote method table have distinct checks.
10. **Minor 2 — resolved** (C6, lines 671-674; C8, lines 732-741): grant snapshot, grant extension, and online revocation have named success-path tests.
11. **Minor 3 — resolved** (A1, lines 112-116; exit runbook, lines 957-961): real `ssh -W` is a recorded Phase 1 acceptance step.

### New Blocking

1. **The selected SQLite binding cannot meet the worker's Node 20 contract.** W10 lines 370-375 and AR8 line 974 use `better-sqlite3` for a mandatory fail-closed lock while C7 lines 697-701 and Q4 lines 1075-1078 install on Node 20. The actual installed `better-sqlite3@13.0.3` declares `node >=22` (`node_modules/better-sqlite3/package.json:1-4,32-34`), whereas the CLI declares `node >=20.12` and depends on `^13.0.3` (`apps/ptah-cli/package.json:44-45,61`); Electron also depends on that binding (`apps/ptah-electron/package.json:23`). The existing factory loads its native module at runtime (`libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:792-800`). A warning or fail-closed refusal does not make the Phase 1 worker usable on the documented Node 20 target. Select a binding/runtime combination with explicit Node 20 and Electron native-module support, or change the worker runtime prerequisite and installation/readiness contract through the task owner; specify the package and a real runtime smoke check on each supported host before Gate 2 approval.

### New Serious

1. **A release failure can strand a live-PID lock row without a recovery path.** W10 lines 385-407 routes normal release through `onRecordRemoved`; C4a lines 572-591 says listener exceptions are caught and logged. If SQLite release fails after a record is removed, the row still names a live PID. W10's liveness rule (lines 378-384) correctly forbids another process from reclaiming it, so the session remains unavailable until that process exits, although no driver remains. Specify retry/retained ownership state and a safe operator recovery path for release failure, make the failure visible, and test a failed release followed by a successful retry while the holder process stays alive. Do not weaken the live-holder rule.

Q1 and Q5 are genuinely user-reserved: both alternatives remain conditional, C10 waits for Q1, and the U5 gate batch waits for the user's U5 and Q5 answers (lines 1053-1085).

## Blocking

1. **The driver lock does not guarantee one owner.** W10 (plan lines 357-376), C3 (503-509), and AD-18 (1034) permit a turn after `EACCES`/`ENOSPC`, directly contradicting requirement 1.5 (task-description lines 244-246). W10 also steals a lock merely because its heartbeat is older than 90 seconds, even if the same-host PID is alive; a paused process can resume and drive alongside the new holder. The `wx`/unlink/recreate sequence needs an ownership-safe stale takeover, and `release` must verify an owner nonce so an old holder cannot delete its successor's lock. C3 subscribes only to `onSessionEvicted`, which the code documents as *idle-sweep* evictions (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:581-587`); ordinary `endSession` and `disposeAllSessions` are separate paths (`:736-766`). Require fail-closed acquisition, explicit release on every normal end/abort/shutdown path, atomic ownership checks, and cross-process tests for I/O failure, a live but delayed heartbeat, competing stale reclaimers, and late release. A4 is not established by the cited code.

## Serious

1. **The transcript cut can lose completed events.** W8 (plan lines 331-342) sets `atSeq = headSeq` before reading SDK history when no turn is in flight. It does not establish that the history reader has incorporated every event through that sequence; any lag means those events are absent from both history and replay, violating 5.1-5.2. A3 is also false as stated: `chat:resume` reads account and metadata state and registers resumed state before returning history (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1651-1683,1690-1832`). Use a read-only history boundary or build the transcript from a checkpoint and the event log, with a proven cut and tests for history lag, completion during attach, and restart.

2. **The proposed push tap cannot enforce the event-log failure contract.** C5 specifies `tap?: (...) => void`, called after `emit`, with exceptions swallowed (plan lines 540-552). The existing adapter's `sendMessage`/`broadcastMessage` call synchronous `dispatch`, which calls `emit` (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:64-80,112-122`). An asynchronous append rejection cannot be awaited or propagated, while C6 promises to abort a turn on append failure (plan lines 612-615). Make the worker event capture an awaited, ordered boundary with an explicit failure signal, and test append failure during a live turn. Maintain append-before-network-send as required by 4.1.

3. **In-process RPC errors need an explicit adapter.** W6 and C6 (plan lines 279-290,609-615) treat `RpcHandler.handleMessage` as if a failed chat operation yields an RPC failure. In fact, `handleMessage` reports `success: true` whenever a registered handler *returns* (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:199-225`), while `ChatSessionService.startSession`, `continueSession`, and `resumeSession` catch errors and return `{ success: false, error }` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1042-1055,1613-1636,1833-1856`). Without unwrapping, a failed start can be reported as a successful remote request. C6's `INTERNAL` mapping also forwards the original message, which may expose provider details in a UI contract. Specify per-method result validation and safe error mapping; test nested failure results and redaction.

4. **Pairing results distinguish failures the requirements say to merge.** W3 (plan lines 235-243) returns `PAIRING_REJECTED` with a varying `attemptsLeft`, including zero when no window exists. Expired or used codes can therefore produce a different response from a wrong code during an open window, contrary to 2.3.3 (task-description lines 294-304). Keep the unauthenticated result indistinguishable in code and detail. Resolve the design's attempts-count copy through the reserved decision before exposing a count; test wrong, expired, used, and closed-window responses.

5. **The approved Machines design is changed by the plan.** Design 4.9 requires a remotely answerable permission block while the desktop on the worker drives the session (`design-spec.md:109-113`). AD-9 and C10 make that session watch-only with an unanswerable block (plan lines 771-780,1025). The process-local handler evidence explains the difficulty but does not make the current approved design match. Obtain a revised approved design before C10, or specify and test a desktop-to-worker permission bridge that meets 4.9. The two artifacts must agree at Gate 2.

6. **Batch ownership and verification are not yet executable as written.** The handoff calls `{C6,C10}` parallel and file-disjoint, then says both touch `tsconfig.base.json` (plan lines 980-982; C6 at 620-622 and C10 at 763-769). C1/C8 also modify it (456,703-705). Assign one owner for the alias file and root dependency edits, or sequence those batches explicitly. P0-1's test command (plan lines 415-417,930) runs `npm run test:scripts` outside the required `npm run verify -- -p <changed projects>` path (task-description lines 579-581). Put the sampler test in a scoped verify project or revise the verification contract through the task owner. Keep the measurement run separate from test verification.

7. **The U5 option-2 delta is narrower than the reserved decision.** U5 asks whether *remote access or the PWA* is paid, with an option to gate from Phase 1 (`task-description.md:650-654`). The delta (plan line 907) checks only `session.start`/`continue` and a renderer Add-machine action. Pairing, transcripts, watching, and approvals remain accessible, and the renderer action is bypassable. Leave the coverage of paid access for the user to decide; if Phase 1 is gated, define server-side enforcement for every covered method and connection state, with tests. The plan must not treat the drive-only interpretation as the answer.

## Minor

1. **The capability drift test needs two distinct surfaces.** C6 says to compare `deriveRpcSurface(createWorkerRpcHostProfile())` with the capability document (plan lines 590-599,936). `deriveRpcSurface` returns the broad *in-process* registered/excluded method partition (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:57-70`); W6 is a smaller remotely exposed table. Define a mapping that checks every Electron capability and its reason/phase against the profile, and separately compares the document's supported remote methods with `WORKER_METHODS`. Otherwise the test can pass while the actual network allow list drifts.

2. **The test table omits two important success paths.** C6/C7/C8 (plan lines 936-939) test outside-grant refusal and offline removal, but do not name tests that a default pairing grant snapshots registered workspaces, a later workspace stays excluded until `grants add`, or online removal revokes the worker token and closes the tunnel (2.10 and 3.6). Add those cases at the worker/command/client boundaries.

3. **A1's automated seam stops short of SSH.** C8's Duplex-pair spec (plan lines 700-702,938) checks `ws` over a Duplex, while the actual `ssh -W` process and argument behavior are only covered by fake-spawner specs. The Phase 1 exit runbook (942-946) covers real SSH; name that as A1's final acceptance check and record its result before shipping. A2 and A6 have plausible code paths; A5 remains a targeted renderer test.

## Checks

1. Requirements — **FAIL:** 1.5, 2.3.3, 4.1, and 5.1-5.2 need corrected contracts/tests; strengthen 2.10 and 3.6 success tests. Other listed Phase 1 items and Phase 0 item 10 have named components or runbook seams.
2. Security — **FAIL:** loopback, admin pairing, token ownership, and method/resource checks are specified; pairing reveals failure state, and raw in-process errors can reach the client.
3. Correctness — **FAIL:** A3 is contradicted by `chat:resume`; A4 and stale-lock safety are unproven; A1, A2, A5, A6 have proposed checks, but A1 needs the real-SSH exit check.
4. Nx boundaries — **PASS:** proposed tags and directions match `eslint.config.mjs:293-305,357-438`; no planned `scope:electron → scope:cli` import or apparent cycle. `nx.json` keeps parallelism at 1 and shared cache settings.
5. Batches — **FAIL:** C6/C10 overlap on `tsconfig.base.json`; P0-1's test bypasses scoped `npm run verify`. The other host-inclusive verify rows are scoped and cover the named dependent hosts.
6. Design fidelity — **FAIL:** planned Phase 1 behavior contradicts approved design 4.9; other named Machines states, placement, and accessibility behaviors map to C10.
7. Reserved decisions — **FAIL:** U1-U4 and O1-O6 remain options, but U5 option 2 has an incomplete delta and the design 4.9 change awaits approval; attempts-count copy remains open.
8. Project rules — **FAIL:** Electron-first scope and host compatibility are addressed; P0-1 uses an unapproved test command. No verification was run for this review.

## Round 2 re-review

Verdict: REVISE

### Prior items

1. **Round-1 Blocking — resolved** (`implementation-plan.md:432-449,473-479,498-503,507-526`). `KernelSessionDriverLock` uses `node:net`: a Linux `\0` abstract socket or Windows named pipe, with no stale socket file or `better-sqlite3` dependency. The name includes the OS user and session ID, independent of Electron `userData` (`:137-153,434-436`). macOS uses a null lock because no macOS worker is in scope. A paused or hung holder remains exclusive; AR3 (`:1081`) says the operator ends that process. A different local user can still squat a known abstract name and deny service; AR10 (`:1083`) acknowledges this residual risk.
2. **Round-1 release Serious — not fully resolved** (`implementation-plan.md:450-470,484-497,507-525`). Retrying `close()`, retaining `stranded` state, a control-key plus confirmation for `ptah worker locks release`, and notifications from the named removal paths address the failed-release case. The recovery listing has no specified way to discover session IDs from per-process key files, and the rebind notification lacks an old-ID handoff. See New Serious 2-3.
3. **Round-1 transcript Serious — resolved** (`implementation-plan.md:366-407`). Every logged-session attach checks freshness under the driver lock and appends a replacement baseline after an intervening desktop turn. The named test attaches immediately after that turn and before another worker turn (`:397-403`). The missing event type in New Serious 1 must be fixed for this design to be executable.
4. **Node 22 claim — resolved with qualification** (`implementation-plan.md:70-71,751-754,802-804,1199-1205`). The CLI registers the session store on the `withEngine` path, while `SessionStoreDatabase` opens it on first use; repository reads and writes call `ready()`. Thus `better-sqlite3` is lazy at registration, but required for worker session-store operations. The proposed `serve` readiness check will also load it before serving. `apps/ptah-cli/package.json:44-45,61` says `>=20.12` and depends on `^13.0.3`; installed `node_modules/better-sqlite3/package.json:2-3,32-34` says `>=22`. Node 22 is the binding's declared support floor and the plan's worker prerequisite; the manifest alone does not prove every Node 20 load fails. The public CLI `engines` choice remains user-reserved.

### New Blocking

None.

### New Serious

1. **The new history-mark record is absent from the log's allowed types.** `implementation-plan.md:337-342` enumerates `SESSION_EVENT_TYPES` without `worker:history-mark`, while W8 requires appending that record after each worker turn (`:366-369`) and compares it on attach (`:370-381`). Add `worker:history-mark` to W7's type and serialization contract, and cover its append and replay in the attach test.
2. **The operator listing cannot discover locks from the stated files.** `implementation-plan.md:460-469` says `<pid>.key` contains each process's control key and that `ptah worker locks` queries the endpoints it finds through those files. A key and PID do not identify the session IDs needed to construct per-session socket names (`:434-446`), especially across Windows named pipes. Specify a per-process discovery endpoint or a private, lifecycle-managed session inventory; keep release keyed to the actual holder and test listing and releasing locks held by another Electron or CLI process.
3. **The rebind release loses the old session identity unless it is captured explicitly.** `implementation-plan.md:484-493` puts `onRecordRemoved(record)` in the rebind branch. Existing `SessionRegistry.bindRealSessionId` mutates that same record from the old ID to the new one (`session-registry.service.ts:380-394`); it does not remove the record. Define a handoff event carrying the old ID and owner nonce, order new-ID acquisition and old-ID release before further driving, and test a fork/rebind across processes. Otherwise the old lock can remain held or the new session can run without its intended lock.

### Minor

1. **Question reference mismatch.** `implementation-plan.md:71,148,806,1087,1154,1231` call the published Node-floor decision “Q7,” but it is item **6** in `## Clarifications Needed` (`:1199-1205`); item 7 is U1-U5 (`:1206-1207`). Change those references to Q6.

### Decisions

1. **Kernel-held lock is the right dependency split:** `node:net` removes the Node 22 native binding from the lock while the worker still requires the session store (`implementation-plan.md:432-449,751-754`; `sqlite-connection.service.ts:792-800`). Reversible by changing the lock implementation.
2. **Keep live-holder refusal, including SIGSTOP:** timed takeover would permit two drivers. The operator can terminate a hung holder, but the lock listing must expose its PID reliably (`implementation-plan.md:439-442,507-511,1081`). Reversible only with a different ownership protocol.
3. **User-reserved Node-floor choice remains open:** recommend raising the published CLI `engines.node` to `>=22` (Q6), because the current CLI dependency itself declares that floor (`implementation-plan.md:1199-1205`; both package manifests above). The alternative is a worker-only guard while retaining the CLI's existing public floor; this review does not choose a breaking package contract for the user.
