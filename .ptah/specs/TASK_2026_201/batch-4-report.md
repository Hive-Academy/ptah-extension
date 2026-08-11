# Batch 4 — The email: delete the paid invite, add the free welcome

**Task**: TASK_2026_201 · **Branch**: `ak/founding-cohort-free-access` ·
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Satisfies**: R3.1–R3.6 · C3 · **Status**: complete, uncommitted (team-leader owns the commit)

---

## 1. File-by-file changes

### `libs/api/email/src/lib/services/email.service.ts` — modified (+98 / −89)

**Deleted, totally — not retargeted:**

| Symbol | Was at | What it carried |
| --- | --- | --- |
| `sendFoundingInvite` + its docblock | `:131-166` | subject `You're invited — founding member pricing`; the docblock itself named the 70 percent discounts, `promo=founding`, the `d=` param and `WaitlistService.inviteBatch` |
| `buildFoundingCheckoutUrl` | `:681-698` | `${frontendUrl}/pricing?promo=founding&cycle=<cycle>[&d=<id>]` |
| `getFoundingInviteTemplate` | `:700-798` | both prices, both struck-through list prices, the `70% off` lines, the two `Claim …` CTAs, the 30-day money-back block, the renewal-pricing paragraph |
| `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` reads | `:709-714` | the only code readers of those two vars |

Nothing was rewritten in place. The two contradictory senders never coexist in the tree at any
commit: this batch removes the paid one and adds the free one in the same edit, in the same slots,
so the file's senders-above-templates ordering is unchanged.

**Added, in the vacated slots:**

- `sendFoundingCohortWelcome({ email, licenseKey, expiresAt })` at `:155` (where `sendFoundingInvite`
  was) — mechanics copied verbatim from the siblings: `FROM_EMAIL` / `FROM_NAME` through
  `ConfigService` with the `|| 'help@ptah.live'` / `|| 'Ptah Team'` fallbacks, one
  `await this.sendWithRetry(msg, 3)`, the same two log lines.
- `private getFoundingCohortWelcomeTemplate({ licenseKey, expiresAt })` at `:714` (where
  `getFoundingInviteTemplate` was) — `FRONTEND_URL` through
  `this.config.get<string>('FRONTEND_URL') || 'https://ptah.live'`, the `:319-323`
  `toLocaleDateString('en-US', { year, month, day })` expiry rendering, the
  `.container/.header/.content/.badge/.cta/.footer` block from `getWaitlistConfirmationTemplate`
  and the `.license-key` rule from `getLicenseKeyTemplate:341`.

**Env vars themselves left alone.** `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` still exist in
`.env.example`, `docs/deploy/e2e-test-handoff.md` and `docs/deploy/founder-setup-checklist.md`,
untouched, for the eventual checkout launch. Only the code references went.

**One deliberate deviation from the sibling CSS**, documented in the template's docblock: the header
gradient is `linear-gradient(135deg, #d4af37, #8a6d10)` with **no** `0%` / `100%` colour stops.
Those positions are the CSS defaults, so the render is byte-identical to the siblings, but the R3
guard forbids a `%` anywhere in the body and "a percentage, unless it is a CSS length" is not a rule
a regex can hold. A blanket ban is enforceable; a conditional one is not. Restoring `0%`/`100%`
fails the spec, and the docblock says so at the point where a future editor would "fix" it.

### `libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts` — new (23 tests)

The R3.6 control. Section 4 below maps every prohibition to its assertion.

---

## 2. The welcome email, in full

**Subject:** `You're in — Ptah Builders, free for the founding cohort`
**From:** `Ptah Team <help@ptah.live>` · **To:** the approved waitlist address

Read as prose (dark/gold house style: gold gradient header, `#0f172a` page, `#1e293b` content card,
gold `Founding Member` pill, gold CTA button, monospace gold-bordered key box):

> ### You're in
> PTAH BUILDERS — FOUNDING COHORT
>
> **[ FOUNDING MEMBER ]**
>
> Your place in the founding cohort of **Ptah Builders** is confirmed, and it is **free**. We have
> not asked you for a card, and we will not ask you for one when the cohort finishes.
>
> > Founding members keep the course, the recordings and the community for a full year — the
> > two-week cohort is the live part, not the whole of it.
>
> **What is waiting for you**
>
> - **The SaaS-building course** — the full curriculum, yours to work through at your own pace.
> - **The live sessions** — builds, walkthroughs and open questions, recorded so a missed hour is
>   never a missed session.
> - **The members' community** — the forum where the cohort thinks out loud, and its whole archive.
> - **The packs** — the agent packs and templates the course builds on.
>
> Everything lives behind one door:
>
> **[ Open the members' area ]** → `${frontendUrl}/members`
>
> Sign in with **this email address** — the one this message arrived at. Your membership is already
> attached to it, so there is nothing to set up first.
>
> ---
>
> #### Your licence
>
> Paste this key into Ptah in VS Code or the desktop app to unlock the Builders features there.
>
> ```
> PTAH-XXXX-XXXX-XXXX-XXXX
> ```
>
> **Access runs through:** August 11, 2027
>
> ---
>
> Questions? Just reply to this email.
> — The Ptah Team · [ptah.live](https://ptah.live)

When `expiresAt` is `null` the last line reads **Access runs through:** No end date. Nothing else
changes, and the spec asserts the prohibitions hold on that variant too.

### How this satisfies C3

The mail's second sentence is the keeps-framing, verbatim in substance, inside a gold-ruled callout —
the most visually weighted line in the body. No countdown appears anywhere above the fold: the
phrases are "for a full year", "the live part, not the whole of it", "at your own pace", "recorded so
a missed hour is never a missed session". The literal expiry date is real and not hidden, but it sits
in the licence block at the bottom, next to the key, where somebody checking specifics looks.
The spec asserts the ORDER (`indexOf` of the keeps-framing < `indexOf` of the date), so a later
copy-tidying pass cannot quietly promote the deadline to the top.

### What the body states, per R3

| R3 requirement | Where it is stated |
| --- | --- |
| They are in | Header `You're in`; "Your place … is confirmed" |
| Access is free | "and it is **free**" |
| No card now, none when the cohort ends | "We have not asked you for a card, and we will not ask you for one when the cohort finishes." |
| What they get | The four-item list: course, live sessions, community, packs |
| The access window | Keeps-framing ("a full year") at the top; literal date at the bottom |
| How to get in | "Sign in with **this email address** — the one this message arrived at." |
| One primary CTA to `${FRONTEND_URL}/members` | `<a class="cta" href="…/members">Open the members' area</a>` — exactly one `class="cta"` in the document |

---

## 3. One mail per approval — structural, not conditional

The licence key is a parameter of `sendFoundingCohortWelcome` and travels in this message.
`sendLicenseKey` is not also sent on the approval path, and **no flag was introduced to control
that**: Batch 2 already made it structural by removing every mail side effect from
`issueComplimentaryLicenseTx`, so each caller owns its own outbound message and this one owns the
approval's. The method's docblock records the reasoning and names the anti-pattern explicitly — a
`sendEmail: false` flag would be a second, silently flippable way to send an approved member two
contradictory messages, which is the exact failure this task removes.

---

## 4. Every R3 prohibition is enforced by the spec, not by inspection

`libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts` — 23 tests, all passing.

### 4a. Rendered HTML (R3.2)

The spec sends through the mocked `ResendMailService` and asserts on
`mockResend.emails.send.mock.calls[0][0].html` — the exact bytes a member would receive, not an
internal string.

| Prohibition | Pattern asserted absent | Test |
| --- | --- | --- |
| pricing-page link | `/\/pricing/` | `contains no a pricing-page link` |
| promo parameter | `/promo=/` | `contains no a founding promo parameter` |
| Paddle discount parameter | `/&d=/` | `contains no a Paddle discount parameter` |
| percentage | `/%/` | `contains no a percentage` |
| monetary amount | `/\$/` | `contains no a currency amount` |
| "discount" | `/discount/i` | `contains no the word "discount"` |
| money-back guarantee | `/money-?back/i` | `contains no a money-back promise` |
| renewal pricing | `/renew/i` | `contains no renewal language` |

Stricter than the letter of R3.2 in one place, deliberately: R3.2 says "`%` adjacent to 'off'", the
spec bans `%` outright. The narrower rule is not mechanically checkable without judgement, and the
wider one costs only two CSS default values. `tasks.md` Task 4.2 already specified `/%/`, so both
readings are satisfied.

Required-presence assertions on the same HTML: `/members`, the licence key, the formatted expiry
date, the free/no-card sentences, all four benefit nouns, `this email address`, and exactly one
`class="cta"` (a second button is how a billing-cycle fork grows back).

**Anti-vacuity for the prohibition list.** A neutered regex would let every assertion above pass on
a body full of prices. The test `the prohibition patterns do catch the mail they replaced` runs all
eight patterns against a reconstruction of the deleted invite copy and asserts each one **matches**.
The patterns are therefore proven to bite before they are trusted to acquit.

The whole prohibition list is re-run against the `expiresAt: null` variant, so the branch that a
reviewer would not think to open is covered too.

### 4b. Source text (R3.1, R3.6) — the `membership.service.spec.ts:120-126` pattern

```ts
const source = readFileSync(join(__dirname, 'email.service.ts'), 'utf8');
for (const needle of ['buildFoundingCheckoutUrl', 'getFoundingInviteTemplate',
                      'sendFoundingInvite', 'promo=founding',
                      'PADDLE_DISCOUNT_ID_BUILDERS_']) {
  expect(source).not.toContain(needle);
}
```

A separate test asserts `process.env` does not appear in `email.service.ts` at all (R3.5).

### 4c. Directory sweep (R3.1, second half)

Walks `libs/api/email/src` recursively, filters out `*.spec.ts` / `*.test.ts` (this spec file itself
carries the needle — that exclusion is the point), and asserts no remaining file contains
`promo=founding`.

**Anti-vacuity, in the `controller-validation.spec.ts:524-547` style**: before asserting the needle
is absent, the test asserts the walk found `> 0` files **and** that the collected set includes
`email.service.ts`. A sweep pointed at the wrong directory would otherwise find nothing and pass
forever. Offenders are reported as a path array (`expect(offenders).toEqual([])`) so a failure names
the file rather than just saying `false`.

### 4d. `FRONTEND_URL` unset (R3.4)

The harness makes `FRONTEND_URL` an argument. With it mocked to `undefined` the spec asserts the HTML
contains `https://ptah.live/members` and the literal `<a class="cta" href="https://ptah.live/members">`,
and asserts it does **not** contain `href="/members"` (relative) or `undefined/members` (malformed).

---

## 5. Standards

- No `catch` blocks added; the one in `sendWithRetry` is untouched and already narrows with
  `instanceof Error`. No raw `error.message` reaches a client from anything added here.
- Every configuration read goes through `ConfigService`; `process.env` appears nowhere in the file,
  asserted by test.
- No `@ts-ignore` / `@ts-expect-error`. No `any` in the new spec — the mocks use
  `as unknown as jest.Mocked<…>`, which is why the new file contributes zero lint warnings while the
  sibling `email.service.spec.ts` still has three pre-existing `no-explicit-any` warnings.

---

## 6. Verification

| Command | Result |
| --- | --- |
| `npx nx test api-email --skip-nx-cache` | **PASS** — 2 suites, 23 tests |
| `npx nx test ptah-license-server` | **PASS** — 5 suites, 162 tests |
| `npx nx test api-admin` | **PASS** — 1 suite, 32 tests |
| `npx nx run ptah-license-server:typecheck` | **PASS** |
| `npx nx run api-email:typecheck` | **PASS** |
| `npx nx run api-admin:typecheck` | **PASS** (the Batch 3 transient is already closed on this branch) |
| `npx nx run ptah-license-server:"eslint:lint"` | **PASS** — 0 errors, 2 pre-existing warnings (`jest.config.ts`, `instrument.ts` unused eslint-disable) |
| `npx nx run-many -t eslint:lint -p api-email` | **PASS** — 0 errors, 3 pre-existing warnings in `email.service.spec.ts` |
| `npx prettier --check` on both changed files | **PASS** |

Repository sweeps:

- `sendFoundingInvite|getFoundingInviteTemplate|buildFoundingCheckoutUrl` across `libs` + `apps` →
  three hits, all inside `founding-cohort-welcome.spec.ts`, all as string needles in the guard list.
  No definition, no call site.
- `promo=founding` in `libs/api/email/src` → **no matches** outside the guard spec.
- `PADDLE_DISCOUNT_ID_BUILDERS` outside spec docs → `.env.example` and the two deploy docs only, as
  intended.

Remaining `promo=founding` occurrences elsewhere in the tree are out of this batch's scope and
untouched: `libs/web/pricing/**` (the landing checkout that will consume the promo when checkout
launches), `apps/ptah-landing-page-e2e/src/specs-checkout/checkout-founding-promo.spec.ts`, and the
Batch 1 migration `20260911090100_remove_founding_waitlist_invite_template/migration.sql`, which
contains the string only inside its own explanatory header.

---

## 7. Blocked / needs a ruling

### `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` — assigned to no batch

**Not touched, not weakened, not deleted.** Reporting precisely, as instructed:

- It is a Playwright test that drives the **admin UI** (`/admin/waitlist` → invite modal) and
  intercepts `POST /api/v1/admin/waitlist/invite` with `page.route`, asserting the request SHAPE
  (`ids` vs `batchSize`) against a stubbed `{ invited, skipped }` response.
- **Batch 4 does not affect it.** It has no reference to `EmailService` or to any symbol deleted
  here.
- It is, however, **already hollow as of Batch 3**: the server endpoint is gone
  (`grep inviteWaitlist|waitlist/invite libs/api/admin/src` → no matches), and because the spec stubs
  the route it will keep passing while guarding a route that no longer exists. It is currently a
  green test asserting the wire shape of a deleted endpoint.
- It **will fail at Batch 6**, which removes the admin invite controls. The UI it drives —
  `libs/web/admin/src/lib/components/waitlist-invite-modal/waitlist-invite-modal.ts` and the
  `waitlist/invite` call in `libs/web/admin/src/lib/services/admin-api.service.ts` — is still
  present today and is Batch 6's scope.

**Ruling needed** (my recommendation, not applied): delete the spec as part of Batch 6, in the same
change that deletes the modal it exercises. It cannot be repointed at the approve flow — that flow
has different request and response shapes and its own coverage in Batch 5 — and it should not outlive
the UI it drives. It must not be deleted in Batch 4, where it is unrelated to the change.

### Nothing else is incomplete

Both Batch 4 tasks (4.1 and 4.2) are done. No stubs, no TODOs, no placeholder copy.
No commit made — the team-leader owns commits.

---

## Team-Leader Verification

**Verdict: APPROVED — committed `8136e292d`**
`feat(license-server): replace the paid founding invite with the free cohort welcome`
Staged by name: `libs/api/email/src/lib/services/email.service.ts` and
`libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts`. The two untracked `.ptah/specs/`
folders were deliberately kept out. No hooks bypassed.

### Deletion is total (R3.1) — verified by grep, not by report

- `sendFoundingInvite` / `getFoundingInviteTemplate` / `buildFoundingCheckoutUrl` across the whole
  worktree: **no definition and no call site anywhere**. The only surviving code occurrences are the
  three string needles in `founding-cohort-welcome.spec.ts:247-249` — the guard list itself. Every
  other hit is task-spec prose.
- `promo=founding` under `libs/api`: **only** `founding-cohort-welcome.spec.ts` — the guard needle at
  `:250`, the sweep predicate at `:271`, and the anti-vacuity reconstruction of the deleted copy at
  `:213`. No template carries it.
- **The env variables correctly survive.** `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` are
  present and untouched in `.env.example:191-192`, `docs/deploy/founder-setup-checklist.md:53,120`
  and `docs/deploy/e2e-test-handoff.md:154`. `git status` confirms none of those three files is
  modified by this batch. Only the two `ConfigService` reads went — exactly the scope line in
  `task-description.md` "Out of Scope / Extended". Removing them would have been a rejection.

### The replacement copy — read as prose, not as a diff

The rendered body states, in order: they are in (`You're in` header + "Your place in the founding
cohort … is confirmed"); it is free ("and it is **free**"); no card now **or** at cohort end ("We have
not asked you for a card, and we will not ask you for one when the cohort finishes"); what they get
(course, live sessions with recordings, community + archive, packs); the access window; and how to get
in ("Sign in with **this email address** — the one this message arrived at").

**C3 framing is correct, and this is the item that could most easily have failed.** The keeps-framing
is the *second* sentence, in the gold-ruled `.keeps` callout, verbatim in substance. The literal
`Access runs through: August 11, 2027` sits in the `.details` licence block at the bottom next to the
key. This is **not** R3 Option A — no bare "your access runs through <date>" functions as the primary
duration statement. The spec pins the ordering (`indexOf` keeps-framing < `indexOf` date,
`:135-137`), so a later copy-tidying pass cannot promote the deadline.

### Prohibitions and CTA

No `$`, no `%`, no `/pricing`, no `promo=`, no `&d=`, no `discount` / `money-back` / `renew` — all
eight asserted absent on the rendered HTML and on the `expiresAt: null` branch. The gradient's
`0%`/`100%` stops were dropped to hold the blanket `%` ban; the render is identical (those are the CSS
defaults) and the docblock explains it at the point a future editor would "fix" it. Accepted.

Exactly one `class="cta"`, pointing at `${frontendUrl}/members`, with
`this.config.get<string>('FRONTEND_URL') || 'https://ptah.live'`. With the var unset the spec proves
the CTA renders `<a class="cta" href="https://ptah.live/members">` — and explicitly not `href="/members"`
(relative) or `undefined/members` (malformed). The footer `ptah.live` link is the house-style sibling
footer, not a second CTA.

### One mail per approval is structural, not conditional

Re-confirmed at source, not from the report. `issueComplimentaryLicenseTx`
(`license.service.ts:582-653`) does four things and has **no mail side effect**, so there is nothing to
suppress on the approval path. **No flag was added.** The `dto.sendEmail !== false` at
`license.service.ts:752` is the pre-existing DTO field of the separate
`POST /v1/admin/licenses/complimentary` endpoint, untouched by this batch. The licence key travels in
`sendFoundingCohortWelcome` as a parameter.

### R3.6 — the control was proven load-bearing, not taken on trust

The spec asserts on both the rendered HTML **and** the source text of `email.service.ts`
(`:236-255`, the `membership.service.spec.ts:120-126` pattern), plus a directory sweep with the
`controller-validation.spec.ts:524-547` anti-vacuity guard (`files.length > 0` **and** the set
contains `email.service.ts`).

**Mutation test run by the team-leader.** A `$87` amount and a `${frontendUrl}/pricing` link were
temporarily injected into the template body. The suite went **red — 3 failed / 20 passed**: the `$`
pattern, the `/pricing` pattern, and the no-expiry variant that re-runs the whole list. The injection
was then reverted; `git diff --stat` returned to the exact `98 insertions / 89 deletions` and the
suite went green at 23/23. The control bites.

### Whole-tree gate — all green, run with `--skip-nx-cache`

| Command | Result |
| --- | --- |
| `npx nx test api-email` | PASS — 2 suites, 23 tests |
| `npx nx test ptah-license-server` | PASS — 5 suites, 162 tests |
| `npx nx test api-admin` | PASS — 1 suite, 32 tests |
| `npx nx run ptah-license-server:typecheck` | PASS |
| `npx nx run api-email:typecheck` | PASS |
| `npx nx run ptah-license-server:"eslint:lint"` | PASS — 0 errors, 2 pre-existing warnings |
| `npx nx run-many -t eslint:lint -p api-email` | PASS — 0 errors, 3 warnings |

The 3 `api-email` warnings were confirmed pre-existing rather than assumed: with `email.service.ts`
stashed the count is still exactly 3 (`no-explicit-any` in the sibling `email.service.spec.ts`). The
new spec contributes zero.

### Open item recorded, not fixed

`apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` — the developer correctly left it
untouched and reported it precisely. It is recorded in `tasks.md` under Batch 4 as **needing an
explicit ruling before or during Batch 6**. Not deleted, not weakened, not repointed here.
