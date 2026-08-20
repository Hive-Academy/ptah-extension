# TASK_2026_167 — Discourse: Brand Theme + In-App Community Surfaces (A + B)

Builds on TASK_2026_165 (seamless SSO + one-click Community login, committed 061a19ab7).

## Type / Workflow

- **Type**: FEATURE (A: theme + SSO polish; B: in-app community surfaces via API)
- **Workflow**: Partial. 3 specialists in parallel → code-logic-reviewer + visual-reviewer → verify → commit.

## Scope

### A — Brand theme + SSO polish

- **A1 (backend)**: add `suppress_welcome_message=true` to the DiscourseConnect SSO payload (`discourse-sso.service.ts` `buildResponse`) so first-login users skip Discourse's onboarding PM. NOTE: the user model has NO avatar/profile-picture field (verified in prisma schema) — do NOT add `avatar_url`; note the omission.
- **A2 (theme artifact)**: a git-backed, Ptah-branded Discourse theme package in-repo (`discourse-theme/`) — `about.json`, `settings.yml`, `common/common.scss`, a dark color scheme, favicon/logo hooks, header link back to ptah.live — plus a dev-apply path (rails runner against the dev `discourse_dev` container) and a README. Must match brand tokens below.

### B — In-app community surfaces (read-only, proxied)

- **B1 (backend)**: `GET /api/v1/community/summary` (authenticated) returning latest forum topics, proxied through the license server using the existing `DiscourseAdminProvider` REST pattern (browser NEVER sees a Discourse key). Feature-off (DISCOURSE\_\* unset) → `{ communityUrl: null, topics: [] }`.
- **B2 (frontend)**: a "Community activity" widget on the members page Community card (`members-page.component.ts`) listing the latest topics; each topic opens via the one-click SSO deep-link.

## Contract (B1 ↔ B2)

`GET /api/v1/community/summary` →

```
{
  communityUrl: string | null,
  topics: Array<{
    id: number, title: string, slug: string,
    postsCount: number, lastPostedAt: string | null,
    categoryName: string | null
  }>   // max 5, newest first; [] when feature-off or on any Discourse error (never 500)
}
```

Frontend builds each topic's open URL as the one-click SSO deep-link to that topic:
`${communityUrl}/session/sso?return_path=${encodeURIComponent('/t/' + slug + '/' + id)}`

## Brand tokens (for A2 theme)

- Background: `#08090c` (base), `#0e1015`, `#12141a`; borders `#171a21`/`#262a33`.
- Text: `#e9ebef` (primary), `#b7bdc9` (muted).
- Accent/primary: amber `#f5a524`; hover `#c97e0e`; bright accent `#ffbb4d`.
- Success `#34d399`, warning `#eab308`, error `#fb7185`.
- Fonts: Inter (body), JetBrains Mono (code). Rounded ~0.5–0.75rem.
- Dark theme only (matches daisyui "operator").

## Standards

- Backend: TS strict, `catch (error: unknown)`, ConfigService (no process.env), Zod at boundary, non-throwing Discourse client (reuse DiscourseAdminProvider's tolerant pattern — errors → empty topics). No new vscode RPC (this is license-server HTTP, dual-registration rule N/A).
- Frontend: OnPush, signals/computed/inject, daisyui/Tailwind, lucide icons, no `[innerHTML]`, no hardcoded Discourse URL (derive from communityUrl), `rel="noopener noreferrer"`, hidden when communityUrl null.

## Deferred (from TASK_2026_165 review, not this task): DRY the ADMIN_EMAILS parser; Zod on /licenses/me client; Discourse admin audit trail. Prod droplet/env still pending.
