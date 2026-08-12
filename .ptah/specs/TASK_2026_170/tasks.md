# TASK_2026_170 — Implementation Batches

Plan: `implementation-plan.md` (**APPROVED — source of truth**). Context: `context.md`.
Background: `docs/handoff-license-server-validation-pipe.md` — **the plan corrects it in 7 places
(§2.3); where they disagree, the plan wins.**

Type: BUGFIX (security-adjacent) · Strategy: Hybrid (Option A now, Option B deferred)
Branch: `ak/license-server-validation-pipe` (already created and checked out)
Stack: NestJS 11, `class-validator` 0.15.1, Prisma 7 + PostgreSQL, esbuild bundling.

---

## ⚠️ READ THIS FIRST — the three findings that dominate this task (plan §0)

**If you are picking up a single batch, you still read this section.** These three are the whole
reason this task is not a find-and-replace.

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                       | Where it bites                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **F1** | `dtoPipe(UpdateRecordDto)` on `AdminController.update` would **400 every admin record edit**. `UpdateRecordDto` is `{ [key: string]: unknown }` — zero `class-validator` metadata — and `whitelist + forbidNonWhitelisted` rejects **every** property of a zero-metadata class (`ValidationExecutor.whitelist()`). The DTO's own docblock claims the opposite; that comment describes intent under a pipe that has never run. | **B7** — must use `passthroughDtoPipe`, created in **B0** |
| **F2** | `VerifyLicenseDto` enforces `^ptah_lic_[a-f0-9]{64}$` on a **public, unauthenticated** endpoint that every installed extension calls. `license.service.ts:216` documents a **second, legacy** key format (`PTAH-XXXX-XXXX-XXXX`). If one such row exists, those users get a 400 instead of a licence verdict, in production.                                                                                                  | **B2** — hard-gated on data check **D1**                  |
| **F3** | The structural test that keeps this fixed lives in `src/admin/admin-guards.spec.ts` (an **admin-named** spec) and its param enumerator cannot distinguish `@Query()` (whole object) from `@Query('code')` (named primitive). Bolting the public controllers onto it misfiles them **and** produces false failures.                                                                                                            | **B0** — restructure before any rollout                   |

**The mechanism, in one line:** esbuild does not implement `emitDecoratorMetadata`, so
`metadata.metatype` is `undefined`, so `ValidationPipe.transform()` short-circuits and **every**
`class-validator` decorator in this server is inert. `dtoPipe(X)` fixes it per-param by setting
`expectedType`, which is applied _before_ the short-circuit.

---

## Progress

| Batch  | Title                                                                                                                                 | Tier | Status                                                                     | Commit SHA       | Executor            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------- | ---------------- | ------------------- |
| **B0** | Structural spec restructure + `passthroughDtoPipe` + docs                                                                             | —    | ✅ COMPLETE                                                                | `25950bb90`      | `backend-developer` |
| **DC** | Data checks D1–D7                                                                                                                     | —    | ✅ COMPLETE (2026-08-02: D1=0, D2=0, D3=0, D4=1258, D5=13, D6=0, D7=empty) | _(no commit)_    | orchestrator        |
| **B1** | `waitlist.controller.ts`                                                                                                              | 1    | ✅ COMPLETE                                                                | `59eef2fcc`      | `backend-developer` |
| **B2** | `license/controllers/license.controller.ts`                                                                                           | 1    | ✅ COMPLETE                                                                | `03cdc37b3`      | `backend-developer` |
| **B3** | auth controller (5 DTOs) + `jwt-auth.guard.ts`                                                                                        | 1    | ✅ COMPLETE                                                                | `7aa728847`      | `backend-developer` |
| **B4** | `contact/contact.controller.ts`                                                                                                       | 2    | ✅ COMPLETE                                                                | `6ceceecbe`      | `backend-developer` |
| **B5** | `session/session.controller.ts`                                                                                                       | 2    | ✅ COMPLETE                                                                | `1e6fa07e3`      | `backend-developer` |
| **B6** | `subscription/subscription.controller.ts`                                                                                             | 2    | ✅ COMPLETE                                                                | `193a1c46a`      | `backend-developer` |
| **B7** | admin controllers (post-R2 split: B7a records `a74e923d1`, B7b users `fb7dd98b1`, B7c licenses `8abef76fd`, B7d waitlist `1ddf1337c`) | 3    | ✅ COMPLETE                                                                | _(four commits)_ | `backend-developer` |
| **B8** | `admin-marketing.controller.ts` + compose caller cap + `{userId:''}` modal fix                                                        | 3    | ✅ COMPLETE                                                                | `8f25aa3d1`      | `backend-developer` |
| **B9** | `integration-licenses.controller.ts` (post-R3 name)                                                                                   | 3    | ✅ COMPLETE                                                                | `70315d65f`      | `backend-developer` |

> **2026-08-02 — task complete.** Executed post-slicing (`libs/api/*`), so all `src/<feature>/` paths
> above are historical; `dtoPipe`/`passthroughDtoPipe` live in `@ptah-api/core`. Restructure steps:
> R3 `3d063b403`, R4 `144a418ad` (R5 obsolete — the lib slicing deleted `src/app/auth/` entirely).
> `UNVALIDATED_DEBT` is `[]`; `KNOWN_PREFIX_DEBT` is `[]`. Deviation from B0's design: the ledger
> staleness check is now one aggregate looping test — `it.each([])` throws on an empty table, which
> B9 necessarily produces. Follow-ups recorded in the Tier 2/3 reports: session-notes textarea lacks
> a client-side 2000-char cap; `canSubmit` in the comp-license modal deliberately left loose.

Status legend: ⏸️ PENDING · 🔄 IN PROGRESS · 🔄 IMPLEMENTED (awaiting review/commit) · ✅ COMPLETE · ❌ BLOCKED

### Suggested wall-clock shape (plan §8)

```
B0 (alone)  +  DC (concurrent)
        ↓  B0 green + D1 = 0
  { B1 , B2 , B3 }          ← Tier 1 (public exposure — this is why the task exists)
        ↓  HARD GATE: all three committed, curl matrices green
  { B4 , B5 , B6 }          ← Tier 2 (authenticated)
        ↓  HARD GATE: all three committed, curl matrices green
  { B7 , B8 , B9 }          ← Tier 3 (admin)
```

**Tier boundaries are hard gates.** Tier 2 does not start until Tier 1 is committed and its curl
matrix is green. Same for Tier 3.

---

## Non-negotiables — every batch, every executor

1. **B0 lands first and alone.** Nothing else starts until B0 is green, including a
   **falsification proof** (see B0.9). A structural test that has not been seen to fail is not
   evidence.
2. **D1 blocks B2.** If D1 returns `> 0`, **STOP and escalate to the orchestrator.** Do **not**
   weaken the regex to `@IsString()`.
3. **One commit per controller.** Each must be independently `git revert`-able (plan §10).
4. **Never weaken a DTO to make a caller pass** (plan §6.4). Two **caller** fixes are in scope
   instead: cap `name` at 93 chars in `marketing-compose.ts` (B8), and the `{ userId: '' }`
   submit-guard edge in `issue-comp-license-modal.ts` (B7 verifies, B8 fixes if needed).
   The only place a constraint may move is B2, and only if D1 proves the DTO contradicts documented
   reality — and only after escalation.
5. **Staging discipline — never `git add -A` / `git add .` / `git add -u`.** The working tree carries
   unrelated pre-existing modifications: `libs/backend/agent-sdk/*`, `libs/backend/auth-providers/*`,
   `libs/backend/rpc-handlers/*`, `libs/shared/*`, `libs/frontend/tribunal-panel/*`, and six
   untracked landing-page spec files. **Every commit stages specific named paths only** — the exact
   list is written into each batch below. Run `git status --short` before and after each commit and
   confirm the unrelated entries are still unstaged.
6. **CLI agents must not commit** and **must not touch any DTO file**. A sub-agent (or the
   orchestrator) reviews the diff against the source and commits. **Max 3 CLI agents concurrent.**
7. **Do not touch** (TASK_2026_169 security invariant): `discourse/builders-membership.service.ts`,
   `discourse/community.controller.ts`, `google-sessions/members.controller.ts`.
8. **Do not fix the seven pre-existing lint errors** documented in TASK_2026_169's report §4.1 —
   none are in files this task touches.
9. **Never log a webhook body.** Webhooks are out of scope entirely (plan §6.2).
10. **No `catch (error: any)`** may remain in any file this task touches; no raw `error.message`
    reaches a client.

### Import depth per controller — ⚠️ verified, and it corrects the plan

`import { dtoPipe } from '<relative>/common/dto-validation.pipe';`

| Controller directory                                                               | Correct relative path              |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| `src/waitlist/`, `src/contact/`, `src/session/`, `src/subscription/`, `src/admin/` | `../common/dto-validation.pipe`    |
| `src/license/controllers/`, `src/marketing/controllers/`                           | `../../common/dto-validation.pipe` |
| `src/app/auth/`                                                                    | `../../common/dto-validation.pipe` |

> **Correction to plan §11.1.** The plan states `../../../common/…` for `app/auth/`. That is an
> off-by-one: `src/app/auth/` → `..` = `src/app/` → `../..` = `src/`. Verified against the file's own
> existing imports — `auth.controller.ts:26` is `import { PrismaService } from '../../prisma/prisma.service';`.
> Use `../../common/…`. (`../../../` would be correct from `src/app/auth/guards/`, which is probably
> where the plan's figure came from.) A wrong path fails typecheck immediately, so this is a
> time-saver, not a risk — but record it as a finding.

### Curl matrix — the four cases (plan §9.3)

Every payload param is verified in **both directions**. A batch is not done until all four are
demonstrated and the **actual status codes** are pasted into the report.

| Case                                                                                                  | Expect                                                                     | Proves                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| **A. Valid payload** — the exact literal the real caller sends (copy from plan §3, do not invent one) | unchanged status (200/201/…)                                               | nothing regressed                                     |
| **B. Constraint violation** — bad email / short code / oversize array / out-of-range number           | **400**, with the DTO's own message                                        | validation is live                                    |
| **C. Unknown field** — case A plus `"bogusField":"x"`                                                 | **400** `property bogusField should not exist`                             | `forbidNonWhitelisted` is live                        |
| **D. Transform** — only where `@Type(() => Number)` exists (`ListQueryDto`, `InviteWaitlistDto`)      | numeric string coerced; `pageSize=101` → **400**, `pageSize=100` → **200** | transform runs; the UI's cap is now actually enforced |

> **Deliberate exception — `AdminController.update` (B7) case C must still return 200.**
> That is `passthroughDtoPipe` working as designed, and **that assertion is what proves F1 was
> handled rather than missed.** A 400 there means someone used `dtoPipe` and broke every admin edit.

**Route traps:** auth endpoints are `/api/auth/...` — `auth.controller.ts:89` is `@Controller('auth')`
with **no `v1` segment** — and login is `POST /api/auth/login/email`, **not** `/api/v1/auth/login`.
Getting this wrong means testing a 404 and declaring victory. For every other controller, derive the
route from its `@Controller()` + `@Post/@Get/@Patch` decorators; do not assume.
For **B9** use the `x-api-key: $ADMIN_SECRET` header (`AdminApiKeyGuard`), **not** the `ptah_auth`
cookie. Cookie minting recipe: plan §9.2 (mirrors `scripts/community-gate-smoke.mjs:40-45`);
`JWT_SECRET` is read from `.env` — **never hard-code it in a committed file**.

**Clean up test rows** — delete probe waitlist rows, users and templates, and state the post-state in
the report (matches TASK_2026_169's precedent).

### Gates that must stay green — every batch (plan §9.4)

```bash
npx nx test ptah-license-server --skip-nx-cache        # 617 green at handoff; expect a delta from the new spec
npx eslint apps/ptah-license-server/src/<touched>      # target is ptah-license-server:eslint:lint, NOT `nx lint`
npx tsc -p apps/ptah-license-server/tsconfig.app.json  --noEmit
npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit
node scripts/community-gate-smoke.mjs                  # must exit 0
node scripts/discourse-e2e.mjs                         # must exit 0
```

Environment for the curl matrix:

```bash
npm run docker:up                      # postgres + license-server :3000 (+ Discourse :3001)
bash scripts/discourse-dev-up.sh       # only if :3001 refuses connections — Rails does not survive a restart
```

`scripts/google-calendar-write-smoke.mjs` is cheap extra insurance on any batch touching `src/common/`
(i.e. B0).

---

## B0 · Structural spec restructure + `passthroughDtoPipe` + docs — ⏸️ PENDING

**Tier**: — (foundation) · **Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: `sequential` — **must land first and alone. Nothing else may start until B0 is green.**
**Gate**: none inbound. **B0 gates every other batch.**
**Why not a CLI agent**: requires reading Nest's route-args metadata semantics correctly and _proving_
the test fails. Not delegable (plan §8).

### Subtasks

- [ ] **B0.1** — `apps/ptah-license-server/src/common/dto-validation.pipe.ts` (MODIFY): add
      `passthroughDtoPipe<T>(expectedType: Type<T>): ValidationPipe` returning
      `new ValidationPipe({ expectedType, whitelist: false, forbidNonWhitelisted: false, transform: true })`.
      Use the docblock from plan §3.11 verbatim — it must state the mechanism
      (`ValidationExecutor.whitelist()` rejects every property of a zero-metadata class when
      `forbidNonWhitelisted` is on), name **`AdminController.update` as the only legitimate consumer
      today**, and forbid its use as a 400-silencer.
- [ ] **B0.2** — same file (MODIFY): update **`dtoPipe`'s own docblock**. Its "SCOPE: this is applied
      to the endpoints added by TASK_2026_169 only…" paragraph (lines 37–47) and its closing "the
      app-wide defect is deliberately NOT fixed here" paragraph go stale the moment this task lands.
      Rewrite to: `dtoPipe` is the server-wide mechanism; TASK_2026_170 bound all remaining
      controllers; webhooks are the documented exception; Option B (esbuild plugin) is the deferred
      end state.
- [ ] **B0.3** — `apps/ptah-license-server/src/common/controller-validation.spec.ts` (**CREATE**).
      Move G7 here. `src/common/` is the right home — it is where `dto-validation.pipe.ts` lives, so
      the guard sits beside the mechanism it guards. Four parts, all four required (plan §7):
- [ ] **B0.4** — _(part 1)_ **Named-primitive carve-out.** Skip params where the route-args metadata
      `data !== undefined` (Nest stores `{ index, data, pipes }`; `data` holds the key name for
      `@Query('code')` and is `undefined` for a whole-object `@Query()` — verified at
      `node_modules/@nestjs/common/decorators/http/route-params.decorator.js:15-20`). Put the reason
      in a comment. Then **assert the carve-out's exact size** as a literal. Expected today: **8**
      (`auth.controller.ts:246,247,478,858,859` = 5, `discourse/discourse.controller.ts:48,49` = 2,
      `events/events.controller.ts:78` = 1) — **count it, do not trust this number**. A ninth must
      fail the test so a contributor has to consciously accept it. The carve-out cannot silently grow.
- [ ] **B0.5** — _(part 2)_ **Full-surface coverage with a shrinking debt ledger.** Enumerate **every**
      controller in the server via an explicit `ALL_CONTROLLERS` import list — deliberately **not**
      module-graph reflection, which would drag `AppModule` and its Prisma `onModuleInit` into a spec
      that must stay infra-free (same reasoning TASK_2026_169 used for G3, its report §6(d)). The 21
      controllers are discoverable with
      `grep -rn "^export class .*Controller" apps/ptah-license-server/src --include=*.controller.ts`.
      Assert every whole-object payload param binds a `ValidationPipe` carrying `expectedType`,
      **except** controllers named in `UNVALIDATED_DEBT`.
- [ ] **B0.6** — ⚠️ _(part 2, structural finding — resolve before writing the ledger)_ **There are two
      classes named `AdminController`**: `admin/admin.controller.ts:82` and
      `license/controllers/admin.controller.ts:29`. A `UNVALIDATED_DEBT: string[]` keyed on
      `controller.name` **cannot distinguish them** — B7 and B9 would share one ledger line, so
      neither could "delete exactly its own line", and whichever lands first would leave the other
      silently exempt. **Fix it in the design**: make `ALL_CONTROLLERS` an array of
      `{ label: string; controller: Type<unknown> }` with a unique path-derived label
      (e.g. `'admin/AdminController'`, `'license/AdminController'`) and key both `UNVALIDATED_DEBT`
      and `EXCLUDED` on `label`. Import the two classes under aliases. Record this as a finding.
- [ ] **B0.7** — _(part 2)_ Seed `UNVALIDATED_DEBT` with **all nine in-scope controllers**, so the
      suite is green from the outset and each subsequent batch's diff is exactly one line removed:
      `WaitlistController`, `LicenseController`, `AuthController`, `ContactController`,
      `SessionController`, `SubscriptionController`, `admin/AdminController`,
      `AdminMarketingController`, `license/AdminController`. Add the docblock from plan §7:
      _"Controllers whose payload params are not yet bound. This list only ever SHRINKS.
      TASK_2026_170 empties it, one controller per commit."_
      Add the **staleness assertion**: for every label in `UNVALIDATED_DEBT`, that controller must
      **still have at least one unbound param**. This makes the ledger un-rottable in both directions:
      remove a name without doing the work → main assertion fails; do the work without removing the
      name → staleness assertion fails; add a new controller with a bare `@Body()` → not in the ledger
      → main assertion fails.
      ⚠️ Controllers with **no** payload params (`HealthController`, `PublicMarketingController`,
      `PaddleController`, `CommunityController`, `MembersController`, `DiscourseController`,
      `EventsController` — the last two have named primitives only) must **not** be listed in the
      ledger; the staleness assertion would fail on them.
- [ ] **B0.8** — _(part 3)_ **Webhook exclusion, expressed as data**, not a comment:
      `const EXCLUDED: Array<{ controller: string; reason: string }>` with `ResendWebhookController`
      and the reason string from plan §7 (third-party payload shapes change without notice;
      `forbidNonWhitelisted` would 400 valid webhooks the first time Resend adds a field;
      `ResendWebhookPayload` is an **interface**, not a class, so it cannot be an `expectedType`).
      Assert: each excluded controller still **exists** and still has an unbound param (so the
      exclusion cannot outlive its subject), and `EXCLUDED` ∩ `UNVALIDATED_DEBT` = ∅ (so a controller
      cannot hide in both). **`PaddleController` is deliberately NOT listed** — it has no payload
      param at all (it reads `req.rawBody` via `@Req()`), so listing it would be a lie the staleness
      check would catch.
- [ ] **B0.9** — _(part 4)_ **Anti-vacuity guard, strengthened.** Replace today's hand-maintained
      per-controller minimum (`admin-guards.spec.ts:264-271`, which does not scale to 21 controllers)
      with a **server-wide floor**: the enumerator must discover at least N payload params in total.
      N = today's actual count, written as a literal with a comment saying it is a **floor, not a
      target**. If Nest's metadata key format changes underneath us, the count collapses to 0 and the
      floor fails loudly. One number, one place, meaningful at any list size.
- [ ] **B0.10** — 🔴 **FALSIFICATION PROOF — mandatory, this is the deliverable.** Temporarily revert
      one already-bound binding (e.g. a `dtoPipe(...)` in `member-groups.controller.ts` or
      `admin-packs.controller.ts` → bare `@Body()`), run the spec, **capture the failing output and
      confirm the offending handler is named in it**, then restore the binding and re-run green.
      **Paste both outputs (failing and restored) in the implementation report.** A structural test
      that has not been seen to fail is not evidence. Precedent: TASK_2026_169's report,
      "Proof it actually fails".
- [ ] **B0.11** — `apps/ptah-license-server/src/admin/admin-guards.spec.ts` (MODIFY): **remove G7**
      (the `describe('G7 — every @Body()/@Query() param binds dtoPipe …')` block at line ~222, its
      `CONTROLLERS` list at ~238, the `paramBindings()` helper at ~61 if now unused, and the G7 line
      from the file's top docblock at ~34). **Keep G1/G3/G4/G5/G6** — they are genuinely
      admin-specific. Confirm the remaining spec still passes and its own docblock no longer
      advertises G7.
- [ ] **B0.12** — `apps/ptah-license-server/src/main.ts` (MODIFY, **docblock only, zero behaviour
      change**): add a comment at the global `ValidationPipe` registration (lines ~41-47) explaining
      (a) it is **inert** under esbuild because `emitDecoratorMetadata` is not implemented, (b)
      `dtoPipe`/`passthroughDtoPipe` in `src/common/dto-validation.pipe.ts` are the live mechanism,
      and (c) the global pipe is **retained deliberately** as the safety net for the day Option B
      lands — removing it would be a real behavioural change disguised as cleanup.
      **This is the only edit to `main.ts` in this entire task.**
- [ ] **B0.13** — `apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts`
      (MODIFY, **comment only**): add a comment on the `@Body() payload: ResendWebhookPayload` param
      (line ~38) stating the TASK_2026_170 exclusion and its reason. This is exclusion-record (a) of
      three; (b) is the `EXCLUDED` list in B0.8, (c) is plan §6.2.
- [ ] **B0.14** — `.ptah/specs/TASK_2026_170/future-enhancements.md` (**CREATE**): record
      (i) **Option B** — the esbuild `emitDecoratorMetadata` plugin, with the plan §1 evidence
      (`validation.pipe.js` `transform()`, `ValidationExecutor.whitelist()`, installed versions
      `@nestjs/common` 11.1.23 / `class-validator` 0.15.1) and the note that Option A is its
      prerequisite; (ii) the **rejected** "per-model admin update DTOs" alternative from plan §3.11
      (9 classes mirroring `ADMIN_MODELS[key].editableFields` — correct in the abstract, but it
      duplicates a single source of truth into nine places); (iii) hardening **named-primitive query
      params** with `ParseUUIDPipe`/`@IsString` wrappers (plan §6.3).

### Acceptance criteria

- [ ] `npx nx test ptah-license-server --skip-nx-cache` green, with `controller-validation.spec.ts`
      passing and `admin-guards.spec.ts` passing without G7.
- [ ] Falsification output (failing + restored) captured, and the failing output **names the handler**.
- [ ] `UNVALIDATED_DEBT` contains exactly the nine in-scope controllers, uniquely labelled.
- [ ] Carve-out size literal and server-wide param floor both asserted with the **actual** counted
      numbers.
- [ ] No behaviour change anywhere — B0 binds **zero** new params. `main.ts` diff is comment-only;
      `resend-webhook.controller.ts` diff is comment-only.

### Gates

All of §"Gates that must stay green" above, **plus** `node scripts/google-calendar-write-smoke.mjs`
(B0 touches `src/common/`).

### Findings to record

F3 (G7 restructure + falsification proof + the `@Query('code')` metadata bug that forces it);
the **duplicate `AdminController` class-name collision** (B0.6) and how the ledger was keyed to
survive it; the counted carve-out size and param floor; the `dtoPipe` stale-scope-docblock correction.

### Commit

```bash
git add apps/ptah-license-server/src/common/dto-validation.pipe.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts \
        apps/ptah-license-server/src/admin/admin-guards.spec.ts \
        apps/ptah-license-server/src/main.ts \
        apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts \
        .ptah/specs/TASK_2026_170/future-enhancements.md
git status --short   # confirm agent-sdk / auth-providers / rpc-handlers / shared / tribunal-panel / landing-page specs are STILL UNSTAGED
```

Message: `fix(license-server): generalize the validation structural guard + add passthroughDtoPipe`

---

## DC · Data-reality checks D1–D7 — ⏸️ PENDING

**Tier**: — · **Recommended Executor**: `backend-developer` (sub-agent) or orchestrator
**Execution Mode**: `parallel-with: [B0]` — cheap; run them while B0 is in flight.
**Gate**: none inbound. **D1 blocks B2. D5 informs B1. D6 informs B5. D2/D3/D4/D7 inform B7 and B8.**

Run each via the mechanism `scripts/community-gate-smoke.mjs` uses:

```bash
docker exec -i ptah_postgres psql -U ptah -d ptah_db -tAc "<SQL>"
```

Column names are taken from `apps/ptah-license-server/prisma/schema.prisma` `@map` values, not guessed.

- [ ] **D1** 🔴 **BLOCKS B2** — `SELECT count(*) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$';`
      **Pass: `0`.** If `> 0`, also run
      `SELECT left(license_key, 20) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$' LIMIT 5;`
      and **STOP — escalate to the orchestrator.** Do not bind B2, do not weaken the regex.
- [ ] **D2** (B7 `BulkEmailDto`, B8 `SendCampaignDto`) —
      `SELECT count(*) FROM users WHERE substring(id::text,15,1) <> '4';` — Pass: `0`
      (all `@IsUUID('4')` targets are genuinely v4). TASK_2026_169 checked 3 rows; this counts all.
- [ ] **D3** (B8 `SendCampaignDto.templateId`) —
      `SELECT count(*) FROM marketing_campaign_templates WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';`
      — Pass: `0` (column is `@db.Uuid`, so structurally impossible — cheap confirmation).
- [ ] **D4** (B8 `SaveTemplateDto.htmlBody`) —
      `SELECT coalesce(max(length(html_body)),0) FROM marketing_campaign_templates;` — Pass: `≤ 50000`.
      If exceeded, the 50k cap is aspirational → **product decision, not a silent widening**; escalate.
- [ ] **D5** (B1 `JoinWaitlistDto.source`) — `SELECT coalesce(max(length(source)),0) FROM waitlist;`
      — Pass: `≤ 50`. Catches an out-of-repo caller tagging with a long `source`.
- [ ] **D6** (B5 `SessionRequestDto.additionalNotes`) —
      `SELECT coalesce(max(length(additional_notes)),0) FROM session_requests;` — Pass: `≤ 2000`.
- [ ] **D7** (B7 `IssueComplimentaryLicenseDto.email` `@Transform`, **informational**) —
      `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;` — Pass: empty.
      Non-empty means the un-normalized email path already created case-duplicate users — **a real
      finding to report, not a blocker**.

### Acceptance criteria

- [ ] **Every check's actual numeric output is pasted into the implementation report.**
      _"I ran it and it was fine" is not evidence — the number is._
- [ ] D1's result is stated explicitly and unambiguously before B2 is allowed to start.

### Commit

**None.** DC produces evidence, not code.

---

## Tier 1 — public exposure. This is why the task exists.

> Run **B1, B2, B3 in parallel** (each is file-disjoint except its one ledger line in
> `controller-validation.spec.ts`; a rebase conflict there is resolved by keeping **both** deletions).
> **Do not start Tier 2 until all three are committed and their curl matrices are green.**

## B1 · `waitlist/waitlist.controller.ts` — ⏸️ PENDING

**Tier**: 1 · **Recommended Executor**: **CLI agent** + `backend-developer` review & commit
**Execution Mode**: `parallel-with: [B2, B3]`
**Gate**: B0 green. (D5 informs, does not block.)
**Why CLI**: one param, one DTO, SAFE, caller verified. Textbook delegation (plan §8).

### Subtasks

- [ ] **B1.1** — `apps/ptah-license-server/src/waitlist/waitlist.controller.ts` handler `join` (line
      ~37): `@Body() dto: JoinWaitlistDto` → `@Body(dtoPipe(JoinWaitlistDto)) dto: JoinWaitlistDto`.
- [ ] **B1.2** — add `import { dtoPipe } from '../common/dto-validation.pipe';`
- [ ] **B1.3** — add the class docblock warning, modelled on `member-groups.controller.ts:60-67`
      (⚠️ EVERY `@Body()`/`@Query()` PARAM MUST BIND `dtoPipe(TheDto)` … see
      `src/common/dto-validation.pipe.ts`), with the structural-test reference updated to
      **`src/common/controller-validation.spec.ts`** (not `admin-guards.spec.ts`).
- [ ] **B1.4** — delete the `WaitlistController` line from `UNVALIDATED_DEBT` in
      `apps/ptah-license-server/src/common/controller-validation.spec.ts`. **That one line only.**
- [ ] **B1.5** — **do not touch** `waitlist/dto/join-waitlist.dto.ts`.

### Acceptance criteria — curl matrix, `POST /api/v1/waitlist`

- [ ] **A** `{"email":"real@example.com","source":"landing"}` → **201** (the real caller's literal:
      `waitlist-form.component.ts:195-197`).
- [ ] **B** `{"email":"not-an-email"}` → **400** — _this is the handoff's own repro and the whole
      point of the task._
- [ ] **C** `{"email":"real2@example.com","bogusField":"x"}` → **400 property bogusField should not exist**.
- [ ] **D** n/a (no `@Type(() => Number)`).
- [ ] Probe waitlist rows deleted; post-state stated.

### Gates

All of §"Gates that must stay green".

### Findings to record

The handoff's own repro now returns 400 (behaviour change, intended). D5's actual number, and the
residual: an **out-of-repo** caller tagging with a `source` longer than 50 chars would now 400.

### Commit (by the reviewing sub-agent, **not** the CLI agent)

```bash
git add apps/ptah-license-server/src/waitlist/waitlist.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate JoinWaitlistDto on the public waitlist endpoint`

---

## B2 · `license/controllers/license.controller.ts` — ⏸️ PENDING · 🔴 DATA-GATED

**Tier**: 1 · **Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: `parallel-with: [B1, B3]`
**Gate**: 🔴 **B0 green AND D1 returned exactly `0`.** If D1 > 0, **this batch does not start** —
escalate to the orchestrator.
**Why sub-agent**: highest-exposure endpoint in the task (every installed extension calls it); the
binding decision depends on a data outcome and may require escalation. Judgement, not typing (plan §8).

### Subtasks

- [ ] **B2.1** — **Confirm D1 = 0 in writing before opening the file.** If `> 0`: do **not** weaken
      the regex to `@IsString()`. Widen it to a union matching the two _documented_ formats, or
      migrate the legacy rows — both are "make the DTO match reality". **Escalate the choice first.**
- [ ] **B2.2** — `license/controllers/license.controller.ts` handler `verify` (line ~101):
      `@Body() dto: VerifyLicenseDto` → `@Body(dtoPipe(VerifyLicenseDto)) dto: VerifyLicenseDto`.
- [ ] **B2.3** — add `import { dtoPipe } from '../../common/dto-validation.pipe';`
- [ ] **B2.4** — add the class docblock warning (per B1.3 pattern).
- [ ] **B2.5** — `license/services/license.service.ts:216` — **fix the stale docblock** in the same
      commit. It documents the parameter as _"format: `ptah_lic_{64-hex}` **or `PTAH-XXXX-XXXX-XXXX`**"_,
      but the generator (`license.service.ts:354-362`) only ever produces the `ptah_lic_` form and D1
      proves no legacy rows exist. That docblock is the thing that made this look dangerous — correct
      it, citing D1's number.
- [ ] **B2.6** — delete the `LicenseController` line from `UNVALIDATED_DEBT`.
- [ ] **B2.7** — **do not touch** `license/dto/verify-license.dto.ts`.

### Acceptance criteria — curl matrix, `POST /api/v1/licenses/verify` (public, `@Throttle 10/min`)

- [ ] **A** `{"licenseKey":"ptah_lic_<64 hex from a real row>"}` → **200**, same signed verdict body
      as before (the real caller's literal: `license-fetcher.ts:103-111` — a single shorthand
      property, no spread; the **only** call shape across VS Code, Electron and CLI).
- [ ] **B** `{"licenseKey":"garbage"}` → **400** (previously a signed
      `{ valid: false, tier: 'expired', reason: 'not_found' }` **200**).
- [ ] **C** case A plus `"bogusField":"x"` → **400**.
- [ ] **D** n/a.

### Findings to record

**F2 verbatim**, with **D1's actual number**. Plus the semantic change on the extension's hot path:
`LicenseFetcher` uses `axios`, which throws on 4xx → `FetchResult { ok: false, error }` → the caller
falls back to the **cached** status rather than recording a clean "invalid licence". For a genuinely
malformed key that is arguably better (client bug, not a licence verdict) — **but it is a real
semantic change and must be recorded, not discovered.** Also record plan §2.3 correction #2: the
handoff filed this controller as Tier 2; `license.controller.ts:34` has no guard and its own docblock
(line 80) says _"Authentication: None (public endpoint)"_.

### Commit

```bash
git add apps/ptah-license-server/src/license/controllers/license.controller.ts \
        apps/ptah-license-server/src/license/services/license.service.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate VerifyLicenseDto on the public verify endpoint`

---

## B3 · `app/auth/auth.controller.ts` (5 DTOs) + `jwt-auth.guard.ts` — ⏸️ PENDING

**Tier**: 1 · **Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: `parallel-with: [B1, B2]`
**Gate**: B0 green.
**Why sub-agent**: five params plus a security fix that changes a 401 body and an existing spec.
Public auth surface (plan §8).

### Subtasks

- [ ] **B3.1** — `app/auth/auth.controller.ts`, five bindings (locate by **handler name**, line
      numbers drift): - `requestMagicLink` (~424) → `@Body(dtoPipe(MagicLinkDto))` - `loginWithEmail` (~604) → `@Body(dtoPipe(LoginDto))` - `signup` (~656) → `@Body(dtoPipe(SignupDto))` - `verifyEmail` (~702) → `@Body(dtoPipe(VerifyEmailDto))` - `resendVerification` (~756) → `@Body(dtoPipe(ResendVerificationDto))`
- [ ] **B3.2** — add `import { dtoPipe } from '../../common/dto-validation.pipe';`
      ⚠️ **`../../`, not `../../../`** — see the import-depth table above (plan §11.1 is off by one).
- [ ] **B3.3** — ⚠️ **Do NOT bind the five named-primitive query params** (`auth.controller.ts:246,
    247, 478, 858, 859`). `@Query('code') code: string` binds a **string**, not a DTO; `dtoPipe`
      is meaningless there and it is an explicit non-goal (plan §6.3). The B0 carve-out already
      accounts for exactly these five.
- [ ] **B3.4** — add the class docblock warning (per B1.3), noting the named-primitive carve-out.
- [ ] **B3.5** — `app/auth/guards/jwt-auth.guard.ts` (folded-in security fix). Current lines ~57-60:
      ``ts
    } catch (error: any) {
      throw new UnauthorizedException(`Authentication failed: ${error.message}`);
    }
    ``
      Required: `catch (error: unknown)`, narrow via `instanceof Error`, **log** the narrowed message
      via the existing logging convention, and return a **fixed, non-revealing** 401 to the client
      (e.g. `'Authentication failed. Please login again.'`). The raw message comes from JWT
      verification and leaks token-shape/expiry internals. Per `CLAUDE.md`: _"Never expose raw
      `error.message` to clients."_
- [ ] **B3.6** — `app/auth/guards/jwt-auth.guard.spec.ts` — update the assertion on the 401 message.
      **That is the correct place for this change to show up**; do not delete the assertion.
- [ ] **B3.7** — delete the `AuthController` line from `UNVALIDATED_DEBT`.
- [ ] **B3.8** — **do not touch** any of the five DTO files.

### Acceptance criteria — curl matrix ×5, routes are `/api/auth/...` (**no `v1` segment**)

- [ ] `POST /api/auth/login/email` — **A** `{"email":"…","password":"≥8 chars"}` → unchanged;
      **B** short password → 400; **C** `+bogusField` → 400.
- [ ] Signup / magic-link / verify-email / resend-verification: derive each subpath from its `@Post()`
      decorator, then run A/B/C for each. **Do not guess routes — a 404 that "passes" case B is not
      a pass.**
- [ ] `VerifyEmailDto` case B: a 5- or 7-char `code` → **400** locally instead of round-tripping to
      WorkOS (also stops burning the 10/min throttle budget on obvious garbage).
- [ ] **D** n/a.
- [ ] `jwt-auth.guard.spec.ts` green; a bad/expired token returns the **fixed** message with no JWT
      internals in the body.
- [ ] Probe users deleted; post-state stated.

### Findings to record

`MagicLinkDto`'s loose `@IsString()` on `returnUrl`/`plan` is **correct** —
`validateReturnUrl()`/`validatePlanKey()` (`auth.controller.ts:427-428`) do the semantic work
downstream and stay authoritative. `LoginDto`'s `@MinLength(8)` was checked, not assumed: the login
form already gates on `password.length >= MIN_PASSWORD_LENGTH = 8`
(`auth-validation.utils.ts:57-58`, `auth.types.ts:184`), so no reachable regression — recorded
residual is an out-of-repo scripted caller now getting 400 rather than 401 (**UNVERIFIED** and
unverifiable from this repo). `SignupDto`'s `firstName`/`lastName` are never sent at all.
Plus plan §2.3 correction #6: the handoff cites `jwt-auth.guard.ts:66`; the actual `catch (error: any)`
is **line 57** and the raw-message interpolation is **lines 58-60**.

### Commit

```bash
git add apps/ptah-license-server/src/app/auth/auth.controller.ts \
        apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts \
        apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.spec.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate the five public auth DTOs and stop leaking JWT errors`

---

## 🚧 TIER 1 → TIER 2 HARD GATE

- [ ] B1, B2, B3 all committed, each as its own revertible commit.
- [ ] All three curl matrices green, status codes pasted in the report.
- [ ] Full gate suite green on the merged Tier 1 state.

---

## Tier 2 — authenticated

> Run **B4, B5, B6 in parallel**. All three are CLI-eligible; with the ceiling of 3 concurrent CLI
> agents this wave uses the full budget. **CLI agents must not commit and must not touch DTO files.**

### CLI agent prompt requirements (plan §8) — every CLI prompt must be fully self-contained

CLI agents share no context. Each prompt must carry: **absolute Windows paths**; the exact
`@Body(dtoPipe(X))` / `@Query(dtoPipe(X))` edit; the **exact import line with the correct relative
depth** (see the table above); the class-docblock text to copy from
`D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\member-groups.controller.ts`
lines 60-67 (with the structural-test reference updated to `src/common/controller-validation.spec.ts`);
the **one** ledger line to delete from
`D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts`;
**"do not touch the DTO file"**; **"do not commit"**; and **"output the diff"**.

## B4 · `contact/contact.controller.ts` — ⏸️ PENDING

**Tier**: 2 · **Recommended Executor**: **CLI agent** + `backend-developer` review & commit
**Execution Mode**: `parallel-with: [B5, B6]` · **Gate**: Tier 1 gate passed.
**Why CLI**: one param; client and server constraints verified **byte-identical**. Lowest risk in the task.

### Subtasks

- [ ] **B4.1** — handler `sendMessage` (line ~28): `@Body(dtoPipe(ContactMessageDto))`.
- [ ] **B4.2** — `import { dtoPipe } from '../common/dto-validation.pipe';`
- [ ] **B4.3** — class docblock warning (per B1.3).
- [ ] **B4.4** — delete the `ContactController` line from `UNVALIDATED_DEBT`.
- [ ] **B4.5** — do not touch `contact/dto/contact-message.dto.ts`.

### Acceptance criteria — curl matrix, authenticated (`JwtAuthGuard` → mint a `ptah_auth` cookie per plan §9.2)

- [ ] **A** `{"subject":"…","message":"…","category":"general"}` → unchanged (real caller:
      `contact-form.component.ts:178-182`).
- [ ] **B** 2-char `subject` (or 9-char `message`) → **400**.
- [ ] **C** `+bogusField` → **400**. · **D** n/a.

### Findings to record

🔴 **Plan §2.3 correction #1 — the handoff files this controller under "Tier 1 — unauthenticated /
public". It is NOT public:** `contact.controller.ts:25` is `@UseGuards(JwtAuthGuard)`. Reclassified
to Tier 2. Also: the template caps at exactly the server's numbers (`minlength="3" maxlength="200"`,
`minlength="10" maxlength="5000"`) and the `<select>` options are **byte-identical** to the
`ContactCategory` enum — zero risk.

### Commit

```bash
git add apps/ptah-license-server/src/contact/contact.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate ContactMessageDto`

---

## B5 · `session/session.controller.ts` — ⏸️ PENDING

**Tier**: 2 · **Recommended Executor**: **CLI agent** + `backend-developer` review & commit
**Execution Mode**: `parallel-with: [B4, B6]` · **Gate**: Tier 1 gate passed. (D6 informs.)

### Subtasks

- [ ] **B5.1** — handler `requestSession` (line ~39): `@Body(dtoPipe(SessionRequestDto))`.
- [ ] **B5.2** — `import { dtoPipe } from '../common/dto-validation.pipe';`
- [ ] **B5.3** — class docblock warning.
- [ ] **B5.4** — delete the `SessionController` line from `UNVALIDATED_DEBT`.
- [ ] **B5.5** — **reviewer (not the CLI agent)**: confirm the notes textarea caps at ≤2000 chars in
      `sessions-grid.component.ts`. If it does not, D6's number settles whether existing rows already
      exceed it. Do not widen the DTO.
- [ ] **B5.6** — do not touch `session/dto/session-request.dto.ts`.

### Acceptance criteria — curl matrix, authenticated

- [ ] **A** `{"sessionTopicId":"…","additionalNotes":"…"}` → unchanged (real callers:
      `sessions-grid.component.ts:173-177` free, `:235-240` paid; `undefined` keys are dropped by
      `JSON.stringify`, so `@IsOptional()` behaves).
- [ ] **B** `additionalNotes` of 2001 chars → **400**. · **C** `+bogusField` → **400**. · **D** n/a.

### Findings to record

D6's actual number.

### Commit

```bash
git add apps/ptah-license-server/src/session/session.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate SessionRequestDto`

---

## B6 · `subscription/subscription.controller.ts` — ⏸️ PENDING

**Tier**: 2 · **Recommended Executor**: **CLI agent** + `backend-developer` review & commit
**Execution Mode**: `parallel-with: [B4, B5]` · **Gate**: Tier 1 gate passed.

### Subtasks

- [ ] **B6.1** — handler `validateCheckout` (line ~109): `@Body(dtoPipe(ValidateCheckoutDto))`.
      ⚠️ `ValidateCheckoutDto` lives in `subscription/dto/subscription.dto.ts` (a shared DTO file) —
      import the class, do not edit the file.
- [ ] **B6.2** — `import { dtoPipe } from '../common/dto-validation.pipe';`
- [ ] **B6.3** — class docblock warning.
- [ ] **B6.4** — delete the `SubscriptionController` line from `UNVALIDATED_DEBT`.
- [ ] **B6.5** — do not touch `subscription/dto/subscription.dto.ts`.

### Acceptance criteria — curl matrix, authenticated

- [ ] **A** `{"priceId":"pri_…"}` → unchanged (real caller: `paddle-checkout.service.ts:224-229`,
      sourced from a required `CheckoutOptions.priceId: string`).
- [ ] **B** `{"priceId":123}` → **400**. · **C** `+bogusField` → **400**. · **D** n/a.

### Commit

```bash
git add apps/ptah-license-server/src/subscription/subscription.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate ValidateCheckoutDto`

---

## 🚧 TIER 2 → TIER 3 HARD GATE

- [ ] B4, B5, B6 all committed as separate commits.
- [ ] All three curl matrices green, status codes pasted.
- [ ] Full gate suite green.

---

## Tier 3 — admin

> Run **B7, B8, B9 in parallel**. B7 and B8 are sub-agent work (highest judgement density); B9 is
> CLI-eligible.

## B7 · `admin/admin.controller.ts` — 6 params, carries **F1** — ⏸️ PENDING · 🔴

**Tier**: 3 · **Recommended Executor**: `backend-developer` (sub-agent)
**Execution Mode**: `parallel-with: [B8, B9]` · **Gate**: Tier 2 gate passed; B0's
`passthroughDtoPipe` exists. (D2, D7 inform.)
**Why sub-agent**: carries F1. Must use `passthroughDtoPipe` for `update`, must correct the wrong
`UpdateRecordDto` docblock, must check `admin.service.spec.ts` fixtures for string-vs-number drift.
**Highest judgement density in the task** (plan §8).

### Subtasks

- [ ] **B7.1** — `bulkEmailUsers` (~96): `@Body(dtoPipe(BulkEmailDto))`.
- [ ] **B7.2** — `deleteUser` (~138): `@Body(dtoPipe(DeleteUserDto))`.
- [ ] **B7.3** — `issueComplimentaryLicense` (~170):
      `@Body(dtoPipe(IssueComplimentaryLicenseDto))` — the DTO lives at
      `license/dto/issue-complimentary-license.dto.ts` (plan §2.3 correction #4: the handoff files it
      under the wrong controller).
- [ ] **B7.4** — `inviteWaitlist` (~217): `@Body(dtoPipe(InviteWaitlistDto))`.
- [ ] **B7.5** — `list` (~259): `@Query(dtoPipe(ListQueryDto))` — **whole-object `@Query()`**, so
      `dtoPipe` does apply here.
- [ ] **B7.6** — 🔴 **F1 — `update` (~283) must use `@Body(passthroughDtoPipe(UpdateRecordDto))`, NOT
      `dtoPipe`.** `UpdateRecordDto` is `{ [key: string]: unknown }` with zero metadata;
      `ValidationExecutor.whitelist()` pushes `property <key> should not exist` for **every** key, so
      `dtoPipe` would 400 every non-empty admin PATCH. Verified broken callers:
      `admin-detail.ts:352-361` (`buildDirtyPatch()` builds **computed keys**, one per dirty editable
      field, across all 9 admin models) and `webhooks-triage.ts:325-329`/`:363`
      (`{ resolved: true, resolvedAt: iso }`).
- [ ] **B7.7** — `import { dtoPipe, passthroughDtoPipe } from '../common/dto-validation.pipe';`
- [ ] **B7.8** — `admin/admin.dto.ts`: **correct the `UpdateRecordDto` docblock (lines ~68-76)**. It
      currently says _"we accept any shape here and rely on `AdminService.filterEditable()`"_ — that
      describes intended behaviour under a **working** pipe and has never executed. Rewrite it to
      state the real mechanism and name `passthroughDtoPipe` as the deliberate binding.
      **Do not add decorators to `UpdateRecordDto`** — the authoritative allowlist is
      `AdminService.filterEditable()` against `ADMIN_MODELS[key].editableFields`.
- [ ] **B7.9** — **Scan `admin/admin.service.spec.ts` fixtures for string-vs-number drift.**
      `admin-api.service.ts:380-386` sends `page`/`pageSize` through `HttpParams` as `String(...)`, so
      they arrive as **strings** today, and `admin.service.ts:157-158` is already silently coping
      (`Number(q.page ?? 1) || 1`). After the fix they are real numbers. `Number()` is idempotent so
      the service is unaffected — **but the DTO's runtime type changes**, and any spec fixture passing
      strings is now lying about production shape. Fix such fixtures; do not change `admin.service.ts`.
- [ ] **B7.10** — **Verify the §3.15 `{ userId: '' }` edge** in
      `apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal/issue-comp-license-modal.ts`
      (payload at ~203-221). The third `target` branch is `{ userId: this.userId() }`; opened without
      a bound user and with no email typed, that is `{ userId: '' }`, which fails `@IsUUID('4')`
      **and** fails the custom XOR rule (empty string counts as absent → _neither_ identifier).
      Today it reaches the service. **Determine whether the modal's submit guard already forbids that
      state.** If it does → record as verified-safe. If it does not → **the caller is fixed, not the
      DTO** (omit `userId` when empty) — hand the fix to **B8**, which already owns a landing-page edit.
- [ ] **B7.11** — delete the `admin/AdminController` line from `UNVALIDATED_DEBT`.
- [ ] **B7.12** — do not touch `admin/admin.dto.ts`'s DTO **decorators**, `license/dto/issue-complimentary-license.dto.ts`,
      or `admin/dto/delete-user.dto.ts`.

### Acceptance criteria — curl matrix ×6, admin cookie (`JwtAuthGuard` + `AdminGuard`)

- [ ] `bulkEmailUsers` A/B (empty `userIds` array → 400 via `@ArrayMinSize(1)`)/C.
- [ ] `deleteUser` A/B (non-email `confirmEmail` → 400)/C.
- [ ] `issueComplimentaryLicense` A/B (**both** `userId` and `email` set → 400 via the XOR rule)/C.
- [ ] `inviteWaitlist` A/B/C **and D**: `batchSize=1001` → **400** (`@Max(1000)`), `batchSize=1000` → 200.
- [ ] `list` A/B/C **and D**: `?page=2&pageSize=100` → **200** with `page`/`pageSize` arriving as real
      **numbers**; `?pageSize=101` → **400**.
- [ ] 🔴 `update` — **A → 200; B n/a; C (`+bogusField`) must ALSO return 200.**
      **This is the deliberate exception. A 400 on case C means someone used `dtoPipe` and broke every
      admin edit.** Additionally verify a real multi-key `buildDirtyPatch`-shaped body (2+ computed
      keys) returns 200 and actually persists.
- [ ] `passthroughDtoPipe` appears **exactly once** in the whole server (`grep -rn "passthroughDtoPipe" apps/ptah-license-server/src`
      → the definition + one use). **A second use is a 400 being silenced — reject it.**

### Findings to record

**F1 verbatim**, including the wrong docblock and the two broken caller sites.
The never-enforced XOR / `@ValidateIf` / `@Transform(trim+lowercase)` on
`IssueComplimentaryLicenseDto` — **the single richest "intent that was never enforced" find in the
task**; the service has been find-or-creating users from **untrimmed, un-lowercased** emails, and
**D7's actual output** says whether that produced case-duplicate rows.
The `{ userId: '' }` edge and its verdict.
The dead `bulkEmail` surface: `AdminApiService.bulkEmail()` exists (`admin-api.service.ts:432-440`)
but **has no caller anywhere in the repo**; the admin UI's "bulk email modal" actually posts to
`/marketing/send`. `POST /api/v1/admin/users/bulk-email` is dead surface from the UI.
`ListQueryDto`'s runtime-type change and the `admin.service.spec.ts` fixture outcome.
Plan §2.3 correction #5: this controller has **six** payload params, not the two the handoff claims.
D2's actual number.

### Commit

```bash
git add apps/ptah-license-server/src/admin/admin.controller.ts \
        apps/ptah-license-server/src/admin/admin.dto.ts \
        apps/ptah-license-server/src/admin/admin.service.spec.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

_(omit `admin.service.spec.ts` if B7.9 required no change)_
Message: `fix(license-server): validate the six admin payload params, with a passthrough pipe for update`

---

## B8 · `marketing/controllers/admin-marketing.controller.ts` + caller cap — ⏸️ PENDING

**Tier**: 3 · **Recommended Executor**: `backend-developer` (sub-agent; includes a small frontend touch)
**Execution Mode**: `parallel-with: [B7, B9]` · **Gate**: Tier 2 gate passed; D3 and D4 recorded.
**Why sub-agent**: spans backend **and** the landing page, and involves **fixing a caller rather than
the DTO** (plan §8).

### Subtasks

- [ ] **B8.1** — `saveTemplate` (~44): `@Body(dtoPipe(SaveTemplateDto))`.
- [ ] **B8.2** — `sendCampaign` (~70): `@Body(dtoPipe(SendCampaignDto))`.
- [ ] **B8.3** — `import { dtoPipe } from '../../common/dto-validation.pipe';`
- [ ] **B8.4** — class docblock warning.
- [ ] **B8.5** — ⚠️ **Caller fix (the §3.16 reachable RISK).**
      `apps/ptah-landing-page/src/app/pages/admin/marketing/marketing-compose/marketing-compose.ts:295`
      builds the test-send name as `` `${this.name()} (test)` `` — **+7 chars** — against
      `@Length(1,100)`, with **no client-side cap on `name`**. An admin who types a 94-character
      campaign name gets: **real send succeeds, test send 400s.** Fix: cap the `name` input
      client-side at **93** characters (`maxlength="93"` **plus** the matching signal/TS guard, so
      paste and programmatic set are both covered).
      🔴 **Do NOT raise `@Length(1,100)` to make the caller pass — the caller is the thing that is wrong.**
- [ ] **B8.6** — _(conditional on B7.10)_ if the `{ userId: '' }` submit guard is **not** already
      present, fix
      `apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal/issue-comp-license-modal.ts`
      to **omit `userId` when empty** (do not send an empty string). If B7.10 found the guard already
      forbids that state, skip and say so.
- [ ] **B8.7** — check D4's number. If `max(length(html_body)) > 50000`, the 50k cap is **aspirational**
      → **stop and escalate; this is a product decision, not a silent widening.**
- [ ] **B8.8** — delete the `AdminMarketingController` line from `UNVALIDATED_DEBT`.
- [ ] **B8.9** — do not touch `marketing/dto/save-template.dto.ts` or `marketing/dto/send-campaign.dto.ts`.

### Acceptance criteria — curl matrix ×2, admin cookie

- [ ] `saveTemplate` **A** (real caller literal: `template-create.ts:96-102` — all three trimmed,
      `variables` omitted when empty) / **B** (`htmlBody` of 50001 chars → 400) / **C**.
- [ ] `sendCampaign` **A** (`marketing-compose.ts:337-346` real-send literal) / **B** (`segment:"bogus"`
      → 400 via the allowlist; a malformed `userIds` entry → 400) / **C**. **D** n/a.
- [ ] **Regression proof for B8.5**: with a 93-char name, **both** the real send and the test send
      succeed; with a 94-char name the UI now refuses input rather than producing an
      asymmetric 200/400 pair.
- [ ] Probe templates deleted; post-state stated.

### Findings to record

The §3.16 `name`-overflow caller fix, verbatim, including that `bulk-email-modal.ts:123`
(`` `Bulk Email: ${subject.substring(0,80) || 'Untitled'}` `` = 12 + ≤80 = **≤92 chars**) passes with
only **8 characters of headroom** — call this out in the commit message.
The desirable behaviour change: `marketing-compose.ts`'s `parsedUserIds()` hand-parses pasted text
with **no format check**; malformed ids currently flow through and now 400 (same class as
TASK_2026_169's `assign-members` finding, same verdict: strictly better).
**The unbounded-send concern is real and this closes it** — `@ArrayMaxSize(5000)` and the segment
allowlist have never been enforced. D3's and D4's actual numbers. Whether B8.6 was needed.

### Commit

```bash
git add apps/ptah-license-server/src/marketing/controllers/admin-marketing.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts \
        apps/ptah-landing-page/src/app/pages/admin/marketing/marketing-compose/marketing-compose.ts
# plus, only if B8.6 was required:
#       apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal/issue-comp-license-modal.ts
```

Message: `fix(license-server): validate the marketing DTOs and cap the campaign name caller at 93`

### Extra gate (this batch touches the landing page)

```bash
npx nx typecheck ptah-landing-page
npx nx lint ptah-landing-page
```

---

## B9 · `license/controllers/admin.controller.ts` — ⏸️ PENDING

**Tier**: 3 · **Recommended Executor**: **CLI agent** + `backend-developer` review & commit
**Execution Mode**: `parallel-with: [B7, B8]` · **Gate**: Tier 2 gate passed.
**Why CLI**: zero blast radius — `CreateLicenseDto` has **no caller anywhere in the repo** (confirmed
by two independent CLI traces plus the architect's own grep).

### Subtasks

- [ ] **B9.1** — handler `createLicense` (~60): `@Body(dtoPipe(CreateLicenseDto))`.
- [ ] **B9.2** — `import { dtoPipe } from '../../common/dto-validation.pipe';`
- [ ] **B9.3** — class docblock warning.
- [ ] **B9.4** — **cosmetic comment fix** at `license/controllers/admin.controller.ts:18`: the docblock
      says `X-API-Key`. The guard reads `request.headers['x-api-key']`
      (`license/guards/admin-api-key.guard.ts:51`) — **the guard is authoritative**; `main.ts:55`'s
      CORS `allowedHeaders` entry `X-Admin-API-Key` is dead. **Fix the comment only. Do not change the
      guard, and do not touch `main.ts`** (its only edit in this task is B0.12).
- [ ] **B9.5** — delete the `license/AdminController` line from `UNVALIDATED_DEBT`.
      ⚠️ **Not** the `admin/AdminController` line — see B0.6; the two share a class name and are
      disambiguated by label.
- [ ] **B9.6** — do not touch `license/dto/create-license.dto.ts`.

### Acceptance criteria — curl matrix, **`x-api-key: $ADMIN_SECRET` header, NOT the `ptah_auth` cookie**

- [ ] **A** `{"email":"real@example.com","plan":"builders"}` → unchanged.
- [ ] **B** `{"email":"real@example.com","plan":"enterprise"}` → **400** (`@IsIn(['community','builders'])`).
- [ ] **C** `+bogusField` → **400**. · **D** n/a.
- [ ] Probe licences/users deleted; post-state stated.

### Findings to record

Plan §2.3 correction #3: the handoff lists `create-license.dto.ts` under
`license/controllers/license.controller.ts` (Tier 2); it is actually used by
`license/controllers/admin.controller.ts:60` (Tier 3, `AdminApiKeyGuard`).
Correction #7: the `X-API-Key` / `X-Admin-API-Key` / `x-api-key` three-way drift, and that the guard
is authoritative. The dead `createLicense` surface (no caller in repo) — binding here is pure upside.

### Commit

```bash
git add apps/ptah-license-server/src/license/controllers/admin.controller.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

Message: `fix(license-server): validate CreateLicenseDto on the api-key admin route`

---

## Completion checklist

- [ ] `UNVALIDATED_DEBT` in `src/common/controller-validation.spec.ts` is **empty** (`[]`), and the
      staleness assertion vacuously passes.
- [ ] `grep -rn "passthroughDtoPipe" apps/ptah-license-server/src` → **exactly one definition and one
      use** (`admin.controller.ts` `update`).
- [ ] `grep -rn "catch (error: any)" apps/ptah-license-server/src` → no hit in any file this task touched.
- [ ] Ten commits on `ak/license-server-validation-pipe` (B0 + B1–B9), each independently revertible;
      SHAs filled into the progress table.
- [ ] `git status --short` still shows the unrelated pre-existing modifications
      (`libs/backend/agent-sdk/*`, `libs/backend/auth-providers/*`, `libs/backend/rpc-handlers/*`,
      `libs/shared/*`, `libs/frontend/tribunal-panel/*`, six untracked landing-page spec files)
      **unstaged and uncommitted**.
- [ ] Full gate suite green; `community-gate-smoke.mjs` and `discourse-e2e.mjs` both exit 0.
- [ ] All 20 payload params have a recorded A/B/C(/D) result, with `AdminController.update`'s case C
      recorded as the deliberate **200**.
- [ ] All test data cleaned up, post-state stated.
- [ ] **All findings from plan §11 present verbatim in the implementation report**: F1, F2 (+ D1's
      number), F3 (+ falsification proof), the §3.16 `name`-overflow caller fix, the §3.15
      `{userId:''}` edge, the never-enforced XOR/`@ValidateIf`/`@Transform` on
      `IssueComplimentaryLicenseDto`, the dead `bulkEmail`/`createLicense` surfaces, and **every**
      §2.3 correction to the handoff (all seven). Each is a finding, not a footnote.
- [ ] Plus the two findings this decomposition adds: the **duplicate `AdminController` class-name
      collision** in the ledger design (B0.6), and the **`app/auth` import-depth off-by-one** in plan
      §11.1.

## Status: NOT STARTED — awaiting orchestrator to spawn B0 (+ DC concurrently).
