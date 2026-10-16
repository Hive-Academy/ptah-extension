# Code Logic Review, items 11-17 (TASK_2026_681)

Review family: implementer codex, reviewer Claude. Scope: uncommitted diff vs HEAD 75ce4a6d1 plus the three new spec files, read in full for the touched components. No nx targets run (orchestrator checks already green).

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | NEEDS_FIXES |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 5 |
| Minor | 6 |

Score rationale: items 11, 12, 13, 14 and 17 are sound and match the parity table. Item 15 is correct on the happy path but incomplete. Item 16 changes what "compact" means for the main panel, and the change leaves the main panel's inspector half-wired (S1). That keeps the score under 7.

## Serious

### S1. Compact card in the main panel keeps the inspector mounted, but hides its toggle and its Answer target
- `chat-view.component.ts:1097-1103` (`hostsInspector` ignores `showCompactCard`), `chat-view.component.html:5-18` and `:301-313` (inspector markup stays under `hostsInspector() && shell.isOpen()`), `chat-view.component.ts:1013-1026` (`focusQuestionCard`).
- Scenario: the main panel (no SESSION_CONTEXT) has a tab with the inspector open (docked or sheet), and the user chooses Compact from the tab bar. `showCompactCard()` is now true, so the `ptah-session-header` (inspector toggle, dot, needs-you cue) and every `ptah-question-card` are destroyed. The inspector stays.
  - A docked inspector keeps taking width from the card, and its only open/close control (the header toggle) is gone. The inspector's own close button remains.
  - "Answer" on an inspector request row calls `focusQuestionCard`. It finds no `ptah-question-card`, waits 1 s, then calls `reportAnswerMiss`. The user sees an error on a normal action.
  - The new card sends "answer" to `openFullView()`, but the inspector path does not.
- Fix: derive `hostsInspector` from `!showCompactCard()` as well. That closes or hides the inspector, and the 'Answer' path stops offering a dead target. Alternatively route `answerRequested` to `expandToFullView()` when `showCompactCard()` is true, then focus the card after the view swap.

## Moderate

### M1. All retained transcripts are destroyed, not only the compact tab's
- `chat-view.component.html:8-90` (the `@for (tabId of transcriptTabIds())` sits inside the `@else`), `chat-view.component.ts:855-863` (comment now says Rail hosts "rebuild it when returning").
- When the active main-panel tab is compact, the template tears down every kept-alive `ptah-chat-transcript` (up to `RETAINED_TRANSCRIPT_CAP = 8`) while the retention service still thinks they are retained. Switching from a compact tab to a full tab rebuilds a long session from scratch and loses scroll position for every retained tab. Plan risk 6 accepted this for Rail card hosts, not for the main panel. The updated comment hides that scope change.
- Fix: keep the transcript region mounted but hidden (`[class.hidden]`) while the card shows, or at least record the cost as an accepted limitation in decisions.md.

### M2. In compact, the composer and all session banners are unreachable
- `chat-view.component.html:95-268` (everything in the `@else`).
- The composer is gone, so a compact tab cannot send a message.
  - Draft text is not lost: `chat-input.component.ts:899-901` saves on destroy and `:1743-1744` restores.
  - The queued-message Edit/Cancel controls are hidden.
  - A queue-restore signal (`chat-input.component.ts:1769-1775`) has no consumer while the composer is unmounted.
  - The auth-required banner (re-auth action), the resume banner, the budget banner and the compaction banner are hidden.
  - The card does not mirror them. A session that needs re-auth or a budget wrap-up shows "Done" or "Waiting".
- This follows from the user's decision on item 16, so it is not a defect in itself. Two cheap mitigations: show a one-line "needs sign-in" or "budget" state on the card, and say so in the PR text. Pending questions and permissions are covered by the callout. Unmatched permissions depend on `targetsTab`; this was not traced further.

### M3. `expandToFullView` change has no regression spec
- `chat-view.component.ts:2091-2096`. `chat-view.component.spec.ts:315` only mocks `toggleTabViewMode`; no test asserts it.
- The new guard (toggle only when the tab's `viewMode` is 'compact') is the fix for a forced card on a 'full' tab. Without it, the old code would flip full to compact. Nothing pins this. Add two cases: compact tab calls `toggleTabViewMode` once, forced+full tab calls it zero times.
- Behaviour check, answer to the focus question 1a. A forced Rail card never emits `expandToFull`, because `openFullView` routes to `cardActions.openSession()` (`compact-session-card.component.ts:585-590`), so the guard is a safety net. A user-chosen card emits, and chat-view toggles compact to full. The focus-header Compact/Full button calls `toggleTabViewMode` on the same `viewMode`, so both controls stay in sync. This is correct as written.

### M4. CLI token badge hides data when only one side or only a total is reported
- `inspector-agents-section.component.ts:344-346`.
- `cliTokens` needs both `inputTokens` and `outputTokens`. `CliOutputSegment.usage` (`agent-process.types.ts:420-433`) also carries `totalTokens` and `contextTokens`, and the old stats bar printed "Reported total". An adapter that reports only a total, or only input, gets no badge. That is "absent", not "zero", so it is honest, but it drops known data that the plan's "tokens" badge was meant to show.
- Zero is also inconsistent. A CLI row with in=0, out=0 renders a "0" token badge, while the non-CLI path suppresses 0 (`:340-342`).
- Fix: use `totalTokens` when present, else in+out when both are present. Suppress 0 like the sibling rows.

### M5. CLI cost shown as a known cost, though the source calls it an estimate
- `inspector-agents-section.component.ts:347`, `cli-lane-usage-summary.component.ts` (`formatEstimatedCost` gives "~$x est.").
- The same `usageTotals.costUsd` is labelled "Reported or estimated cost" in the lane. `ptah-cost-badge` renders it as an exact green success badge with a "$x.xxxx USD" title. Estimated values lose the estimate marker in the inspector.
- Fix: pass the `~` marker (as `inspector-session-stats` does with `provisional`), or label the badge title.

## Minor

- m1. `agent-card-header.component.ts:46`: `[class.!hover:bg-transparent]` is not a valid Tailwind 3.4 utility (the important marker goes after the variant: `hover:!bg-transparent`). The flat header probably keeps its hover tint. Check in the "after" screenshots.
- m2. `agent-card-header.component.ts:141-145`: elapsed uses `ml-auto` when `!cliSessionId`. In flat mode the id badge is hidden, but the condition still keys on its presence, so a lane with a session id and a non-running status leaves the elapsed unpushed. Key the class on `presentation() === 'card' && agent().cliSessionId`.
- m3. Flat mode drops `modelStats().totalTokens` ("Reported total") together with the up/down stats bar (`cli-agent-output.component.ts:44-80`). The usage row does not print `totalTokens` either. The user approved removing the duplicate bar, but this one datum is not duplicated elsewhere. Add it to the usage row or log it as accepted.
- m4. `compact-session-card.component.ts:466-477`: the `'Idle'` check is repeated, so the last two branches are dead code. The mapping also changes the Rail variant's status word (Idle to Done/Waiting) because `summary` is shared. Intended, but not in the plan; the rail specs pass.
- m5. In the canvas focus area the compact card repeats the title already shown in the focus header (`compact-session-card.component.ts:150-156`), and its "Full view" button duplicates the header's Maximize toggle. Not wrong, only redundant after the user asked for de-duplication in item 17.
- m6. `session-agent-roster.ts:21` imports `isUsageSegment` from a component folder (`molecules/agent-card/stats-bar.utils`) into a service. Style or layering. Route to code-style-reviewer.

## Answers to the focus questions

1. Item 16.
   - (a) Forced and header-toggle behaviour verified (M3). A forced card cannot flip a 'full' tab to compact through `expandToFullView` any more, and the header toggle stays consistent.
   - (b) State lost on entering compact:
     - scroll position and render caches of all transcripts (M1);
     - the composer (draft is persisted, so retained);
     - the queued-message controls and banners (M2);
     - question cards (the callout and `openFullView` cover the card path; the inspector path breaks, S1);
     - the streaming subscription is not lost, because the stream lives in the tab manager and the card samples it (`compact-session-card.component.ts:496`).
   - (c) The settled card shows the title, the status word (Done/Waiting), the reply and activity feed when marks exist, and status plus `summary().content.text` plus the stats row otherwise. Empty feed and lanes sections are hidden for the empty case (spec `compact-session-card.component.spec.ts:907-947`). It uses existing data only.
2. Item 17. The `card` presentation is behaviour-equal. Every new binding is a `[class.!x]="presentation()==='flat'"` that is false by default, and `@if (presentation()==='card' ...)` wraps the removed nodes. Flat is as intended:
   - no name badge, no chevron, no session id badge in the header;
   - the body renders through `presentation() === 'flat' || agent().expanded` (`agent-card.component.ts:~85`), so the store's expand state cannot collapse it;
   - the up/down stats bar is hidden;
   - the full session id is inside the Task details;
   - Stop/Resume, status, model, elapsed, the usage row and permission prompts remain.
   Silent removals beyond the table: flat drops `totalTokens` (m3), and the usage row's duration, in favour of the header's.
3. Item 14.
   - The panel root `[role="tabpanel"]` with `tabindex="-1"` is the first element of the host template, so `afterNextRender` finds it (`canvas-lane-view.component.ts:60-65, 279`).
   - Focus moves only when focus was already inside the host (`:274`). A lane opened from the lane strip (outside the host) gets no focus move, as before.
   - Escape binds on the host (`:50`) and `back()` restores the opener or the composer.
   - Selecting the orchestrator tab through the strip leaves focus on the panel, which is still in the DOM. Acceptable.
4. Items 11 and 12. `canvas-focus-area` was the only host of the header (grep), and its `[model]` binding is removed. The exact titles, `aria-label`s, `data-compact`, `data-header-menu` and the `ngDoCheck` hook are intact. Icon-only buttons keep names through `aria-label` and `title`.
5. Item 15. Usage segments are skipped and the activity text is correct. CLI duration is live while the lane runs (the section tick) and frozen at `completedAt`. A stopped lane without `completedAt` freezes at the last computed value. Non-CLI rows show no duplicate values because every new element is gated on `kind === 'cli'`. See M4 and M5 for the badge content.
6. Item 13. The multi-model path is still a `<button>` with the same click target, `aria-expanded`, `aria-controls`, focus outline and `keydown.escape`. Only the inner markup changed. There is no regression. The long single-model value has no `truncate` and wraps within a full-width tile, which is acceptable.
7. Regression specs. New or updated specs exist for: the card/flat header, `cli-agent-output`, the roster usage skip, the inspector badges, the Model tile, the compact card (settled and empty), the chat-view compact gate, the focus header, and the lane view. They would fail on the old code. Gaps: `expandToFullView` (M3), and nothing covers the inspector or the Answer path under compact (S1).

## Five logic questions

1. Silent failure: S1 (answer miss), M2 (a session needing sign-in looks "Done").
2. Unexpected action: choosing Compact in the main panel removes the composer and the keep-alive transcripts (M1, M2).
3. Wrong answer from data: a CLI lane reporting only totals gets no token badge (M4); an estimated cost is shown as exact (M5).
4. Dependency failure: not materially changed in these items.
5. Missing: a one-line status of auth, budget or queue on the compact card; a record of the keep-alive scope change.

## Verdict

NEEDS_FIXES. Fix S1 before merge, and cover M3 with specs. M1 and M2 can be recorded as accepted limitations if the user is told in the PR. M4 and M5 are small data-fidelity fixes.
