# TASK_2026_170 — Batch B0 Implementation Report

**Batch**: B0 — Structural spec restructure + `passthroughDtoPipe` + docs
**Executor**: `backend-developer` (sub-agent)
**Branch**: `ak/license-server-validation-pipe`
**Date**: 2026-08-01
**Status**: 🟢 **GREEN** — all gates pass, falsification proven in four directions, zero behaviour change.

---

## 0. Headline

B0 is complete and green. All four required gates pass, plus the three optional smoke gates.

- **`npx nx test ptah-license-server --skip-nx-cache`** → **638 passed, 5 skipped, 643 total** (up from 617 green at handoff — reconciled exactly in §5.1).
- **`npx eslint …`** → exit 0, zero output on every touched path.
- **`npx tsc -p tsconfig.app.json --noEmit`** → exit 0.
- **`npx tsc -p tsconfig.spec.json --noEmit`** → exit 0.
- Bonus (infra was already up): `community-gate-smoke.mjs` exit 0, `discourse-e2e.mjs` exit 0, `google-calendar-write-smoke.mjs` exit 0.

**B0 binds zero new params.** All nine in-scope controllers remain in `UNVALIDATED_DEBT`. The only
non-comment production change in this batch is the addition of a new exported function
(`passthroughDtoPipe`) which currently has **zero call sites**.

Both corrections the team-leader supplied were verified against source and applied. **Three further
defects were found** (§3) — two in the plan, one in `tasks.md`.

---

## 1. Files changed

### CREATE (2)

| File                                                                                           | What                                                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts` | The generalized server-wide structural guard (C2). 29 tests.                              |
| `D:\projects\ptah-extension\.ptah\specs\TASK_2026_170\future-enhancements.md`                  | Option B + the two deferred items (C6). ⚠️ see finding **N3** — `.ptah/**` is gitignored. |

### MODIFY (4)

| File                                                                                                         | What                                                                                                                                                                                                                                                                                             | Behaviour change?                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\common\dto-validation.pipe.ts`                      | Added `passthroughDtoPipe` (C1); rewrote `dtoPipe`'s stale SCOPE docblock (B0.2).                                                                                                                                                                                                                | No — new export, zero call sites.                                                                       |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts`                         | Removed G7 (describe block, its `CONTROLLERS` list, the now-unused `paramBindings()` helper, `PARAMTYPE`, `ParamBinding`, and the two now-unused imports `ValidationPipe` / `ROUTE_ARGS_METADATA`); rewrote the top docblock's G7 line into a pointer to the new home. G1/G3/G4/G5/G6 untouched. | No — test-only.                                                                                         |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\main.ts`                                            | Docblock at the global `ValidationPipe` registration (C5).                                                                                                                                                                                                                                       | **No — comment only.** Diff is pure additive comment; the `useGlobalPipes(...)` call is byte-identical. |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\marketing\controllers\resend-webhook.controller.ts` | Exclusion comment on the `@Body() payload` param (B0.13).                                                                                                                                                                                                                                        | **No — comment only.**                                                                                  |

**Nothing was staged. Nothing was committed.** `git status --short` at the end of B0:

```
 M apps/ptah-license-server/src/admin/admin-guards.spec.ts
 M apps/ptah-license-server/src/common/dto-validation.pipe.ts
 M apps/ptah-license-server/src/main.ts
 M apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/community/community-view.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/components/delete-pack-modal/delete-pack-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/components/pack-form-modal/pack-form-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/packs-list.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/sessions/components/session-form-modal/session-form-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/sessions/sessions-list.spec.ts
?? apps/ptah-license-server/src/common/controller-validation.spec.ts
```

⚠️ **Working-tree state differs from the briefing.** The briefing said the tree carries pre-existing
modifications in `libs/backend/agent-sdk/*`, `libs/backend/auth-providers/*`, `libs/shared/*` (and
`tasks.md` non-negotiable #5 adds `libs/backend/rpc-handlers/*` and `libs/frontend/tribunal-panel/*`).
**Those are no longer in the tree** — `HEAD` has moved to `b8ddf4e25` and they appear to have been
committed or otherwise resolved before B0 started. The six untracked landing-page spec files are still
present and were **not touched**. I did not touch, stage, stash, or revert anything outside the five
license-server paths above. Flagging it so the orchestrator's pre-commit `git status` comparison uses
the _current_ baseline, not the briefing's.

---

## 2. The two supplied corrections — both verified, both applied

### Correction 1 — duplicated `AdminController` class name: ✅ **CONFIRMED**

```
apps/ptah-license-server/src/admin/admin.controller.ts:82:export class AdminController {
apps/ptah-license-server/src/license/controllers/admin.controller.ts:29:export class AdminController {
```

Two distinct classes, identical `.name`. Plan §7's `UNVALIDATED_DEBT: string[]` keyed on
`controller.name` is therefore genuinely ambiguous, and the failure mode is the silent one: whichever
of B7/B9 landed first would delete the single `'AdminController'` line, and the _other_ controller
would remain exempt from the main assertion with **nothing failing**. The staleness assertion would not
catch it either, because the line is gone.

**Resolution implemented** — `ALL_CONTROLLERS` is an array of records, not bare classes:

```ts
const ALL_CONTROLLERS: ReadonlyArray<{
  readonly label: string;       // unique, path-qualified
  readonly file: string;        // src-relative path
  readonly controller: Type<unknown>;
}> = [ … ];
```

- The two classes are imported under aliases: `AdminController as AdminAdminController` and
  `AdminController as LicenseAdminController`.
- Labels are path-qualified: `'admin/AdminController'` and `'license/AdminController'` — exactly the
  strings `tasks.md` B7.11 and B9.5 instruct those batches to delete, so no downstream edit is needed.
- Both `UNVALIDATED_DEBT` and `EXCLUDED` are keyed on `label`.
- Binding handles are reported as `` `${label}.${handler}` ``, so a failure reads
  `license/AdminController.createLicense` and can never be confused with
  `admin/AdminController.update`.
- Three defensive assertions were added on top of the correction:
  - labels are unique (`new Set(labels).size === labels.length`);
  - each entry maps to a **distinct class object** (`new Set(classes).size === classes.length`) — this
    is what catches a copy-paste that points two labels at the same import;
  - each entry's `file` actually exports exactly the class named (`^export class (\w+Controller)\b`
    scanned out of the source), which is what catches the _reverse_ mistake — a label pointing at the
    wrong file.

**I chose labels over "path-qualified key derived mechanically"** because the labels have to match the
strings written into `tasks.md` B1.4/B2.6/B3.7/B4.4/B5.4/B6.4/B7.11/B8.8/B9.5. Mechanical derivation
would have produced `license/controllers/AdminController`, forcing an edit to five downstream batch
specs for no gain. The `file` field carries the mechanical path, and the census assertion (§3, **N1**)
ties label → file → exported class, so the friendly label is verified rather than trusted.

### Correction 2 — `app/auth` import depth: ✅ **CONFIRMED**

`src/app/auth/` → `..` = `src/app/` → `../..` = `src/`, so the correct path from
`app/auth/auth.controller.ts` is `../../common/dto-validation.pipe`. Corroborated by that file's own
existing imports:

```
apps/ptah-license-server/src/app/auth/auth.controller.ts:26:
  import { PrismaService } from '../../prisma/prisma.service';
```

`prisma/` is a direct child of `src/`, same as `common/`. Plan §11.1's `../../../common/…` is off by
one (it would be correct from `src/app/auth/guards/`, which is likely where the figure came from).
**`tasks.md`'s import-depth table is already correct** and B3.2 already carries the ⚠️. **No B0 file
imports the pipe**, so nothing to fix here — recorded for B3.

---

## 3. Further defects found (three)

### N1 — 🟠 The plan's ledger guarantee has a hole: a new controller does _not_ fail the suite

**Plan §7 part 2 claims:** _"Add a new controller with a bare `@Body()` → not in the ledger → the main
assertion fails."_

**That is false as specified.** The main assertion iterates `ALL_CONTROLLERS`, which the same paragraph
mandates be a _hand-maintained explicit import list_ ("deliberately not module-graph reflection"). A
contributor who adds `src/billing/billing.controller.ts` with a bare `@Body()` simply never appears in
`ALL_CONTROLLERS`, so there is nothing to iterate, nothing to fail, and the ledger's strongest claim —
"strictly stronger than today's opt-in list, which is silent about every controller nobody remembered
to add" — collapses into exactly the opt-in list it was replacing.

I take the plan's reasoning for avoiding module-graph reflection as correct and binding (TASK_2026_169
report §6(d): booting `AppModule` drags Prisma's `onModuleInit` in and makes a cheap structural test
infra-dependent and flaky). So the fix must close the hole **without** reflection.

**Fix implemented — a filesystem census, in the same spirit as G4's existing `readFileSync` checks:**

```ts
it('every *.controller.ts in src/ appears in ALL_CONTROLLERS', () => {
  const onDisk = findControllerFiles(SRC).sort(); // recursive readdirSync
  const listed = ALL_CONTROLLERS.map((c) => c.file).sort();
  expect(listed).toEqual(onDisk);
});
```

`findControllerFiles` walks `src/` for `*.controller.ts` (skipping `.spec.ts` and
`generated-prisma-client/`). No Nest bootstrap, no Postgres, no module graph — runs in milliseconds.
Falsification proof in §4.4 below.

### N2 — 🟡 The plan's carve-out count of 8 is correct, and so is the param inventory — but the _total_ was never stated

Plan §7 part 4 says the anti-vacuity floor should be "today's actual count" without giving a number.
I counted it two ways.

**By grep** (`@Body(`/`@Query(` across `apps/ptah-license-server/src`, excluding specs and the two
false-positive hits inside `member-groups.controller.ts`'s docblock at lines 60-61): **39**.

**By the enumerator itself** — I temporarily set `MIN_TOTAL_PAYLOAD_PARAMS = 999` and captured the
received value:

```
● Server-wide input validation — structural guard › anti-vacuity › discovers at least 999 payload params server-wide

    expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 999
    Received:    39
```

The two agree: **39 total = 31 whole-object + 8 named-primitive**. Both literals are now in the spec
with the count and the date they were counted:

- `MIN_TOTAL_PAYLOAD_PARAMS = 39` — asserted as `toBeGreaterThanOrEqual`, commented **"This is a FLOOR,
  NOT A TARGET."**
- `NAMED_PRIMITIVE_PARAM_COUNT = 8` — asserted **exactly**, and the assertion prints the _list_ of
  named params on failure, not just the count, so a ninth says which one it is.

The plan's predicted carve-out of 8 is confirmed exactly:
`auth.controller.ts:246,247,478,858,859` (5) + `discourse/discourse.controller.ts:48,49` (2) +
`events/events.controller.ts:78` (1).

The discriminator was verified against installed Nest source rather than assumed —
`node_modules/@nestjs/common/decorators/http/route-params.decorator.js`:

```js
const createPipesRouteParamDecorator = (paramtype) => (data, ...pipes) => (target, key, index) => {
    const hasParamData = isNil(data) || isString(data);
    const paramData = hasParamData ? data : undefined;
    const paramPipes = hasParamData ? pipes : [data, ...pipes];
    ... assignMetadata(args, paramtype, index, paramData, ...paramPipes) ...
};
function assignMetadata(args, paramtype, index, data, ...pipes) {
  return { ...args, [`${paramtype}:${index}`]: { index, data, pipes } };
}
```

So `@Query('code')` → `data === 'code'`; `@Query(dtoPipe(X))` → the pipe is _not_ a string, so
`paramData = undefined` and the pipe is pushed into `pipes`. `data !== undefined` is the correct and
complete discriminator. Both branches are exercised by the passing suite.

### N3 — 🟡 `tasks.md` B0's commit block stages a gitignored file

```
$ git check-ignore -v .ptah/specs/TASK_2026_170/future-enhancements.md
.gitignore:128:.ptah/**    .ptah/specs/TASK_2026_170/future-enhancements.md
```

`tasks.md` B0's commit recipe includes `.ptah/specs/TASK_2026_170/future-enhancements.md` in its
`git add`. That `git add` will **fail with "paths are ignored by one of your .gitignore files"** (or
silently no-op depending on flags), which will look like a broken commit script to whoever runs it.

The whole `.ptah/` specs directory — including `implementation-plan.md`, `tasks.md`, and TASK_2026_169's
reports — is untracked by design in this repo. **This is not a problem to fix**; the file belongs where
the plan put it and where every sibling task document already lives. **Orchestrator action: drop that
one path from B0's `git add` line.** The commit is then four backend paths plus the new spec:

```bash
git add apps/ptah-license-server/src/common/dto-validation.pipe.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts \
        apps/ptah-license-server/src/admin/admin-guards.spec.ts \
        apps/ptah-license-server/src/main.ts \
        apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts
```

---

## 4. 🔴 Falsification proofs — four, all captured

A structural test that has not been seen to fail is not evidence. Each probe below was applied, run,
captured, and **reverted**; the suite is green at rest.

### 4.1 Revert a real binding on an already-protected controller → main assertion fails, handler NAMED

Probe: `member-groups.controller.ts:146`, `@Body(dtoPipe(AssignMembersDto)) dto` → `@Body() dto`.
(`MemberGroupsController` was bound by TASK_2026_169 and is **not** in the ledger, so it is under full
enforcement.)

**FAILING OUTPUT:**

```
FAIL ptah-license-server apps/ptah-license-server/src/common/controller-validation.spec.ts (7.647 s)
  ● Server-wide input validation — structural guard › every whole-object payload param binds a ValidationPipe with expectedType › member-groups/MemberGroupsController

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Object {
        "handler": "member-groups/MemberGroupsController.assign",
        "kind": "Body",
        "named": false,
    -   "validated": true,
    +   "validated": false,
      }

      at src/common/controller-validation.spec.ts:414:27

  ● Server-wide input validation — structural guard › every whole-object payload param binds a ValidationPipe with expectedType › no enforced controller has an unbound payload param (aggregate view)

    expect(received).toEqual(expected) // deep equality

    - Array []
    + Array [
    +   "member-groups/MemberGroupsController.assign (@Body())",
    + ]

      at Object.<anonymous> (src/common/controller-validation.spec.ts:431:25)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 27 passed, 29 total
```

**The offending handler is named twice** — once by the per-controller object diff
(`member-groups/MemberGroupsController.assign`) and once by the aggregate list, which is the view that
scales when several params break at once. The label prefix means the two `AdminController`s can never
be confused in this output.

**RESTORED OUTPUT** (`git checkout -- member-groups.controller.ts`, `git diff --stat` clean, re-run):

```
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        8.36 s
Ran all test suites matching controller-validation.
```

### 4.2 Ledger direction (a) — remove a name from `UNVALIDATED_DEBT` without doing the binding

Probe: commented out `'waitlist/WaitlistController'` from `UNVALIDATED_DEBT`. No controller touched.

**FAILING OUTPUT:**

```
FAIL ptah-license-server apps/ptah-license-server/src/common/controller-validation.spec.ts (6.835 s)
  ● Server-wide input validation — structural guard › every whole-object payload param binds a ValidationPipe with expectedType › waitlist/WaitlistController

      Object {
        "handler": "waitlist/WaitlistController.join",
        "kind": "Body",
        "named": false,
    -   "validated": true,
    +   "validated": false,
      }

  ● … › no enforced controller has an unbound payload param (aggregate view)

    - Array []
    + Array [
    +   "waitlist/WaitlistController.join (@Body())",
    + ]
```

A batch that deletes its ledger line but forgets the binding cannot go green. Restored.

### 4.3 Ledger direction (b) — a controller left in the ledger after it has been bound → staleness fails

Probe: added `'packs/AdminPacksController'` to `UNVALIDATED_DEBT`. `AdminPacksController` is fully
bound (TASK_2026_169), so this is precisely the "did the work, forgot to delete the line" state,
reproduced **without** having to temporarily bind an in-scope controller — B0's constraint is that it
binds nothing, and an equivalent probe that respects that constraint is strictly preferable.

**FAILING OUTPUT:**

```
FAIL ptah-license-server apps/ptah-license-server/src/common/controller-validation.spec.ts (6.349 s)
  ● Server-wide input validation — structural guard › UNVALIDATED_DEBT — the shrinking ledger › packs/AdminPacksController still has at least one unbound param (delete this line once it does not)

    expect(received).toEqual(expected) // deep equality

      Object {
        "label": "packs/AdminPacksController",
    -   "unbound": true,
    +   "unbound": false,
      }

      at src/common/controller-validation.spec.ts:459:12

Test Suites: 1 failed, 1 total
Tests:       1 failed, 28 passed, 29 total
```

Note the test _name_ is the instruction: _"delete this line once it does not"_. Restored.

### 4.4 Census (defect N1's fix) — a controller missing from `ALL_CONTROLLERS` fails

Probe: deleted the `health/HealthController` entry from `ALL_CONTROLLERS`, leaving the file on disk.

**FAILING OUTPUT:**

```
FAIL ptah-license-server apps/ptah-license-server/src/common/controller-validation.spec.ts (6.538 s)
  ● Server-wide input validation — structural guard › the controller census is complete (the ledger can only work if it is) › every *.controller.ts in src/ appears in ALL_CONTROLLERS

    expect(received).toEqual(expected) // deep equality

    @@ -6,11 +6,10 @@
        "discourse/community.controller.ts",
        "discourse/discourse.controller.ts",
        "events/events.controller.ts",
        "google-sessions/admin-sessions.controller.ts",
        "google-sessions/members.controller.ts",
    -   "health/health.controller.ts",
        "license/controllers/admin.controller.ts",
        …
      at Object.<anonymous> (src/common/controller-validation.spec.ts:377:22)
```

The diff names the exact missing file. Restored; suite green (29/29).

---

## 5. Gate results

### 5.1 `npx nx test ptah-license-server --skip-nx-cache`

```
Test Suites: 1 skipped, 46 passed, 46 of 47 total
Tests:       5 skipped, 638 passed, 643 total
Snapshots:   0 total
Time:        15.993 s
Ran all test suites.

 NX   Successfully ran target test for project ptah-license-server
```

**New number: 638 passing (was 617).** The delta reconciles exactly:

|                                                                                   | Δ   |
| --------------------------------------------------------------------------------- | --- |
| Baseline at handoff                                                               | 617 |
| − old G7 removed from `admin-guards.spec.ts` (4 controllers × 2 `it.each` blocks) | −8  |
| + `controller-validation.spec.ts`                                                 | +29 |
| **= 638**                                                                         | ✅  |

The new spec's 29 tests, isolated:

```
$ npx jest --config apps/ptah-license-server/jest.config.ts --testPathPatterns "controller-validation"
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
```

The 5 skipped tests and 1 skipped suite are pre-existing and untouched by B0.

### 5.2 ESLint

```
$ npx eslint apps/ptah-license-server/src/common \
             apps/ptah-license-server/src/admin \
             apps/ptah-license-server/src/main.ts \
             apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts
ESLINT_EXIT=0
```

Zero output, zero warnings. **The seven pre-existing lint errors documented in TASK_2026_169 §4.1 were
not touched and are not in any B0 path** — confirmed by the clean exit on `src/common` and `src/admin`,
which are the only directories B0 modifies wholesale.

### 5.3 Typecheck

```
$ npx tsc -p apps/ptah-license-server/tsconfig.app.json  --noEmit    ->  APP_EXIT=0
$ npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit    ->  SPEC_EXIT=0
```

### 5.4 Smoke gates (bonus — docker was already up)

`docker ps` showed `ptah_license_server` (healthy, up 2h), `ptah_postgres` (healthy, up 4h),
`discourse_dev` (up 2h), so all three smokes were run. ⚠️ These exercise the **running container**,
which is the pre-B0 build — appropriate here precisely because B0 makes no behaviour change, so they
are a regression check on the baseline, not a verification of B0's diff.

```
$ node scripts/community-gate-smoke.mjs        -> exit 0
  ✓ gate discriminates (builder.communityUrl set, community.communityUrl null)
  cleaned up seeded users
  All community-gate security checks passed — only Builders read forum data.

$ node scripts/discourse-e2e.mjs              -> exit 0
  ✓   auth_overrides_email = true
  cleaned up seeded users
  All Discourse round-trip checks passed.

$ node scripts/google-calendar-write-smoke.mjs -> exit 0   (tasks.md: required because B0 touches src/common/)
  ✓ deleting BUILDERS_SESSION_EVENT_ID is refused (409)
  ✓ refusal carries reason=protected_recurring_event
  ✓ deleting an EXPANDED INSTANCE of the series is refused (409)
  All calendar write checks passed — events.insert and events.delete work.
```

Each script cleans up its own seeded rows (both report "cleaned up seeded users"). **B0 created no test
data of its own** — it ran no curl matrix, because it binds nothing. No cleanup owed.

---

## 6. What was built

### C1 — `passthroughDtoPipe` + refreshed `dtoPipe` docblock

`apps/ptah-license-server/src/common/dto-validation.pipe.ts`

```ts
export function passthroughDtoPipe<T>(expectedType: Type<T>): ValidationPipe {
  return new ValidationPipe({
    expectedType,
    whitelist: false,
    forbidNonWhitelisted: false,
    transform: true,
  });
}
```

Its docblock (adapted from plan §3.11, expanded) states the mechanism with the `ValidationExecutor`
source quoted inline, names `AdminController.update` as the only legitimate consumer today, points at
`AdminService.filterEditable()` / `ADMIN_MODELS[key].editableFields` as the real allowlist, explains
that it still carries `expectedType` so the structural guard is satisfied _honestly_, and forbids its
use as a 400-silencer in the terms the plan requires:

> 🔴 Do NOT reach for this to silence a 400. If the DTO has decorators, the 400 is the DTO doing its
> job — use `dtoPipe` and fix the caller. A second call site for `passthroughDtoPipe` should be
> rejected in review unless it comes with the same "the allowlist provably lives elsewhere" argument.

**Current call-site count is zero** (`grep -rn "passthroughDtoPipe" apps/ptah-license-server/src`
returns the definition plus four prose mentions in docblocks — no invocations). B7 adds the one and
only use. The tasks.md completion checklist's "exactly one definition and one use" is therefore
**correctly not yet satisfied**, and will be after B7.

**`dtoPipe`'s docblock was rewritten** (B0.2). Its two stale paragraphs are gone:

- ~~"SCOPE: this is applied to the endpoints added by TASK_2026_169 only…"~~ → now: `dtoPipe` is the
  **server-wide** mechanism; the rule is unconditional; enforced structurally by
  `controller-validation.spec.ts`.
- ~~"The app-wide defect is deliberately NOT fixed here…"~~ → now: the three documented exceptions
  (webhooks, named primitives, `AdminController.update`), each cross-referenced to where it is
  _asserted_ rather than merely claimed; and Option B named as the deferred end state with a pointer to
  `future-enhancements.md`.

The root-cause paragraphs (esbuild / `emitDecoratorMetadata` / the `transform()` short-circuit / the
live 201 repros) were kept verbatim — they are still true and still the most valuable part of the file.
One sentence was corrected from _"every DTO decorator in the server is currently inert"_ to _"is inert
**unless a pipe supplies the type explicitly**"_, which stopped being true the moment TASK_2026_169
landed and would have read as a contradiction of the paragraph directly below it.

### C2 — `controller-validation.spec.ts`

29 tests in five groups.

**Census (3 tests)** — defect N1's fix, §3 above.

**Main assertion (`ENFORCED` = 21 − 9 ledger − 1 excluded = 11 controllers, 12 tests)** — per-controller
`it.each` asserting each whole-object binding deep-equals `{ handler, kind, named: false, validated:
true }`, so a failure names the handler; plus one aggregate test producing a flat list of every
offender across the server.

**Ledger (10 tests)** — one test asserting every ledger label exists in `ALL_CONTROLLERS` (catches a
typo'd deletion, which would otherwise silently exempt nothing and _pass_), plus the 9 staleness tests.

**`EXCLUDED` (2 tests)** — expressed as data with the plan §7 reason string verbatim. Asserts
disjointness with `UNVALIDATED_DEBT`, that `ResendWebhookController` still exists in
`ALL_CONTROLLERS`, that its reason is non-trivial, and that it **still has an unbound param** so the
exclusion cannot outlive its subject. `PaddleController` is deliberately absent — it has no payload
param (`@Req() req.rawBody`), so listing it would be a lie the staleness check catches; that reasoning
is a comment on the `EXCLUDED` declaration.

**Anti-vacuity (2 tests)** — `MIN_TOTAL_PAYLOAD_PARAMS = 39` (floor) and
`NAMED_PRIMITIVE_PARAM_COUNT = 8` (exact). Replaces `admin-guards.spec.ts:264-271`'s hand-maintained
per-controller minimums, which needed one number per controller and did not scale to 21.

`UNVALIDATED_DEBT` is seeded with **exactly the nine in-scope controllers**, each annotated with its
batch number so a contributor can see at a glance which commit owns the line:

```ts
const UNVALIDATED_DEBT: readonly string[] = [
  'waitlist/WaitlistController', // B1
  'license/LicenseController', // B2
  'app/auth/AuthController', // B3
  'contact/ContactController', // B4
  'session/SessionController', // B5
  'subscription/SubscriptionController', // B6
  'admin/AdminController', // B7
  'marketing/AdminMarketingController', // B8
  'license/AdminController', // B9
];
```

Per B0.7, the seven payload-param-free controllers (`HealthController`, `PublicMarketingController`,
`PaddleController`, `CommunityController`, `MembersController`, `DiscourseController`,
`EventsController`) are **not** in the ledger — the staleness assertion would fail on them. Verified:
they are in `ALL_CONTROLLERS`, in `ENFORCED`, and pass the main assertion vacuously (correctly — they
have nothing to bind), while `DiscourseController` and `EventsController`'s named primitives are
carved out by `data !== undefined` and counted into the 8.

### C5 — `main.ts` docblock

Comment-only, above the untouched `useGlobalPipes(...)` call, covering all three required points: (a)
inert under esbuild, with the short-circuit quoted; (b) `dtoPipe`/`passthroughDtoPipe` are the live
mechanism and `expectedType` is applied _before_ the short-circuit, which is why the per-param form
works where this one does not; (c) retained deliberately as the Option B safety net —

> Deleting it now would look like dead-code cleanup but would actually remove that safety net.

### B0.11 — G7 removed from `admin-guards.spec.ts`

Removed: the `describe('G7 …')` block, its `CONTROLLERS` tuple list, `paramBindings()`, `PARAMTYPE`,
the `ParamBinding` interface, and the two imports that became unused (`ValidationPipe` from
`@nestjs/common`, `ROUTE_ARGS_METADATA` from `@nestjs/common/constants`). The four controller imports
stayed — G1 and G5 still use all of them.

The top docblock no longer advertises G7; it explains where G7 went and **why**, so someone grepping
this file for it lands on the reason rather than a dead end:

```
 * G7 ("every @Body()/@Query() param binds dtoPipe") USED to live here. It was
 * moved to `src/common/controller-validation.spec.ts` by TASK_2026_170: it now
 * covers every controller in the server, including public ones, which do not
 * belong under an admin-guards heading — and it needed a named-primitive
 * carve-out (`@Query('code')`) that the version here did not have.
```

Residual G7 references in the file: **one**, the docblock pointer above. `admin-guards.spec.ts` passes.

### B0.13 — `resend-webhook.controller.ts` exclusion comment

Comment-only on the `@Body() payload` param, carrying the reason (vendor-additive fields would 400
under `forbidNonWhitelisted`; `ResendWebhookPayload` is an interface, not a class; Svix HMAC in
`ResendWebhookGuard` is the authoritative check) and cross-referencing the `EXCLUDED` list. This is
exclusion-record (a) of three; (b) is `EXCLUDED` in the spec; (c) is plan §6.2. **No webhook body is
logged**; nothing in the handler was changed.

### C6 — `future-enhancements.md`

Three items, all as specified: (i) **Option B** with the §1 evidence quoted from installed source
(`validation.pipe.js` `transform()`, `ValidationExecutor.whitelist()`, the `forbidUnknownValues: false`
default, versions `@nestjs/common` 11.1.23 / `class-validator` 0.15.1), the two landmines a global pipe
would hit (`UpdateRecordDto`, webhooks), and _why Option A is its prerequisite_; (ii) the **rejected**
per-model admin update DTOs alternative with the counter-argument, plus a note that a _generated_
per-model DTO is the right shape if it is ever revisited; (iii) **named-primitive query-param
hardening**, with the table of all 8 params, the note that none is currently unchecked (each has a
downstream check), and the `undefined`-tolerance subtlety.

---

## 7. Findings recorded for B0 (per tasks.md "Findings to record")

| Finding                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F3** — G7 does not generalize                      | Confirmed and resolved. Both of plan §7's reasons hold: the filename/framing problem, and the correctness bug (`paramBindings()` could not distinguish `@Query()` from `@Query('code')`, so adding `AuthController` would produce **five** false failures). The new enumerator carves them out by route-args `data`, verified against `route-params.decorator.js`. Falsification proof in §4.1. |
| **Duplicate `AdminController` class-name collision** | Confirmed at `admin/admin.controller.ts:82` and `license/controllers/admin.controller.ts:29`. Ledger and `EXCLUDED` keyed on path-qualified `label`, classes imported under aliases, uniqueness of both labels and class objects asserted. §2.                                                                                                                                                  |
| **Counted carve-out size**                           | **8** — exactly the plan's prediction. Asserted exactly, not as a floor. §3 N2.                                                                                                                                                                                                                                                                                                                 |
| **Counted param floor**                              | **39** total (31 whole-object + 8 named). Confirmed twice, independently (grep + enumerator probe). §3 N2.                                                                                                                                                                                                                                                                                      |
| **`dtoPipe` stale-scope docblock**                   | Corrected. Both stale paragraphs replaced; one further stale sentence found and fixed ("every DTO decorator … is currently inert" — untrue since TASK_2026_169). §6 C1.                                                                                                                                                                                                                         |
| **NEW: ledger hole for un-listed controllers (N1)**  | Plan §7's claim was false as specified. Closed with a filesystem census that respects the no-module-graph-reflection constraint. §3 N1, proof §4.4.                                                                                                                                                                                                                                             |
| **NEW: `.ptah/**` is gitignored (N3)\*\*             | B0's commit recipe stages a file git will refuse. Orchestrator should drop that path. §3 N3.                                                                                                                                                                                                                                                                                                    |
| **`app/auth` import depth off-by-one**               | Confirmed against `auth.controller.ts:26`. No B0 file affected; recorded for B3. §2.                                                                                                                                                                                                                                                                                                            |

---

## 8. Acceptance criteria (tasks.md B0)

- [x] `npx nx test ptah-license-server --skip-nx-cache` green, with `controller-validation.spec.ts` passing (29/29) and `admin-guards.spec.ts` passing without G7. **638 passed / 643 total.**
- [x] Falsification output (failing + restored) captured, and the failing output **names the handler** — `member-groups/MemberGroupsController.assign (@Body())`. Plus three additional proofs.
- [x] `UNVALIDATED_DEBT` contains exactly the nine in-scope controllers, uniquely labelled.
- [x] Carve-out size literal (**8**, exact) and server-wide param floor (**39**, floor) both asserted with actual counted numbers.
- [x] No behaviour change anywhere — B0 binds **zero** new params; `main.ts` and `resend-webhook.controller.ts` diffs are comment-only.
- [x] Nothing staged, nothing committed. Unrelated untracked landing-page specs left alone.

---

## 9. Handoff notes for the orchestrator

1. **B0 is green. B1/B2/B3 are unblocked** as far as B0 is concerned (B2 additionally needs D1 = 0 from
   the DC batch).
2. **Drop `.ptah/specs/TASK_2026_170/future-enhancements.md` from B0's `git add`** — it is gitignored
   (§3 N3). Exact corrected command is in that section.
3. **Downstream ledger labels are exactly as `tasks.md` writes them** — `'admin/AdminController'` (B7)
   and `'license/AdminController'` (B9) — so no batch spec needs editing for the collision fix.
4. **`tasks.md` B1.3's docblock instruction is correct**: the structural-test reference in each
   controller's new class docblock should be `src/common/controller-validation.spec.ts`, not
   `admin-guards.spec.ts`. The old reference in `member-groups.controller.ts:60-67` (the template CLI
   agents are told to copy) still points at the _old_ location by implication — reviewers should make
   sure the copied text is updated, and it would be reasonable for a later batch to refresh
   `member-groups.controller.ts`'s own docblock too. **I did not touch it** — it is outside B0's file
   list and TASK_2026_169 owns it.
5. **`passthroughDtoPipe` has zero call sites right now.** That is correct for B0. The completion
   checklist's "exactly one definition and one use" becomes satisfiable only after B7.
6. **The briefing's description of the dirty working tree is out of date** (§1). Use the `git status`
   captured there as the pre-B0 baseline.
