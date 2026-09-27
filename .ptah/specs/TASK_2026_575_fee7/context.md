# Task Context - TASK_2026_575_fee7

## User Request
"can you check our angular setup in our electron and landing page, as i basically want to make it bilingual with english and arabic as well, whats the best library as of Sep 2026 to use that support latest angular and best nx workspace practices for having per app/lib configurations"

Follow-up: "yeah lets do so, you can see there is a skills for orchestration on that repo can you follow the same workflow defined there to follow our flow. lets start with the landing page as its easier than the electron application"

## Task Type
FEATURE

## Complexity
Complex

## Strategy
FEATURE, Full depth: project-manager → [designer → prototype → Gate 1.7 for the language switcher + RTL treatment] → software-architect → team-leader → QA.
No separate research phase: library choice already settled in conversation (see below).

## CLI Lanes
Gate 0.1: no `ptah_agent_*` tools exist in this cloud session, so no CLI lanes are spawnable. Lanes disabled; every cross-side review runs same-side (subagent) with this recorded reason.

## Conversation Summary
Pre-work findings (orchestrator, read-only):
- Angular 22.1.7, Nx 23.2.1, TypeScript 6.0.3, Tailwind 3.4 + DaisyUI 4.
- `ptah-landing-page`: `@angular/build:application`, `outputMode: "static"`, SSG prerender of 6 marketing routes (`app.routes.server.ts`), rest client-rendered. Libs in `libs/web/*` tagged `scope:web`. `<html lang="en">` hard-coded. Fonts Inter + JetBrains Mono (no Arabic glyphs).
- Electron renderer = `ptah-extension-webview` bundle (also the VS Code webview), loaded via `loadFile` (file://). Out of scope for this task; the shared i18n lib must be reusable by it later.
- No i18n library in use today; only generator-default `extract-i18n` targets.
- Library decision: `@jsverse/transloco` (8.4.0, peer `@angular/core >=16`) — runtime switching, per-lib scopes (Nx-friendly), signals API, SSR/prerender support, keys-manager tooling. Rejected: `@angular/localize` (per-locale builds; bad for the shared webview bundle), `@ngx-translate/core` 18 (no scopes).

Gate 0 decisions (user, via AskUserQuestion):
1. URL strategy: **client-side toggle only** — same URLs, language chosen in the browser and remembered locally. No `/ar/` routes, no hreflang. Prerendered HTML stays English.
2. Scope: **whole landing app** — marketing, legal, auth (login/signup), account/profile, sessions, contact and admin screens, plus shared header/footer, across `apps/ptah-landing-page` and `libs/web/*`.
3. Arabic copy: **agents draft, user reviews** before merge.

## Gate decisions
- Gate 1: user replied "approved" to task-description.md revision 1 (review: task-description-review.md, round 1, APPROVED, same-side, open non-blocking N12/N13 handed to architect). Open questions (numbering system, legal governing-language notice) deferred to Gate 1.7.
- Gate 1.7: user replied "approced" (approved) to design-spec.md revision 2 + prototype (review: design-spec-review.md, round 2 of 2, APPROVED, same-side; open non-blocking N22/N23 handed to architect). The reply named no choices, so the designer's recommendations stand as the approved decisions, stated back to the user at approval time:
  - Numbering system: Western 0-9 everywhere, dates included (`ar-u-nu-latn`).
  - Legal pages: Arabic-only "English version governs" notice on terms/privacy/refund (design-spec §3.8).
  - Orchestrator replaced the user's real email in prototype/index.html with `member@example.com` and re-rendered the 10 affected screenshots (content-only change, no design change).
- Gate 2: user answered the A4 question with "lets file a new task for it and inlcude it in the same pr", raising no changes to implementation-plan.md revision 1 (review: implementation-plan-review.md, round 1, APPROVED, same-side; open non-blocking N12–N14 carried to team-leader). Treated as Gate 2 approval, stated back to the user at that point.
  - A4 remediation → TASK_2026_576_54d7 (status backlog, contingent). If the E2E English control run fails on stability, the team-leader activates TASK_2026_576 on this same branch/PR instead of asking again; if it passes, TASK_2026_576 is cancelled with evidence.
