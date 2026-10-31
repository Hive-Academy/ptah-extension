# Native Codex lane parity proof — TASK_2026_714_c8a2 / 10d.P

**Gate open; unsigned.** This is a source and test audit. The two native lane specs have 16 Jest cases, counting the four approval kinds and three deliverable states separately. The coordinator ran the full cli-agent-runtime test target on Windows after 10d.P-C1 and all cases passed, including A:289-338. After the 10d.P-C1 revise round the coordinator ran the target again on Windows and every case passed, including the new no-callback adapter cases; Linux CI remains pending. PASS means the cited source and assertions cover the stated contract, with the coordinator's Windows test result where applicable; PENDING-LIVE requires a real pinned App Server observation; FAIL means the present evidence cannot establish the requirement. APPROVED-REMOVAL would require explicit user approval; none exists. For retained chat/Claude rows, PASS means the existing path remains, not that native Codex chat parity was proved.

Comparison base: git merge-base HEAD origin/main = 4e2d1eb5e52e50f22bb7ba5fc92617be83b81a3c. The legacy codex-cli.adapter.ts has no diff from that base, so current line numbers are valid. Paths below are worktree-relative. L = libs/backend/cli-agent-runtime/src/lib/cli-agents; N = L/cli-adapters/codex; P = L/codex-lane-parity.spec.ts; A = L/codex-lane-activation.spec.ts. E = Electron, C = CLI, T = TUI through CliDIContainer, V = VS Code. Inventory numbers refer to parity-inventory.md.

## Preserve rows

| Inventory row | Legacy behavior (file:line) | Native evidence (file:line / spec) | Hosts | Status |
| --- | --- | --- | --- | --- |
| 22 Interactive tool approval | agent-sdk/sdk-permission-handler.ts:490 | N/codex-app-server-lane.adapter.ts:248-255; P:386-406 covers one direct sink decline per kind; chat callback retained | E chat; E/C/T/V lane | PASS, sink decline and chat retention; runtime delivery pending live observation |
| 23 Mid-session permission change | agent-sdk/sdk-agent-adapter.ts:1814-1825 | Existing chat adapter retained | E chat | PASS, retention only |
| 24 Legacy lane danger-full-access | L/cli-adapters/codex-cli.adapter.ts:90,559 | codex-runtime/codex-execution-profile.ts:175-192; P:279-307 asserts cwd-only workspace-write | E/C/T/V | PASS, D26 reduction |
| 25 Legacy lane approval_policy=never | N/codex-lane-config.builder.ts:129 | codex-execution-profile.ts:175-192; P:279-307,386-406 asserts bounded sandbox and one direct sink decline for each kind | E/C/T/V | PASS, D26 reduction; runtime delivery pending live observation |
| 26 Chat selected model | rpc-handlers/chat-session.service.ts:853-854,1570-1571 | Chat path retained; lane selected model P:223-255 | E chat; E/C/T/V lane | PASS, retention only |
| 27 Chat effort change | shared/agent-adapter.types.ts:345-352; chat-session.service.ts:897,1600 | Chat path retained | E chat | PASS, retention only |
| 28 Lane effort whitelist | L/cli-adapters/codex-cli.adapter.ts:66,542-548; N/codex-lane-config.builder.ts:131-133 | N/codex-app-server-lane.adapter.spec.ts:431-455,539-549 | E/C/T/V | PENDING-LIVE, observe resumed turn effort |
| 29 Lane default model | L/cli-adapters/codex-cli.adapter.ts:367-372 | N/codex-app-server-lane.adapter.ts:204-230; P:223-255 explicit model | E/C/T/V | PENDING-LIVE, observe default and selected model |
| 30 Login/stale-token/proxy start | auth-providers/oauth-proxy.strategy.ts:162-220 | Chat path retained; lane credential probe N/codex-app-server-lane.adapter.ts:186-203 | E chat; E/C/T/V lane | PASS, chat retention only |
| 31 Per-context home | auth-providers/codex-home-resolver.ts:15-26 | E codex-lane-composition.ts:105-121; C codex-lane-runtime-composition.ts:111-129; V composition.spec.ts:213; P:42-65 | E/C/T/V | PENDING-LIVE, chosen home/account and no fallback |
| 32 Same-home effective configuration | No dedicated legacy implementation, inventory:32 | P:309-384 interleaves both lanes through one adapter, runtime provider and identity store; checks per-open MCP suppression, instructions, cwd and policy through A follow-up and B reopen; E codex-lane-composition.spec.ts:191-279 | E/C/T/V | PASS, static and spec-backed; live effective config pending |
| 33 Legacy auth path ignores CODEX_HOME | L/cli-adapters/codex-cli.adapter.ts:409-421,473-516 | Native host selected-home binding E:105-121, C:111-129, V spec:213 | E/C/T/V | PENDING-LIVE, explicit home or visible auth failure |
| 34 Account read home guard | auth-providers/codex-account-usage.service.ts:251-276 | Existing client retained; lane identity check N/codex-app-server-lane.adapter.ts:490-504 | E chat; E/C/T/V lane | PENDING-LIVE, wrong-home resume refused |
| 35 Provider id | auth-providers/active-provider-resolver.ts:44-74 | Resolver retained; lane provider check N/codex-app-server-lane.adapter.ts:490-504 | E chat; E/C/T/V lane | PASS, retention and guard |
| 36 Workspace provider profile | chat-session.service.ts:867-876,1573-1582 | Chat path retained; lane workspace check N/codex-app-server-lane.adapter.ts:490-504 | E chat; E/C/T/V lane | PASS, retention and guard |
| 37 Workspace/cwd safety | chat-session.service.ts:803-829 | Chat path retained; lane roots cwd only P:279-307 | E chat; E/C/T/V lane | PASS, retention and profile |
| 38 Session folder on continue | chat-session.service.ts:939-942 | Chat path retained; lane identity N/codex-app-server-lane.adapter.ts:490-504 | E chat | PASS, retention only |
| 39 Prompt/style/MCP | chat-session.service.ts:845-911,1553-1611 | Chat path retained; separate lane profile N/codex-lane-profile.ts:140-181 | E chat; E/C/T/V lane | PASS, retention only |
| 40 Continue without .mcp.json | chat-session.service.ts:943-957 | Chat path retained | E chat | PASS, retention only |
| 41 Lane suppression; Ptah MCP | N/codex-lane-config.builder.ts:103-107,136-163 | N/codex-lane-profile.ts:140-181; P:408-428 supplies ptah among user MCP names, preserves Ptah and disables the other server | E/C/T/V | PENDING-LIVE, inspect effective MCP and suppression config |
| 42 Resume developer instructions | N/codex-lane-config.builder.ts:37-42,165-168 | N/codex-app-server-lane.adapter.ts:409-444; N/codex-app-server-lane.adapter.spec.ts:257-291 | E/C/T/V | PENDING-LIVE, effective role and no duplicate preamble |
| 43 Ordered chat events | chat-session.service.ts:913-918 | Chat path retained; lane event map N/codex-lane-events.ts:28-165 | E chat; E/C/T/V lane | PASS, chat retention only |
| 44 Partial deltas | shared/agent-adapter.types.ts:194-199 | Chat path retained; lane textDelta map N/codex-lane-events.ts:28-165; P:223-255 | E chat; E/C/T/V lane | PENDING-LIVE, observe preterminal lane deltas |
| 45 Inline images/files | chat-session.service.ts:863-893,1054-1058 | Chat path retained | E chat | PASS, retention only |
| 46 Lane text/reasoning/tool/file/MCP/usage | L/cli-adapters/codex-cli.adapter.ts:123-160,961,1205-1224 | N/codex-lane-events.ts:28-165,191-209; P:223-255; native event spec | E/C/T/V | PENDING-LIVE, actual frame kinds and one usage segment |
| 47 Windows terminal release | L/cli-adapters/codex-cli.adapter.ts:750-766 | N/codex-app-server-lane.adapter.ts:365-408; P:223-255,257-277 simulates terminal | E/C/T/V on Windows | PENDING-LIVE, real completed/failed closes running; error remains nonterminal |
| 48 Chat stop-intent | chat-session.service.ts:1026-1051 | Chat path retained; lane abort P:257-277 separate | E chat | PASS, retention only |
| 49 Lane queue/abort/flags | L/cli-adapters/codex-cli.adapter.ts:354-360,647,674 | N/codex-app-server-lane.adapter.ts:453-487; P:257-277 | E/C/T/V | PENDING-LIVE, queue same thread and abort active turn |
| 50 Chat resume profile | chat-session.service.ts:1593-1618 | Chat path retained | E chat | PASS, retention only |
| 51 Lane resumeThread/per-turn exec | L/cli-adapters/codex-cli.adapter.ts:109,526-529,619 | N/codex-app-server-lane.adapter.ts:292-326,409-504; P:257-277 | E/C/T/V | PENDING-LIVE, named thread/account retained |
| 52 End session token match | shared/agent-adapter.types.ts:311-321 | Existing chat path retained | E chat | PASS, retention only |
| 53 Claude result/live/compaction callbacks | shared/agent-adapter.types.ts:354-360 | Claude path retained; lane SdkHandle output/status N/codex-app-server-lane.adapter.ts:365-487, not Codex chat parity | E chat; E/C/T/V lane | PASS, Claude retention only |
| 54 Lane usage fields | L/cli-adapters/codex-cli.adapter.ts:1205-1224 | N/codex-lane-events.ts:191-209; P:223-255 checks input/output/cache-read | E/C/T/V | PENDING-LIVE, actual terminal counters |
| 55 Auto-compact/tool-output limits | N/codex-lane-config.builder.ts:61-64,109-124 | N/codex-app-server-lane.adapter.ts:204-230,328-345; native config specs | E/C/T/V | PENDING-LIVE, effective config, zero omission, invalid warning |
| 56 Interactive compaction | shared/agent-adapter.types.ts:360 | Claude chat path retained; Codex chat gap remains | E chat | PASS, retention only |
| 57 Interrupted subagents/list | chat-session.service.ts:1020-1025,1372-1394 | Claude path retained; lane agents disabled N/codex-lane-profile.ts:140-181 | E chat; E/C/T/V lane | PASS, Claude retention only |
| 58 IAgentAdapter binding | apps/ptah-electron/src/di/phase-2-libraries.ts:328; agent-sdk/di/register.ts:917-945 | Non-Codex binding retained; E phase-2-libraries.ts:299, C container.ts:769, V phase-2-libraries.ts:263 lane factory | E/C/T/V | PASS, source composition |
| 59 Copilot/non-Codex branches | auth-providers/oauth-proxy.strategy.ts:4-6,150-159 | Existing strategy retained; P:430-442 source scan checks SDK-free native adapter/compositions | E chat | PASS, retention only |
| 60 Rewind active session | chat-session.service.ts:1407-1436; agent-sdk/sdk-agent-adapter.ts:1805-1811 | Existing chat path retained | E chat | PASS, retention only |
| 61 Config rejection/essential retry | L/cli-adapters/codex-cli.adapter.ts:96-105,563 | N/codex-app-server-lane.adapter.ts:328-345; native adapter spec:409-486 | E/C/T/V | PENDING-LIVE, one retry and visible notice |
| 67 Lane steer/interrupt limit (inventory gap note) | L/cli-adapters/codex-cli.adapter.ts:354-360,367-369 | P:257-277 asserts false/false/true capability and queue | E/C/T/V | PASS, visible limit |

### Additional lane activation rows from plan-p10.md:11-31

| Preserve row | Legacy behavior | Native evidence | Hosts | Status |
| --- | --- | --- | --- | --- |
| Binary detection/credentials | L/cli-adapters/codex-cli.adapter.ts:338-359,501-527 | codex-runtime/codex-executable-inspection.ts:43-143; E/C/V composition specs for pin/home | E/C/T/V | PENDING-LIVE, actual pin and account |
| Account binding / default-account start | L/cli-adapters/codex-cli.adapter.ts:909-927 starts the default-account turn and returns a handle without a binding callback | A:289-338 initially FAIL (carries native terminal usage through the manager gate and ledger, then routes an attributed report); fixed by 10d.P-C1 at N/codex-app-server-lane.adapter.ts:318-325; N/codex-app-server-lane.adapter.spec.ts:246-255,257-273,294-322 | E/C/T/V | PASS, static + coordinator Windows run; named-account manager path PENDING-LIVE |
| Catalog/model rejection | L/cli-adapters/codex-cli.adapter.ts:377-464,728-748 | N/codex-app-server-lane.adapter.spec.ts:672-691,803-886; native error mapping | E/C/T/V | PENDING-LIVE, catalog/rejection with no substitution |
| Startup timeout/web search | L/cli-adapters/codex-cli.adapter.ts:693-723; N/codex-lane-config.builder.ts:104-123 | N/codex-app-server-lane.adapter.ts:204-230; native timeout/config specs | E/C/T/V | PENDING-LIVE, bounded startup and effective search setting |
| Role/preamble/policy canary | L/cli-adapters/codex-cli.adapter.ts:551-553,672-686,884-917 | N/codex-app-server-lane.adapter.ts:409-461; P:223-255 | E/C/T/V | PENDING-LIVE, effective instructions and canary once |
| File context/ANSI/output buffering | L/cli-adapters/codex-cli.adapter.ts:948-992 | Native event mapping and adapter specs; P:223-255 | E/C/T/V | PENDING-LIVE, files and clean replayed text |
| Last-request rollout usage/resume gate | N/codex-rollout-usage.reader.ts:61-76,151-188; lane-resume-gate.ts:35 | A:340-386 shared manager contract (adapter-agnostic): cumulative stream figure loses to the 20k rollout figure and a 160k rollout gives fresh; A:289-338 integrates native terminal usage with the same gate; existing reader spec covers JSONL extraction | E/C/T/V | PASS, static and spec-backed; live rollout pending |
| Windows hidden spawn | L/cli-adapters/codex-cli.adapter.ts:620-647 | codex-runtime/codex-app-server-process.ts:160-185; host pin guards | E/C/T/V Windows | PENDING-LIVE, no console window |
| Plan-limit ledger | agent-process-manager.service.ts:126-140,2874-2940 | A:388-440 shared manager contract (adapter-agnostic): completed run with usage, quota failure evidence, stopped run, usage-unknown run and separate unknown-owner run; A:289-338 carries native terminal usage into the manager ledger | E/C/T/V | PASS, static and spec-backed; live ledger pending |
| Report attribution/deliverable | agent-process-manager.service.ts:808-814,2978-2997; lane-completion-notifier.service.ts:103-186,281-327; agent-report-router.service.ts:266-379 | A:442-481 shared manager contract (adapter-agnostic): routes an attributed report to the parent and checks missing, empty and valid files in the manager's exit signal; A:289-338 routes a report from a real native-adapter run; P:408-428 keeps the Ptah MCP contract | E/C/T/V | PASS, static and spec-backed; live report pending |

## Approval and sandbox selection

D26 (decisions.md:245; plan-p10-review.md R1) accepts only shell network access and writes outside the working directory as reduced capabilities for native delegated lanes. The native lane profile has workspace-write, networkAccess:false, writableRoots:[cwd], and an auto-decline sink for command, fileChange, permissions and mcpElicitation requests (codex-execution-profile.ts:175-192; P:279-307,386-406). The direct approval-sink case emits one safe output line containing only request kind and tool name; live runtime delivery remains to be observed. Legacy danger-full-access and approval_policy=never are transitional SDK facts. Native approvalPolicy never is acceptable only with the bounded sandbox and auto-decline behavior; it does not mean legacy full access.

## Host and binary identity

The pin source is libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts: Codex 0.165.0, win32/x64 only, SHA-256 beginning d4b2e6. inspectCodexExecutable at codex-executable-inspection.ts:43-143 resolves the real file, checks stat and digest, and requires exact platform/arch/version/digest before spawn. Unpinned platforms, absent files and digest mismatch fail closed. Review V-5 (code-logic-review-10d-CV-r1.md:26,51) identified a VS Code development-mode pin issue; D27/D28 defer reliance on that path until the pin is confirmed or fixed.

Electron composition is apps/ptah-electron/src/di/codex-lane-composition.ts:105-160,183-236; unpackaged development defaults native behind the pin, packaged uses the gate (D27). CLI composition is libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:105-129,250-277 and requires the gate (D28). TUI imports CliDIContainer at apps/ptah-tui/src/main.tsx:8-10. VS Code composition is apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:97,246; D28 allows development native, subject to V-5. P:430-442 asserts that the native adapter and these three host compositions import no @openai/codex-sdk. The legacy path remains callable until a signed proof and separate Removal B approval.

## Live run plan (needs user authorization)

No command was executed in this lane. The coordinator's Windows cli-agent-runtime test target passed; Linux CI, actual pin confirmation, and user authorization for paid/model calls remain pending. On a pinned win32/x64 machine, use three turns per host: spawn with output/report/approval, queued follow-up, and resumed thread with abort. Estimate **12 model turns** (3 times four hosts), plus extra turns only if the first three cannot elicit each approval kind or a config rejection. Controlled fixtures can check rare branches without paid calls but cannot count as live observations.

| Host | Proposed launch/selection, not run | Required observations |
| --- | --- | --- |
| Electron | npm run electron:launch, after coordinator's build prerequisites; select Codex delegated lane | Inspected executable path/version/digest and CODEX_HOME; same thread across queue/resume; text, terminal usage, safe declined approval, Ptah report attributed to parent, valid deliverable accepted, abort exits running; two same-home contexts with different MCP/instructions/cwd/policy do not bleed after reload. |
| CLI | node dist/apps/ptah-cli/main.mjs after coordinator build, with native lane gate enabled (D28) | Same observations; gate-off remains legacy; explicit home failure does not fall back; model/effort and config rejection notice visible. |
| TUI | node dist/apps/ptah-cli/tui.mjs after coordinator build, with native lane gate; output path from apps/ptah-tui/project.json:10,19-21 | Same thread, approval, report, abort and visible terminal state; no separate unpinned runtime. |
| VS Code | F5 Extension Development Host after V-5 pin issue resolved; select native lane | Pin before spawn, selected home, same three-turn projection, report/deliverable in extension, wrong pin fails before model call. |

Across hosts capture actual frames/effective config for model, effort, role and PTAH_LANE_POLICY once, Ptah MCP and suppression of user MCP/agents/plugins/apps/skills, web search and token budgets, text/reasoning/command/file/MCP events, one terminal usage segment, and a failed turn. On Windows verify hidden spawn and that turn.completed/turn.failed release running while a nonterminal error does not. Catalog failure and rejected model must not silently substitute. Each approval kind must decline once without details. An unsupported key remains a gap, not parity.

## Decisions

1. D26 policy: retain bounded workspace-write and auto-decline; accept only the recorded shell-network/outside-cwd reduction. Evidence: decisions.md:245, inventory:24-25, P:279-307,386-406. Reversible by an explicitly selected policy and new evidence, without automatic elevation.
2. Keep activation and Removal B blocked pending Linux CI and pinned live observations. The four former FAIL rows have static, spec-backed evidence, and the coordinator's Windows cli-agent-runtime test target passed. Evidence: P:309-384; A:289-481; plan-p10.md:23,30-31. Reversible after checks and authorized live run.
3. Count TUI as CLI composition, not an independent DI implementation. Evidence: apps/ptah-tui/src/main.tsx:8-10 and CLI container.ts:769. Reversible if TUI composition changes.
4. The coordinator ran the full cli-agent-runtime test target on Windows after 10d.P-C1 and it passed; the new revise-round adapter cases, Linux CI, and real pinned App Server observations remain pending under the task's hard rules. Reversible when those checks and authorized live observations complete.

## Corrective batches after the first Electron live run (10d.L1-L3)

The first live run (live-test-p10dP.md) found three blockers. Each has a corrective batch with specs. G1, G2 and G3 are live-proven in Electron (runs 2 and 3); G4 was not observed.

| Gap | Batch | Change | Status |
| --- | --- | --- | --- |
| G1 resume after a completed lane | 10d.L1 + revision 1 | Per-host writer registry; a resume closes the idle prior context of the same thread before `thread/resume`; refuses (`CODEX_LANE_WRITER_ACTIVE` / `CODEX_LANE_WRITER_CLOSE_FAILED`) when that context has an active turn or its close fails; a failed close can be retried. | PASS (live r2, r3) |
| G3 Ptah MCP refused under `approval_policy never` | 10d.L2 | Lane `mcp_servers.ptah` gets `default_tools_approval_mode: 'approve'`; user servers stay `{ enabled: false }`; same frame on start and resume. The schema allows `approve` but does not document that it skips the prompt. | PASS (live r2, r3) |
| G4 MCP error shown as "null" | 10d.L2 | Failed tool with null output shows the App Server error text, or `Tool call failed`. | NOT-OBSERVED (no MCP error in r2, r3); spec-covered |
| G2 completion signal to the tab id | 10d.L3 + revision 1 | Manager keeps a bounded (256) tab->session map for later spawns; native Codex chat accepts `origin: peer` and renders it like Claude (`inboundPeer`, `source: 'complete'`); outcome `parent_session_id` persisted only for an active resolved session. | PASS (live r2 fresh lane; r3 fresh and resumed lane after 10d.L4) |

Second Electron live run (live-test-p10dP-r2.md, head 0feebb6ab, 7 of 10 turns, settings `cmp` 0): G1 PASS, G3 PASS,
G2 PASS for a fresh lane but FAIL for the resumed lane (`delivery-failed ... "Codex chat turn: busy"`: the lane's
report started a main-chat turn, and the completion message arrived while that turn ran; native Codex refuses
instead of queueing like Claude), G4 NOT-OBSERVED. Corrective batch 10d.L4 (+ revisions 1-2): native Codex
`sendMessageToSession` queues peer-origin messages in a bounded (32) per-session FIFO and starts each as the next turn
after the active turn releases (Claude `session.messageQueue` parity, peer row on start, queue survives Stop like
Claude); `require-idle` is refused with Claude's `SessionAdmissionRefusedError` (`busy` / `session-ended`). Reviews
code-logic-review-10d-L4.md (7.5), -r1.md (REVISE 7.5), -r2.md (APPROVED 9). G2 for a resumed lane is PENDING-LIVE. Still open: G5 token
columns NULL and 0 report receipts, no reasoning segments, resume replaces the earlier lane output, old app-server
exit logged as "Codex process failure".

Reviews: code-logic-review-10d-L.md (REVISE 6/10), code-logic-review-10d-L-r1.md (APPROVED 8.5/10), codex-review-coordinator-spec-fix.md (APPROVED). Open minors from r1: a context can stay open but unregistered when close fails on the open-failure path; a half-closed lane is re-registered after a failed close; origin kinds `channel`, `task-notification`, `coordinator` have no effect on Codex (plain user text); Codex rejects an empty peer `from`.

Third Electron live run (live-test-p10dP-r3.md, head 16218ed0a = code c4266a3dc, 8 of 8 turns, settings `cmp` 0):
G2-B PASS. Scenario B resumed the completed lane (`Resume gate ... decision resume`, same cliSessionId
`01a193f6-...`); report delivered (app.log 1832), report turn ended (1836/1838), then `Completion signal delivered`
(1839). The lane ended inside the report turn (rollout timestamps), so the completion was queued and started 176 ms
after that turn released. `Codex chat turn: busy` 0, `delivery-failed` 0, `[ERROR]` 0; Report row then Completed row
in chat. Scenario A showed the same queueing (lane exit 1682 during a 59 s report turn, delivered 1707). G1 PASS, G3
PASS, G4 NOT-OBSERVED, G5 still open (NULL token columns, 0 report receipts). New minor: app.log 52
`Lane outcomes start failed (non-fatal)` with an empty `{}` error, although outcome rows were written. Scenario C
(`ptah_agent_message` after the handoff) was not run (budget). Live scope: Electron only; CLI, TUI and VS Code rows
stay PENDING-LIVE.

Fourth Electron live run (live-test-p10dP-r4.md, head 2d1c69dd2 = batch 10d.L5, 7 of 8 turns, settings `cmp` 0):
G5 token columns PASS (`input_tokens 53511`, `output_tokens 434`; receipts empty by design). G1, G3 PASS; G2 PASS
for Scenario A. Gate S FAIL: the new log shows the real cause of `Lane outcomes start failed`: the
`StructuredDecisionAdapter` chain reaches `ActiveProviderResolver`, which needs `WorkspaceScopeResolver`; Electron
registers it only once `ACTIVE_WORKSPACE_SOURCE` exists (electron-settings-registration.ts:86-104). Scenario C:
`ptah_agent_message` routed to the resumed agent with `isError false` in mode `queue-next-turn` (the declared Codex
lane capability, same as Claude and legacy Codex lanes). The test told the lane to wait inside its turn, so it slept
and the queued message was never started; this is a test design gap, not a parity defect. Delivery of a queued
message to a resumed lane at the next turn stays PENDING-LIVE.

## Proposed Removals

None. D26 is the only already accepted reduction. The gaps in parity-inventory.md:63-67 remain gaps; no Codex chat subagent, canUseTool prompt, partial-streaming, or compaction capability is inferred from this lane proof. No source or capability is approved for Removal B.

## Signature

Signed: pending user approval (Electron live runs r2 and r3 complete; G1, G2 incl. resumed lane, G3 PASS)
