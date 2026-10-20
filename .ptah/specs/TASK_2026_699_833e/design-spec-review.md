# Design Spec Review — TASK_2026_699_833e

Author: Claude ui-ux-designer subagent  
Reviewer: codex  
Revision: 3  
Rounds: 3 (cap reached)  
Verdict: REVISE

## Findings

1. **Moderate — the 5-hour status card remains interactive.** The helper produces a plain card only for kinds other than `plan-window` (`prototype/index.html:208-222`). The 5-hour unknown-status call omits `kind`, so the default `plan-window` branch gives it a disclosure button, chevron, `aria-expanded`, `aria-controls`, and a panel (`prototype/index.html:210,218-222,238-240`). The click handler opens that panel (`prototype/index.html:304-308`). This contradicts the revision 3 rule for non-interactive `status` cards (`design-spec.md:17-20,112`). Pass `kind='status'` to that call and verify its rendered markup.

## Scoped checks and history

- **Round 2 Finding 1 — resolved.** The handle is `left: 0; width: 12px` in a zero-width slot (`prototype/index.html:91-97`), matching the revised handoff (`design-spec.md:9-16,80`). The transcript scrollbar occupies the main pane's right edge (`chat-transcript.component.css:36-44,75-78`); the target starts at the dock edge. The inspector header has `pl-4` (`session-inspector.component.html:12`), and the prototype header and sections have 16 px left padding (`prototype/index.html:123-128`), leaving the target clear of their content. The slot consumes no width, preserving `dockMax = shellWidth - 624` (`design-spec.md:16,94-100`; `prototype/index.html:95,264-270`).
- **Round 2 Finding 2 — partly resolved.** The local-usage call passes its kind and takes the plain-card branch (`prototype/index.html:211-216,248-249`). The click selector applies only to disclosure buttons (`prototype/index.html:304-308`). The 5-hour status call remains expandable (Finding 1). The spec says the `strip` variant is untouched (`design-spec.md:108-112,127-128`); the prototype has no strip rendering.
- **Round 1 findings — resolved in round 2.** The zero-width slot restored the exact width floor; the visible rest grip and actual focus outline met the documented contrast thresholds (`design-spec.md:22-36,138-140`). Revision 3 does not change those values.

## Five logic questions

1. **Silent failure:** An omitted `kind` silently selects the interactive branch (`prototype/index.html:210-222,238-240`).
2. **User action:** Clicking the 5-hour status card opens a panel despite the static-card rule (`prototype/index.html:238-240,304-308`; `design-spec.md:112`).
3. **Input data:** Unknown usage represented as status exposes the wrong branch; explicit local usage takes the static branch (`prototype/index.html:238-249`).
4. **Dependency failure:** Revision 3 changes only static geometry and card markup. Host persistence and dependency failure behavior remain outside this scoped review; stored-width clamping remains in the handoff (`design-spec.md:99-100`).
5. **Unstated case:** A future status-like caller that omits `kind` will receive disclosure semantics because `plan-window` is the default (`prototype/index.html:210-222`).

No build, test, serve, Electron launch, or git operation was run. Static screenshots cannot prove hit testing or card interaction. No new defect was identified in the dock-side handle change.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| REVISE at the round cap | APPROVED / REVISE | The status example still opens a disclosure (`prototype/index.html:210-222,238-240,304-308`) against the explicit rule (`design-spec.md:112`). | yes |
