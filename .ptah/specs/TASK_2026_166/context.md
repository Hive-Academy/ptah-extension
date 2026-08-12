---
id: TASK_2026_166
status: in_progress
type: CREATIVE
title: Reshape the admin Marketing & Campaigns surfaces into a cohesive hub
created: 2026-07-24T00:00:00.000Z
updated: 2026-07-24T00:00:00.000Z
---

# TASK_2026_166 — Marketing & Campaigns Redesign (CREATIVE)

## Relationship to TASK_2026_164

Phase 2 of the admin overhaul. TASK_2026_164 (committed `d0f372a57`) rebuilt the
admin IA + gave bespoke views to Waitlist/Users/Licenses/Failed-Webhooks and a
shared design system. It deliberately LEFT the Marketing/Campaigns surfaces on
generic tables + legacy forms. This task elevates them to match.

## User Intent

> "Plan the next page for marketing and other campaigns."

Design (not yet implement) a cohesive Marketing & Campaigns hub consistent with
the new `operator` admin design system.

## Strategy — CREATIVE

`ui-ux-designer (spec) → CHECKPOINT (user approval) → frontend-developer (impl) → visual-reviewer`

Deliverable: `marketing-campaigns-design-specification.md`.

## Current surfaces (audited — see marketing-audit-notes.md)

- `marketing/marketing-compose` — single long form; immediate irreversible send.
- `marketing/template-create` — template author form (server sanitizes HTML).
- `/admin/marketing-campaigns` — generic read-only table (send-result counts).
- `/admin/marketing-campaign-templates` — generic table CRUD.
- Sidebar "Growth" group already lists: Compose Campaign, Campaign History, Email Templates.

## Reuse (from TASK_2026_164)

Shared components at `apps/ptah-landing-page/src/app/pages/admin/components/`:
`status-badge` (+badgeMap), `empty-state`, `stat-tile`, `detail-drawer`,
`selection-toolbar`. `operator` theme tokens, semantic status colors (§7 of the
164 spec). Grouped sidebar via `admin-layout/admin-nav.config.ts`.

## Constraints

- Angular 21 signals + OnPush + `inject()`; Tailwind 3 + daisyui 4 `operator`.
- No `[innerHTML]` on email HTML previews — sanitize (the markdown lib / a
  sanitized sandboxed preview); email HTML preview is a real XSS surface, design
  it safely (iframe sandbox or sanitize-html, NOT raw innerHTML).
- Design against the REAL endpoints in `admin-api.service.ts`; flag any backend
  addition (scheduling, per-campaign analytics, drafts) with an MVP fallback.
- Admin stays hidden from public nav. Keep admin routes lazy.
