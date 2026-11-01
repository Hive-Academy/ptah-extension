# Code Logic Review — Batch B1b (TASK_2026_ONBOARDING)

Review family: ollama-cloud (implementer: claude)

## Scope

Uncommitted working-tree changes in the worktree only (HANDOFF.md excluded):

- NEW `libs/frontend/core/src/lib/services/claude-code-commands.ts` (+`claude-code-commands.spec.ts`)
- NEW `libs/frontend/chat/src/settings-embed.ts`
- `libs/frontend/core/src/lib/services/index.ts`, `providers-connection-setup.service.ts`
- `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+spec), `routing/index.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts` (+spec)
- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (+spec)
- `tsconfig.base.json` (one path)

Whole files were read for the new modules and the full specs; the two large modified components were read through their diffs plus the surrounding live code the new logic calls into (`requestedProviderId` effect, drawer-close effect, `openDrawer`, `openAccountSignIn`, `isClaudeCli`).

## Requirements checked against

- `implementation-plan.addendum-prereqs.md:1108-1150` (B1b), `:306-375` (Contracts), `:441-522` (components 1-3), `:765-805` (component 11)
- `design-spec.md:353-399` (§12.2, commands table `:388-393` and sign-in block `:397`)

## Findings

**No blocking defects.** Minor findings:

1. **minor** — `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:1064-1080`: the
   `requestedDrawer` effect has no `wizardOpen()` / `canStartSetup()` gate, unlike the adjacent
   `requestedProviderId` effect (`:1052`). If a request is bound while connections are still loading and the
   user opens the setup wizard before the list turns ready, the drawer opens on top of the wizard session.
   This is exactly what the plan prescribes (component 11, `:776-778`, names no wizard check, and
   `openAccountSignIn` gates nothing either), and no planned host binds both inputs — so it is a
   spec-conformant gap, not a regression. Fix if the gap is unwanted: add `|| this.wizardOpen()` to the
   early return at `:1072`, mirroring `:1052`.

2. **minor, test coverage** — `libs/frontend/core/src/lib/services/claude-code-commands.spec.ts:44-48`: row
   labels are asserted only as non-empty. The B1b acceptance "matching spec §12.2 verbatim" covers labels
   (plan Contracts `:318`), but no spec pins them, so a future edit to a label would pass every check. The
   labels are verbatim today (verified against `design-spec.md:390-393`). Fix: assert the four label strings
   verbatim alongside the commands at `:36-41`.

Observations (no change requested):

- The "command-string grep shows only the constant module" gate (`plan:1138`) is not literally met:
  `git grep 'npm install -g @anthropic-ai/claude-code'` also hits `apps/ptah-cli/src/cli/commands/doctor.ts:385`,
  `libs/backend/auth-providers/src/lib/auth/strategies/cli.strategy.ts:53` (+ its spec `:205`) and the exempt
  harness `settings-reachability.table.ts:1553`. The backend copies exist on `main` (verified via
  `git grep ... main`), sit in backend/CLI surfaces the frontend constant cannot unify (they cannot import
  `@ptah-extension/core`), and are untouched by this batch. Within `libs/frontend` and `apps/ptah-*` webview
  code the constant module is the only source.
- `git diff main -- libs/frontend/chat/src/index.ts` is non-empty only because local `main` is ahead of the
  branch's merge-base (`35203f1d8`); against the merge-base both chat barrels are unchanged and the working
  tree does not touch them. The eager-bundle gate holds for this batch, and
  `git grep 'chat/settings-embed'` finds zero importers (B1c will add the only allowed one).

## Verification performed

- Constants vs §12.2 `design-spec.md:388-393`: all four install rows (ids, tabs, labels, commands) verbatim;
  npm row built from `CLAUDE_CODE_NPM_INSTALL_COMMAND` (`claude-code-commands.ts:62`); sign-in command `claude`
  (`:13`); docs URL (`:20-21`) matches `design-spec.md:395`. Data only, no Angular/I/O — contract met.
- Credentials tab: copy at `credentials-tab.component.ts:137` matches plan line 449 exactly; `commands` array
  keeps ids `login`/`install` and both `data-testid`s (`:415-418`); aria-labels asserted by the spec
  (`credentials-tab.component.spec.ts:356-357`); the old `claude login` literals are gone from `libs/frontend`
  (grep clean).
- Setup message: `providers-connection-setup.service.ts:259` reproduces the RD15 string exactly, built from
  the constants; its spec was correctly not touched (it does not assert the message).
- Route builder vs Contracts: default `'claude'` → `{subPath:['ready'], queryParams:{}}`; `'settings'` →
  `['ready','settings']` with only the given keys (`onboarding-routes.ts:60-70`); parsers coerce anything
  unknown to `'providers'` / `null` without throwing or echoing (`:73-82`); `ONBOARDING_QUERY` untouched;
  no URL string concatenation. Spec covers both stages, both areas, `open` alone, unknown/absent/array/number
  inputs for both parsers (`onboarding-routes.spec.ts:108-184`).
- `requestedDrawer` vs component 11: input declared next to `focusTarget` (`providers-settings.component.ts:585`);
  the request type exported and re-exported by `settings-embed.ts:17`; the effect copies the
  `requestedProviderId` pattern — guard `${connection}:${tab}`, reset on `null`, waits without consuming the
  guard while `connections().status !== 'ready'`, opens once under `untracked` via `isClaudeCli` (`:612-614`,
  same lookup as `openAccountSignIn:1255`) and the existing `openDrawer(claude.id, tab)` (`:1240-1248`),
  including its focus-opener recording; non-Electron returns before reading any signal (`:1065`), so the
  inert host opens nothing; no Claude connection → guard set, silent no-op (plan `:789-790`); independent
  guard variable, so `requestedProviderId` is unaffected. Spec covers all six prescribed cases
  (`providers-settings.component.spec.ts:1150-1215`), including "exactly once" measured through
  `refreshConnectionSetup` call counts and the close/clear/re-set cycle.
- Embed entry: five values plus the type, header comment states the page-scope contract and the
  lazy-only-importer rule; `tsconfig.base.json:217-219` adds exactly one path; barrels untouched.
- Tests: the orchestrator reports core, chat and webview typecheck+test green and ptah-electron
  lint+typecheck green; I did not re-run them (no new behaviour beyond what those suites exercise was
  claimed).

## Five logic questions

1. **Silent failure:** the named-account link with no Claude CLI connection in a loaded list sets the guard
   and opens nothing, with no feedback (`providers-settings.component.ts:1076-1078`). This is the plan's
   prescribed no-op (RD/component 11 `:789`), and the link only appears when stage 1 found the CLI installed;
   accepted, covered by a test.
2. **Unexpected user action:** closing the drawer with the request still bound does not reopen it; clearing
   and re-setting does; a same-key re-set does not — all three tested (`providers-settings.component.spec.ts:1179-1192`).
3. **Wrong answer instead of error:** `parseOnboardingReadyArea`/`parseOnboardingReadyOpen` coerce arrays,
   numbers, empty strings and undefined to the defaults rather than throwing or echoing
   (`onboarding-routes.ts:73-82`, tested); the builder emits only the keys it was given.
4. **Dependency failure:** a connections read error leaves the effect waiting (guard unset), so the
   component's retry UI stays the only path — per plan `:790-791`. `openDrawer` voids
   `refreshConnectionSetup` as before; no new rejection path was added by this batch.
5. **Missing from requirements:** only finding 2 — label text is inside the acceptance but outside the
   spec's assertions; every other contract line has either code or a test pinning it.

## Decisions

- The backend `npm install` copies (observation above) are not counted against the grep gate: they predate
  the branch, live in surfaces the frontend constant cannot serve, and the plan's gate is scoped to the
  settings/onboarding drift it exists to prevent. Reversible: a follow-up task could move the string into
  `@ptah-extension/shared` if backend alignment is ever wanted.
- Finding 1 is reported as minor rather than blocking because the plan's component 11 prescribes the
  implemented logic verbatim and no planned host reaches the state; changing it would deviate from the
  reviewed spec, which is the architect's call, not the reviewer's.

## Score

**9/10.** Exemplary: every contract line in the plan maps to code that matches it verbatim, the failure
modes the plan names are implemented and pinned by tests, and the two minor findings are a spec-conformant
robustness gap and an unpinned acceptance detail — neither reachable as a user-visible defect in the
planned hosts. The evidence separating this from a lower band: constants byte-compared against §12.2, the
effect traced against its model pattern line by line, and both gate greps run (with the pre-existing,
out-of-scope hits documented above).

Verdict: APPROVED