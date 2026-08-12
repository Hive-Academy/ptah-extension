# TASK_2026_164 — Implementation Batches

Spec: `visual-design-specification.md` (APPROVED). Stack: Angular 21 (signals,
OnPush, inject), Tailwind 3 + daisyui 4 `operator` theme. No commits until user asks.

## Batch 1 — Foundation (parallel; file-disjoint) — ✅ DONE (clean typecheck/lint/tests)

Backend filter scheme (actual): waitlist `notified:true|false` + `converted:true|false`
(New=notified:false, Invited=notified:true, Converted=converted:true); failed-webhooks
`resolved:true|false`; subscriptions `status:<v>`; session-requests `status`/`paymentStatus`.
`/admin/stats` now returns `attention{waitlistUninvited,failedWebhooksUnresolved,subscriptionsPastDue,sessionRequestsPending}`.

### 1A · frontend-developer · P0 shared foundation

- [ ] `admin-models.config.ts`: add `FieldSpec.badgeMap?: Record<string,BadgeVariant>` (spec §7.3, §8.1)
- [ ] NEW `components/status-badge/` (§8.2)
- [ ] NEW `components/empty-state/` (§8.3)
- [ ] NEW `components/stat-tile/` (§8.4)
- [ ] NEW `components/detail-drawer/` (§8.5)
- [ ] NEW `components/selection-toolbar/` (§8.6)
- [ ] `admin-layout` rewrite: grouped/collapsible sidebar + lucide icons + `admin-nav.config.ts` (§2, §8.7)
- [ ] `tailwind.config.js`: `warning` #f5a524 → #eab308 (§7.3)
- [ ] `admin.routes.ts`: add bespoke routes (`waitlist`, `users`+`users/:id`, `licenses`, `failed-webhooks`) ABOVE the generic `:model` catch-all, pointing at placeholder-safe lazy imports (components land in Batch 2) — coordinate so build stays green.

### 1B · backend-developer · admin API additions (ptah-license-server)

- [ ] Extend `GET /admin/stats` with `attention` block: waitlistUninvited, failedWebhooksUnresolved, subscriptionsPastDue, sessionRequestsPending (cheap counts) (§3.1)
- [ ] Add `filter` query param + per-model allowlist to admin list endpoints, mirroring existing `searchFields` allowlist pattern (§4.1)
- [ ] Keep frontend `admin-api.service.ts` Zod `adminStatsResponseSchema` in sync (add optional `attention`) — coordinate; FE owns the frontend file.

## Batch 2 — Overview + bespoke views + modals — ✅ DONE (build 950 kB green, lint clean)

- [x] Overview rebuild + NeedsAttentionQueue + WaitlistFunnel (§3) + Zod `attention` optional
- [x] Waitlist pipeline (§4.2) — tabs via filter; note: tab sort falls back to `createdAt`
- [x] Users list + user-profile (§4.4)
- [x] Licenses list + detail quick-sets (§4.3); licenses sends NO filter (no backend filterableFields)
- [x] Failed-webhooks triage + drawer (§4.5); Unresolved/Resolved via `filter=resolved:`; sort `attemptedAt desc`
- [x] delete-user modal → 2-step stepper (§4.4.3)
- [x] issue-comp-license modal → bound|search mode (§6.3)
- [x] ROUTING: bespoke routes for waitlist/licenses/failed-webhooks/users(+:id) added above `:model` catch-all

## Batch 3 — Generic table polish — ✅ DONE (build 952 kB green, lint clean)

- [x] data-table: StatusBadge (badgeMap), EmptyState, sticky first col, skeleton rows, density toggle (localStorage) (§5)
- [x] admin-detail: StatusBadge/EmptyState/skeleton for kept-generic models; license quick-sets preserved (§8.17)

## Status: IMPLEMENTATION COMPLETE — awaiting QA choice + user sign-off. No git commit made.

Carried-forward (non-blocking): admin-audit-log.action badgeMap TODO (free-form action strings degrade to neutral);
waitlist tab sort falls back to createdAt; licenses view sends no server filter (no backend filterableFields).

## Verification

- After each batch: `nx typecheck ptah-landing-page` + `nx lint ptah-landing-page` (and license-server for 1B) green.
- Final: visual-reviewer pass against the spec.
