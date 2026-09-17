# Batch 10 report — TASK_2026_402_a5c7 (Requirement 10, tasks 10.2 and 10.3)

Executor: `backend-developer`. Worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`, on top of `69c03977f`. Nothing committed, no stash, no
checkout, no `nx reset`, no edit to `batches.md`.

Status: **BATCH_10_DONE**. Tasks 10.2 and 10.3 implemented with real code — no stubs, no
`TODO`, no skipped assertions. 36 new tests in `agent-sdk`, 13 in `rpc-handlers`, all
green.

Task 10.1's finding was taken as a constraint, not revisited: the SDK has no peer-send
function, the socket protocol is out of scope, and route (b) — the model calling the
CLI's own peer-messaging tool — is what shipped. **One thing 10.1 left open was closed
by measurement here**: the `procStart` encoding. See "The liveness fingerprint,
measured".

---

## Files

### CREATED — `agent-sdk`

- `...\libs\backend\agent-sdk\src\lib\peer-sessions\peer-session-registry.reader.ts` —
  reads `~/.claude/sessions/*.json`; `PeerSessionRecordSchema` (deliberately NOT
  `.strict()`), `scanPeerSessionRegistry`, `recordStartFingerprint`, `currentPidDomain`.
- `...\peer-sessions\peer-session-registry.reader.spec.ts` — 11 tests, fixtures copied
  verbatim from two live records (2.1.268 and 2.1.233).
- `...\peer-sessions\process-start-time.probe.ts` — the PID-recycle-safe liveness half:
  `decodeStartFingerprint`, the Windows PowerShell / POSIX `ps` probes, and the two
  tolerances.
- `...\peer-sessions\process-start-time.probe.spec.ts` — 19 tests, including the measured
  three-record decode table.
- `...\peer-sessions\peer-session-directory.service.ts` — `PeerSessionDirectory.list`,
  `resolveUnreachableReason`, `resolveName`, `unreadableRow`. Carries the
  cross-workspace decision in its doc block.
- `...\peer-sessions\peer-session-directory.service.spec.ts` — 17 tests over the
  reachability matrix and name resolution.
- `...\peer-sessions\peer-session-directory.list.spec.ts` — 6 tests over the assembled
  row set, including the cross-workspace policy and the self-exclusion.
- `...\peer-sessions\peer-message.composer.ts` — `composePeerMessageRequest` and
  `PEER_SEND_ACCEPTANCE_CAVEAT`.
- `...\peer-sessions\peer-message.composer.spec.ts` — 8 tests, plus the source-scan guard
  described under "The naming rule, enforced".
- `...\peer-sessions\peer-session-messenger.service.ts` — `PeerSessionMessenger.send`.
- `...\peer-sessions\peer-session-messenger.service.spec.ts` — 12 tests: 3 accepted-path,
  9 refusal.
- `...\peer-sessions\index.ts` — the sub-barrel.

### CREATED — `shared`

- `...\libs\shared\src\lib\types\rpc\rpc-peer-session.types.ts` — the wire contract.
  `PeerSessionRow`, `PeerSessionReachability`, `PeerSessionUnreachableReason`,
  `PeerSessionNameSource`, `PeerSessionCrossWorkspacePolicy`, `PeerSessionListResult`,
  `PeerSessionSendResult` and its unions.

### CREATED — `rpc-handlers`

- `...\libs\backend\rpc-handlers\src\lib\handlers\peer-session-rpc.handlers.ts` —
  `PeerSessionRpcHandlers`.
- `...\handlers\peer-session-rpc.schema.ts` — both param schemas, `.strict()`.
- `...\handlers\peer-session-rpc.handlers.spec.ts` — 13 tests, including both halves of
  the dual-registration check.

### MODIFIED

- `...\libs\shared\src\lib\types\rpc.types.ts` — `export *` + `import type` for the new
  child file; two `RpcMethodRegistry` entries; two `RPC_METHOD_ENTRIES` entries.
- `...\libs\backend\vscode-core\src\messaging\rpc-handler.ts` — `'peerSession:'` added to
  `ALLOWED_METHOD_PREFIXES`.
- `...\libs\backend\agent-sdk\src\lib\di\tokens.ts` — `SDK_PEER_SESSION_DIRECTORY`,
  `SDK_PEER_SESSION_MESSENGER`.
- `...\libs\backend\agent-sdk\src\lib\di\register.ts` — both registered as singletons.
- `...\libs\backend\agent-sdk\src\index.ts` — public barrel exports.
- `...\libs\backend\rpc-handlers\src\lib\handlers\index.ts` — barrel export.
- `...\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — the `peerSession`
  entry, `requires: []`.

---

## Task 10.2 — the peer session list

### Source of truth

`~/.claude/sessions/*.json`, read directly. No Ptah-side bookkeeping is consulted at any
point, because the sessions that matter here are precisely the ones Ptah did not start.
`.key` files in the same directory are never opened — they hold the peer auth token for
the socket protocol 10.1 ruled out of scope.

The record schema is **not** `.strict()`, and that is a decision rather than an omission.
Live records already disagree with each other: the 2.1.233 record carries no
`peerFeatures`, no `pidDomain` and no `messagingSocketPath`, and one 2.1.268 record
carries an `updatedAt` the others lack. A strict schema would reject exactly the rows
this feature exists to show, and a rejected row is indistinguishable from "no sessions
are running" — the silent omission criterion 3 forbids. Strictness lives at the RPC
boundary, where Ptah owns both sides. Both choices are documented in the files that make
them.

### The liveness fingerprint, measured

`research-report-addressing.md` left `procStart`'s units and epoch unconfirmed and called
it "a small, well-scoped follow-up". It is now confirmed. `procStart` is a Windows
`FILETIME` — 100-nanosecond ticks since 1601-01-01 UTC. Measured 2026-09-12 against
`Get-Process -Id <pid> | ... StartTime` for three live records, **exact to the
millisecond in all three**:

| pid   | record `procStart` | decoded epoch ms | OS `StartTime` ms | delta |
| ----- | ------------------ | ---------------- | ----------------- | ----- |
| 16288 | 134336784461747472 | 1789204846174    | 1789204846174     | 0     |
| 18332 | 134336790403055566 | 1789205440305    | 1789205440305     | 0     |
| 34304 | 134336784594484427 | 1789204859448    | 1789204859448     | 0     |

A fourth record (pid 2832, CLI 2.1.233) named a pid the OS no longer knows — the stale
record this whole check exists for. That table is a spec
(`process-start-time.probe.spec.ts`), so a change in the CLI's encoding fails there first.

Every record on this machine used `procStart`, not `procStartFt`; the reader accepts
either name and callers never have to know which.

### How a row's reachability is decided

Never a bare `pid`-exists check. In order, each step meaning something the next does not:

1. **No `messagingSocketPath`** → `no-messaging-channel`. The session has no peer inbox
   at all.
2. **No `pidDomain`** → `liveness-unverified`. A pid means nothing without its machine.
3. **`pidDomain` is another host** → `other-host`.
4. **No start fingerprint, or one this build cannot decode** → `liveness-unverified`.
5. **The probe returned nothing for this pid at all** → `liveness-unverified`. This is
   the case the empty-map contract exists for: `ProcessStartTimeProbe.probe` returns an
   EMPTY map when the probe itself failed, and a map containing `null` when the OS
   answered that the pid is gone. Collapsing the two would let "could not check" be
   reported as "not running", which is a claim the host cannot make.
6. **The OS reports the pid is gone** → `process-not-running`.
7. **The pid is alive but its start time differs by more than the tolerance** →
   `process-identity-mismatch`. This is the recycled pid, and it is the one a bare
   `process.kill(pid, 0)` would have called reachable.
8. Otherwise reachable.

Tolerance is 1 s on Windows (the measurement was exact, so it is pure slack) and 2 s on
POSIX, where `ps -o lstart=` prints whole seconds.

An unreachable row is **shown**, never dropped. A registry file that does not parse gets a
row too — `record-unreadable`, named after the file — so a user learns something is there
Ptah cannot read, and because it is unreachable, `peerSession:send` refuses it before
anything is composed.

### The cross-workspace decision — INCLUDE

Criterion 5 asks for an explicit, documented decision. It is: **every workspace's
sessions are listed**, each row flagged `inCurrentWorkspace`, and the response carries
`crossWorkspacePolicy: 'include-all-workspaces'` so the policy travels with the data
instead of living only in a comment. Reasons, in order of weight:

1. **A same-workspace filter would delete the main use case.** Ptah's own orchestration
   runs sessions in git worktrees, and a worktree has a different `cwd` by construction.
   The live records show exactly that — `D:\projects\ptah-extension` beside
   `D:\projects\ptah-extension\.claude-worktrees\skills-tab-...`. Those are the sessions
   a user most wants to address, and the filter hides every one of them.
2. **Silent omission is the failure mode criterion 3 names.** A caller can filter an
   included row; it cannot recover an excluded one. Inclusion plus a flag is the
   reversible direction.
3. **Excluding buys no security.** Every row is already gated to this machine and this
   user by `pidDomain`, and the CLI's peer channel is user-scoped, not workspace-scoped —
   a same-user process reaches these sockets whether or not Ptah lists them. The filter
   would remove capability without removing reach.

The decision is written in `peer-session-directory.service.ts`'s module doc block, in
`rpc-peer-session.types.ts`, and pinned by a test.

### Names

`resolveName` handles all three states Batch 9 leaves behind: `nameSource: 'user'` is
shown as chosen; `'derived'` is shown and labelled derived; anything else, or no name at
all, is `'unknown'` — and in the no-name case the row carries a synthesised
`<workspace> (pid <n>)` placeholder rather than an empty string. Every live record on
this machine is `derived`, so that path is the common one, not the edge.

---

## Task 10.3 — the send

### What actually happens

`peerSession:send` resolves the target against the live list, then composes a relay
request into the **sending** session through
`IAgentAdapter.sendMessageToSession` — the same port `AgentReportRouter` uses, no new
port and no new lib. The model in that session then calls the CLI's own peer-messaging
tool. That is route (b), and it is the only route 10.1 left standing.

### `accepted`, and nothing stronger

The outcome type is `'accepted' | 'refused'`. There is deliberately no third value for
"arrived", because no route Ptah has can produce one. Three layers carry the limit:

1. **The type.** `PeerSessionSendResult` has no `delivered` field and no value that could
   be read as one. `acceptanceCaveat` is required on every response — refusals included —
   and states in words that Ptah cannot observe whether the peer received anything, and
   that arrival is confirmed by reading the other session.
2. **The route's costs are on the response, not buried.** `route:
   'model-mediated-cli-tool'`, `costsATurn: true`, `modelMayDecline: true`. Both are
   properties of the route, so they are constant on refusals too — which is documented,
   since a refusal costs no turn.
3. **The composed prompt repeats the rule to the model.** The model, not Ptah, writes the
   answer the user reads, and the natural summary of a successful tool call is "sent it".
   The envelope therefore instructs it to report exactly what the tool returned, states
   that the tool result is not evidence the peer read anything, and forbids describing
   the message as received, delivered or acknowledged. Pinned by a test.

### Refusals

Each is a state, not "something went wrong", and each has its own test:
`unknown-session`, `session-unreachable` (with the row's own reason in `detail`),
`self-addressed`, `origin-session-not-active` (covers both "not live" and a malformed
sender id), `chat-runtime-unavailable` (a host registered without a chat runtime), and
`dispatch-failed` (the injection threw). A dispatch failure is never reported as an
accepted send.

### The naming rule, enforced

`peer-message.composer.spec.ts` carries a source scan over every non-spec file in
`peer-sessions/`: no identifier declaration, property assignment or call named
`deliver` / `delivered` / `delivery` may appear. Comments are stripped first, so the
deliberate "do not say delivered" prose cannot trip its own guard. If someone later adds
`delivered: true`, that test fails before a reviewer has to notice.

### Dual registration — both halves

- Compile-time: `RpcMethodRegistry` and `RPC_METHOD_ENTRIES` in
  `libs\shared\src\lib\types\rpc.types.ts`.
- Runtime: `'peerSession:'` in `ALLOWED_METHOD_PREFIXES`,
  `libs\backend\vscode-core\src\messaging\rpc-handler.ts`.
- Plus the third site this repo actually needs: a `RPC_HANDLER_MANIFEST` entry, without
  which `assertManifestInvariants` fails and no host constructs the class.

`peer-session-rpc.handlers.spec.ts` asserts both halves directly, and
`rpc-allowlist.spec.ts` (unmodified) covers the manifest partition. The manifest entry is
`requires: []`: both methods read a per-user directory under `$HOME` and bind no host
port, so there is nothing for a capability to gate. A host with no chat runtime learns so
from `peerSession:send`'s `chat-runtime-unavailable` refusal — switching the whole
namespace off would instead hide the list, which is useful everywhere.

DI resolution was checked in all three hosts rather than assumed:
`apps\ptah-electron\src\di\phase-2-libraries.ts:183`,
`apps\ptah-extension-vscode\src\di\phase-2-libraries.ts:149` and
`libs\backend\cli-engine\src\lib\container.ts:590` each call `registerSdkServices`, which
is where the two new tokens are bound.

### Zod at the boundary

Both param schemas are `.strict()`. An invalid value is an `RpcUserError('INVALID_PARAMS')`,
never a fallback — a defaulted `sessionId` would address the wrong session and a truncated
`message` would send something the caller never wrote. The message cap is 1 048 576
characters, the Claude channel's own size check, matching `MAX_AGENT_REPORT_LENGTH` in
`cli-agent-runtime`. The number is duplicated rather than imported because `agent-sdk`
must not depend on `cli-agent-runtime`; it is the vendor's constant, not either lib's.

---

## Verification

All commands run from the worktree root at `--parallel=1`, output redirected to a file
and the exit code read directly — never through a pipe.

### Tests — 4 projects, all green

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk \
  @ptah-extension/vscode-core @ptah-extension/rpc-handlers --parallel=1
```

`NX Running target test for 4 projects` — the 4 asked for. `TEST_EXIT=0`.

| Project      | Suites               | Tests                        |
| ------------ | -------------------- | ---------------------------- |
| shared       | 57 passed            | 1381 passed                  |
| vscode-core  | 32 passed            | 525 passed                   |
| agent-sdk    | 101 passed, 1 skip   | 1766 passed, 2 skipped       |
| rpc-handlers | 95 passed            | 2744 passed, 31 skipped      |

`NX Successfully ran target test for 4 projects`.

agent-sdk was 1730 passing before this batch and is 1766 after — 36 new.
rpc-handlers was 2731 and is 2744 — 13 new.

### Typecheck — 4 projects, clean

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk \
  @ptah-extension/vscode-core @ptah-extension/rpc-handlers --parallel=1
```

`NX Running target typecheck for 4 projects` → `Successfully ran target typecheck for 4
projects`. `TYPECHECK_EXIT=0`.

### Lint — one error, and it is the inherited one

```
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/agent-sdk \
  @ptah-extension/vscode-core @ptah-extension/rpc-handlers --parallel=1
```

Exit 1, from exactly one error:
`libs\backend\agent-sdk\src\lib\di\register.compaction-boundary-registry.smoke.spec.ts:37`
— `@nx/enforce-module-boundaries`, importing `@ptah-extension/agent-sdk` from inside
agent-sdk. That is the pre-existing failure inherited from `main` that this batch was
told not to fix and not to let confuse the baseline. Left alone.

**Zero findings attributable to this batch**: `grep -c "peer-session\|peer-message"` over
the lint output returns `0`. No error and no warning names any file created here. The
remaining warnings are pre-existing `max-lines` / `no-non-null-assertion` on files this
batch did not touch.

### Host surface specs

The manifest is shared, so the two hosts that carry `rpc-surface.spec.ts` were run even
though no app file was edited:

```
npx nx run-many -t test -p ptah-extension-vscode ptah-electron --parallel=1
```

Exit 0. ptah-extension-vscode 493 passed / 4 skipped; ptah-electron 39 passed.
`cli-engine` (173 tests, 17 suites) also green in an earlier run.

### What was NOT run, and why

- `nx test ptah-cli` — cannot run in this worktree (TASK_2026_427_f669). Not attempted.
- Raw `jest` — never used, on any path.
- `npx nx reset` — not run.

---

## The batch's own acceptance check — NOT performed, and it matters

`batches.md`'s "Batch 10 verification" asks for a live two-session run: send from one,
then **read the receiving session** to confirm the turn arrived, and repeat with the
receiver stopped.

**That was not done, and it cannot be done from here.** It needs two live interactive
Ptah sessions and a real model turn; this executor has neither a second session nor a
model in the loop. Every claim in this report is therefore static plus unit-level, which
is exactly the standing this feature's honesty contract assigns to an unverified send —
and it is also why the response says `accepted` rather than anything stronger.

What is measured and not merely argued: the `procStart` decoding (three live records
against the OS, table above), the registry record shapes (fixtures copied verbatim from
live files), and the fact that pid 2832's record outlived its process.

What remains unmeasured, and should be the first thing Batch 8 or a `senior-tester` run
checks:

1. **Whether an SDK-hosted session (`entrypoint: sdk-ts`) actually has the CLI's
   peer-messaging tool available.** 10.1 established the tool is not restricted by
   `sdk-query-options-builder` and that the CLI gates it behind `isolatePeerMachines`
   only for cross-machine peers. It did NOT confirm the tool is present on the SDK
   transport's tool list. If it is absent, `peerSession:send` still behaves correctly —
   it returns `accepted`, the model finds no tool, and the model reports that plainly,
   because the envelope instructs it to. Nothing lies; the feature simply does not
   deliver. That is a real risk and it is named here rather than smoothed over.
2. **Whether the receiving session renders the inbound turn.** Batch 1's peer branch and
   `crossSessionInbound: 'accept'` cover a session Ptah started. A session Ptah did not
   start keeps the CLI's hold-then-expire default (R-9), so a message to it may be
   accepted, sent, and silently held. The list cannot detect this — the registry records
   no inbound policy — so it is not represented in the row, and should not be faked.

---

## Plan deviations

- **10.1's one open question was closed rather than inherited.** The research called the
  `procStartFt` encoding "a small, well-scoped follow-up, not a blocker". Building on an
  unconfirmed encoding would have meant every row reading `liveness-unverified` on a
  wrong guess, so it was measured first. It is a `FILETIME`, exact.
- **An epoch-millisecond decode fallback was added, and is labelled unmeasured.** Only
  the Windows FILETIME shape is measured. The fallback exists so a future non-Windows
  build storing plain milliseconds is readable. A wrong guess there can only produce a
  failed comparison, i.e. `liveness-unverified` — never a false reachable.
- **A third registration site beyond the two the brief names.** The brief names
  `rpc.types.ts` and `ALLOWED_METHOD_PREFIXES`. In this repo a namespace also needs a
  `RPC_HANDLER_MANIFEST` entry or `assertManifestInvariants` fails and nothing
  constructs the handler. All three are done.
- **`resolveUnreachableReason` takes a context object rather than five positionals.**
  Done so `hostPidDomain` and `now` can be injected and the rule is testable off a
  Windows host. No behavioural difference.

---

## Out-of-scope observations

- **Two files in this worktree are modified by someone else.**
  `content-manifest.json` and
  `libs\backend\agent-sdk\src\lib\helpers\session-title.service.ts` (a
  `// degradation-audit: reported` comment added), plus an untracked
  `.ptah\specs\TASK_2026_427_ci497\`. None is mine; the tree was described as clean at
  `69c03977f`. Left untouched — another executor is sharing this worktree, as the
  universal rules anticipate.
- **No frontend surface exists for either method.** `peerSession:list` and
  `peerSession:send` are reachable over RPC and have no UI. Requirement 10 is written in
  terms of a user asking and a user sending; wiring the picker is a frontend batch this
  one did not own and did not widen into.
- **`livenessVerifiable: false` on an unsupported platform is honest but useless.** On a
  platform with neither PowerShell nor `ps` (the probe supports `win32`, `linux`,
  `darwin`), every row degrades to `liveness-unverified` and nothing is addressable. The
  flag exists so a caller can explain that rather than show an empty-looking list. Given
  the task's own NFR scopes the peer channel to native Windows, this was not widened.
- **Nothing here reads or writes `messagingSocketPath`.** It is used only as evidence
  that a session has a peer inbox at all. The socket protocol stays out of scope, per
  10.1.

## Left undone

- The live two-session acceptance check (see above) — cannot be performed by this
  executor.
- A UI for either method.
- `batches.md` was not edited; the team-leader owns task state.
