# Batch B4 — Seshat re-target (docs)

## Files written

Both files were writable directly. No fallback to `.proposed.md` was needed.

- `D:\projects\seshat\OPERATIONS.md` — appended, annotated. Nothing deleted.
- `D:\projects\seshat\PRD.md` — appended, annotated. Nothing deleted.

## Verification results (grep against `D:\projects\ptah-extension`, run 2026-09-04)

| Fact to verify                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native forum: `libs/api/forum` (categories/topics/posts/reactions/search)                       | Confirmed. 60+ files, includes `admin-community-categories.controller.ts`, `admin-community-topics.controller.ts`, `admin-community-posts.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                         |
| Member UI: `libs/web/members`                                                                   | Confirmed. `src/lib/community/{feed-page,thread-page,my-threads-page}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Admin moderation: `libs/web/admin/src/lib/builders/community`                                   | Confirmed. `community-moderation.ts` + `.html` + `.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `libs/api/forum/README.md` cites TASK_2026_177, Phase 2                                         | Confirmed, line 3: "the native community forum that replaced Discourse (TASK_2026_177, Phase 2)"                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `.ptah/specs/TASK_2026_177` folder                                                              | **Not found on disk.** The README citation is the only source for the task number; the spec folder itself is gone or was never at this path. Could not verify against the original task carrier.                                                                                                                                                                                                                                                                                                                                                                 |
| `libs/api/community/src/lib/discourse/admin-community.controller.ts` does not exist             | Confirmed. Glob for `libs/api/community/src/lib/discourse/**` returned no files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Discourse mention count                                                                         | **95 occurrences across 17 files** total (92 in `apps/`, 3 in `libs/`). Almost all in `apps/ptah-license-server/prisma/seed/*` and `prisma/migrations/*` — one-time Discourse data-import history (`discourse-export.schema.ts`, `community-seed.ts`, `map-categories.ts`, `map-topics.ts`, `map-course.ts`, `20260805090000_drop_discourse_group`). The 3 in `libs/` are a comment in `visibility.ts`, a comment in the forum README (the replaced-Discourse sentence itself), and a comment in `member-topic.contract.ts`. None are live Discourse client code |
| Category names carried over                                                                     | Confirmed by code, not just claim: `map-categories.ts:157` does `name: source.name` — native categories keep the Discourse names `Builders Lounge` and `General`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Courses native: `libs/api/learning` admin-{courses,course-modules,lessons}                      | Confirmed. All three controllers + specs exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Member-facing courses                                                                           | Confirmed at `libs/web/members/src/lib/learning` (`courses-page.ts`, `course-page.ts`, `lesson-page.ts`, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Live sessions: Google Calendar/Meet, not a Discourse plugin                                     | Confirmed. `libs/api/community/src/lib/google-sessions` (calendar provider, event mapper, session requests) and `libs/api/community/src/lib/live-sessions` both exist and are Google-backed. No Discourse Calendar plugin code found anywhere in the repo                                                                                                                                                                                                                                                                                                        |
| Complimentary license path                                                                      | Confirmed at `libs/api/admin/src/lib/admin-licenses.controller.ts:70`, method `issueComplimentaryLicense`. Note: this is a different file than the task brief's example path (`apps/.../admin/admin.controller.ts`), which does not exist — the real controller lives in the `libs/api/admin` lib                                                                                                                                                                                                                                                                |
| TASK_2026_377 additions (category management, `POST v1/admin/community/topics`, Courses screen) | Confirmed as **planned, not yet landed**. `admin-community-topics.controller.ts` currently has no `POST` route (grep for `v1/admin/community/topics` hit only DTOs and the existing pin/lock/move/delete/restore controller, no create handler). This matches `batches.md`: B1 (backend route) and B3 (Courses screen) are still `PENDING` at the time B4 ran                                                                                                                                                                                                    |

## Facts I could not verify

- The original `TASK_2026_377` context/batches files place `admin-community.controller.ts`
  (Discourse) as the file OPERATIONS.md's decision log used to cite for reads. That file is
  confirmed gone (see above) — annotated as such in both edited files.
- `.ptah/specs/TASK_2026_177` — could not read the original task carrier; relied on the
  `libs/api/forum/README.md` citation instead. Flagged in OPERATIONS.md as sourced from the
  README, not the task carrier.
- D5 (free early-access provisioning) is annotated with `issueComplimentaryLicense` as the
  surviving admin-issued path, but I could not verify from the code alone whether that call
  path also grants Builders forum/group membership, or only issues a license record. Left
  as an open question inside the D5 annotation rather than asserting it is fully resolved.

## Edits made, by file

### OPERATIONS.md

- New "Native forum and admin portal (supersedes Discourse)" subsection under "Standing facts",
  with all verified facts above and file paths.
- "Discourse" table and "API keys — the two-key rule" table both kept in place, each retitled
  with "— SUPERSEDED 2026-09-04" and a one-line pointer to the new subsection.
- Cadence table: `Where` column now names the native forum category and file path (or the
  Google Meet call) instead of a bare Discourse category name. A short note above the table
  explains the category names did not change, only the owner.
- Open decisions: D4 marked Resolved (Google Meet, cited). D5 annotated with the
  `issueComplimentaryLicense` path and the open question above. New D6 added for Seshat's own
  write path to the native portal, status Open.
- Decision log: appended "### 2026-09-04 — Seshat re-targets to the native forum and admin
  portal" with rationale, at the end of the existing log (newest-last, per the file's own rule).

### PRD.md

- Banner added right after the title metadata: `> [!IMPORTANT] Superseded in part on
2026-09-04 — see §12.` with a list of the affected section numbers.
- `Last updated` bumped to 2026-09-04.
- New "## 12. Re-target to the native forum (2026-09-04)" appended at the end, covering §1, §2,
  §3.1, §3.2, §3.3, §5.3, §7, §9 and §11 (D4) as instructed. Existing sections were not rewritten
  in place.

WROTE: batch-report-B4.md
