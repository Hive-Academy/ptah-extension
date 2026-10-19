# Gate 2 implementation plan re-review, round 1 — REVISE

The six previous findings are closed against the revised plan, inventory, decisions, and current code. One new verification contradiction needs correction before implementation.

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| F1 — approved scope was gated | closed | `implementation-plan.md:11-17,43-46,79,190-201,203-264,335-379` now requires the approved cap behavior, badge removal, and Phase B deletions; `decisions.md:5-9` records approval. |
| F2 — workflow claim parity was falsely asserted | closed | `implementation-plan.md:37,56,170-171,182-183,313` and `parity-inventory.md:53` state that canvas tiles claimed tabs as on main, matching `orchestra-canvas.component.ts:343-347` and `canvas.store.ts:444-448`; decision 7 rejects a canvas claim filter. |
| F3 — Phase B omitted chat-view CSS and bindings | closed | `implementation-plan.md:212-252,330-332,350-353,369` covers inspector host/query, header addon bindings, CSS, and chat-view specs; the current bindings and styles are at `chat-view.component.ts:1172-1188,1212-1213` and `chat-view.component.css:17-50,197`. |
| F4 — reference sweep and project scope were incomplete | closed | `implementation-plan.md:105-107,116-122,233-234,266-275,342-379,380-400` includes the showcase selector, three stale-comment locations, chat-ui and electron-e2e checks, and conditional tribunal-panel coverage. |
| F5 — persistence origin and inventory labels | closed | `parity-inventory.md:17-22,33-36,53,89,107-114` records both writers, including the notification fallback in both hosts, and marks approved removals accordingly. The no-context fallback and token remain proposed and outside this PR. |
| F6 — overlapping batches and guard wording | closed | `implementation-plan.md:322-334` assigns all chat-view edits to sequential Batch 3; `implementation-plan.md:388-399` names the unaffected DI/RPC guards and scopes lint to changed projects. |
| F7 — new: impossible zero-reference check | **closed** | `implementation-plan.md:98-101` requires the AppState stored-`'single'` regression case; `implementation-plan.md:380-387` now permits `ptah-layout-mode` in that spec and e2e `canvas.spec.ts` while prohibiting production reads and writes. |

**Verdict: APPROVED.** F7 is closed, and the revised sweep introduces no new contradiction in the plan.
