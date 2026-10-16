# Gate 1 requirements review — TASK_2026_677_efcd

**Verdict: REVISE — 5/10.** The requested clean turn, inspector, chips, motion, carry-over map, bundle limit, Angular conventions, themes, accessibility, backend gate and existing-check requirement are present. The spec still leaves material behavior unresolved. This is above a foundational failure because the main surfaces and all 40 T1 IDs are mapped, but below a sound 7/10 because two required behaviors cannot yet be implemented or judged consistently.

## Findings

1. **Serious — The retained presentation switch has no defined result.** `task-description.md:47` says the architect will define what each mode shows, while `:58-60` puts the clean turn in the transcript and `:364-365` requires a condensed and detailed presentation. `parity-inventory.md:25-30,40` preserves the toggle and maps the old compact card to the clean turn. A user can switch modes, but no acceptance criterion says whether either mode shows the live work log, completed answer, inspector, or existing transcript features. **Fix:** Define the observable content and controls in both `full` and `compact`, including how the clean turn appears in each and what the toggle changes, before handing the spec to implementation. Keep the toggle until a user decision authorizes removal.

2. **Serious — Duration persistence conflicts with an acknowledged missing source.** `task-description.md:100-115` requires a running timer, a stable completed duration after reload, and a `Worked` fallback when the start cannot be derived. `decisions.md:13` records that no live turn start time exists today. Without a defined durable start/end source, a turn can show `Worked for ...` during this session and `Worked` after reload, violating `task-description.md:114-115`. **Fix:** Name the existing durable fields and the exact derivation rule for start/end and delegated work, including reload; or change the reload criterion to permit `Worked` when the duration cannot be recovered. State how zero-activity turns and still-running agents are timed.

3. **Moderate — T1-27 and T1-28 can be skipped by the conditional criterion.** `reference/pr730-followup-map.md:50-51` lists both as T1 work, and `task-description.md:68,351-352` maps them in scope, but `task-description.md:166-168` applies the criterion only *when* `subagent-tile.component.ts` is changed. An implementation that renders a new chip without touching that file could claim completion while leaving both issues. F6-F12 are also unnamed, so completion cannot be checked from this document. **Fix:** Make the two fixes unconditional T1 criteria and enumerate the observable F6-F12 outcomes or cite a precise, available review section for each.

4. **Moderate — A kept user-turn capability has no explicit acceptance criterion.** `parity-inventory.md:61` marks the timestamp and sender (`You` or peer) as keep; the code renders them in `message-bubble.component.html:197-213`. `task-description.md:137-146` tests attachments, peer warning, compaction and branch/rewind, but never says to retain the timestamp and ordinary sender label. The catch-all parity rule at `:360-361` names reachability, not their visible values. **Fix:** Add a user-turn criterion for the displayed time and sender, including the peer label and accessible time representation.

5. **Moderate — Two inventory citations cannot substantiate their claimed capability.** `parity-inventory.md:92` locates composer controls in `chat-view.component.html` “below :190”; `chat-view.component.html:244-247` only mounts `<ptah-chat-input />`, while `:190-242` is the queued-content indicator. `parity-inventory.md:107` cites a commit for deferred Rail details rather than a file:line. **Fix:** Cite the actual `ptah-chat-input` implementation lines for input, attach, approval, model, effort and send/stop; cite the current Rail host line containing `@defer`. Keep the inventory's claimed test coverage separate from a source citation.

6. **Minor — T1-01's mapping narrows “tiles” to chips without stating equivalence.** `reference/pr730-followup-map.md:24` requests CLI-agent and sub-agent *tiles* in the main view, but `task-description.md:150-165,345` maps it to one small chip per agent and an activity row. That may fit the screenshot, but the criterion does not say whether the expanded row supplies the tile's detail and open action. **Fix:** State that the chip plus expanded activity row satisfies the main-view tile request, and specify which tile information remains available in each state.

## Parity and citation audit

The inventory has A (mode and compact card), B (message bubble, including header, badges, copy, fork, rewind, attachments and compaction), C (stats strip, background tray, compaction, permission badge and question cards), and D (Canvas Rail details aside). The T1 table at `task-description.md:341-354` assigns every T1-01 through T1-40; the five spec-only items deferred in `:50,80` match `reference/pr730-followup-map.md:33,36,39-41`. No additional T1 item was found unmapped. The deferral reason is the user's postponed new spec work (`context.md:37-38`).

Spot-checks against this worktree: A-10/A-12 match `compact-session-card.component.ts:479-534`; B-2/B-4 match `message-bubble.component.html:39-88`; B-10/B-11 match `message-bubble.component.html:158-182`; B-16/B-17 match `message-bubble.component.html:197-235`; B-19/B-20/B-14/B-15 match `message-bubble.component.html:274-345`; C-2/C-6/C-7/C-8 match `chat-view.component.html:35-76`; C-15/C-16 match `chat-view.component.html:165-183`; D-2 through D-9 match `canvas-session-details.component.ts:111-178`. C-18 and D-10 need the citation corrections in finding 5. This was a targeted citation audit, not a full code review or execution check.

## Removals listed for the user

`parity-inventory.md:110-122` lists every `remove-proposed` row in the table: B-4 tool/file counts, B-8 collapsed cost badge, B-11 per-message token/cost badges, B-14 Branch conversation, and B-15 Rewind file changes. `task-description.md:82-83,145-146,360-363` requires them to remain until the user decides. No removal is approved here.

## Five logic questions

1. **Silent success:** A mode toggle could appear to work while showing an undefined second presentation (finding 1).
2. **User action:** Switching modes or reloading a completed timed turn can change or lose expected information (findings 1-2).
3. **Wrong answer from data:** A completed turn with no durable start time can acquire an unsupported elapsed duration (finding 2).
4. **Dependency failure or malformed data:** Request response failure and unparsable todos have explicit retry/fallback criteria at `task-description.md:248,264-265`; their underlying implementation remains unverified at this gate.
5. **Missing from requirements:** The ordinary user-turn timestamp/sender and a definitive presentation contract are not stated as testable acceptance outcomes (findings 1, 4).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat T1-10/13/16/17/18 as deferred test-only work, not a missing T1 implementation. | Include new specs now; defer them. | `context.md:37-38`; `task-description.md:50,80,347,350,354`; `reference/pr730-followup-map.md:33,36,39-41`. | Yes. |
| Keep the five proposed removals pending user choice. | Remove them now; retain pending decision. | `parity-inventory.md:15-16,110-122`; `task-description.md:82-83,360-363`. | Yes; removal is user-reserved. |

No checks were run; this gate reviews documents and cited code only.
