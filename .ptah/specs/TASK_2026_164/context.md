---
id: TASK_2026_164
status: in_progress
type: CREATIVE
title: Reshape & fix the native admin dashboard (full IA + product overhaul)
created: 2026-07-24T00:00:00.000Z
updated: 2026-07-24T00:00:00.000Z
---

# TASK_2026_164 — Admin Dashboard Reshape (CREATIVE / full overhaul)

## User Intent

> "Invoke our UI/UX designer to reshape and fix the admin dashboard. It looks
> like a couple of dummy pages stitched together without producing any values or
> proper features and use cases. Review each and every part of it (in the
> browser too) to plan how to fix it properly."

The user perceives the dashboard as scaffolding. Reality (from code review): the
data + actions are **real** and wired to `ptah-license-server` `/api/v1/admin/*`.
The problem is **information architecture, visual hierarchy, and product framing**
— everything routes through one generic Prisma-Studio-style model table, the
Overview is an ungrouped wall of stat tiles, and Marketing/Groups are bolted-on
mini-apps. High-value workflows (waitlist → invite → approve, license issuance,
marketing sends, user deletion) are buried in modals with no guided flow.

## Decisions (Checkpoint 0 — user answered)

1. **Redesign scope**: Full IA + product overhaul — actionable Overview
   (funnels, trends, "needs attention" queue), purpose-built workflow views for
   high-value flows, keep the generic model table only for low-traffic models.
2. **Review method**: originally BOTH code + live browser walkthrough. REVISED
   mid-task — the live walkthrough was dropped (background infra standup hit
   permission denials; user agreed to proceed on the code evaluation alone).
   The code audit fully inventories every feature/action/flow, which is
   sufficient for a full overhaul that replaces the UI. Visual validation moves
   to the implementation phase (visual-reviewer).

## Strategy — CREATIVE

`ui-ux-designer (spec) → CHECKPOINT → frontend-developer (impl) → visual-reviewer`

- ~~**Phase A (devops-engineer, live walkthrough)**~~ — DROPPED (see decision 2).
- **Phase B (ui-ux-designer)**: consume `admin-audit-notes.md` + admin code →
  `visual-design-specification.md` (full IA overhaul + design tokens + per-view
  redesign specs).
- **Checkpoint 2**: user approves the spec before any implementation.
- **Phase C (frontend-developer)**: implement the approved redesign.
- **Phase D (visual-reviewer)**: verify against the spec.

## Key Facts

- App: `apps/ptah-landing-page` (Angular 21, signals, OnPush, Tailwind 3 + daisyui 4).
- Admin code: `apps/ptah-landing-page/src/app/pages/admin/**`.
- API client: `apps/ptah-landing-page/src/app/services/admin-api.service.ts`.
- Backend: `apps/ptah-license-server` (`/api/v1/admin/*`), gated by
  `JwtAuthGuard → AdminGuard` (ADMIN_EMAILS allowlist, already = user email).
- Auth cookie: `ptah_auth` JWT signed by `authService.generateJwtToken({sub,email})`.
- Dev proxy: `/api` + `/webhooks` → `http://localhost:3000` (see `proxy.conf.json`).
- Admin is intentionally hidden from public nav/sitemap — do NOT link it anywhere.

## Constraints

- Marketplace scanner rules do NOT apply (this is the landing page, not the VSIX).
- OnPush + signals + `inject()` mandatory; no `[innerHTML]` on AI content.
- Keep initial bundle < 1mb; lazy-load heavy admin routes (already lazy).
- Frontend must not import backend libs; `admin-models.config.ts` mirrors the
  backend security config — keep field keys in sync.
