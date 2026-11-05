# Code Logic Review — `TASK_2026_885_codex_sandbox`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | REVISE |
| Blocking issues | 1 |
| Serious issues | 3 |
| Moderate issues | 0 |
| Failure modes found | 4 |

The policy mapping and most host wiring are present, but one malformed saved value can resolve to full access, the UI can display an obsolete policy after an acknowledged write, and queued messages can remain pending forever. A 4 is warranted because these affect the safety setting and delivery contract; the working policy mapping keeps this above a foundational 1–2, while the silent safety and delivery failures keep it below a 5–6.

## Five logic questions

### 1. How does this fail silently?

A persisted `null` becomes the full-access default in `getAgentCfg` before validation (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1966-1973,1997-2001`). A successful save followed by a failed read leaves the old selection displayed (`libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:418-424`). A changed lane session can strand later queue entries in `pending` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:319-326`).

### 2. What user action produces unexpected behaviour?

Selecting full access, receiving an acknowledged `agent:setConfig`, and losing the read-back causes the radio and “In effect” label to continue showing the previous restrictive mode (`codex-sandbox-setting.component.ts:395-409,418-424`). Choosing “Workspace write, no network” on Windows shows an unconditional promise that network cannot be used, though the same component acknowledges incomplete Windows network blocking (`codex-sandbox-setting.component.ts:55-58,76-79`).

### 3. What input data produces a wrong answer?

An explicit persisted JSON `null` for `agentOrchestration.codexSandboxMode` is treated as absent by `?? defaultValue`, so `getConfig` returns `danger-full-access` instead of reporting invalid configuration (`agent-rpc.handlers.ts:1966-1973,1997-2001`).

### 4. What happens when a dependency fails?

If `agent:getConfig` times out after `agent:setConfig` succeeds, `readEffective` returns `null`, `write` leaves `saved` unchanged, and `save` clears the pending selection (`codex-sandbox-setting.component.ts:395-409,418-424,459-477`). The true effective policy is then unknown while the UI still labels the old one “In effect.” Diagnostics were requested through `ptah_get_diagnostics`; it reported a TypeScript check still running, so no diagnostic result was available. No tests or builds were run, per task instruction.

### 5. What is missing that the requirements never mentioned?

The UI needs an explicit “effective policy unknown” state after an acknowledged or indeterminate write whose read-back fails, especially for full access (`codex-sandbox-setting.component.ts:418-424`). The queue also needs terminal handling for every entry when the session identity changes (`agent-message-router.service.ts:319-326`).

## Failure modes

### Invalid null grants the default policy

- Trigger: A settings file contains `"agentOrchestration.codexSandboxMode": null`.
- Symptom: `agent:getConfig` reports full access for malformed saved data; direct profile consumers parse the setting separately and may instead reject it, so the displayed effective policy disagrees with execution.
- Evidence: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1966-1973,1997-2001`; `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:195-203`.
- Current handling: The generic getter converts `null` to the default before the sandbox schema sees it.
- Recommendation: Read this key as `unknown` without null coalescing; default only when the key is genuinely absent, and reject any present invalid value.

### UI claims an obsolete effective mode

- Trigger: The set RPC succeeds, then the get RPC fails or times out.
- Symptom: The UI retains its old saved mode and clears the pending one; a full-access change may be active while the page displays a stricter mode.
- Evidence: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:395-409,418-424,459-477`.
- Current handling: An unconfirmed read-back returns an error message but leaves the old value in the “In effect” state.
- Recommendation: Mark the effective mode unknown until a successful reload; do not label the old value as current.

### Session change strands queued messages

- Trigger: Two or more messages queue for session A; by flush time the tracked session ID is B.
- Symptom: The first message becomes `failed`, while later messages remain `pending` with no next settle to flush them.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:319-326`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` calls `flushPending` only from turn settlement.
- Current handling: The mismatch branch returns after failing only the shifted entry.
- Recommendation: Fail all remaining entries tied to the old session, or continue draining mismatches until a valid entry is reached.

### Windows network promise exceeds enforcement

- Trigger: A Windows user selects `workspace-write-no-network`.
- Symptom: The option says Codex cannot use the network, while the component's own Windows note says network blocking is incomplete.
- Evidence: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:55-58,76-79`; task `findings.md` documents a successful direct Node fetch with `networkAccess: false` on Windows.
- Current handling: The warning is separated from the option and does not qualify its categorical claim.
- Recommendation: Qualify the option text on Windows and state clearly that this mode does not enforce network isolation there.

## Blocking issues

### Present invalid value becomes full access

- File: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1966-1973,1997-2001`.
- Scenario: A saved `null` is passed through `getAgentCfg`.
- Impact: A malformed persisted setting silently reports the least restrictive policy as effective, masking the configuration error and potentially disagreeing with the policy used by direct consumers.
- Fix: Distinguish absent from present invalid values before applying `DEFAULT_CODEX_SANDBOX_MODE`.

## Serious issues

### Acknowledged write leaves obsolete “In effect” label

- File: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:395-409,418-424`.
- Scenario: The write succeeds and the read-back fails.
- Impact: Users can see a restrictive policy while full access is active.
- Fix: Replace the effective label with an unknown state and require reload to establish it again.

### Pending queue never reaches a terminal state after session change

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:319-326`.
- Scenario: Multiple pending entries belong to an old CLI session.
- Impact: Status queries for entries after the first report `pending` indefinitely.
- Fix: Set all stale entries to `failed` at session mismatch.

### No-network option promises more than Windows enforces

- File: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:55-58,76-79`.
- Scenario: User relies on the option's network isolation claim on Windows.
- Impact: Codex may still reach the network despite the restrictive choice.
- Fix: Put the Windows limitation in the choice text or gate that option when isolation is required.

## Moderate and minor issues

None separately identified.

## Data flow

1. `agent:setConfig` validates the enum and persists it (`agent-rpc.handlers.ts:986-988,1086-1088`) — OK for ordinary writes.
2. `agent:getConfig` calls a getter that coalesces `null` before schema validation (`agent-rpc.handlers.ts:1966-1973,1997-2001`) — blocking gap.
3. Electron, CLI, and chat call `codexSandboxModeSchema.parse` on their workspace reads (`apps/ptah-electron/src/di/codex-lane-composition.ts:140,177`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:151,188`; `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:470`) — present values are validated.
4. `resolveCodexLevelPolicy` maps the four modes and keeps lane approval `never` (`codex-execution-profile.ts:177-203`); the fingerprint includes the selected mode and resolved policy (`codex-execution-profile.ts:324-340`) — OK.
5. Lane queue captures message/session IDs, but flush mismatch stops after one entry (`agent-message-router.service.ts:253-260,319-326`) — serious gap.
6. MCP exposes message delivery/status in HTTP and stdio with Zod argument schemas (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:118,255,308,712,748-753`) — no gap found in this surface.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Setting, default, RPC validation/effective value | PARTIAL | A persisted `null` silently becomes full access. |
| Policy mapping, fingerprint, lane approval, WRITE_DAC scope | COMPLETE | No logic gap found in inspected paths. |
| Electron, CLI, chat, thread/turn consumers | COMPLETE | No missing consumer found in inspected paths. |
| Queue, steer, session check, bounded status | PARTIAL | Session mismatch can strand later messages. |
| MCP HTTP/stdio delivery and status | COMPLETE | Both routes and Zod schemas are present. |
| Settings UI warning and confirmation | PARTIAL | Failed read-back leaves an obsolete effective label; Windows no-network wording is misleading. |

Implicit requirements not addressed: an unknown effective-policy UI state after uncertain writes, and honest Windows network isolation wording.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Invalid string saved mode | YES | Schema rejects it. | `null` is coalesced earlier in RPC getter. |
| Multiple queued entries after session change | NO | Only first is failed. | Remaining statuses stay pending. |
| Steer after active turn changes | YES | Expected turn ID and receipt are checked (`codex-app-server-lane.adapter.ts:586-593`). | App-server acknowledgement cannot guarantee later execution if turn is interrupted. |
| Full access write with failed read-back | NO | Old `saved` value remains. | Effective label is stale. |
| Queue above eight entries | YES | Returns unsupported (`agent-message-router.service.ts:241-260`). | None identified. |

## Decisions

- Score 4/10 and REVISE: the persisted-null path is a security-sensitive silent default, and two delivery/UI failures are observable from source. Reversible by correcting the getter, queue terminal handling, and UI state.
- Treated `findings.md`'s Windows probe as task context, not a newly run test; the component itself states the same limitation. Reversible by adjusting wording.

## Review limits

Read the task's implementation plan, prior findings, repository instructions, changed policy, queue, adapter, RPC, MCP, and UI code; inspected the full diff and targeted full files for the main paths. `context.md`, `task-description.md`, `batches.md`, and `code-style-review.md` were absent from the discovered task folder. No skill catalogue or skill-loading tool was listed for this lane, so no skill was loaded. The Ptah AST tool rejected the first argument shape; targeted native reads were used after that error. Diagnostics remained unavailable because the TypeScript check was still running. No tests or builds were run.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the first three findings; MEDIUM for the Windows impact, based on the task probe and component wording.
- Top risk: An uncertain save can leave the interface reporting a stricter mode than Codex actually uses; malformed saved data can also make `getConfig` falsely report full access.
- A robust implementation would distinguish absent from invalid settings, show unknown effective state after uncertain writes, settle every stale queue entry, and qualify Windows network claims.
