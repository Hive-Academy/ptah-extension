# Implementation plan review (Gate 2) - Voice Command Center

- Author: codex CLI lane (software-architect role). Reviewer: in-process Claude subagent (independent cross-side).
- Artifact: `implementation-plan.md`, **revision 3**. Round: **3 (final)**.
- Scope: whether the plan implements decisions.md #17 ("Propose, then confirm") as decided, the status of round-2 findings N0-N4, and the carried round-1 items.
- Evidence: worktree `D:/projects/ptah-extension/.claude-worktrees/command-center` at `c57a9a1e7`. Every file cited below was opened in this round.

## Verdict: **REVISE**

Rev 3 follows #17 in its structure: Ptah proposes from `ptah_agent_list`, skips AT LIMIT lanes, honours saved preferences, speaks a summary, and shows a lanes/mode/rounds card that only a click or key confirms. The plan also resolves N1-N3, and N4's deferral is acceptable. One Serious defect remains in how confirmation is delivered (S1). The plan returns the literal answer "Confirm" to the model inside the discovery turn, where `ptah_agent_spawn` is still available. Spawning is then the model's natural next step, and the only guard is a prompt instruction plus a conditional, unscoped host check. That risks paid spawns before the run is registered, or twice. The fix is small and stays within #17.

## #17 conformance (code-checked)

| #17 element | Rev 3 location | Evidence | Result |
|---|---|---|---|
| Roster from `ptah_agent_list`, skip AT LIMIT | Session §5; Decisions row "Ptah proposes" | `ptah-system-prompt.constant.ts:262` ("skip lanes whose Limit state is AT LIMIT"). Host backstop is real: `agent-spawn-limit-gate.ts:39-47` uses `laneBlock` (`agent-limit.formatter.ts:214-218`). The plan should cite the gate file. | Pass |
| Honour saved lane preferences | Session §5 | `agent-rpc.handlers.ts:360-375` `agent:getConfig.preferredAgentOrder`. The plan is correct that the wizard roster is in-memory only. | Pass |
| Speak a summary | Session §5; Unit 6b | One-shot summary speech. | Pass |
| Confirm card (lanes, mode, rounds) | Session §5; Unit 8 | `rosterIsLaunchable` (`tribunal-roster-rules.ts:42-47`) and round bounds validated on untrusted payload. | Pass |
| Spawns only after explicit click/key; spoken "yes" never confirms | Session §5; Unit 8 card spec; Risks ¶1 | The coordinator's launch turn is gated on click/key. **Spawns inside the discovery turn are not gated** (S1). | **Fails as specified** |
| Transport via existing AskUserQuestion | Contracts row "Pending input"; Session §5 | `permission.types.ts:172-205`; `permission-handler.service.ts:567-578` posts `ASK_USER_QUESTION_RESPONSE`; `chat.store.ts:499-509`. | Verified |
| Decline-first, timeout/cancel | Session §5; Decisions | `ask-user-question.service.ts:177-205`: the 5-min idle timer picks `options[0]` and pushes `ASK_USER_QUESTION_AUTO_RESOLVED`. `:233-258`: non-delivery auto-picks the same. Abort resolves `null`. Decline-first is correct, but the model writes the options, so order must be validated (S1). | Partial |
| Registration → phase source | Session §5; Units 5, 6a | Manifest `{runId(UUID), rootTabId, rootSdkId, move, specTaskId, laneIds/roles, rounds}`; `tasks:create` (`tribunal-run.service.ts:248-267`); lane tags bind to the run; pure `tribunal-phase-derivation.ts` behind `src/phase.ts`; `tasks:get` on the registered folder only; honest "unavailable"/provisional states. | Pass |
| AC mapping and tests | AC table row 10-15; Unit 6a (gate, ordering, deny/timeout, AT LIMIT, two runs, restart); Unit 8 (click/key, spoken yes ignored, Decline, timeout) | Unit tests can prove the coordinator's ordering, but not model behaviour during the discovery turn (S1). | Partial |

## Findings

| # | Sev | Status | Location | Note |
|---|---|---|---|---|
| F1-F4 (r1) | Serious | Resolved (r2) | Contracts rows 14-18 | Unchanged in rev 3; persona now covers every activation path (N1). |
| F5 / N0 (r1/r2) | Serious | **Superseded by #17; implementation defect S1 open** | Session §5 | Roster source and confirmation are now specified. Delivery of the confirmation is unsafe; see S1. |
| F6-F15 (r1) | Mod/Minor | Resolved (r2) | n/a | No regressions. Units 3 and 9 both touch `@ptah-extension/chat` in disjoint files and run in sequence. |
| N1 Persona on regular-chat send and activate/rewind | Moderate | **Resolved** | Contracts row 14; Session §1; Units 1-3 | `command-center-persona.ts` lives in `chat-state` (dependency direction holds). The prompt is threaded through `chat:resume{activate}` (`chat-session.service.ts:1183-1192`) and `ensureSessionActiveForRewind` (`:1418-1427`), with tests listed. |
| N2 Conductor framing vs persona, long turn | Moderate | **Resolved** | Session §5 (end) | The framing wraps "conduct this approved run, then return". Barge-in queues, status reads the projection without a turn, and Stop uses `chat:abort`. |
| N3 createTab activation, close erases marker | Moderate | **Resolved** | Contracts row 16; Unit 2 | Activation is accepted by design. Close warns, and a separate workspace last-session SDK id keeps AC16 Resume. |
| N4 UI keyword routing before the chat | Minor | **Deferred, acceptable** | Deferred ¶3 | Narrow explicit-move words only, disclosed in page copy, ambiguous speech goes to chat, and the chat still conducts the run. Consistent with #7. |
| **S1** | **Serious** | **Open** | Session §5; Risks ¶1 | See below. |
| M1 | Minor | Open | Session §5 | `ChatStore.handleQuestionResponse` derives the deciding tab from `tabManager.activeTabId()` (`chat.store.ts:500-509`), not the marked tab. If the user switched tabs in regular chat, `cancelPendingQuestionOnOtherTabs` keys on the wrong tab. This is harmless once the answer is sent, but add a spec, or answer through a tab-explicit path. |

**S1 - Confirmation is delivered to the model inside a turn that can spawn (Session §5; Risks ¶1).** On click, the page answers the pending `AskUserQuestion` with `{[question]: "Confirm"}`. That answer is the tool result of the **discovery** turn, and `ptah_agent_spawn` is available in that turn: `MCP_TOOL_PROFILES` is only `coding`/`apps` (`ai-provider.types.ts:150`), so there is no spawn-free profile. A model that proposed a roster and then reads "Confirm" will usually spawn immediately. Its spawns would be (a) before the manifest exists, so they are unregistered and only provisional, and (b) repeated by the coordinator's separate framed launch turn, so every lane is paid for twice. A Claude model can also issue `ptah_agent_spawn` in parallel with `AskUserQuestion`, before any answer. The plan's guard is the instruction "the discovery turn must terminate ... without spawning" plus "if the model can start a spawn ... add host-side enforcement before release". The condition is already met (the tool is present), and the enforcement has no unit, files or contract. Separately, the page validates lanes, roles, rounds and the root, but not that `options[0]` is Decline. A Confirm-first proposal plus the 5-minute auto-pick would deliver "Confirm" to the model with no click.

Required (either option satisfies #17):
- **(a)** Never send "Confirm" to the model in the discovery turn. Answer the question with a fixed non-actionable value whatever the user chose, for example "Recorded. End this turn now; launch instructions follow separately", or decline it. Keep the Confirm/Decline decision local to the coordinator, which alone sends the framed launch turn. Alternatively, end the discovery turn with a delimited proposal block and confirm purely on-page, with no AskUserQuestion.
- **(b)** Keep the current answer flow, but scope a host-side per-root spawn hold as a work unit. Options: a new check beside `agent-spawn-limit-gate.ts` in `vscode-lm-tools`, keyed by the parent SDK session, opened only by the coordinator's launch, with an RPC or contract and tests. This is a new backend contract.

In both cases: reject (auto-Decline) any proposal whose first option is not Decline. Start the launch only from a click/key event, never from an `ASK_USER_QUESTION_AUTO_RESOLVED` push. Add a test that a discovery-turn spawn is detected and shown as provisional, not registered. Option (a) is recommended: it keeps all changes in the frontend and needs no new contract.

## Lane-introduced constraints

Rules proposed by the architect that need the user's attention:

- [architect-proposed] Voice-started Tribunal uses a two-turn protocol (discovery turn with a tab-scoped `AskUserQuestion` proposal, then a separate coordinator-sent launch turn). Decline is the first option because the backend auto-picks the first option after 5 minutes or on non-delivery. The safe answer delivery must be fixed (S1).
- [architect-proposed] Possible new host-side per-root spawn hold, only if S1 option (b) is chosen. That would be a new backend contract.
- [architect-proposed] Command Center runs on an ordinary chat tab marked `commandCenterOrigin`. Creating it activates that tab in regular chat. Closing it warns, and a separate workspace last-session record keeps Resume available.
- [architect-proposed] Optional `systemPrompt` on `ChatContinueParams`, threaded through `chat:resume{activate}` and rewind activation. A persona resolver in `chat-state` attaches it for marked tabs from both Command Center and regular chat.
- [architect-proposed] New library `@ptah-extension/command-center`. Aliases `@ptah-extension/ui/provider-brand-art` and `@ptah-extension/tribunal-panel/phase`. `CommandCenterSendLockService` in `chat-state`. Tribunal refactor extracting pure framing and phase derivation, with Tribunal behaviour unchanged.
- [architect-proposed] AC25 behaviour change: regular-chat sends to the active root are held while voice runs. Stop and answers stay enabled. The lock is transient.
- [architect-proposed] UI recognises explicit Tribunal move words only, disclosed in page copy; broader routing is deferred (N4).
- [architect-proposed] A ≤ 2 KB `COMMAND_CENTER_STATUS_CONTEXT` block persists in the transcript on status turns. Spoken caps are 600 characters or four sentences per reply and 180 per status. Scene cap 24 with the full list kept. At most two TTS requests in flight.
- [architect-proposed] User-run preimplementation Electron spike, then the Electron Scene and Voice Gate (p95 draw ≤ 8 ms, ≥ 30 FPS, measured audio p95 bound).
- [user-decision carried] #17 Propose, then confirm; spoken "yes" never confirms. #13 Canvas 2D and CSS only. #14 provider marks by ID. Licence deferral (no property-hub code copied without owner authorisation).
