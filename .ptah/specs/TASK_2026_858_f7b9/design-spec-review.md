# Machines view design review

Verdict: APPROVED

## Round 1 re-review

Verdict: APPROVED

1. **S1 — Resolved.** `design-spec.md:38-40` specifies a Machines tab and route without local folders; prototype states 10 and 10b show both the welcome route and the Machines view.
2. **S2 — Resolved.** `prototype/prototype.css:155-156` hides only the provider label; `prototype/prototype.js:34-40` names every Open button, and `screenshots/11-narrow-400-list-dark-and-light.png` shows the buttons at 400px.
3. **S3 — Resolved.** `design-spec.md:17,24` and `prototype/prototype.css:13,25` use the glass-theme box and button radii confirmed in `apps/ptah-extension-webview/tailwind.config.js:265-267,310-312`.
4. **S4 — Resolved.** `design-spec.md:99` and prototype state 7c use a neutral Phase 1 denial with a worker-side grant check; approval-scope copy is expressly Phase 2 only.
5. **S5 — Resolved.** `design-spec.md:109-113`, prototype state 9 and `screenshots/09-local-driver-dark.png` show an opened transcript, answerable approval, owner indicator and disabled composer.
6. **M1 — Resolved.** `design-spec.md:61-65` and `screenshots/03-pairfail-light.png` distinguish retrying an open window from opening a new one after it closes or expires.
7. **M2 — Resolved.** `design-spec.md:115-116`, `prototype/prototype.js:269-272` and the revised 400px capture show the active Machines tab in view.
8. **M3 — Resolved.** `design-spec.md:178-182` keeps only the unsettled policy choice of displaying the exact remaining-attempts count; the requirements settle the three removed questions (`task-description.md:157-165,296-299,397-402`).
9. **M4 — Resolved.** `design-spec.md:89-99` and prototype states 6, 7 and 7b keep multi-client and first-answer-wins copy in the explicitly labelled Phase 2 example.
10. **D14 — Supported.** `design-spec.md:24,174` uses theme radii for controls and large containers and `rounded-md` for dense inline items; `session-list-row.component.ts:160-168,199` provides the cited precedent, and prototype CSS follows the split.
11. **Clarification cut — Supported.** `design-spec.md:178-182` leaves a real, unsettled security-copy decision about the attempts count and resolves the other questions from the approved requirements.

No new Blocking or Serious item was found.

## Blocking

None.

## Serious

None open. S1-S5 from the original review are resolved above.

## Minor

1. **New: no-folder count and list disagree.** `screenshots/10-no-local-folder-dark.png` says “Machines (1 connected),” but `screenshots/10b-no-folder-machines-light.png` shows four machines with no Phase 2 label. Align the count and rows for the Phase 1 example, or label the four-machine view as Phase 2. This does not prevent implementing the specified no-folder route.

## Checks

1. Phase 1 states and scope: **Pass** — the revised local-driver state completes the required session UI; the Phase 2 approval example is labelled, and no out-of-scope feature UI was added.
2. Tokens and patterns: **Pass** — theme radii now match the cited tokens; D14's smaller inline radius has source precedent.
3. Navigation placement: **Pass** — the no-folder tab and content-route rule address the existing shell guards, with prototype states 10 and 10b.
4. Accessibility: **Pass** — the narrow Open actions and active tab are visible; documented keyboard, focus and text-labelled status rules remain. Contrast figures were reviewed as design claims, not independently measured.
5. Security wording: **Pass** — Phase 1 denial stays neutral, pairing failures do not distinguish code causes, and no token value is shown.
6. Clarifications: **Pass** — only the exact attempts-count policy remains for the user.
7. Project rules: **Pass** — Electron-first design; no implementation, verification command, build, serve, dev, e2e, package target or git mutation was run. The revised HTML was rendered in the Ptah browser and compared with the new dark/light screenshots; this was a prototype review, not an Electron app review.
