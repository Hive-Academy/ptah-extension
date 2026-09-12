# Research Report - TASK_2026_402_a5c7 (Task 10.1)

## Question

- Decision this supports: whether Batch 10 (tasks 10.2, 10.3 — a peer session
  picker and a send-by-name tool) can be built at all, and if so, on which
  transport.
- Question: when a user in one Ptah session addresses another live session by
  name, how does the turn actually get delivered — from Ptah's own process,
  without a model in the loop?
- Bounds: this does not design 10.2 or 10.3. It does not benchmark performance.
  It does not attempt a live two-process delivery test — see Unknowns for why,
  and what that costs the confidence of the recommendation.

## Important caveat on inputs

`task-description.md` and `batches.md` cite a `research-report.md` (§1.1,
§1.3, §2.6-§2.9, §3.1, §4.2, §5.2, §6, §7.2, §7.6, §7.7, §7.9) as the source
for Appendices A1-A8 — the two measured message-loss cases (A5, A6), the fix
(A8), and the naming finding (A7). **That file does not exist in this task
folder, in the worktree, or anywhere in this repository's git history**
(verified: `git log --all -- '*/TASK_2026_402_a5c7/research-report.md'`
returns nothing, and a workspace-wide file search for `research-report.md`
finds it under ten *other* task ids, never under `TASK_2026_402_a5c7`). The
folder's own restore commit (`d11dc3153`) says the folder "was never committed
and died with the worktree" and lists exactly which files were recovered from
the orchestration transcript — `research-report.md` is not among them. So the
A5-A8 findings are **second-hand, attributed to a document I cannot read and
cannot verify**, not independently confirmed by me. Wherever this report
relies on them, that is stated as "per task-description.md, unverified by
this report" rather than presented as this report's own measurement. Everything
else below **is** verified directly, in this session, against the files named.

## Answer

No route lets Ptah's own process deliver a turn to another live session
without going through the target's `claude` CLI process — the only writer,
reader and auth-holder of the messaging channel is the CLI binary itself, not
the SDK. Of the three candidate routes, one is real but not owned by Ptah (the
model calling the CLI's own `SendMessage` tool, route b), one does not exist
in the SDK's public surface at all (routes a and c collapse to "reimplement an
undocumented private protocol" and "no such control request exists",
respectively). **Route (b) is the only one that can ship in this task**, and
it can only ever report ACCEPTANCE (the CLI queued/wrote the message), never
DELIVERY (the peer read and acted on it) — that gap is the SDK vendor's own
limitation, not Ptah's, and it is the same gap Appendix A5/A6 (per
task-description.md, unverified here) already names as the defect this whole
task exists to fix. Recommendation: build 10.2/10.3 on route (b), and make the
outcome reporting say "sent" / "accepted by transport", never "delivered",
because Ptah cannot know delivery happened.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Pinned SDK version is 0.3.150 | `D:\projects\ptah-extension\package.json:99`; `node_modules/@anthropic-ai/claude-agent-sdk/package.json` | read 2026-09-12 | read the file |
| `sdk.d.ts` exports exactly these top-level functions: `createSdkMcpServer, deleteSession, filterEscalatingDefaultMode, foldSessionSummary, forkSession, getSessionInfo, getSessionMessages, getSubagentMessages, importSessionToStore, listSessions, listSubagents, query, renameSession, resolveSettings, startup, tagSession, tool` — no peer-send function of any name | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (grep `^export declare function`) | read 2026-09-12 | ran a grep over the installed `.d.ts`, read every line of output |
| `SDKControlRequestInner` union (45 members) has no message-shaped subtype — the closest are `SDKControlRemoteControlRequest`, `SDKControlChannelEnableRequest`, `SDKControlMcpMessageRequest` (all unrelated to peer sessions) and `rename_session` (title only, already used by Batch 9) | `sdk.d.ts:3008` | read 2026-09-12 | read the full type union and every listed subtype's own declaration |
| `SDKMessageOrigin` models `{ kind: 'peer', from: string, name?: string }` as an inbound provenance the SDK CAN report to a *receiver*, but this is a read-side type — nothing on the send side | `sdk.d.ts:3246-3259` | read 2026-09-12 | read the type declaration |
| `isolatePeerMachines` setting doc comment: "Require explicit approval before SendMessage can reach a peer session on another machine via Remote Control" — confirms `SendMessage` is the CLI's own named mechanism, gated by a *settings flag*, not an SDK call | `sdk.d.ts:5407-5409` | read 2026-09-12 | read the doc comment in place |
| The live CLI binary at this version (`2.1.268`, PE32+ / bun-compiled, 221 637 792 bytes) contains, as plain text inside the executable: the literal tag pair `<cross-session-message from="…" from-name="…" from-mode="…">…</cross-session-message>`, a rate-limit object `bucketCapacity:30,refillPerSecond:0.5,dedupWindowMs:30000,maxSelfHops:10,maxChainLength:28,maxTrackedSenders:256`, the error taxonomy `no_live_inbox` / `ENOINBOX` / `message_too_large` / `sender_paced`, and the log line `[uds-client] Sending ${n.length} chars to ${target}` | `C:\Users\abdal\.local\share\claude\versions\2.1.268` (binary) | measured 2026-09-12 | `grep -a -o` over the raw binary bytes, same technique batch-5-report.md describes; multiple independent hits, several with surrounding code context read |
| A length-prefixed frame constructor exists: `writeUInt32BE(payloadLength, 0)` + a 1-byte opcode + payload, and a size guard `if (serializedLength > set) throw messageTooLarge` where `set = 1048576` (1 MiB) | same binary, functions `tet(e)` and `ye(e)` | measured 2026-09-12 | read the decompiled-as-text function bodies around the `writeUInt32BE` and `set=1048576` hits |
| The pacing/rate-limit check (`Ke().reserve(...)`, `sentInBurst`) runs on the **sending** side inside the CLI's own `uds-client` module, before the frame is written — i.e. it is client-side self-throttling built into the CLI binary, not a server-side guarantee Ptah could add value on top of | same binary | measured 2026-09-12 | read the code immediately preceding and following the `[uds-client] paced` log string |
| Socket-path validation regex accepts exactly the observed shapes: POSIX `^\/tmp\/cc-socks(?:-(0\|[1-9]\d*))?$` / `^\/\S*\.sock$`, and Windows `^[\\/]{2}[.?][\\/]pipe[\\/](?:(LOCAL)[\\/])?([^\\/]+)$` — matching the live record's `\\.\pipe\LOCAL\cc-msg-<hash>` | same binary | measured 2026-09-12 | read the regex literals in the binary text |
| The auth handshake: a per-session `.key` file at `~/.claude/sessions/<pid>.<hash>.key` holds `{"peerToken":"<32 hex chars>","procStartFt":"<uint64 string>","pidDomain":"win32:<domain>"}`, and the wire schema validates `peerToken` against `/^[0-9a-f]{32}$/` | live file `C:\Users\abdal\.claude\sessions\16288.5838b8359050cbacdc19400d8ebbd8583f5986252b7f11924332181618d5980c.key`; binary regex `Pfe=/^[0-9a-f]{32}$/` | measured 2026-09-12 | read the live key file's raw bytes (`xxd`), cross-checked its shape against the binary's own schema regex |
| Liveness/PID-recycle check exists and is already implemented, CLI-side: `requireLiveOwner` compares a stored start-fingerprint (`procStart`/`procStartFt`) against the CURRENT process's fingerprint for that pid, and returns `{ kind: 'dead-owner' }` on mismatch — i.e. a recycled pid is detected, not assumed alive | same binary, functions around the `dead-owner` string | measured 2026-09-12 | read the comparison code (`VE(D)`, `el(I.pid)`, `Z_e(N,L)`) around both `dead-owner` occurrences |
| Live session registry records on this machine actually carry `procStart` (older schema) or `procStartFt` (current schema) plus `pidDomain`, alongside `peerProtocol`, `peerFeatures`, `messagingSocketPath`, `name`, `nameSource` | `C:\Users\abdal\.claude\sessions\2832.json`, `16288.json` | read live 2026-09-12 | read both files directly |
| `procStart` / `pidDomain` are not referenced anywhere in this repository's TypeScript source (no type models them yet) | grep across `libs/` and `apps/` in the worktree | checked 2026-09-12 | ran a repo-wide grep, zero hits outside spec fixtures |
| `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts` and its module's `CLAUDE.md` doc block confirm: `crossSessionInbound: 'accept'` is set per-session by Ptah only for sessions Ptah itself spawns; a session Ptah did not start keeps the CLI's default hold-then-expire behaviour | `session-name.builder.ts:82-90`; `libs/backend/agent-sdk/CLAUDE.md` ("A Ptah-started session accepts a peer-injected turn…") | read 2026-09-12 | read both files in full |
| CLI 2.1.268 is live and running on this machine right now (multiple `~/.claude/sessions/*.json` records, one of them this very session, pid 16288) | `claude --version` → `2.1.268 (Claude Code)`; `~/.claude/sessions/16288.json` | measured 2026-09-12 | ran the command; read the file |
| No `test-report.md` exists in the task folder, and no batch report before this one records a live two-session delivery test having been run for this feature | directory listing of `.ptah/specs/TASK_2026_402_a5c7/`; grep for "A1" across `batch-9-report.md` | checked 2026-09-12 | listed the folder; grepped the most recent batch report |

## Options (the candidate routes)

| Route | What it requires | Cost | Can it report DELIVERY, or only ACCEPTANCE? |
| --- | --- | --- | --- |
| (a) Write directly to `messagingSocketPath` | Reimplementing, outside the SDK, an undocumented protocol: the `peerToken` handshake (32-hex-char token read from a `.key` file whose path itself must pass a strict regex), the 4-byte-length-prefixed + opcode framed message, the `<cross-session-message from=… from-name=… from-mode=…>` payload wrapper, the 1 MiB size cap, and matching the CLI's own client-side rate limiting (30 burst / 0.5 per second) so Ptah does not get itself banned by a limiter it did not implement | High and ongoing: every field, every regex and the frame opcode are internal identifiers with no compatibility promise, minified names differ across even same-numbered builds (confirmed: batch-5-report.md's `framedLength`/`set` naming does not match what this session found in the same version), and this is exactly the "raw inbox-socket posting" the task-description.md Scope section rules **out of scope** ("the auth line is documented; the message line is not") | Neither, reliably: even a correct write only proves the CLI's inbox accepted the frame, not that the target session's running turn read it — that is the exact A5/A6 gap. **Not attempted here** — see Unknowns for why (no isolated second session to test against, and misusing a real user's live pipe is not a safe experiment) |
| (b) Model calls the CLI's own `SendMessage` tool | Ptah composes the prompt/context that makes the model call it; the tool exists on the CLI's tool list by default (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` sets no `allowedTools`/`disallowedTools` restriction that would remove it — checked, zero hits) | Low to build, but non-deterministic to run: it costs a whole turn, the model can decline or phrase it wrong, and the result the model reports back is whatever the CLI's tool result says — which, per the binary's own log line (`[uds-client] Sending N chars to X`), is a SEND confirmation, not a read confirmation | ACCEPTANCE only, and says so honestly: the tool's own success means "queued to the peer's inbox," matching the task's own framing (a send that returns `success: true` is not evidence of delivery) |
| (c) An SDK control request | A `subtype` in `SDKControlRequestInner` shaped like a peer send | None — because it does not exist. Verified: the full 45-member union at `sdk.d.ts:3008` has no cross-session-message-shaped member; the closest cousins (`rename_session`, `remote_control`, `mcp_message`) do different jobs | N/A — nothing to evaluate; the route is closed |
| (d) Something else in the bundle | — | — | The only other message-shaped surface found in the binary is the tool argument schema itself: `"SendMessage"` with args `["type","recipient","content","request_id","approve"]`. This is route (b)'s own tool, seen from the inside — not a fourth route. No other send-capable surface turned up in the strings scan (searched for `peer`, `cross-session`, `cc-msg`, `SendMessage`, `agent-message`, `.sock`, `writeUInt32BE`, `dead-owner`) |

## Disagreements

- task-description.md (attributed to the missing research-report.md) states
  Appendix A8 fixed delivery "on the first try" via `crossSessionInbound:
  accept`, and that this was "measured" end to end. I cannot verify that claim
  myself — I have no evidence in this task folder of a live two-session run,
  and the most recent batch report (`batch-9-report.md`) does not mention it
  either. This is not a contradiction, just an unverifiable inheritance: the
  claim may well be true, but this report cannot promote it to "verified here."
- batch-5-report.md names the size-cap variable `framedLength` and quotes
  `if (framedLength > 1048576)`. In this session's read of the same-numbered
  binary (`2.1.268`), the equivalent guard reads `if (r > set) throw ce(r,
  set)` with `set = 1048576` — same constant, different minified names. What
  decides it: the **numeric constant and the error taxonomy are stable and
  reusable as evidence; the identifier names are not**, because a bun/esbuild
  minifier does not guarantee stable symbol names across builds even at one
  version number. Any future work citing "the CLI's internal symbol X" should
  re-derive X at build time, not hardcode last session's name.

## Local consequences

- `libs/backend/agent-sdk/CLAUDE.md` and `session-name.builder.ts` already
  correctly scope `crossSessionInbound: accept` to sessions Ptah spawns; this
  finding does not change that file. It confirms the boundary is real: Ptah's
  own sessions are receive-ready, but Ptah has and can have no send-side
  transport of its own.
- `libs/backend/agent-sdk/src/lib/message-transform/` (per task-description.md
  §3, "no `origin` handling exists today") is the receive side and is
  unaffected by this finding — 10.1 is about the SEND side only.
- Any 10.3 implementation that calls route (b) must not surface the CLI tool's
  `success: true` as "delivered" in the RPC response or the UI. The response
  contract should use language like `sent` / `acceptedByTransport`, with an
  explicit, permanent caveat that Ptah cannot confirm the peer acted on it —
  matching Requirement 10 acceptance criterion 4 verbatim.
- No new RPC namespace decision is made by this report; it only rules out (a)
  and (c) as build targets so 10.2/10.3 do not spend time on either.

## Answer to the 10.2 sub-question (liveness detection from the registry alone)

Yes, on the CURRENT schema, and the CLI itself already implements exactly this
check for the same reason Ptah would need it. A bare `pid` is not enough on
Windows because pids recycle; the registry record for a live session (see the
`16288.json` example above) carries `procStart`/`procStartFt` (the process's
start-time fingerprint, stringified) and `pidDomain` (a machine/user
qualifier, e.g. `win32:abdo`) alongside the `pid`. The CLI's own binary
implements a `requireLiveOwner` check that: (1) confirms the pid is still
running, then (2) re-reads the CURRENT process's start fingerprint for that
pid and compares it to the fingerprint stored at registration time, returning
a distinct `dead-owner` result on mismatch rather than treating "pid exists"
as "same process." That is a correct, PID-recycle-safe liveness test, and
Ptah can build the identical comparison from the same two fields once it reads
them.

**Static vs. what would need confirming**: I confirmed by direct read that (1)
`procStart`/`procStartFt` and `pidDomain` are present in live records on this
machine, and (2) the CLI binary's own code performs exactly this comparison.
I did NOT verify how to obtain "the current process's start fingerprint for a
given pid" from Node/TypeScript on Windows in a way that matches the CLI's own
encoding (`procStartFt` looks like a Windows `FILETIME`-style 64-bit tick
count, consistent with `GetProcessTimes`, but I did not decode the exact
epoch/units — that would need either reading more of the binary's own
encoder function or a live comparison against a `Get-Process` / WMI value).
That is a small, well-scoped follow-up, not a blocker to using the two fields
as the liveness key.

Also confirmed, separately: `procStart`/`pidDomain` do not appear anywhere in
this repository's own TypeScript today (zero grep hits outside this research).
Any 10.2 implementation is the first place that will need to model them.

## Unknowns

- **No live two-session delivery test was run for this report.** The task's
  own honesty requirement is explicit that a "delivery" claim needs two live
  sessions, and this session has exactly one host process to work from (this
  Claude Code session itself, pid 16288, plus whatever other `.json`/`.key`
  pairs happen to be sitting in `~/.claude/sessions/` from past, likely-dead,
  runs). I chose not to fabricate a second live session or attempt to inject
  a raw frame at a real, currently-registered pid belonging to an unrelated
  process on this machine, because (1) route (a) is explicitly out of scope
  per task-description.md's Scope section, (2) I do not know if any of the
  other registry entries are live or safe to poke at, and (3) getting the
  frame format wrong against a real peer's inbox is not a safe way to find
  out — it risks corrupting or rate-limiting a session I do not own. **This
  means the recommendation for route (b) is a static+structural argument (the
  tool exists, is unrestricted, and its own success value is documented as
  send-not-delivery), not a measured one.** The smallest real experiment: two
  Ptah-spawned Claude sessions in the same workspace, one asked (via prompt or
  workflow text) to `SendMessage` the other by its registry name, then reading
  the target's transcript for the inbound turn — exactly the check
  batches.md's own "Batch 10 verification" section already specifies for
  10.2/10.3, not for 10.1.
- The exact encoding of `procStartFt` (units, epoch) is unconfirmed; only its
  presence and its role in the CLI's own liveness comparison are confirmed.
- Whether the A5/A6/A8 findings this task was built on are accurate is now,
  strictly, unverifiable from inside this task folder — the source document is
  gone. If those findings matter for a downstream decision, they should be
  re-measured rather than cited from memory of a document nobody can open.
