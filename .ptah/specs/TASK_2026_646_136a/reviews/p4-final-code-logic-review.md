# P4 final code logic review — TASK_2026_646_136a

**Verdict: NEEDS_REVISION — 5.5/10.** 0 Blocking, 2 Serious, 0 Moderate, 0 Minor; 2 failure modes.

**Review family:** reviewer: codex/OpenAI; implementer: Anthropic subagents.

| Acceptance item | Status | Evidence |
| --- | --- | --- |
| S-1: status failure does not fail all settings | CLOSED | `agent-rpc.handlers.ts:479,506-561` isolates `getStatus`, reads the stored selection, and returns a fixed five-state DTO. |
| S-2: Jev key write precedes selection | PARTIAL | `agent-rpc.handlers.ts:653-660` closes the key-write-fails-first case. A later selection failure still leaves a changed key; defect 1. |
| S-3 UI: caught errors do not reach the webview logger as raw text | CLOSED | `decision-model-row.component.ts:517-523,638-642,667-673,694-696` logs fixed messages and error types only. The row still displays host `detail` at `:332-338`; see defect 2. |
| M-4: structured suggestions and help | CLOSED | `decision-model-row.component.ts:460-471,658-665` lists the provider catalogue without a tool-use filter and states the JSON-schema requirement. |
| Visual Serious 1: control borders | CLOSED by class/token evidence | `decision-model-row.component.ts:45-52,183-185,235-239,269-273` applies `!border-base-content-muted`; this overrides the light-theme rule at `apps/ptah-extension-webview/src/styles.css:2129-2135`. Rendered contrast is a separate visual check. |
| Visual Serious 2: placeholders | CLOSED by class/token evidence | `decision-model-row.component.ts:52,235-250,269-281` applies `placeholder:!text-base-content-muted` to both inputs, overriding `styles.css:2138-2141`. Rendered contrast is a separate visual check. |
| Visual Moderate 1: raw runtime detail | PARTIAL | Current probe, credential and readiness failures use fixed detail at `decision-model.config.ts:392-401,430-439,575-592`; an older persisted mark remains displayable at `:621-629,474-478`. Defect 2. |
| Unset + unreadable selection means “not read,” with no Undo | CLOSED | `agent-rpc.handlers.ts:516-532` returns unset/unreachable; `decision-model-row.component.ts:511-516,689-692` converts it to no status; `:586-597` offers no Undo when status is null. |
| Visual Minor 4: remove key with no key | CLOSED with accepted unknown-state rule | `decision-model-row.component.ts:477-484,290-300,608-621` hides the button for Jev/no-credential and after removal. It remains available when key state is unknown, allowing deletion without selecting Jev and sending decision requests. |
| Visual Minor 5: footer promises Undo for key changes | CLOSED | `decision-model-row.component.ts:485-493,583-597` says a key change has no Undo and supplies `undo: null` when a key is typed. |

## Defects

1. **Serious — a failed Jev selection write can silently replace the active credential.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:653-660,779-792`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:153-176,186-193,200-210`; `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:55-56,583-599`. Start with Jev already selected. Enter a new key and model, then let secret storage succeed but `setConfiguration` reject (for example, a locked or full settings file). The RPC returns `success: false`, and the row shows “The saved choice is unchanged,” yet subsequent Jev requests read the new key. The same ordering lets a malformed `decisionModel` payload change the key before `setSelection` validates it. The first half of S-2 is fixed, but the combined write still has a success-looking account of its persisted state after failure. The caller needs an accurate partial-write result or a compensating transaction before it can claim that failure left the effective configuration unchanged.

2. **Serious — a previously persisted unsupported mark can still put raw error text in the row.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:76-83`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:606-629,450-478,676-682`; `libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts:519-534`; `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:332-338`. The previous build could persist a probe/control failure containing `fetch failed` or a URL in `ptah.decisionModel.unsupported.v1` (also recorded in `reports/batch-40c-report.md`, “Out-of-scope observations”). The new build accepts any string as mark `detail`, reuses it for a matching selection, and displays it unchanged. Users upgrading with such a mark can still see raw runtime text, including any sensitive text captured in the old error. Current probe failures use fixed strings, but this persisted path leaves S-3/visual Moderate 1 incomplete. Sanitize or discard legacy detail when loading the mark.

## Five logic questions

1. **Silent failure:** after a successful key write and failed selection write, `agent:setConfig` reports failure while the effective Jev credential has changed (`agent-rpc.handlers.ts:653-660,779-792`; `decision-model.config.ts:200-210`).
2. **Unexpected user action:** editing an already selected Jev model and key during a settings-write failure changes the key despite the failed-save message (`decision-model-row.component.ts:55-56,583-599`).
3. **Wrong-answer input:** a malformed selection combined with a valid key stores the key before schema rejection (`agent-rpc.handlers.ts:653-660`; `decision-model.config.ts:153-160`).
4. **Dependency failure:** status and suggestion failures are bounded to the row with fixed logging (`agent-rpc.handlers.ts:506-561`; `decision-model-row.component.ts:505-523,648-673`), while a selection-store failure after a key-store success leaves the partial write described above.
5. **Missing requirement:** the fixed-detail rule needs to cover data persisted by the prior build, not only new probe catches (`decision-model.config.ts:606-629,676-682`).

## Evidence and limits

Read the P4 triage, original logic and visual reviews, Batch 40a–40c reports, Requirement 1 and the current source paths cited above. The three named commits were inspected with `git show`. The orchestrator reports passing rpc-handlers, lane-routing and chat tests, typechecks and lint, plus degradation audit TOTAL 296; these were not rerun. A scoped `ptah_get_diagnostics` call returned *unavailable* after its TypeScript check exceeded 45 seconds, so it adds no evidence. No rendered contrast measurement was made in this review.

The 5.5 score reflects two concrete failure paths after an otherwise broad fix round. A 7–8 requires the partial-write and persisted-detail contracts to hold; a 3–4 would require the main status and UI fixes themselves to be ineffective, which the cited code does not show.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep “Remove stored key” available for unknown key state | Hide it until Jev is selected, or allow deletion while state is unknown. The DTO has no key-presence flag for other selections (`decision-model-row.component.ts:473-484`), and the separate removal sends only the empty key (`:608-616`). Allowing deletion avoids a Jev selection that would send request text. | Yes |
