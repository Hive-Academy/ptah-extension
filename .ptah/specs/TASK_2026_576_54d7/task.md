---
id: TASK_2026_576_54d7
status: backlog
type: BUGFIX
title: Landing app reaches ApplicationRef stability with GSAP and Lenis animations running
description: >-
  Contingent follow-up to TASK_2026_575 (assumption A4). If the English control run of the i18n e2e suite shows the landing app never becomes stable because GSAP/Lenis/ScrollTrigger rAF loops run inside the Angular zone, move those loops outside the zone so the app-stable marker appears and hydration cleanup completes. Delivered on the same branch and PR as TASK_2026_575.
depends_on: [TASK_2026_575_fee7]
created: 2026-09-27T13:20:39.000Z
updated: 2026-09-27T13:20:39.000Z
---

## Description

TASK_2026_575_fee7 (landing page i18n) adds a `data-app-stable` marker set when `ApplicationRef.isStable`
first emits true, and its 3.6 e2e (no English flash / no hydration errors for Arabic visitors) depends on it.
Plan assumption A4: animation rAF loops started inside the Angular zone (GSAP ticker, ScrollTrigger,
Lenis smooth scroll, and per-component loops such as `falling-cubes-background`, `builders-section`
marquee, `comparison-tug-meter`, `pillars-spine`) may keep the zone busy forever, so the app never
becomes stable (NG0506 in dev) and deferred hydration cleanup never runs.

Trigger: the English control run of TASK_2026_575's E2E unit fails for this reason. If the control run
passes, this task is closed as `cancelled` (not needed), with the evidence recorded.

Scope when triggered:
- Diagnose which loops keep the zone unstable (evidence: NG0506 / `isStable` never true, with and without each source).
- Run those loops outside the Angular zone (`NgZone.runOutsideAngular`, or the library's own option in
  `provideGsap` / `@hive-academy/angular-gsap` if it has one), re-entering the zone only for state that must
  update bindings.
- No visual or timing change to any animation; existing landing e2e and unit tests stay green.
- Acceptance: `data-app-stable` appears on every prerendered route in production build within the e2e timeout,
  no NG0506, and the TASK_2026_575 3.6 English control + Arabic runs pass.

User decision (TASK_2026_575 Gate 2): file as a separate task, deliver in the same PR (branch
`claude/sleepy-turing-pdzxlm`).
