# Code Review — TASK_2026_555 Batch 10 (facade split step 2: extract `ProvidersCommitService`)

**Disclosure: same-side review.** The author is an in-process `frontend-developer` and this review is
also in-process (`code-logic-reviewer`/`code-style-reviewer` combined). Per `batches.md` execution
default 5 ("Lane status update"), every CLI lane is currently out of quota (opencode/Glm/codex exhausted;
antigravity busy), so the cross-side route required by execution default 6 could not be used. This review
is read-only against the worktree at `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`;
no git command that changes anything, and no `git stash`, was used.

## Score

**9/10 — APPROVED**

## Scope reviewed

- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (modified, full read, 804 lines)
- `libs/frontend/core/src/lib/services/providers-commit.service.ts` (new, full read, 368 lines)
- `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts` (new, full read, 239 lines)
- Baseline comparison: `git show HEAD:libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
  (Batch 9 commit `827f8cdd2`, 1094 lines), copied read-only to
  `.ptah/specs/TASK_2026_555/_old-facade-batch9.ts` for line-by-line diffing (not committed as part of
  this review; it is scratch, per the "no git stash" rule's suggested alternative in `batches.md:97-98`).
- Inputs: `batches.md` Batch 9/10 sections and commit log; `implementation-plan.md:371-403` (Component 6);
  `batch-8-code-logic-review.md` (D15 outcomes, stage/skip matrix, the accepted stage-default deviation).
- Verification run: `npx nx test @ptah-extension/core --skip-nx-cache` → **35 suites, 997 tests pass**
  (fresh run, cache bypassed, foreground). `git diff --stat` for
  `providers-settings-state.service.spec.ts` is **empty** — no assertion changed.

## Findings

### 1. Behaviour-neutral extraction confirmed line-by-line (informational, not a defect)

- `git diff --stat` for the facade spec is empty, satisfying the Batch 9/10 acceptance gate
  (`implementation-plan.md:392-393`; `batches.md` Batch 10 verification line).
- `run()`/`settle()`/`contextMatches()`/`block()` in `providers-commit.service.ts:243-360` are the same
  logic as the HEAD `runCommit`/`settle`/`contextMatches` (`_old-facade-batch9.ts:942-1065`), with the
  facade's own state (`this.commitState`, `this.refreshScopes()`, `this.refresh()`, `this.scopes()`) replaced
  by the `context`/`hooks` parameters. Verified clause by clause:
  - In-flight refusal `run.ts:249` = HEAD `:947`.
  - Blocked-context/allowed branch `:252-261` = HEAD `:950-959`.
  - Stage/skip matrix `:268-287` = HEAD `:966-985` (byte-identical conditions).
  - Post-loop refresh + demotion-on-context-change `:290-294` = HEAD `:988-992`.
  - `refreshFailed` computation: new code uses `!hooks.sectionsReady()` where `sectionsReady()` is
    `.every(status === 'ready')` (facade `:753-766`); HEAD used `.some(status !== 'ready')` over the
    identical 12-section list (`route, scopes, mainSources, model, effort, memory, lanes, judging,
    cliAgents, cliModels, orchestration, connections` — HEAD `:993-1006`, new `:754-765`). These are
    De Morgan equivalents over the same list; the 12 sections match exactly, including order.
  - `settle()` `:324-350` = HEAD `:1035-1057` (throw → `unconfirmed`; `'conflict'` → `conflict`; `false` →
    `unsaved`; acknowledged + context change → `unconfirmed`; read-back mismatch → `unsaved`; read-back
    throw → `unconfirmed`) — D15 preserved exactly.
  - `contextMatches()` `:353-360` = HEAD `:1059-1065`, now reading `hooks.scopes()` instead of
    `this.scopes()`.
- The stage-default deviation batch-8-code-logic-review.md accepted (operations without a stage are
  independent, not `'setup'`) is untouched by this batch: `operations()` moved verbatim into
  `providers-commit.service.ts:61-236` with the same per-field construction, and the collaborator's own
  spec now pins the full stage/skip matrix (item 4 below), which was the reviewer's recommendation 4 in
  that review's Verdict section.

### 2. `ProvidersCommitService` is `providedIn: 'root'` and holds commit state — correct here, and it does not introduce a new sharing risk

- All 23 files in `CORE` follow the same `@Injectable({ providedIn: 'root' })` singleton pattern (verified
  by grep); this webview is a single-instance SPA per window, one Settings page mounted at a time, so a
  root singleton is the established shape, not a deviation.
- Before this batch, `commitState` was already a single signal shared by every command on the one facade
  singleton (HEAD `:115,139`). Moving it into a second root singleton does not change how many logical
  "commit slots" exist — there was one before, there is one now. Two facade consumers mounted
  simultaneously would collide exactly as they would have at HEAD (this is Failure mode 1 in
  `batch-8-code-logic-review.md`, explicitly deferred to Batch 17's request-scoped feedback, not
  reintroduced or worsened here).
- Workspace-switch leakage: `contextMatches()` (now in the collaborator, `:353-360`) is unchanged and is
  the mechanism that already guards against state leaking across a workspace switch — it demotes `saved`
  to `unconfirmed` when `workspace.scopeKey()` no longer matches the context captured when the edit
  started (`:291-294`, `:340`, `:344`). This is the same guard that existed at HEAD; the split does not
  weaken it because both the workspace check and the commit signal live in the same collaborator now.

### 3. `ProvidersCommitHooks` design — no circular DI, no leaked internals

- `providers-commit.service.ts` imports only `ClaudeRpcService`, `WorkspaceScopeService`, and the
  `providers-settings-sections`/`providers-settings.types` plumbing — no import of
  `ProvidersSettingsStateService`. Grep confirms no file outside `providers-settings-state.service.ts`
  itself references `ProvidersCommitService`/`ProvidersCommitHooks`, so the dependency edge is one-directional
  (facade → collaborator), matching the plan's collaborator shape (`implementation-plan.md:375-379`).
  No circular DI.
  - The `ProvidersCommitHooks` interface (`:34-40`) exposes exactly the four operations the plan named
    (`refreshScopes`, `refresh`, `scopes`, `sectionsReady`) — no facade-internal store, signal or private
    method leaks across the boundary. `sectionsReady` is a boolean projection, not the raw section list.

### 4. The new spec tests behaviour, not implementation

- `providers-commit.service.spec.ts` exercises: idle/blocked start state (`:79-90`), hook call order
  (`:92-96`), context/allowed blocking including a live workspace change (`:98-105`), in-flight refusal
  while a slow write is pending, with the in-flight feedback preserved (`:107-121`), the full D15 outcome
  matrix (`:123-141`, table-driven over 7 write/read-back combinations, plus a secret-leak assertion
  `JSON.stringify(commit)` never contains `sk-secret`), conflict-message wording and the workspace-change
  demotion (`:143-154`), refresh-failure reporting without changing the outcome (`:156-164`), and the full
  552 stage/skip matrix (`:167-219`, four cases: setup failure, tier conflict, unconfirmed setup +
  independent-write-still-stops-activation, and the all-saved path). `operations()` is covered separately
  for field-name-only construction and for never leaking a raw CLI credential (`:221-238`). This is
  behavioural coverage of exactly the contract `batch-8-code-logic-review.md`'s Verdict item 4 asked the
  Batch 10 spec to pin, not a reflection of internal structure.

### 5. Not exported from the core barrel — confirmed correct

- `core/src/index.ts` has no reference to `providers-commit`, `ProvidersCommitService` or
  `ProvidersCommitHooks` (grep, zero matches). A repository-wide grep for both symbols outside `*.spec.ts`
  finds them used only in `providers-commit.service.ts` (definition) and
  `providers-settings-state.service.ts` (the sole consumer). Nothing outside `CORE` needs it, matching the
  plan's "collaborator" framing (an implementation detail of the facade, not a public surface) and the
  facade rule that only the public class/token/signatures need to stay stable.

## Minor observations (not scored down)

- `require<T>()` (`providers-commit.service.ts:362-367`) duplicates the same three-line wrapper already on
  the facade (`:785-790`). This is the plan's own design ("the helpers take the workspace/RPC dependencies
  explicitly as parameters", `implementation-plan.md:391`) — each collaborator owns its own RPC dependency
  rather than importing the facade's private helper, so this is intentional, not accidental duplication.
  Flagging only so a later batch doesn't try to "DRY" it into a coupling the plan deliberately avoided.
- The facade is 804 lines, still over the 700-line budget. This is expected and explicitly deferred: the
  Batch 9 commit note already recorded "the < 700 acceptance applies at the end of Batch 11"
  (`batches.md`), and Batch 11 (`ProvidersConnectionSetupService`) is the batch that carries the
  line-count acceptance evidence (`implementation-plan.md:399-401`).

## Verdict

- **Recommendation: APPROVED**
- **Blocking issues: 0**
- **Serious issues: 0**
- **Minor issues: 2** (both informational, not fixes required for this batch)
- The extraction is behavior-neutral by direct comparison against `HEAD`, the facade spec has zero
  assertion changes, the D15/stage rules from Batch 8 are preserved verbatim and now independently pinned
  by the collaborator's own spec, there is no circular DI or leaked internal, and the collaborator is
  correctly kept off the public barrel. `npx nx test @ptah-extension/core` passes 997/997 on a fresh
  (non-cached) run.
