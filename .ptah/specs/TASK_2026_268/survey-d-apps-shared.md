# Survey D — apps + shared + api + web

**Partition**: 8 files, 10 344 LOC. Surveyed 2026-08-17 against `context.md`
(five techniques, four guardrails). **No code changed.**

Two headline findings:

- **`rpc.types.ts` is NOT exempt**, but only **1 148 of its 3 589 lines** are the
  defect. Four RPC namespaces (skill-synthesis, gateway, voice, cron) never
  migrated into the `rpc/` subfolder that 23 sibling namespaces already use. The
  remaining ~2 440 lines are a legitimate contract barrel and should stay over
  the ceiling under a documented exemption.
- **`router.ts` is a pure declaration table** — 172 `process.exitCode = exit;`,
  169 `Cmd.execute(`, and **zero** occurrences of `withEngine`, `container`,
  `console.`, or `throw`. No implementations are inlined. Its defect is that all
  24 command-group vocabularies live inside **one 3 090-line function**, while a
  `commands/` convention already exists for the execute half.

## Ranked backlog (value for effort)

| #   | File                                                 | LOC   | Classification                  | Cut                                                                             | Effort | Risk                                        |
| --- | ---------------------------------------------------- | ----- | ------------------------------- | ------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| 1   | `apps/ptah-cli/src/cli/router.ts`                    | 3 249 | command-group split             | → ~210 + 7 registrars (309–538) + `global-options.ts`                           | M      | Very low — behaviour-preserving             |
| 2   | `libs/api/email/.../email.service.ts`                | 1 019 | facade (extract collaborator)   | → ~475 + `email-templates.ts` (~560)                                            | S      | Very low                                    |
| 3   | `libs/shared/.../types/rpc.types.ts`                 | 3 589 | type-barrel split (**bounded**) | → ~2 555 + 4 `rpc/*.types.ts` (112–630)                                         | S      | Very low — 0 deep imports                   |
| 4   | `apps/ptah-cli/.../commands/provider.ts`             | 1 239 | facade (extract collaborator)   | → ~753 + `provider-custom-entry.ts` (~510); optional 2nd cut → ~560             | S–M    | Low                                         |
| 5   | `libs/api/learning/.../courses.service.ts`           | 1 118 | layering fix                    | → ~700 + 2 entity services + `common/prisma-errors.ts`                          | M      | Low — seam pre-drawn by controllers         |
| 6   | `libs/web/pricing/.../pricing-grid.component.ts`     | 1 140 | component split                 | → ~500 + `plan-card.component.ts` (~280) + `pricing-checkout.service.ts` (~300) | M      | Medium — needs visual review                |
| 7   | `apps/ptah-cli/.../commands/session.ts`              | 1 010 | facade (extract collaborator)   | → ~650 + `session-turn-runner.ts` (~400)                                        | M      | Medium — SIGINT + stream ordering           |
| 8   | `libs/api/community/.../session-requests.service.ts` | 1 080 | facade (extract collaborator)   | → ~780 + `session-calendar-coordinator.ts` (~290)                               | L      | High — distributed-transaction compensation |

**No file in this partition is fully EXEMPT.** `rpc.types.ts` earns a _partial_
exemption (stated below), which is the closest thing here to an honest "leave it".

---

## 1. `apps/ptah-cli/src/cli/router.ts` — 3 249 LOC

### Classification

**Command-group split.** Not a facade (nothing has a DI token), not a layering
fix (there is no layer violation).

### Verdict

The brief asked whether this is a table with thin dispatch or a table with
implementations inlined. It is emphatically **the former**, and I measured it
rather than eyeballing it:

| Marker                                                                 | Count                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.command(`                                                            | 213                                                                 |
| `.action(`                                                             | 173                                                                 |
| `Cmd.execute(`                                                         | 169                                                                 |
| `process.exitCode = exit;`                                             | 172                                                                 |
| `withEngine` / `container` / `console.` / `throw new` / `await import` | **0 each**                                                          |
| `try {`                                                                | 1 (in `createRequireSafely`, line 126 — a pre-`buildRouter` helper) |

Every action body is the same four-line shape (`router.ts:1057-1063`,
`1096-1102`, `842-852` are representative):

```ts
.action(async (opts: { provider: string }) => {
  const exit = await providerCmd.execute(
    { subcommand: 'remove-key', provider: opts.provider },
    resolveGlobals(program),
  );
  process.exitCode = exit;
});
```

So the concern it mixes is **not** "declaration + implementation". It is
**24 unrelated command vocabularies in one function**. `buildRouter` spans
`router.ts:158-3248` — a single 3 090-line function body — and imports 36
sibling modules from `./commands/`.

**`router.ts` is failing to use the `commands/` convention, and it is failing in
a specific, diagnosable way**: the convention covers the _execute_ half only.
`commands/provider.ts` owns what `provider set-key` _does_; the flags, the
descriptions, the arg types and the required/optional shape of `provider set-key`
live at `router.ts:1065-1090`, ~1 200 lines from the top of a file that has
nothing else to do with providers. Changing a flag means editing two files that
share no directory and no naming relationship. The `commands/` folder proves the
team already accepts per-group modules; the declaration half simply never
followed.

The 24 groups and their extents:

| Group                  | Lines   | Group                                                    | Lines |
| ---------------------- | ------- | -------------------------------------------------------- | ----- |
| `config` 222–384       | 163     | `git` 1902–2034                                          | 133   |
| `harness` 385–567      | 183     | `license` 2035–2074                                      | 40    |
| `agent` 568–631        | 64      | `websearch` 2075–2165                                    | 91    |
| `agent-cli` 632–735    | 104     | `settings` 2166–2202                                     | 37    |
| `run` 736–751          | 16      | `quality` 2203–2254                                      | 52    |
| `execute-spec` 752–774 | 23      | `session` 2255–2415                                      | 161   |
| `spec` 775–953         | 179     | `wizard`+`setup`/`analyze`/`doctor`/`diagnose` 2416–2554 | 139   |
| `auth` 954–1047        | 94      | `proxy`+`tui`/`interact`/`mcp-serve` 2555–2710           | 156   |
| `provider` 1048–1451   | **404** | `memory` 2711–2814                                       | 104   |
| `workspace` 1452–1508  | 57      | `cron` 2815–2990                                         | 176   |
| `skill` 1509–1615      | 107     | `gateway` 2991–3156                                      | 166   |
| `mcp` 1616–1706        | 91      | `skillSynthesis` 3157–3248                               | 92    |
| `plugin` 1707–1817     | 111     | `prompts` 1818–1901                                      | 84    |

### Proposed cut

**Not 24 registrars.** Per-group files would average 129 lines, 15 of the 24
under 150 — textbook fragment sprawl and a direct guardrail-2/4 violation. Group
them into **7 registrars named after real product surfaces**, each 309–538 lines:

New folder `apps/ptah-cli/src/cli/router/`:

| New file                           | Owns                                                                             | ≈LOC |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---- |
| `register-setup-commands.ts`       | `init`, `wizard`, `setup`, `analyze`, `doctor`, `diagnose`, `config`, `settings` | 350  |
| `register-credential-commands.ts`  | `auth`, `provider`, `license`                                                    | 538  |
| `register-harness-commands.ts`     | `harness`, `agent`, `agent-cli`, `prompts`                                       | 435  |
| `register-marketplace-commands.ts` | `skill`, `plugin`, `mcp`                                                         | 309  |
| `register-session-commands.ts`     | `run`, `execute-spec`, `session`, `interact`, `tui`, `mcp-serve`, `proxy`        | 356  |
| `register-thoth-commands.ts`       | `memory`, `cron`, `gateway`, `skill-synthesis`                                   | 538  |
| `register-workspace-commands.ts`   | `spec`, `git`, `workspace`, `quality`, `websearch`                               | 512  |

`register-thoth-commands.ts` is the strongest name in the set — those four groups
are exactly the four tabs of `libs/frontend/thoth-shell` (Memory / Skills / Cron
/ Gateway). `register-marketplace-commands.ts` mirrors
`libs/frontend/marketplace` ("Plugins / Smithery / OAuth"). Every name is a
noun phrase; none is `helpers`/`utils`/`common`.

Each exports one function:

```ts
export function registerCredentialCommands(program: Command): void {
  /* verbatim */
}
```

**A required companion move — do not skip it.** Registrars need `resolveGlobals`,
which lives in `router.ts:86-99`. Importing it from `router.ts` while `router.ts`
imports the registrars creates a module cycle. Extract
`apps/ptah-cli/src/cli/global-options.ts` holding `GlobalOptions`,
`RawProgramOptions`, `resolveGlobals`, `collectCsv`, `parseBoolFlag` (~80 lines),
and have `router.ts` **re-export `GlobalOptions`** so the ~36 command modules that
do `import type { GlobalOptions } from '../router.js'` (confirmed in
`commands/provider.ts` and `commands/session.ts`) need no edit. This file is
under 150 lines _by necessity_ — it exists to break a cycle, not to satisfy a
ceiling, so guardrail 2 does not bite.

`router.ts` ends at **~210 lines**: package-version helpers, global `Option`
declarations (`162-210`), and a `buildRouter` that calls seven registrars.

### Risk

- **Help-output ordering.** Commander lists subcommands in declaration order.
  Call the registrars in the original group order or `ptah --help` reorders.
  Three specs touch this surface: `apps/ptah-cli/src/smoke.spec.ts`,
  `apps/ptah-cli/src/cli/commands/harness.spec.ts`,
  `apps/ptah-cli/tests/e2e/bootstrap.e2e.spec.ts`.
- **Cycle** if `resolveGlobals` is not relocated (above).
- Per `apps/ptah-cli/CLAUDE.md`: rebuild with `--skip-nx-cache` before trusting
  any e2e run, or `restore-cli-manifest` serves a stale bundle.

### Effort

**M — behaviour-preserving.** Large but mechanical: 24 verbatim block moves plus
import lists. No action body is edited.

---

## 2. `libs/api/email/src/lib/services/email.service.ts` — 1 019 LOC

### Classification

**Facade — the 256 template.** `EmailService` keeps its name, its Nest provider
token and all nine public `sendX` signatures.

### Verdict

Three concerns, and one of them is more than half the file:

1. **Send orchestration** — `sendLicenseKey`, `sendCustomEmail`,
   `sendWaitlistConfirmation`, `sendFoundingCohortWelcome`,
   `sendBuildersSessionWelcome`, `sendMagicLink`, `sendContactMessage`,
   `sendSessionRequestNotification`, `sendSessionConfirmation` (~200 lines).
2. **Transport resilience** — `sendWithRetry` (259–298), `sleep` (306–308).
3. **HTML template rendering** — eight `getXTemplate` methods:
   `getLicenseKeyTemplate` (317–393), `getMagicLinkTemplate` (402–454),
   `getBuildersSessionWelcomeTemplate` (565–640),
   `getWaitlistConfirmationTemplate` (642–687),
   `getFoundingCohortWelcomeTemplate` (713–806),
   `getContactMessageTemplate` (808–853),
   `getSessionRequestNotificationTemplate` (855–907),
   `getSessionConfirmationTemplate` (909–974) — **511 lines of inline HTML
   string literals** — plus `formatUtc` (986–1001) and `escapeHtml` (1011–1018),
   which are already module-level functions used only from templates
   (`email.service.ts:578-585`).

A Nest service that injects `ConfigService` and `RESEND_MAIL_SERVICE` has no
business also being the view layer. Marketing copy changes force a diff against
the file that owns retry semantics and provider wiring.

### Proposed cut

- **`libs/api/email/src/lib/templates/email-templates.ts`** (~560) — the eight
  `getXTemplate` bodies as exported pure functions (`renderLicenseKeyEmail`,
  `renderMagicLinkEmail`, …) plus `formatUtc` and `escapeHtml`, which are already
  private module functions and simply move with their only callers.
- **`email.service.ts`** (~475) — send orchestration + `sendWithRetry` + `sleep`,
  importing the renderers.

Plain exported functions rather than a second Nest provider: the templates are
pure, take no config, and adding a provider would add a constructor param for no
benefit (guardrail 3).

### Risk

Near zero. The `getXTemplate` methods are private, take only their params, and
touch no `this`. Verify with `nx test ptah-license-server` and one rendered-HTML
snapshot if any spec asserts template output. **Isolation rule is respected** —
this is entirely inside `libs/api/email`; nothing crosses into
`libs/backend/**` or `libs/frontend/**`.

### Effort

**S — behaviour-preserving.** The best value-per-hour item in the partition
after the router.

---

## 3. `libs/shared/src/lib/types/rpc.types.ts` — 3 589 LOC

### Classification

**Type-barrel split — but a bounded one.** Partly EXEMPT, partly not.

### Verdict: SPLIT (1 148 lines), then EXEMPT the remainder

`context.md` flagged this as the likely exemption. **That is half right, and the
half that is wrong is the more interesting half.** The file is not one flat union
list. It has five distinct regions:

| Lines         | ≈LOC      | Region                                                                                                | Judgement                    |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 11–34         | 24        | 19 × `export *` from `./rpc/*`                                                                        | Legitimate barrel            |
| 36–561        | 526       | `import type { … }` re-importing the same symbols                                                     | Ceremony the registry forces |
| 578–1996      | 1 419     | `RpcMethodRegistry` — ~470 method entries                                                             | Legitimate; see below        |
| **1998–3145** | **1 148** | **Inline domain types for four namespaces**                                                           | **The defect**               |
| 3152–3589     | 438       | `RPC_METHOD_ENTRIES` runtime const + `RPC_METHOD_NAMES` + drift assertions + `RpcMethodParams/Result` | Legitimate; see below        |

**The defect.** The file's own header (`rpc.types.ts:7-8`) states the rule:
_"Domain-specific types are split into child files under `./rpc/` for
maintainability. This barrel re-exports all child types and contains the central
`RpcMethodRegistry`."_ Twenty-three namespaces obey it. Four do not, and they sit
inline between the registry and the entries map:

| Domain                                                                    | Lines     | ≈LOC |
| ------------------------------------------------------------------------- | --------- | ---- |
| Skill-synthesis (judge, candidates, queue, digest, settings, suggestions) | 1998–2616 | 619  |
| Gateway (bindings, messages, Discord, allow-list)                         | 2617–2823 | 207  |
| Voice (transcribe, TTS, providers, models)                                | 2824–3033 | 210  |
| Cron (`ScheduledJobDto`, `JobRunDto`, list/get/create/…/nextFire)         | 3034–3145 | 112  |

This is not "it is long". It is **an inconsistency**: a reader looking for
`GatewayBindingDto` checks `rpc/rpc-gateway.types.ts`, finds no such file, and
concludes gateway has no wire contract. Meanwhile `rpc/rpc-skill-clone.types.ts`
(245 lines) exists while the _other_ half of the skill-synthesis contract is
inline — the same namespace split across two conventions.

Nameability is trivially satisfied: the four names are dictated by 23 siblings.

**Consumption is 100 % barrel — the split is free.** `grep -rn "types/rpc.types"`
across `libs` and `apps`, excluding `libs/shared/src`, returns **zero hits**.
Everything reaches these types through `export * from './lib/types/rpc.types'`
(`libs/shared/src/index.ts:16`). No consumer import changes. This is the single
strongest argument for doing it: the split has literally no blast radius outside
`libs/shared/src/lib/types/`.

**Why the rest is genuinely exempt.**

- _`RpcMethodRegistry` (1 419 lines)_ is one exhaustive interface mapping every
  wire method to `{ params; result }`. Splitting it into 24 per-domain
  interfaces composed by intersection yields fragments averaging 59 lines —
  guardrail 2 and 4 violated at once. Merging the slices into the existing
  `rpc/rpc-*.types.ts` files is the only non-sprawling variant, and it spreads
  the wire alphabet across 23 files for no navigational gain: nobody reads the
  registry, they `Ctrl-F` one method name in it.
- _`RPC_METHOD_ENTRIES` + drift assertions (438 lines)_ is deliberate machinery,
  and the file documents why (`rpc.types.ts:3152-3167`): typed as
  `Record<RpcMethodName, true>`, it makes adding a registry key without adding
  an entry **a compile error that points at one site**. Moving it away from the
  registry it guards would be a regression in that guarantee.

So: extract the four stragglers, leave ~2 555 lines, and record the exemption.

### On the dual-registration rule

Splitting **does not disturb it, and marginally helps**. The runtime half lives
at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:40` —
`ALLOWED_METHOD_PREFIXES`, which is **prefix-based**, not method-based
(`'gateway:'`, `'voice:'`, `'cron:'`, `'skillSynthesis:'` are all already
present, lines 73–79). It changes only when a _new namespace_ is born, not when a
method is added. After the split, a new namespace means: create
`rpc/rpc-<ns>.types.ts`, add one `export *`, add registry entries, add entries-map
keys, add one prefix. The first step becomes an obvious, conventional file
creation instead of "find somewhere in a 3 589-line file to paste 200 lines" —
which is precisely how the four stragglers happened. The pairing gets _easier_ to
keep straight, not harder.

### Proposed cut

| File                               | Content                                                 | ≈LOC       |
| ---------------------------------- | ------------------------------------------------------- | ---------- |
| `rpc/rpc-skill-synthesis.types.ts` | lines 1998–2616 (+ the `SkillDrainTier` import)         | 630        |
| `rpc/rpc-gateway.types.ts`         | lines 2617–2823                                         | 207        |
| `rpc/rpc-voice.types.ts`           | lines 2824–3033                                         | 210        |
| `rpc/rpc-cron.types.ts`            | lines 3034–3145                                         | 112        |
| `rpc.types.ts`                     | remainder + 4 `export *` + ~100 new `import type` lines | **~2 555** |

**Honest caveat on the arithmetic.** Net reduction is **~1 034, not 1 148**. The
registry must now `import type` roughly 100 symbol names it previously had in
local scope. The barrel already spends 526 lines on exactly this ceremony
(`rpc.types.ts:36-561`); this adds ~110 more. Worth stating up front so the
result does not look like a shortfall.

`rpc-cron.types.ts` at 112 lines is under the 150 guardrail. It is **not** a
ceiling-driven fragment: `rpc/` already contains `rpc-mem.types.ts` (107),
`rpc-corpus.types.ts` (130), `rpc-config.types.ts` (86), `rpc-editor.types.ts`
(61), `rpc-terminal.types.ts` (43), `rpc-update.types.ts` (26) and
`rpc-error-codes.types.ts` (18). A 112-line file is squarely the folder norm;
the guardrail exception is convention alignment, and should be recorded as such.

### Risk

Very low, and bounded to one folder.

- Zero deep imports → zero consumer churn (measured, above).
- Types only; the one runtime export (`RPC_METHOD_NAMES`) does not move.
- Watch for **name collisions** on `export *`: if any moved symbol name already
  exists in another `rpc/*` module the barrel silently drops the ambiguous
  export. `tsc` catches this; `npm run typecheck:all` is the gate.
- `libs/shared` must import nothing from another `@ptah-extension/*`
  (`libs/shared/CLAUDE.md` §Dependencies). The four new files import only
  `../constants/skill-drain.constants` — internal, so the foundation-layer rule
  holds. Note `rpc.types.ts:2001-2005` already documents that
  `SkillJudgeStatusDto` is a hand-copied mirror of a backend type _precisely
  because_ shared may not import a backend lib; that comment must travel with
  the type.
- `libs/shared/src/index.ts` needs no edit — the four new modules reach it
  transitively via `rpc.types.ts`, exactly as the other 19 do.

### Effort

**S — behaviour-preserving.** Four contiguous block moves, four `export *` lines,
one import block extension.

---

## 4. `apps/ptah-cli/src/cli/commands/provider.ts` — 1 239 LOC

### Classification

**Facade — extract a collaborator.** `execute()` keeps its signature; the router
(`router.ts:1058`) is untouched.

### Verdict

`execute` (180–223) dispatches nine subcommands. Eight are thin RPC wrappers
(`runStatus` 19 lines, `runRemoveKey` 34, `runModels` 39, `runDefault` 66,
`runTier` 86, `runSetKey` 68, `runBaseUrl` 96, `runOllama` 85). The ninth,
`provider custom`, is **476 lines and a different kind of program**.

The file has already drawn the line itself. `provider.ts:747-749`:

```
// ---------------------------------------------------------------------------
// `provider custom …` — user-defined provider entries
// ---------------------------------------------------------------------------
```

Everything from 747 to 1222 belongs to it: `defaultIsInteractive`,
`trimOrUndefined`, `CustomEntryChanges`, `ParseResult<T>`, `parseLane`,
`parseAuthEnvVar`, `parseTiers`, `parsePricing`, `formatEntryIssues`,
`resolveCustomAddInput` (901–1017 — **117 lines of `@clack/prompts` interactive
wizard**), `resolveCustomUpdateChanges`, and `runCustom` (1064–1217).

The mixed concerns are sharp: this is the **only** part of the file that talks to
a human. `@clack/prompts` is imported for it alone, `CUSTOM_CANCEL_EXIT_CODE`
(130, the SIGINT convention) exists for it alone, and `defaultIsInteractive`
encodes the machine-mode contract from `apps/ptah-cli/CLAUDE.md` ("in machine
mode it never prompts"). A file whose other 750 lines are strictly
non-interactive RPC forwarding should not also host a TTY wizard.

### Proposed cut

- **`commands/provider-custom-entry.ts`** (~510) — lines 747–1222 plus its own
  imports (`clack`, `CustomProviderEntry`, `CustomProviderLane`,
  `CUSTOM_PROVIDER_LANES`, `CustomProviderEntrySchema`, `suggestClosest`,
  `Formatter`, `ExitCode`, `GlobalOptions`, `CliMessageTransport`). Exports
  `runCustom`.
- **`commands/provider.ts`** (~753) — dispatch + the eight RPC subcommands.

**Optional second cut**, if 753 (still above the 700 warn) is unacceptable:
`commands/provider-endpoint.ts` (~200) taking `runBaseUrl` (332–427) and
`runOllama` (431–515) — both answer "where does this provider live", one via an
explicit base-URL override and one via Ollama Cloud onboarding. That lands
`provider.ts` at **~560**. I would do the first cut unconditionally and treat the
second as a judgement call: two collaborators is comfortably inside guardrail 4,
three is still fine.

### Risk

Low. `callRpc` (1224–1238) is used by both halves — duplicate it into the new
file or export it; note `commands/session.ts:995-1009` already carries its own
copy, so a per-file `callRpc` is the established pattern here, not a smell to fix
in this task. `GlobalOptions` continues to come from `../router.js`. Covered by
`apps/ptah-cli/src/cli/commands/provider*.spec.ts` and the `provider` e2e paths;
the slot-unification invariant in `apps/ptah-cli/CLAUDE.md` lives in `runSetKey`,
which does not move.

### Effort

**S–M — behaviour-preserving.** One banner-fenced block move.

---

## 5. `libs/api/learning/src/lib/courses/courses.service.ts` — 1 118 LOC

### Classification

**Layering fix.** Specifically: the controller layer is already split by entity;
the service layer is not.

### Verdict

`CoursesService` spans 91–871 (780 lines) and carries three entity lifecycles
plus their translation machinery:

- **Course**: `listForAdmin`, `getForAdmin`, `createCourse`, `updateCourse`,
  `setPublished`, `deleteCourse`, `restoreCourse`, `hydrateCourse`,
  `requireLiveCourse`, `assertCohortKeysExist`, `resolveCohortNames`
- **Module**: `createModule` (433–478), `updateModule` (489–513),
  `deleteModule` (516–535), `countLessons` (783–785), `requireLiveModule`
  (823–833), `toAdminCourseModule` (960–977) — ≈145 lines
- **Lesson**: `createLesson` (562–620), `updateLesson` (650–677), `deleteLesson`
  (680–699), `countComments` (787–792), `requireLiveLesson` (836–850),
  `toAdminLesson` (980–1010) — ≈230 lines
- **Translation**: `withMappedPrismaErrors` (864–870), `mapPrismaError`
  (884–909), and the three `toAdmin*` mappers — 130 lines, already module-level
  and already exported

**The seam is pre-drawn and I did not have to invent it.** Two separate
controllers already exist and both reach into the one service:

- `courses/admin-course-modules.controller.ts:126,309` → `this.courses.createModule`, `updateModule`
- `courses/admin-lessons.controller.ts:141,322` → `this.courses.createLesson`, `deleteLesson`

The HTTP layer has already decided these are three resources. The service layer
is the only place that still pretends they are one. That is the layering defect —
not the line count.

Note this service _is_ the db-service layer (direct Prisma via `PrismaService`),
which is consistent across `libs/api/learning`; the mixing is horizontal
(three entities), not vertical.

### Proposed cut

- **`courses/course-modules.service.ts`** (~180) — the module lifecycle +
  `countLessons`, `requireLiveModule`, `toAdminCourseModule`. Injected by
  `admin-course-modules.controller.ts` instead of `CoursesService`.
- **`courses/course-lessons.service.ts`** (~250) — the lesson lifecycle +
  `countComments`, `requireLiveLesson`, `toAdminLesson`. Injected by
  `admin-lessons.controller.ts`.
- **`common/prisma-errors.ts`** (~45) — `mapPrismaError` + `withMappedPrismaErrors`,
  needed by all three services. Without this the two new services would import
  from `courses.service.ts` while `CoursesService` is unaware of them — a cycle
  waiting to happen the moment a facade is added.
- **`courses.service.ts`** (~700) — course lifecycle, cohort resolution,
  hydration, `toAdminCourse`.

**No facade needed**, which is why this is cheaper than it looks: callers are
already segregated by controller, so each controller simply injects the service
that matches it. `CoursesService` keeps its token and its course-facing API
unchanged.

`course-modules.service.ts` at ~180 clears the guardrail. `common/prisma-errors.ts`
at ~45 does not, but `common/` is explicitly a home for small focused modules —
`optional-field.ts` is 12 lines, `member-context.ts` 57, `sort-order.ts` 100,
`soft-delete.ts` 140. It fits the folder, and it exists to break a dependency
knot rather than to hit a number.

### Risk

Low, but higher than #2–#4 because Nest module wiring and two controllers change.

- Register both new services as providers in the learning module and update the
  two controllers' constructors.
- Transaction boundaries: `requireLiveModule`/`requireLiveLesson` take a `tx`
  and are called inside `$transaction` blocks. They move with their owners; a
  module-scoped lesson operation that currently shares one transaction with a
  course operation must be re-checked — inspect `createLesson` (562–620) and
  `createModule` (433–478) for cross-entity writes before moving.
- **Isolation rule holds**: everything stays inside `libs/api/learning` and
  `@ptah-contracts/community`. No `libs/backend/**` or `libs/frontend/**` import
  is introduced or needed.

### Effort

**M — behaviour-preserving** provided the transaction check above comes back
clean; otherwise M with a behavioural review on the transaction boundary.

---

## 6. `libs/web/pricing/src/lib/components/pricing-grid.component.ts` — 1 140 LOC

### Classification

**Component split** — child component + extracted coordinator. Per `context.md`,
Angular components take child components, not facades.

### Verdict

Layout: imports 1–69, `@Component` 70, **inline template 80–410 (331 lines)**,
`styles` 411–~477 (~66), class 479–1139 (**660**).

It is the largest component in `libs/web` by a wide margin — next is
`ui/navigation.component.ts` at 944, then a cliff to 653.

Inline templates are the universal convention here (51 inline, **0**
`templateUrl` across `libs/web`), so "move the template to an HTML file" is the
wrong recommendation — it would make this the only file of its kind.

The class mixes six concerns, and two of them are not presentation:

1. **Presentation** — `getCardAnimationConfig`, GSAP viewport config, promo-code
   input (`togglePromoInput`, `onPromoCodeChange`, `clearPromoCode`),
   `downloadFree`, `onBuildersCta`, `dismissValidationError`.
2. **Paddle checkout orchestration** — `triggerAutoCheckout` (848–890),
   `proceedWithCheckout` (1010–1058), `handleCtaClick` (951–990),
   `retryPaddleInit`, `clearLoadingTimeout`, `clearAutoCheckoutInterval`,
   `onWindowFocus` (613–621), the `ngOnInit` query-param auto-checkout wiring
   (789–816), and `validateSubscriptionStatus` (577–590).
3. **Billing-portal HTTP** — `handleManageSubscription` (1089–1110),
   `openPortalSession` (1115–1138), which inject and use **`HttpClient` directly
   in a component** (line 504) even though `@ptah-web/core` is the lib's API-service
   layer. That is a layering smell independent of length.

**Guardrail 3 is already breached.** The component holds **9 `inject()` calls**
(`pricing-grid.component.ts:499-513`): `Router`, `ActivatedRoute`,
`PaddleCheckoutService`, `AuthService`, `SubscriptionStateService`, `HttpClient`,
`DestroyRef`, `PADDLE_CONFIG`, `BUILDERS_CHECKOUT_ENABLED` — plus `PLATFORM_ID`.
`context.md` calls ~8 injected dependencies the real gate; this file is over it
_today_, before any refactor.

### Proposed cut

- **`components/plan-card.component.ts`** (~280) — one plan card: the repeated
  card block from the template plus the CTA state it already delegates to
  `utils/plan-card-state.utils` (`computeCtaVariant`, `computeCtaText`,
  `computeCtaButtonClass`, `isPortalAction` — already imported) and
  `getCardAnimationConfig`. Inputs: `plan: PricingPlan`,
  `context: PlanSubscriptionContext`, `index: number`. Output: `ctaClick`.
  `OnPush`, inline template, matching the lib convention.
- **`services/pricing-checkout.service.ts`** (~300) — auto-checkout interval and
  window-focus rehydration, `proceedWithCheckout`, `retryPaddleInit`, portal
  session HTTP, `validateSubscriptionStatus`. Takes `HttpClient`,
  `PaddleCheckoutService`, `AuthService`, `SubscriptionStateService`, `Router`,
  `PADDLE_CONFIG` — moving six injections off the component and putting the raw
  `HttpClient` behind a service, where `libs/web` already puts its API calls.
- **`pricing-grid.component.ts`** (~500) — grid layout, promo-code input, free
  download, builders CTA, `ngOnInit` query-param read delegating to the
  coordinator. Injections drop from 9 to ~4.

Three files, none under 150, none over 700; the component's dependency count
returns inside the guardrail.

### Risk

**Medium — the only item in this partition needing visual review.** Extracting a
child component moves Tailwind/daisyui class strings and `NgClass` bindings
across a boundary; GSAP `ViewportAnimationDirective` triggers are per-element and
must land on the right node or the scroll reveal silently stops. `OnPush` +
signals means input identity matters. `libs/web/pricing` is consumed only by
`apps/ptah-landing-page`; check `apps/ptah-landing-page-e2e` for pricing specs
before and after. **Isolation rule holds** — no `libs/frontend/**` import is
introduced (`@ptah-web/ui` and `@ptah-web/core` only).

### Effort

**M — behaviour-preserving in logic, needs visual review** for the template
split.

---

## 7. `apps/ptah-cli/src/cli/commands/session.ts` — 1 010 LOC

### Classification

**Facade — extract a collaborator.** `execute` and `executeSessionStart` keep
their signatures.

### Verdict

Two clearly different programs share the file:

- **Live turn semantics** (~370 lines): `runStart` (293–397), `runResume`
  (399–472), `runSend` (474–534), `runStreamingTurn` (556–648) with its nested
  `onSigint` (615–620), `makeFormatterNotifyShim` (659–684). This half owns
  `ChatBridge`, `ApprovalBridge`, `ISdkPermissionHandler`, `SdkInitFailedError`,
  `emitFatalError`, SIGINT handling, and live NDJSON emission.
- **Session-registry CRUD** (~300 lines): `runList` (686–742), `runStop`,
  `runDelete`, `runRename`, `runLoad`, `runStats`, `runValidate` (946–985) —
  each a straightforward RPC round-trip against the session store.

They share only `callRpc`, `parseCsv`, and the four persistence helpers
(`storageKey`, `loadPersistedSession`, `persistSession`, `deletePersistedSession`,
268–291) — `deletePersistedSession` is used by both `runStart`-family and
`runDelete`, so those stay put.

The mixing matters because the streaming half is where every hard CLI invariant
in `apps/ptah-cli/CLAUDE.md` lives — stdout drain before exit, the 5-minute
approval timeout to exit code 3, `PTAH_AUTO_APPROVE`. Those invariants are
interleaved with `runRename`.

### Proposed cut

- **`commands/session-turn-runner.ts`** (~400) — `runStart`, `runResume`,
  `runSend`, `runStreamingTurn`, `onSigint`, `makeFormatterNotifyShim`, plus the
  bridge/permission imports.
- **`commands/session.ts`** (~650) — dispatch, persistence helpers, and the seven
  registry operations.

Two collaborators; both well clear of 150.

### Risk

**Medium.** SIGINT registration/teardown and stdout-drain ordering are exactly
what must not shift, and they cross the proposed boundary (`onSigint` is nested
inside `runStreamingTurn`, so it travels intact — verify no listener is
registered on the old module's scope). Covered by
`apps/ptah-cli/tests/e2e/**` and the `e2e-pty` suite; rebuild with
`--skip-nx-cache` first.

### Effort

**M — needs behavioural review** of the streaming/SIGINT path, not merely a
typecheck.

---

## 8. `libs/api/community/src/lib/google-sessions/session-requests.service.ts` — 1 080 LOC

### Classification

**Facade — extract a collaborator.** Real seam, worst value-for-effort in the
partition.

### Verdict

`SessionRequestsService` spans 123–813. Concerns:

1. **Member-facing** — `listOwn` (148–154), `submit` (164–183), `cancelOwn`
   (202–227). ~90 lines.
2. **Admin queue** — `listQueue` (245–252), `accept` (302–422, **120 lines**),
   `reschedule` (444–528, 84), `decline` (552–625, 73). ~280 lines.
3. **Google Calendar orchestration and compensation** — `compensate` (640–662),
   `eventBodyOf` (875–877), `eventIdOf` (880–883), `isDeleteSettled` (892–894),
   and the ten exported failure constants (`SCHEDULING_UNAVAILABLE`,
   `CALENDAR_EVENT_FAILED`, `MEET_LINK_UNRESOLVED`,
   `CALENDAR_EVENT_ALREADY_CLAIMED`, `CALENDAR_EVENT_MISSING`, …).
4. **Notifications** — `notifyOwner` (687–719).
5. **Guards + translation** — `requirePending`, `requireScheduled`, `requireOpen`,
   `readWithRequester`, `withMappedPrismaErrors`, `mapPrismaError`,
   `toMemberSessionRequest`, `toAdminSessionRequest`. ~200 lines.

The buried role is concern 3: this service runs a **two-phase operation across a
database transaction and an external API**, with hand-rolled compensation when
the halves disagree. `accept` at 120 lines is long precisely because it
interleaves "write the row" with "create the calendar event" and "if the DB half
fails, delete the event we just created". That is a distinct, nameable
responsibility — `SessionCalendarCoordinator`, owning "create/move/delete the
event and compensate", returning a typed outcome the caller branches on.

Three injected dependencies today (`PrismaService`, `GoogleCalendarProvider`,
`NotificationsService`); extraction would leave two on the service and give the
coordinator one. Guardrail 3 is comfortable either way.

### Proposed cut

- **`google-sessions/session-calendar-coordinator.ts`** (~290) — `compensate`,
  `eventBodyOf`, `eventIdOf`, `isDeleteSettled`, the calendar-failure constants,
  and one method per shape (`createEventFor`, `moveEventFor`, `cancelEventFor`)
  returning a discriminated result.
- **`session-requests.service.ts`** (~780) — member ops, admin queue ops reduced
  to DB work plus coordinator calls, guards, notifications, mappers.

Even after the cut the service stays above the 700 warn. That is part of why it
ranks last: maximum care for a result that does not clear the ceiling anyway.

### Risk

**High — the highest in the partition, and the reason this is ranked 8th rather
than 3rd.** Compensation ordering is the whole point of the code: if the
`create-event → write-row → on-failure-delete-event` sequence is perturbed, the
failure mode is an orphaned calendar invite sent to a real member, and it will
not show up in a typecheck or a happy-path test. `accept`'s
`CALENDAR_EVENT_ALREADY_CLAIMED` path implies concurrent-claim handling that must
be reasoned about, not moved. Any execution needs its own task with explicit
before/after tracing of every `GoogleApiResult` branch.

**Isolation rule holds** — imports stay within `@ptah-api/*` and
`@ptah-contracts/community`.

### Effort

**L — requires behavioural review**, not behaviour-preserving on inspection
alone.

---

## Cross-cutting notes

- **Isolation rules respected throughout.** No proposal in this survey has
  `libs/api/**` or `libs/web/**` importing `libs/backend/**` or
  `libs/frontend/**`; every api/web cut stays inside its own lib or reaches
  `@ptah-contracts/community`. No proposal has `libs/shared` importing another
  `@ptah-extension/*` lib.
- **The `commands/` convention (ptah-cli) is the recurring lesson.** Items #1, #4
  and #7 are all the same story: a convention exists, and the largest files are
  the ones that did not follow it. The 700-line `max-lines` warning would have
  caught all three at roughly half their current size.
- **`rpc.types.ts` is the case for keeping the rule a WARNING.** After the
  recommended cut it still sits at ~2 555 lines and should stay there. A file can
  be correct and enormous; the survey's job was to say which, and this is the one.
