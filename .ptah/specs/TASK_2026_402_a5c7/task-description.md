# Requirements - TASK_2026_402_a5c7

## Context

Claude Code ships a peer-session channel: every session registers in
`~/.claude/sessions/<pid>.json` and can call `ListAgents` / `SendMessage` against
the others on the machine. Ptah already satisfies the entry condition without
having asked for it — every SDK session Ptah starts registers with
`entrypoint: "sdk-ts"` and shows up in another session's `ListAgents`
(research-report.md §1.1, Appendix A4). What Ptah does not do is make that
channel *work*: measured on this machine at CLI 2.1.259 / SDK 0.3.150, a message
from a spawned child to the parent chat and a message from the parent to that
same child both reported `success: true` at the sender and **were never
delivered** (Appendix A5, A6). The cause is documented and specific: under full
auto the main chat runs SDK `default` (prompting class) while spawned children
run `bypassPermissions`, the classes mismatch, the receiver holds the message for
a TUI approval dialog no headless session can show, and five minutes later it is
dropped (research-report.md §6). Adding `crossSessionInbound: "accept"` to the
child's settings fixed delivery on the first try (Appendix A8). Every Ptah
session is also `nameSource: "derived"`, producing collision-prone labels like
`ptah-extension-70` beside `ptah-extension-43` in one workspace; `--name` reaches
a headless run and registers `nameSource: "user"` (Appendix A7).

The second half of the request is the non-Claude fleet. Rival CLIs are not Claude
sessions, bind no inbox socket and can never appear in `ListAgents`, so the peer
channel cannot carry them — but they already see Ptah's MCP tools (codex,
antigravity and the Ptah CLI Claude agent all verified, Appendix A1-A3). Ptah
owns both directions there and has built neither properly. Parent-to-child is
`AgentProcessManager.steer()`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:983`),
which refuses everything whose adapter returns `supportsSteer() === false` — that
is every CLI except pi (steering-research.md Q1) — while
`continueConversation()` at `:1033` already delivers a next-turn message for
codex, copilot, cursor and Ptah CLI agents and has no MCP tool in front of it. So
the capability exists and is unreachable, and the one tool that is reachable,
`ptah_agent_steer` (`tool-description.builder.ts:653`,
`protocol-dispatcher.ts:809`), fails for five of six vendors. Child-to-parent does
not exist at all: a spawned codex agent has no way to say anything to the session
that spawned it short of the parent polling `ptah_agent_read`.

The three tracks below are independently shippable. Track A makes Ptah's own
Claude sessions message-ready so workflows and skills can rely on the SDK
feature. Track B gives one parent-to-child tool that reports honestly which
mechanism fired. Track C adds the missing child-to-parent direction. Nothing here
requires migrating any vendor transport.

## Classification

- Type: FEATURE
- Estimate: L — three tracks across five libs (`agent-sdk`, `cli-agent-runtime`,
  `vscode-lm-tools`, `shared`, frontend chat), a new adapter capability contract
  implemented per vendor, two new MCP tools that must each land on both MCP
  surfaces, and a new inbound message kind rendered in the UI. No single track is
  large; the breadth is.
- Priority: not defined here — this repository defines no priority scale, and the
  request set none.

## Scope

In scope:

- **Track A — Ptah SDK sessions message-ready.** `crossSessionInbound: accept`
  reaches the CLI for Ptah chat sessions and for Ptah CLI spawns, through the
  single settings builder `buildFlagSettings`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:358`,
  consumed at `:795` for chat and at
  `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:730` for
  spawns). Deliberate `--name` per session via SDK `extraArgs`, carrying role and
  task id. Inbound peer turns (`SDKUserMessage.origin.kind === 'peer'`) rendered
  in chat as inbound peer messages rather than as the user's own prompts.
- **Track B — parent to child.** One MCP tool
  `ptah_agent_message({ agentId, message })` returning the mechanism that fired:
  `steer | interrupt-resume | queue-next-turn | unsupported`. Routes to the
  existing `steer()` (pi), a new `interrupt()` (cursor), or the existing
  `continue()` / `continueConversation()` (codex, copilot, cursor, Ptah CLI).
  Capability flags declared on `SdkHandle` / `CliAdapter`
  (`cli-adapter.interface.ts:49,105`) so the router never special-cases a vendor
  name. `ptah_agent_steer` becomes an alias of the new tool or is retired —
  it does not survive alongside it.
- **Track C — child to parent.** `ptah_agent_report({ message })`, callable by any
  spawned CLI that has MCP, landing in the spawning session's input mailbox as a
  tagged inbound message and shown in that agent's tile and in chat.
- Workflow and skill text updated so both directions are actually used, and the
  per-CLI capability is discovered at runtime rather than assumed.

Out of scope:

- **Codex `app-server` migration.** `turn/steer` and `turn/interrupt` exist, but
  only on the JSON-RPC app-server protocol, not on the `@openai/codex-sdk`
  0.147.0 `Thread` API this repo imports (steering-research.md Q1.1). Moving
  there rebuilds ~650 lines of event mapping against a new transport. Codex takes
  `queue-next-turn` here; the migration is its own task.
- **opencode `serve` migration.** True interrupt-resume needs the HTTP server mode
  (steering-research.md Q1.5, Q2). Its own task.
- **Antigravity persistent `--input-format stream-json` process.** Today's
  one-shot `--print` shape closes stdin immediately
  (`antigravity-cli.adapter.ts:494`), so antigravity reports `unsupported` and
  that is correct, not a defect. Its own task.
- **Raw inbox-socket posting.** The auth line is documented; the message line is
  not, and Ptah runs on Windows where the auth line is mandatory
  (research-report.md §4.2, §7.6). Everything here goes through MCP tools Ptah
  owns end to end.
- **Upgrading `@anthropic-ai/claude-agent-sdk` past the pinned 0.3.150**
  (`package.json:97`), unless a requirement below cannot be met without it. Only
  `origin.fromMode` needs a newer SDK and nothing here depends on it.
- **Agent teams.** SDK sessions cannot spawn teammates (research-report.md §5.2).
- Changing the permission mode of any session to make classes match. `accept` is
  the documented fix; re-classing sessions is not.

## Requirements

### 1. A Ptah session accepts messages from its peers

Requirement: a Ptah SDK session — the main chat and every Ptah CLI agent Ptah
spawns — receives a `SendMessage` addressed to it, whatever permission class the
sender declares, instead of silently holding and dropping it.

Acceptance criteria:

1. When a Ptah CLI agent is spawned under full auto and a peer session in the
   prompting class sends it a message, the agent's transcript shows the message
   within one turn boundary. This is the exact case measured as lost in
   Appendix A5/A6 and fixed in A8, so the reviewer can reproduce both sides.
2. When the main chat session is running and a spawned `bypassPermissions` child
   sends it a message, the chat receives it — the reverse direction of the same
   mismatch.
3. When a session starts, the value that reaches the CLI is exactly one of
   `accept`, `hold`, `refuse`. An unrecognised value must never be emitted: the
   CLI responds to one by holding every inbound message even when a
   higher-precedence source says `accept` (research-report.md §2.6), which
   reproduces the defect being fixed while looking configured.
4. When a session is started with no output style active, the settings object
   still omits the `outputStyle` key. The G4b rule at
   `sdk-query-options-builder.ts:343-357` is unchanged by this work, and
   `sdk-query-options-builder.output-style.spec.ts` must still pass.
5. When the settings value is carried in a form the SDK's typed `Settings`
   interface does not model, the code states in a comment why (the interface at
   `sdk.d.ts:3967-5435` has no `crossSessionInbound` key and no index
   signature). No `@ts-ignore`.

### 2. A Ptah session is addressable by a name a human chose

Requirement: each Ptah SDK session registers under a deliberate name that reads
usefully in another agent's `ListAgents` output and does not collide inside one
workspace.

Acceptance criteria:

1. When a session starts, its record in `~/.claude/sessions/<pid>.json` shows
   `nameSource` other than `derived`, and a `name` that identifies the session's
   role and its task id.
2. When two Ptah sessions run in the same workspace at the same time, their
   registry names differ. The CLI performs no collision check for a `-p` or SDK
   session (research-report.md §1.3), so uniqueness is Ptah's to guarantee.
3. When the name cannot be applied for any reason, the session still starts and
   the failure is logged. A naming problem must not cost the user a session.

### 3. An inbound peer message is visible as a peer message

Requirement: when another session injects a turn into a Ptah chat session, the
person watching sees who sent it and that it came from outside, rather than
seeing their own words they never typed.

Acceptance criteria:

1. When an `SDKUserMessage` arrives with `origin.kind === 'peer'`, the chat
   renders it as an inbound peer message, visually distinct from a prompt the
   user typed. No `origin` handling exists in
   `libs/backend/agent-sdk/src/lib/message-transform/` today, so this is new
   behaviour, not a modification.
2. When that message is rendered, the sender label is `origin.name`. It is never
   `origin.from`, which is sender-authored and forgeable by any same-user process
   (research-report.md §3.1), and never presented as a verified identity —
   `verifiedPeerPid` is absent on Windows.
3. When `origin.name` is absent, the message renders with a neutral peer label
   and is still shown. An unnamed sender must not suppress the message.
4. When the message body contains markdown, it is rendered through
   `libs/frontend/markdown`. No second sanitizer.

### 4. One tool sends a message to a spawned agent, whatever the vendor

Requirement: a parent agent sends a mid-run instruction to any spawned child with
one call, and learns which delivery mechanism actually fired, because the three
mechanisms have different costs — interrupt-resume discards whatever partial work
the aborted turn held; steer and queue do not.

Acceptance criteria:

1. When `ptah_agent_message({ agentId, message })` is called against a running
   agent, the result names the mode used: `steer`, `interrupt-resume`,
   `queue-next-turn` or `unsupported`.
2. When the target adapter supports mid-turn steering, the mode is `steer` and
   the message reaches the child within the current turn. pi is the only vendor
   that qualifies today (`pi-cli.adapter.ts:191`).
3. When the target adapter supports interrupt-then-resume, the mode is
   `interrupt-resume`, the current run ends, and a new run carrying `message`
   starts on the **same** agent id and session. Cursor qualifies via
   `run.cancel()` + `agent.send()` (steering-research.md Q1.3).
4. When neither applies but the handle reports `supportsContinuation()`, the mode
   is `queue-next-turn` and the message is delivered as the next full turn.
   Codex, copilot and Ptah CLI agents reach this path through the existing
   `continueConversation()` (`agent-process-manager.service.ts:1033`).
5. When the adapter supports none of the three, the mode is `unsupported` and the
   result says which vendor and why. The call does not throw and does not report
   a success the caller would act on. Antigravity in its current one-shot shape
   is the reference case.
6. When the target agent id is unknown, is a restored record, or is not running,
   the tool returns a distinct error naming that state — the three conditions
   `steer()` already separates at `:985`, `:989` and `:998`, including the
   restored-record recovery that points at `resume_session_id`.
7. When the mode is selected, it is selected from capability flags declared by
   the adapter, not from a check on the CLI's name. A reviewer can add a seventh
   adapter and reach every mode without editing the router.
8. When `ptah_agent_steer` is invoked after this change, it behaves as an alias
   of `ptah_agent_message` or no longer exists. Two tools that both claim to send
   an instruction to an agent must not both ship.

### 5. The capability of each CLI is discoverable before it is used

Requirement: an agent choosing where to delegate can read what each installed CLI
can be told mid-run, without spawning one to find out.

Acceptance criteria:

1. When `ptah_agent_list` is called, each system-CLI row's capability cell states
   the messaging mode that vendor supports — `steer`, `interrupt`, `queue` or
   `none` — replacing today's binary `steer: yes | no`
   (`mcp-response-formatter.ts:499`).
2. When a capability is reported for a CLI, it matches the mode
   `ptah_agent_message` actually selects for an agent spawned on that CLI. A
   reviewer can check any row by spawning that CLI and sending one message.
3. When the list is rendered, it names no vendor as available that is not
   installed on this machine, and the strings still pass
   `vendor-roster-drift.spec.ts`.

### 6. A spawned agent can report back to the session that spawned it

Requirement: a child CLI agent tells its parent something mid-run — a blocker, a
finding, a question — and the parent sees it without polling.

Acceptance criteria:

1. When a spawned agent calls `ptah_agent_report({ message })`, the message
   appears in the spawning session's chat, tagged with the reporting agent's id,
   within one tool round of the call. A codex child is the reference case, since
   codex has MCP and no steering of any kind.
2. When the report is delivered, it is attributed to the parent recorded at spawn
   time (`parentSessionId` on the tracked agent record, set via
   `resolveParentSessionId()`), not to an MCP caller session id. A spawned CLI
   connects on the workspace MCP URL and carries no `_callerSessionId`
   (`http-server.handler.ts:339`), so caller-derived attribution would land the
   report in whichever session resolved first — the defect TASK_2026_295 fixed
   for spawn attribution.
3. When the spawning session no longer exists or was never recorded, the tool
   returns `delivered: false` with a reason. It never reports a delivery it did
   not make.
4. When a report arrives, it is also visible on that agent's tile, so a user
   watching the agent rather than the chat sees it.
5. When a child sends messages rapidly, the parent is protected by a bounded
   queue and a per-sender rate limit, and an over-limit or over-size message is
   refused at the caller with a reason. Match the Claude channel's own limits
   rather than inventing new ones (research-report.md §2.8) so behaviour is one
   mental model across vendors.
6. When `ptah_agent_report` is called by an agent whose CLI has no MCP (pi,
   `pi-cli.adapter.ts:150`), nothing regresses — pi's existing segment stream
   remains its reporting path.

### 7. Both new tools exist on both MCP surfaces

Requirement: the new tools are reachable from every context Ptah serves MCP in,
because a tool present on one surface and absent from the other is a capability
that works for some spawned agents and mysteriously does not for others.

Acceptance criteria:

1. When the HTTP MCP surface lists tools, `ptah_agent_message` and
   `ptah_agent_report` are present (`mcp-core/protocol-dispatcher.ts`).
2. When the stdio MCP surface lists tools, both are present
   (`mcp-stdio/agent-tool.dispatcher.ts`). The repository already treats
   single-surface exposure as a bug (`vscode-lm-tools/CLAUDE.md`).
3. When either tool is called with arguments that do not match its schema, the
   call returns an MCP tool error naming the offending field. It never falls back
   to a default — a discarded argument is invisible to the calling agent.

### 8. Workflows and skills use the channel

Requirement: the harness text tells an agent how to reach its peers and its
children, and states what is and is not guaranteed, so the capability is used
correctly rather than discovered by trial.

Acceptance criteria:

1. When an agent reads Ptah's workflow or skill guidance, it finds how to
   discover peers, how to message a spawned child, and how a child reports back.
2. When that guidance names a per-CLI capability, it directs the reader to
   `ptah_agent_list` rather than stating a fixed roster. Vendor capability is a
   runtime fact and this repository already enforces that for spawn.
3. When the guidance describes waiting on another session, it says to use
   `notify_when_idle` and states its two limits: only the main conversation may
   subscribe, and only for sessions on this machine (research-report.md §7.7).
   A subagent that subscribes gets the whole call refused, message included.
4. When the guidance is written, it records the CLI and SDK version floors this
   behaviour needs (research-report.md §7.9).

### 9. A peer sees the name the user gave the session

Added 2026-09-12, after Requirement 2 shipped in Batch 1.

Requirement 2 is met — a Ptah session now registers a deliberate, unique,
role-shaped name instead of a derived one. What it does NOT carry is the name
the user actually sees in the Electron session list. `buildExtraArgs` passes a
hardcoded `role: 'chat'`, and `AISessionConfig` has no name field to read, so a
peer browsing `ListAgents` still cannot tell one chat from another by anything a
human chose.

Two SDK surfaces carry a name, and they are NOT the same thing. Confirming which
one a requirement means is the first job of any work here:

- The **registry name** — `name` / `nameSource` in `~/.claude/sessions/<pid>.json`,
  set by `--name`. This is the field a peer reads. Measured 2026-09-12 on this
  machine, the live record for session `b8fc48ad` still reads
  `"name":"ptah-extension-1c","nameSource":"derived"`, which is the exact defect
  Requirement 2 named.
- The **session title** — `Options.title`, persisted in the JSONL and surfaced as
  `SDKSessionInfo.customTitle`. Retitled by the SDK's exported
  `renameSession(sessionId, title, options?)`, or by the `rename_session` control
  request.

Acceptance criteria:

1. When a session starts with a user-chosen name, that name reaches the registry
   name, slugified, and the uniqueness suffix is still the last part.
2. When a session starts with no user-chosen name — the normal case for a new
   tab, which is auto-titled later — the registry name falls back to today's
   `chat` role and the session starts normally.
3. When a session starts with a user-chosen name, `Options.title` carries it in
   raw form, so the title a peer reads is not a slug.
4. When the user renames a session in the UI, `renameSession()` is called and the
   session title follows the rename.
5. The registry name is fixed when the process spawns and no documented API
   changes it. This limit is written down where a reader will meet it, not
   discovered later. A rename updates the title only.
6. A naming failure never costs a session. This extends Requirement 2's criterion
   3 to every new path here.

### 10. A user can address another session by name

Added 2026-09-12.

Requirement: a user in one session can pick another live session by a name they
recognise and send it a message, without knowing a session UUID.

This requirement has an unresolved mechanism and must not be designed from
assumption. The SDK exports `listSessions()` and `renameSession()`, but **no
programmatic peer-send function**; the peer channel is reached through the CLI's
own tools, which a model calls. The registry files carry a
`messagingSocketPath`, whose protocol is not part of the SDK's public surface.

Acceptance criteria:

1. Before any code is written, the delivery mechanism is established by
   measurement and recorded: which of the peer socket, the CLI tool path, or a
   third route actually delivers a turn from Ptah's own process.
2. When a user asks to see the sessions they can reach, the list shows the
   human-readable name, the workspace and whether the session is live, and it is
   built from the session registry rather than a Ptah-side guess.
3. When a session is listed but cannot be reached, the row says so. A session
   that cannot receive a message is never offered as if it can.
4. When a user sends a message to a chosen session, the delivery outcome is
   reported honestly. A send that was accepted by the transport but never
   delivered is the exact defect this task exists to fix (Appendix A5, A6) and
   must not be reported as success.
5. Sessions outside the current workspace are handled by an explicit, documented
   decision — included or excluded — not by accident.

### 11. The addressing surface is reachable by a person

Added 2026-09-12. **This is a correction, and the omission was in Requirement 10
itself, not in the work that implemented it.**

The record, so the next reader does not go looking for a culprit: the ORIGINAL
task scoped its UI and delivered it. Track A required inbound peer turns
"rendered in chat as inbound peer messages" — that is Batch 6, done. Track C
required a child's report "shown in that agent's tile and in chat" — the tile
note is in `AgentReportRouter`, done. Nothing was dropped.

Requirement 10 was added later, on 2026-09-12, and is the one that says a user
"can pick another live session by a name they recognise and send it a message".
It then named no UI surface, and Batch 10's file list is backend-only. So
`peerSession:list` and `peerSession:send` exist, are registered on all three
required surfaces, and are tested — and no human being can reach either of them.
That is a requirement written badly, not a batch executed badly.

Requirement: a user can see the sessions they can reach and send one a message,
without calling an RPC method by hand.

Acceptance criteria:

1. When a user opens the picker, it lists the reachable sessions by the name a
   human recognises, with the workspace beside each.
2. When a session is not reachable, the row says so and cannot be chosen. It is
   never hidden, because a hidden row reads as "no such session" (criterion 3 of
   Requirement 10, which this surface must not undo).
3. When a row is from another workspace, that is visible. `peerSession:list`
   already returns `inCurrentWorkspace` per row and `crossWorkspacePolicy` on the
   response — the UI shows what the backend already decided, and does not invent
   a second policy.
4. When a message is sent, the result is reported as **accepted, not delivered**,
   and the caveat is shown to the user, not logged. `acceptanceCaveat` is a
   required field on every response including refusals precisely so this is not
   optional. A UI that renders a checkmark and the word "sent" rebuilds the
   defect this whole task exists to fix.
5. When the send costs a turn and may be declined by the model, the user is told
   BEFORE sending, not after. `costsATurn` and `modelMayDecline` are on the
   response for this.
6. The list is refreshed when it is opened, not cached across openings. A session
   list is a liveness claim with a short shelf life.

## Non-functional requirements

- Security: `crossSessionInbound: accept` means any same-user process reaching
  the socket can inject a user turn into a session running with permission checks
  off. It is set per session, never in `~/.claude/settings.json`, which would
  apply it to every Claude session the user runs, Ptah's or not.
- Security: no new HTML sanitizer. All AI-authored markdown, peer messages and
  agent reports included, renders through `libs/frontend/markdown`.
- Security: Zod validation at the MCP tool boundary for both new tools, matching
  the `WebSearchArgsSchema` precedent — strict, so a misspelled field is reported
  rather than dropped.
- Compatibility: the peer channel requires CLI 2.1.234 or later on native
  Windows. Behaviour on an older CLI is degraded-and-explained, never a silent
  no-op.
- Compatibility: no change to `@anthropic-ai/claude-agent-sdk` 0.3.150 unless a
  requirement above proves unreachable without it.
- Maintainability: any file this work pushes past the 700-line soft ceiling is
  split by the facade rule — public class keeps its name, DI token and
  signatures; the extracted concern becomes an injected collaborator with a real
  name.
- Maintainability: if any new RPC namespace is introduced, it is registered in
  BOTH `libs/shared/.../rpc.types.ts` and `ALLOWED_METHOD_PREFIXES` at
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. Registering one
  side produces a runtime-blocked method that compiles.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| An orchestrating agent | To redirect a child that is going the wrong way, and to hear from it before it finishes | One call reaches any vendor and says which mechanism fired |
| A spawned CLI agent | A way to raise a blocker instead of guessing or failing quietly | `ptah_agent_report` lands in the parent chat |
| A user watching a chat tile | To understand why the agent changed direction mid-run | Peer messages and agent reports appear labelled, not as their own prompts |
| A workflow / skill author | To rely on peer messaging without re-deriving what each vendor supports | Guidance names `ptah_agent_list` as the source of capability |
| Whoever maintains the adapters next | To add a seventh CLI without touching the router | New adapter declares capabilities; every mode works |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Held-message silent loss persists for peers outside Ptah — a developer's own terminal in the other class messaging a Ptah session Ptah did not configure | MEDIUM | MEDIUM | Track A covers every session Ptah starts; the architect states in the design which sessions are covered and what a user must do for the rest. The failure is silent by construction, so it must be documented rather than assumed away |
| The SDK `Settings` type has no `crossSessionInbound` key, so the natural object-literal form is a compile error | HIGH | LOW | Verified escape routes exist: the string form of `Options.settings` was measured accepted (Appendix A8/resolved Q5), or a cast carrying a written reason. Architect picks one; no `@ts-ignore` either way |
| `sdk-query-options-builder.output-style.spec.ts:155-159` asserts the literal source text `settings: buildFlagSettings(sessionConfig)`, so changing the call shape breaks a passing spec in a way that reads as unrelated | HIGH | LOW | Executor updates that spec deliberately and preserves what it protects (one builder, key-absent rule), rather than deleting the assertion |
| Processes of completed Ptah CLI agents stay alive by design — the prompt mailbox stays open for `continue()` — so they remain listed in `ListAgents` and messageable after they look finished | HIGH | LOW | Documented as intended behaviour, not a leak. `ptah_agent_list` / status output must not present a completed agent as a live conversation partner without saying so |
| `interrupt-resume` silently discards the partial work of the turn it aborts | MEDIUM | MEDIUM | The mode is always reported back (Req 4.1) so the caller and the UI can say "interrupted and restarted" rather than presenting all three mechanisms as one silent success |
| A report loop between a parent and a child floods the parent | LOW | MEDIUM | Bounded queue, per-sender rate limit and identical-repeat suppression copied from the Claude channel (Req 6.5) |

## Open questions

- Should `ptah_agent_steer` be kept as a thin alias or removed outright? Removal
  is cleaner and matches the replace-don't-accumulate rule; an alias protects any
  harness text already telling agents to call it. The architect decides, and
  whichever is chosen, only one implementation ships. Answerable by grepping the
  harness and skill text for `ptah_agent_steer`.
- Does a Ptah SDK host observe hold / refuse / expiry notices for messages *it*
  sent? Documented only for an interactive same-machine sender
  (research-report.md §2.9, open question 6). If it does, the sender's tile can
  show a failed delivery instead of a bare success. Answerable by a one-session
  probe; it does not block Track A.

## Handoff

- Next specialist: software-architect.
- Why: the unknowns are settled — both research documents are verified against
  this machine — but the shape is not: where the settings value is threaded so
  one builder still owns it, what the capability contract on `CliAdapter` /
  `SdkHandle` looks like so the router never names a vendor, and how a child's
  report reaches the parent session's mailbox and the chat surface without
  inventing a second delivery mechanism.
