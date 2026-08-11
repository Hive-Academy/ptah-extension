# Batch 6 — Admin UI: approve replaces invite

**Executor**: `frontend-developer` · **Branch**: `ak/founding-cohort-free-access`
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Status**: ✅ COMPLETE — not committed (team-leader owns commits)
**Satisfies**: R9.1–R9.6, R6.4 · C2 (client half)

---

## 1. File-by-file changes

### Deleted (2 files + 1 e2e spec)

| Path | Why |
| --- | --- |
| `libs/web/admin/src/lib/components/waitlist-invite-modal/waitlist-invite-modal.ts` | The paid-invite modal. Deleted whole, not repointed. |
| `libs/web/admin/src/lib/components/waitlist-invite-modal/waitlist-invite-modal.html` | Carried the prohibited pricing copy at `:9-12`. |
| `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` | 116 lines, 2 tests, exercising only the deleted modal and the deleted `POST /waitlist/invite`. See §5. |

### Added (4 files)

| Path | Contents |
| --- | --- |
| `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts` | `ApproveWaitlistModal` — standalone, `OnPush`, signals + `inject()`. `open`/`ids` inputs, `closeModal`/`submitted` outputs. |
| `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html` | Two-state DaisyUI `<dialog class="modal modal-open">`: confirm, then the five-outcome tally. |
| `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts` | 20 tests (new file — there was no spec before). |
| `apps/ptah-landing-page-e2e/src/specs/admin-waitlist-approve.spec.ts` | The like-for-like `@p0` replacement, 2 tests. |

### Modified (8 files)

**`libs/web/admin/src/lib/services/admin-api.service.ts`**
- Deleted `AdminInviteWaitlistRequest`, `adminInviteWaitlistResponseSchema`, `AdminInviteWaitlistResponse`, `inviteWaitlist()`.
- Added `ADMIN_APPROVE_WAITLIST_MAX_IDS = 50` (mirrors the server DTO's `@ArrayMaxSize(50)`), `AdminApproveWaitlistRequest` (plain interface, per the house convention for outbound bodies), and the inbound Zod stack: `ADMIN_APPROVE_WAITLIST_OUTCOMES` → `adminApproveWaitlistOutcomeSchema` → `adminApproveWaitlistRowSchema` → `adminApproveWaitlistTallySchema` → `adminApproveWaitlistResponseSchema`, with `z.infer`red types (`AdminApproveWaitlistOutcome`, `AdminApproveWaitlistRow`, `AdminApproveWaitlistTally`, `AdminApproveWaitlistResponse`).
- Added `approveWaitlist()` → `POST ${base}/waitlist/approve`, validated through `validate(schema, 'POST /waitlist/approve')` exactly like every sibling.
- `adminStatsWaitlistSchema` += `approved: z.number().optional()` — `.optional()` follows the `attention` precedent so a brief server/client deploy skew cannot break the whole stats call.
- Retargeted the `IssueComplimentaryLicenseRequest` docblock: `email` stays on the wire contract (the server still accepts it) but is flagged as never sent by the admin UI any more.

**`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts`** — full rewrite of the component class.
- `WaitlistTab` += `'approved'` (now exported, for the spec). `WaitlistRow` += `approvedAt: string | null` (now exported).
- `normalizeTab` accepts `approved`; unknown/absent still falls back to `new`.
- `filter` computed += `approved` → `'approved:true'`.
- `tabs` += `{ key: 'approved', label: 'Approved' }`, ordered New | Invited | Approved | Converted | All.
- New `approvableTab` computed (`new | invited`) driving both the checkbox and the per-row button.
- `stageLabel` / `stageVariant` rank **Converted → Approved → Invited → New**.
- `summaryApproved` from `stats()?.waitlist.approved ?? 0`.
- Signals `approveOpen` / `approveIds` / `approveToast`; handlers `onApproveSelected()` / `onApproveRow(row)` / `onApproveClose()` / `onApproveDone(result)`.
- Deleted: `WaitlistInviteModal` + `IssueCompLicenseModalComponent` imports, the `compLicenseModal` viewChild (and the now-unused `viewChild` import), `inviteRecipients` / `waitlistInviteOpen` / `inviteToast`, `approveEmail` / `approvedAt`, `quickInviteBatch`, `onSendFoundingInvites` / `onInviteOldest` / `onInviteClose` / `onInviteSent`, `onApprove` / `onApproved`, and the `UserPlus` icon import.

**`libs/web/admin/src/lib/waitlist/waitlist-pipeline.html`**
- Deleted the "Invite oldest N" quick action, the invite modal mount, the comp-licence modal mount and the invite toast.
- Selection toolbar and row checkbox gate widened from `tab() === 'new'` to `approvableTab()`; the projected button reads **"Approve to Founding Cohort"**.
- Per-row `@switch`: added `@case ('new')` with an **Approve** button, kept `@case ('invited')` with the same button, added `@case ('approved')` (approval date + "View license" link), kept `@case ('converted')`.
- Stage chip moved out of `@if (tab() === 'all')` — it now renders on **every** tab.
- Added the `approved` empty state; header summary strip gained the Approved count.
- Mounted `<ptah-admin-approve-waitlist-modal>`; the toast now prints all five tallies and turns `alert-warning` when `failed > 0`.

**`libs/web/admin/src/lib/components/issue-comp-license-modal/issue-comp-license-modal.ts`** — waitlist branch retired.
- Deleted the `email` input, `isWaitlistMode`, the `!email().trim()` clause in `isSearchMode`, the `email()` arm of `displayEmail`, the waitlist arm of `open()`'s defaults (now unconditionally `30d` / blank reason), and the bound-`email` arm of `confirm()`'s target precedence (now search-picked user → bound `userId`).
- **Retained unchanged**: the `userId` (Users-detail) and `mode: 'search'` (Licenses-list) paths.

**`libs/web/admin/src/lib/admin-detail/{admin-detail.ts,admin-detail.html}`**
- Deleted the `supportsEarlyAdopterApprove` branch (button + modal mount), `onEarlyAdopterApproved()`, the `earlyAdopterApprovedAt` signal and its toast. A comment in its place records why the button must not come back.

**`libs/web/admin/src/lib/admin-list/{admin-list.ts,admin-list.html}`** — see §2.

**`libs/web/admin/src/lib/admin-models.config.ts`**
- Deleted `supportsWaitlistInvite` and `supportsEarlyAdopterApprove` from the `AdminModelSpec` interface **and** from the `waitlist` entry.
- Added the `approvedAt` field spec: `type: 'datetime'`, `listColumn: true`, deliberately **not** `editable` — hand-stamping it would fake a grant (no licence, no cohort, no email) and the approve endpoint's claim would then skip the row as already approved.

---

## 2. How BOTH `WaitlistInviteModal` consumers were handled

The deletion had two call sites; both land in this change, so the build never sees a dangling import.

**Consumer 1 — `waitlist-pipeline` (the bespoke queue).** Replaced by `ApproveWaitlistModal`: import swapped in the `imports` array, the mount swapped in the template, and the four invite handlers replaced by the four approve handlers. This consumer *gained* a replacement.

**Consumer 2 — `admin-list` (the generic `/admin/:model` list), gated on `supportsWaitlistInvite`.** This consumer got **no replacement**, by design — the generic table has no notion of pipeline stages or per-row context, and putting a grant action behind a flag on a generic list is what produced two competing approve paths in the first place. Removed:
- the `WaitlistInviteModal` import and its `imports` entry;
- the "Send Founding Invites" header button;
- the modal mount and the invite toast block;
- `waitlistInviteOpen` / `waitlistInviteToast` signals, their reset lines in the model-change effect, and `onWaitlistInviteClick` / `onWaitlistInviteClose` / `onWaitlistInviteSent`;
- `[selectable]="!!(s.supportsBulkEmail || s.supportsWaitlistInvite)"` → `[selectable]="!!s.supportsBulkEmail"`;
- the `selectedIds` comment at `:87`.

One extra removal beyond the plan, noted for review: `refreshTick` in `admin-list.ts` was bumped **only** by `onWaitlistInviteSent`. With that handler gone it became a signal with no writer — dead code that a reviewer would flag — so it and its `combineLatest` slot were removed. Bulk email never used it; list behaviour is unchanged.

Then `admin-models.config.ts` (task 6.9) deleted the flag itself, so the dead gate cannot be re-lit by config.

---

## 3. The approve UX flow

**Entry points, one confirmation.** A per-row **Approve** button (New *and* Invited) calls `onApproveRow(row)` → `approveIds = [row.id]`. The `SelectionToolbar`'s **"Approve to Founding Cohort"** calls `onApproveSelected()` → `approveIds = selectedIds()`. Both open the same modal; there is exactly one confirmation path.

**R6.4 — the gate is closed.** Approve previously existed only under `@case ('invited')`, so a New row had to be mailed the (now deleted) paid invite before it could be approved. `approvableTab()` is `new | invited` and both cases carry the button, so a New row is approvable directly.

**Confirmation copy (R9.2)** — the grant, stated plainly:

> **N** people, free Builders access for 1 year, added to **Founding Members**, one email each.
> · Nobody is charged and no checkout link is sent.
> · Rows that already paid, or that were approved before, are skipped — they are reported back, not re-granted.

The submit button reads `Approve N`. Zero selection and over-cap selection each render their own blocking notice and disable submit; the cap notice names the limit and tells the admin to run a second batch, rather than letting a 60-row selection come back as an opaque 400.

**Result summary (R9.3)** — all five outcomes render, always, zeros included, each with a one-line reason:

| Row | Copy |
| --- | --- |
| Approved | Free 1-year Builders access granted, cohort assigned, welcome email sent. |
| Already approved | Approved earlier — nothing was granted again and no email was re-sent. |
| Already paid | These people already bought a membership, so they were skipped. |
| Not found | No waitlist row matched the id — it may have been deleted since the list loaded. |
| Failed | Rolled back — no licence, no cohort placement, no email. Safe to retry. |

A sixth block appears only when the response carries `warning: { code: 'APPROVAL_EMAIL_FAILED' }` rows: it states that the access *was* granted and the recovery is to re-send the key, so nobody re-runs approve looking for a rollback that will never come.

`onApproveDone` bumps `refreshTick` **and** calls `fetchStats()`, so both the row list and the header summary refresh. The toast repeats the whole tally and turns amber when `failed > 0`.

**Failure (R9.6).** The `error` arm sets `errorMessage` from the server's sanitized message and neither emits `submitted` nor closes. `clearSelection()` lives in `onApproveDone`, which only a returned response reaches — so a failed request **leaves the selection intact** and the same rows can be retried immediately.

---

## 4. The Approved stage

- **Tab + filter**: `WaitlistTab` += `'approved'`; `filter()` returns `'approved:true'`.
- **Row**: `WaitlistRow` += `approvedAt: string | null`; the Approved tab shows the approval date plus a "View license" link.
- **Deep link (R9.5)**: `normalizeTab('approved') === 'approved'`, so the pre-existing `?tab=` sync works unchanged. Covered by a router-harness test that navigates to `/admin/waitlist?tab=approved` and asserts the emitted filter.
- **Header summary**: `summaryApproved` from `stats()?.waitlist.approved ?? 0`, rendered between Invited and Converted.
- **Ranking (R9.4)**: `stageLabel` returns Converted → Approved → Invited → New. `stageVariant` maps to `success` → `info` → `neutral` → `ghost`.

**One deviation from the plan, flagged.** The plan implies four visually distinct stage variants. `BadgeVariant` (`libs/web/panel-ui/src/lib/badge-variant.ts`) is a closed six-name vocabulary — `success | warning | error | info | neutral | ghost` — with no `primary`. Widening it would touch a presentation contract the member panel also consumes, for one chip. I mapped inside the existing vocabulary instead: Converted `success`, Approved `info`, **Invited moved from `info` to `neutral`** (its `Clock` icon suits "invited, awaiting response"), New `ghost` unchanged. Four distinct chips, no shared contract widened. The only behavioural change to an existing stage is Invited's colour.

**The accepted tab overlap** is handled as the plan requires: `ListQueryDto.filter` is one `field:value` pair, so `new` cannot express "not notified AND not approved", and a row approved without ever being invited appears under both **New** and **Approved**. The stage chip therefore renders on **every** tab, which makes the overlap self-explaining. A `stage:` preset filter was **not** built. The overlap case has its own test.

---

## 5. The e2e swap — both halves landed

**Deleted**: `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` (116 lines, 2 tests, `@p0`).

**Added**: `apps/ptah-landing-page-e2e/src/specs/admin-waitlist-approve.spec.ts` (2 tests, `@p0`), mirroring the deleted file's structure: same `test.skip` on `E2E_ADMIN_EMAIL`, same `adminPage` fixture, same `seedWaitlistEntry` / `cleanupWaitlistEntry` in a `try/finally`, same "reach the real admin surface, intercept only the side-effecting call" shape.

1. **per-row approve posts `{ ids }` with exactly that row** — clicks a per-row Approve on the **New** tab (which is itself the R6.4 assertion), asserts the confirmation states the 1-year grant, the `Founding Members` cohort and "one email each", then asserts `body.ids` has length 1.
2. **bulk approve posts the selection and shows every outcome in the tally** — selects a row, opens the toolbar action, stubs a *mixed* response (1 approved / 1 already approved / 1 already paid) and asserts all five outcome labels are visible inside `.modal-box`, zeros included.

`page.route` intercepts `**/api/v1/admin/waitlist/approve` in both, so **no real licence is issued, no cohort assigned and no welcome email sent**. The stubs are typed as `WaitlistApprovalResponse` from `@ptah-api/admin`, so a contract drift breaks this file at compile time rather than leaving it green against a shape the server no longer returns — the exact failure mode that made the deleted spec hollow.

**⚠️ Reviewer decision needed — one `eslint-disable`.** The ruling says assert against `@ptah-api/admin`, but that lib is `scope:api` and this project is tagged `scope:landing` + `scope:e2e`, neither of which may depend on it; the import is a hard `@nx/enforce-module-boundaries` error. Resolved with a **type-only** import plus one `// eslint-disable-next-line @nx/enforce-module-boundaries` carrying a docblock that states why (`import type` is fully erased, so no NestJS module is loaded or bundled; a value import would be a real violation). This follows existing precedent in the repo (`apps/ptah-license-server/prisma/seed/prisma-client.ts:35`, `apps/ptah-electron/src/shims/vscode-shim.integration.spec.ts:30`). The alternatives were worse: widening the global tag constraints for one spec, or dropping the compile-time coupling the ruling exists to create. If the team-leader prefers no disable, the fallback is a locally-declared structural mirror in the spec — say the word and I will swap it.

Parity confirmed by collection: `npx playwright test --list --grep @p0` reports both new tests under `admin-waitlist-approve.spec.ts` and no reference to the deleted file. p0 count for this surface is unchanged at 2.

---

## 6. Acceptance greps (all run from the worktree root)

```
$ grep -rn "70%|\$87|\$8\.70|off the first year" libs/web/admin     → NONE ✅   (R9.1)
$ grep -rn "WaitlistInviteModal|supportsWaitlistInvite|supportsEarlyAdopterApprove" libs/web/admin
                                                                     → NONE ✅
$ grep -rn "\[email\]=" libs/web/admin                               → NONE ✅   (task 6.6)
$ grep -rn "inviteWaitlist|AdminInviteWaitlist" libs/web apps/ptah-landing-page-e2e
                                                                     → NONE ✅
$ grep -rn "Founding Invites|waitlist/invite|Approve \(grant" apps/ptah-landing-page-e2e/src
                                                                     → NONE ✅
```

Note on R9.1: my own docblocks initially quoted the retired symbol names and the discount figure while explaining *why* they are gone. Both were reworded — the gate is a source-text gate and a comment is source text. Nothing in `libs/web/admin` matches any prohibited string, in code or in prose.

Surviving repo-wide `inviteWaitlist` hits are all historical prose outside this batch's scope and outside Batch 7's stated exceptions-free set: `libs/api/audit/src/lib/audit-log.types.ts:25` and `apps/ptah-license-server/src/common/controller-validation.spec.ts:310`, both comments recording what the route used to be.

---

## 7. Verification results

| Command | Result |
| --- | --- |
| `npx nx run web-admin:test` | ✅ **11 suites / 169 tests passed** (20 of them the new `waitlist-pipeline.spec.ts`) |
| `npx nx run web-admin:typecheck` | ✅ pass (`ngc --noEmit`) |
| `npx nx run ptah-landing-page:typecheck` | ✅ pass |
| `npx nx run-many -t eslint:lint -p web-admin,ptah-landing-page-e2e` | ✅ **0 errors**; 8 warnings, all pre-existing (`$any` in `admin-detail.html`, accessibility modifiers in `delete-user-modal.ts`, one `any` in `issue-comp-license-modal.ts:232`) |
| `npx nx build ptah-landing-page` | ✅ pass — `waitlist-pipeline` chunk 19.66 kB. Two budget warnings are pre-existing (initial bundle, FullCalendar CSS) |
| `npx nx run ptah-landing-page-e2e:typecheck` | ✅ pass |
| `npx playwright test --list --grep @p0` | ✅ collects both new tests |

Project name discovered from `libs/web/admin/project.json`: **`web-admin`** (targets `test`, `lint`, `typecheck`, plus inferred `eslint:lint`). `ptah-landing-page-e2e` has `eslint:lint`, `typecheck`, `e2e`, `e2e:p0`, `e2e:checkout`.

**Coverage of the new unit spec** (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts`, 20 tests):
tab normalisation incl. `approved` and the retired-name fallback (R9.5) · the `?tab=approved` deep link through a real `RouterTestingHarness` · the filter each of the five tabs sends · the four-way stage ranking and the approved-but-never-invited overlap case (R9.4) · `approvableTab` across all four stage tabs (R6.4) · per-row vs bulk modal opening and the empty-selection no-op · the tally reaching the toast with skips intact, the list+stats double refresh, and selection clearing (R9.3) · `summaryApproved` present / absent / stats-call-failed.

---

## 8. Not done / open

1. **The Playwright suite was NOT executed.** It needs a running landing page, a running license server, the `ptah_postgres` docker container for `psql` seeding, and `E2E_ADMIN_EMAIL` present in the server's `ADMIN_EMAILS` allowlist — none of which is wired for headless CI in this worktree. The new spec was verified by **collection** (`--list --grep @p0`) and by `tsc` typecheck only. Its selectors and copy assertions are unverified against a live DOM; that is the standing gate for every spec in this file's `describe`, which self-skips without `E2E_ADMIN_EMAIL`.
2. **The `eslint-disable` in §5 is a reviewer decision**, not a fait accompli. Fallback described there.
3. **Invited's badge colour changed** from `info` to `neutral` as a consequence of fitting four stages into the six-name `BadgeVariant` vocabulary (§4). Purely visual; called out in case it is unwanted.
4. **`refreshTick` removed from `admin-list.ts`** (§2) — one removal beyond the written task, because the handler that was its only writer went with the invite flow.
5. **No `stage:` preset filter** was built. The New/Approved tab overlap is real and accepted, mitigated by the always-visible stage chip, and remains a recorded follow-up.
6. **Not committed.** Working tree carries 8 modified, 3 deleted and 4 new files; the team-leader owns the commit.

---

## Team-Leader Verification

**Verdict: APPROVED — committed as `ede6bb2ac`**
`feat(admin): batch 6 - approve replaces invite in the admin UI` · 16 files, +1215 / −702.

### Independently re-run, not accepted from this report

- **R9.1 gate re-grepped myself.** `70%|\$87|\$8\.70|off the first year` over `libs/web/admin` →
  **no matches**, in code and in prose. The report's note that its own docblocks initially carried
  the retired figures, and were reworded because a source-text gate reads comments too, is correct
  and the fix holds.
- **Both `WaitlistInviteModal` consumers are handled in this one commit** — the build never sees a
  dangling import. Consumer 1 (`waitlist-pipeline`) gained `ApproveWaitlistModal`; consumer 2
  (`admin-list`, gated on `supportsWaitlistInvite`) got no replacement, deliberately, and
  `[selectable]` narrowed to `!!s.supportsBulkEmail`. `admin-models.config.ts` then deleted the flag
  itself, so the dead gate cannot be re-lit by config.
- **Deletion sweeps clean across `libs/web`**: `WaitlistInviteModal`, `supportsWaitlistInvite`,
  `supportsEarlyAdopterApprove`, `inviteWaitlist`, `AdminInviteWaitlist`, `onInviteOldest`,
  `onSendFoundingInvites`, `onInviteClose`, `onInviteSent`, `onWaitlistInvite*`, `quickInviteBatch`,
  `inviteRecipients`, `waitlistInviteOpen`, `inviteToast`, `Invite oldest`, `Founding Invites`,
  `onEarlyAdopterApproved`, `earlyAdopterApprovedAt`, `\[email\]=` → **all no matches**.

### The approve flow

- **R6.4 closed.** The per-row Approve button carries **both** `@case ('new')` and `@case ('invited')`,
  and `approvableTab()` is `new || invited`, driving the checkbox and the toolbar alike. A New row is
  approvable directly — no paid invite first.
- Bulk approve goes through the existing `<ptah-selection-toolbar>`; per-row and bulk open the **same**
  modal, so there is exactly one confirmation path.
- Confirmation states the count, "free Builders access for 1 year", **Founding Members**, and "one
  email each", plus the two skip caveats.
- **All five outcomes render unconditionally** from a fixed `outcomeLines` array over a *required*
  (non-optional) tally schema — `already_paid` cannot vanish on a zero. Verified in both the modal
  template and the e2e assertion loop.
- **Failure leaves the selection intact**: the error arm sets `errorMessage`, does not emit
  `submitted` and does not close; `clearSelection()` lives only in `onApproveDone`, which only a
  returned response reaches.

### Approved stage, retained modal, e2e swap

- `WaitlistTab` += `approved` → `'approved:true'`; `WaitlistRow` += `approvedAt`;
  `stageLabel`/`stageVariant` rank Converted → Approved → Invited → New; header shows
  `summaryApproved`; `adminStatsWaitlistSchema` carries `approved` as `.optional()` per the
  `attention` precedent. `?tab=approved` deep-links through `normalizeTab`, covered by a real
  `RouterTestingHarness` test.
- `IssueCompLicenseModalComponent` **keeps** the Users-detail (`userId`) and Licenses-list
  (`mode: 'search'`) paths — confirmed live at `admin-detail.html:22-52` and `user-profile.ts:228` —
  while the `email` input, `isWaitlistMode`, the waitlist `open()` defaults and the bound-email arm
  of `confirm()` are gone. No second way to half-approve a waitlist row survives.
- **The e2e swap landed as both halves in one commit**, as the ruling required:
  `admin-founding-invites.spec.ts` deleted, `admin-waitlist-approve.spec.ts` added — `@p0` retained,
  posts `{ ids }`, asserts the per-outcome tally, `page.route`-intercepts
  `**/api/v1/admin/waitlist/approve` so no real grant or email occurs, and is typed against
  `WaitlistApprovalResponse` from `@ptah-api/admin`.

### Ruling on the flagged `eslint-disable` (§5, open item 2)

**ACCEPTED as written.** The ruling required asserting against `@ptah-api/admin`'s own response type;
the import is `import type`, fully erased, so nothing crosses the boundary at runtime and no NestJS
module is bundled. The repo already carries the identical pattern — including the same
`-- see the docblock above.` suffix — at `apps/ptah-license-server/prisma/seed/prisma-client.ts:35`
and `apps/ptah-electron/src/shims/vscode-shim.integration.spec.ts:30`. The offered fallback (a
locally-declared structural mirror) is **declined**: it would reintroduce exactly the drift-blindness
that made the deleted spec hollow, which is the reason the ruling exists. Do not swap it.

### Gate on the committed tree

| Command | Result |
| --- | --- |
| `npx nx run-many -t test -p web-admin,ptah-license-server` | ✅ web-admin 11 suites / **169 tests**; ptah-license-server 5 suites / **163 tests** — server side undisturbed |
| `npx nx run-many -t typecheck -p web-admin,ptah-landing-page,ptah-landing-page-e2e` | ✅ 3/3 |
| `npx nx run-many -t eslint:lint -p web-admin,ptah-landing-page-e2e` | ✅ **0 errors**, 8 warnings — all pre-existing on untouched files |
| `npx nx build ptah-landing-page` | ✅ `waitlist-pipeline` lazy chunk 19.66 kB; the 2 budget warnings are pre-existing |

Project name confirmed as `web-admin`. All runs used `--skip-nx-cache`. Staged 16 files by name;
both untracked `.ptah/specs/` folders deliberately left out. No hooks bypassed.

### Carried to Batch 7 — accepted, not blockers

1. **Playwright never executed.** The new spec is verified by collection and `tsc` only; it
   self-skips without `E2E_ADMIN_EMAIL`. Its selectors and copy assertions are unverified against a
   live DOM — the standing gate for every spec in that `describe`.
2. **Invited badge moved `info` → `neutral`**, fitting four stages into the closed six-name
   `BadgeVariant` vocabulary rather than widening a contract the member panel also consumes. The
   right call; purely visual, and recorded here so it is not read later as a regression.
3. **`refreshTick` removed from `admin-list.ts`** — one removal beyond the written task, correct:
   `onWaitlistInviteSent` was its only writer, so it became a signal with no writer. Bulk email never
   used it; list behaviour unchanged.
4. **No `stage:` preset filter.** The New/Approved tab overlap is real and accepted, mitigated by the
   always-rendered stage chip. Remains a recorded follow-up, not Batch 7 work.
