# Code-logic review Round 8q

Verdict: REVISE
Score: 6/10
Review family: grok (implementers: codex, grok)

Reviewed `8ea186c34..dd9b76e00` (8q-1 through 8q-3c) on the production diffs and the 8q-3c specs. Security reviews 8q-1, 8q-3a, 8q-3a-fix, 8q-3b, and review-8q-2b were read and are not repeated. No tests or builds were run.

The main user turn is consistent: `start()` captures the level and its policy together, then sends both. Grammar, the names-only sink log, and the saved-level helper match 8q-D1..D3. The score is not 7 because the idle `turn/started` snapshot added in this round can auto-accept under a level the process has not been told yet. It is not 5 because that hole is the notification path, not `turn/start`.

## Requirements

| Decision | Status | Evidence |
| --- | --- | --- |
| 8q-D1 Bounded PowerShell read grammar | MET | Unknown parameters, including `-Force`, return undefined at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-read-only-command.ts:146`. `*` and `?` are rejected for every path; `[` and `]` are rejected except on `-LiteralPath` (`codex-read-only-command.ts:97-98`, `:129-132`). Ints are `^\d{1,6}$` (`:135`). Get-ChildItem may have zero paths (`:149`). |
| 8q-D2 Names-only reason log | MET | Every `presentRequest` fall-through logs a closed reason and three booleans, with no command, path, or cwd (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:118`, `:148`, `:151-167`). |
| 8q-D3 One saved-level helper | MET | `resolveSavedCodexPermissionLevel` (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-saved-permission-level.ts:8-23`) is the only copy. The settings record calls it (`codex-session-settings-record.ts:103-105`). The profile uses `config.permissionLevel` when set, otherwise the helper (`codex-chat-host-ports.ts:395`). Electron binds that helper over `readForPath(name, workspacePath, true)` (`apps/ptah-electron/src/di/codex-runtime-composition.ts:494-498`). |
| 8q-D4 Live level from the next turn | PARTIAL | A user `turn/start` sends the stored policy and snapshots that level before the RPC (`libs/backend/codex-runtime/src/lib/codex-context.ts:504-524`). The bridge reads `turnPermissionLevel` (`codex-context.ts:273`). The sink reads the same getter (`codex-chat-adapter.ts:474`). A failed persist does not assign settings (`codex-context.ts:813-828`). Save failure applies the previous level again (`native-session-controls.ts:188-204`). The idle notification path does not (finding 1). |

No frontend Codex branch and no MCP edit are in this range. Claude call sites are untouched.

## Five logic questions

### 1. How does this fail silently?

An idle `turn/started` after a committed level change snapshots the new level while the app server keeps the previous approval and sandbox override. A read that plan would decline can come back `accept` with no card (finding 1).

### 2. What user action produces unexpected behaviour?

Change the chip, then compact (or any other server turn that starts while the context is idle) before the next user message. The chip and the bridge show the new level. The process is still on the last `turn/start` or `thread/start` policy.

### 3. What input data produces a wrong answer?

A command approval whose lexical form is an allowed read (`Get-Content` inside the thread cwd), on a turn whose last wire policy is `plan` and whose snapshot is already `ask`. The classifier returns a command and the sink accepts it (`codex-chat-approval-sink.ts:127-146`).

### 4. What happens when a dependency fails?

A failed identity persist rejects and leaves `settings` and `levelPolicy` unchanged (`codex-context.ts:813-828`). A failed autopilot save restores the previous keys (`native-session-controls.ts:110-126`) and applies the previous level (`:191-197`). A process exit between a successful persist and that save does not roll back (finding 2).

### 5. What is missing that the requirements never mentioned?

Nothing beyond finding 2. The crash sits between the two writes D4 orders (persist inside `updateNextTurn`, chip save after it returns) and has no recovery other than the resume refusal.

## Findings

1. **serious** — `libs/backend/codex-runtime/src/lib/codex-context.ts:401-405` against `:506-522` and `:229-234`. After `updateNextTurn` commits a new level, an idle `turn/started` stores `settings.permissionLevel` and marks the context `running`. Nothing in that path sends `approvalPolicy` or `sandboxPolicy`. Those overrides are sent only from `start()`, and `thread/start` / `thread/resume` still send the open-time profile. The pinned protocol describes both as applying to this turn and subsequent turns (`libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:26359`, `:26456`). `compact()` is idle-only and sends `thread/compact/start` with a thread id and no policy (`codex-context.ts:888-900`), and the notification handler already treats `turn/` frames during compaction as that work (`:362-370`). Failure: open on `plan` (read-only, `on-request`), switch to `ask`, then compact before the next user message. The snapshot is `ask`. The server is still on the plan override. A `Get-Content` approval is auto-accepted by the sink (`codex-chat-approval-sink.ts:123-146`). The same gap in the other direction leaves a `yolo` workspace-write sandbox in force after the chip shows `plan`, for any in-sandbox write that never raises an approval. A later user message does call `start()` and sends the new policy; this finding is the turn that begins without that call.

2. **moderate** — `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts:188-190` and `libs/backend/codex-runtime/src/lib/codex-context.ts:813-828`. `setPermission` applies the level first. `updateNextTurn` persists the new fingerprint and only then returns. The autopilot chip is written after that return. Failure: the process exits after persist resolves and before `writeGlobal` of `autopilot.enabled` / `autopilot.permissionLevel`. The stored fingerprint is the new level. The chip is still the old level. The next open rebuilds the profile from the chip and refuses the thread (`libs/backend/codex-runtime/src/lib/codex-runtime.ts:51-52`). In-process save failure still rolls back. This exit does not.

## Decisions

- Idle `turn/started` must use the policy already on the wire, not the level stored for the next `turn/start`. Options were: treat only `start()` as a turn (the notification snapshot would keep following settings), or bind the bridge to the last sent policy until `start()` overrides it. Evidence: D4's own rule that a turn must not auto-accept under a level its wire policy does not have, plus the schema lines above. Reversible: yes, the snapshot source can change without a new RPC.

## Not repeated

Security minors already recorded: unbounded `-Raw`, `cwd-uri-invalid` used before the level check, quoted dash tokens, `not-command` log volume, stale open-time `profileFingerprint` on approval requests, session rules not scoped by level, `markInactive` failure leaving the new row `active`, and the post-close getter. 8q-2b's redundant resume spec was removed before this review.

## Residual uncertainty

8q-3c's contract fixture writes `turnPermissionLevel` inside the fake `updateNextTurn` (`codex-chat-native-contract.spec.ts:254-272`) and asserts `plan` immediately (`:1324`). It does not model a running turn. The runtime spec is what locks the in-turn hold. Server behaviour for an in-sandbox write that never asks for approval was taken from the `on-request` plus `workspace-write` mapping (`codex-execution-profile.ts:143-163`, `:176-186`), not from a live Codex process.
