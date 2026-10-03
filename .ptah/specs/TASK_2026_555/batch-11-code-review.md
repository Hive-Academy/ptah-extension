# Batch 11 Code Review — `TASK_2026_555` (facade split step 3: `ProvidersConnectionSetupService`)

**Disclosure:** Author and reviewer are both in-process for this review (same-side). All CLI lanes
are out of quota (antigravity resets in ~30 min; opencode/Glm/codex out of quota per
`batches.md` execution default 5). Per execution default 6, a lane's absence is disclosed rather
than the review being withheld.

## Scope

Reviewed only the diff/new files listed by the requester:

- `libs\frontend\core\src\lib\services\providers-settings-state.service.ts` (modified) — read in full (610 lines), diffed against `git show HEAD:...`
- `libs\frontend\core\src\lib\services\providers-connection-setup.service.ts` (new) — read in full (314 lines)
- `libs\frontend\core\src\lib\services\providers-connection-setup.service.spec.ts` (new) — read in full (222 lines)

Read-only: no file in the working tree was modified, no `git stash` was used, only `git diff` /
`git show HEAD:<path>` were used to compare against the base commit, per `batches.md` execution
default 10.

Inputs consulted: `batches.md` "## Batch 11" (task 11.1, quality requirements, validation notes),
`implementation-plan.md` Component 6 (`:377-383`, `:865-868`, `:1107`, `:1137`), and
`.ptah/specs/TASK_2026_554/task.md` (554 acceptance: both files < 700 lines or a reason; no
behaviour change; specs pass with no assertion change).

## Verification run

- `npx eslint --rule "max-lines:[error,{max:700,skipBlankLines:true,skipComments:true}]"` on the
  three files: **no output** (rule not triggered) → all three are under the 700-counted-line
  budget. Raw line counts: facade 610, `providers-connection-setup.service.ts` 314, its spec 222.
- `npx eslint` (project config, no extra rule) on the two source files: **no output** — no lint
  errors or warnings.
- `npx nx test @ptah-extension/core`: **36 suites / 1012 tests passed** (Nx cache hit; hash is
  content-based so this reflects the current tree).
- `git diff --stat -- .../providers-settings-state.service.spec.ts`: **empty** — the facade spec's
  assertions are unchanged, satisfying the Batch 9-11 acceptance gate.
- `ptah_get_diagnostics` scoped to the three files: **no diagnostics in the requested files.**
  103 pre-existing TS errors were reported in *sibling* spec files
  (`auth-state.service.spec.ts`, `autopilot-state.service.spec.ts`, `electron-layout.service.spec.ts`)
  — none of these is touched by this diff and they are unrelated to connection setup (RPC generic
  typing / signal-mock typing). Not in scope for this batch; not attributed to it.

## Findings

### 1. (Minor) Leftover blank-line artifacts from the extraction

- File: `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:287-289` (three
  consecutive blank lines before `performExternalAuth`) and `:556-557` (a second blank line before
  the `commitHooks` comment).
- Problem: these are mechanical leftovers from deleting the ~350 lines that moved to the new
  collaborator (the diff shows `+`, `+` for both). The rest of the file uses a single blank line
  between members.
- Impact: cosmetic only; not caught by the project's `eslint` run (no `no-multiple-empty-lines`
  rule configured) or by Prettier in this check. No behavioural or readability risk beyond a
  slightly untidy diff.
- Fix: collapse to one blank line at each site.

### 2. (Minor, carried forward) Neither commit-pipeline collaborator is exported from the core barrel

- File: `libs/frontend/core/src/index.ts` — no `ProvidersCommitService` or
  `ProvidersConnectionSetupService` export (grep confirms zero matches for either name).
- Problem: `ProvidersCommitService` (Batch 10) was already flagged for this in the Batch 10 review
  and accepted as recorded debt. `ProvidersConnectionSetupService` repeats the same omission. Both
  are `providedIn: 'root'` and reached only through DI inside `core`, so nothing outside the lib is
  broken today, but a consumer that needs `ProvidersConnectionSetupHooks` or the class for a spec
  helper outside `core` cannot import it from the public surface.
  This is not a new problem this batch introduced, and Batch 11 does not claim to fix it.
- Impact: none currently observable; a latent gap if a future batch (12/13, which extend this
  collaborator) needs it from outside `core`.
- Fix: add both to `core/src/index.ts` when a real outside consumer needs them (per the "no
  speculative export" principle, not before).

No blocking or serious issues found. The extraction reads as a faithful, mechanical move.

## Detailed checks against the requester's list

**(1) Behaviour-neutral extraction**

- `git diff --stat -- providers-settings-state.service.spec.ts` is empty — confirmed above.
- `verifyDraft` (`providers-connection-setup.service.ts:245-270`) is byte-for-byte the method that
  was at the old facade's `:694-719` (per the `git diff`, the entire block was deleted from the
  facade and reappears in the new file with only `this.` targets changed from facade fields to
  service-local fields, since the probe generation state (`probeGeneration`, `probeId`,
  `verifiedProviderId`, `probeStore`) moved wholesale). Probe generation is incremented once per
  `verifyDraft` call, the previous id is aborted, and the store is reset to `unloaded` before the
  RPC call — same order as the old code.
- `cancelVerification` (`:271-290`) keeps the same shape: forwards a cancel for a
  probe id that doesn't match the current one without touching local state (`:272-273`), otherwise
  bumps the generation, resets `probeId`/`verifiedProviderId`/the store, and only on a *later*
  failure re-checks `generation === this.probeGeneration` before writing the error state (`:285`).
  This still prevents a superseded probe's late failure from clobbering a newer probe's state,
  matching the old code's generation re-check.
- `abortProbe` (`:302-313`) is the same best-effort `catch` + `console.warn` with a fixed log
  prefix (now `[ProvidersConnectionSetupService]` instead of `[ProvidersSettingsStateService]`,
  which is correct given the move) and the same comment about `require()` throwing a fixed
  message so no credential is logged.
- A superseded probe's late result is never shown: the spec
  `providers-connection-setup.service.spec.ts:105-117` ("aborts the previous probe on the host and
  never publishes its late result") and `:119-129` ("cancels the pending probe first, then ignores
  its eventual success") both exercise this and pass.
- `connectProvider` / `activateConnection` (`:123-230`) keep the Batch 8 stage rules verbatim: the
  `stage: 'setup' | 'tier' | 'activation'` markers on each pushed operation, the tier
  compare-and-set against `draft.tierSnapshot` (`:186-190`), and "activate LAST" ordering comment
  and code (`:198-208`) are unchanged from the pre-split facade (`git show HEAD:...:317-453`,
  confirmed via the deletion side of the diff). Blocking (`this.commits.block(...)`, returns `true`
  without writing) is preserved for: unverified/mismatched probe, invalid custom-entry shape,
  missing explicit tier with no provider default, and an unwritable target scope.
- `performExternalAuth` (`:77-117`) is unchanged apart from routing `refreshConnections`/
  `refreshRoute` through `hooks` instead of `this` — same unsupported-action branch, same
  `externalAuthGeneration` supersession check at `:107`, same signed-in derivation per provider.

**(2) `cancelVerification`'s `catch {}` change**

- `providers-connection-setup.service.ts:282-289`: the `catch` is unbound (`catch {`, no
  `error: unknown` parameter), so the raw host error object is never touched, logged, or attached
  as `cause`. Only the fixed string `'Could not cancel this check.'` leaves the method, and the
  section store gets the fixed `SECTION_LOAD_ERROR` constant, not any host text.
- Spec `providers-connection-setup.service.spec.ts:137-149` pins this directly: it throws
  `new Error('raw host text sk-secret')` from the host call and asserts the caught error
  `toEqual(new Error('Could not cancel this check.'))` and `.cause` is `undefined`. This is the
  same guarantee the pre-split facade code enforced with `void error;` (a bound-but-unused
  parameter) — the new unbound form is equivalent, just terser, and does not hide any failure the
  user needs to see: the user-visible signal is `service.verification()` flipping to
  `status: 'error'`, which the UI's existing "Retry" affordance for section errors already
  surfaces (per the plan's edge-case list, "Read error per region with Retry {label}").

**(3) Root singletons and DI shape**

- Both `ProvidersCommitService` and `ProvidersConnectionSetupService` are `@Injectable({providedIn:
  'root'})` singletons, consistent with Batch 10's collaborator and every other service in this
  directory.
- No circular DI: `ProvidersConnectionSetupService` injects `ClaudeRpcService`,
  `ProvidersCommitService`, `WorkspaceScopeService` (`:63-65`) — none of which inject
  `ProvidersConnectionSetupService` or `ProvidersSettingsStateService` (confirmed by grep on
  `providers-commit.service.ts`'s imports/injections: only `ClaudeRpcService` and
  `WorkspaceScopeService`). The facade depends on the collaborator; the collaborator never depends
  back on the facade. Communication in the other direction goes through the `hooks` parameter
  (`ProvidersConnectionSetupHooks`), the same pattern Batch 10 established for
  `ProvidersCommitHooks` — this keeps the dependency graph a DAG instead of using facade injection.
- Hooks exposure is minimal and matches actual use: `ProvidersConnectionSetupHooks` exposes
  `connections()`, `writeScopes(key)`, `commit` (the existing `ProvidersCommitHooks`),
  `refreshConnections()`, `refreshRoute()` (`:44-54`). Every one of the five is read inside
  `providers-connection-setup.service.ts` (`connections()` in `connectProvider`/`activateConnection`,
  `writeScopes` in `authWritable`, `commit` in the two `this.commits.run(...)` calls and the
  `block()` calls, `refreshConnections`/`refreshRoute` only in `performExternalAuth`). Nothing wider
  than the old facade's own surface is handed across the boundary; no RPC client, no other
  section's store, and no credential-bearing state crosses through `hooks`.

**(4) Line budget**

- `npx eslint --rule "max-lines:[...max:700...]"` produced no output for any of the three files —
  all are under the 700-counted-line ceiling (facade 610 raw, well under; the two new files at 314
  and 222 raw lines are trivially under). This satisfies Task 11.1's 554 acceptance line, and the
  facade is now well clear of the debt flagged at the end of Batch 10 (804 raw / 710 counted).

**(5) The new spec tests behaviour, not implementation**

- `providers-connection-setup.service.spec.ts` drives the service entirely through its public
  methods (`verifyDraft`, `cancelVerification`, `connectProvider`, `activateConnection`,
  `performExternalAuth`) and a hand-built `hooks` object (`:83-94`), asserting on
  `service.verification()`/`service.externalAuth()` (public signals), `commits.commit()` (the
  sibling collaborator's public state), the sequence of RPC methods called
  (`methods()` helper, `:48`), and the `events` array recording which hooks fired. It never reaches
  into a private field. The credential-non-leak assertion
  (`:166`, `expect(JSON.stringify(commits.commit())).not.toContain('private-key')`) is a genuine
  behavioural guarantee, not a structural one. This matches the shape of the Batch 10
  `providers-commit.service.spec.ts` collaborator spec (same hooks-driven pattern).

## Verdict

**Score: 9/10 — APPROVED**

- Behaviour-neutral per the facade-spec diff and the line-by-line comparison against
  `git show HEAD:...`.
- The `catch {}` change in `cancelVerification` leaks no host text and hides no user-facing
  failure — it is equivalent to the previous `void error;` form, pinned by a spec.
- No circular DI; the hooks contract is minimal and matches actual use.
- All three files are under the 700-line budget with room to spare.
- The new spec exercises behaviour through public members.
- Two minor findings (leftover blank lines; barrel export omission carried forward from Batch 10)
  do not block; neither is a behavioural or structural risk.
