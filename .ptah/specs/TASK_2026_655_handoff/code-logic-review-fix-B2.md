# Code logic review — TASK_2026_655 handoff fix and B2

## Summary

| Metric | Result |
| --- | --- |
| Score | 5/10 |
| Verdict | NEEDS_REVISION |
| Blocking / Serious / Moderate / Minor | 1 / 1 / 0 / 0 |
| Failure modes | 2 |

The normal B2 path has the intended identity: the runtime uses the caller record's tab id for its guard and passes its live permission level (`libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:163-179,232-240`); the host passes that level to the SDK with the caller's root and cwd, without a parent/worktree option (`libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:126-140`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:705-742,845-879`). This supports a fresh top-level session and full-autopilot inheritance on the ordinary path. The score is below the 7–8 band because a prompt-bearing failure can escape into logs/Sentry and the user can be told a nonexistent tab opened. It is above 3–4 because the ordinary launch, path authorization, and permission propagation are implemented and covered by the changed specs (`chat-session-agent-child.spec.ts:454-497`; `child-chat-session-host.adapter.spec.ts:298-395`).

## Part A — cd4abbdc2, six prior findings

| Prior finding | Status | Evidence and limit |
| --- | --- | --- |
| Mixed tab-id / SDK-id concurrent starts | FIXED | All duplicate checks and the reservation use `record.tabId` after the lifecycle lookup (`session-handoff.service.ts:133-135,163-179`); the mixed-ID test holds the first host call pending (`session-handoff.service.spec.ts:458-499`). |
| Host start never settles | FIXED | The caller gets a 30 s bounded refusal; the attempt retains the reservation until a late settlement, records late success, and clears its timer (`session-handoff.service.ts:180-203,260-263,400-413`). A permanently hung host still holds the reservation, deliberately preventing a duplicate; this is an availability limit, not an unbounded tool wait. |
| Host error text can expose prompt | PARTIAL | Host `error.message` and `outcome.error` are no longer passed to the result/log (`session-handoff.service.ts:242-258`). But `errorKind` copies arbitrary `Error.name` and string `error.code` into a log (`session-handoff.service.ts:246,425-430`). A dependency error with prompt text in either field still breaches the absolute no-prompt-in-logs rule. Use a fixed allowlisted category/code. |
| Throwing output channel breaks never-throw | FIXED | Every output write goes through a catching `log` (`session-handoff.service.ts:380-397`); success and refusal tests cover throwing output (`session-handoff.service.spec.ts:585-615`). |
| Skill ignores `tabOpened: false` | FIXED in the skill | The skill now branches on `tabOpened` and tells the user to locate a session before closing the caller (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:51-56`). B2's host can report a false positive; see finding 2. |
| Skill waits forever on a blocked child/lane | FIXED | It caps total waiting at five minutes, records waiting work, and continues (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:15-23`). |

## Part B — cb01a5f16 findings

### 1. Blocking — continuation prompt can enter logs, Sentry, and error text

**Trigger.** The handoff descriptor includes the continuation prompt as `displayPrompt` and is broadcast before launch (`session-handoff.service.ts:218-240`; `child-chat-session-host.adapter.ts:118-120,171-184`). If broadcasting throws an error that quotes its payload, `announce` logs the raw error message at `child-chat-session-host.adapter.ts:180-185`. The concrete VS Code broadcaster also logs raw `postMessage` errors, including from the prompt-bearing descriptor, at `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:211-225,298-314`. After launch, a stream error containing the initial prompt is logged and sent to Sentry, and can be put into `chat:error` (`chat-session.service.ts:845-879`; `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:314-335,347-369`). B2's own `errorKind` also copies untrusted `Error.name` and `error.code` into its log, Sentry error, and adapter error text (`chat-session.service.ts:743-753,1666-1673`; `child-chat-session-host.adapter.ts:151-162`).

**Impact.** A dependency failure that quotes the request can reveal the continuation prompt in output logs, telemetry, or an error message, violating the explicit privacy requirement. The happy-path and thrown-`message` specs do not exercise these boundaries (`child-chat-session-host.adapter.spec.ts:427-450,482-489`; `chat-session-agent-child.spec.ts:454-485`).

**Fix.** Sanitize at every handoff-specific error boundary before logging, capture, or `chat:error`: use fixed text or allowlisted error categories, including for name/code. Prevent the shared broadcast and stream paths from recording prompt-bearing raw errors for this session. Exercise a broadcaster and stream failure whose error text/name/code contain the prompt.

### 2. Serious — `tabOpened: true` does not mean a tab received the announcement

**Trigger.** With no registered VS Code webview, `broadcastMessage` loops over zero recipients and resolves; when `sendMessage` fails, it returns `false` and the broadcaster still resolves after `Promise.allSettled` (`libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:191-226,294-315`). The adapter equates any resolution with `uiAnnounced: true` (`child-chat-session-host.adapter.ts:165-175`), then returns it on success (`child-chat-session-host.adapter.ts:141-143`). The runtime exposes that value as `tabOpened` (`session-handoff.service.ts:268-275`).

**Impact.** Closing the webview or a failed `postMessage` makes the tool report `tabOpened: true` even though no tab was adopted. The skill consequently tells the user the tab is open and asks them to close the old session (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md:51-56`). The changed test models absence as a rejected broadcast (`child-chat-session-host.adapter.spec.ts:390-397`), unlike the concrete manager's resolved empty broadcast.

**Fix.** Return an acknowledged recipient/delivery result from the broadcaster, or explicitly check for an active eligible webview and successful delivery before setting `uiAnnounced`. Test the concrete zero-recipient and failed-send behavior.

## Five logic questions

1. **Silent failure:** A zero-recipient or swallowed-send broadcast looks successful and becomes `tabOpened: true` (`webview-manager.ts:294-315`; `child-chat-session-host.adapter.ts:171-175`).
2. **Unexpected user action:** Closing the webview during handoff leads the skill to say a tab opened and invite closing the caller (`webview-manager.ts:298-315`; bundled `SKILL.md:51-56`).
3. **Wrong answer from input data:** An error with the prompt embedded in `name` or `code` is treated as safe metadata and copied into a result/log (`chat-session.service.ts:743-753,1666-1673`).
4. **Dependency failure/timeout:** B1 bounds the host wait and retains its reservation for a late start (`session-handoff.service.ts:180-203`), but broadcast/stream failures can disclose the prompt (`child-chat-session-host.adapter.ts:180-185`; `chat-stream-broadcaster.service.ts:314-369`).
5. **Missing requirement detail:** `uiAnnounced` has no concrete delivery acknowledgement; the port's boolean is currently defined by Promise resolution, which the real broadcaster does not equate with delivery (`child-chat-session-host.adapter.ts:165-175`; `webview-manager.ts:294-315`).

## Scope and evidence

Reviewed the two commit file lists, the prior review and fix report, B2 report, Component 3 and team-leader plan, root `CLAUDE.md`, runtime guard and skill, B2 adapter and launch path, changed test assertions, lifecycle permission source, and the concrete VS Code broadcaster. No `context.md`, `task-description.md`, or `code-style-review.md` exists in the discovered task folder. The B2 report records 2 changed suites / 48 tests, project typecheck and 150 suites / 4368 passing tests; those checks verify the mocked paths, not the two failure modes above. I ran no test/build/Nx command as instructed. Scoped `ptah_get_diagnostics` returned unavailable after its 45 s TypeScript check window, so it supplies no additional evidence. The known child-session permission drop at `chat-session.service.ts:639-673` predates B2 and is not counted: B2's handoff path passes the live level through.
