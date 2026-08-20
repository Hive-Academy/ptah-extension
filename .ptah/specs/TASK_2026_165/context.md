# TASK_2026_165 — Discourse Seamless Integration

## Type / Workflow

- **Type**: FEATURE
- **Workflow depth**: Partial (design pre-agreed with user in conversation; known scope, ~6 files)
- **Agent sequence**: backend-developer ∥ frontend-developer → code-logic-reviewer (SSO security) + senior-tester → verify → commit
- **CLI delegation**: disabled (focused, tightly-coupled change)

## User Request

Make the Ptah ↔ Discourse integration seamless:

1. **Auto-admin** — Discourse admin/moderator should be driven by the license server's existing `ADMIN_EMAILS` allowlist, asserted in the DiscourseConnect SSO payload (no manual `rails` promotion, self-syncing on every login).
2. **Expose `communityUrl` to all authenticated users** — currently only the Builders-gated `/members/sessions` returns it; add it to `/licenses/me` so every logged-in user gets the forum link.
3. **One-click "Community" login entry** from the landing page for all authenticated users → deep-link to `${DISCOURSE_URL}/session/sso?return_path=/` so the click lands the user already logged into the forum.

## Product decision (agreed)

Forum is **open to all logged-in Ptah users**. SSO already provisions any authenticated user; Builders additionally get the `builders` group (gated categories). Non-Builders get in, see public categories only. SSO-only stays (single identity source, entitlement integrity).

## Key integration points (verified)

- `apps/ptah-license-server/src/discourse/discourse-sso.service.ts` — `buildResponse()` builds the payload; add `admin` / `moderator` params.
- `apps/ptah-license-server/src/discourse/discourse.controller.ts:77` — resolves `isBuilders` + `name`; add `isAdmin` from `ADMIN_EMAILS`.
- `apps/ptah-license-server/src/admin/admin.guard.ts` — canonical `ADMIN_EMAILS` parse (comma-separated, trim, lowercase, fail-closed). Reuse this exact semantics.
- `apps/ptah-license-server/src/license/controllers/license.controller.ts:132` — `/licenses/me`; already returns `checkoutEnabled` + `memberGroups`, has `configService`. Add `communityUrl` (= `DISCOURSE_URL` trimmed, or null) to ALL return branches.
- `apps/ptah-license-server/src/google-sessions/members.controller.ts:93` — existing `communityUrl()` helper pattern to mirror.
- Frontend: `apps/ptah-landing-page/src/app/components/navigation.component.ts` (Community entry), `apps/ptah-landing-page/src/app/pages/members/members-page.component.ts:199` (existing "Open Community" button → switch to `/session/sso` deep-link), `apps/ptah-landing-page/src/app/services/*` (licenses/me client).

## Notes / invariants

- DiscourseConnect supports `admin` / `moderator` booleans (set on every login, like `add_groups`/`remove_groups`). Assert `admin=false`/`moderator=false` for non-allowlisted users → `ADMIN_EMAILS` is the single source of truth (a manually-promoted account is auto-demoted next login — intended).
- Feature-off invariant preserved: when `DISCOURSE_*` unset, SSO 403s, `communityUrl` is null, Community button hidden.
- Zod at boundaries; `catch (error: unknown)`; OnPush + signals on any Angular change.
