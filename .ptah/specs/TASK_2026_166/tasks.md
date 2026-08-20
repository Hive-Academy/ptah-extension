# TASK_2026_166 — Implementation Batches

Spec: `marketing-campaigns-design-specification.md` (APPROVED). Plus user add-on:
enhance existing + create new-purpose default marketing templates.
Stack: Angular 21 signals/OnPush; Tailwind + daisyui `operator`. No commits until asked.

## Wave 1 (parallel; file-disjoint) — ✅ DONE

### 1A · frontend-developer · P0 foundation (NO routing, NO views yet)

- [ ] NEW `marketing/marketing-metrics.ts` (computeCampaignRates + threshold colors, §3.7)
- [ ] NEW `marketing/marketing-segment-labels.ts` + refactor `components/segment-picker` to import it (§7.2)
- [ ] NEW `marketing/components/email-preview-frame/` — dompurify sanitize + sandboxed srcdoc iframe (§4.6)
- [ ] `admin-layout/admin-nav.config.ts` — add `Marketing` primary item, demote Compose to secondary (§2.2)
- [ ] Do NOT touch admin.routes.ts (routing is Wave 3, after view components exist)

### 1B · backend-developer · default marketing templates (license-server)

- [ ] NEW Prisma seed migration (mirror `20260607000000_seed_marketing_templates` pattern; idempotent; do NOT clobber admin edits; do NOT run against a DB)
- [ ] ENHANCE existing 4 (polish; re-frame "Upgrade to Pro" → Builders; add {{unsubscribeUrl}} footer) — safe, non-clobbering
- [ ] CREATE ~3-4 new-purpose templates: Founding/Waitlist Invite, Past-Due Billing Reminder, Re-engagement/Win-back (+ optional Builders/Early-Adopter Welcome)

## Wave 2 — ✅ DONE (build 962 kB green, lint clean)

- [x] Marketing hub + Campaign History list + Campaign Detail (§3, §5)
- [x] Compose 3-step rewrite — preview, test-send, send-safety gate (MASS_SEND_THRESHOLD=100) (§4)
- [x] Templates gallery + template-create restyle/duplicate (§6)

## Wave 3 — ✅ DONE

- [x] Routing: marketing hub + bespoke marketing-campaigns(+/:id) + marketing-campaign-templates above `:model` catch-all
- [x] Full build green (all views AOT-checked)

## Templates (backend, parallel) — ✅ DONE

- [x] Migration `20260724120000_seed_marketing_templates_v2`: 4 enhanced (Pro→Builders, edit-safe upsert) + 4 new; double-footer removed; billing CTA → /profile

## Status: IMPLEMENTATION COMPLETE — awaiting QA + user sign-off. No git commit yet.

## Backend flagged (optional, MVP fallbacks shipping): test-send endpoint (§4.5), per-campaign analytics (§5.2), drafts/schedule (§8.14)
