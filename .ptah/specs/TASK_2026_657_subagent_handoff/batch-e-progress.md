# Batch E progress (append one line per component)

- C3 files+message: withinHandoffTimeout exported in subagent-handoff-files.ts (prepareHandoffFiles uses it); handoffMessage(..., recordPath?) line 2 + resume repeat. Specs: pending.
- C1 record store: CREATED subagent-handoff-record.ts (writeOnce/markInvoked/withdraw/forget/writeStub, parsers, checkHandoffDir). Spec: pending.
- C2 index: CREATED subagent-handoff-index.ts (publish/forgetCursor/pointerFor, rescan, per-entry read errors, injectable HandoffIndexFs). Spec: pending.
- C4 delivery: REWRITTEN subagent-handoff-delivery.ts (post/send/push only). C5 monitor: stop() reorder, prepareHandoff, onRecordFailed, handoffPointer, release forget; register.ts wires SubagentHandoffRecords + SubagentHandoffIndex. session-query-executor.service.spec.ts: added fake records/index ports (constructor arity). Specs: pending.
- C6 hook: user-prompt-submit-hook-handler.ts pointer (agent_id gate, 1 s race, isOptional inject) + spec (6 new tests) PASS.
- C3/C4 specs: files spec (+3 withinHandoffTimeout tests) and delivery spec (rewritten, 9 tests) PASS (21 total).
- C1 spec: subagent-handoff-record.spec.ts 28 PASS (checkHandoffDir now creates level by level after each passes, so nothing is created through a junction).
- C2 spec: subagent-handoff-index.spec.ts 14 PASS (all r3/r4 fault schedules incl. rescan, EACCES head, mixed failing+readable).
- S5 confirmed (continuation): tool_use ids are API-minted; SubagentRegistryService keys by toolCallId process-wide (subagent-registry.service.ts:57-60, agentId noted session-unique at :232,:774); writer map key unchanged.
- C5 spec (continuation): monitor spec harness gains fake records/index + call-order log; 14 new record tests (describe 'SubagentBudgetMonitor handoff records'), 3 old tests updated, retry-pending test replaced; B2 sentence moved into class JSDoc. 81 PASS.
- session-query-executor.service.spec.ts: 49 PASS, no change needed.
- C7 (continuation): SUBAGENT_HANDOFF_RULE exported from task-spec.contract.ts, rendered in both audiences (+coordinator exception sentence); spec +2 audience tests, size test excludes the shared rule (97 PASS); 15 .claude/agents Task-folder lines appended; both SKILL.md copies +1 bullet (byte-identical); agent-generation specs 308 PASS.
- Self-check: rg for removed symbols clean (only unrelated 'missed' prose and the legit near-budget notesPath).
- Report written: batch-e-report.md (all 5 handoff items done; Guarantee-4 rotation observation recorded).
