# TASK_2026_170 — Batch R1 Implementation Report

**Batch**: R1 — Extract the shared controller registry to `src/testing/controller-registry.ts`
**Executor**: `backend-developer` (sub-agent)
**Branch**: `ak/license-server-validation-pipe` (HEAD `25950bb90`)
**Date**: 2026-08-01
**Status**: 🟢 **GREEN — provable no-op.**

---

## 0. Headline

R1 is green and is a **provable no-op**. All four gates pass on exactly the B0 numbers, and the
no-op claim is not asserted — it is _diffed_.

| Gate                                                                                  | Result                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npx nx test ptah-license-server --skip-nx-cache`                                     | **638 passed, 5 skipped, 643 total** — identical to B0 baseline |
| `npx eslint apps/ptah-license-server/src/common apps/ptah-license-server/src/testing` | exit 0, zero output                                             |
| `npx tsc -p apps/ptah-license-server/tsconfig.app.json --noEmit`                      | exit 0                                                          |
| `npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit`                     | exit 0                                                          |
| `controller-validation.spec.ts` in isolation                                          | **29 = 29**, test names byte-identical (§2)                     |

**No route changed. No behaviour changed. No assertion changed.** Nothing was weakened, so the
"stop and report instead" escape hatch was not needed.

Beyond the required checks I proved three additional things:

- The `src/`-relative census resolution was verified **empirically** by printing `__dirname` and
  `SRC` at runtime from the new location, and **falsified** by breaking the derivation (§4).
- The registry is **absent from the production esbuild bundle** — verified by an actual
  `nx build` and a `grep` over `main.cjs` returning **0** hits (§5).
- Every retained literal (`ALL_CONTROLLERS` entries, `UNVALIDATED_DEBT`, `EXCLUDED`,
  `MIN_TOTAL_PAYLOAD_PARAMS = 39`, `NAMED_PRIMITIVE_PARAM_COUNT = 8`) and all 29 test bodies are
  **byte-identical** to `HEAD`, proven by targeted `diff` (§3).

---

## 1. Files changed

### CREATE (1)

| File                                                                                     | What                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts` | The shared registry: `SRC`, `ControllerRegistryEntry`, `ALL_CONTROLLERS` (21 entries), `findControllerFiles`. Plus a runtime guard on the `SRC` derivation. |

### MODIFY (1)

| File                                                                                           | What                                                                                                                                                                                                                                        | Behaviour change?                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts` | Imports `ALL_CONTROLLERS` / `SRC` / `findControllerFiles` from the registry instead of declaring them; 21 controller imports and 3 now-unused `node:fs`/`node:path` symbols removed; docblock paragraph rewritten to point at the registry. | **No** — all 29 test bodies byte-identical. |

`git diff --stat` for the batch:

```
 apps/ptah-license-server/src/common/controller-validation.spec.ts | 195 ++-------------------
 1 file changed, 15 insertions(+), 180 deletions(-)
```

**`testing/index.ts` was NOT touched** — per plan §6.1, the registry is deliberately kept out of the
barrel and imported by direct path. Verified: `grep -c "controller-registry"
apps/ptah-license-server/src/testing/index.ts` → **0**, and `git diff --stat` on that file is empty.

### Nothing was staged. Nothing was committed.

`git status --short` at the end of R1:

```
 M apps/ptah-license-server/src/common/controller-validation.spec.ts
 M libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/community/community-view.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/components/delete-pack-modal/delete-pack-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/components/pack-form-modal/pack-form-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/packs/packs-list.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/sessions/components/session-form-modal/session-form-modal.spec.ts
?? apps/ptah-landing-page/src/app/pages/admin/builders/sessions/sessions-list.spec.ts
?? apps/ptah-license-server/src/testing/controller-registry.ts
```

**Exact paths for the orchestrator's commit (two):**

```bash
git add apps/ptah-license-server/src/testing/controller-registry.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts
```

⚠️ **Working-tree note.** `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` is
modified and is **not mine** — it was already dirty when R1 started (confirmed by `git status` before
my first edit). The briefing's list of expected pre-existing dirt (`agent-sdk`, `rpc-handlers`,
`tribunal-panel`, `sdk-model-service`, …) is **stale** — those were committed in `25950bb90` /
`b8ddf4e25` and are gone; this canvas file is the only pre-existing modification now. The six
untracked landing-page specs are still there and were **not touched**. **Do not stage the canvas
file.**

---

## 2. 🔴 The no-op proof: 29 = 29, same names

### Before (`HEAD` = `25950bb90`, clean tree)

```
$ npx jest --config apps/ptah-license-server/jest.config.ts --testPathPatterns "controller-validation"

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        1.671 s
Ran all test suites matching controller-validation.
```

### After (R1 applied)

```
$ npx jest --config apps/ptah-license-server/jest.config.ts --testPathPatterns "controller-validation"

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        4.215 s
Ran all test suites matching controller-validation.
```

**29 = 29.**

### The names, not just the count

A matching count is a weak claim — a renamed test would still total 29. So I captured the full test
names on both sides via `jest --json` and diffed them:

```bash
npx jest --config apps/ptah-license-server/jest.config.ts \
         --testPathPatterns "controller-validation" --json --outputFile=<before|after>.json
# then: sort every assertionResults[].fullName and diff
$ diff before-names.txt after-names.txt
$ echo $?
0                       # <-- zero differences
```

The 29 names, identical on both sides (`fullName`, sorted):

```
Server-wide input validation — structural guard EXCLUDED — permanent, documented carve-outs is disjoint from UNVALIDATED_DEBT (a controller cannot hide in both)
Server-wide input validation — structural guard EXCLUDED — permanent, documented carve-outs marketing/ResendWebhookController still exists, still has an unbound param, and carries a reason
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger admin/AdminController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger app/auth/AuthController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger contact/ContactController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger license/AdminController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger license/LicenseController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger marketing/AdminMarketingController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger only names controllers that exist in ALL_CONTROLLERS
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger session/SessionController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger subscription/SubscriptionController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard UNVALIDATED_DEBT — the shrinking ledger waitlist/WaitlistController still has at least one unbound param (delete this line once it does not)
Server-wide input validation — structural guard anti-vacuity carves out exactly 8 named-primitive params
Server-wide input validation — structural guard anti-vacuity discovers at least 39 payload params server-wide
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType discourse/AdminCommunityController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType discourse/CommunityController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType discourse/DiscourseController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType events/EventsController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType google-sessions/AdminSessionsController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType google-sessions/MembersController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType health/HealthController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType marketing/PublicMarketingController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType member-groups/MemberGroupsController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType no enforced controller has an unbound payload param (aggregate view)
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType packs/AdminPacksController
Server-wide input validation — structural guard every whole-object payload param binds a ValidationPipe with expectedType paddle/PaddleController
Server-wide input validation — structural guard the controller census is complete (the ledger can only work if it is) each ALL_CONTROLLERS entry names the class its file exports
Server-wide input validation — structural guard the controller census is complete (the ledger can only work if it is) every *.controller.ts in src/ appears in ALL_CONTROLLERS
Server-wide input validation — structural guard the controller census is complete (the ledger can only work if it is) labels are unique and each maps to a distinct class
```

Note that this list is itself derived from the data R1 moved: the 12 `UNVALIDATED_DEBT` names, the 12
`ENFORCED` names and the `EXCLUDED` name are all `it.each` titles interpolated from labels. **An
identical name list is therefore also a proof that the labels round-tripped unchanged.**

### Full-suite delta: zero

|                                                         | Tests   | Skipped | Total   | Suites                         |
| ------------------------------------------------------- | ------- | ------- | ------- | ------------------------------ |
| B0 baseline (re-measured on the clean tree, not quoted) | 638     | 5       | 643     | 46 passed, 1 skipped, 47 total |
| After R1                                                | **638** | **5**   | **643** | 46 passed, 1 skipped, 47 total |
| Δ                                                       | **0**   | **0**   | **0**   | **0**                          |

```
$ npx nx test ptah-license-server --skip-nx-cache
Test Suites: 1 skipped, 46 passed, 46 of 47 total
Tests:       5 skipped, 638 passed, 643 total
Snapshots:   0 total
Time:        7.985 s
Ran all test suites.

 NX   Successfully ran target test for project ptah-license-server
```

I re-measured the baseline on the clean tree rather than trusting B0's report, so the comparison is
between two runs on this machine minutes apart. Both read 638/5/643.

---

## 3. 🔴 "Nothing was weakened" — proven by diff, not by claim

The failure mode this batch most needs to exclude is a subtle edit smuggled in with the move. I
diffed every moved and every retained region against `git show HEAD:…`.

### 3.1 The 21 `ALL_CONTROLLERS` entries — byte-identical

```bash
$ diff <(git show HEAD:…/controller-validation.spec.ts | sed -n '85,191p' \
          | grep -E "^    (label|file|controller):") \
       <(sed -n '/^export const ALL_CONTROLLERS/,/^];/p' …/testing/controller-registry.ts \
          | grep -E "^    (label|file|controller):")
$ echo $?
0
63 lines each  (21 entries × 3 fields)
```

Every `label` string, every `file` path and every `controller` identifier survived the move
unchanged — including the two aliased imports `AdminAdminController` / `LicenseAdminController` that
keep the duplicated `AdminController` class name from collapsing.

### 3.2 `findControllerFiles` — identical except the `export` keyword

```bash
$ diff <(git show HEAD:… | sed -n '/^function findControllerFiles/,/^}$/p') \
       <(sed -n '/^export function findControllerFiles/,/^}$/p' …/controller-registry.ts)
1c1
< function findControllerFiles(dir: string): string[] {
---
> export function findControllerFiles(dir: string): string[] {
```

**One line, one keyword.** The recursion, the `generated-prisma-client` / `node_modules` skips, the
`.controller.ts` / `.spec.ts` filter and the `relative(SRC, full).split(sep).join('/')`
normalisation are byte-for-byte unchanged.

### 3.3 The four retained constants — identical

```
### const UNVALIDATED_DEBT              IDENTICAL
### const EXCLUDED                      IDENTICAL
### const MIN_TOTAL_PAYLOAD_PARAMS      IDENTICAL
### const NAMED_PRIMITIVE_PARAM_COUNT   IDENTICAL
```

Current values in the file, unchanged:

```ts
const UNVALIDATED_DEBT: readonly string[] = [
  'waitlist/WaitlistController',          // B1
  'license/LicenseController',            // B2
  'app/auth/AuthController',              // B3
  'contact/ContactController',            // B4
  'session/SessionController',            // B5
  'subscription/SubscriptionController',  // B6
  'admin/AdminController',                // B7
  'marketing/AdminMarketingController',   // B8
  'license/AdminController',              // B9
];
…
const MIN_TOTAL_PAYLOAD_PARAMS = 39;
const NAMED_PRIMITIVE_PARAM_COUNT = 8;
```

`EXCLUDED` still holds exactly `marketing/ResendWebhookController` with its verbatim reason string.

### 3.4 The param enumerator and all 29 test bodies — byte-identical

```bash
# ParamBinding, paramBindings(), payloadBindings(), bindingsFor()
$ diff <(git show HEAD:… | sed -n '<those four regions>') <(sed -n '<same>' …spec.ts)
$ echo $?                       # 0 — identical

# everything from `describe('Server-wide …` to EOF
$ diff <(git show HEAD:… | sed -n "/^describe('Server-wide/,\$p") \
       <(sed -n "/^describe('Server-wide/,\$p" …spec.ts)
$ echo $?                       # 0 — ALL 29 TEST BODIES BYTE-IDENTICAL
```

**Not one character of assertion logic changed.** The entire diff of the spec is confined to (a) the
import block and (b) one docblock paragraph.

---

## 4. 🔴 The filesystem census across the file move — the specific check requested

This is the one thing a file move can silently break, so I verified it three ways rather than
reasoning about it.

### 4.1 The derivation, stated

`SRC = join(__dirname, '..')`.

- Old home `src/common/controller-validation.spec.ts` → `..` = `src/`
- New home `src/testing/controller-registry.ts` → `..` = `src/`

The two depths **happen to agree**, which is exactly the trap the plan warns about: copying the line
works, but only by luck, and gives no signal if the next move is at a different depth.

### 4.2 Verified empirically at runtime (probe, applied then reverted)

I temporarily added two `console.log` lines beside the derivation and ran the spec:

```
[PROBE] __dirname = D:\projects\ptah-extension\apps\ptah-license-server\src\testing
[PROBE] SRC       = D:\projects\ptah-extension\apps\ptah-license-server\src
Tests:       29 passed, 29 total
```

`SRC` resolves to the server's `src/` from the new location. This is a _measurement_, not an
inference. Probe reverted; the file was restored from a byte-copy taken before the probe and
re-verified at 29/29.

### 4.3 Falsified — the derivation is now self-checking

Copying `SRC` blindly is no longer possible to do silently, because I added a runtime guard next to
it. Probe: change the derivation to `join(__dirname, '..', '..')` (i.e. simulate a move one level
deeper that was not re-derived).

**FAILING OUTPUT:**

```
FAIL ptah-license-server apps/ptah-license-server/src/common/controller-validation.spec.ts
  ● Test suite failed to run

    controller-registry: SRC resolved to "D:\projects\ptah-extension\apps\ptah-license-server",
    which does not contain main.ts. This module derives the server's src/ directory as ONE level
    above its own directory. If this file moved, re-derive SRC here — do not adjust the callers.

      at Object.<anonymous> (src/testing/controller-registry.ts:77:9)
      at Object.<anonymous> (src/common/controller-validation.spec.ts:6:1)

Test Suites: 1 failed, 1 total
Tests:       0 total
```

**RESTORED:**

```
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
```

The guard is:

```ts
if (!existsSync(join(SRC, 'main.ts'))) {
  throw new Error(`controller-registry: SRC resolved to "${SRC}", which does not contain ` + `main.ts. This module derives the server's src/ directory as ONE level ` + `above its own directory. If this file moved, re-derive SRC here — do ` + `not adjust the callers.`);
}
```

**Design note — why a module-load throw and not a new test.** A new `it(...)` would have broken the
"exactly 29 tests, same names" requirement. A module-load throw costs zero tests, fires before any
assertion can produce a confusing diff, and names the wrong value and the correct remedy in one
line. It is a no-op today (`existsSync` on a path that exists).

### 4.4 Verified by consequence — the census assertion itself is green

`every *.controller.ts in src/ appears in ALL_CONTROLLERS` passes, which means `findControllerFiles(SRC)`
returned exactly the same 21 `/`-normalised, `src/`-relative paths as before — otherwise the
`toEqual` diff would have named the discrepancy. And `each ALL_CONTROLLERS entry names the class its
file exports` passes, which means `readFileSync(join(SRC, ...file.split('/')))` still opens the right
21 files. Both are `SRC`-dependent and both are green.

---

## 5. Placement judgement — `src/testing/` confirmed, with evidence

The plan specified `src/testing/controller-registry.ts`. I verified rather than assumed.

### 5.1 It is the established home for shared test-only modules

```
apps/ptah-license-server/src/testing/
├── fixtures/                    (paddle signed-webhook fixtures)
├── testcontainers/postgres.ts
├── index.ts                     (barrel)
├── mock-prisma.factory.ts       + .spec.ts
└── nest-module-builder.ts       + .spec.ts
```

The naming convention is `kebab-case.ts` describing the artefact, not the consumer
(`mock-prisma.factory.ts`, `nest-module-builder.ts`) — `controller-registry.ts` fits it. **There is
no competing location**: no `__tests__/`, no `test-utils/`, no `src/common/testing/`. I found no
established alternative to prefer over the plan's choice.

### 5.2 Direct-path import matches existing practice — the barrel is effectively unused

Plan §6.1 says import by direct path, not through `testing/index.ts`. That is not a special case for
this file — **it is what every existing consumer already does**:

```
subscription/subscription-db.service.spec.ts:33   from '../testing/mock-prisma.factory'
license/controllers/license.controller.spec.ts:9  from '../../testing/mock-prisma.factory'
paddle/paddle.service.spec.ts:36,37               from '../testing/mock-prisma.factory'
                                                  from '../testing/nest-module-builder'
paddle/paddle-webhook.service.spec.ts:39,40,46    …/mock-prisma.factory, …/nest-module-builder, …/fixtures/paddle
paddle/paddle-webhook.integration.spec.ts:33,37   …/testcontainers/postgres, …/fixtures/paddle
paddle/paddle.controller.spec.ts:26,30            …/nest-module-builder, …/fixtures/paddle
```

**Zero** in-repo importers of `testing/index.ts`. So keeping the registry out of the barrel costs
nothing and preserves the barrel's (currently theoretical) cheapness. `index.ts` is unmodified.

### 5.3 🔴 Which tsconfig picks it up — the answer the briefing asked for

| tsconfig             | `include` / `exclude`                                                                                   | Picks up `src/testing/controller-registry.ts`?                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfig.app.json`  | `include: ["src/**/*.ts"]`, **`exclude: ["src/**/_.spec.ts", "src/\*\*/_.test.ts", "src/testing/**"]`** | ❌ **No — `src/testing/**` is explicitly excluded.\*\*                                                                                                                                           |
| `tsconfig.spec.json` | `include: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.d.ts"]`                                    | Not by `include`, but **yes transitively** — TypeScript follows the import from `controller-validation.spec.ts`, so it is fully typechecked. Exactly the status quo of `mock-prisma.factory.ts`. |

Both `tsc --noEmit` runs exit 0, which confirms the transitive pull-in works and that the file is not
orphaned from typechecking.

### 5.4 🔴 It does not ship — proven against a real bundle, not inferred

`project.json`'s build target is `@nx/esbuild:esbuild` with
`main: "apps/ptah-license-server/src/main.ts"`, `bundle: true`,
`tsConfig: "apps/ptah-license-server/tsconfig.app.json"`. esbuild bundles the reachable graph from
`main.ts`, so an unreferenced file cannot ship — but "unreferenced" is a claim, so I built and
grepped:

```bash
$ npx nx build ptah-license-server
 NX   Successfully ran target build for project ptah-license-server and 1 task it depends on

$ grep -c "ALL_CONTROLLERS\|controller-registry\|findControllerFiles\|ControllerRegistryEntry" \
       dist/apps/ptah-license-server/main.cjs
0
```

**Zero occurrences in the 516 KB production bundle.** Corroborated statically:

```bash
$ grep -rn "controller-registry" apps/ptah-license-server/src --include=*.ts
…/src/common/controller-validation.spec.ts:10   } from '../testing/controller-registry';
…/src/common/controller-validation.spec.ts:41    * … lives in `src/testing/controller-registry.ts`   (docblock)
…/src/testing/controller-registry.ts:78          `controller-registry: SRC resolved to …`            (own error string)
```

The only importer is a `.spec.ts`. **No test-only code ships.**
(`dist/apps/ptah-license-server/` was removed after the check so the build artefact does not pollute
the tree the orchestrator commits.)

---

## 6. What the registry module contains

`apps/ptah-license-server/src/testing/controller-registry.ts` — exports, in order:

| Export                                                | Notes                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SRC`                                                 | `join(__dirname, '..')` + the load-time guard (§4.3)                                                                                                                         |
| `ControllerRegistryEntry` (interface)                 | Was an inline object type on `ALL_CONTROLLERS`; named so `route-map.spec.ts` can type its own locals against it in R2. Field-for-field identical, same `readonly` modifiers. |
| `ALL_CONTROLLERS: readonly ControllerRegistryEntry[]` | The 21 entries, byte-identical (§3.1)                                                                                                                                        |
| `findControllerFiles(dir)`                            | Body byte-identical (§3.2)                                                                                                                                                   |

The docblock carries forward the two rationales that belong with the _data_ rather than with the
validation spec — the "labels, not `controller.name`, because two classes are both `AdminController`"
note, and the "explicit import list, not module-graph reflection, because `AppModule` drags Prisma's
`onModuleInit` in" note — plus three new ones this batch creates: why it is a shared module at all,
the ⚠️ "do not add to `testing/index.ts`", and the `SRC` re-derivation warning. It names
`route-map.spec.ts` as the second consumer so R2's author lands on it.

`ValidationPipe` / `ROUTE_ARGS_METADATA` and the param enumerator (`PARAMTYPE`, `ParamBinding`,
`paramBindings`, `payloadBindings`, `bindingsFor`) **stayed in the validation spec**. They are
validation-guard concerns, `route-map.spec.ts` has no use for them, and moving them would have
widened the batch past what §6.1 asks for.

The spec's docblock paragraph that described the now-moved list was rewritten to point at the
registry rather than left describing something no longer in the file — the same courtesy B0 paid when
it moved G7 out of `admin-guards.spec.ts`.

---

## 7. Acceptance criteria

- [x] `ALL_CONTROLLERS` + supporting types extracted to a shared, importable module at the planned
      path; both the existing spec and (in R2) `route-map.spec.ts` can consume one list.
- [x] `npx nx test ptah-license-server --skip-nx-cache` green — **638 passed, 5 skipped, 643 total**,
      exactly the B0 baseline, Δ = 0 in both directions.
- [x] `controller-validation.spec.ts` reports **exactly 29 tests**; before/after output pasted (§2);
      test **names** diffed to zero differences, not merely counted.
- [x] Label strings, `UNVALIDATED_DEBT`, `EXCLUDED`, `MIN_TOTAL_PAYLOAD_PARAMS = 39`,
      `NAMED_PRIMITIVE_PARAM_COUNT = 8` unchanged in value — proven by `diff` (§3).
- [x] Filesystem census resolves `src/`-relative paths correctly from the new module location —
      measured at runtime, falsified, and now self-checking (§4).
- [x] Placement verified against the app's existing conventions; the file is **excluded** from
      `tsconfig.app.json` and **absent** from the built bundle (§5).
- [x] No assertion weakened. No route touched. No controller bound. `admin/admin.controller.ts`,
      `license/controllers/admin.controller.ts`, `app/auth/`, `discourse/builders-membership.service.ts`,
      `discourse/community.controller.ts`, `google-sessions/members.controller.ts` all untouched.
- [x] `npx eslint …/src/common …/src/testing` exit 0. The seven pre-existing lint errors from
      TASK_2026_169 §4.1 are not in these paths and were not touched.
- [x] Nothing staged, nothing committed. Six untracked landing-page specs left alone.
- [x] No CLI agents were used — R1 is small and its whole value is being exactly right, which is the
      plan §7.1 rationale for keeping R batches off context-free helpers.

---

## 8. Handoff notes for R2

1. **Import the registry, do not re-declare the list.** `route-map.spec.ts` should do
   `import { ALL_CONTROLLERS, type ControllerRegistryEntry } from '../testing/controller-registry';`
   (that is `../testing/…` from `src/common/`, the same depth `controller-validation.spec.ts` now
   uses). Plan §6.1's fallback — duplicating the list with a cross-check assertion — is **not
   needed**; extraction landed cleanly.
2. **Do not add the registry to `testing/index.ts`.** The reason is on the module's docblock. No
   existing spec uses the barrel anyway (§5.2).
3. **R2's `ALL_CONTROLLERS` edits now happen in `src/testing/controller-registry.ts`, not in the
   spec.** Plan §6.2's table rows for `ALL_CONTROLLERS` (remove `admin/AdminController`, add the five
   new admin controllers) retarget to that file. The `UNVALIDATED_DEBT` / `EXCLUDED` rows stay in
   `controller-validation.spec.ts`. **This splits R2's ledger edit across two files** — worth stating
   in `tasks.md` so it is not half-done. Everything else in §6.2 is unaffected.
4. **The census is automatic and now also self-checking.** R2's five new
   `src/admin/*.controller.ts` files will be discovered by `findControllerFiles` with no edit, and
   will fail the census until they are added to `ALL_CONTROLLERS` — the mechanism B0 §6.3 relies on
   is intact after the move, proven by the green census (§4.4).
5. **`MIN_TOTAL_PAYLOAD_PARAMS = 39` is untouched and still a floor.** Plan §9's checklist item —
   re-derive it by probe after R2 and confirm it reads exactly 39 — is unaffected by R1 and still
   owed. Use B0 §3 N2's technique (temporarily set it to 999 and read the received value).
6. **Do not stage `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`** (§1).
