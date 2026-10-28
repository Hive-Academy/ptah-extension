# P3 code-style review — Batch 20 new RPCs and the Batch 21 feed / config-home surface

Task: TASK_2026_701_9e4b, phase P3. Reviewer: code-style-reviewer. Date: 2026-10-28.
Subject: `plugins:replace-kept-items`, `plugins:resolve-config-home`,
`MarketplaceLocalItemsService`, plus the Batch 21 `LibraryChangeFeed` and
`PluginCatalogService.configHome` surface. Diff read: `reviews/p3-be.patch`,
cross-checked against the worktree sources.

## Verdict: REVISE — score 7/10

No boundary violation and no contract defect. Every consent, digest, and token
decision sits behind the right boundary, and the registry, allowlist, DI, and
guard-spec joins match their siblings almost line for line. One Serious
structural finding and four duplication findings must be addressed in one pass.

## Scope examined

Read in full: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
(1515 lines), `.../handlers/marketplace/marketplace-local-items.service.ts`,
`.../handlers/marketplace/local-item-approvals.ts`, `.../handlers/plugin-rpc.schema.ts`,
`.../register-shared-rpc-handlers.ts`, `apps/ptah-electron/src/di/expected-resolvable.ts`,
`libs/frontend/marketplace/src/lib/services/library-change-feed.ts`.

Read in whole relevant regions: `libs/shared/src/lib/types/rpc.types.ts`
(registry and true-map), `.../types/rpc/rpc-plugin-marketplace.types.ts`,
`.../types/rpc/rpc-misc.types.ts`, `rpc-allowlist.spec.ts`, `skills-sh-rpc.handlers.ts`
(injection region), `plugin-catalog.service.ts` (configHome regions), the three
`container.smoke.spec.ts` and three `rpc-surface.spec.ts` guard specs (via the
patch hunks, all three hosts), `surface-composition.spec.ts`, the
`external-plugin-installer.service.ts` and plugin-marketplace `index.ts` hunks,
and `app.config.ts` (MESSAGE_HANDLERS hunk).

## Findings

### 1. Serious — the phase grew `plugin-rpc.handlers.ts` by ~592 lines (923 → 1515), against the plan's own A17 guard

- Where: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` —
  the last phase hunk is `@@ -920,3 +1449,66 @@` (`p3-be.patch:4780`), so the
  pre-phase file ended at old line 923 and now ends at 1515. The additions
  include four private orchestration methods that are install-domain logic,
  not RPC wiring: `planLocalItems` (`plugin-rpc.handlers.ts:897`),
  `applyPlanDecisions` (`:937`), `applyLocalItems` (`:990`), and
  `keptForEnabledPlugins` (`:1252`), plus the module helpers
  `keptReasonForKind` (`:1459`), `newlyEnabledPluginIds` (`:1477`), and
  `sourceRefFor` (`:1500`).
- Why it matters: `implementation-plan.md:213` (A17) is the project's settled
  rule — "New logic in new files beside the god files" — with five god-file
  sizes (1937, 2407, 1632, 1144, 1425) as its guard evidence. This phase turned
  a 923-line file into the size class A17 exists to prevent, and it created the
  right home first: `handlers/marketplace/` already holds the services this
  logic calls. Six months out, every new plugin RPC will land in this file
  because the pattern invites it, and a reader hunting a config defect scrolls
  past 400 lines of local-item orchestration. `A17` names exactly this failure
  mode.
- Suggested fix: move the four orchestration helpers into
  `handlers/marketplace/` (extend `MarketplaceLocalItemsService` or add one
  sibling service there), and keep `registerReplaceKeptItems`,
  `registerResolveConfigHome`, `registerInstallExternal`, and
  `registerSaveConfig` as thin calls that delegate — the same shape
  `registerInstallExternal` already uses toward the installer. No public
  contract changes; the move stays inside one lib.

### 2. Moderate — the kind → reason mapping exists twice, byte for byte

- Where: `keptReasonForKind` (`plugin-rpc.handlers.ts:1459-1471`) and
  `keptReasonFor` (`marketplace-local-items.service.ts:350-362`). Both are new
  this phase, both in the same package, and both are the same switch from
  `ExternalLocalItemKind` to `KeptItemReason`.
- Why it matters: the mapping policy (an `agent-source` reports `shadowed`, a
  `library-clone` reports `owned-edited`) is domain knowledge now written in
  two files. A third caller will copy whichever is nearer. TypeScript's
  exhaustiveness check fires in both when a kind is added, so drift is caught
  at compile time — the cost is duplicated policy, not silent divergence.
- Suggested fix: export one function from the marketplace folder (either file
  works; `local-item-approvals.ts` is the most mechanical neighbor) and delete
  the copy in the handler file.

### 3. Moderate — two Zod boundary idioms in the same handler file

- Where: the new methods use `safeParse` plus a friendly `RpcUserError` —
  `plugin-rpc.handlers.ts:1109-1115` and `:1196-1202`. The sibling marketplace
  methods in the same file call `.parse(params)` and let the `ZodError` travel
  through `guard()` — `:610`, `:624`, `:640`, `:679`, `:804`.
- Why it matters: a caller that sends a malformed payload gets a different
  error surface depending on which sibling method it called, and a new author
  cannot tell from the file which idiom a new method should use. The repo rule
  ("Zod parse at boundaries") is met by both; the error contract is what
  differs.
- Suggested fix: one helper for the whole file — for example
  `parseUserParams(schema, params, userMessage)` in `plugin-rpc.schema.ts`
  that safe-parses and throws `RpcUserError` — and use it from all plugin
  methods, or map `ZodError` to `RpcUserError` inside `guard()`.

### 4. Minor — the handler re-declares params inline although this phase created the named DTOs

- Where: `plugin-rpc.handlers.ts:1106` inlines
  `{ decisions: Record<string, FileDecision> }` next to
  `PluginsReplaceKeptItemsParams` (`rpc-plugin-marketplace.types.ts:233-236`),
  and `:1193` inlines `{ action: 'adopt' | 'dismiss'; folder: string }` next to
  `PluginsResolveConfigHomeParams` (`rpc-misc.types.ts:621-626`). The handler
  imports the two result DTOs (`plugin-rpc.handlers.ts:88-89`) but not the
  params DTOs.
- Why it matters: the wire contract is written twice, in two packages, and a
  params-field change must find both. The file's older methods also inline
  (for example `:670-677`), so the new code follows the local idiom — but these
  two methods got brand-new DTOs in this phase, and one import line per method
  removes the duplication.
- Suggested fix: register with
  `registerMethod<PluginsReplaceKeptItemsParams, PluginsReplaceKeptItemsResult>`
  and the same for `plugins:resolve-config-home`.

### 5. Minor — the decisions bound is re-typed where its parity twin is defined

- Where: `plugin-rpc.schema.ts:34-35` declares
  `MAX_LOCAL_ITEM_DECISIONS = 256`, and `local-item-approvals.ts:32-33` declares
  `MAX_LOCAL_ITEM_APPROVALS = 256`. The schema comment claims parity ("At most
  as many decisions as the approval registry can hold approvals"), but the
  number is a second literal, not an import — and both files live in the same
  lib, one relative import apart.
- Why it matters: raise the registry bound and the schema silently stays at
  256; the parity comment becomes false, and a request the server would honor
  is rejected at the boundary.
- Suggested fix: `import { MAX_LOCAL_ITEM_APPROVALS } from
  './handlers/marketplace/local-item-approvals'` and derive the schema bound
  from it, or move the bound to `@ptah-extension/shared` beside the DTO.

## What the structure gets right (evidence for the clean part)

- Registry entries travel with their handler (A33):
  `rpc.types.ts:1364-1376` adds both methods in the neighbor shape (doc comment
  plus params/result), and the true-map entries (`:3287-3288`) sit inside the
  `plugins:` block beside their siblings.
- `rpc-allowlist.spec.ts:172-195` claims the two methods in the same
  describe-block shape as `wizard:plan-pack-install` (`:155-170`): registry
  membership, exactly one manifest owner (`plugin`), and the untouched
  `plugins:` prefix (`:192-194`).
- The guard specs mirror the `wizard:plan-pack-install` test shape on every
  host: `apps/ptah-electron/src/di/rpc-surface.spec.ts` (patch `:164-177`),
  VS Code (patch `:279-292`), and `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
  (patch `:356-369`). The three `container.smoke.spec.ts` blocks (Electron
  patch `:98-142`, VS Code patch `:216-259`, CLI patch `:23-66`) are identical
  in shape and document why the new services are not in `EXPECTED_RESOLVABLE`
  — confirmed against `apps/ptah-electron/src/di/expected-resolvable.ts:15-27`,
  a handler-class census that needs no change because the services register
  inside `register-shared-rpc-handlers.ts:98-104`.
- DI follows the file's own convention: class-token singletons, one rationale
  comment each (`register-shared-rpc-handlers.ts:92-104`), and the
  approval-registry comment states the cross-instance failure it prevents.
  Constructor injection in `skills-sh-rpc.handlers.ts:183-184` and
  `plugin-rpc.handlers.ts:233-240` documents each collaborator's role.
- `MarketplaceLocalItemsService` matches the repo rules point for point:
  kebab-case file with role suffix, contracts as interfaces
  (`marketplace-local-items.service.ts:63,73`), injected `Logger` (`:94`), no
  `console.*`, no `any` or `@ts-ignore`, and the optional mirror injection
  (`:100-101`) pairs the token from `skill-synthesis` with the type from
  `agent-generation` exactly as `harness-fs.service.ts:33-35,64` already does.
- The boundary schemas are precise: approval ids are UUID-keyed and the
  decisions record is bounded (`plugin-rpc.schema.ts:31-47`), and
  `resolve-config-home`'s `folder` is documented as compared-only, never used
  as a path (`:72-75`).
- `external-plugin-installer.service.ts` grows additively: the exported TTL
  (patch `:487-493`), `ConfirmedExternalInstall` with its
  strip-before-answer contract (patch `:516-523`, used at
  `plugin-rpc.handlers.ts:719`), and the public barrel exports
  (`libs/backend/plugin-marketplace/src/index.ts`, patch `:382-390`).
- Batch 21: `LibraryChangeFeed` implements `MessageHandler` with the same
  signature as the sibling `SurfaceUpdateInbox`
  (`surface-update-inbox.service.ts:79-86`) and hand-narrows the untrusted
  payload with the same guard idiom (`library-change-feed.ts:63-83`; the
  marketplace frontend lib has no Zod import, so the guard style is the local
  norm). `app.config.ts` registers it exactly like `HarnessHealthStore`, with
  a reason comment (patch `:313-324`). `PluginCatalogService.configHome` is a
  read-only computed, scoped and cleared on workspace switch
  (`plugin-catalog.service.ts:109-117,250-256,283-289`).

## The five style questions

1. What breaks when requirements change in six months? A fourth no-dialog
   family or a new item kind must be threaded through the family table
   (`plugin-rpc.handlers.ts:119-123`), two reason-mapping copies (finding 2),
   and two bound constants (finding 5) — and the next plugin RPC lands in a
   1515-line file (finding 1).
2. What would a new team member misread? The two Zod idioms (finding 3), and
   the params DTOs that exist in shared but are re-declared inline at the call
   site (finding 4) — both look like a deliberate choice and give no signal
   which one to copy.
3. What does this cost to maintain that a simpler shape would not? ~370 lines
   of local-item orchestration inside the plugin handler instead of beside its
   services, plus three duplicated literals/tables that each need a two-file
   edit on the next change.
4. Where is this inconsistent with how the same problem is solved elsewhere in
   the repo? A17 (finding 1). Everywhere else the phase matches its siblings:
   registry entries, allowlist block, guard specs, DI registration, token
   pairing, MessageHandler shape.
5. What would I have done differently? Move the four orchestration helpers
   into `handlers/marketplace/`, import the params DTOs, use one parse helper,
   and export one reason mapping. Each change deletes a second copy of
   something; none adds a layer.

## Checks run and remaining uncertainty

- Full reads and sibling comparisons as listed under Scope; size deltas from
  the hunk map of `p3-be.patch` (last hunks per file).
- No build, test, lint, or diagnostics run — the task scope forbids them. The
  recorded verification is cited from `batches.md:1044` (Batch 20 verify,
  8 projects) and `batches.md:1069` (Batch 21 verify, 3 projects).
- Runtime failure modes were not hunted; they belong to the code-logic review.
- Not read in full: `install-local-items.service.ts` (Batch 19, 370 lines) —
  confirmed only through its public contract (`ApplyLocalItemsReport`) and its
  callers; `p3-fe.patch` — the Batch 21 frontend files were read from the
  worktree directly instead.

## Decisions

- D1 — Attributed the whole +592 growth of `plugin-rpc.handlers.ts` to the
  P3 backend diff. Options: attribute per batch, or per phase. Evidence: the
  patch is the phase diff and its last hunk fixes the old file at 923 lines;
  `batches.md:1035` names this file as Task 20.1's modify target. Reversible
  if a per-batch diff says otherwise.
- D2 — Not reported: the `as unknown as ConstructorParameters<...>` casts in
  `plugin-rpc.handlers.spec.ts:492-504`. Options: report as a violation of the
  "no `as unknown as`" rule, or treat as the file's established test idiom.
  Evidence: the cast idiom at `:492-500` pre-dates this phase and the new
  lines `:502-504` copy it exactly; the rule reads as a source-code rule.
  Reversible.
- D3 — Treated `LibraryChangeFeed`'s hand-rolled payload narrowing as
  consistent, not as a "Zod at boundaries" violation. Options: require Zod
  here, or accept the sibling idiom. Evidence: the closest `MessageHandler`
  sibling (`surface-update-inbox.service.ts:79-86`) hand-narrows the same way,
  and no file in `libs/frontend/marketplace` imports Zod. Reversible.
- D4 — Verified instruction coverage: no `CLAUDE.md` or `AGENTS.md` exists
  under `libs/` or `apps/`; the root `CLAUDE.md` and the plan's project rules
  (A17, A21, A30, A33) are the governing documents for this review.
- D5 — Did not run `ptah_get_diagnostics`. Options: run it scoped to the
  changed files, or rely on the recorded batch verification. Evidence: the
  task scope says "no build/test runs" and both batch verification lines
  already record green runs for the affected projects. Reversible.