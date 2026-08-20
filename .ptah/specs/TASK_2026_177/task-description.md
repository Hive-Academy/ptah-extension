# Requirements Document — TASK_2026_177

## Native community platform (replaces Discourse)

- **Type**: FEATURE
- **Priority**: P1
- **Complexity**: XL (phased — see §7)
- **Created**: 2026-08-03
- **Depends on**: `5273fbdd0` (`libs/web/panel-ui`), `08c59af79` + `399af4917` (themes), `6614f9e92` (content export)
- **Mode**: Autonomous. Ambiguities are resolved inline and recorded under [Assumptions](#assumptions) rather than escalated.

---

## Introduction

Ptah Builders is a paid, invite-gated cohort of a few hundred engineers. Its current
community layer is Discourse, and the evidence gathered before this task
(`context.md`) shows Discourse is both empty in production and structurally wrong for
the content that exists: 17 topics / 19 posts, of which the substantive body is
**8 sequential "Week N build thread" topics** — a curriculum with implied ordering
and completion state, which a flat forum cannot express.

This task replaces Discourse with a native community platform owned end to end: a
NestJS API in `libs/api/community` and a member panel mounted at `/members`, built on
the already-shipped `@ptah-web/panel-ui` shell and the already-shipped
`operator-member` / `operator-member-light` themes.

The value proposition is threefold:

1. **Structure the curriculum correctly** — Course → Module → Lesson with ordering,
   per-member progress, and cohort gating, backed by YouTube video.
2. **Collapse three products into one** — community, courses, and sessions behind one
   identity, one paywall, one design system, with no SSO handshake.
3. **Delete the parts we were never going to use** — trust levels, spam heuristics,
   flag queues, and email digests exist to defend large public forums against hostile
   anonymous traffic. Here the paywall is the spam filter.

Discourse is being **removed, not made headless**. Everything in
`libs/api/community/src/lib/discourse/`, `apps/ptah-discourse-theme`, the
`DISCOURSE_*` configuration, and the Seshat harness's community skills is in scope
for deletion or retargeting (§4).

### Reading order for the architect

`context.md` (settled decisions and prior evidence) → this document →
[Assumptions](#assumptions) (decisions taken autonomously that the architect inherits)
→ `docs/design-system/panel-theme-spec.md` (token system, non-negotiable) →
`docs/design-system/stitch_ptah_builders_member_home/` (8 approved screens).

---

## 1. Scope statement

### 1.1 In scope

| #   | Deliverable                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Community** — topics, single-level threaded replies, reactions, read state and unread counts, cohort-gated categories, pinning, accepted answers, search                             |
| B   | **Courses** — Course → Module → Lesson hierarchy with explicit ordering, YouTube-backed lessons, per-member progress and completion, lesson comments, cohort gating, locked modules    |
| C   | **Live sessions** — scheduled unlisted YouTube streams, replays, and the existing Google Calendar cohort sessions surfaced in one place                                                |
| D   | **Private sessions** — member request → admin accept → Google Calendar event with an auto-generated Meet link, built on the existing `SessionRequest` model and `GoogleSessionsModule` |
| E   | **Packs (member-facing)** — the replacement delivery channel for pack repo links, which Discourse currently carries                                                                    |
| F   | **Member hub** — one aggregate endpoint backing `/members`, never a waterfall of five calls                                                                                            |
| G   | **Admin** — authoring and moderation surfaces for every one of A–E                                                                                                                     |
| H   | **Membership consolidation** — one authoritative `isBuildersMember` definition                                                                                                         |
| I   | **Migration and removal** — the 19 exported posts placed, Discourse code/config/theme/skills removed (§4)                                                                              |

### 1.2 Explicitly not in scope

This task does **not** rebuild a forum platform. The scale target is a few hundred
paying, identified engineers — not public-internet scale. Concretely:

- No re-implementation of Discourse's moderation machinery (§5).
- No new Google Meet integration — the Calendar API already yields a Meet link (R4.1).
- No YouTube OAuth, channel write access, or upload pipeline — an admin pastes a video
  ID; the server reads public metadata with an API key.
- No second design system, no second panel shell, no second markdown renderer.
- No automated GitHub access provisioning for packs (§5).

### 1.3 Scale target (governs every design decision)

| Dimension              | Target                               |
| ---------------------- | ------------------------------------ |
| Total members          | ~500 (design headroom 2,000)         |
| Peak concurrent        | ~50                                  |
| Topics after 12 months | low thousands                        |
| Posts after 12 months  | low tens of thousands                |
| Courses / lessons      | tens of courses, hundreds of lessons |

Any proposal justified only above these numbers (sharding, a search cluster, event
sourcing, websocket fan-out infrastructure, denormalized counter tables with
reconciliation jobs) is over-engineering for this task and must be rejected with that
reason recorded.

---

## 2. Functional requirements

Every requirement below is **members-only** unless stated otherwise: authenticated,
and holding an active Builders entitlement per R7. Authorization is enforced
server-side; UI gating is cosmetic (NFR-S8).

---

### Requirement 1 — Community

**User Story:** As a Builders member using the member panel, I want to read and post
in cohort discussions with clear unread state, so that I can follow and contribute to
the cohort's conversation without re-scanning threads I have already read.

#### R1.1 Categories and visibility

1. WHEN an admin creates a category THEN the system SHALL require a name, slug, description, display order, and a visibility setting of exactly one of: `member` (all Builders members), `cohort` (restricted to one or more `MemberGroup` keys), or `staff` (admin only).
2. WHEN a member requests any category listing THEN the response SHALL contain only categories that member's visibility permits, and SHALL NOT disclose the existence, name, or topic counts of categories they cannot see.
3. WHEN a member requests a topic in a category they cannot see THEN the system SHALL respond `404`, not `403` — a `403` confirms the resource exists.
4. WHEN categories are rendered THEN they SHALL appear in the admin-defined display order, not alphabetically or by creation date.

#### R1.2 Topics

1. WHEN a member creates a topic THEN the system SHALL require a title (3–200 chars) and a markdown body, SHALL reject creation in any category they cannot see, and SHALL record the author and creation timestamp.
2. WHEN a topic is created THEN the system SHALL generate a URL slug that is stable for the life of the topic and SHALL NOT change it when the title is edited.
3. WHEN a member edits their own topic within an editable window THEN the system SHALL persist the change and record an `editedAt` timestamp displayed in the UI.
4. WHEN a non-author non-admin member attempts to edit or delete a topic THEN the system SHALL respond `403` and make no change.
5. WHEN an admin pins a topic THEN that topic SHALL sort above all unpinned topics in its category and in the feed, and SHALL carry a visually distinct pinned indicator per the approved screens.
6. WHEN an admin locks a topic THEN new replies SHALL be rejected with a clear message while existing content stays readable.
7. WHEN a topic is deleted THEN it SHALL be soft-deleted (admin-recoverable for at least 30 days) and SHALL disappear from all member-facing listings, feeds, and search results immediately.

#### R1.3 Replies — one level of nesting only

1. WHEN a member replies to a topic THEN the reply SHALL attach to the topic and appear in the thread in chronological order.
2. WHEN a member replies to an existing reply THEN the new reply SHALL attach to that reply as a child and render indented exactly one level.
3. WHEN a member attempts to reply to an already-nested (child) reply THEN the system SHALL attach the new reply to the **parent** reply rather than create a third level — depth is capped at 2 (topic → reply → child reply), and this cap SHALL be enforced server-side, not only in the UI.
4. WHEN a thread is rendered THEN no reply SHALL be indented more than one level regardless of how the data was created, including data produced by migration.
5. WHEN a reply is deleted and has children THEN the children SHALL remain readable and the deleted reply SHALL render as a tombstone, so the conversation is not orphaned.

Rationale for the cap: deep trees are the single largest contributor to forums feeling
unreadable. Two levels support "reply to a specific point" without producing a tree a
reader has to navigate.

#### R1.4 Reactions

1. WHEN a member reacts to a topic body or a reply THEN the system SHALL record at most one reaction of each supported type per member per target, and a second identical reaction SHALL toggle it off.
2. WHEN a thread is rendered THEN each post SHALL show reaction counts per type and SHALL visually indicate which reactions the current member has applied.
3. WHEN the supported reaction set is defined THEN it SHALL be a fixed, small server-defined list (recommended 4–6), not free-form emoji input.
4. WHEN reaction counts are read THEN they SHALL be derived from stored reactions; a denormalized counter is permitted only if a test demonstrates it stays consistent, and is not required at the §1.3 scale.

#### R1.5 Accepted answer

Grounded in `discussion_thread_ptah_builders` and its light-mode pair, both of which
render an explicit "Accepted Answer" treatment.

1. WHEN a topic author or an admin marks a reply as the accepted answer THEN that reply SHALL be flagged, SHALL render with the accepted treatment, and SHALL be surfaced at the top of the reply list in addition to its chronological position.
2. WHEN a topic already has an accepted answer and a different reply is marked THEN the previous flag SHALL be cleared — at most one accepted answer per topic.
3. WHEN a member other than the topic author or an admin attempts to mark an accepted answer THEN the system SHALL respond `403`.

#### R1.6 Read state and unread counts

1. WHEN a member opens a topic THEN the system SHALL record their last-read position for that topic.
2. WHEN a member views the feed THEN each topic SHALL indicate unread status and SHALL show a count of posts added since that member's last read.
3. WHEN a member has never opened a topic created after they joined THEN that topic SHALL be treated as fully unread.
4. WHEN a member's own reply is posted THEN it SHALL NOT count as unread for that member.
5. WHEN a member uses "mark all read" in a category THEN every visible topic in that category SHALL become read in a single request.
6. WHEN unread state is computed THEN it SHALL be computed for the requesting member only and SHALL NOT require a per-post read-receipt row per member (see A-6).

#### R1.7 Search

1. WHEN a member searches THEN the system SHALL search topic titles, post bodies, and lesson titles, and SHALL return results grouped by kind.
2. WHEN results are returned THEN they SHALL be filtered by the requesting member's category and cohort visibility, applied in the query — not filtered after the fact in the client.
3. WHEN a query returns no results THEN the UI SHALL render the `EmptyState` primitive from `@ptah-web/panel-ui`, not a bare "0 results" string.
4. WHEN a search executes over the §1.3 data volume THEN it SHALL return in under 500 ms at p95.
5. WHEN search results are rendered THEN matched terms SHALL be highlighted via text nodes, never by injecting HTML into sanitized markdown output (NFR-S2).

---

### Requirement 2 — Courses

**User Story:** As a Builders member working through the cohort curriculum, I want
courses broken into ordered modules and lessons with video and tracked completion, so
that I always know where I am and what comes next.

#### R2.1 Hierarchy and ordering

1. WHEN an admin creates a course THEN the system SHALL require a title, slug, description, and cohort-visibility setting, and SHALL support an optional cover image and a published/draft state.
2. WHEN a course is in draft THEN it SHALL be invisible to every member endpoint and SHALL return `404` on direct access.
3. WHEN modules and lessons are created THEN each SHALL carry an explicit integer sort order within its parent, and reordering SHALL be an admin operation that does not require recreating records.
4. WHEN a course is rendered to a member THEN modules and lessons SHALL appear strictly in sort order, with ties broken deterministically.
5. WHEN a lesson is requested THEN the response SHALL include its position plus the previous and next lesson in course order (crossing module boundaries), so the player can offer next/previous without a second call.

#### R2.2 YouTube-backed lessons

Per the settled Checkpoint 0 decision: unlisted videos, Data API v3, API key only —
no OAuth, no channel write access.

1. WHEN an admin attaches a video to a lesson THEN the system SHALL accept a YouTube video ID or a URL from which the ID is extracted, and SHALL persist the ID.
2. WHEN a video ID is saved THEN the server SHALL fetch title, duration, and thumbnail from the Data API **at authoring time** and persist them; member page views SHALL NOT trigger YouTube API calls (NFR-R2).
3. WHEN the Data API response is received THEN it SHALL be validated with a Zod schema before any field is persisted (NFR-S1).
4. WHEN the Data API returns an error, an unknown ID, or a private video THEN the system SHALL surface a specific actionable error to the admin and SHALL NOT save a lesson in a half-configured state.
5. WHEN an admin triggers "refresh metadata" THEN persisted metadata SHALL be re-fetched and updated for the selected lesson(s).
6. WHEN `YOUTUBE_API_KEY` is unset THEN the integration SHALL report `isEnabled() === false`, all endpoints SHALL continue to return their stable contract, admins SHALL be able to save a video ID with manually entered metadata, and nothing SHALL `500` — matching the `GOOGLE_OAUTH_*` feature-off posture already established in `google-sessions`.
7. WHEN a lesson video renders THEN it SHALL be embedded via `youtube-nocookie.com` (NFR-S3).

#### R2.3 Progress and completion

1. WHEN a member watches a lesson THEN the system SHALL persist their furthest playback position for that lesson, throttled to at most one write per 15 seconds of playback.
2. WHEN a member's furthest position reaches a completion threshold of the persisted duration (recommended 90%) THEN the lesson SHALL be marked complete automatically.
3. WHEN a member marks a lesson complete manually THEN completion SHALL be recorded regardless of playback position, and SHALL be reversible.
4. WHEN a lesson has no video THEN completion SHALL be manual only.
5. WHEN a course is rendered THEN it SHALL show completed-lesson count, total lesson count, and a percentage derived from those two numbers.
6. WHEN a member returns to a course after leaving THEN the UI SHALL offer to resume at the first incomplete lesson in course order.
7. WHEN progress is queried for a member THEN it SHALL never expose another member's progress on any member-facing endpoint (NFR-S4).

Duration from the API — not a manual checkbox — is what makes this accurate; that was
the stated reason for choosing the Data API at Checkpoint 0.

#### R2.4 Locked modules

1. WHEN a module has a release date in the future THEN it SHALL render as locked with the release date shown, and its lessons SHALL return `403` from the lesson endpoint.
2. WHEN a course is marked sequential and a member has not completed every lesson in the preceding module THEN the next module SHALL render as locked with the unlock condition stated in plain language.
3. WHEN a course is not marked sequential THEN only date-based locking SHALL apply.
4. WHEN a module is locked THEN its title and lesson titles MAY be visible (so members can see what is coming) but lesson bodies, comments, and video IDs SHALL NOT be returned.
5. WHEN locking is evaluated THEN it SHALL be evaluated server-side on every lesson read; a locked module hidden only by CSS is a defect.

#### R2.5 Lesson comments

Per the settled Checkpoint 0 decision: a distinct `LessonComment`, not a polymorphic
comment table shared with forum posts.

1. WHEN a member comments on a lesson THEN the comment SHALL attach to that lesson, carry author and timestamp, and be visible only to members who can see that lesson (cohort gating and module locking both inherit).
2. WHEN comments are rendered THEN they SHALL support one level of nesting under the same rule and the same server-side enforcement as R1.3.
3. WHEN a lesson comment is a question THEN an admin or the lesson author SHALL be able to mark it answered, rendering the "Answered" treatment shown in `course_learning_..._light_mode`.
4. WHEN a member edits or deletes their own comment THEN the system SHALL permit it; for any other member's comment it SHALL respond `403` unless the caller is an admin.
5. WHEN lesson comments are counted for display THEN the count SHALL exclude soft-deleted comments.

---

### Requirement 3 — Live sessions

**User Story:** As a Builders member, I want upcoming live sessions and past replays
in one place, so that I do not have to track a calendar invite, a stream link, and a
recording separately.

1. WHEN an admin schedules a live session THEN the system SHALL require a title and scheduled start time, and SHALL accept an optional YouTube video ID for the scheduled unlisted stream, an optional description, and a cohort-visibility setting.
2. WHEN a live session's YouTube ID is provided THEN metadata SHALL be fetched and validated exactly as in R2.2, with the same feature-off posture.
3. WHEN a member views the Live surface THEN it SHALL present, in one view: upcoming live sessions, the existing Google Calendar cohort sessions from `GET /api/v1/members/sessions`, and past sessions with replays — visually distinguished but not requiring the member to know which system produced each.
4. WHEN a live session's start time has passed and a replay video ID is present THEN it SHALL move to the replay list and be playable inline via `youtube-nocookie.com`.
5. WHEN a live session is in progress (between start and end) THEN the UI SHALL indicate live status.
6. WHEN the Google Calendar integration is disabled (`GOOGLE_OAUTH_*` unset) THEN the Live surface SHALL still render with YouTube-sourced sessions and SHALL show no error to the member.
7. WHEN a member is not in a session's cohort THEN that session SHALL NOT appear in their Live surface or aggregate hub response.
8. WHEN a session exposes attendee information THEN it SHALL use the member-facing contract only; `AdminSession`'s `description` and `attendees` fields SHALL NOT widen into any member response (NFR-S4).

---

### Requirement 4 — Private sessions (request → accept → Meet)

**User Story:** As a Builders member, I want to request a private session and receive a
confirmed calendar invite with a video link, so that booking one-to-one time does not
require an out-of-band email thread.

Built on the existing `SessionRequest` model and `GoogleSessionsModule`. Per the
settled Checkpoint 0 decision, **no separate Google Meet integration exists or is
needed**: `BuildersSession.meetLink` is already resolved from the created Calendar
event's `hangoutLink` / `conferenceData`. Creating the event yields the link.

1. WHEN a Calendar event is created for an accepted request THEN the Meet link SHALL be read from the event's conference data — the system SHALL NOT call any Meet-specific API, and no such integration SHALL be built.
2. WHEN a member submits a session request THEN the system SHALL require a session topic, SHALL accept optional notes, SHALL create a `SessionRequest` with status `pending`, and SHALL make it visible to the member with that status.
3. WHEN a member views their requests THEN they SHALL see every request they created with its current status (`pending` | `scheduled` | `completed` | `canceled`), scheduled time when set, and Meet link when set — and SHALL see no other member's requests.
4. WHEN an admin views the request queue THEN they SHALL see pending requests with requester identity, topic, notes, and submission time, sorted oldest first.
5. WHEN an admin accepts a request and supplies a start time and duration THEN the system SHALL create a Google Calendar event with conferencing enabled, invite the requesting member, set the request status to `scheduled`, set `scheduledAt`, and **persist the created event's identifier and resolved Meet link on the request**.
6. WHEN an accepted request is later rescheduled or canceled THEN the system SHALL locate the existing Calendar event by the persisted identifier and update or delete it — a request that cannot be reconciled to its event is a defect. (`SessionRequest` today has neither a `calendarEventId` nor a `meetLink` field; adding this linkage is required. Field design is the architect's — see OQ-1.)
7. WHEN Calendar event creation fails THEN the request SHALL remain `pending`, the admin SHALL see a specific error, and no partial state SHALL be persisted.
8. WHEN a request is declined THEN the status SHALL become `canceled` with an optional admin reason visible to the member.
9. WHEN `GOOGLE_OAUTH_*` is unset THEN members SHALL still be able to submit requests, admins SHALL see them, and acceptance SHALL fail with a clear "scheduling unavailable" message rather than a `500`.
10. WHEN a session request's payment fields are touched THEN existing `isFreeSession` / `paymentStatus` / `paddleTransactionId` semantics SHALL be preserved unchanged — this task adds a member-facing flow on top of the existing model, it does not redesign session monetization.

---

### Requirement 5 — Packs (member-facing)

**User Story:** As a Builders member, I want to see the packs available to me and reach
their repositories, so that I can get to the code without asking in a chat.

Context that makes this load-bearing: `packs.types.ts` states in bold terms that the
registry **gates nothing** — "access is administered entirely on GitHub (collaborator
invites, or the repo link posted inside that cohort's Discourse group)" and
"`cohortKey` is A BOOKKEEPING LABEL, NOT AN ACCESS CONTROL."

**The second half of that delivery story stops working the moment Discourse is
deleted.** A member-facing Packs view is therefore not polish — it is the replacement
channel for how members find pack repo links at all.

1. WHEN a member views Packs THEN they SHALL see title, description, tags, and a link to `repoUrl` for each pack visible to them.
2. WHEN a pack is serialized for a member THEN the `notes` field SHALL NOT be present in the response body under any circumstance — it is an admin-internal freeform note. A test SHALL assert its absence.
3. WHEN the member Packs response is defined THEN it SHALL be a distinct type from `PackResponse`, following the `BuildersSession` / `AdminSession` precedent, so admin fields cannot widen into it by inheritance.
4. WHEN member-facing visibility is evaluated THEN it SHALL follow **A-1**: every pack flagged member-visible is shown to every Builders member, and `cohortKey` SHALL remain a display label that grants and revokes nothing.
5. WHEN a member follows a pack's `repoUrl` and lacks GitHub access THEN the UI SHALL have told them in advance how access is granted, so a GitHub 404 is not the first signal.
6. WHEN this task completes THEN `packs.types.ts` SHALL be updated so its docblock describes the new member-facing channel and the A-1 visibility rule, with every Discourse reference removed.
7. WHEN this task completes THEN Ptah SHALL still not serve pack _content_ and SHALL still not provision GitHub access — only the discovery and link-delivery channel moves in-product (§5).

---

### Requirement 6 — Member hub (aggregate)

**User Story:** As a Builders member landing on `/members`, I want one screen that shows
where I left off, what is new, and what is next, loading as one unit.

1. WHEN a member requests the hub THEN the server SHALL return, in **one** request: continue-learning state (current course, next incomplete lesson, progress), recent/unread community activity, next upcoming live or private session, and available packs — as a single composed response.
2. WHEN the hub is loaded THEN the client SHALL issue exactly one data request for the initial render. A hub composed client-side from multiple endpoint calls fails this requirement, and a test SHALL assert the request count.
3. WHEN a section has no data THEN the hub SHALL return that section as an explicit empty structure, and the UI SHALL render the `EmptyState` primitive rather than omitting the section silently.
4. WHEN one underlying source fails or is disabled THEN the hub SHALL still return `200` with the remaining sections populated and the failed section marked unavailable — a disabled Calendar integration SHALL NOT blank the whole home screen.
5. WHEN the hub is served warm THEN it SHALL respond in under 400 ms at p95 at the §1.3 data volume.
6. WHEN a new surface ships in a later phase THEN it SHALL extend the existing hub response; the number of client requests for the hub SHALL remain one.

---

### Requirement 7 — Membership consolidation (prerequisite)

**User Story:** As an engineer adding member endpoints, I want exactly one definition of
"is a paid Builders member", so that authorization cannot drift between surfaces.

Known debt from `context.md`: `isBuildersMember` is implemented **twice** — in
`MembersController` and in `BuildersMembershipService`. Every new surface in this task
authorizes against it, which turns a duplicated definition into a systemic risk.

1. WHEN membership is determined anywhere in the API THEN it SHALL resolve through exactly one service, with one implementation.
2. WHEN this task completes THEN a repository-wide search SHALL find no second implementation of the membership predicate.
3. WHEN the consolidated service is registered THEN it SHALL be available to every module that needs it without each module re-deriving entitlement from `License` / `Subscription` / `MemberGroupAssignment` independently.
4. WHEN the consolidated service is written THEN it SHALL have unit tests covering: active paid member, expired/lapsed member, admin who is not a member, member with an entitlement but no cohort assignment, and unauthenticated caller.
5. WHEN `BuildersMembershipService` is removed along with the Discourse module (§4) THEN its membership logic SHALL be relocated, not lost — the Discourse deletion SHALL NOT delete the surviving definition.
6. WHEN entitlement and cohort are evaluated THEN they SHALL follow **A-2**: entitlement (may this person enter `/members` at all) derives from `License` / `Subscription`; cohort (which gated content they see) derives from `MemberGroupAssignment`. The two SHALL NOT be conflated.
7. WHEN an authenticated user without an active entitlement requests `/members` THEN they SHALL be redirected to an upgrade/join surface rather than shown an empty panel or a raw `403`.
8. WHEN an entitled member has no `MemberGroupAssignment` THEN they SHALL see all `member`-visibility content and no `cohort`-gated content, and SHALL NOT error.

---

### Requirement 8 — Admin authoring and moderation

**User Story:** As an operator, I want to author and moderate every member-facing
surface from the existing admin panel, so that running the cohort does not require
database access or a deploy.

1. WHEN an admin uses the admin panel THEN they SHALL be able to create, edit, reorder, publish, and unpublish: categories, courses, modules, lessons, and live sessions.
2. WHEN an admin moderates community content THEN they SHALL be able to pin, lock, soft-delete, restore, edit, and move a topic between categories, and soft-delete or restore any reply or lesson comment.
3. WHEN an admin manages private sessions THEN they SHALL be able to view the pending queue, accept with a time, reschedule, and decline with a reason (R4).
4. WHEN an admin manages packs THEN existing admin pack CRUD SHALL continue to work unchanged and SHALL additionally control the member-visible flag per A-1.
5. WHEN any admin destructive action is taken THEN it SHALL be soft-delete by default and SHALL record who acted and when.
6. WHEN admin surfaces are built THEN they SHALL reuse `@ptah-web/panel-ui` and the `ADMIN_NAV_GROUPS` pattern; they SHALL NOT introduce a second admin shell.
7. WHEN admin endpoints return content THEN they SHALL use admin-specific response types distinct from member types (NFR-S4), following the `AdminSession extends BuildersSession` precedent.
8. WHEN reordering is performed THEN it SHALL be possible to reorder without renumbering every sibling in a separate request per item.

---

### Requirement 9 — Member panel shell, navigation and routing

**User Story:** As a Builders member, I want the member panel to feel like one coherent
product that matches the approved designs.

1. WHEN the member panel is built THEN it SHALL use `PanelLayout` from `@ptah-web/panel-ui` with `navGroups`, and SHALL NOT author a second shell, sidebar, or drawer implementation.
2. WHEN member navigation is defined THEN it SHALL be a `readonly PanelNavGroup[]` mirroring the `ADMIN_NAV_GROUPS` pattern, covering the validated IA: **Hub · Learn** (Courses, Artifacts) **· Build** (Packs) **· Live** (Sessions, Replays, Request a session) **· Community** (Feed, My Threads, Notifications) **· Account**.
3. WHEN the Notifications nav item is rendered THEN it SHALL use the existing `PanelNavItem.badgeCount` for unread count — this is that field's intended first consumer; no parallel badge mechanism SHALL be introduced.
4. WHEN member routes are declared THEN every route SHALL be explicitly enumerated. The member panel SHALL **NOT** replicate the admin panel's generic `:model` / `:model/:id` catch-all: on an internal operator surface that is a feature, on a member-facing surface it is a data-exposure hazard. A test or lint rule SHALL assert no catch-all model route exists under `/members`.
5. WHEN `/members` is mounted THEN it SHALL lazy-load behind a member guard, mirroring how `/admin` mounts behind `AdminAuthGuard` and loads a single `path: ''` layout route with lazy `loadComponent` children.
6. WHEN the member panel renders THEN it SHALL use the `operator-member` theme and SHALL support `operator-member-light` via a member-controlled toggle whose choice persists across sessions.
7. WHEN reusable UI is needed THEN `StatTile`, `StatusBadge`, `EmptyState`, `DetailDrawer`, and `SelectionToolbar` SHALL be used rather than re-implemented.
8. WHEN screens are implemented THEN they SHALL match the 8 approved screens in `docs/design-system/stitch_ptah_builders_member_home/` for layout and hierarchy, resolving all token drift through `panel-theme-spec.md` (NFR-U2).

---

### Requirement 10 — Notifications

**User Story:** As a Builders member, I want to know when something needs my attention,
without email.

1. WHEN a member's topic receives a reply, their reply receives a child reply, their reply is marked accepted, their session request changes status, or an admin publishes an announcement THEN an in-app notification SHALL be created for that member.
2. WHEN a member takes the action themselves THEN no notification SHALL be created for them.
3. WHEN a member views notifications THEN they SHALL see them newest first with read/unread state, and opening one SHALL navigate to the source and mark it read.
4. WHEN unread notifications exist THEN the count SHALL surface on the Community → Notifications nav item via `badgeCount` (R9.3).
5. WHEN notification state is refreshed THEN it SHALL be fetched on navigation and via a low-frequency poll (recommended ≥ 60 s); no websocket or SSE transport SHALL be introduced (§5).
6. WHEN notifications accumulate THEN records older than a retention window (recommended 90 days) and already read SHALL be prunable by a scheduled job.

---

## 3. Non-functional requirements

### Performance (NFR-P)

| ID     | Requirement                                                                              | Verification                                         |
| ------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| NFR-P1 | Member hub responds < 400 ms p95 warm at §1.3 volume                                     | Load test against seeded data                        |
| NFR-P2 | Feed, thread, course, and session list endpoints respond < 300 ms p95                    | Same                                                 |
| NFR-P3 | Search responds < 500 ms p95                                                             | Same                                                 |
| NFR-P4 | Rendering a 25-topic feed executes ≤ 5 database queries — no N+1                         | Query-count assertion in an integration test         |
| NFR-P5 | All list endpoints paginate: default page size 25, maximum 50, rejecting larger requests | Contract test                                        |
| NFR-P6 | Member page views trigger zero third-party API calls (YouTube, Calendar) on the hot path | Test asserts no outbound call during hub/lesson read |

### Security (NFR-S)

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                 | Verification                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| NFR-S1  | Every external boundary is validated before use: HTTP request bodies and query params, YouTube Data API responses, Google Calendar API responses, and the migration JSON. Third-party responses and file input SHALL be validated with Zod schemas. HTTP DTOs SHALL follow A-3 under a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.                                                            | Unit tests feeding malformed payloads                                                                          |
| NFR-S2  | **All user-generated markdown renders through `libs/frontend/markdown` (DOMPurify + marked).** That chokepoint is the single XSS defence. No second markdown renderer, no second sanitizer, and no `[innerHTML]` on any user- or AI-generated content anywhere in this task. If module boundaries make that lib unreachable from `libs/web`, the resolution is to make it reachable — never to author a second path (OQ-2). | Code review plus a lint rule or test asserting no other `marked` / `DOMPurify` / `innerHTML` usage in new code |
| NFR-S3  | YouTube embeds use `https://www.youtube-nocookie.com/embed/...`. No YouTube script or cookie loads before a member plays a video.                                                                                                                                                                                                                                                                                           | Network inspection in e2e                                                                                      |
| NFR-S4  | Member-facing responses never include other members' email addresses, admin notes, or internal state. Every member/admin contract pair is two distinct types, following `BuildersSession` / `AdminSession`.                                                                                                                                                                                                                 | Serialization tests asserting field absence                                                                    |
| NFR-S5  | `Pack.notes` never appears in any member response                                                                                                                                                                                                                                                                                                                                                                           | Dedicated test (R5.2)                                                                                          |
| NFR-S6  | Configuration read via `ConfigService` only; no direct `process.env` access in new code                                                                                                                                                                                                                                                                                                                                     | Lint rule / review                                                                                             |
| NFR-S7  | Raw `error.message` from any dependency is never returned to a client; errors map to safe messages with correlation IDs in logs                                                                                                                                                                                                                                                                                             | Error-path tests                                                                                               |
| NFR-S8  | Every authorization rule (category visibility, cohort gating, module locking, ownership) is enforced server-side. Any rule enforced only in the UI is a defect.                                                                                                                                                                                                                                                             | Direct API tests bypassing the UI for each gated resource                                                      |
| NFR-S9  | Mutating endpoints are rate-limited per member (recommended 10 posts/min, 30 reactions/min) — proportionate given the paywall, without a spam-heuristics engine                                                                                                                                                                                                                                                             | Rate-limit test                                                                                                |
| NFR-S10 | The `cooked` (pre-rendered HTML) field from the Discourse export is discarded; only `raw` markdown is imported, so migrated content passes through the same sanitizer as new content                                                                                                                                                                                                                                        | Migration test asserting no HTML import path                                                                   |

### Frontend quality (NFR-U)

| ID     | Requirement                                                                                                                                                                                                                                                                                                               | Verification                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| NFR-U1 | `ChangeDetectionStrategy.OnPush` on every new component; signals plus `inject()`                                                                                                                                                                                                                                          | Lint rule / review                        |
| NFR-U2 | Colors resolve to `panel-theme-spec.md` tokens: surfaces `base-100`/`base-200`/`base-300`, every boundary `border-hairline`, hover/active `bg-surface-high`, `primary` `#f5a524`. **`base-300` is a fill and is never used as a border.** No raw hex, no Material-3 token names, no `ink-*`/`amber-*` in new member code. | Lint rule / review against §7 of the spec |
| NFR-U3 | Load-bearing muted text uses `text-base-content/60` or stronger; `/40` is reserved for genuinely glanceable metadata (`/40` measures 3.18:1 and fails WCAG AA for body text — spec §7)                                                                                                                                    | Contrast audit                            |
| NFR-U4 | Interactive elements are keyboard-reachable with a visible focus state; the video player is operable without a mouse                                                                                                                                                                                                      | Manual a11y pass plus axe in e2e          |
| NFR-U5 | Both `operator-member` and `operator-member-light` render every new screen without hardcoded-color artifacts                                                                                                                                                                                                              | Visual check in both themes               |
| NFR-U6 | Long lists virtualize or paginate; no unbounded DOM growth on the feed                                                                                                                                                                                                                                                    | Review                                    |

### Reliability and maintainability (NFR-R / NFR-M)

| ID     | Requirement                                                                                                                                                                                                        | Verification                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| NFR-R1 | Every third-party integration follows the established feature-off posture: unset config ⇒ `isEnabled() === false`, no-op, stable empty contract, no `500` (as `google-sessions` already does for `GOOGLE_OAUTH_*`) | Tests with config unset                                                                     |
| NFR-R2 | Third-party metadata is fetched at authoring time and persisted; no per-view API call, keeping the system inside YouTube's default quota                                                                           | Test asserting no fetch on read                                                             |
| NFR-R3 | Third-party failures degrade one section, never the page (R6.4)                                                                                                                                                    | Fault-injection test                                                                        |
| NFR-M1 | Every new service has unit tests following the existing `*.spec.ts` convention in `libs/api/community`; each member surface has an e2e test in `ptah-license-server-e2e`                                           | Coverage report plus CI                                                                     |
| NFR-M2 | Nx module boundaries respected; no new cross-boundary import that lint does not already permit                                                                                                                     | `nx lint`                                                                                   |
| NFR-M3 | Schema changes ship as reviewed Prisma migrations, forward-only, with no destructive step that cannot be rolled forward safely                                                                                     | Migration review                                                                            |
| NFR-M4 | Each new module owns one concern; no repeat of a monolith service                                                                                                                                                  | Architecture review                                                                         |
| NFR-M5 | No dead Discourse code, config key, or documentation remains after §4                                                                                                                                              | Repo-wide search returns zero `discourse` hits outside the export JSON and this task's docs |

---

## 4. Migration requirements

### MG-1 — Content migration (17 topics / 19 posts)

Source: `docs/community/discourse-export.json` (committed `6614f9e92`;
`{ exportedFrom, categories[], topics[] }`; each post carries `raw` markdown and
`cooked` HTML).

1. WHEN the import runs THEN it SHALL read only the committed export JSON — never the `discourse_dev` container or any live Discourse instance.
2. WHEN the export is parsed THEN it SHALL be validated with Zod before any record is written (NFR-S1); a malformed export SHALL abort the import with a clear error and write nothing.
3. WHEN the import runs a second time THEN it SHALL be idempotent — no duplicate categories, topics, posts, courses, modules, or lessons.
4. WHEN the 4 source categories are mapped THEN they SHALL become native categories with these visibilities: **General** → `member`, **Builders Lounge** (`read_restricted`) → `cohort`, **Site Feedback** → `member`, **Staff** → `staff`.
5. WHEN the **8 "Week N build thread"** topics are migrated THEN they SHALL become **course structure, not topics** — seeding a course (recommended title: "Ptah Builders — Cohort 1") whose modules/lessons preserve the Week 1–8 ordering (Foundation/workspace · The domain · Authentication and tenancy · Billing and entitlements · The first vertical slice · Agents memory and skills · Hardening · Deploy and launch), with each topic's `raw` markdown becoming that lesson's body.
6. WHEN the remaining **9** topics are migrated THEN they SHALL become native topics: "Start here — how this cohort works" (pinned, General), "Questions — ask anything here" (General), plus General (2), Site Feedback (3), and Staff (2). 8 + 9 = 17, and the import SHALL assert that total.
7. WHEN posts are imported THEN original `createdAt` timestamps and `postNumber` ordering SHALL be preserved, and `pinned` state SHALL carry over.
8. WHEN a post's `username` matches an existing `User` THEN authorship SHALL map to that user; when it does not, authorship SHALL follow **A-4** — attribute to a designated staff/system author and log every unmatched username. The import SHALL NOT fabricate user records.
9. WHEN post content is imported THEN only `raw` markdown SHALL be used; `cooked` HTML SHALL be discarded (NFR-S10).
10. WHEN the import completes THEN it SHALL emit a summary: categories, topics, posts, courses, modules, and lessons created, plus unmatched usernames.

### MG-2 — Delete the Discourse API surface

1. WHEN this task completes THEN `libs/api/community/src/lib/discourse/` SHALL be deleted in full — SSO service, admin provider, provisioning service, controllers, types, DTOs, module, and their specs (~12 files plus `dto/`).
2. WHEN `BuildersMembershipService` is deleted with that directory THEN its membership logic SHALL already have been relocated into the consolidated service (R7.5) — verified by tests passing before deletion.
3. WHEN the module is removed THEN its registration SHALL be removed from the API module graph and no dangling import SHALL remain.
4. WHEN `MemberGroup.discourseGroup` is removed THEN a Prisma migration SHALL drop the column and no code SHALL reference it.
5. WHEN the `Pack` model docblock and `packs.types.ts` are updated THEN every Discourse reference SHALL be removed and the access story SHALL be rewritten per R5.6.
6. WHEN `DISCOURSE_*` environment variables are removed THEN they SHALL be removed from the config schema, `.env.example`, deployment configuration, and any CI secret reference.
7. WHEN Discourse SSO endpoints are removed THEN any landing-page link, redirect, or button pointing at Discourse SHALL be removed or repointed to `/members/community`.

### MG-3 — Retire `apps/ptah-discourse-theme`

1. WHEN Discourse is removed THEN `apps/ptah-discourse-theme` SHALL be deleted, along with its Nx project registration, its CI/deploy targets, and its admin-API deploy credentials.
2. WHEN it is deleted THEN the root `CLAUDE.md` module index SHALL be updated to remove it and to describe the new community surfaces.
3. WHEN deletion is complete THEN `nx graph` SHALL show no orphaned project and no broken dependency.

### MG-4 — Retarget the Seshat harness community skills

1. WHEN this task completes THEN the community-related skills at `D:/projects/seshat` SHALL be inventoried, and each SHALL be either rewritten against the new API or deleted.
2. WHEN a skill is rewritten THEN it SHALL contain no Discourse endpoint, admin-API call, or SSO reference.
3. WHEN this work is delivered THEN it SHALL include an explicit list of the skills changed or removed — this is out-of-repo, so it will not be caught by this repository's tests and must be verified by hand.

### MG-5 — Decommission the runtime

1. WHEN the migration is verified THEN the local `discourse_dev` Docker container and any compose service definition SHALL be removed.
2. WHEN `community.ptah.live` is retired THEN it SHALL `301` to the member community surface so existing links and bookmarks do not break.
3. WHEN decommissioning happens THEN it SHALL happen **after** MG-1 is verified in production, never before.

---

## 5. Out of scope (with reasoning)

| Excluded                                                 | Reasoning                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reply-by-email**                                       | Requires inbound mail parsing, address-token security, and quoted-text stripping — a large, fragile subsystem. A few hundred members who already live in the panel will use the panel.                                      |
| **Real-time websockets / SSE**                           | At ~50 concurrent users, polling delivers acceptable freshness (R10.5) for a fraction of the operational surface. Adds connection lifecycle, auth-on-socket, and scaling concerns for no user-visible gain at this scale.   |
| **Trust levels / reputation / karma**                    | Built to progressively grant privileges to unvetted anonymous users. Every member here is paid and identified; the paywall already did that job.                                                                            |
| **Spam heuristics / flag queues / Akismet**              | Same reasoning. Per-member rate limits (NFR-S9) plus admin soft-delete (R8.2) is the proportionate control.                                                                                                                 |
| **Direct messaging**                                     | A separate product with its own privacy, retention, moderation, and notification surface. Private sessions (R4) cover the "I need one-to-one time" need this would otherwise serve.                                         |
| **Mobile apps**                                          | The member panel is responsive; native apps are a distinct delivery pipeline, release cadence, and review process.                                                                                                          |
| **Public / SEO-indexed community**                       | Content is cohort-gated by design. A public tier needs a separate rendering, caching, and moderation posture.                                                                                                               |
| **File and image uploads**                               | Requires object storage, size/type validation, malware scanning, quota, and CDN. Markdown linking to externally hosted images covers the actual need; avatars come from existing user profiles.                             |
| **Rich WYSIWYG editor**                                  | The audience writes markdown. A WYSIWYG introduces a second content representation and a second sanitization path — directly at odds with NFR-S2.                                                                           |
| **YouTube OAuth, uploads, channel write access**         | Settled at Checkpoint 0: unlisted videos plus a read-only API key. Write access is a materially larger security and consent surface.                                                                                        |
| **A separate Google Meet integration**                   | The Calendar API already returns the Meet link on event creation, and `BuildersSession.meetLink` already resolves it. Building a Meet integration would be building something that already exists (R4.1).                   |
| **Automated GitHub access provisioning for packs**       | Needs a GitHub App, org-level permissions, and an invite reconciliation loop. This task moves the _discovery and link-delivery_ channel in-product (R5); granting access stays a manual GitHub operation, exactly as today. |
| **Email digests / notification emails**                  | Follows from excluding reply-by-email. In-app notifications (R10) are the v1 channel.                                                                                                                                       |
| **Gamification (badges, streaks, leaderboards)**         | Unvalidated engagement mechanics; adds schema and UI weight before the platform has proven usage.                                                                                                                           |
| **i18n / multi-language**                                | Single-language cohort today; retrofitting is tractable and premature now.                                                                                                                                                  |
| **Polls, wikis, topic templates, post revision history** | Discourse features with no demonstrated demand across 17 topics of real usage.                                                                                                                                              |

---

## Assumptions

Decisions taken autonomously where the evidence was ambiguous. Each states its
reasoning so a later pass can overturn it deliberately rather than by accident. Where
an assumption is load-bearing for a requirement, that requirement cites it. **None of
these reopens a settled Checkpoint 0 decision.**

### A-1 — Packs are visible to every member; `cohortKey` stays a label

`packs.types.ts` warns in bold that the registry gates nothing and that `cohortKey` is
"A BOOKKEEPING LABEL, NOT AN ACCESS CONTROL." A member-facing view forces the question
of what to filter on.

**Decision:** add an explicit admin-controlled member-visible flag on `Pack`; every
flagged pack is shown to every entitled member. `cohortKey` continues to grant and
revoke nothing and is displayed, at most, as a label.

**Reasoning:** real access is enforced by GitHub, not by us — filtering the _list_ by
cohort would create the illusion of an access control we do not implement, which is
worse than showing a link that GitHub then denies. In a paid cohort of a few hundred
engineers, seeing that another cohort's pack exists is not a leak; it is a reason to
ask for access. The explicit flag gives admins the one control they actually need
(hide work-in-progress packs) without promoting a bookkeeping field into a security
boundary. R5.6 requires the docblock be rewritten to match this.

### A-2 — Entitlement and cohort are separate predicates

`context.md` flags `isBuildersMember` as duplicated, but not what it should mean.

**Decision:** entitlement (may this person enter `/members` at all) derives from
`License` / `Subscription`. Cohort (which gated content they see) derives from
`MemberGroupAssignment`. An entitled member with no assignment sees all
`member`-visibility content and no `cohort`-gated content, and does not error (R7.8).

**Reasoning:** conflating them means a data-entry omission — forgetting to assign a
new member to a group — silently locks a paying customer out of the entire product.
Separating them makes the failure mode "missing some content" rather than "denied
access", which is the correct direction for a paid cohort.

### A-3 — HTTP DTOs follow the existing module convention; Zod covers everything else

The repo standard states Zod at all boundaries; `libs/api/community` currently uses
class-validator DTOs (`dto/*.dto.ts`) under a global `ValidationPipe`, and the branch
`ak/license-server-validation-pipe` suggests related work in flight.

**Decision:** new HTTP DTOs use class-validator, matching the surrounding module. Zod
is mandatory and non-negotiable for third-party API responses (YouTube, Calendar) and
the migration JSON. Both mechanisms SHALL NOT be mixed within a single module.

**Reasoning:** a validation rewrite is not this task's job, and a module with two DTO
idioms is harder to audit than one with a documented seam. The genuinely dangerous
boundaries — data we do not control — get Zod either way. If the in-flight branch
lands a module-wide Zod migration first, this assumption should be revisited before
Phase 2 rather than partially applied.

### A-4 — Unmatched migration authors fall back to a system author

19 posts, and Discourse usernames may not all map to `User` records.

**Decision:** attribute unmatched posts to a designated staff/system author, log every
unmatched username in the import summary, and never fabricate `User` records.

**Reasoning:** at 19 posts, blocking the entire migration on a manual mapping table is
disproportionate, and the logged report makes reattribution a small follow-up. Creating
placeholder users would pollute the member table — the one table entitlement is derived
from (A-2) — which is a materially worse outcome than a mis-attributed seed post.

### A-5 — The member panel is a new `libs/web/members` lib

`libs/web/panel-ui` and `libs/web/admin` are consumed by `apps/ptah-landing-page`, and
`/members` is specified to mount the way `/admin` does.

**Decision:** a new `libs/web/members` lib mounted in the landing-page app alongside
`/admin`, rather than a separate application.

**Reasoning:** it inherits the shell, themes, build, auth session, and deploy pipeline
that already exist, and keeps the shared-shell rule (R9.1) structurally enforced rather
than merely stated. A separate app would duplicate all of that for no benefit at this
scale.

### A-6 — Read state is a per-member-per-topic marker

**Decision:** store one last-read marker (timestamp or post number) per member per
topic; derive unread counts from it. No per-post read-receipt rows.

**Reasoning:** at 500 members and low-thousands of topics this is a small table with an
obvious index, whereas per-post receipts grow multiplicatively for a feature nobody can
see. R1.6.6 makes this a requirement.

### A-7 — Search is Postgres-native, starting with trigram matching

**Decision:** implement R1.7 with Postgres `ILIKE` plus a trigram index. If ranking
quality proves insufficient in use, migrate to `tsvector` full-text search — a
contained change behind the same endpoint. No external search infrastructure.

**Reasoning:** at low-thousands of rows both options meet NFR-P3 comfortably; the
cheaper one ships first and the upgrade path does not change the contract.

### A-8 — Reactions apply to forum posts only; lesson comments use "answered"

**Decision:** reactions (R1.4) attach to topics and replies. Lesson comments get the
"answered" marker (R2.5.3) instead of reactions.

**Reasoning:** the Checkpoint 0 decision to avoid polymorphic comment tables applies
equally to reactions — supporting both would mean a second reaction table for a
low-volume surface. The approved `course_learning` screens show an "Answered" check,
not reaction counts, so this matches the design evidence as well as the data model.

### A-9 — Documented gap: four source files were unreadable during requirements work

`packs/packs.types.ts`, `google-sessions/google-sessions.types.ts`,
`libs/web/panel-ui/src/index.ts`, and `libs/web/admin/src/lib/admin.routes.ts` were
blocked at the permission layer. Their relevant contents were supplied inline by the
coordinator and are quoted throughout this document, but they were not read directly.

**Implication for the architect:** verify the exact shape of `PackResponse`,
`BuildersSession` / `AdminSession`, the `@ptah-web/panel-ui` export surface, and
`ADMIN_ROUTES` against the source before designing against them. Nothing in this
document should be taken as a verbatim quotation of those four files.

---

## 6. Risks and open questions for the architect

### 6.1 Open questions

Structural decisions deliberately left to the architect. These are technical shape
questions, not product questions — every product-level ambiguity is resolved above
under [Assumptions](#assumptions).

| #        | Question                                                                                                                                                                                                     | Options                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-1** | **`SessionRequest` ↔ Calendar linkage.** The model has no `calendarEventId` and no `meetLink`; without them an accepted request cannot be reconciled, rescheduled, or cancelled (R4.6).                      | (a) Two nullable columns on `SessionRequest`. (b) A separate `ScheduledSession` record linked to the request. The linkage is a hard requirement; only its shape is open.                                |
| **OQ-2** | **Can `libs/web` consume `libs/frontend/markdown`?** NFR-S2 mandates the single DOMPurify chokepoint, but that lib lives in the extension/webview tree and the two trees are separated by module boundaries. | (a) Add the required Nx tags so `libs/web` can import it. (b) Extract the sanitizer into a shared lib both trees consume. **(c) Author a second renderer — explicitly forbidden.**                      |
| **OQ-3** | **Live session vs Calendar session modelling.** R3 aggregates YouTube-scheduled streams and existing Calendar cohort sessions in one view.                                                                   | (a) One entity with optional YouTube and optional Calendar linkage. (b) Two entities merged at the read model. Affects how replays attach to past Calendar sessions.                                    |
| **OQ-4** | **Hub composition strategy.** R6 requires one request that must not become a fan-out of five slow queries internally.                                                                                        | (a) One composed service issuing parallel queries. (b) A single denormalized read query. Either is acceptable if NFR-P1 holds; state which and why.                                                     |
| **OQ-5** | **Soft-delete mechanics.** R1.2.7, R2.5.5, and R8.5 all require soft-delete with 30-day recovery.                                                                                                            | (a) A nullable `deletedAt` plus query filters. (b) Prisma middleware applying the filter globally. (b) is safer against a forgotten filter but harder to reason about; pick one and apply it uniformly. |

### 6.2 Risk matrix

| #     | Risk                                                                                                                                                             | Probability | Impact   | Score | Mitigation                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RK-1  | **Scope inflation into a forum platform** — rebuilding trust levels, flag queues, digests. The most likely failure mode.                                         | High        | High     | 9     | §5 is normative, not advisory. Any requirement justified only above §1.3 scale is rejected with that reason recorded.                                                     |
| RK-2  | **A second markdown/sanitization path appears** because `libs/frontend/markdown` is awkward to reach from `libs/web`, creating an XSS hole.                      | Medium      | Critical | 8     | OQ-2 answered before frontend work starts; the NFR-S2 lint rule/test lands in the same phase as the first rendered post.                                                  |
| RK-3  | **Membership definition drifts** as new controllers copy the existing duplication.                                                                               | High        | High     | 8     | R7 is a Phase 1 prerequisite; no member controller merges before consolidation, verified by repo-wide search (R7.2).                                                      |
| RK-4  | **Discourse deletion removes surviving logic** — `BuildersMembershipService` lives inside the directory being deleted.                                           | Medium      | High     | 7     | MG-2.2 ordering: relocate and test first, delete second.                                                                                                                  |
| RK-5  | **Packs access story silently regresses.** Deleting Discourse removes the documented link-delivery channel; if R5 slips, members lose access discovery entirely. | Medium      | High     | 7     | R5 is tied to the same release train as Discourse decommissioning; MG-5 is gated on MG-1 verification.                                                                    |
| RK-6  | **YouTube quota exhaustion or key exposure.**                                                                                                                    | Low         | Medium   | 4     | Authoring-time fetch only (NFR-R2); key server-side via `ConfigService`, never shipped to the client; feature-off posture (R2.2.6).                                       |
| RK-7  | **Design drift from the approved screens** — 8 screens each emit their own conflicting Material-3 token set.                                                     | Medium      | Medium   | 5     | `panel-theme-spec.md` is authoritative and already collapses that drift; NFR-U2 forbids raw hex and M3 names in new code.                                                 |
| RK-8  | **Member endpoint leaks admin fields** via type inheritance, exposing other members' emails.                                                                     | Medium      | Critical | 8     | NFR-S4 plus the `BuildersSession` / `AdminSession` precedent; serialization tests assert field absence per contract pair.                                                 |
| RK-9  | **Migration runs against the live container** instead of the committed export, or runs twice.                                                                    | Medium      | Medium   | 5     | MG-1.1 (export only) and MG-1.3 (idempotent), with a total-count assertion (MG-1.6).                                                                                      |
| RK-10 | **Concurrent-agent interference** — the working tree carries unrelated WIP, and `TASK_2026_176` is an unrelated active task in the same specs directory.         | Medium      | Medium   | 5     | Implementers stop and report on out-of-scope failures rather than fixing neighbouring WIP; never bypass hooks with `--no-verify`; never write into another task's folder. |
| RK-11 | **A `/members` catch-all route** copied from the admin pattern exposes arbitrary models.                                                                         | Low         | Critical | 6     | R9.4 explicit prohibition plus an asserting test.                                                                                                                         |
| RK-12 | **Nesting cap enforced only in the UI**, letting migration or the API produce depth-3 trees.                                                                     | Medium      | Medium   | 5     | R1.3.3 requires server-side enforcement; R1.3.4 requires render-side safety for pre-existing data.                                                                        |
| RK-13 | **A-3's validation seam is applied inconsistently** if the in-flight `ak/license-server-validation-pipe` work lands mid-task.                                    | Medium      | Medium   | 5     | Re-check A-3 at the start of Phase 2; adopt whichever mechanism the module standardizes on, wholesale rather than partially.                                              |

### 6.3 Stakeholders

| Stakeholder                | Impact | Involvement         | Success criterion                                                                                     |
| -------------------------- | ------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Builders members           | High   | Use daily           | Can find the current lesson, the next session, and unread discussion in one screen without asking     |
| Operators / staff          | High   | Author and moderate | Can publish a course and accept a session request without database access or a deploy                 |
| Engineering                | Medium | Build and maintain  | One membership definition, one shell, one sanitizer, one theme system; no dead Discourse code         |
| Existing Discourse content | Medium | Migrated            | All 17 topics accounted for — 8 as curriculum, 9 as topics — with authorship and timestamps preserved |

---

## 7. Delivery phases

Ordered so each phase ships something usable on its own. The frontend can build against
stubbed endpoints, so frontend work within a phase does not block on that phase's
backend completing.

### Phase 1 — Foundation: membership, shell, Discourse removal

**Ships:** members can sign into a working `/members` panel.

- R7 in full (membership consolidation, entitlement/cohort split per A-2) — a hard prerequisite for everything after.
- R9 (panel shell, nav groups, explicitly enumerated routes, member guard, theme toggle) in `libs/web/members` per A-5.
- R6 introduced as a single hub endpoint returning only what exists so far; later phases extend it and the request count stays at one.
- MG-2 and MG-3 (delete the Discourse API surface, config, and theme app), keeping the export JSON.
- OQ-2, OQ-4, and OQ-5 answered in the implementation plan before code.

**Exit criteria:** repo-wide search finds one membership implementation and zero Discourse references outside the export; `/members` renders with `PanelLayout` in both themes; the hub responds in one call; `nx lint`, `typecheck`, and tests green.

### Phase 2 — Community

**Ships:** the forum replacement. Discourse can be switched off for real.

- R1 in full (categories, topics, one-level replies, reactions, accepted answers, read state, pinning, search).
- R8 moderation subset (pin, lock, soft-delete, restore, move).
- MG-1 for the 9 non-curriculum topics; MG-5 (decommission the container, `301` the domain) once verified.
- NFR-S2's sanitizer chokepoint lands here with its enforcing test — this is the first phase that renders user content.
- Re-check A-3 against the state of the validation branch (RK-13).

**Exit criteria:** a member can create a topic, reply one level deep, react, and see accurate unread counts; migrated topics render with original timestamps; no second markdown path exists.

### Phase 3 — Courses and YouTube

**Ships:** the curriculum, correctly structured — the reason this task exists.

- R2 in full (hierarchy and ordering, YouTube metadata, progress, locked modules, lesson comments).
- R8 authoring subset (course/module/lesson CRUD, reorder, publish).
- MG-1 for the 8 "Week N build thread" topics as the seeded first course.
- Hub extended with continue-learning state.

**Exit criteria:** the 8 week threads render as an ordered course; completion tracks from persisted duration; a locked module returns `403` from the API, not merely a CSS state.

### Phase 4 — Live and private sessions

**Ships:** self-service scheduling; the operator stops brokering by hand.

- R3 in full (scheduled streams, replays, existing Calendar sessions aggregated).
- R4 in full (request → accept → Calendar event → Meet link), including the OQ-1 linkage fields.
- R8 session queue management.
- Hub extended with the next upcoming session.

**Exit criteria:** an accepted request produces a Calendar event whose Meet link is persisted and reconcilable on reschedule and cancel; with `GOOGLE_OAUTH_*` unset nothing `500`s.

### Phase 5 — Packs, notifications, and closeout

**Ships:** the replacement pack-delivery channel and attention management.

- R5 in full, implementing A-1 and rewriting `packs.types.ts` to match.
- R10 in full (notifications, `badgeCount` on the nav item, retention pruning).
- Hub extended with packs.
- MG-4 (Seshat harness skills) with the explicit changed/removed list.
- Full pass against NFR-P, NFR-U, and accessibility; e2e coverage for every member surface.

**Exit criteria:** members reach every pack repo link without Discourse; the unread notification count is accurate on the nav badge; no Discourse reference remains in either repository.
