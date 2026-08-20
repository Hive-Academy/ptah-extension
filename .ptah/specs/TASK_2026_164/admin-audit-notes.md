# Admin Dashboard — Code-Level Audit Notes (input for ui-ux-designer)

Orchestrator's pre-review of `apps/ptah-landing-page/src/app/pages/admin/**`.
This is the "what exists + why it feels like scaffolding" brief. The designer
should read the component code directly for detail; this is the strategic map.

## Verdict up front

It is NOT dummy data. Every view is wired to real `ptah-license-server`
endpoints. The dashboard feels like "stitched dummy pages" because of **product
& IA failure**, not fake content:

1. **One generic table renders 9 different domain models identically** — it's a
   Prisma Studio clone (`admin-list` + `data-table` driven by
   `admin-models.config.ts`). Users, licenses, subscriptions, webhooks, sessions,
   audit log, campaigns, templates, waitlist all look the same. No model gets a
   purpose-built view keyed to what an admin actually _does_ with it.
2. **Overview is a passive wall of numbers** (`overview.html`) — 3 ungrouped
   rows of daisyUI `stat` tiles (Waitlist / Members / Cohorts). No trends, no
   time series, no "what needs my attention", no click-through to act. It
   answers "what are the counts" but never "what should I do next".
3. **Features are siloed & bolted-on** — Marketing (compose/templates/campaigns)
   and Groups are separate mini-apps hung off a thin sidebar with flat sections
   (Overview / Marketing / Community / Models). No task-oriented grouping.
4. **The real power is hidden in modals** — bulk email, founding-invite send,
   complimentary-license approval, and cascade-preview user deletion are all
   real, valuable flows buried behind buttons on a table row. There's no
   guided/queue-driven surface for the flows that matter most.

## Feature inventory (the raw material to re-compose)

### Overview (`overview/`)

- `GET /api/v1/admin/stats` → waitlist funnel (total, notified, converted,
  last7Days), members by tier (builders/community), cohorts list.
- Derived: conversion %, builders share %. Skeleton loading + error+retry.

### Generic model CRUD (`admin-list/`, `admin-detail/`, `components/data-table/`)

Config-driven by `admin-models.config.ts`. Models + notable capabilities:

- **users** — bulk email (`supportsBulkEmail`); detail has delete-user w/
  cascade preview + comp-license issue.
- **licenses** — editable plan/status/expiresAt.
- **subscriptions** — read-only (Paddle mirror).
- **failed-webhooks** — editable resolved/resolvedAt (ops triage surface).
- **session-requests** — editable status/paymentStatus/scheduledAt.
- **admin-audit-log** — read-only (compliance/forensics).
- **marketing-campaigns** — read-only (send results: sent/bounced/complaints).
- **marketing-campaign-templates** — editable name/subject/htmlBody.
- **waitlist** — founding-invite send (`supportsWaitlistInvite`) + Early-Adopter
  approve → issue Builders comp license (`supportsEarlyAdopterApprove`).
  List features: server pagination, sort (allowlisted), full-text search,
  row-selection for bulk actions, truncation, read-only badges, toasts.

### Marketing (`marketing/`)

- `marketing-compose` — pick segment (all / buildersActive / communityActive /
  subscriptionPastDue, each with counts), pick/compose template, send campaign.
- `template-create` — author reusable email templates (name/subject/html/vars).
- Segment counts from `GET /marketing/segments`; send via `POST /marketing/send`.

### Groups / Cohorts (`groups/`)

- `groups-list` + `group-form-modal` + `assign-members-modal`.
- CRUD member cohorts (key immutable, isDefault atomic), bulk-assign by
  userId/pasted-email, unassign, Discourse group mapping, member counts.

### Shared shell (`admin-layout/`)

- daisyUI drawer, sticky topbar ("Admin Dashboard" + Restricted badge + signed-in
  email), sidebar sections. Mobile drawer toggle.

## UX / visual problems to fix (designer's target list)

- **No information hierarchy on Overview**: everything is the same tile weight.
  No hero KPI, no funnel visualization, no trend/sparkline, no delta vs. prior
  period, no actionable "needs attention" list (un-invited waitlist, unresolved
  webhooks, past-due subs, pending session requests).
- **Generic table ≠ admin product**: high-value models (waitlist, users,
  licenses, failed-webhooks) deserve bespoke views with inline actions, status
  chips, and workflow affordances instead of a raw grid.
- **Flows are modal-buried & undiscoverable**: waitlist invite→approve pipeline,
  license issuance, marketing send, user offboarding should be first-class,
  guided surfaces (ideally queue/kanban/stepper patterns).
- **Weak visual system**: default daisyUI stat/table/badge styling, inconsistent
  spacing rhythm, no design tokens, no empty-state design, minimal iconography,
  no data-density controls, no dark-mode consideration documented.
- **Navigation is a flat dump**: sidebar mixes an actionable Overview, a
  Marketing tool, a Community tool, and 9 raw model tables at equal weight.
  Needs task-oriented IA (e.g. Growth / Revenue & Licensing / Operations /
  Community / Records).
- **No cross-linking / drill paths**: Overview tiles don't deep-link into
  filtered model views; a user row doesn't link to its licenses/subscriptions.

## Design goals (from user decision: full overhaul)

1. Turn Overview into a **command center**: hero funnel + trends + a
   prioritized "needs attention" action queue with deep links.
2. Give the **top ~4 high-value models bespoke workflow views**; keep the
   generic table only for low-traffic/records models (audit log, subscriptions).
3. Surface the buried flows as **guided, first-class surfaces**.
4. Establish a **cohesive admin design system** (tokens, spacing scale, status
   color semantics, table density, empty/loading/error states, iconography).
5. Re-architect the **sidebar IA** into task-oriented groups.

Keep it implementable in Angular 21 (signals/OnPush/Tailwind+daisyui) without new
heavy deps where avoidable; if charts are needed, recommend a lightweight
approach consistent with the existing stack.
