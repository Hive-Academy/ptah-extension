# Code Style Review — `TASK_2026_437_0778` Batch 17b

## Summary

| Metric          | Value                               |
| --------------- | ----------------------------------- |
| Overall score   | 7/10                                |
| Assessment      | NEEDS_REVISION                      |
| Blocking issues | 0                                   |
| Serious issues  | 2                                   |
| Minor issues    | 3                                   |
| Files reviewed  | 17 (8 production, 9 spec/CLAUDE.md) |

Scope: origin-aware skill re-propagation (FU-17b). skill-synthesis
`skill-repropagation.port.ts`, `skill-promotion.service.ts`,
`skill-enhancer.service.ts` (+ specs for `skill-curator.service.ts`,
`skill-invocation-tracker.ts`, `skill-promotion.repropagation.spec.ts`);
rpc-handlers `skills-synthesis-rpc.handlers.ts` (+ spec); harness-sync
`sources/user-layer-refresher.port.ts`, `propagation/harness-propagation.service.ts`
(+ spec); apps/ptah-electron `activation/skill-repropagation.ts` (+ spec),
`activation/plugin-activation.ts` (+ spec), `CLAUDE.md`. Read-only; no nx/test
run; `eslint`/`prettier --check` not separately invoked in this pass (repo-wide
run was out of scope for a diff-only review; spot-checked formatting by eye,
found clean). Cross-checked against `b17-code-style-review.md` (the four
`whenClear` adopters and `GOVERNED_USER_LAYER_REASONS`) and
`b16b-code-style-review.md` (the `QueryOrigin` positional-param precedent this
batch extends).

## Five style questions

### 1. What breaks in six months?

`libs/backend/harness-sync/CLAUDE.md` documents every `HarnessPropagateOptions`
field that exists today — `skipUserLayerRefresh` (`:581`, `:705`), `mode`/`targets`
(`:1178`) — each with its own caller and reasoning, but this batch adds
`userLayerRefreshReason` to that same interface
(`libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts:68-77`)
without touching the file. A future engineer who reads this lib's own CLAUDE.md
before adding a second background-scheduled emit site (there is already a stated
intent for more — `apps/ptah-electron/CLAUDE.md`'s "whenClear adopters" bullet
calls this a growing list) will not learn the option exists at the layer that
actually implements it; they will only find it by reading `apps/ptah-electron`'s
CLAUDE.md, which happens to be Electron-specific even though the field lives on
a runtime-agnostic port. A CLI or VS Code host adding its own governed label six
months out has no lib-level doc telling it the mechanism is there to reuse.

### 2. What would a new team member misread?

`libs/backend/cli-engine/src/lib/thoth/cli-skill-repropagation.ts:36-40`: the
CLI's `repropagate(kind, slug, workspaceRoot)` compiles against
`SkillRepropagationPort` (now four params, the fourth optional) with no `origin`
parameter at all, silently accepting TypeScript's "an implementation may omit a
trailing optional parameter" rule. A reader who has just read
`ElectronSkillRepropagation.repropagate(kind, slug, workspaceRoot, origin: QueryOrigin = {})`
two files over, with a full "Who waits" doc section, would reasonably assume
every implementation takes `origin` and that the CLI one was written before
FU-17b and simply missed the update — it was not; it is correct, because the
CLI has nothing to defer to (no governor is queried by
`CliSkillRepropagation.repropagate` and it never sets `userLayerRefreshReason`).
Nothing at the CLI call site says that on purpose.

### 3. What does this cost to maintain?

Low. The `origin` field itself is composed correctly this time —
`SkillRepropagationPort.repropagate`'s fourth parameter is
`origin?: QueryOrigin` (`skill-repropagation.port.ts:16`), not a re-declared
`userInitiated?: boolean`, which is exactly the fix Batch 16b's review asked for
in the sibling shapes (`b16b-code-style-review.md`'s "compose, don't
re-declare" finding). `SkillPromotionService.evaluate`'s `origin: QueryOrigin = {}`
and `SkillEnhancerService.applyProposal`/`revert`'s same trailing param match
the established positional-parameter idiom for both services exactly (Batch
16b's question 4 already validated this file-family's growth pattern). The one
recurring cost is documentation drift across three CLAUDE.md files that all
describe the same governed-reasons mechanism at different levels of freshness
(see questions 1 and 4).

### 4. Where is this inconsistent with the rest of the repository?

Two places. First, harness-sync's own `CLAUDE.md` is silent on
`userLayerRefreshReason` while `apps/ptah-electron/CLAUDE.md` and the code
comments at the port (`user-layer-refresher.port.ts:29-36`) and the service
(`harness-propagation.service.ts:68-77`) are fully documented — the lib that
owns the interface is the one CLAUDE.md that says nothing about the new field,
which is the opposite of the pattern this repo otherwise follows (a lib's
CLAUDE.md is the canonical description of its own public options, per
`skipUserLayerRefresh`'s treatment three lines above where the new field sits).
Second, the CLI adapter's un-declared fourth parameter is a real but silent
asymmetry against its sibling `ElectronSkillRepropagation`, whose constructor
signature, JSDoc and spec all treat `origin` as first-class. TypeScript permits
it (an interface's optional trailing parameter may be omitted by an
implementation), and the choice not to take `origin` is defensible on its
merits (Question 2) — but nothing at the call site records that it is a
choice rather than an oversight, unlike every other place in this batch where
a caller passing nothing for `origin` says so in a comment (e.g.
`skill-curator.service.spec.ts`'s "No origin: background, so the enhancer's
re-propagation may wait (FU-17b)").

### 5. What would you have done differently, and why is that better rather than merely other?

Two changes, both documentation/clarity only, no behaviour change. First, add
one line to `harness-sync/CLAUDE.md` beside the existing
`skipUserLayerRefresh` documentation (`:581` area, or the "What triggers a
pass" table) naming `userLayerRefreshReason` and its `GOVERNED_USER_LAYER_REASONS`
consumer, the same way `skipUserLayerRefresh` is documented there today — this
is the lib's own canonical option list and the omission is the one place this
batch's documentation discipline (otherwise excellent — three separate files
updated with matching, cross-referenced prose) actually breaks. Second, add
`origin?: QueryOrigin` to `CliSkillRepropagation.repropagate`'s signature (even
though it stays unused past a one-line comment — "the CLI has no
background-work governor to defer to") — this costs one line and turns a silent
omission a reader has to reconstruct from absence into a stated fact, matching
`ElectronSkillRepropagation`'s standard of explaining itself at the point of
divergence. Neither is required for correctness; both are one-line costs that
remove a real "is this a bug or a choice" question for the next reader.

## Blocking issues

None.

## Serious issues

### `harness-sync/CLAUDE.md` documents every sibling option except the one this batch adds

- File: `libs/backend/harness-sync/CLAUDE.md` (no changes in this diff);
  compare `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts:68-77`
  (`HarnessPropagateOptions.userLayerRefreshReason`, fully JSDoc'd) and
  `libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts:29-36`
  (`IUserLayerRefresher.refresh`'s new `reason` parameter, fully JSDoc'd).
- Problem: this CLAUDE.md is the one place the repo's own convention says a
  lib's public option surface is described (it already documents
  `skipUserLayerRefresh` with its one caller and its reasoning, `:581`, `:705`,
  and `mode`/`targets` at `:1178`). `userLayerRefreshReason` is a new,
  behaviourally significant sibling field on the exact same options interface
  (it changes whether a pass defers to the background-work governor) and the
  file was not touched. Both `apps/ptah-electron/CLAUDE.md` and two in-code
  JSDoc blocks describe it; the runtime-agnostic lib that owns the type does
  not.
- Impact: a future host (CLI, VS Code) or a future harness-sync maintainer
  reading this lib's own reference documentation to learn what
  `HarnessPropagationService.propagate`'s options do will not learn this option
  exists. Given `apps/ptah-electron/CLAUDE.md`'s own framing — "whenClear
  adopters" is an explicitly growing list — a second host adding its own
  governed label is a plausible near-term change, and it would have to
  reverse-engineer the mechanism from Electron's app-level doc rather than the
  lib's.
- Fix: add `userLayerRefreshReason` to `harness-sync/CLAUDE.md`'s documented
  option set, alongside `skipUserLayerRefresh`, naming what it does (labels the
  refresh so a host can choose to defer it) and that Electron is currently its
  only setter — mirroring the treatment `skipUserLayerRefresh` already gets.

### The CLI adapter's narrower signature is correct but says nothing about why

- File: `libs/backend/cli-engine/src/lib/thoth/cli-skill-repropagation.ts:36-40`
  (`repropagate(kind, slug, workspaceRoot)`, no `origin` parameter) vs.
  `apps/ptah-electron/src/activation/skill-repropagation.ts:57-61`
  (`repropagate(kind, slug, workspaceRoot, origin: QueryOrigin = {})`), both
  implementing `libs/backend/skill-synthesis/src/lib/skill-repropagation.port.ts`'s
  `repropagate(kind, slug, workspaceRoot, origin?: QueryOrigin)`.
- Problem: TypeScript structural typing allows an implementation to omit a
  trailing optional parameter, so this compiles and is not a type-safety gap —
  but it means the CLI adapter is the one production implementation of this
  port whose file contains zero words about `origin`, `QueryOrigin`, the
  background-work governor, or FU-17b, in a batch where every other
  touched file (the Electron adapter, both services, the RPC handler, four
  spec files) explicitly comments on why it does or does not pass `origin`.
  Silence here is the same shape as the "why does A read the allow-list
  directly and B call `gate.isGoverned`" finding Batch 16b flagged as a Minor
  (`b16b-code-style-review.md`'s `internal-query.service.ts:144` note) — the
  code is right, the reader has no way to tell that from the file alone.
- Tradeoff: leaving it as-is costs nothing today (the CLI genuinely has no
  governor to defer to, and a Batch 17 grep for `BackgroundWorkGovernor` /
  `whenClear` usage confirms no CLI adopter exists yet). The cost is
  forward-looking and narrow: the next person auditing "does every
  `SkillRepropagationPort` implementation forward `origin` correctly" (a
  reasonable audit the moment a third implementation appears, or the moment
  the CLI grows a background-work governor of its own) has to independently
  conclude the omission is deliberate rather than stale.
- Recommendation: add `origin?: QueryOrigin` to the CLI's signature (unused
  past acceptance) with a one-line comment — "the CLI has no background-work
  governor to defer to (TASK_2026_437 FU-17b); accepted for interface
  symmetry only" — so the file states its own choice instead of leaving it to
  be inferred from what is absent. Non-blocking: this is a documentation/
  clarity gap, not a defect, and the current code is correct.

## Minor issues

- `apps/ptah-electron/src/activation/plugin-activation.ts` is 760 lines, up
  from 742 pre-batch (net +18 from this diff) — already over the 700-line soft
  ceiling before this batch touched it (as `b17-code-style-review.md` and
  `b16b-code-style-review.md` both noted for `cli-engine/container.ts`'s
  identical situation). This batch's own diff is small (+24/-6) and none of it
  is a plausible split candidate on its own; flagging only because the file
  keeps growing past the ceiling one small batch at a time with no batch
  individually large enough to trigger a split. Worth a deliberate look at
  the next batch that touches this file, not this one.
- `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts:107-111`:
  the `if (options.userLayerRefreshReason === undefined) { ...refresh(cwd) } else { ...refresh(cwd, options.userLayerRefreshReason) }`
  branch could be a single `await this.refresher.refresh(cwd, options.userLayerRefreshReason)`
  call — `IUserLayerRefresher.refresh`'s second parameter is already `reason?: string`,
  and every implementation (Electron's, the CLI's structural no-op) already
  treats `undefined` as "no label." The two-branch form is explained in an
  inline comment ("No label → the one-argument call every refresher has always
  had") and is defensible as making the "nothing changes for existing callers"
  invariant visible at the call site rather than only in the port's contract,
  but it is not required by anything the port promises — a `refresh(cwd,
optionalArg)` call is behaviourally identical to `refresh(cwd)` when
  `optionalArg` is `undefined`. Low cost either way; noted because the
  branch reads as more defensive than the port's own contract requires.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:610-619`:
  `applyEnhancement`'s call to `applyProposal` now passes
  `{ userInitiated: options.userInitiated }` as a freshly-built object literal
  rather than composing `options` (which is itself already close to
  `QueryOrigin`-shaped) — a cosmetic echo of the "declare inline instead of
  compose" pattern Batch 16b's Serious finding covered for other files,
  but here it is a one-field pass-through at a single call site, not a type
  declaration repeated at eight sites, so the cost is materially smaller than
  the case that finding addressed. Noted for completeness, not filed as a
  repeat of that finding.

## File-by-file

### `libs/backend/skill-synthesis/src/lib/skill-repropagation.port.ts`

Score 9/10 — 0/0/0. `origin?: QueryOrigin` composes the shared type by
reference rather than re-declaring `userInitiated?: boolean`, which is exactly
the fix Batch 16b's review asked every other touched interface in this family
to make. The JSDoc states both branches (`userInitiated: true` vs. absent/false)
and their consequence precisely.

### `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts`

Score 8/10 — 0/0/0. `evaluate`'s trailing `origin: QueryOrigin = {}` matches
this service's pre-existing style of accumulating optional trailing params
(consistent with Batch 16b's review of the same file); `emitRepropagation`
correctly threads the identical `origin` to every emitted slug rather than
re-deriving it per slug, which the new spec
(`skill-promotion.repropagation.spec.ts`'s "hands the evaluate origin to every
emitted slug") pins directly.

### `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`

Score 7/10 — 0/0/1 (the `applyEnhancement` inline object literal, Minor
above). `applyProposal` and `revert` both correctly default `origin:
QueryOrigin = {}` and thread it through the private `repropagate` helper,
whose own signature changed from a defaulted `kind: SkillRegistryKind =
'skill'` to a required `kind` alongside the newly required `origin` — a clean
tightening now that every call site supplies both explicitly.

### `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`

Score 9/10 — 0/0/0. Both call sites (`applyProposal`, `revert`) pass
`{ userInitiated: true }` as a literal with a one-line inline comment stating
the consequence ("skips the governor"), matching the "only an RPC handler
sets it" invariant this file family has held since Batch 16b, and matching
this batch's own documentation discipline everywhere else.

### `libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts`

Score 8/10 — 0/0/0 (the CLAUDE.md gap is counted against the lib's
documentation, not this file, which is itself well-documented). The new
`reason?: string` parameter's JSDoc correctly explains both halves — what the
label means and that "a host with no such concept ignores it" — which is
exactly what the CLI's silent non-adoption needs and does not have at its own
call site (Serious above).

### `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts`

Score 7/10 — 0/1/1 (the CLAUDE.md gap counted here as the Serious issue since
this is the file that introduces the field; the two-branch forwarding, Minor).
`HarnessPropagateOptions.userLayerRefreshReason`'s JSDoc correctly
distinguishes itself from the positional `reason` parameter in the same
method ("Distinct from `reason`, which labels the reconcile and is free text
per emit site") — the one place in this diff that pre-empts the naming
confusion a reviewer would otherwise have to raise.

### `apps/ptah-electron/src/activation/skill-repropagation.ts`

Score 9/10 — 0/0/0. `SKILL_REPROPAGATION_USER_LAYER_REASON`'s home here (not
in `plugin-activation.ts`, where `GOVERNED_USER_LAYER_REASONS` and
`HARNESS_PROPAGATION_USER_LAYER_REASON` live) is the correct split: the
constant names _this port's own_ background label and belongs beside the
class that produces it, while the allow-list that _consumes_ every governed
label (this one and any future one) belongs beside the coalescer's gate — the
same "constant lives with its producer, allow-list lives with its consumer"
shape `USER_ACTION_QUERY_LANE` / `GOVERNED_BACKGROUND_LANES` already
established in Batch 16b. The new "Who waits" doc section is precise and
verified line-for-line against the code beneath it (the `origin.userInitiated
=== true ? {} : { userLayerRefreshReason: ... }` ternary matches the prose
exactly).

### `apps/ptah-electron/src/activation/plugin-activation.ts`

Score 7/10 — 0/0/1 (file size, Minor above; not new debt this batch
introduced by itself). `GOVERNED_USER_LAYER_REASONS`'s doc comment update
correctly explains the asymmetry between a click (refreshes as
`harness-propagation`, never governed) and the curator/auto-promotion path
(refreshes as `skill-repropagation`, governed) with the exact reasoning
(`content-download-complete`'s sibling bullet is the template this new bullet
follows). `createUserLayerRefresher`'s `reason ?? HARNESS_PROPAGATION_USER_LAYER_REASON`
correctly makes the "no label → the host's own default" contract concrete at
the one place that has to honor it.

### Specs (`harness-propagation.service.spec.ts`, `skill-repropagation.spec.ts`,

`plugin-activation.spec.ts`, `skills-synthesis-rpc.handlers.spec.ts`,
`skill-promotion.repropagation.spec.ts`, `skill-curator.service.spec.ts`,
`skill-invocation-tracker.spec.ts`)

Score 9/10 collectively. Coverage is genuinely end-to-end rather than
per-unit-in-isolation: `plugin-activation.spec.ts`'s new
`repropagationFor(h)` helper wires the real `ElectronSkillRepropagation`
through a fake `propagation.propagate` that forwards to the real
`createUserLayerRefresher`, so the governed-vs-ungoverned behaviour is proven
across the port → propagation → refresher → coalescer chain rather than
asserted against a mock at each layer independently — including the "a click
joining a held background pass releases it at once, as ONE pass" case, which
is the specific hazard `GOVERNED_USER_LAYER_REASONS`'s doc comment promises
and the harder of the two directions to get wrong. Every "no origin" call site
in the upstream specs (`skill-curator.service.spec.ts`, `skill-invocation-tracker.spec.ts`)
states in a comment why background work correctly passes nothing, matching
the RPC handler's opposite-direction comments.

### `apps/ptah-electron/CLAUDE.md`

Score 9/10 — 0/0/0. The updated `GOVERNED_USER_LAYER_REASONS` bullet is
accurate against the code (the `skill-repropagation` addition, the
`userLayerRefreshReason` forwarding, the click/background split) and is the
one CLAUDE.md in this batch that fully describes the new mechanism — which is
exactly what makes its sibling lib's silence (Serious, above) stand out as an
omission rather than a uniform choice not to document this feature anywhere.

## Pattern compliance

| Repository rule or nearby convention                                                                                                                  | Status                         | Evidence                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A field documented as "shared with type X" is composed via `extends`/nesting, not re-declared (Batch 16b finding)                                     | PASS                           | `skill-repropagation.port.ts:16` `origin?: QueryOrigin`, not an inline `userInitiated?: boolean`                                                      |
| `origin` grows as a trailing positional param where the service already accumulates them (Batch 16b's own resolved question)                          | PASS                           | `evaluate(id, settings, nowFn?, origin?)`, `applyProposal(kind, slug, proposalId, origin?)`                                                           |
| Only an RPC handler sets `userInitiated: true` literally                                                                                              | PASS                           | `skills-synthesis-rpc.handlers.ts`'s two call sites; every drain/curator/tracker call site passes nothing or forwards its own `options.userInitiated` |
| `GOVERNED_*` allow-list pattern (exported `ReadonlySet<string>`, spec pins membership, constant lives with producer)                                  | PASS                           | `GOVERNED_USER_LAYER_REASONS` + `SKILL_REPROPAGATION_USER_LAYER_REASON` at the producer, spec at `plugin-activation.spec.ts:610-614`                  |
| A lib's CLAUDE.md documents its own public option surface (existing convention for `skipUserLayerRefresh`, `mode`, `targets`)                         | FAIL                           | `harness-sync/CLAUDE.md` omits `userLayerRefreshReason` entirely (Serious)                                                                            |
| A port implementation that diverges from a sibling implementation states why at the call site (Batch 16b's `internal-query.service.ts:144` precedent) | FAIL                           | `cli-skill-repropagation.ts`'s omitted `origin` parameter carries no comment (Serious)                                                                |
| `catch (error: unknown)` narrowed correctly                                                                                                           | PASS                           | `harness-propagation.service.ts`, `skill-enhancer.service.ts`, `skill-repropagation.ts` unchanged catch sites                                         |
| File size soft ceiling 700 lines                                                                                                                      | AT/OVER CEILING (pre-existing) | `plugin-activation.ts` 760 lines (Minor); not this batch's new debt                                                                                   |
| CLAUDE.md accuracy against shipped code (where updated)                                                                                               | PASS                           | `apps/ptah-electron/CLAUDE.md`'s new bullet checked line-by-line against `skill-repropagation.ts` and `plugin-activation.ts`                          |

## Maintenance debt

- Introduced: one well-composed `origin` field threaded through the
  repropagation port and its two production callers (`skill-promotion.service.ts`,
  `skill-enhancer.service.ts`), correctly distinguishing a click from
  background work at the one place (`ElectronSkillRepropagation`) that
  actually schedules against a governor; end-to-end test coverage across the
  full port → propagation → refresher → coalescer chain.
- Retired: nothing removed; additive.
- Net: slightly negative on documentation completeness only — the batch's own
  documentation standard (three files updated with matching, cross-referenced
  prose) is high everywhere except the one lib-level CLAUDE.md that should be
  the canonical description of the new option, and the CLI adapter's
  divergence is correct but unstated. Both are cheap, non-behavioural fixes;
  neither is a runtime defect.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `harness-sync/CLAUDE.md` — the runtime-agnostic lib that owns
  `HarnessPropagateOptions` and `IUserLayerRefresher` — says nothing about the
  `userLayerRefreshReason` field this batch adds to both, while every other
  touched CLAUDE.md and JSDoc block documents it fully; and the CLI's
  correct-but-silent omission of the `origin` parameter leaves a reader no way
  to tell a deliberate choice from a missed update.
- What a 10/10 version would do differently: add `userLayerRefreshReason` to
  `harness-sync/CLAUDE.md` beside `skipUserLayerRefresh`; add
  `origin?: QueryOrigin` to `CliSkillRepropagation.repropagate` with a
  one-line "no governor to defer to" comment; collapse the two-branch
  `refresh(cwd)` / `refresh(cwd, reason)` forwarding in
  `harness-propagation.service.ts` into one call now that the port's contract
  already treats `undefined` as "no label."
