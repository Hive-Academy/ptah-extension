# Code Style Review - `TASK_2026_678_9083` Phase B

Range reviewed: `fa97a6967^..2137ab904` (B5, B6, B6A, B7, B8).
Reviewer family: Anthropic (in-process `code-style-reviewer`). Implementer family: codex.
Logic findings are in `code-logic-review-phase-b.md` and are not repeated here.

## Summary

| Metric          | Value                                                         |
| --------------- | ------------------------------------------------------------- |
| Overall score   | 6/10                                                          |
| Assessment      | NEEDS_REVISION                                                |
| Blocking issues | 0                                                             |
| Serious issues  | 3                                                             |
| Moderate issues | 6                                                             |
| Minor issues    | 5                                                             |
| Files reviewed  | 20 source files read in full (specs skimmed for coupling only) |

Score evidence. Above 5: module boundaries, tags, lib skeleton, alias, commitlint scope, suppression comment and
chat/chat-state changes all match the nearest siblings, with no boundary breach and no type-safety escape hatch.
Below 7: the new lib and the phase entry ship un-formatted code, a hand-copied rule set that gates a paid spawn, and
several domain constants re-typed from their canonical owners. Later batches (B13/B14) will copy all three.

## Five style questions

### 1. What breaks in six months?

Three copies of domain truth will drift silently:

- The launchability rules are re-implemented at `tribunal-roster-proposal.ts:35-51` against
  `tribunal-roster-rules.ts:42-106`. When Tribunal adds a blocking rule (or changes `normalizeModel`,
  `tribunal-roster-rules.ts:124`), the Command Center gate keeps the old rule and approves a roster the panel
  would refuse. This gate sits in front of a paid spawn.
- The zod schema re-types `CliType` (`tribunal-roster-proposal.ts:9`, canonical `SYSTEM_CLI_TYPES` plus `'ptah-cli'`
  in `libs/shared/src/lib/types/agent-process.types.ts:70-82`), the lane roles (`:11`, canonical `RELAY_ROLES` /
  `CRUCIBLE_ROLES`, `tribunal-ui.types.ts:12,24`) and the moves (`:16`, canonical `TribunalMove`,
  `tribunal-ui.types.ts:4`). A new CLI or move validates in the panel and is rejected by the gate.
- The Crucible round cap `2` exists as `DEFAULT_CRUCIBLE_ROUND_CAP` (`tribunal-run-framing.ts:97`) and again as bare
  literals at `tribunal-phase-derivation.ts:61` (`?? 2`), `tribunal-run-framing.ts:104` (`Math.min(..., 2)`) and
  `tribunal-roster-proposal.ts:19` (`.max(2)`).

### 2. What would a new team member misread?

- `OwnedRun.phase` (`work-projection.ts:6`) is a `PhaseDerivationInput`, not a phase. The next line of code that uses it
  declares `const phase = derivePhase(run.phase)` (`:44`), so the two meanings sit side by side.
- `index.ts` exports `CommandCenterStore` and `CommandCenterSessionCoordinator` (page-scoped, `@Injectable()` with no
  `providedIn`). A reader assumes they are consumable outside the page; injecting one without the page's `providers`
  array fails at runtime.
- `rosterIsLaunchableLocally` reads as "launchable on this machine". It means "this lib's copy of the rule".
- `role: item.role ?? ''` (`tribunal-run-coordinator.ts:54`) encodes "no role" as an empty string in a manifest whose
  schema reads `''` as invalid. (Logic owns the failure; the type shape is the style problem. See Moderate 5.)

### 3. What does this cost to maintain that a simpler shape would not?

- Every Prettier run on these 13 files will produce a large, noisy diff in whichever batch touches them next. That
  buries the real change in review.
- The local rule copy needs a parity spec or a manual diff each time `tribunal-roster-rules.ts` changes. Exporting the
  function costs one line in `phase.ts`.
- `setStatusContextProvider` (`session-coordinator.ts:34`) is a seam with one production implementation (the default
  at `:28`) and no caller outside its own spec (`session-coordinator.spec.ts:100`). It is a speculative option.
- `tab-manager.service.ts` is now 3182 lines. B6A added about 40 more lines of Command Center bookkeeping to it (the
  failure signal, `recordCommandCenterWrite`, the lock clear) instead of to the `CommandCenter*` services beside it.

### 4. Where is this inconsistent with the rest of the repository?

- Formatting: sibling libs wrap at Prettier's default 80 columns. `mcp-apps-page` has 0-1 lines over 100 per file.
  `work-projection.ts` has 22 of its 60 lines over 100 and `tribunal-run-coordinator.ts` has lines of 206, 236 and 313
  columns. See Serious 1.
- Narrow entry points: `chat-ui/src/turn-recap.ts` and `marketplace/src/harness.ts` open with a header that says why
  the entry exists and what it must never export, and `ui` has `brand-mark-barrels.spec.ts` as a guard. `phase.ts` has
  neither (Moderate 2).
- Barrel style: `mcp-apps-page/src/index.ts` and `tribunal-panel/src/index.ts` use named exports. `command-center`
  uses `export *` (Moderate 1).
- Where it matches: `CommandCenterStore` carries the same `eslint-disable-next-line ... use-injectable-provided-in --
  page-scoped ... see the class note` pattern as `marketplace/.../capability-toggles.store.ts:85`. The lib skeleton
  (`eslint.config.mjs`, `tsconfig*.json`, `jest.config.ts`, `project.json` apart from names) is byte-identical to
  `mcp-apps-page`.

### 5. What would I have done differently?

- Widened the phase entry now, not in 8F, for `rosterIsLaunchable`, `DEFAULT_CRUCIBLE_ROUND_CAP`, `RELAY_ROLES`,
  `CRUCIBLE_ROLES` and the `TribunalMove`/`LaneRole`/`VendorLane` types, then built the zod schema from those values.
  The coordinator is a gate for paid launches, so it should share the panel's rules and not shadow them.
- Run `prettier --write` on the new files before the first commit of each batch, because the repo's own lint-staged
  step did not do it (ruling 1).
- Keep the barrel at what the lazy route needs: `CommandCenterPageComponent` (Task 14.2). Keep model classes internal.

## Blocking issues

None. No `@nx/enforce-module-boundaries` suppression, no `as any`, no `@ts-ignore`, no cross-lib deep relative import,
and no import of `command-center` from `chat`, `chat-state` or `tribunal-panel`.

## Serious issues

### S1. New files are not Prettier-formatted

- File: `libs/frontend/command-center/src/lib/model/{work-projection,tribunal-run-coordinator,tribunal-roster-proposal,status-context,session-coordinator}.ts`
  and their specs; `libs/frontend/tribunal-panel/src/phase.ts`, `.../tribunal-run-framing.ts`,
  `.../tribunal-phase-derivation.ts`; `tsconfig.base.json:33`. Examples: `work-projection.ts:4-6,47,56`,
  `tribunal-run-coordinator.ts:13,22,28`, `tribunal-roster-proposal.ts:54,67`, `phase.ts:1`.
- Problem: Prettier covers these files. The root `.prettierrc` is `{"singleQuote": true}` (default `printWidth` 80),
  `.prettierignore` does not match them, and `.lintstagedrc.mjs` globs `*.{ts,js,json,md}`. `prettier --check` fails on
  all 13 files and a dry `prettier` run on `work-projection.ts` rewrites the whole file. The B7 note in `batches.md:783`
  records that `nx format:write` "left them unchanged". The files were committed as-is, so the lint-staged step did not
  format them. Part of `command-center.store.ts` is formatted and part is not (`:60-61,142`), which fits a mix of
  hand-wrapped and generated text.
- Context: the repo is not Prettier-3-clean (27 older files in `chat/src/lib/services` also fail, mostly
  trailing-comma drift), so the new-file failure is a difference of kind: 200+ column lines, multi-statement one-liners
  (`if (...) { owned.add(child.id); changed = true; }`), and `type X =\n | ...` blocks that Prettier re-joins.
- Tradeoff: readability. A 245-column `nodes.push({...})` hides the `state` mapping that the logic review had to find.
  A reformat is mechanical and free now; it is expensive after B13/B14 add more lines to the same files.
- Recommendation: first commit of B8F is a format-only commit, with no logic edits in it.
  `npx prettier --write <explicit list of the new Phase B files above>` (not a glob over `libs/frontend/chat*`).
  Do NOT run it on `tab-manager.service.ts` or `message-sender.service.ts`, which have older formatting drift and
  would produce unrelated diffs. Re-wrap only the B6A hunks in `tab-manager.service.ts:1002,1377-1379,1963-1967` by hand.
  Also find out why `nx format:write --files=` did not touch new files in this worktree (CLI-lane environment) so B13+
  do not repeat it. This is a Windows/argument-length or nx-affected-base question for the team leader; I did not run it
  because CLAUDE.md forbids workspace-wide checks.

### S2. Local roster-rule copy gates a paid spawn (Decision D14)

- File: `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts:35-51`, called from
  `:70` (`parseRosterProposal`) and `tribunal-run-coordinator.ts:48` (`confirm`).
- Problem: a hand-written second implementation of `rosterIsLaunchable` that has already diverged:
  it adds a duplicate-`laneId` check and a "flat moves carry no role" check that the original lacks, and it inlines the
  relay role list (`:38`) and `normalizeModel` (`:40`). The comment names `tribunal-roster-rules.ts:42-47,53-106`
  as the source of truth, which is the "duplication with drift" pattern.
- Tradeoff: widening `phase.ts` by one `export { rosterIsLaunchable } from './lib/services/tribunal-roster-rules'`
  keeps the entry narrow in the sense D6 cares about. `tribunal-roster-rules.ts` imports only
  `../types/tribunal-ui.types` (pure, no Angular, no DI; header at `:16-17` says so). The `VendorLane` shape accepts the
  parsed proposal lanes already, since `buildApprovedRootFraming(proposal.move, proposal.lanes, ...)` at
  `tribunal-run-coordinator.ts:57` compiles today.
- Recommendation: see ruling 3. Widen in B8F, delete the mirrored relay/crucible branches, and keep only the two
  proposal-shape checks (unique `laneId`, flat moves carry no role) as a small `proposalShapeIsValid` beside the zod
  schema.

### S3. Domain constants re-typed instead of imported

- File: `tribunal-roster-proposal.ts:9,11,16,19`; `tribunal-phase-derivation.ts:61`; `tribunal-run-framing.ts:104`;
  `tribunal-roster-proposal.ts:28,67` (`'AT LIMIT'` twice).
- Problem: see Question 1. Within `tribunal-panel` the fix is free: `tribunal-phase-derivation.ts` and
  `tribunal-run-framing.ts` are siblings, so `?? DEFAULT_CRUCIBLE_ROUND_CAP` needs only an import. The B7 batch
  extracted this code and left the literal in place, which means the extraction is not behaviour-preserving in
  intent: someone who changes the constant changes the framing prompt but not the phase cap.
- Recommendation: see ruling 2. For `cli`, use `z.enum([...SYSTEM_CLI_TYPES, 'ptah-cli'])` (shared barrel exports
  it, `libs/shared/src/index.ts:25`). Hoist `'AT LIMIT'` to one `const AT_LIMIT_STATE` in the file.

## Moderate issues (fix in B8F if cheap)

1. Barrel over-exports internals. `libs/frontend/command-center/src/index.ts:1-2` uses `export *` for the page-scoped
   store and coordinator plus all their helper types. Task 14.2 exports `CommandCenterPageComponent` from this file and
   the page imports its siblings relatively, so B13/B14 need nothing else from the barrel. `export *` also makes every
   new top-level export in those two files public by accident. Fix: replace with named exports only for what a
   consumer outside the lib needs (today: nothing; after B14: `CommandCenterPageComponent`). Keep `index.ts` honest with
   a one-line comment that the rest is page-internal.
2. `phase.ts` has no header and no barrel guard. Sibling narrow entries (`chat-ui/src/turn-recap.ts`,
   `marketplace/src/harness.ts`) say why they exist and what they must not export; `ui` pins its entry with
   `brand-mark-barrels.spec.ts` (and Task 11.1 repeats that for `provider-brand-art`). Fix: add a 6-8 line header
   (Decision D6, "pure, no Angular, no DI, no `TribunalStateService`") and a small spec that asserts the exact export
   names, so an accidental `export *` cannot drag the Angular panel into a lazy `command-center` chunk.
3. Type casts that a predicate removes. `work-projection.ts:22` (`child.sessionId as string`) and `:59`
   (`node.parentId as string`) are `filter(...)` then `as`. Use `flatMap` or a type-guard filter, or a `for` loop. The
   plan asked for review as if `strict` (base is not strict).
4. Anonymous public contract on the coordinator. `TribunalRunCoordinator.receive` takes an inline 8-field object type
   (`tribunal-run-coordinator.ts:28`, 313 columns), and `Pending` (`:15`) duplicates six of those fields. B13's card and
   B14's page must construct that object. Name it (`ProposalReceiveContext`, exported from the file, not the barrel) and
   let `Pending` extend a `readonly` base. Rename `Pending` to `PendingProposal`.
5. `''` as "no role" sentinel. `tribunal-run-coordinator.ts:54` writes `role: item.role ?? ''`. The right shape is
   `role?: LaneRole` in `CommandCenterRunManifest` (the 8F.2 plan item), not a non-empty string that the schema then
   rejects. Make sure 8F.2 changes the type and not only the zod `min(1)`.
6. Speculative seam. `setStatusContextProvider` (`session-coordinator.ts:34`) and the nullable provider field
   (`:28`) have one implementation. Either drop the setter until a second provider exists, or leave a comment naming
   the consumer. The `agesMs` parameter of `buildStatusContext` (`status-context.ts:4`) likewise has no producer
   (logic review notes this as a gap); defaulting it to `new Map()` makes the call look complete.

## Minor issues (record only)

- `tribunal-run-coordinator.ts:11` `sendLaunchTurn` and `session-coordinator.ts:183` `sendLaunchTurn` are one-line
  aliases of `send`. The name carries intent, so keep it, but note it when the page wires the transport.
- `ProposalTransport` (`tribunal-run-coordinator.ts:7`) is a generic name in a lib that also talks to RPC and the
  extension transport. `TribunalProposalTransport` reads more clearly. It is an interface at a real boundary, so keep
  the interface.
- `CONFIRMED_DISCOVERY_ANSWER` (`tribunal-run-coordinator.ts:6`) is protocol text the A1 gate depends on. It is
  exported for the spec, which is fine. Keep it out of the barrel.
- `chat-state` additions use `interface CommandCenterRecordWriteFailure { workspacePath: string; record: ... }`
  (`tab-manager.service.ts:77-80`) with mutable fields, unlike the `readonly` fields in `command-center`. Make them
  `readonly`.
- `message-sender.service.ts:455` `const systemPrompt = activeTab && commandCenterPersonaFor(activeTab);` has the type
  `string | false | null | undefined | ...`. It is identical to the existing sibling at `:713`, so it is consistent;
  tidy both together later with `activeTab ? commandCenterPersonaFor(activeTab) : undefined`.

## File-by-file

### `libs/frontend/command-center/src/index.ts`
Score 6/10 - 0 B, 0 S, 1 M. `export *` of two page-internal modules (Moderate 1). Neither `work-projection`,
`status-context`, `tribunal-roster-proposal` nor `tribunal-run-coordinator` is exported, which is correct for B13/B14
as written (they sit in the same lib).

### `project.json`, `eslint.config.mjs`, `tsconfig*.json`, `jest.config.ts`
Score 9/10. Tags are `scope:webview`, `type:feature`, `platform:angular`, same as `mcp-apps-page/project.json:7`; diff
against `mcp-apps-page` shows only name/path substitutions. Edges allowed by `eslint.config.mjs:295-296,407-414`:
`type:feature` to `type:feature` (`chat`, `tribunal-panel`), to `type:data-access` (`chat-state`), to `type:core`
(`core`), `shared` to `scope:shared`.

### `tsconfig.base.json`, `.commitlintrc.json`
Score 8/10. `command-center` alias and commitlint scope are present and unambiguous. The `tribunal-panel/phase`
alias is registered ahead of the bare `tribunal-panel` alias (`tsconfig.base.json:33`), which matches how
`chat-ui/*` entries sit next to their parent. One line over 80 columns (`:33`; covered by S1).

### `command-center.store.ts`
Score 8/10 - 0 B, 0 S, 0 M. Signals with `asReadonly()`, explicit `public`, readonly node types, the
`use-injectable-provided-in` suppression with a reason. Mixed formatting (S1).

### `session-coordinator.ts`
Score 7/10 - 0 B, 0 S, 1 M. Correct page-scoped DI via `inject()` and `DestroyRef`, consistent with the repo.
`setStatusContextProvider` seam (Moderate 6). Long lines (S1).

### `status-context.ts`
Score 7/10. Small and pure. `agesMs` param has no producer (Moderate 6). Long lines (S1).

### `work-projection.ts`
Score 5/10 - 0 B, 1 S, 1 M. Two casts (Moderate 3), the `phase` naming (Question 2) and S1 formatting hide a
reasonable 60-line pure function.

### `tribunal-roster-proposal.ts`
Score 5/10 - 0 B, 2 S, 0 M. D14 mirror (S2) and re-typed enums (S3). Exports a type named for the schema, which is
fine.

### `tribunal-run-coordinator.ts`
Score 6/10 - 0 B, 1 S, 3 M. Plain class with constructor-injected transport, which matches the `apps-*` plain-class
pattern in `mcp-apps-page`. Anonymous context type (Moderate 4), `''` role (Moderate 5), formatting (S1).

### `tribunal-panel/src/phase.ts`
Score 6/10 - 0 B, 1 S, 1 M. Exports are narrow and named, which is the right shape. No header or guard (Moderate 2).
Needs three more exports (ruling 2/3).

### `tribunal-run-framing.ts`, `tribunal-phase-derivation.ts`
Score 7/10. The split follows responsibility (prompt framing vs derived phase), `tribunal-run.service.ts` and
`tribunal-progress.service.ts` now import from them with no duplicated copy, and nothing in either file imports Angular.
Residual literals `2` (S3) and the formatting (S1).

### `chat-state/command-center-send-lock.service.ts`, `chat-state/tab-manager.service.ts`
Score 7/10. `clearForRoot` matches `release`/`rekey` in shape and file style (no `public`, no `readonly` modifier,
like the rest of the file). `tab-manager.service.ts` takes more Command Center bookkeeping (3182 lines; Question 3).
New call sites are hand-wrapped differently from the surrounding style.

### `chat/message-sender.service.ts`
Score 9/10. Two-line change identical to the pre-existing `chat:continue` branch (`:713`).

## Rulings on the requested items

### 1. Long one-line declarations

The files are covered by the repo Prettier config (no ignore entry; `*.ts` matched by `.lintstagedrc.mjs`;
default width 80), and Prettier did not run, or did not take effect, on them. This is not a repo convention to defer
to: siblings wrap at 80 (`mcp-apps-page`: 0-1 lines over 100 per file). Ruling: Serious (S1). Fix in B8F as a
format-only first commit, scoped to the Phase B new files; do not reformat the pre-existing large files.

### 2. Literal `2` versus `DEFAULT_CRUCIBLE_ROUND_CAP`

Replace all four bare `2`s. Within tribunal-panel, `derivePhase` (`tribunal-phase-derivation.ts:61`) imports
`DEFAULT_CRUCIBLE_ROUND_CAP` from `./tribunal-run-framing`. In `roundCapFor` (`:104`) note that the constant's own
doc comment says "default AND maximum at launch (AC-3.2)", so one constant carries two meanings. Split it: keep
`DEFAULT_CRUCIBLE_ROUND_CAP`, add `MAX_CRUCIBLE_ROUND_CAP = 2` next to it, use the maximum in `roundCapFor` and in the
zod `rounds.max(...)`, and export both from `phase.ts`. The zod schema then states its intent (`rounds` for Crucible
must not exceed the launch maximum) and cannot disagree with `roundCapFor`. This is a two-name widening of a
type-free constant, within D6's reasoning.

### 3. D14: local mirror versus exporting `rosterIsLaunchable`

Recommend exporting. Evidence: the rule file is pure and has no Angular or DI imports; `VendorLane` already
accepts the parsed lanes; the mirror has already diverged (extra duplicate-id and flat-role checks, inlined role
list and `normalizeModel`); and the gate guards a paid spawn. A narrow entry stays narrow when it adds one pure
function. Land it in B8F with the S3 widening in the same commit and re-run both projects. B8F's re-review scope
should then include a style re-review of `phase.ts` (the batch plan at `batches.md:928` conditions the style re-review
on exactly this widening). Also export `RELAY_ROLES`, `CRUCIBLE_ROLES` and the types `TribunalMove`, `LaneRole`,
`VendorLane` so the zod enums are derived (S3).

### 4. Barrel surface and naming

`index.ts` currently exports more than B13/B14 need and the wrong things (Moderate 1). Keep model classes internal;
export `CommandCenterPageComponent` when it lands. Placement: `model/` for `ProposalTransport`,
`CONFIRMED_DISCOVERY_ANSWER`, `TribunalRosterProposal` is acceptable now; they are domain logic with no UI, and
`scene/` and `components/` take the rest. When B13 lands, reconsider a `model/tribunal/` subfolder if more
Tribunal gate files arrive (the card's view-model). Names: `TribunalRosterProposal` reads like the domain;
`ProposalTransport` should carry the `Tribunal` prefix (Minor); `AvailableLane` is ambiguous with the discovery
lane type in `tribunal-panel` and could be `ProposalCandidateLane` (Minor).

### 5. DI conventions

Pass. `CommandCenterStore` and `CommandCenterSessionCoordinator` use `@Injectable()` with the same
`use-injectable-provided-in` suppression and reasoned comment as `marketplace` stores
(`capability-toggles.store.ts:85`, `connector-links.store.ts:173`). `TribunalRunCoordinator` is a plain class with a
constructor-injected `ProposalTransport`; this is the right shape because it is constructed per page by the card
owner and has no Angular dependency, matching `mcp-apps-page`'s plain `apps-submit-flow` style. The only DI
nit is the unused provider seam (Moderate 6).

### 6. Type precision

Casts: two `as string` after a filter (Moderate 3); no `as any`, no `@ts-ignore`. Optional vs `''` role:
`role?: LaneRole` is the correct shape in the manifest; `''` is a smell (Moderate 5) and 8F.2 should change the type.
`readonly` arrays: the `command-center` types use `readonly` consistently, with exceptions in the new chat-state
interface (Minor) and the `receive` context (Moderate 4). Explicit `public`: present throughout `command-center`
(the lib's lint rule is `warn`); `chat-state` follows its own file style without `public`. Consistent.

### 7. Import boundaries

Pass. `command-center` imports `@ptah-extension/chat`, `chat-state`, `core`, `shared`,
`@ptah-extension/tribunal-panel/phase` and `zod` (grep of non-spec imports). No file in `chat`, `chat-state` or
`tribunal-panel` imports `@ptah-extension/command-center` (grep across `libs apps`: only `command-center/project.json`
and its own files). All four edges are allowed by the `type:feature`/`type:data-access`/`type:core` constraints at
`eslint.config.mjs:407-414`. `tribunal-panel/phase` is a second entry that does not appear in
`checkDynamicDependenciesExceptions` (`eslint.config.mjs:281-284`); it does not need to, because no eager consumer
imports it today. If the page's route is lazy and `tribunal-panel` is also lazy, the shared chunk is bundler-managed.
Note it in the phase header so nobody adds an eager importer.

## Pattern compliance

| Repository rule or nearby convention                                  | Status         | Evidence |
| --------------------------------------------------------------------- | -------------- | -------- |
| New lib has `scope:*` and `type:*` tags                                | PASS           | `libs/frontend/command-center/project.json:7` |
| `@nx/enforce-module-boundaries` not suppressed                         | PASS           | grep of `eslint-disable` in the lib: only `use-injectable-provided-in` |
| Cross-lib imports through barrel or declared entry                     | PASS           | `tsconfig.base.json:33,191-193`; no relative cross-lib paths |
| No `command-center` import from `chat`, `chat-state`, `tribunal-panel` | PASS           | repo grep, only the lib itself |
| Lib skeleton matches the nearest sibling                               | PASS           | `diff` against `mcp-apps-page` (names only) |
| Commitlint scope present                                               | PASS           | `.commitlintrc.json:77` |
| Page-scoped injectable suppression with reason                        | PASS           | `command-center.store.ts:57`, `session-coordinator.ts:14` |
| No new `as any` / `@ts-ignore`                                         | PASS           | grep over new files |
| No unchecked casts                                                     | FAIL (minor)   | `work-projection.ts:22,59` |
| Narrow entry has header and barrel guard                               | FAIL           | `phase.ts` vs `turn-recap.ts`, `harness.ts`, `brand-mark-barrels.spec.ts` |
| Named barrel exports                                                   | FAIL (minor)   | `command-center/src/index.ts:1-2` |
| Files formatted with the repo Prettier config                          | FAIL           | `prettier --check` on 13 files; `work-projection.ts:47,56` (245, 219 columns) |
| Domain constants imported, not re-typed                                | FAIL           | `tribunal-roster-proposal.ts:9,11,16,19`; `tribunal-phase-derivation.ts:61` |
| Shared rules reused across libs                                        | FAIL           | `tribunal-roster-proposal.ts:35-51` |
| Hexagonal backend ports / `platform-*` rules                           | NOT_APPLICABLE | frontend-only change |
| `rpc.types.ts` appended                                                | NOT_APPLICABLE | no RPC contract change in Phase B |
| DI phase files, `expected-resolvable.ts`                               | NOT_APPLICABLE | webview-only change |

## Maintenance debt

- Introduced: a second copy of the Tribunal launch rules (D14); three re-typed enums; four bare `2` literals; 13
  un-formatted files; a speculative provider seam; more Command Center logic in a 3182-line `tab-manager.service.ts`.
- Retired: B7 removed about 640 lines of framing and phase logic from `tribunal-run.service.ts` /
  `tribunal-progress.service.ts` into two pure, tested modules (a net structural improvement).
- Net: structure is sound and the new public API is small. The debt is cheap if it is paid in B8F and expensive if B13/B14
  copy these patterns.

## Verdict

- Recommendation: REVISE (fold into B8F: format-only commit first, then the phase widening, then S3/Moderate items)
- Confidence: HIGH on boundaries, tags and formatting (checked with `prettier --check` and file greps); MEDIUM on
  why `nx format:write` skipped the new files, which I did not reproduce under the memory rules.
- Key concern: the paid-spawn gate shadows the panel's own rules and constants, and 13 new files are unformatted.
- What a 10/10 version would do differently:
  1. Format-only commit on the new files, then logic edits.
  2. `phase.ts` exports `rosterIsLaunchable`, `DEFAULT_CRUCIBLE_ROUND_CAP`, `MAX_CRUCIBLE_ROUND_CAP`, `RELAY_ROLES`,
     `CRUCIBLE_ROLES` and types; header plus a guard spec; zod enums built from them.
  3. Barrel with named exports and no page-internal classes.
  4. Named `ProposalReceiveContext`; `role?: LaneRole` in the manifest instead of `''`.
  5. Remove the `setStatusContextProvider` seam until it has a second user; no `as` casts in `work-projection.ts`.
  6. Put the Command Center write-failure bookkeeping beside `CommandCenterRecordsService`, not in `TabManagerService`.

Verdict: NEEDS_REVISION

## Re-review (fix round 8F)

Range: `5d52cfa5b..HEAD` (8FA `dd8e42cd9`, 8FB `545d3b53a`, 8FD `a5adac5cd`, 8FC `ae74169bc`, 8FE `b5af1cc42`).
Reviewer family: Anthropic (in-process), Implementer family: codex.
Scope: style only. Logic is covered by the parallel grok re-review. Moderates 1 and 6 are carried to Task 14.2 (D20).
The D17 residue (`session-loader.service.ts`, `chat-rpc.schema.spec.ts`) is out of scope.

### Status of the prior findings

| Prior finding | Status | Evidence |
| --- | --- | --- |
| S1 Prettier | CLOSED | `npx prettier --check` on all 21 library files in the range passes (result line below). I also checked `status-context.ts`, `status-context.spec.ts`, `command-center/src/index.ts` and `tsconfig.base.json`, which the original S1 named. All pass. The residue in `session-loader.service.ts` and `chat-rpc.schema.spec.ts` is recorded in D17 and was not re-checked. |
| S2 local roster-rule copy (D14-R) | CLOSED | `tribunal-roster-proposal.ts:2-8` imports `rosterIsLaunchable` from `@ptah-extension/tribunal-panel/phase`. The local relay/crucible copy and its inlined `normalizeModel` are gone. Only the two proposal-shape checks the panel rule lacks remain, as `proposalShapeIsValid` (`:64-74`). `proposalIsLaunchable` (`:75-82`) composes the two. The coordinator calls `proposalIsLaunchable` at `tribunal-run-coordinator.ts:170`. `phase.ts:21` exports the rule, and `tribunal-roster-rules.ts:1-7` imports only `../types/tribunal-ui.types`, which is pure. |
| S3 constants re-typed | CLOSED | cli: `tribunal-roster-proposal.ts:17` is `z.enum([...SYSTEM_CLI_TYPES, 'ptah-cli'])`. role: `:19` is `z.enum([...RELAY_ROLES, ...CRUCIBLE_ROLES])`. move: `:25` is `z.enum(TRIBUNAL_MOVES)`. rounds: `:28` is `.max(MAX_CRUCIBLE_ROUND_CAP)`. `AT_LIMIT_STATE` is declared once (`:11`) and used at `:51` and `:92`. `tribunal-phase-derivation.ts:4,91` uses `DEFAULT_CRUCIBLE_ROUND_CAP`. `tribunal-run-framing.ts:104-107` splits the default and the maximum (ruling 2), and `roundCapFor` uses the maximum at `:120`. `TRIBUNAL_MOVES` is declared in `tribunal-ui.types.ts:4-10` with `TribunalMove` derived at `:11`. Compile-time parity of the move list with the `chat-state` manifest enum holds through `tribunal-run-coordinator.ts:193` (`move: proposal.move`). |
| Moderate 2 phase.ts header and guard | CLOSED | `phase.ts:1-6` gives the reason (Decision D6) and the must-stay-pure rule. All exports are named `export {...} from` / `export type {...} from` (`:7-31`) with no `export *`. `phase.spec.ts:5-17` pins the sorted runtime export list (11 names) and matches `phase.ts` exactly. Type exports are erased and not pinned, which is expected. The header is 5 lines, not the 6-8 asked for, and covers the points I listed. |
| Moderate 3 casts removed | CLOSED | No `as string` remains in `work-projection.ts`. `aliases` is built with `flatMap` (`:60-64`). The remaining `as const` at `:62,82` are const assertions, not type escapes. No `as any` or `@ts-` in `command-center/src` production code. |
| Moderate 4 named receive contract | CLOSED | `ProposalReceiveContext` is exported and `readonly` (`tribunal-run-coordinator.ts:49-57`). `PendingBase` derives from it (`:58-60`). `PendingProposal` (`:61-65`) replaces `Pending`. `receive` takes the named type (`:77`). Neither type is in the barrel. |
| Moderate 5 `''` role sentinel (D21) | CLOSED | `command-center-records.ts:18` is `role: nonEmpty.optional()`. The coordinator omits `role` when absent (`tribunal-run-coordinator.ts:195-199`), so `''` is no longer written. This is `role?: string`, not `role?: LaneRole`. D21 explains why: `eslint.config.mjs:407-414` forbids `chat-state` (`type:data-access`) from importing `tribunal-panel` (`type:feature`). I accept this deviation. The producer's zod enum limits the value to the canonical roles. |

Prettier: `npx prettier --check` on the 21 library files from the diff: "All matched files use Prettier code style!" (exit 0, no cache written).

### New style issues introduced by 8F

Blocking 0, Serious 0, Moderate 0, Minor 3.

- Minor: `tribunal-run-coordinator.ts:93-94` spreads the whole `context` into the pending entry, so `availability` (a snapshot) is kept at runtime while `PendingProposal` omits it (`:58`). The type then misdescribes the object. Destructure `availability` out in `receive`, or keep it in the type. This costs a stale reference per pending proposal, not a failure. Logic can check whether anything reads it.
- Minor: `work-projection.ts:66-70` builds `childBySession` as a `Map` keyed by `string | undefined` after `.filter((child) => child.sessionId)`, and it is only used for `.has` (`:78`). A `Set<string>` built with `flatMap` would match the `aliases` construction at `:60-64` and drop `undefined` from the key type. The cast removal itself is fine.
- Minor (residual, not introduced by 8F): `tribunal-panel/src/lib/wizard/step-run.component.ts:94` still has `input<number>(2)` as a bare round-cap default. It is inside the panel, outside the phase entry, and was not in the prior S3 list. The next change to the cap constants should take it from `DEFAULT_CRUCIBLE_ROUND_CAP`.

### Checks run and not verified

- Read in full: `phase.ts`, `phase.spec.ts`, `tribunal-roster-proposal.ts`, `tribunal-run-coordinator.ts`, `work-projection.ts`, and the `phase-b-8f.diff` hunks for `tribunal-ui.types.ts`, `tribunal-run-framing.ts`, `tribunal-phase-derivation.ts` and `command-center-records.ts`. I read the import lists of every module `phase.ts` re-exports. They import only `@ptah-extension/shared`, `import type` from `chat-streaming` and `canvas` (erased), and sibling pure files. No Angular or DI is pulled in.
- Not verified, because I was limited to prettier: that `z.enum([...SYSTEM_CLI_TYPES, 'ptah-cli'])` type-checks as a tuple (`SYSTEM_CLI_TYPES` is `as const` at `agent-process.types.ts:70-78`, so I expect it to); that `phase.spec.ts` passes under jest; that lint and typecheck are clean. The batch reports record those runs, and I did not repeat them. I did not re-read the 8F spec files beyond the file list and `phase.spec.ts`.

Reviewer family: Anthropic (in-process), Implementer family: codex

Verdict: APPROVED
