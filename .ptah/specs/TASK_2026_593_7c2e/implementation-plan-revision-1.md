# Implementation plan revision 1 — TASK_2026_593_7c2e

Gate 2 `REVISE` findings are addressed in the revised `implementation-plan.md`. Line numbers below refer to that file. The approved design is unchanged; decisions #16–#18 already record the three Gate 2 rulings. No code or tests were run in this document pass.

| Finding | Change made | Plan line |
| --- | --- | --- |
| B1 | Clear all affects Recent and transient failure/warning presentations only; live request snackbars remain. A1 test asserts this. | 7, 40, 44, 48, 80, 88, 132 |
| B2 | Git surface visibility controls the 10s snackbar; visible uses strip only, Recent exists in both cases; C2 tests both. | 7, 70, 110, 133 |
| S1 | No title opt-in per design #15 and binding #18; explicitly supersedes optional reviewer #10. Privacy confirmation is flagged without delaying implementation. | 7, 65, 131, 138–140 |
| S2 | One `IHostAttentionIngress` contract is invoked before delivery by the actual VS Code, Electron and CLI transports; it covers SDK normal/lane/second path, CLI lane and MCP approval. B3b adds the emitter census; all three transports get zero-view tests. | 56, 59, 96, 100–107, 117 |
| S3 | Coordinator token, SDK registration and post-SDK resolution in Electron, VS Code and CLI roots; matching expected-resolvable and smoke specs. | 56, 99, 103, 105, 107 |
| S4 | A7 owns `MESSAGE_HANDLERS` consumer, snapshot reconciliation and `attention:openTarget` route; A6 owns typed push contract. | 57, 94–95 |
| S5 | A3–A5 remove imports before A5b deletes ledger and export; each batch retains compilable dependencies. | 73, 90–93, 113 |
| S6 | Electron bootstrap injects native `Notification` factory via platform options; its actual Electron webview adapter calls the ingress and click routes to A7. | 63, 102–103 |
| S7 | Named `IPtahViewVisibility` port, platform-vscode implementation and app provider feed for sidebar and panels. | 64, 96, 104–105 |
| M1 | Chat source computes voice sound eligibility; core only reads the flag; tests are separated accordingly. | 40–44, 89 |
| M2 | Core dispatcher token and chat handler resolve Allow/Deny/Answer/Retry/Switch; stale and failed action behavior is specified. | 43, 88–89, 95 |
| M3 | Preserved `respondLane(agentId, requestId, decision)` and existing `answeredRequestIds` guard. | 41, 89, 118 |
| M4 | C3 alone adds back-office failure projection while preserving public service API used by canvas. | 32, 72, 111, 113 |
| M5 | New domain RPC types file; push and RPC Zod schemas have distinct named owners; exports included. | 55, 94, 97–98 |
| M6 | B2a/B2b form one integration commit with RPC guards; DI guards are in the corresponding host wiring batch. | 97–107, 113 |
| M7 | B1 creates shared port contract; B4a/B5a/B6a run it for all adapters. | 96, 102, 104, 106 |
| M8 | Dropped `agent-rpc.handlers.ts`; B2 uses a dedicated attention handler. | 97–98 |
| m1 | Clarified that only finished-turn sound and announcements are removed. | 73 |
| m2 | Added 900px/short-height card cap, panel timer behavior, hover/focus pause, dismiss target and singleton announcer rules. | 48 |
| m3 | Every emitted VS Code message has Open Ptah; emission requires no visible Ptah view. | 64 |
| m4 | Chose first enabled row for bell focus under AC29 and design line 51; noted design line 39 inconsistency. | 48, 134 |
| m5 | Named the A2–A5 PR as the one that must precede TASK_702 chip removal. | 113 |
| m6 | Removed request to edit approved design; supersession lives in existing decisions #16–#18. | 7, 131–133, 140 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Follow approved Clear all scope | Clear live snackbar or retain it; retain it | User-approved `design-spec.md:31,37`, `design-revision-1.md` M3 and binding decision #16 supersede AC7 clause | Yes |
| Use visibility for git warning | Focus or visibility; use visibility | `design-spec.md:17`, `design-revision-1.md` M2 and decision #17 | Yes |
| Ship without session-title opt-in | Add optional setting or follow approved design; follow design | `design-spec.md:56`, user approval #15 and binding decision #18 supersede reviewer-derived #10 | Yes, additive later |
| Observe host requests through one contract | Instrument producers individually or call one ingress at each host transport; use common ingress | VS Code `webview-manager.ts:192-218,297-307`, Electron `webview-manager-adapter.ts:47-61,88-90`, and CLI `cli-webview-manager-adapter.ts:25-38` are distinct active transports; producer paths are cited at plan line 56 | Yes |
| Delay ledger deletion to A5b | Delete in A3 or after all import removals; choose A5b | `notification-center/src/index.ts:3`, `notification-announcer.component.ts:2,26`, `app-shell.component.ts:69,181` still import it | Yes |
| Use first enabled row on bell open | Heading or first enabled row; choose row | AC29 and `design-spec.md:51` resolve inconsistent `design-spec.md:39` | Yes |

## Clarifications Needed

Privacy confirmation remains user-reserved in `decisions.md` #18. The orchestrator can ask whether to (a) keep no session-title host opt-in (Recommended, approved design #15) or (b) add an off-by-default title setting later (#10). The plan proceeds with (a), as directed by #18.
