# Decisions - TASK_2026_700_dcce

| # | Date | Decision | Source | Evidence |
| --- | --- | --- | --- | --- |
| D1 | 2026-10-19 | Design (`design-spec.md`, `prototype/`, 19 screenshots) approved at Gate 1.7. | user | "approved" after `design-spec-review-r2.md` APPROVE (0 Blocking, 0 Serious) |
| D2 | 2026-10-19 | Child sessions are in scope: Ptah agent child sessions linked by `parentSessionId` (`kind: 'child'` nodes in `model/work-projection.ts`). | user | Scope addition via peer session; interpretation shown at Gate 1.7 and not contested |
| D3 | 2026-10-19 | Add the proposed "Open tab" button on the selected card of a child session when `tabId` exists (new button + coordinator route). It replaces the "Live tab available" text (M2). With no `tabId`, show no button. | user | "for the proposed addition add that button" |
| D4 | 2026-10-19 | Fix review-r2 Moderate items in the implementation, not in another design round: M1 context ring orange only at the header warning threshold (>= 70%); M2 per D3; M3 Crucible plate must not cover its sphere at 900px; M4 tether from a child-owned lane to its child, owned-lane plate anchored to its sphere, child kind glyph on plate and rail row. | user | "use your recommendation" |
| D5 | 2026-10-19 | Deleted the one-off `revise-spec.js` (it rewrites the spec with outdated round-1 text). Kept `prototype/*.js` helpers; `build-prototype.js` uses `revise-prototype.js`. | orchestrator | Script body sets the 330px rail limit that round 2 removed |
| D6 | 2026-10-19 | `design-spec-review-r1.md` is the peer session's round-1 review (same three Serious findings as this session's reviewer, different IDs). | orchestrator | `design-revision-2.md` cross-reference table |
