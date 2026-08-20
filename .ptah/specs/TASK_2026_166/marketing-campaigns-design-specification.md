# Marketing & Campaigns — Visual Design Specification

**TASK_2026_166 · Phase 2 of the admin overhaul, building on TASK_2026_164**
Author: ui-ux-designer · Source of truth: `marketing-audit-notes.md`, live code read of `apps/ptah-landing-page/src/app/pages/admin/marketing/**`, `components/{segment-picker,template-picker,status-badge,empty-state,stat-tile,detail-drawer,selection-toolbar}/**`, `services/admin-api.service.ts`, `admin-models.config.ts`, `admin-nav.config.ts`, `admin.routes.ts`, and `TASK_2026_164/visual-design-specification.md` §2/§7 (the token + IA source of truth this spec inherits verbatim — no new tokens are introduced here).

---

## 1. Redesign Thesis

Marketing today is three screens that don't know about each other: a single long compose form with no preview and a one-click irreversible send, a raw send-results table with bare counts, and a raw template CRUD table with no preview. There is no way to answer "how is our marketing doing?" without opening a table and doing mental division, and there is no safety net between clicking "Send Campaign" and irreversibly emailing a segment of users.

**From** → three disjoint legacy screens hanging off a flat sidebar, styled off-system (`text-primary`, `card bg-base-100 shadow-sm`, inline SVGs, `max-w-4xl`), with zero performance visibility and zero send-safety.

**To** → a **Marketing hub** that leads with send performance (rates, not counts) and audience reach, a **guided three-step Compose flow** (Audience → Content → Review & Send) with a sandboxed live preview, a test-send-to-self, and an explicit friction gate before any mass send, a **Campaign History** list and **detail** view that read as a performance record instead of a database dump, and a **Templates gallery** that previews safely and hands off directly into Compose. Every surface adopts the `operator` design system and the shared components shipped in TASK_2026_164 (`StatusBadge`, `StatTile`, `EmptyState`, `DetailDrawer`). Nothing here invents a new endpoint that isn't already real — every feature ships against `getMarketingSegments`, `saveTemplate`, `sendCampaign`, `list()`, `get()`, and `update()`; genuine gaps (drafts/scheduling, richer per-campaign analytics, a non-recorded test-send endpoint) are flagged with an MVP fallback that ships today.

---

## 2. Information Architecture

### 2.1 Routes

```
/admin/marketing                          NEW  — Marketing hub (landing page for this cluster)
/admin/marketing/compose                  existing route, component rewritten to 3-step stepper
                                            accepts ?templateId=<id>  (prefill Content step)
                                                    ?segment=<key>    (prefill Audience step)
/admin/marketing-campaigns                existing route, component swapped: bespoke CampaignHistory
                                            list (was generic AdminList)
/admin/marketing-campaigns/:id            NEW  — bespoke CampaignDetail (was unreachable; the model
                                            is readOnly so AdminDetail's :model/:id route existed but
                                            had no list-row entry point into it)
/admin/marketing-campaign-templates       existing route, component swapped: bespoke
                                            TemplatesGallery (was generic AdminList)
/admin/marketing-campaign-templates/:id   UNCHANGED — stays on generic AdminDetail (templates are
                                            editable via the existing generic edit form; see §6.4)
/admin/marketing/templates/new            existing route, component restyled + extended
                                            accepts ?duplicateFrom=<id>  (prefill from an existing
                                            template, see §6.3)
```

All new/bespoke routes must be registered **above** the generic `:model` / `:model/:id` catch-all in `admin.routes.ts`, exactly as the four TASK_2026_164 bespoke views already do (`admin.routes.ts:64-97`) — `marketing-campaigns` and `marketing-campaign-templates` need to move from "resolved by the catch-all" to explicit `loadComponent` entries.

### 2.2 Nav tree changes (`admin-layout/admin-nav.config.ts`)

Today's Growth group has **two** primary (`★`) items — Waitlist Pipeline and Compose Campaign — with History/Templates as secondaries that visually belong to neither. This redesign gives Marketing its own primary hub entry and re-homes the three existing Growth sub-routes under it conceptually (the `AdminNavGroup` model is flat, so "under it" means visually adjacent in the secondary list, with the hub page itself doing the real cross-linking):

```diff
  Growth
    Waitlist Pipeline            ★        /admin/waitlist                (unchanged)
-   Compose Campaign             ★        /admin/marketing/compose
+   Marketing                    ★        /admin/marketing                NEW primary
-   ─ Campaign History                    /admin/marketing-campaigns
-   ─ Email Templates                     /admin/marketing-campaign-templates
+   ─ Compose Campaign                    /admin/marketing/compose        demoted, still 1-click
+   ─ Campaign History                    /admin/marketing-campaigns
+   ─ Email Templates                     /admin/marketing-campaign-templates
```

- New `AdminNavItem`: `{ label: 'Marketing', route: '/admin/marketing', primary: true, icon: Megaphone }`.
- `Compose Campaign` keeps a direct sidebar link (power users who compose daily shouldn't be forced through the hub) but drops to `primary: false` since the hub now owns the "front door" job and carries the prominent CTA.
- `icon: Megaphone` (lucide-angular icon file confirmed present: `icons/megaphone.d.ts`).

### 2.3 Cross-linking summary (how the four views relate)

```
                    ┌─────────────────────┐
                    │   Marketing Hub      │  /admin/marketing
                    │  (performance +      │
                    │   entry points)      │
                    └──────┬───────┬───────┘
           "Compose"  ┌────┘       └────┐  "View all campaigns" /
                CTA   ▼                 ▼   "Manage templates"
          ┌────────────────┐   ┌──────────────────┐
          │  Compose        │   │ Campaign History  │──row click──▶ Campaign Detail
          │  (3-step)       │   │ (list, rates)     │              /marketing-campaigns/:id
          └───────┬─────────┘   └──────────────────┘
     "Use in new   ▲
      campaign"    │
                ┌───┴──────────────┐
                │ Templates Gallery │──"New Template"──▶ Template Create/Edit
                │ (preview, dup.)   │◀─"Duplicate"────────────┘
                └───────────────────┘
```

---

## 3. Marketing Hub (`/admin/marketing`)

New component: `marketing/marketing-hub/marketing-hub.ts(+html)`. Page shell matches every other admin page (`p-4 lg:p-6`, header row, `flex flex-col gap-6` sections) — no bespoke chrome.

### 3.1 Data sourcing (real endpoints only, one call each)

- `adminApi.list('marketing-campaigns', { pageSize: 10, sortBy: 'createdAt', sortOrder: 'desc' })` → drives **both** the "Recent Campaigns" list **and** the hub's rate/count stats. Because only the last 10 are fetched, every derived average is honestly labeled **"last 10 sends"**, never claimed as a lifetime average the client hasn't actually computed (same "never fabricate a number" discipline as TASK_2026_164 §3.1). `.total` from this same response drives the "Campaigns Sent" stat tile (that one _is_ a true lifetime count — `total` is server-computed over the whole table, unlike the rate averages).
- `adminApi.getMarketingSegments()` → drives the Audience panel (4 segment tiles).
- `adminApi.list('marketing-campaign-templates', { pageSize: 5, sortBy: 'updatedAt', sortOrder: 'desc' })` → drives the Templates strip; `.total` drives the "Templates" stat tile.

Three parallel requests, all real, zero backend change.

### 3.2 Layout (top to bottom)

```
┌───────────────────────────────────────────────────────────────────┐
│ Marketing                                    [ + Compose Campaign ]│  ← header, primary CTA top-right
├───────────────────────────────────────────────────────────────────┤
│ [Campaigns Sent] [Avg Delivery] [Avg Bounce] [Templates Ready]     │  ← 4 StatTiles, §3.3
├───────────────────────────────────────────────────────────────────┤
│ RECENT CAMPAIGNS                                  View all →       │  ← §3.4
│  Spring Promo     ● Sending    98.2% delivered  0.4% bounced  ...  │
│  Founders Recap   ● Completed  99.1% delivered  0.1% bounced  ...  │
│  (up to 5 rows; "View all →" → /admin/marketing-campaigns)         │
├───────────────────────────────────────────────────────────────────┤
│ AUDIENCE                          │  TEMPLATES                     │  ← §3.5 / §3.6, two columns
│ [All 4,120/5,800] [Builders ...]  │  [Welcome Email] [Renewal...]  │
│ each → Compose prefilled ?segment │  Manage templates →            │
└───────────────────────────────────────────────────────────────────┘
```

Grid: `grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6` for the Audience/Templates row; everything above is full-width stacked sections (`flex flex-col gap-6`).

### 3.3 Stat tiles (`ptah-admin-stat-tile`, §7 of this spec)

| Tile            | `label`                  | `value`                                            | `delta`                                                               | `link`                                |
| --------------- | ------------------------ | -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Campaigns Sent  | `CAMPAIGNS SENT`         | `campaigns().total` (lifetime, from list envelope) | none                                                                  | `/admin/marketing-campaigns`          |
| Avg Delivery    | `AVG DELIVERY (LAST 10)` | `{{ avgDeliveryRate() }}%`                         | tone `success` if ≥95%, `warning` 80–95%, `error` <80% (§3.7 formula) | `/admin/marketing-campaigns`          |
| Avg Bounce      | `AVG BOUNCE (LAST 10)`   | `{{ avgBounceRate() }}%`                           | tone `success` if <2%, `warning` 2–5%, `error` >5%                    | `/admin/marketing-campaigns`          |
| Templates Ready | `TEMPLATES`              | `templates().total`                                | none                                                                  | `/admin/marketing-campaign-templates` |

`size="default"` for all four (no hero on this page — Overview already owns the one hero-sized number in the product, per TASK_2026_164 §3.4's "one number allowed to dominate"). If `campaigns().total === 0`, render the stat row as a single `EmptyState` instead ("No campaigns sent yet" + "Compose your first campaign" primary-action button) and skip straight to the Audience/Templates row — an all-zero stat row with a populated hub below it would be confusing.

### 3.4 Recent Campaigns list

Not a table — a compact row list, each row `flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-base-300 transition-colors`, wrapped in `routerLink` to `/admin/marketing-campaigns/:id` (whole row clickable, same interaction pattern as TASK_2026_164's Needs-Attention queue rows).

Row content, left to right:

- Campaign `name` (`font-medium text-sm`)
- `ptah-admin-status-badge` with `[variant]` set from the client-derived status (§3.7) — `info` "Sending" while `completedAt` is null, `success` "Completed" once set
- Three inline rate readouts (`text-xs tabular-nums`, colored per §3.7's thresholds): `98.2% delivered` / `0.4% bounced` / `0.0% complaints`
- Right-aligned: relative `createdAt` (`text-xs text-ink-500`) + `ChevronRight` icon

Section header: `RECENT CAMPAIGNS` label (§7.4 typography) + `View all →` routerLink to `/admin/marketing-campaigns`.

Empty state (0 campaigns): `ptah-admin-empty-state` — icon `Megaphone`, message "No campaigns sent yet", hint "Compose your first campaign to see performance here", with a `<button routerLink="/admin/marketing/compose">Compose Campaign</button>` projected action.

### 3.5 Audience panel

4 small cards (not full `StatTile` — these carry two numbers each, total + opted-in, which doesn't fit the single-value StatTile shape cleanly): `grid grid-cols-2 gap-3`, each card `rounded-md border border-base-300 bg-base-200 p-3`:

- Label (segment display name — reuse the mapping described in §7.2's shared-util recommendation): `All Users`, `Builders Active`, `Community Active`, `Past Due`
- `{{ optedIn }} / {{ total }}` (`text-lg font-semibold tabular-nums`) + `opted-in` caption (`text-xs text-ink-400`)
- Whole card is a `routerLink="/admin/marketing/compose" [queryParams]="{ segment: key }"` — clicking a segment jumps straight into Compose with that audience pre-selected (§4.2).

Section header: `AUDIENCE`. No loading/error state beyond the existing `SegmentPicker`-style skeleton (4 pulse cards) — reuse the pulse pattern, not a spinner.

### 3.6 Templates strip

Up to 4 most-recently-updated templates as small chips/cards: `name` (`text-sm font-medium truncate`) + `updatedAt` relative (`text-xs text-ink-500`). Section header `TEMPLATES` + `Manage templates →` link to `/admin/marketing-campaign-templates`, and a `+ New` ghost-button link to `/admin/marketing/templates/new`. Empty state: `EmptyState` icon `FileText`, message "No templates yet", action button "Create a template".

### 3.7 Rate computation reference (shared logic — used by Hub, Campaign History, Campaign Detail)

Every campaign row has `{ recipientCount, sentCount, bouncedCount, complainedCount, completedAt }`. Extract this into a small pure-function module, e.g. `marketing/marketing-metrics.ts`, so the three consuming views never duplicate the math:

```ts
export interface CampaignRates {
  deliveryRate: number | null; // sentCount / recipientCount, null if recipientCount === 0
  bounceRate: number | null; // bouncedCount / sentCount, null if sentCount === 0
  complaintRate: number | null; // complainedCount / sentCount, null if sentCount === 0
  status: 'in_progress' | 'completed'; // derived from completedAt presence
}
export function computeCampaignRates(c: { recipientCount: number; sentCount: number; bouncedCount: number; complainedCount: number; completedAt: string | null }): CampaignRates {
  /* ... */
}
```

- `null` rates render as `—` (never `NaN%` or `Infinity%`) — this is the "never fabricate a number" rule applied to arithmetic, not just missing backend fields.
- Color thresholds (apply to the rate's `text-*` color class, not a full badge — these are continuous metrics, not enum states):
  - Delivery: `text-success` ≥95%, `text-warning` 80–95%, `text-error` <80% (standard deliverability bands).
  - Bounce: `text-success` <2%, `text-warning` 2–5%, `text-error` >5% (industry-standard bounce bands).
  - Complaint: `text-success` <0.1%, `text-warning` 0.1–0.5%, `text-error` >0.5% (industry-standard spam-complaint bands).
- Status badge (`StatusBadge [variant]`, not `[badgeMap]` — this is a client-derived two-state value, not a stored enum, so there's no `FieldSpec.badgeMap` to look up): `completedAt == null` → `variant="info"` label "Sending"; `completedAt` set → `variant="success"` label "Completed". Deliverability problems are surfaced via the rate colors, not by overloading this status with a third "Completed — issues" state — keep "did it finish" and "how did it perform" visually separate, same separation-of-concerns TASK_2026_164 used for Failed-Webhooks' `resolved` vs. `retryCount`.

---

## 4. Guided Compose Flow (`/admin/marketing/compose`)

Full rewrite of `marketing/marketing-compose/marketing-compose.ts(+html)`. Signal-driven step state (`currentStep = signal<1|2|3>(1)`), all existing field signals (`name`, `templateId`, `subject`, `htmlBody`, `segment`, `useExplicitUserIds`, `userIdsRaw`) and computeds (`parsedUserIds`, `recipientCountPreview`, `totalRecipientPreview`) are **unchanged** — this is a template/layout restructuring around existing, already-correct logic, not a logic rewrite. `canSubmit` gains the confirmation-gate conditions from §4.4.

### 4.1 Step header (shared visual pattern, reused from `delete-user-modal`'s 2-step stepper — TASK_2026_164 §4.4.3 — extended to 3 steps)

Three 24px numbered circles connected by a line: `bg-amber-500 text-base-100` for active/complete, `bg-base-300 text-ink-500` for pending. Labels: "1 Audience" → "2 Content" → "3 Review & Send". Clicking a completed step's circle navigates back to it (no re-validation needed going backward); forward navigation is gated by each step's own completeness check (mirrors `canSubmit`'s existing per-section booleans, just evaluated per-step instead of all-at-once).

### 4.2 Step 1 — Audience

- **Campaign name (internal)** field lives here (top of step 1) — it has no dependency on audience or content, and "what do I call this + who's it for" reads naturally together. `[ngModel]="name()"`.
- Radio: **Target Segment** vs. **Explicit User IDs** — unchanged `SegmentPicker`/textarea toggle, restyled off `text-primary`/`card bg-base-100 shadow-sm` onto the `operator` tokens (`bg-base-200 border border-base-300 rounded-lg p-4` card shell, `text-base-content` headings).
- **Query-param prefill**: on init, read `route.snapshot.queryParamMap.get('segment')` — if present and a valid `MarketingSegmentKey`, call `segment.set(key)` (this is what the Hub's Audience-card links and any future deep link drive, §3.5).
- Recipient-count preview: same computed values (`recipientCountPreview`/`totalRecipientPreview`), restyled from the raw `alert alert-info` + inline SVG onto a small `ptah-admin-stat-tile` (`label="WILL REACH"`, `value="{{ recipientCountPreview() }} of {{ totalRecipientPreview() }}"`, no hero size) or, if a two-number tile reads awkwardly in practice, a plain `text-sm text-ink-300` line using the operator token set — either is acceptable, the requirement is: **no more raw `alert-info` + inline `<svg>`**, and the number carries forward unchanged into Step 3's confirmation gate (§4.4).
- "Next" button disabled until `hasRecipients` (existing `canSubmit` sub-condition, reused per-step).

### 4.3 Step 2 — Content

Two-column on desktop, stacked on mobile: `grid grid-cols-1 lg:grid-cols-2 gap-6`.

**Left column — authoring** (unchanged logic, restyled):

- `TemplatePicker` (unchanged component/inputs) OR inline `subject` + `htmlBody` textarea, same mutual-exclusion (`[disabled]="!!templateId()"`) as today.
- **Query-param prefill**: on init, read `?templateId=` — if present, call `templateId.set(id)` (this is the Templates gallery's "Use in new campaign" handoff, §6.2).
- Variable hint line unchanged (`{{firstName}}`, `{{email}}`, `{{unsubscribeUrl}}`).

**Right column — live preview** (NEW, this is the audit's #3 problem):

- `ptah-marketing-email-preview` (new shared component, §4.6) bound to the currently-resolved subject/HTML — if `templateId()` is set, resolve the picked template's `subject`/`htmlBody` (the `TemplatePicker`/its parent already has the full `MarketingTemplate[]` array loaded — expose the selected template object, not just its id, so Compose doesn't need a second fetch); otherwise use the inline `subject()`/`htmlBody()` signals directly.
- Sample variable substitution for the preview only (never sent): `{{firstName}} → "Jordan"`, `{{email}} → "jordan@example.com"`, `{{unsubscribeUrl}} → "#"`.
- Below the preview: **"Send test to me"** button (`btn btn-outline btn-sm`, icon `FlaskConical`) — see §4.5.
- Sticky on desktop (`lg:sticky lg:top-6 lg:self-start`) so the preview stays visible while the admin scrolls the (potentially tall) HTML textarea on the left.
- Loading/empty state: if neither a template nor inline subject+body is resolvable yet, render the preview panel as a muted placeholder (`EmptyState`, icon `Eye`, message "Preview will appear once you add content") rather than an empty iframe.

"Next" disabled until `hasContent` (existing sub-condition).

### 4.4 Step 3 — Review & Send

- **Summary card** (read-only recap, `bg-base-200 rounded-lg border border-base-300 p-4 space-y-3`):
  - Campaign name
  - Audience: segment display label + `optedIn/total`, or "Explicit list — N recipients" for the userIds path
  - Content: template name, or "Inline content" + the subject line
  - The same `ptah-marketing-email-preview` component, re-rendered here too (no reason to make the admin scroll back to Step 2 to double-check what they're about to blast) — collapsed by default behind a `<details>`/"Show preview" toggle to keep the review card scannable, expandable in one click.
- **Recipient hero callout**: the recipient count gets the largest treatment on this step — `ptah-admin-stat-tile [size]="'hero'" label="WILL SEND TO" [value]="recipientCountPreview()" delta="of {{ totalRecipientPreview() }} total, opted-in filter applied" [deltaTone]="'info'"` — this is deliberately the loudest element on the page, because it's the number the admin is about to commit to irreversibly.
- **Confirmation gate** (the audit's #2 problem — send is immediate + irreversible, currently one click behind a passive alert):
  1. A required checkbox, always shown regardless of size: _"I've reviewed the content and confirm sending to {{ recipientCountPreview() }} recipients."_ Unchecked → Send stays disabled.
  2. **Mass-audience extra friction**: when `recipientCountPreview() > 100`, an additional type-to-confirm input appears below the checkbox — _"Type the recipient count ({{ recipientCountPreview() }}) to confirm"_ — Send stays disabled until the typed value matches exactly. This mirrors the type-to-confirm pattern already shipped in `delete-user-modal` (TASK_2026_164 §4.4.3) for the product's other irreversible action, so the interaction vocabulary for "this cannot be undone" is consistent across the whole admin, not invented twice. 100 is a reasonable default threshold (small explicit-ID test sends and single-recipient test-sends never hit it); confirm the exact cutoff with the orchestrator/product owner if they have a different risk appetite — it's a one-line constant, not an architectural decision.
  3. "Send Campaign" button (`btn btn-primary`) replaces the current `btn-primary px-12` — same submit handler (`sendCampaign` → navigate to `/admin/marketing-campaigns`), gated by both (1) and, when applicable, (2).
- "Back" button returns to Step 2 without losing state (signals persist across step changes — nothing is destroyed/recreated).

### 4.5 Test-send-to-self (real endpoint, MVP fallback pattern — flagged honestly)

**No dedicated test-send endpoint exists.** `sendCampaign` is the only send path, and it always creates a real, visible `MarketingCampaign` row.

**MVP fallback (ships today, zero backend change)**: "Send test to me" calls `AuthService.getCurrentUser()` (already used elsewhere in the admin — `GET /api/auth/me` → `{ id, email }`) and then calls `adminApi.sendCampaign({ name: `${name()} (test)`, ...resolvedContent, userIds: [currentUser.id] })` — a genuine, tiny (1-recipient) campaign send through the real pipeline, targeted only at the admin's own account. Side effects to disclose in the UI (small `text-xs text-ink-500` caption under the button): _"Sends a real email to your account and creates a small campaign record named '<name> (test)'."_ Debounce the button for ~5s after click (disabled + spinner) to prevent accidental double-sends, and show a toast/inline confirmation "Test sent to {{ email }}" on success.

**Flagged backend addition**: a real `POST /admin/marketing/test-send` that renders + emails the content to the current admin **without** creating a `MarketingCampaign` row (no recipient/segment fields, no send-count bookkeeping). This is the cleaner long-term UX (no phantom "(test)" campaigns cluttering History) but is not required to ship this feature — the MVP fallback above is fully functional today.

### 4.6 Sandboxed email preview — `EmailPreviewFrame` (NEW shared component, the audit's explicit XSS callout)

New component: `marketing/components/email-preview-frame/email-preview-frame.ts(+html)`. **This is the one component every "preview" surface in this spec reuses** — Compose Step 2, Compose Step 3, and the Templates gallery preview (§6.2) all consume the same component so the sanitization logic exists in exactly one place.

**Hard requirement (per the audit and the task's constraints): never `[innerHTML]` raw email HTML.** This spec specifies **defense in depth** — both layers, not either/or:

1. **Sanitize before render.** `dompurify` is already a workspace dependency (`package.json` — `"dompurify": "^3.3.3"`, also used transitively by `@ptah-extension/markdown`). Run the subject-substituted HTML through `DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['onerror', 'onload', 'onclick', /* full on* coverage via DOMPurify defaults */] })` before it ever reaches the DOM. (Note: `libs/frontend/markdown`'s DOMPurify chokepoint is scoped to _markdown-rendered_ chat content and isn't the right reuse target here — this component's input is already raw HTML from an admin-authored email, a different trust boundary — so this is a small, purpose-built sanitize call inside this component, not a detour through the chat markdown pipeline.)
2. **Render inside a sandboxed, srcdoc'd iframe**, never `[innerHTML]` on the host document: `<iframe [attr.sandbox]="''" [srcdoc]="sanitizedHtml()" class="w-full h-[420px] rounded-md border border-base-300 bg-white"></iframe>`. An **empty `sandbox` attribute** is maximally restrictive — no scripts, no same-origin, no forms, no top-navigation, no popups — appropriate here because the preview only needs to render visual markup, never execute anything. `srcdoc` (not `src` with a blob/data URL) keeps the whole thing synchronous and avoids an extra URL-revocation lifecycle to manage.
3. White background (`bg-white`) inside the frame regardless of the surrounding `operator` dark theme — email clients render on white, and the preview should show what recipients will actually see, not the admin console's dark chrome bleeding into the mock.
4. Inputs: `subject = input<string>('')`, `htmlBody = input<string>('')`, `sampleVars = input<Record<string,string>>({ firstName: 'Jordan', email: 'jordan@example.com', unsubscribeUrl: '#' })`. Internally: a `computed` does `{{var}}` substitution → sanitize → `srcdoc`. Subject renders above the frame as a small mock email-header line (`text-sm font-medium border-b border-base-300 pb-2 mb-2`, prefixed `Subject:`).
5. Empty/invalid HTML → `EmptyState` fallback (icon `Eye`, "Nothing to preview yet") instead of an empty white rectangle.

---

## 5. Campaign History (`/admin/marketing-campaigns`) & Campaign Detail (`/admin/marketing-campaigns/:id`)

### 5.1 Campaign History — bespoke list

New component: `marketing/campaign-history/campaign-history-list.ts(+html)`, replacing the generic `AdminList` for this route (the model stays `readOnly: true` in `admin-models.config.ts` — no edit form was ever needed here, and none is added).

- Header: title "Campaign History" + total count (existing generic-list pattern) + primary action `+ Compose Campaign` (`btn btn-primary btn-sm`) top-right, same placement convention as Licenses' "Issue Complimentary License" (TASK_2026_164 §4.3.1).
- Uses `adminApi.list('marketing-campaigns', { page, pageSize, sortBy: 'createdAt', sortOrder: 'desc', search })` — reuses the model's existing `searchPlaceholder` ("Search campaign name, subject, segment, creator…") and the generic search box UI already built for `AdminList`, just inside the bespoke component.
- Row shape — same compact row-list pattern as the Hub's Recent Campaigns (§3.4), not a dense multi-column table: name + `StatusBadge` (in_progress/completed, §3.7) + delivery/bounce/complaint rates (colored per §3.7) + `createdAt` + chevron. Full pagination controls (existing `AdminListResponse.page/pageSize/totalPages`) below the list, reusing the generic pagination component if `AdminList`/`DataTable` already extracted one, or the same inline pattern otherwise.
- Row click → `routerLink="/admin/marketing-campaigns/:id"` (a real navigation, not a `DetailDrawer` — unlike Failed-Webhooks' triage-oriented drawer, a campaign's performance record is worth a shareable/bookmarkable URL, and there's no "resolve and get back to the queue" workflow here that a drawer's stay-on-the-list affordance was designed for).
- Empty state: `EmptyState`, icon `Megaphone`, "No campaigns match your search" (filtered) vs. "No campaigns sent yet" + Compose CTA (true empty).
- Loading: skeleton rows (§7.5 pattern, 5 rows). Error: `alert alert-error` + Retry (unchanged pattern).

### 5.2 Campaign Detail

New component: `marketing/campaign-history/campaign-detail/campaign-detail.ts(+html)`. Fetches via `adminApi.get<MarketingCampaignRecord>('marketing-campaigns', id)` — **this is a real, already-existing generic endpoint** (`AdminApiService.get(model, id)`, `admin-api.service.ts:416-424`), used today by generic `AdminDetail` for every model including this one; this view simply gives it a purpose-built presentation instead of the generic field-grid.

Layout — three stacked cards, mirroring the User Profile pattern's "identity / data / danger-adjacent" rhythm (TASK_2026_164 §4.4.2) adapted for a read-only performance record:

1. **Header card** — campaign `name` as the page title, `StatusBadge` (Sending/Completed) beside it, `subject` as a muted subtitle (`text-sm text-ink-400`), `createdBy` + `createdAt`/`completedAt` as a metadata row (`text-xs text-ink-500`, same demoted-metadata treatment as User Profile's WorkOS/Paddle IDs).
2. **Performance card** — the three rates (delivery/bounce/complaint) as three `ptah-admin-stat-tile`s (`size="default"`, delta-toned per §3.7's thresholds) side by side, plus the raw counts underneath in small print (`sentCount of recipientCount`, `bouncedCount bounced`, `complainedCount complaints`) — rates lead, counts are the supporting detail, inverting today's counts-only table.
3. **Audience card** — `segment` field resolved through the shared label map (§7.2) → "Target Segment: Builders Active", or "Explicit recipient list" when `segment` is empty (the stored row has no field enumerating individual explicit user IDs, so the detail honestly says "explicit list" without fabricating a member roster) + `recipientCount`. A `View this segment in Compose →` link (`routerLink="/admin/marketing/compose" [queryParams]="{segment: c.segment}"`) when a segment is present.

**Flagged backend addition (per-campaign analytics beyond the stored counts)**: today's row has no time-series (sends-per-hour), no open/click tracking, and no enumerated recipient list — only aggregate counts. If richer analytics are wanted later, the natural addition is a `GET /admin/marketing-campaigns/:id/recipients` (paginated, for audit/debugging) and/or open/click webhook ingestion feeding new `openedCount`/`clickedCount` columns, surfaced as two more Performance-card tiles. **MVP fallback (what ships now, zero backend change)**: the three cards above, built entirely from the existing row fields — nothing in §5.2 waits on this addition.

---

## 6. Templates Management

### 6.1 Templates Gallery (`/admin/marketing-campaign-templates`) — replaces generic `AdminList`

New component: `marketing/templates/templates-gallery.ts(+html)`. A **card grid**, not a table — templates are visual artifacts (subject + rendered HTML), and a preview-first card layout serves that better than a data-table row ever could; this is the same "the right layout follows the content" principle the LAYOUT-PATTERNS skill file argues for, applied to admin instead of marketing.

- Header: title "Email Templates" + primary action `+ New Template` (`btn btn-primary btn-sm`, → `/admin/marketing/templates/new`).
- `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`, each card `rounded-lg border border-base-300 bg-base-200 p-4 flex flex-col gap-2`:
  - `name` (`font-medium text-sm truncate`)
  - `subject` (`text-xs text-ink-400 truncate`)
  - Variable chips (`badge badge-ghost badge-xs` per variable, from the `variables: string[]` field, capped at ~4 visible + "+N more")
  - `updatedAt` relative (`text-xs text-ink-500`)
  - Action row (`flex gap-2 pt-2 border-t border-base-300 mt-auto`):
    - **Preview** (`btn btn-ghost btn-xs`, icon `Eye`) → opens a modal (daisyUI `<dialog>`, or the existing `DetailDrawer` shell repurposed as a centered-modal-style container — either is acceptable; the requirement is a **sandboxed** surface) containing the shared `EmailPreviewFrame` (§4.6) bound to this template's `subject`/`htmlBody`.
    - **Duplicate** (`btn btn-ghost btn-xs`, icon `Copy`) → `routerLink="/admin/marketing/templates/new" [queryParams]="{duplicateFrom: t.id}"` (§6.3).
    - **Use in campaign** (`btn btn-ghost btn-xs`, icon `SendHorizontal`) → `routerLink="/admin/marketing/compose" [queryParams]="{templateId: t.id}"` (§6.2, §4.3).
    - **Edit** (`btn btn-ghost btn-xs`, icon `FileText`) → `routerLink="/admin/marketing-campaign-templates/{{t.id}}"`, landing on the **unchanged generic `AdminDetail`** edit form — `name`/`subject`/`htmlBody` are already `editable: true` in `admin-models.config.ts` and PATCH through the existing generic `AdminApiService.update(model, id, patch)`. No new edit surface is built; the gallery is additive UI on top of infrastructure that already works.
- Empty state: `EmptyState`, icon `FileText`, "No templates yet" + "Create a template" action.
- No delete action anywhere in this spec — `AdminApiService` has no generic delete method today (only the model-specific `deleteUser`), so template deletion is out of scope; flag as a future backend + frontend addition if the orchestrator wants it, no MVP fallback needed since nothing here depends on it.

### 6.2 "Use in new campaign" handoff

Pure client-side query-param handoff, no backend involvement: gallery card → `/admin/marketing/compose?templateId=<id>` → Compose Step 1 loads (Audience unset), admin fills audience, advances to Step 2 where the `templateId` query param is read on init and the `TemplatePicker`'s value is set programmatically, resolving the same as if the admin had picked it manually (§4.3).

### 6.3 Duplicate

`template-create.ts` gains an optional `?duplicateFrom=<id>` read on init: fetch via `adminApi.get<MarketingTemplate>('marketing-campaign-templates', id)`, prefill `name.set(t.name + ' (Copy)')` (server enforces unique names — `TEMPLATE_NAME_TAKEN` is already handled, §6.4 — so the admin sees a friendly rejection if they don't rename before saving, no new error handling needed), `subject.set(t.subject)`, `htmlBody.set(t.htmlBody)`, `variablesRaw.set(t.variables.join(', '))`. Page header swaps to "Duplicate Template" when the query param is present, otherwise stays "New Template".

### 6.4 Template Create/Edit — restyle + preview

`marketing/template-create/template-create.ts(+html)` restyle (logic unchanged — `saveTemplate`, the existing `TEMPLATE_NAME_TAKEN`/`TEMPLATE_SANITISE_REJECTED` friendly-error mapping, all kept verbatim):

- Off-system `card bg-base-100 shadow-sm border border-base-200` / `text-primary` → `bg-base-200 border border-base-300 rounded-lg p-4 lg:p-6` shell + `text-base-content` heading, matching every other admin card (§7.1).
- Same two-column layout as Compose Step 2 (§4.3): form left, `EmailPreviewFrame` (§4.6) right, live-bound to the in-progress `subject()`/`htmlBody()` signals as the admin types — this closes the audit's "no live preview of the email" gap for template authoring, the same gap Compose had.
- The server already sanitizes/rejects disallowed HTML on save (`TEMPLATE_SANITISE_REJECTED`) — the **client-side** preview sanitization (§4.6) is a separate, independent layer for safe _rendering_, not a substitute for or duplicate of the server's save-time validation; both exist for different reasons (one protects the admin's own browser at preview time, the other protects recipients' mail clients at send time) and neither should be removed in favor of the other.

---

## 7. Design-System Application (token/component map)

Every surface in this spec maps to TASK_2026_164 §7 tokens and the shared components it shipped. No off-system class survives this redesign.

| Surface element           | Legacy (today)                                          | Redesigned (TASK_2026_164-compliant)                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section headings          | `text-lg font-semibold text-primary`                    | `text-lg font-semibold text-base-content`, or `text-xs font-semibold uppercase tracking-wide text-ink-400` for section labels (§7.4)                                                                                                                                                         |
| Cards                     | `card bg-base-100 shadow-sm border border-base-200 p-6` | `bg-base-200 border border-base-300 rounded-lg p-4 lg:p-6` (§7.1, `--rounded-box`)                                                                                                                                                                                                           |
| Alerts (error/info)       | `alert alert-error`/`alert-info` + inline `<svg>`       | Keep daisyUI `alert-*` classes (already token-correct) but **remove every inline `<svg>`** in favor of `lucide-angular` icons — `AlertTriangle`/`XCircle` for error, `Info` for info (§7.6)                                                                                                  |
| Recipient/campaign status | plain text / bare counts                                | `ptah-admin-status-badge` `[variant]` (client-derived, §3.7)                                                                                                                                                                                                                                 |
| Hub/detail metrics        | none existed                                            | `ptah-admin-stat-tile` (§3.3, §5.2)                                                                                                                                                                                                                                                          |
| Empty rows/lists          | `No records.` text or nothing                           | `ptah-admin-empty-state` everywhere (§3.4, §5.1, §6.1)                                                                                                                                                                                                                                       |
| Step/wizard chrome        | none existed (single long form)                         | numbered-circle stepper pattern reused from `delete-user-modal` (§4.1)                                                                                                                                                                                                                       |
| Type-to-confirm friction  | none existed (one-click send)                           | pattern reused from `delete-user-modal`'s type-to-confirm (§4.4)                                                                                                                                                                                                                             |
| Icons                     | zero, one hamburger SVG                                 | `lucide-angular` throughout: `Megaphone` (nav + empty states), `FlaskConical` (test-send), `Eye` (preview), `Copy` (duplicate), `SendHorizontal` (use-in-campaign), `FileText` (templates/edit), `ChevronRight` (row nav) — all confirmed present in the installed `lucide-angular` icon set |
| Color semantics           | none (no rate coloring existed)                         | §3.7's delivery/bounce/complaint thresholds map directly onto the existing 5-state semantic palette (`success`/`warning`/`error`) from TASK_2026_164 §7.3 — no new colors introduced                                                                                                         |

### 7.2 One DRY note for frontend-developer

`SegmentPicker.getSegmentLabel()` (`components/segment-picker/segment-picker.ts:57-70`) is the only place today that maps a `MarketingSegmentKey` to a display label. Three new surfaces in this spec need the same mapping (Hub's Audience panel §3.5, Campaign Detail's Audience card §5.2, Compose's Step 3 summary §4.4). Extract it once into a small pure module — e.g. `marketing/marketing-segment-labels.ts` exporting `SEGMENT_LABELS: Record<MarketingSegmentKey, string>` — and have `SegmentPicker` import from it too, rather than four copies of the same `switch`.

---

## 8. Component / Build Plan

Ordered by dependency. All paths under `apps/ptah-landing-page/src/app/pages/admin/` unless noted. Reused-as-is components (no changes needed): `StatusBadge`, `StatTile`, `EmptyState`, `SegmentPicker` (after §7.2's extraction), `TemplatePicker`.

**P0 — Shared foundation for this batch**

1. NEW `marketing/marketing-metrics.ts` — pure `computeCampaignRates()` + threshold-color helpers (§3.7). Zero Angular dependency, fully unit-testable in isolation.
2. NEW `marketing/marketing-segment-labels.ts` — `SEGMENT_LABELS` map (§7.2); refactor `components/segment-picker/segment-picker.ts` to import it instead of its inline `switch`.
3. NEW `marketing/components/email-preview-frame/email-preview-frame.ts(+html)` — sandboxed + sanitized preview (§4.6). Depends on `dompurify` (already a workspace dependency, `package.json:146`).
4. `admin-layout/admin-nav.config.ts` — add the `Marketing` primary nav item, demote `Compose Campaign` to secondary (§2.2).
5. `admin.routes.ts` — add `marketing` (hub), `marketing-campaigns` (bespoke, replacing catch-all resolution), `marketing-campaigns/:id` (new), `marketing-campaign-templates` (bespoke, replacing catch-all resolution) as explicit `loadComponent` entries above the `:model`/`:model/:id` catch-all (§2.1) — `marketing-campaign-templates/:id` is intentionally left resolving to the existing generic `AdminDetail` route (unchanged).

**P1 — Hub + History + Detail**

6. NEW `marketing/marketing-hub/marketing-hub.ts(+html)` (§3) — consumes items 1–3, `StatTile`, `EmptyState`.
7. NEW `marketing/campaign-history/campaign-history-list.ts(+html)` (§5.1) — consumes item 1, `StatusBadge`, `EmptyState`.
8. NEW `marketing/campaign-history/campaign-detail/campaign-detail.ts(+html)` (§5.2) — consumes item 1, item 2, `StatTile`, `StatusBadge`.

**P1 — Compose rewrite**

9. REWRITE `marketing/marketing-compose/marketing-compose.ts(+html)` (§4) — 3-step stepper; consumes item 3 (`EmailPreviewFrame`), `AuthService.getCurrentUser()` (existing), existing `SegmentPicker`/`TemplatePicker`. This is the single largest item in the plan — consider splitting the three steps into presentational sub-components (`compose-step-audience/`, `compose-step-content/`, `compose-step-review/`) owned by the parent's signal state, if the combined template grows unwieldy; either a single component or three is acceptable, the requirement is the behavior in §4.1–§4.5, not a specific file split.

**P1 — Templates**

10. NEW `marketing/templates/templates-gallery.ts(+html)` (§6.1) — consumes item 3 (preview modal), `EmptyState`.
11. RESTYLE + EXTEND `marketing/template-create/template-create.ts(+html)` (§6.3, §6.4) — add `?duplicateFrom=` prefill, add item 3 (`EmailPreviewFrame`) as the live-preview right column; existing `saveTemplate`/error-mapping logic untouched.

**Backend coordination (flagged, not blocking — every item above has a documented MVP fallback already shipping against today's API)**

12. Optional `POST /admin/marketing/test-send` — non-recorded test send (§4.5). MVP fallback already specified and functional: reuse `sendCampaign` with `userIds: [self.id]`.
13. Optional per-campaign recipient/analytics endpoints (opens/clicks/recipient roster, §5.2). MVP fallback already specified and functional: the three cards built from today's stored row fields.
14. Optional draft/schedule support — `MarketingCampaign.status: 'draft'|'scheduled'|'sent'`, a `scheduledAt` field, and a worker to fire scheduled sends. **No MVP backend-free equivalent exists for true persistence** (nothing survives a lost tab/browser crash without a server-side draft record) — the closest zero-backend approximation is a `sessionStorage`-backed autosave of the Compose signal state, keyed per-tab, restored if the admin navigates away and back within the same browser session; this is a convenience against accidental navigation, explicitly **not** a real draft feature, and should be labeled honestly in the UI if implemented (e.g., a small "Draft restored" toast, not a "Drafts" list/tab implying persistence that doesn't exist). Recommend deferring this sub-item entirely unless the orchestrator specifically wants the autosave convenience — it's the one piece of this spec that's genuinely optional rather than "ships today."

**Routing recap**: `admin.routes.ts` needs 4 new/changed entries (`marketing`, `marketing-campaigns`, `marketing-campaigns/:id`, `marketing-campaign-templates`), all lazy `loadComponent`, all above the generic catch-all — consistent with how the four TASK_2026_164 bespoke views were wired in, no new pattern introduced.
