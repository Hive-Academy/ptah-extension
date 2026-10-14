# Code Logic Review — `TASK_2026_655_handoff`, B1 and B5

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 2 |
| Moderate issues | 3 |
| Failure modes found | 6 |

The intended path is present: the service validates a live caller, refuses recorded children, checks the workspace and handoff file, and asks the host to start a plain chat session with the caller's cwd, model and permission level (`libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:105-140,169-222`). The new wire type and skill are bundled (`libs/shared/src/lib/types/messages/session-handoff.ts:11-27`; `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:1-52`). The score is below the sound 7–8 band because the one-session guarantee can fail and two failure boundaries violate the stated contracts; it is above 3–4 because the normal flow and ordinary refusal codes are implemented and covered by focused tests (`session-handoff.service.spec.ts:156-192,235-361`).

## Five logic questions

### 1. How does this fail silently?

Two concurrent calls attributed to the same lifecycle record through its tab ID and SDK ID can each pass the in-flight guard and each receive a success result, leaving two continuation sessions when the skill promised one (`session-handoff.service.ts:112-113,142-159,189-222`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`, `find` accepts both indexes).

### 2. What user action produces unexpected behaviour?

A user or transport retry that reaches handoff once with a tab ID and once with the real SDK ID while the host start is pending can open two tabs. The existing concurrency test calls the same ID twice, so it does not cover this route (`session-handoff.service.spec.ts:394-416`). When the host reports `uiAnnounced: false`, the skill still tells the user the new session is open and asks them to close this one, even though no tab appeared (`session-handoff.service.ts:215-222`; `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:44-46`).

### 3. What input data produces a wrong answer?

A host failure string containing the continuation prompt is copied into the refusal detail and the output log, despite the explicit no-prompt-in-logs requirement (`session-handoff.service.ts:199-205,327-337`; `implementation-plan.md:160-171`). This can happen if a downstream error quotes its input; the service passes the prompt to that downstream host at line 193.

### 4. What happens when a dependency fails?

A rejected host promise maps to `session-start-failed`, but a host promise that never settles leaves `handoff()` pending and the caller key in `inFlight` indefinitely (`session-handoff.service.ts:155-160,189-203`). If `IOutputChannel.appendLine` throws while reporting a refusal, the outer catch calls the same failing logger again, so `handoff()` rejects despite its never-throw port contract (`session-handoff.service.ts:91-99,327-338`; `session-handoff.port.ts:64-66`).

### 5. What is missing that the requirements never mentioned?

The skill has no bounded way to hand off when a child session or lane waits on external input or never settles. It says to wait for everything and to stop only if it cannot finish, without a time or state rule for making that decision (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:13-17`). The handoff service likewise has no start deadline or cancellation boundary (`session-handoff.service.ts:155-160,189-203`).

## Failure modes

### Duplicate starts through caller aliases

- Trigger: one call uses the tab ID and another the SDK ID for the same lifecycle record before either host start settles.
- Symptom: two successful handoffs and two new sessions from one caller.
- Evidence: `session-handoff.service.ts:112-113,142-159,189-222`; `session-handoff.service.spec.ts:394-416` tests only one ID.
- Current handling: `handedOff` checks both IDs after success, while `inFlight` checks only the raw `caller` string.
- Recommendation: canonicalize to `record.tabId` before all duplicate checks and reservations; test mixed IDs with a deferred host promise.

### Host start never settles

- Trigger: the host start dependency hangs during broadcast or session launch.
- Symptom: the tool call never returns, the skill cannot execute its fallback, and the in-flight entry remains until process exit.
- Evidence: `session-handoff.service.ts:155-160,189-203`; the port has no deadline (`child-chat-session-host.port.ts:68-72`).
- Current handling: `finally` clears the entry only after the awaited promise settles.
- Recommendation: specify a bounded host start contract and cancellation or timeout semantics that distinguish an unstarted session from a session that may have started late; avoid returning a definitive failure if the host can still create a tab.

### Prompt leaked through dependency errors

- Trigger: the host throws or returns an error message that embeds the prompt it received.
- Symptom: sensitive continuation text appears in the output channel and refusal detail.
- Evidence: `session-handoff.service.ts:193,199-205,327-337`; the prompt log test exercises only the success and duplicate paths (`session-handoff.service.spec.ts:221-232`).
- Current handling: arbitrary downstream error text is interpolated into `refuse`, which logs it.
- Recommendation: return a fixed, prompt-free detail for host failure; log only a sanitized error code or safe metadata. Test a host error containing the prompt.

### Logger failure breaks never-throw contract

- Trigger: `output.appendLine` throws during any refusal or after a successful host start.
- Symptom: `handoff()` rejects. After a successful start, the new session exists but the caller sees a failed tool call.
- Evidence: `session-handoff.service.ts:91-99,207-222,327-338`; `session-handoff.port.ts:64-66` promises never to throw.
- Current handling: the catch tries to call `refuse`, which invokes the same logger again.
- Recommendation: isolate output-channel failures in a non-throwing log helper; preserve the already determined result.

### Skill can misstate an unannounced tab

- Trigger: host starts a session without an active webview, returning `uiAnnounced: false`.
- Symptom: the skill directs the user to close the old session while no new tab is visible.
- Evidence: `session-handoff.service.ts:211-222`; `session-handoff.service.spec.ts:204-215`; `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:44-46`.
- Current handling: `tabOpened` is returned, but the skill ignores it.
- Recommendation: distinguish `tabOpened: false` in the success instructions and tell the user how to find or restore the new session before closing the old one.

### Skill waits on a child that needs external input

- Trigger: a child session is in `awaiting-permission` or another nonterminal waiting state when `/session-handoff` runs.
- Symptom: the parent waits for completion and never writes HANDOFF.md or invokes the handoff tool while the child cannot progress on its own.
- Evidence: bundled `SKILL.md:13-17` requires waiting for every child without a deadline or state rule; `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1161` exposes `awaiting-permission` as a child state.
- Current handling: the skill says to stop a child only if it cannot finish, but gives no criterion or action for one awaiting outside input.
- Recommendation: give a bounded wait and explicit handling for waiting or permission states; record unfinished work in HANDOFF.md and proceed when waiting cannot resolve in this session.

## Blocking issues

### The in-flight guard does not enforce one handoff per lifecycle caller

- File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:149-159`.
- Scenario: tab and SDK IDs both resolve to the same record (`session-lifecycle/session-registry.service.ts`, `find`), but each is a different key in `inFlight`.
- Impact: two sessions can start with the same handoff prompt; the user may edit both divergent continuations. The 64-entry success history cannot prevent starts that overlap before either entry is recorded at line 207.
- Fix: use the stable record tab ID for the in-flight key; add a mixed-identifier race test.

## Serious issues

### An unsettled host operation strands the caller

- File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:189-203`.
- Scenario: `startHandoffSession` never resolves or rejects.
- Impact: no refusal reaches the skill, so it cannot show its fallback prompt; the caller's guard entry remains retained at lines 155-160.
- Fix: define and enforce a bounded start protocol with cancellation or late-completion reconciliation.

### Host error text can log the prompt

- File: `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:199-205,327-337`.
- Scenario: downstream failure text includes the submitted prompt.
- Impact: the prompt is written to the output channel, contrary to the documented privacy rule (`implementation-plan.md:160-171`).
- Fix: use a fixed prompt-free error detail at this boundary and log only safe metadata.

## Moderate and minor issues

- Logger failure violates `ISessionHandoff`'s never-throw contract and can turn a successful start into a rejected tool call (`session-handoff.service.ts:91-99,207-222,327-338`).
- The skill ignores `tabOpened: false` when telling the user to close the old session (`session-handoff.service.ts:215-222`; bundled `SKILL.md:44-46`).
- The skill can wait indefinitely for a child in `awaiting-permission`, preventing HANDOFF.md and the fallback prompt (`SKILL.md:13-17`; `session-spawner.service.ts:1161`).

## Data flow

1. MCP transport supplies a caller ID; `SessionId.safeParse` and lifecycle lookup validate attribution. OK for absent or unknown callers (`session-handoff.service.ts:112-120`).
2. Child registry rejects tab or SDK IDs. OK while the registry retains the child (`session-handoff.service.ts:121-129`; `session-child.registry.ts:182-190`).
3. MCP port, workspace paths and handoff file are checked. Ordinary absence produces a closed refusal (`session-handoff.service.ts:130-140,225-283`).
4. Successful history detects tab or SDK ID, but in-flight state uses the raw supplied ID. Duplicate-start gap (`session-handoff.service.ts:142-160,285-305`).
5. A descriptor and host input carry the prompt to the host without adding a parent relation. The port is awaited without a bound (`session-handoff.service.ts:169-203`; `child-chat-session-host.port.ts:46-72`).
6. On success, history is stored and the result reports `tabOpened`; on failure, arbitrary host error text is logged. Prompt leakage and logger-failure gaps (`session-handoff.service.ts:199-222,327-338`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Closed refusal codes | PARTIAL | Ordinary paths use the planned codes; logger failure can reject (`session-handoff.service.ts:91-99,327-338`). |
| One handoff per caller | PARTIAL | Mixed tab and SDK IDs bypass the in-flight guard (`session-handoff.service.ts:149-159`). |
| Bounded caller history | COMPLETE | Oldest entries are evicted at 64, as specified (`session-handoff.service.ts:298-305`). |
| Never throw | PARTIAL | Output-channel exception escapes the error handler (`session-handoff.service.ts:91-99,327-338`). |
| Top-level successor that can hand off | COMPLETE within B1 | Service uses `startHandoffSession` and does not register a child; the unit test exercises a second handoff (`session-handoff.service.ts:189-198`; `session-handoff.service.spec.ts:433-447`). Host implementation belongs to B2. |
| Child refusal | COMPLETE while child is recorded | Checks both identities (`session-handoff.service.ts:121-129`). |
| Prompt absent from logs | PARTIAL | Host error detail is logged verbatim (`session-handoff.service.ts:199-205,327-337`). |
| Skill fallback | PARTIAL | Handles a returned refusal, but cannot proceed if the tool hangs (`SKILL.md:48-52`; `session-handoff.service.ts:189-203`). |

Implicit requirements not addressed: bounded waiting and a clear user instruction for a started session whose tab was not announced (`SKILL.md:13-17,44-46`).

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Missing caller, child, MCP port, workspace or file | YES | Closed refusals in `session-handoff.service.ts:105-140,255-283`. |
| Repeated call after a successful start | YES | 64-entry history catches it until eviction (`session-handoff.service.ts:142-148,298-305`). |
| Concurrent call with the same caller ID | YES | Guard tested at `session-handoff.service.spec.ts:394-416`. |
| Concurrent call with tab and SDK aliases | NO | Guard keys the unnormalized input (`session-handoff.service.ts:149-159`). |
| Host rejection or `started: false` | YES | Closed `session-start-failed`, subject to prompt leakage (`session-handoff.service.ts:199-205`). |
| Host never settles | NO | Await remains pending (`session-handoff.service.ts:189-203`). |
| Output channel throws | NO | Error handler can throw again (`session-handoff.service.ts:91-99,336-338`). |
| Child awaiting permission | NO | Skill supplies no bounded exit (`SKILL.md:13-17`; `session-spawner.service.ts:1161`). |

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH on the alias race and exception paths; MEDIUM on host error contents and a non-settling host, which depend on collaborator behaviour.
- Top risk: two simultaneous calls for one lifecycle session can create two continuation sessions (`session-handoff.service.ts:112-113,149-159`).
- What a robust implementation would add: canonical caller keying, a bounded host-start protocol, safe error reporting, non-throwing logging, and a `tabOpened: false` branch in the skill.

Review scope: commits `bd4f6257f` and `0a073d9e1`, their changed files, the B1/B5 reports and requested plan sections, lifecycle and child registries, and the adjacent host adapter. Existing B1/B5 reports record focused passing tests; scoped `ptah_get_diagnostics` reported zero errors for the changed TypeScript paths. No test was run during this read-only review. The known B2 adapter typecheck gap was excluded as instructed.
