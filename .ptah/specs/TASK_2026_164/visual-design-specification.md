# Ptah Admin Dashboard — Visual Design Specification

**TASK_2026_164 · Full IA + Product Overhaul**
Author: ui-ux-designer · Source of truth: `admin-audit-notes.md` + live code read of `apps/ptah-landing-page/src/app/pages/admin/**`, `admin-models.config.ts`, `admin-api.service.ts`, and the backend `apps/ptah-license-server/src/admin/**`.

> **Token-source correction (read first):** `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md` describes a stale "Anubis" gold/Cinzel theme. The **live** daisyUI theme in `apps/ptah-landing-page/tailwind.config.js` is named **`operator`** — a single dark theme (`darkTheme: 'operator'`, only one theme registered), Inter-only (`'display' (Cinzel) REMOVED` is literally commented in the config), with an `ink` neutral scale + `amber` primary + `emerald` secondary. This spec is written against `operator`, the actual live tokens, not the marketing doc. Section 7 flags one real bug in that config (`warning` is hex-identical to `primary`) and proposes a one-line fix.

---

## 1. Redesign Thesis

The current dashboard is organized around **what the database contains** (9 Prisma models rendered through one identical generic table) instead of **what an admin needs to do** (clear the waitlist queue, keep licenses healthy, put out ops fires, manage members, stay compliant). The data and every mutation are real and already wired to `ptah-license-server` — nothing here is invented. The redesign does not add features; it **re-composes existing endpoints into purpose-built surfaces** and gives the product a visual system it currently lacks (no icons, no status-color semantics, no empty states, inconsistent loading patterns).

**From** → a flat sidebar of "Overview / Marketing / Community / 9 model tables," a passive wall of stat tiles, and four high-value workflows (waitlist invite→approve, license issuance, marketing sends, user offboarding) buried behind row-click modals.

**To** → a command-center Overview that leads with what needs attention _today_, five task-oriented navigation groups that mirror the actual jobs an operator does, bespoke workflow views for the four models that carry real operational weight (Waitlist, Users, Licenses, Failed Webhooks), and a single consistent visual language (status-color semantics, iconography, empty/loading/error patterns, spacing rhythm) applied everywhere — including the models that correctly stay on a polished generic table.

---

## 2. New Information Architecture

### 2.1 Grouping rationale

Every existing surface (9 `AdminModelSpec` entries + Overview + Groups + Marketing's 2 sub-routes) is re-homed under five groups, each answering one operator question:

| Group                    | Question it answers                    | Contains                                                                     |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------------------------- |
| **Command Center**       | "What needs my attention right now?"   | Overview                                                                     |
| **Growth**               | "How do we get more Builders members?" | Waitlist (bespoke), Marketing Compose (bespoke), Campaign History, Templates |
| **Revenue & Licensing**  | "Is billing/licensing healthy?"        | Licenses (bespoke), Subscriptions (generic)                                  |
| **Operations**           | "What's broken and needs a human?"     | Failed Webhooks (bespoke), Session Requests (generic)                        |
| **People & Community**   | "Who are our users and cohorts?"       | Users (bespoke), Member Groups (existing dedicated view)                     |
| **Records & Compliance** | "What happened, for the record?"       | Audit Log (generic)                                                          |

This directly satisfies the audit's design goal #5 (re-architect sidebar IA) and goal #2 (bespoke views for the top ~4 models: **Waitlist, Users, Licenses, Failed Webhooks** — exactly the four the orchestrator named).

### 2.2 Nav tree

```
▣ Command Center
   Overview                              /admin/overview

▲ Growth
   Waitlist Pipeline            ★        /admin/waitlist
   Compose Campaign             ★        /admin/marketing/compose
   ─ Campaign History                    /admin/marketing-campaigns
   ─ Email Templates                     /admin/marketing-campaign-templates

▤ Revenue & Licensing
   Licenses                     ★        /admin/licenses
   ─ Subscriptions (Paddle)               /admin/subscriptions

⚠ Operations
   Failed Webhooks              ★        /admin/failed-webhooks
   ─ Session Requests                     /admin/session-requests

◔ People & Community
   Users                        ★        /admin/users
   ─ Member Groups                        /admin/groups

▥ Records & Compliance
   ─ Audit Log                            /admin/admin-audit-log
```

`★` = primary (bespoke, high-frequency) item — rendered with icon + medium weight + always expanded.
`─` = secondary/utility item — rendered smaller, `text-ink-400`, indented, inside a collapsed-by-default disclosure per group (default state: **open** for Growth/Revenue/Operations/People since each has ≥1 secondary item admins visit often; Records & Compliance has no primary item so it renders as a flat single link, no disclosure).

Route slugs for the four bespoke views (`waitlist`, `licenses`, `failed-webhooks`, `users`) intentionally **keep the same `AdminModelKey` slugs** the backend already expects — only the _component_ behind the route changes (bespoke instead of generic `AdminList`/`AdminDetail`). No backend routing changes required for navigation.

### 2.3 Sidebar visual spec

- Group header: `text-xs font-semibold uppercase tracking-wide text-ink-500`, `mt-6 mb-2 px-2` (first group `mt-0`), preceded by a `lucide-angular` icon (20px, `text-ink-500`) — see icon table in §7.6.
- Primary item: `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-base-content hover:bg-base-200`, active state `bg-amber-500/10 text-amber-400 border-l-2 border-amber-500 -ml-0.5 pl-3`, leading lucide icon 18px.
- Secondary item: same shape, `text-[13px] text-ink-400 font-normal py-1.5 pl-8` (no icon, indented under the primary sibling), active state `text-amber-400 bg-base-200`.
- Read-only badge (`ro`) keeps current placement but restyle as `badge badge-ghost badge-xs text-ink-500` instead of default badge styling.
- Sidebar width unchanged (`w-64`), drawer/mobile behavior unchanged (`admin-layout.html` structure is sound — only the `<ul>` contents change).

---

## 3. Command-Center Overview Redesign

### 3.1 Data reality check

`GET /api/v1/admin/stats` (`admin.service.ts:280-330`) currently returns **only**: `waitlist{total,notified,converted,last7Days}`, `members{builders,community}`, `groups[]`, `updatedAt`. There is **no** time-series field and **no** counts for unresolved failed-webhooks, past-due subscriptions, or pending session-requests. The audit's "Needs attention" queue therefore has two tiers:

- **Buildable today, zero backend changes**: waitlist-not-yet-invited (`total - notified`, already computed client-side today).
- **Requires a backend addition** (flagged once here, referenced from §8 as a P0 cross-team item): extend `GET /admin/stats` with an `attention` block:
  ```ts
  attention: {
    waitlistUninvited: number; // = waitlist.total - waitlist.notified (server can compute, or client keeps deriving it)
    failedWebhooksUnresolved: number; // COUNT WHERE resolved = false
    subscriptionsPastDue: number; // COUNT WHERE status = 'past_due'
    sessionRequestsPending: number; // COUNT WHERE status = 'pending'
  }
  ```
  These are cheap `count()` queries, same pattern already used for `waitlist.notified`/`waitlist.converted` in `admin.service.ts:319-321`. Until this ships, the queue renders those three rows in a **visibly "not wired" state** (see §3.4) rather than fake zeros — never fabricate a number the backend hasn't confirmed.

No charting library is introduced (see §8 "Charting note"). The funnel is a plain CSS/flex segmented bar; there is no time-series to chart yet.

### 3.2 Layout (top to bottom, `flex flex-col gap-6`, same page shell as today)

```
┌─────────────────────────────────────────────────────────────────┐
│ Overview                                    Updated 2 mins ago   │  ← header, unchanged pattern
├─────────────────────────────────────────────────────────────────┤
│ NEEDS ATTENTION                                                  │  ← NEW, top priority, first below header
│ [ 12 not yet invited ] [ ? unresolved webhooks ] [ ? past due ]  │
│ [ ? pending sessions ]                       each → deep link    │
├─────────────────────────────────────────────────────────────────┤
│ BUILDERS WAITLIST                                                │  ← hero funnel, redesigned
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ████████████████░░░░░░░░░░░░  Total 340                  │  │
│  │  ██████████░░░░░░░░░░░░░░░░░░  Notified 210 (62%)         │  │
│  │  ████░░░░░░░░░░░░░░░░░░░░░░░░  Converted 84 (24.7%)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  hero number: 24.7% conversion   +18 signups last 7 days         │
├─────────────────────────────────────────────────────────────────┤
│ MEMBERS                          │  COHORTS                      │
│ [Builders] [Community] [Total]   │  [group tiles...] → /groups   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 "Needs Attention" queue — component spec

New component: `apps/ptah-landing-page/src/app/pages/admin/overview/needs-attention-queue/needs-attention-queue.ts`.

- Container: `rounded-lg border border-amber-500/20 bg-base-200 p-4`, section label `text-xs font-semibold uppercase tracking-wide text-ink-400 mb-3` reading "Needs Attention".
- Each row is a horizontal action card, not a stat tile — it reads like a to-do, not a metric:
  `flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-base-300 transition-colors`, wrapped in `routerLink` (whole row clickable).
- Left: lucide icon in a 32px rounded-full well colored by urgency (`bg-error/10 text-error` for hard-broken things like unresolved webhooks, `bg-warning/10 text-warning` for pending/aging items) + label + one-line context (`text-xs text-ink-400`).
- Right: count badge (`text-lg font-bold tabular-nums`) + chevron-right icon.
- **Zero-state per row**: if the count is `0`, do not render an urgent-red row — render it collapsed into a single muted "All caught up" line so the panel doesn't cry wolf. If **all four** are zero, replace the whole panel with a compact success strip: `bg-success/10 text-success text-sm rounded-md px-3 py-2 flex items-center gap-2` + `CheckCircle2` icon + "Nothing needs attention."
- Rows, in priority order:
  1. **Waitlist not yet invited** → icon `UserPlus`, links to `/admin/waitlist?tab=new`. _(buildable now)_
  2. **Unresolved failed webhooks** → icon `AlertTriangle`, error-tinted, links to `/admin/failed-webhooks`. _(needs `attention.failedWebhooksUnresolved`)_
  3. **Subscriptions past due** → icon `CreditCard`, warning-tinted, links to `/admin/subscriptions`. _(needs `attention.subscriptionsPastDue`)_
  4. **Pending session requests** → icon `CalendarClock`, warning-tinted, links to `/admin/session-requests`. _(needs `attention.sessionRequestsPending`)_
- **Pre-backend-addition rendering** for rows 2–4: instead of a count, render a ghost/skeleton pill with `text-ink-500` reading "—" and a `title` tooltip "Backend aggregate pending (see spec §3.1)" so the UI never claims a false zero. This lets frontend-developer ship the layout immediately and have it "light up" the moment the backend field exists (pure conditional on `stats.attention?.x != null`).

### 3.4 Hero funnel — component spec

New component: `apps/ptah-landing-page/src/app/pages/admin/overview/waitlist-funnel/waitlist-funnel.ts`. Pure presentational, inputs `{ total, notified, converted, last7Days }`.

- Three horizontal segmented bars, one per funnel stage, each `h-8 rounded-md bg-base-300 overflow-hidden relative`, with an inner `div` whose `[style.width.%]` = `stage/total*100` (min 2% so a non-zero stage is never invisible), colored: Total = `bg-ink-600` (baseline/neutral), Notified = `bg-info`, Converted = `bg-success`. Label + raw count sits left of each bar (`w-32 shrink-0 text-sm text-ink-300`), percentage sits inside/right of the filled segment (`text-xs font-medium`, flips to `text-base-content` outside the bar if the fill is too narrow to hold white text — implement as `[class.pl-2]="pct < 15"` swap between inside/outside label placement).
- Below the three bars: one **hero stat** — conversion % — gets the biggest type in the whole page: `text-4xl md:text-5xl font-bold tabular-nums text-base-content`, with a small delta chip beside it: `+{{last7Days}} signups · last 7 days` (`badge badge-info badge-outline text-xs`).
- "Not yet invited" is **not** repeated here (it now lives in the Needs Attention queue) — Overview no longer shows the same number in two places, closing the audit's "no hierarchy, everything same weight" complaint by explicitly demoting it from a stat tile to an action-queue row.

### 3.5 Members + Cohorts row

- Members: 3 tiles using the new `StatTile` component (§8, item 4) — Builders, Community, Total — each clickable, deep-linking `Builders` → `/admin/users` is not filterable today (no tier field on User; tier lives on License), so instead link **Builders** tile → `/admin/licenses?plan=builders&status=active` intent (client-side: navigate to Licenses bespoke view, which the admin can then eyeball/search — do not fabricate a filter param the backend doesn't support; see §4.3). Community tile is informational only (no drill target — Community has no dedicated list). Total tile is informational only.
- Cohorts: keep existing tile-per-group pattern but upgrade to `StatTile`, each links to `/admin/groups` (existing "Manage groups →" link stays, promoted to a proper `routerLink` button in the section header).

### 3.6 States

- **Loading** (first paint, no cached stats): full skeleton — Needs Attention panel skeleton (4 pulse rows), funnel skeleton (3 pulse bars), member/cohort tile skeletons. Reuses the existing `animate-pulse bg-base-200` pattern already in `overview.html:20-25`, just extended to cover the new sections.
- **Error**: unchanged `alert alert-error` + Retry button pattern (already correct, keep verbatim).
- **Partial data** (stats loaded, `attention` block absent because backend hasn't shipped yet): see §3.3 pre-backend rendering — this is a first-class, designed state, not a loading spinner stuck forever.

---

## 4. Bespoke Workflow Views — the top 4 models

Design principle shared by all four: **the list is a queue, the detail is a workspace, and the destructive/high-stakes action gets a stepper, not a bare button.**

### 4.1 Data-contract prerequisite (read before implementing any of the four)

None of the four models' list endpoints support filtering by field value today — `ListQueryDto` (`admin.dto.ts:24-51`) only has `page/pageSize/sortBy/sortOrder/search`, and `AdminService.buildSearchWhere` (`admin.service.ts:364-384`) only does a full-text `contains` OR across `searchFields`. Tab/segment filtering (New/Invited/Converted, Unresolved/Resolved, etc.) needs real server-side filtering to be correct at scale.

**Recommended backend addition** (one shared mechanism, unlocks all four views): a `filter` query param + a small per-model allowlist, mirroring the existing `searchFields`/`sortableFields` allowlist pattern already in the backend's `admin-models.config.ts`. E.g. `GET /admin/waitlist?filter=status:new`, `GET /admin/failed-webhooks?filter=resolved:false`. This is flagged once here and again in §8 as a P0 cross-team prerequisite — it is **not** a blocking ambiguity (the shape is fully specified), just backend work outside this spec's scope.

**MVP fallback per view** (ships today, no backend change) is documented in each subsection below so frontend-developer isn't blocked waiting on backend.

### 4.2 Waitlist — Invite → Approve pipeline

Route: `/admin/waitlist`. New component `pages/admin/waitlist/waitlist-pipeline.ts(+html)`.

**Why not a drag-drop kanban**: stage transitions (`new`→`invited`→`converted`) are system-driven (an email send stamps `notifiedAt`; a Paddle checkout stamps `convertedAt`), not manual — a draggable board would imply an affordance that doesn't exist. Use a **segmented-tab queue** instead.

- Header: title + total count (existing pattern) + a summary strip of 3 numbers (New / Invited / Converted, reusing the funnel's math) rendered as small inline stats, not full tiles — the full funnel already lives on Overview; here it's just orientation.
- Tabs: daisyUI `tabs tabs-boxed` — `New` | `Invited` | `Converted` | `All`, `?tab=` query param synced (so Overview's deep link `/admin/waitlist?tab=new` lands correctly).
  - **With backend filter (§4.1)**: each tab issues `list('waitlist', {filter: 'status:new', ...})`.
  - **MVP fallback**: `New` tab = `sortBy=notifiedAt&sortOrder=asc` (nulls surface first in ascending order on most Postgres/Prisma configs — confirm with backend-developer at implementation time; if nulls sort last instead, use `desc`) with a client-side visual note "showing oldest un-invited first" rather than a true filter; `Converted` tab = `sortBy=convertedAt&sortOrder=desc`; `All` = default. Label the fallback tabs honestly (no fake "filtered" claim) until §4.1 ships.
- Row card (replaces raw table row): `email` (font-medium) + `source` badge (existing warning/info/ghost mapping, reused via new `StatusBadge` component) + `Joined <date>` (`text-xs text-ink-400`) + right-aligned action area that **changes per tab**:
  - New tab: checkbox (bulk-select) — selection feeds the **Selection Toolbar** (§6.1) which surfaces "Send Founding Invites" (bulk, reuses `WaitlistInviteModal`) plus a persistent "Invite oldest N" quick action that needs **no selection** (visible even with 0 rows selected), since routine invite batches are the common case.
  - Invited tab: `notifiedAt` timestamp + a single inline button **"Approve → Builders"** (opens `IssueCompLicenseModal` pre-bound to the row's `email`, i.e. the existing Early-Adopter-approve flow, just promoted from "click into detail" to "one click from the queue").
  - Converted tab: `convertedAt` timestamp + "View license →" link that navigates to `/admin/licenses` with the email prefilled into that view's search box (client-side query-param handoff, no backend change).
- Empty states (per tab, not generic): New-empty → celebratory "Nobody's waiting — you're caught up" with `PartyPopper` icon; Invited-empty → "No pending invites"; Converted-empty (only possible pre-launch) → "No conversions yet."

### 4.3 Licenses — issuance & lifecycle

Route: `/admin/licenses`. New component `pages/admin/licenses/licenses-list.ts(+html)` (list) — detail can stay a lightly-forked `admin-detail` (see §4.3.3) since the read/edit form shape is already close to right.

**4.3.1 List**

- Header gets a **primary page action**: "Issue Complimentary License" button (`btn btn-primary btn-sm`, promoted from buried-in-user-detail to a first-class list action) — opens `IssueCompLicenseModal` in a **new "search" mode**: add an optional recipient combobox (type-ahead against `AdminApiService.list('users', {search, pageSize:5})`) when the modal is opened without a bound `userId`/`email` input, so an admin can issue a license from the Licenses view without first hunting down the user record. (Modal input contract: add `mode: 'bound' | 'search'`; `bound` = current behavior unchanged for the Users-detail and Waitlist-approve call sites.)
- Row-level polish (all client-computed, zero backend change):
  - **Expiring-soon**: rows where `expiresAt` is within 14 days get a left border accent `border-l-2 border-warning` + a small `Expiring soon` badge next to the date.
  - **Status semantics**: replace the plain-text status cell with `StatusBadge`, mapping driven by a new `badgeMap` on the `licenses` field spec (see §7.3 table) — confirm exact enum values against the Prisma `License.status` column before wiring (do not invent values; this spec defines the _color mapping strategy_, not the literal string list).
  - **Source badge**: reuse existing complimentary/manual/paddle mapping (already correct in `data-table.html:98-107`), just move it into `StatusBadge` for consistency.
- Sort defaults to `expiresAt asc` so lapsing licenses surface first — no backend change (already a sortable field).

**4.3.2 Empty/loading/error**: standard skeleton-row table loading (§7.5), standard error+retry, empty state "No licenses match — try clearing filters" (filtered) vs "No licenses issued yet" (true empty, only reachable pre-launch).

**4.3.3 Detail — "Lifecycle" card**
Keep `admin-detail`'s generic read/edit split for this model (fields: plan, status, expiresAt are all it has — a full fork isn't justified), but add one enhancement above the edit form: a row of **quick-set buttons** — `Extend 30d` / `Extend 1y` / `Revoke` / `Reinstate` — that populate `expiresAt`/`status` into the existing form fields (client-side convenience, still submits through the same `PATCH` the form already does). Style: `btn btn-outline btn-xs` row, `flex flex-wrap gap-2`, placed directly under the "Edit" card title, above the field grid.

### 4.4 Users — profile + drill-down

Route: `/admin/users` (list, enhanced-generic is fine — see below) and `/admin/users/:id` (new bespoke profile, replaces `admin-detail` for this model only).

**4.4.1 List** stays close to today's generic table (email/name/verified/dates are already reasonable columns) but:

- Verified boolean rendered via `StatusBadge` (success/ghost) instead of ad hoc yes/no badges.
- Bulk-email button moves into the new **Selection Toolbar** pattern (§6.1) instead of a static disabled-until-selected header button.

**4.4.2 Profile (detail) — the actual bespoke surface**
New component `pages/admin/users/user-profile/user-profile.ts(+html)`, replacing `AdminDetail` for the `users` route only.

Layout: three stacked cards instead of one generic `<dl>` grid.

1. **Identity card** — avatar-initial circle (`w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center font-semibold text-lg`, initials from first/last name or email prefix) + name/email header + `StatusBadge` for `emailVerified` + a muted metadata row (WorkOS ID, Paddle Customer ID, Created/Updated — monospace, `text-xs text-ink-400`, the low-value IDs demoted here instead of taking equal visual weight in a flat field list).
2. **Related records card** — three mini-lists (Licenses / Subscriptions / Session Requests), each fetched via the **existing** `AdminApiService.list(model, { search: userId, pageSize: 5 })` — every one of those three models' `searchPlaceholder` already advertises "…user ID…" as a searched field, so an exact-UUID `contains` search is a reliable poor-man's join with **zero backend changes**. Each mini-list: up to 5 rows, compact (`text-sm`), status-badged, with a "View all →" link to the parent bespoke/generic view pre-filled with the same search term. Empty sub-list: one muted line, e.g. "No licenses issued to this user."
3. **Danger zone card** — `border border-error/20`, contains "Issue Complimentary License" (`btn btn-outline btn-primary btn-sm`) and "Delete User" (`btn btn-outline btn-error btn-sm`), visually separated (`mt-2 pt-4 border-t border-base-300` divider before the delete button) so a destructive action never sits at equal visual weight next to a benign one.

**4.4.3 Delete-User modal → 2-step stepper**
Restructure `delete-user-modal.ts/html` (logic unchanged, template restructured) into an explicit stepper:

- Step pill header: two 24px numbered circles connected by a line (`bg-amber-500 text-base-100` when active/complete, `bg-base-300 text-ink-500` when pending) — "1 Review Impact" → "2 Confirm".
- **Step 1 (Review Impact)** — auto-loads today's `preview()` cascade counts, the paid-subscription warning + acknowledge checkbox, and the admin-self block, exactly as today, just visually promoted to its own step instead of being crammed above the confirm input.
- **Step 2 (Confirm)** — only the type-to-confirm email input + final Delete button. Cannot reach step 2 while `isAdminSelf` is true (button stays disabled with the error already shown in step 1).
- Keep the existing "failed webhooks retained for audit" note, now as a step-1 footnote.

### 4.5 Failed Webhooks — ops triage

Route: `/admin/failed-webhooks`. New component `pages/admin/failed-webhooks/webhooks-triage.ts(+html)`.

- Default sort: `resolved asc, attemptedAt desc` (unresolved bubble to the top) — works today if `resolved` is in the backend's `sortableFields` allowlist for this model; confirm at implementation time, otherwise fall back to `attemptedAt desc` and rely on the visual resolved/unresolved split below.
- Each row: `eventType` (font-medium) + truncated `errorMessage` (existing 280px truncate, keep) + `StatusBadge` for `resolved` (error = unresolved/needs action, success = resolved) + a **High retries** chip (`badge badge-warning badge-outline badge-xs`, client-computed when `retryCount >= 3`) + `attemptedAt` relative-ish timestamp.
- **Row click → slide-over drawer**, not full navigation. New reusable component `pages/admin/components/detail-drawer/detail-drawer.ts` (a right-side `fixed inset-y-0 right-0 w-full max-w-lg bg-base-200 border-l border-base-300 shadow-2xl` panel with backdrop, reusable beyond this view). Drawer contents: event metadata, `stackTrace` in a scrollable monospace block (`max-h-64 overflow-auto font-mono text-xs bg-base-300 rounded-md p-3`), `rawPayload` JSON pretty-printed in a collapsible `<details>` block, and two primary actions:
  - **"Mark Resolved"** — one click, `PATCH {resolved: true, resolvedAt: new Date().toISOString()}` — replaces exposing the raw `resolved` toggle + `resolvedAt` datetime-local input to ops staff (that pairing is meaningless to set manually; automate the timestamp).
  - **"Copy payload"** — copies `rawPayload` JSON to clipboard for manual replay/debugging.
- **Bulk resolve**: select multiple unresolved rows (Selection Toolbar, §6.1) → "Mark Resolved (N)". No bulk-PATCH endpoint exists; implement as a client-side sequential/parallel loop over the existing single-record `PATCH /failed-webhooks/:id` (mirrors the pattern `AdminApiService` already uses for other multi-target actions), capped at the current page size (25–100) with a progress toast ("Resolved 8/12…").
- Zero-unresolved empty state: celebratory, `CheckCircle2` icon, "All webhooks resolved."

---

## 5. Keep-Generic List

Stay on the (polished) generic `AdminList`/`AdminDetail`/`DataTable` pipeline — these are low-traffic, low-interaction, or intentionally read-only records where a bespoke view would be over-engineering:

| Model                            | Why generic is right                                                                                                                 | Polish applied                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Subscriptions**                | Read-only Paddle mirror; admins reference, don't act on it directly (billing changes happen in Paddle)                               | `StatusBadge` for `status` (active/trialing/past_due/paused/canceled mapping, confirm enum against Paddle status values)                         |
| **Session Requests**             | Has a lifecycle but lower volume/urgency than the top 4; good P2 candidate for a future bespoke triage view once volume justifies it | `StatusBadge` for `status` + `paymentStatus`, sort default `scheduledAt asc`                                                                     |
| **Admin Audit Log**              | Read-only compliance/forensics record — a bespoke view adds no operator value here, only a query tool                                | `StatusBadge` for `action` (create=success, update=info, delete=error), sticky first column (`actorEmail`) since this table has the most columns |
| **Marketing Campaigns**          | Read-only send-results record, already summarized well as counts                                                                     | `StatusBadge`-style treatment on the numeric columns is unnecessary; keep as-is, just adopt the shared empty-state                               |
| **Marketing Campaign Templates** | Simple CRUD, already has its own "New Template" creation route — the generic table is the right list surface for it                  | No change beyond global `DataTable` polish (below)                                                                                               |

### Generic `DataTable` polish (applies to every model above, and remains the base every bespoke view's _related-records_ mini-list borrows from)

1. **Status-badge config, not hardcoded branches.** Today `data-table.html:54-107` hardcodes `source` and a waitlist-specific `notifiedAt` badge inline in the template. Replace with a new optional `FieldSpec.badgeMap?: Record<string, 'success'|'warning'|'error'|'info'|'neutral'|'ghost'>` in `admin-models.config.ts`, consumed by the new shared `StatusBadge` component. This is the single change that makes status-color semantics consistent across every model instead of ad hoc per-field `[class.badge-*]` bindings.
2. **Sticky first column** on horizontal scroll for wide tables (`admin-audit-log`, `failed-webhooks`): `sticky left-0 bg-base-100 z-10` on the first `<td>`/`<th>`.
3. **Empty state**: replace the plain `No records.` text row (`data-table.html:117-124`) with the shared `EmptyState` component (icon + message + optional action), still rendered inside the table body (`colspan` wrapper unchanged) so the table shell doesn't collapse.
4. **Loading**: replace `[class.opacity-50]="loading()"` dimming with real skeleton rows (5 rows × current column count, `animate-pulse` cells) on first load; keep the opacity-dim treatment only for _refetch while data already present_ (pagination/sort changes), where dimming existing rows is the correct, less-jarring pattern.
5. **Density toggle** (P2, optional): a `density = signal<'compact'|'comfortable'>('compact')` on `DataTable`, compact = current `table-sm` (row `py-1.5`), comfortable = default `table` (row `py-3`). Small icon-button toggle (`Rows3`/`Rows4` lucide icons) in the pagination bar.

---

## 6. Guided Flows for Buried Actions

### 6.1 Selection Toolbar (new shared pattern)

New component `pages/admin/components/selection-toolbar/selection-toolbar.ts`, a Gmail-style contextual bar that **replaces** the always-visible-but-disabled-until-selected header buttons currently in `admin-list.html:23-48`.

- Renders only when `selectedIds().length > 0`, slides down from the header (`@if` + a simple CSS transition, no GSAP needed for a utility surface like this — reserve `angular-gsap` for marketing per the existing design system's "Don't" list).
- `flex items-center justify-between rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm`, left side "N selected" + "Clear" ghost link, right side the model-specific action buttons (`Email Selected`, `Send Founding Invites`, `Mark Resolved`, etc. — passed in as `<ng-content>` so this stays a dumb layout shell, not a business-logic component).
- Applies to: Users list (bulk email), Waitlist "New" tab (bulk invite), Failed Webhooks (bulk resolve).

### 6.2 Founding-invite send

Stays a modal (`waitlist-invite-modal.ts`, logic unchanged — the selected/oldest-N radio toggle is already well-designed) but is now launched from the Waitlist Pipeline's "New" tab toolbar (§4.2) instead of a generic list header, and the "Invite oldest N" mode gets a **standalone quick-action button** next to the toolbar that works without any row selection (routine batch invites are the common case and shouldn't require selecting rows first).

### 6.3 Complimentary-license approval / issuance

Two entry points now, one modal, extended input contract:

- **Bound mode** (existing behavior, unchanged): from Waitlist "Invited" tab row (`email` bound) or User Profile Danger Zone (`userId` bound).
- **Search mode** (new): from the Licenses list primary action (§4.3.1) — adds a type-ahead recipient combobox to `issue-comp-license-modal.ts/html` when opened with neither `userId` nor `email` bound.
  The 3-part success flow (form → success view with copyable license key → optional email-sent confirmation) is already well-designed (`issue-comp-license-modal.html:66-105`) — keep verbatim, just extend the entry input.

### 6.4 Cascade-preview user deletion

Covered in §4.4.3 — becomes a 2-step stepper (Review Impact → Confirm) instead of a single dense modal. Logic (`getUserDeletionPreview`, `deleteUser`, the paid-subscription acknowledgment, the admin-self block) is unchanged; only the template is restructured around the step state.

---

## 7. Admin Design System / Tokens

All values below map to `apps/ptah-landing-page/tailwind.config.js`'s live `operator` daisyUI theme. The admin surface should read as a **calm operator console** — denser, quieter, less "marketing hero" than the public site — while staying token-compatible with it (same base palette, same border radii, no new font).

### 7.1 Surfaces

| Token                 | Hex                 | daisyUI class                           | Usage                                                           |
| --------------------- | ------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Page background       | `#08090c`           | `bg-base-100`                           | Outer shell                                                     |
| Panel/card background | `#0e1015`           | `bg-base-200`                           | Cards, sidebar, drawer                                          |
| Elevated/hover/modal  | `#171a21`           | `bg-base-300`                           | Modals, dropdowns, hover states, drawer backdrop-adjacent panel |
| Hairline border       | `#262a33` (ink-700) | `border-base-300` / `border-ink-700/60` | Card borders, table dividers                                    |

### 7.2 Text

| Token                | Hex                 | Class                            | Usage                                              |
| -------------------- | ------------------- | -------------------------------- | -------------------------------------------------- |
| Primary text         | `#e9ebef`           | `text-base-content`              | Headings, primary values                           |
| Secondary text       | `#8b92a1` (ink-400) | `text-ink-400`                   | Labels, meta, muted body                           |
| Tertiary text        | `#5b616f` (ink-500) | `text-ink-500`                   | Placeholders, disabled, timestamps in dense tables |
| Monospace (IDs/keys) | `#8b92a1`           | `font-mono text-ink-400 text-xs` | UUIDs, license keys, event IDs                     |

### 7.3 Status color semantics (the core deliverable of this section)

`operator`'s current `warning: '#f5a524'` is **hex-identical to `primary: '#f5a524'`** — a real bug: any `badge-warning`/`alert-warning`/`btn-warning` is currently visually indistinguishable from a primary CTA. **Recommended one-line fix** to `tailwind.config.js`'s daisyui theme block:

```diff
- warning: '#f5a524',
+ warning: '#eab308',
  'warning-content': '#08090c',
```

(`#eab308` = Tailwind `yellow-500` — reads as "caution/yellow" distinctly from the brand's orange-amber `primary`, keeps AA contrast on `#08090c`, and every existing `badge-warning`/`alert-warning` usage — e.g. `delete-user-modal.html:14`, `data-table.html` source badge — improves for free with zero call-site changes.) This is additive and low-risk; flag to frontend-developer as a P0 pre-req alongside the `badgeMap` field-spec addition, since the whole status system depends on `warning` being a real, distinct color.

Semantic mapping (5 states, reused everywhere via the new `StatusBadge` component):

| Semantic          | daisyUI token                  | Hex       | Meaning                        | Example field values                                                                                                                         |
| ----------------- | ------------------------------ | --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Success**       | `success`                      | `#34d399` | Healthy / done / positive      | License `active`, Subscription `active`, Waitlist `converted`, Webhook `resolved`, User `emailVerified: true`, Session `paymentStatus: paid` |
| **Warning**       | `warning` (post-fix `#eab308`) | `#eab308` | Needs eyes soon, not broken    | License near-expiry, Subscription `past_due`, Session `status: pending`, Webhook `retryCount ≥ 3`, License `source: complimentary`           |
| **Error**         | `error`                        | `#fb7185` | Broken / destructive / stop    | Webhook `resolved: false`, License/Subscription `canceled`/`revoked`/`expired`, Audit `action: delete`                                       |
| **Info**          | `info`                         | `#38bdf8` | Neutral-positive / in-progress | Waitlist `invited`, Subscription `trialing`, License `source: manual`, Audit `action: update`                                                |
| **Neutral/Ghost** | `badge-ghost`                  | —         | Default / no strong signal     | Waitlist `new`, License `source: paddle`, unset/empty fields                                                                                 |

Implementation mechanism: `FieldSpec.badgeMap` on `admin-models.config.ts` (frontend), consumed by `StatusBadge`. Exact enum-to-color assignments for `licenses.status`, `subscriptions.status`, `session-requests.status`/`paymentStatus` must be confirmed against the live Prisma schema by frontend-developer before wiring — this table defines the **mapping strategy**, not invented literal values.

### 7.4 Typography ramp (admin-specific, denser than marketing)

| Role                              | Class                                                        | Notes                                                                                |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Page title                        | `text-xl font-semibold`                                      | Unchanged from current pattern                                                       |
| Hero stat (Overview conversion %) | `text-4xl md:text-5xl font-bold tabular-nums`                | The one number allowed to dominate the page                                          |
| Stat tile value                   | `text-2xl md:text-3xl font-bold tabular-nums`                | Up slightly from today's flat `text-2xl` everywhere, to create a hero/tile hierarchy |
| Section label                     | `text-xs font-semibold uppercase tracking-wide text-ink-400` | Existing pattern, keep                                                               |
| Table header                      | `text-xs font-medium uppercase tracking-wide text-ink-400`   | New — headers currently use default table styling                                    |
| Table cell                        | `text-sm`                                                    | Unchanged                                                                            |
| Meta/caption                      | `text-xs text-ink-500`                                       | Timestamps, IDs, helper text                                                         |
| Body/help text                    | `text-sm text-ink-400 leading-relaxed`                       | Modal descriptions, empty-state copy                                                 |

No display/serif font anywhere in admin — Inter only, matching the corrected live config.

### 7.5 Spacing, radius, density

- 8px grid, page padding `p-4 lg:p-6` (unchanged), section gap `gap-6` (unchanged), card padding `p-4`–`p-6` (denser than marketing's `p-8`), grid gaps `gap-4`.
- Border radius: reuse the theme's existing vars verbatim — `--rounded-box: 0.75rem` (cards/modals), `--rounded-btn: 0.5rem` (buttons/inputs), `--rounded-badge: 999px` (badges/pills). Do not introduce new radii.
- Table density: default **compact** (`table-sm`, ~36px rows); optional **comfortable** toggle (§5, item 5) persisted to `localStorage`.
- Skeleton loading: `animate-pulse bg-base-200 rounded-md`, sized to the target shape (row-shaped for tables, tile-shaped for stats, card-shaped for profile panels) — never a generic spinner-only state for first-paint loads (spinners are fine for in-flight _mutations_, e.g. modal submit buttons, which already do this correctly).
- Empty state: centered, `py-12`, 40px muted icon (`text-ink-500`), one-line message (`text-sm text-ink-400`), optional primary action button below.
- Error state: `alert alert-error` + inline Retry button — the existing Overview/Groups pattern, applied everywhere a fetch can fail.

### 7.6 Iconography (`lucide-angular`)

Admin currently has **zero icons** outside the hamburger SVG. Introduce them at three levels: nav groups, status chips, empty states.

| Context                    | Icon              |
| -------------------------- | ----------------- |
| Command Center (nav)       | `LayoutDashboard` |
| Growth (nav)               | `TrendingUp`      |
| Revenue & Licensing (nav)  | `CreditCard`      |
| Operations (nav)           | `Wrench`          |
| People & Community (nav)   | `Users2`          |
| Records & Compliance (nav) | `ScrollText`      |
| Waitlist item              | `UserPlus`        |
| Licenses item              | `KeyRound`        |
| Failed Webhooks item       | `AlertTriangle`   |
| Users item                 | `UserCircle`      |
| Session Requests item      | `CalendarClock`   |
| Groups item                | `UsersRound`      |
| Success chip               | `CheckCircle2`    |
| Warning chip               | `AlertTriangle`   |
| Error chip                 | `XCircle`         |
| Info chip                  | `Info`            |
| Neutral/pending chip       | `Clock`           |

Sizes: 20px nav-group icons, 18px nav-item icons, 12–14px inline status-chip icons. Color follows the semantic mapping in §7.3, or `text-ink-400` when purely navigational/decorative (`aria-hidden="true"` in that case).

### 7.7 Dark mode

Single-theme product — `tailwind.config.js` registers exactly one daisyUI theme (`operator`) and sets it as `darkTheme`. **Do not build a light-mode toggle for admin.** This matches the rest of the product; the "dark-mode stance" is simply: there is no other mode.

---

## 8. Component / Build Plan

Ordered by dependency — later items assume earlier shared components exist. All paths under `apps/ptah-landing-page/src/app/pages/admin/` unless noted.

**P0 — Shared foundation (build first)**

1. `admin-models.config.ts` — add `FieldSpec.badgeMap?: Record<string, BadgeVariant>` (§7.3); keep 1:1 sync discipline with the backend file per the existing file-header contract.
2. NEW `components/status-badge/status-badge.ts(+html)` — presentational, `[value]`/`[variant]` or `[badgeMap]`+`[fieldValue]` inputs, renders `badge` + lucide icon per §7.3/§7.6. Replaces the hardcoded branches in `components/data-table/data-table.html:54-107`.
3. NEW `components/empty-state/empty-state.ts(+html)` — icon + message + optional action `<ng-content>` slot.
4. NEW `components/stat-tile/stat-tile.ts(+html)` — replaces raw `.stat` markup duplicated in `overview.html`; supports hero-size variant, delta chip, optional `routerLink`.
5. NEW `components/detail-drawer/detail-drawer.ts(+html)` — right-side slide-over shell, reused by Failed Webhooks triage (§4.5) and available for future use.
6. NEW `components/selection-toolbar/selection-toolbar.ts(+html)` — contextual bulk-action bar (§6.1).
7. `admin-layout/admin-layout.html(+ts)` — full rewrite: grouped/collapsible sidebar per §2, lucide icons, primary/secondary tiering. `admin-layout.ts` needs a small `AdminNavGroup[]` config (new file, e.g. `admin-nav.config.ts`) replacing the flat `ADMIN_MODEL_SPECS` iteration currently in the template.
8. **Backend coordination (not this repo's frontend scope, but a hard prerequisite for §4's "with filter" paths)**: (a) add `filter` query param + per-model allowlist to `ListQueryDto`/`AdminService.list`, mirroring the existing `searchFields` allowlist pattern (`admin.service.ts:364-384`); (b) extend `GET /admin/stats` with the `attention` block from §3.1. Both are additive, low-risk, small `count()`/`where` additions consistent with existing service patterns.

**P1 — Command Center**

9. `overview/overview.html(+ts)` — rebuild per §3: integrate `NeedsAttentionQueue` (new, `overview/needs-attention-queue/`), `WaitlistFunnel` (new, `overview/waitlist-funnel/`), and `StatTile` for members/cohorts. Ships against today's `/admin/stats` shape with the graceful-degradation rendering from §3.3 for the not-yet-available `attention` fields.

**P1 — Bespoke workflow views**

10. NEW `waitlist/waitlist-pipeline.ts(+html)` (§4.2) — reuses `WaitlistInviteModal`, `IssueCompLicenseModal` (bound mode), `SelectionToolbar`, `StatusBadge`, `EmptyState`.
11. NEW `users/users-list.ts(+html)` (enhanced-generic list, §4.4.1) + NEW `users/user-profile/user-profile.ts(+html)` (§4.4.2, replaces `AdminDetail` for `users`) — extends `DeleteUserModal`/`IssueCompLicenseModal` (bound mode) call sites.
12. NEW `licenses/licenses-list.ts(+html)` (§4.3.1–4.3.2) — extends `IssueCompLicenseModal` with new `mode: 'search'` + recipient combobox (§6.3). Detail: fork/extend `admin-detail` with the quick-set lifecycle buttons (§4.3.3) — evaluate at implementation time whether a light wrapper around `AdminDetail` or a small dedicated `license-detail.ts` is cleaner; either is acceptable, the requirement is the quick-set buttons + badge treatment.
13. NEW `failed-webhooks/webhooks-triage.ts(+html)` (§4.5) — uses `DetailDrawer`, `SelectionToolbar`, `StatusBadge`.

**P1 — Modal restructuring**

14. `components/delete-user-modal/delete-user-modal.ts(+html)` — restructure into the 2-step stepper (§4.4.3); logic (`preview()`, `confirm()`, acknowledge/admin-self guards) unchanged.
15. `components/issue-comp-license-modal/issue-comp-license-modal.ts(+html)` — add `mode: 'bound'|'search'` input + recipient combobox for search mode (§6.3); success view unchanged.

**P2 — Generic table polish (applies to kept-generic models, §5)**

16. `components/data-table/data-table.ts(+html)` — adopt `StatusBadge` (removing hardcoded branches), `EmptyState`, sticky first column, skeleton-row loading, optional density toggle.
17. `admin-detail/admin-detail.html` — adopt `StatusBadge`/`EmptyState`/skeleton for the models that keep this generic detail view (subscriptions, session-requests, admin-audit-log, marketing-campaigns, marketing-campaign-templates).

**Routing** (`admin.routes.ts`): add explicit routes for `waitlist`, `users` (+`users/:id`), `licenses`, `failed-webhooks` **above** the generic `:model`/`:model/:id` catch-all so they resolve to the new bespoke components; the catch-all remains for the five kept-generic models. `users/:id` needs its own child route since the bespoke profile replaces `AdminDetail` only for that one model.

**Charting note**: No charting library is introduced anywhere in this spec. The Overview funnel is a hand-built CSS/flex segmented bar (§3.4) — zero new dependencies. If/when the backend later exposes daily time-series data (a genuine future enhancement, not required now), recommend a minimal hand-rolled inline-SVG polyline sparkline (~30 lines, no dependency) over pulling in Chart.js/ngx-charts/d3 — consistent with the project's lean-bundle constraint and the fact that admin routes are already lazy-loaded and should stay that way.

---

## Summary of backend coordination required (consolidated from §3.1, §4.1, §7.3)

1. Extend `GET /admin/stats` with an `attention` block (waitlist-uninvited already computable client-side; failed-webhooks-unresolved / subscriptions-past-due / session-requests-pending need new cheap `count()` queries).
2. Add a `filter` query param + small per-model allowlist to the admin list endpoints, mirroring the existing `searchFields` allowlist pattern.
3. One-line `tailwind.config.js` fix: differentiate `warning` from `primary` (`#f5a524` → `#eab308`).

None of these block starting implementation — every view in §4 has a documented MVP fallback that ships against today's API surface.
