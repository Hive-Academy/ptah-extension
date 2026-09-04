# TASK_2026_377 — Context

## User intent

The admin opens `/admin/builders/community` and sees an empty moderation queue. The admin
cannot create a category or a thread from the portal, so the native forum starts empty and
stays empty. The admin also cannot author courses from the portal even though the learning
API is complete. Seshat (D:\projects\seshat) is the content helper for the Builders program,
but its PRD and ledger still target Discourse, which the repo removed in TASK_2026_177.

User asked: "orchestrate proper fixes over the 2 lanes with our CLI tool, not subagents."

## Lanes

- **Lane A — ptah-extension admin portal** (backend + frontend, libs/api + libs/web/admin)
- **Lane B — Seshat docs re-target** (D:\projects\seshat, no git, append-only edits)

## Findings (verified 2026-09-04)

- `libs/api/forum/.../admin-community-categories.controller.ts` — full category CRUD +
  reorder, audited. The admin UI only calls `listCommunityCategories()`. No create UI.
- `libs/api/forum/.../admin-community-topics.controller.ts` — pin/lock/move/delete/restore
  only. No `POST`. Admin cannot author a thread.
- `MemberGuard` denies an admin without a Builders entitlement by design (`isAdmin` is
  informational, computed after the entitlement throw). Not to be changed.
- `libs/api/learning/.../admin-{courses,course-modules,lessons}.controller.ts` — full
  authoring API (draft by default, `PUT :id/published`, reorder, restore, refresh-metadata).
  `libs/web/admin` has zero references to courses.
- Seshat PRD §3.1 two-key rule, §7 Discourse MCP, §5.3 community-steward, and the ledger's
  Standing facts all describe Discourse. `admin-community.controller.ts` (Discourse) no
  longer exists.

## Decisions

- D-A1: Admin-authored threads go through a NEW audited `POST v1/admin/community/topics`,
  not through a complimentary license or an `isAdmin` branch on the member path.
- D-A2: Category management lives on the existing community moderation screen (a section),
  not a new route. Keeps Batch 2 disjoint from Batch 3.
- D-A3: Courses get a new service file `admin-learning-api.service.ts` so Batch 3 never
  touches `admin-builders-api.service.ts`.
- D-B1: Seshat stays a content helper. Drafts to files, human pastes into the admin portal.
  Discourse MCP and the two-key rule are retired. No direct API token for Seshat now.

## CLI delegation

- `cli_delegation: enabled` (user-requested, no Task subagents)
- Available: codex (installed), antigravity (installed), claude cli (ptah-cli
  `pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`), ollama cloud (ptah-cli).
- Max 3 concurrent. Wave 1 = B1 (codex), B3 (claude cli), B4 (claude cli).
  Wave 2 = B2 (claude cli) after B1 lands so the request contract is real.
