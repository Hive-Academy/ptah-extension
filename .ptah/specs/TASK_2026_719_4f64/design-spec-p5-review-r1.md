REVISE — 8/10

Reviewer: codex / Author: claude

Gate 1.7, revision round 1. Reviewed revised spec, prototype source, compare.html, D39/D40, prior review and inventory mapping; inspected sheet1 and sheet5. Targeted source reads confirmed selection and unconfirmed-write semantics. No source edits, git writes, builds, tests, or browser interaction runs. Only this deliverable was written.

The requested drawer placement, account presentation, Access-first account Manage, and noise removal are retained. D40 settles the atomic-default, Verified identity, and UUID removals; these are approved user decisions and are not reopened. Most previous findings are closed. Remaining blockers concern selection semantics and disagreement between the spec and prototype, not the approved removals.

## Previous findings 1–8

| Finding | Status | Evidence and assessment |
| --- | --- | --- |
| 1. Unsupported ambient Connected state | Closed at design level | §§3.2, 8.1 and Decision 5 require a dedicated read, distinct connected/signed-out/unknown results, local Checking state, timestamps, forced refresh and no CLI-presence inference. `ambRow()` and a1–a4 model these states. Backend implementation is explicitly pending, not claimed to exist. |
| 2. Atomic default removal without decision | Closed | D40.2 and Decision 4 explicitly remove the one-step both-scope operation. The design acknowledges that no atomic action remains. |
| 3. Incomplete parity/failure mapping | Partly closed | §6 now lists all 74 rows. Loading, stale reads, list run counts, unavailable choices, feedback and refusal states have locations. §3.7 nevertheless changes omitted/unconfirmed semantics; see R1–R2 below. Busy behavior conflicts across sections and prototype; see R3. |
| 4. Unavailable manual fallback | Closed | §3.6, §8.3, Decision 8, `fallbackBlock()` and pending Access restrict the script to a host-provided response for the pending operation. No unconditional terminal-fallback link or fabricated executable command remains. |
| 5. Unsupported tab/layout constraints | Closed | §2 and `drawer()` keep full existing tab labels, add only Accounts, omit Advanced, and support wrapping. Sheet5 demonstrates narrow reflow. Existing bodies and connection-tab reset are preserved. |
| 6. Accessibility gaps | Partly closed | §5 and `tabs()` add roving tabs, arrows/Home/End, associations, heading focus, text-node rendering and a focusable script. Add/back/removal return-focus targets are specified. The native drawer/confirmation trap and screen-reader order are honestly unverified. Prototype pending selection loses focus while disabled; see R3. The late focus edit is not itself a blocker. |
| 7. Add workflow/cap/validation | Closed at design level | §3.5, §8.2 and Decision 7 preserve add-only persistence, open Access, never auto-select or auto-sign-in, remove the count cap, require host-enforced unique names and reuse the real validator. Prototype validation is explicitly illustrative. A separate rename interaction bug remains in the mock; see R4. |
| 8. Overconfident outcomes/copy | Partly closed | §4/Decision 10 remove Nothing was changed; failures use safe outcomes and labels/scripts use text nodes. Unconfirmed-write assignment chips still overstate the known state (R2). The prototype also displays an unconditional resume-unavailable notice for running accounts (R5). |

## New findings

1. **R1 — High: omitted selection is incorrectly classified as unavailable.** Location: §3.7 “Stored selection unavailable (named account gone, or omitted/unsupported)”; §6 rows 15/21. `omitted` is a supported wire value, not a missing named account (`provider-account.types.ts:214–220`). Current `accounts-section.component.ts:720` presents non-named selections as the existing login; the inventory likewise distinguishes omitted/ambient from unavailable named selections. The revised copy says Nothing is used until you choose one, which invents a new restriction for a never-configured scope. Preserve omitted/default resolution without writing an implicit selection; reserve unavailable presentation for an actually missing named target or invalid value. Add an explicit omitted fixture so a new workspace follows the intended S1 experience. Do not change routing behavior to match this mistaken copy.

2. **R2 — High: unconfirmed writes overwrite displayed authoritative selection and assignment chips.** Location: §3.7 Unconfirmed, §6 rows 21/23/70; prototype `load('su')`, `write()` unconfirmed branch and `chips()`. The mock sets `S[scope]=val`, so Used for immediately claims the account is assigned despite an unknown result. The spec also asks the user to reload, rather than preserving the existing automatic reconciliation. `provider-accounts-state.service.ts:610–612` settles unconfirmed and starts a refresh; current copy is “This action may not have completed. Accounts were reloaded.” Keep assignment chips and current selection based on the last authoritative snapshot, distinguish any attempted value as unconfirmed, and update from the automatic re-read. Show Retry if that read fails. Correct the spec and mock together; warning text alone does not make an unconfirmed assignment authoritative.

3. **R3 — Medium: action-busy and focus behavior are contradictory.** Location: §3.6 (all actions disabled while any action is in flight), §3.7 (only one select disabled, other remains usable), §6 row 68; prototype `sel()`, `write()`, `detail()` and `act()`. The spec needs one precise rule separating per-scope selection writes from account-detail writes. In the mock, Sign out, Cancel sign-in and Check status remain actionable during `busy`, unlike the inherited detail behavior. `write()` destroys the focused select and attempts to focus its disabled replacement, so “focus stays on that select” is not demonstrated while pending. Define and model a stable focus target during pending work, restore it on completion, and disable the intended conflicting actions. Keeping the other independent scope usable can be reasonable, but must be explicit rather than simultaneously claiming every action is disabled.

4. **R4 — Medium, prototype-only: rename submission uses a stale value.** Location: `detail()` Profile form, `const ev=renameVal||a.name`, submit closure and input handler. Typing updates `renameVal` and enables Save, but submit reads `ev` and `er` captured when the form was rendered. A newly typed valid name can therefore save the old name and announce Name saved. Recompute the value and validation at submission (and retain the typed value on refusal). This is unrelated to the acknowledged approximate safe-label rule. It undermines the claimed interactive rename example, though the written design's rename behavior is correct.

5. **R5 — Low: prototype resume notice is shown for every account with active runs.** Location: `detail()` Overview, `a.runs>0 && ... 'Resume unavailable: a bound run cannot be resumed after the account changes.'`; fixture `nr`. The fixture is signed in, yet shows Resume unavailable. Inventory row 55 limits the notice to bound work whose account is not signed in; §3.6 correctly says “when applicable.” Model that condition and avoid implying that every account change, including rename, prevents resume. The ordinary running-work explanatory text can remain.

## Parity assessment

All 74 numbered inventory capabilities now have an explicit disposition in §6. No numbered row silently disappears. The missing fixture/reachability work and unchanged lane/session-label consumers are also acknowledged. Rows marked removed match the D39/D40 decisions; UI mechanics such as chooser dialogs and the separate detail drawer are mapped to replacement controls/views.

Disposition coverage is not yet behavioral parity: rows 15/21 contain the omitted-selection regression, rows 21/23/70 the unconfirmed-state mismatch, row 68 the busy-rule conflict, and row 55 the prototype-only resume condition mismatch. Rename row 65 is correctly specified but not correctly simulated. General add/action refusal and pending behavior is specified more fully than demonstrated in the mock; implementation must follow the written host-result contract rather than copy its immediate-success handlers.

## Backend contract assessment

§8.1 is sufficiently concrete for the design gate: dedicated read-only probe; connected/signed-out/unknown union; ISO checkedAt; UI-only Checking; bounded timeout; short cache with forced refresh on entry and Check again; failure maps to unknown; no stale positive relabelled as a fresh check; no raw output, identity, class, paths or credentials. §3.2 explicitly forbids using CLI presence or selection as authentication evidence. Reusing a named-route method with a fake account is explicitly forbidden.

Implementation should set checkedAt to the completed probe attempt, key cached results to the effective ambient environment, and ignore stale/out-of-order replies across refresh or host/workspace changes. Exact timeout/cache duration and transport name can be settled during backend implementation; their absence is not a design blocker. Probe the effective login used by the host, without weakening named-route guards. Host-side unique-name enforcement is separately required by D40; the UI-only check is correctly described as convenience.

## Designer caveats

- **Stale sheet4:** not a blocker. The spec identifies the stray false text and bad zoom attempt, and sheet5 supplies replacement reflow evidence. Do not use sheet4 as acceptance evidence for those cases. `h()`/`A()` now omit false children.
- **Late focus edit not re-rendered:** not a blocker by itself. Screenshot evidence cannot establish keyboard behavior. The declared unverified native drawer/modal trap, screen-reader order and native Electron select rendering remain implementation verification work. R3 is a concrete source-visible issue, separate from this caveat.
- **Approximate prototype label validator:** not a blocker. §3.5 and Decision 13 explicitly require `isSafeProviderAccountLabel` in production. Keep the shared validator/limit and host uniqueness enforcement; do not treat the mock's regular expression or unsafe-label copy as the source of truth.

## New lane-introduced constraints

- Treating omitted selection as unavailable introduces an unauthorized requirement to choose an account before use. Remove it (R1).
- Case-insensitive trimmed uniqueness and reserving Existing Claude login refine the user-approved uniqueness requirement. These are disclosed in §7; they are reasonable implementation choices, not new user requests.
- Removal confirmation changes from inline confirmation to a modal (§3.6, Decision 12). This is a new interaction choice, not a D39/D40 requirement. It is acceptable if the native drawer and modal focus traps cooperate; retain the stated Electron verification item.
- Pending writes independently disabling one scope is a new behavioral refinement that needs an internally consistent busy policy (R3), not another user permission round.
- No new count cap, automatic sign-in, Advanced tab or unapproved capability removal is present.

## Remaining open items

Before Gate 1.7 approval, correct omitted and unconfirmed selection semantics in both spec and mock (R1–R2), reconcile pending-action/focus behavior (R3), and repair the prototype rename and resume examples (R4–R5). Retain the now-complete parity table and settled D40 removals.

Backend ambient probing and uniqueness enforcement remain implementation work, not claims of existing functionality. Electron native selects, nested confirmation focus trapping, screen-reader announcements and real theme rendering remain scoped implementation/visual validation. This review did not execute those checks.
