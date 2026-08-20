# Marketing & Campaigns — Code-Level Audit (input for ui-ux-designer)

Orchestrator pre-review of the admin Marketing surfaces. Read the component code
directly for detail; this is the strategic map + the "why it's disjoint" brief.

## Surfaces & real data

### Compose (`marketing/marketing-compose/marketing-compose.ts(+html)`)

One long single-page form, 3 stacked cards:

1. Campaign Basics — internal `name`.
2. Email Content — `TemplatePicker` (pick a saved template) OR inline
   `subject` + `htmlBody` textarea (mutually exclusive; template disables inline).
   Var hints: `{{firstName}}`, `{{email}}`, `{{unsubscribeUrl}}`.
3. Recipients — radio: **Target Segment** (`SegmentPicker`) OR **Explicit User
   IDs** (paste UUIDs). Shows a recipient-count preview alert
   (`~optedIn of total`, opted-in filter applied).

- Submit → `adminApi.sendCampaign()` → navigates to `/admin/marketing-campaigns`.
- **Send is immediate + irreversible** — one click behind a count alert. No
  preview, no test-send, no explicit confirm, no schedule, no draft.
- Styling is OFF the new design system: `text-primary` headers, `card
bg-base-100 shadow-sm`, inline SVGs, `max-w-4xl` — predates `operator`/StatusBadge.

### Template author (`marketing/template-create/template-create.ts(+html)`)

Form: `name` / `subject` / `htmlBody` / `variables` → `adminApi.saveTemplate()`.
Backend sanitizes HTML and can reject: `TEMPLATE_NAME_TAKEN`,
`TEMPLATE_SANITISE_REJECTED` (friendly messages already handled). → navigates to
`/admin/marketing-campaign-templates`. No live preview of the email.

### Campaign History (`/admin/marketing-campaigns` — generic table, readOnly)

Columns: name, subject, segment, recipientCount, sentCount, bouncedCount,
complainedCount, createdBy, createdAt, completedAt. **Bare counts — no rates**
(delivery %, bounce %, complaint %), no per-campaign detail, no status chip.

### Templates (`/admin/marketing-campaign-templates` — generic table)

name/subject/variables/dates. No preview, no duplicate, no "use in a campaign".

## Backend endpoints available (from `services/admin-api.service.ts`)

- `getMarketingSegments()` → `{ all, buildersActive, communityActive,
subscriptionPastDue }`, each `{ total, optedIn }`.
- `saveTemplate({name,subject,htmlBody,variables})` → `MarketingTemplate`.
- `sendCampaign({name,templateId?,subject?,htmlBody?,segment?,userIds?})` →
  `{ campaignId, recipientCount, skippedCount, status: 'in_progress' }`.
- `list('marketing-campaigns')`, `list('marketing-campaign-templates')`.
- No scheduling / draft / per-campaign analytics endpoints exist today → any of
  those the designer wants must be flagged as a backend addition WITH an MVP
  fallback that ships against today's API.

## Problems to fix (designer target list)

1. **No hub.** Compose, History, and Templates are three unrelated screens off a
   flat sidebar. There's no Marketing home that shows performance + entry points.
2. **Risky mass send.** Immediate irreversible send on one click behind a count
   alert — needs a Review step, test-send to self, and an explicit typed/count
   confirmation before blasting ~N users.
3. **No live email preview.** Both compose (inline HTML) and templates lack a
   rendered preview — author flies blind. (Preview is an XSS surface: use a
   sandboxed iframe or sanitize, never raw `[innerHTML]`.)
4. **Performance is bare counts.** History shows sent/bounced/complained numbers
   with no rates, no per-campaign detail, no visual, no status.
5. **Off-system styling.** Legacy cards/`text-primary`/inline SVGs — inconsistent
   with the redesigned admin (`operator`, StatusBadge, StatTile, EmptyState).
6. **Templates are a dead-end table.** No preview / duplicate / "use in campaign".
7. **Segment insight is thin.** SegmentPicker shows counts but no audience context.

## Design goals (full hub, consistent with TASK_2026_164)

1. A **Marketing hub / dashboard**: recent sends with delivery/bounce/complaint
   RATES, segment sizes, template count, prominent Compose CTA.
2. A **guided Compose flow** (Audience → Content → Review & Send) with live
   sandboxed preview, test-send, and an explicit pre-send confirmation for mass
   audiences; consider draft/schedule (flag as backend work + MVP fallback).
3. A **Campaign detail view** — per-campaign performance (rates, not raw counts),
   recipient/segment breakdown, status.
4. **Templates management** with sandboxed preview, duplicate, and "use in a new
   campaign" handoff into Compose.
5. Full adoption of the **shared design system** (tokens, StatusBadge for
   campaign/template status, StatTile for the hub metrics, EmptyState, etc.).

Keep it implementable in Angular 21 (signals/OnPush/Tailwind+daisyui), minimal new
deps; if charts are wanted, prefer the same lean hand-built approach used in 164.
