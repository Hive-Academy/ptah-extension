REVISE — 8/10
Reviewer: codex / Author: claude

Gate 1.7, round 2 (final review round). The principal selection, rename and resume corrections are present. Two moderate behavioral discrepancies remain: the prototype assigns ambient selection during removal without modeling a committed host snapshot, and asynchronous completion can take focus away from a newer user action. Neither is a cosmetic issue. D39/D40 decisions remain settled.

## R1-R5 status

References below use `spec` = `design-spec-p5.md` and `prototype` = `prototype/p5/index.html`, relative to this task folder. Source references use repository-relative paths.

| Finding | Status | Evidence in written spec and prototype |
| --- | --- | --- |
| R1 — Omitted selection incorrectly unavailable | Closed | Spec §3.7, line 86, and §6 rows 15/21 explicitly preserve omitted/default resolution without writing a selection. Prototype `eff()` (line 90), `load('om')` (105), `chips()` (152) and `sel()` (153–155) present omitted as Existing Claude login. This matches `libs/shared/src/lib/types/provider-account.types.ts:214–220` and `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:720–727`. The missing-account fixture remains separate (prototype 106, 157). |
| R2 — Unconfirmed selection treated as authoritative | Closed | Spec §3.7, line 85, requires the last authoritative value/chips, automatic refresh, reconciliation and stale-read Retry. Prototype `load('su')` (104) retains ambient; `write()` (162–168) no longer assigns the attempted value on unconfirmed and uses the existing warning. Its delayed callback models an unchanged refresh result; it does not demonstrate a different returned selection or failed reconciliation. Those outcomes remain implementation verification, explicitly required by spec line 85. Source `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:609–619` confirms refresh on unconfirmed and snapshot application on success. |
| R3 — Busy and focus contradictions | Partly | Spec §3.6 line 77 delegates to the explicit per-scope/per-account rule in §3.7 line 81. Prototype disables the busy scope (160), focuses its status (161–162), and uses per-account `a.busy` for detail controls (197, 203, 208–227, 234–235). This closes the disabled-control focus loss and conflicting detail actions. However, unconditional completion focus still interrupts independent work (new finding 2). Spec §5 line 99 and parity row 25 at line 136 also retain the old “focus stays on select” wording; §3.7 is the explicit controlling rule, so that editorial inconsistency alone is not a blocker. |
| R4 — Rename submits a stale value | Closed | Spec §3.5 lines 60/63 retains validation and refusal handling; Decision 14 at line 219 records the correction. Prototype `detail()` now reads the actual input and validates it inside submit (218–221); it saves `v.trim()`, not the earlier render-time value. Input validation and disabled Save remain at 223–225. Actual host refusal remains simulated rather than exercised. |
| R5 — Resume unavailable for signed-in bound runs | Closed | Spec §3.6 line 77 explicitly limits the notice to bound runs on a non-signed-in account. Prototype `detail()` line 206 uses `a.runs > 0 && st !== 'signed-in'`. Fixtures `nr` and `nu` (112–113) distinguish the two cases. This preserves inventory row 55 (`parity-inventory-p5.md:102`). |

## New findings

1. **Moderate — Removal silently assigns the existing login in the prototype.** Exact location: prototype `confirmDlg()` line 238, compared with spec §3.6 line 78 and §3.7 line 87. Start in `n4`, open Work account → Profile → Remove. The handler deletes the row and directly replaces each matching selection with `ambient`; `chips()` then presents that assignment as current. The written design requires an unavailable selection until the host reports the new selection. The existing state owner likewise says removal changes selection only through the committed snapshot (`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:274`) and applies the returned snapshot at line 619. A host-confirmed omitted/ambient result is valid; hard-coding that outcome in the removal handler is the discrepancy. Preserve the last named selection until a separately modeled authoritative result, or explicitly model the removal response snapshot. Also have `sel()` recognize any absent named target, rather than only the literal `missing` at prototype line 157. This affects parity rows 15, 21, 35 and 67; it is not a newly requested removal or a claim that production currently reroutes incorrectly.

2. **Moderate — Completion steals focus from newer work despite independent controls remaining enabled.** Exact location: prototype `write()` line 167 and `render()` lines 125–126; related unconditional detail targets in `signIn()`/`act()` at 234–235; spec §3.7 line 81. Start a selection write, then focus the other select or open the add form before its 700 ms timer finishes. Completion assigns `pf` to the originating select. `render()` prioritizes that target over the currently focused control, interrupting the newer interaction. This is reachable precisely because the revised busy policy keeps the other controls usable. Refine the written focus rule and prototype: restore focus only if it is still on that operation's waiting target, with the originating view still active; otherwise preserve the user's current focus and announce completion. This is the remaining R3 gap, affecting parity rows 25/68. No runtime interaction test was run; the finding follows directly from callback order and focus-target precedence.

## Parity and requested behavior

All 74 inventory rows have dispositions in spec §6 (lines 112–185). No additional capability removal is hidden in that table. Rows 1–10 retain the moved shell, Electron gate, reads and feedback; 11–25 map routing and chooser behavior to selects; 26–38 map the ambient/named list; 39–43 retain add; 44–70 retain detail operations and outcomes except approved removals; 71–74 retain connection-drawer behavior. The two discrepancies above concern the demonstrated behavior, not absent disposition rows.

The four user requests remain represented: Accounts is inside the Claude drawer (spec 11/21; prototype 131–136); one existing-login account row replaces duplicated cards (spec 12–13; prototype 143–152, 176–179); unsigned-account Manage opens Access (spec 14; prototype 181); UUID/owner displays are removed (spec 16, 145, 162–164; prototype account/detail renderers at 180–228). D40-approved atomic-default, Verified identity and UUID-suffix removals are not reopened (`decisions.md:237–241`).

Minor prototype-only cosmetics do not block approval where the written spec is correct. Revision-title leftovers, documented screenshot artifacts and approximate mock validation copy are not grounds for this verdict (spec 3/220). Native Electron selects, actual focus trapping, assistive-technology announcements and theme rendering remain unverified as already disclosed at spec line 104. The mock's immediate-success add/rename/remove handlers are not evidence of real host failure handling.

## Five logic questions

1. **Silent success-looking failure:** unconfirmed selection now retains authoritative values (spec 85; prototype 166). Removal still claims an ambient assignment without representing the host result (finding 1).
2. **Unexpected user action:** moving to another usable control during a write causes focus to jump back on completion (finding 2).
3. **Wrong answer from input data:** omitted selections are corrected (prototype 90/105). A removed named target needs general absent-target handling; the mock only recognizes its fixture sentinel (157/238).
4. **Dependency failure or timeout:** the design requires unknown ambient status, stale snapshots with Retry and automatic unconfirmed-write refresh (spec 47/85/88/199). The mock represents selected outcomes, not a live backend or out-of-order transport replies.
5. **Unmentioned requirement:** independent controls need operation-aware focus restoration when the user moves on (finding 2). This is an accessibility implementation detail, not a new product-scope constraint.

## Lane-introduced constraints

- Existing disclosed choices remain: Accounts as the second tab, in-drawer detail, inline add and native selects (spec 191); trimmed case-insensitive uniqueness and reserved ambient name (192); read-only ambient row (193); modal removal confirmation (218). D40 supplies the underlying uniqueness and ambient-read decisions.
- The refined per-scope/per-account busy policy is a lane choice (spec 81); it must preserve independently started interactions, as described above.
- No new count cap, automatic sign-in, Advanced tab or unapproved removal is introduced (spec 195/203/213).
- This review adds no routing policy or backend capability. Its corrections require the demonstration to follow the existing authoritative-snapshot contract and avoid interrupting newer focus.

## Decisions

- **Use §3.7 as the controlling busy policy.** Options: follow its explicit single rule, or retain the older “focus stays” shorthand. Evidence: spec 81 and Decision 14 at 219 explicitly supersede the previous policy. Chosen: §3.7. Reversible editorial reconciliation; no user decision needed.
- **Treat R2's unchanged mock refresh as one valid scenario, not full reconciliation evidence.** Options: accept the modeled unchanged result or demand every backend outcome in this design prototype. Evidence: prototype 166–168 preserves the snapshot, while spec 85 requires success/failure reconciliation. Chosen: close the original false-assignment finding and retain implementation verification. Reversible; no claim of a tested host read.

## Scope, evidence and score

Read the revised design and prototype source, R1 review, 74-row inventory and D39/D40; spot-checked the named source contracts. No source, input artifact or task-state changes; no git, builds, tests or Electron runs. `ptah_ast_analyze` does not support HTML, so the prototype was read natively. The deliverable-scoped `ptah_get_diagnostics` returned unavailable: Markdown could not be checked (0 files analyzed), not a passing implementation check. This is a design-artifact review, not approval of the underlying implementation.

The dedicated ambient-status read and host-enforced unique names remain necessary backend additions (spec §8, lines 199–200). CLI presence cannot substitute for authenticated state (spec 50). These agreed implementation needs do not themselves block the design gate.

8/10: the main routing errors are corrected and parity is explicitly mapped, separating this from the 5–6 band of substantive requirements gaps. The remaining demonstrated routing/focus discrepancies and unverified native interactions prevent a 9–10 assessment. Counts: 0 blocking-severity findings, 0 serious, 2 moderate; 2 distinct failure modes. Recommendation: REVISE.

## Open items for the user

The revision cap is reached. The spawning session should present the two remaining behavioral discrepancies for a gate decision: **carry findings 1–2 as explicit required corrections before accepting the implementation (recommended)**, or explicitly accept these prototype discrepancies and proceed from the written host-selection contract with the focus limitation recorded. No D39/D40 removal needs another decision. No further design-review round was started by this reviewer.
