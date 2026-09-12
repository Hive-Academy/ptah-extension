# CI gate fixes — PR #494 (TASK_2026_411)

Branch `fix/task-411-profile-performance`, two commits on top of `d035565c7`. Not pushed.

## Failure 1 — di-lint gate: 3 unregistered `@inject` tokens

**Root cause.** `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts:12,14,16`
injected `AUTH_PROVIDERS_TOKENS.CODEX_HOME_OVERRIDE`, `CODEX_ENV_OVERRIDE` and
`CODEX_HOMEDIR_OVERRIDE` with `{ isOptional: true }`. The three tokens were declared in
`libs/backend/auth-providers-tokens/src/lib/tokens.ts:26-28` and registered by nothing, anywhere.

`tools/di-lint/check-injects.ts:311` computes violations as
`injected.filter((site) => !registered.has(site.resolved))`. It reads **no** `isOptional` flag,
and it has **no allowlist** — `SCAN_IGNORE` (line 41) skips only fixtures, specs and `.d.ts`.
So an optional injection is held to exactly the same bar as a required one, by design.
A token is satisfied only by a `register` / `registerSingleton` / `registerInstance` /
`registerType` call, or a `provide:` property, inside a file matching `REGISTRATION_GLOBS`
(line 26).

**Precedent found.** Optional injections do exist in this repo (e.g.
`vscode-lm-tools/src/lib/diagnostics/diagnostics-cache-invalidator.service.ts:128`), but in
every case the token **is** registered somewhere — optionality governs resolution, not
registration. There is no precedent for an unregistered token, and no ignore mechanism to
follow. These three were the only ones of their kind.

**Why registration was not the fix.** Registering them was actually unavailable, not merely
inelegant. tsyringe's value-provider predicate is
`provider.useValue != undefined` (`node_modules/tsyringe/dist/cjs/providers/value-provider.js:5`),
so `{ useValue: undefined }` is not recognised as a value provider at all and would fall
through to constructor handling. And there is no production-neutral concrete value for a
"homedir override" — any value registered would be a real value the resolver then honours.

**Fix.** Removed the DI seams entirely. `CodexHomeResolver` is now a plain class (no
`@injectable`, no `@inject`, no tsyringe import) whose three constructor parameters are
ordinary optional arguments. The three tokens are deleted.

The one hazard this had to avoid: leaving `@injectable()` + `{ useClass: … }` while dropping
the decorators would make tsyringe resolve the *reflected* parameter types — `String`,
`Object`, `Function` — and construct them, so `override` would become a truthy `new String()`
and silently change the resolved path. `register-providers.ts` therefore builds the resolver
with `instanceCachingFactory(() => new CodexHomeResolver())`, which is precisely the
no-argument instance container construction already produced when all three optional tokens
resolved to nothing. `instanceCachingFactory` and not `{ lifecycle: Lifecycle.Singleton }`
because tsyringe throws `Cannot use lifecycle "Singleton" with ValueProviders or
FactoryProviders` (`dependency-container.js:51-55`) — the same reasoning already recorded in
`libs/backend/agent-generation/src/lib/di/register.ts:77-80`.

**Production behaviour**: identical. Single instance per container preserved.
**Specs**: `codex-home-resolver.spec.ts` (4 tests) unchanged and passing — it already
constructed the resolver directly, which is what made the seams redundant.
`codex-auth.service.ts:110`'s `= new CodexHomeResolver()` default is unaffected.
**Spec added**: none. No behaviour changed, and the existing 4 tests already cover all three
parameters.

## Failure 2a — SonarCloud CRITICAL: bare `.sort()` on strings

**Root cause.** `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:301`,
`for (const name of names.sort())` in `listAgentFiles`.

**Is the order meaningful?** No — it is a determinism guarantee only. The comment at line 251
(`Promise.all` keeps input order, so `owned` stays in sorted file order) is the only consumer
of the ordering, and everything computed downstream is order-independent: token sums and
`agentSessionCount`. No spec asserts a specific file order
(`session-stats-reader.service.spec.ts` asserts totals and counts).

**Fix.** An explicit comparator, `(a, b) => a.localeCompare(b, 'en')`, over a copy
(`[...names]`) rather than mutating the array returned by `fs.readdir`. The locale is pinned
explicitly for the reason the order exists at all: a host-locale-dependent collation is not a
determinism guarantee.

**Spec added**: none — no behaviour change, and the existing suite covers the path.

## Failure 2b — SonarCloud MAJOR: "loop body allows only one iteration"

**Root cause.** `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:974`,
`readFirstOutputPage`: a `for await` whose body unconditionally `return`ed on the first
iteration.

**Which of the two was it? A genuine take-first, not a defect.** Evidence:

- The method is named `readFirstOutputPage` and returns a single `AgentOutputPage`.
- Its sole caller is the budget-search loop at lines 938-965, which does not want more pages —
  it re-invokes this method with a *new* `budget` (and the same `cursor`) on each probe, then
  bisects. Reading a second page would be reading past the budget it is trying to measure.
- Paging forward is the *caller's* job via `nextCursor`: `session-metadata-store.spec.ts`
  drains multi-page output by feeding `page.nextCursor` back into `getAgentOutputPage`
  (the `drain` helper, and the test at line ~879).
- The genuine full-drain sibling (`getAgentOutput`, line ~825) is a real loop over the same
  API, and is untouched.

So no logic was broken and no logic fix was warranted. The loop was stated directly instead.

**Fix.** Explicit take-first: get the async iterator, `await pages.next()` once, return the
empty page when it is already `done`, otherwise destructure the first value.

**The one real hazard, and why a spec was added anyway.** `for await` calls the iterator's
`return()` on an early exit; hand-iteration does not. Implementations are async generators
over a file or a worker channel (`platform-electron/src/implementations/electron-state-storage.ts:176`
is `async *readJsonSequence`, delegating to a worker host), so abandoning one without
`return()` leaves its `finally` unrun — a leak once per page request, and the budget search
issues several per call. The replacement closes the iterator in a `finally`.
`session-metadata-store.spec.ts` gains **`closes the page iterator rather than abandoning it`**,
which drives a generator whose `finally` sets a flag and asserts the flag is set after
`getAgentOutputPage` returns. It fails if the cleanup is dropped.

## Gate results

All run in the foreground from the worktree, after the commits (so the husky/lint-staged
`nx format:write` rewrite is included in what was verified).

| Gate | Result |
| --- | --- |
| `npx nx run di-lint:lint` | **PASS** — `di-lint OK: 1463 @inject sites all resolve to a registered token (668 tokens)` (was: `FAIL: 3 unregistered`) |
| `npx nx run di-lint:self-test` | **PASS** — `fixture violation detected, exit code 1 as expected`; the linter is still able to fail |
| `nx test @ptah-extension/auth-providers` (focused) | **PASS** — 40 suites, 747 tests |
| `nx test @ptah-extension/agent-sdk` (focused) | **PASS** — 90 of 92 suites (2 pre-existing skips), 1568 passed, 3 skipped |
| new spec, name-filtered | **PASS** — `1 passed, 1570 skipped`, confirming it really executes |
| `nx run-many -t test -p agent-sdk auth-providers rpc-handlers` | **PASS** — header `Running target test for 3 projects`; 747 + 1568 + 2742 passed |
| `nx run-many -t typecheck -p` (same 3) | **PASS** — 3 projects |
| `nx run-many -t lint -p agent-sdk auth-providers` | **PASS** — **0 errors** (4 and 41 warnings, all pre-existing: `max-lines`, `no-non-null-assertion`, an unused disable directive) |

Note on the focused runs: `--testPathPattern` is not forwarded by this repo's jest executor
(it ran every suite in the project), so the focused runs were in effect whole-project runs.
The new spec was confirmed to execute separately via `--testNamePattern`.

One lint error was introduced and fixed before committing: Prettier placed
`[Symbol.asyncIterator]()` on its own line, tripping `no-unexpected-multiline`. Hoisting the
iterable into a `sequence` const removed it. No spec with no diff failed under load.

## Commits

```
4c81a166e fix(agent-sdk): sort agent files deterministically and drop the single-pass loop
56cd72cdf fix(auth-providers): drop the codex home resolver di seams
d035565c7 docs(task-specs): record TASK_2026_411 b9 lint closure
112ba28d9 style(platform-electron): drop redundant boolean annotations in the worker host spec
```

`git status --short`: clean (no output). **Not pushed.**

## Files changed

- MODIFIED `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts` — plain class, seams are ordinary optional parameters
- MODIFIED `libs/backend/auth-providers/src/lib/providers/register-providers.ts` — `instanceCachingFactory` in place of `useClass` + `Lifecycle.Singleton`
- MODIFIED `libs/backend/auth-providers-tokens/src/lib/tokens.ts` — three unused override tokens deleted
- MODIFIED `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts` — explicit sort comparator
- MODIFIED `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — explicit take-first with iterator close
- MODIFIED `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts` — iterator-close regression spec

## Out-of-scope observations

- `session-metadata-store.ts` is 931 lines and `sdk-permission-handler.ts` 896, both over the
  700-line warn ceiling. Pre-existing; not touched.
- `session-stats-reader.perf.spec.ts:223` carries an unused `eslint-disable` for `no-console`.
  Warning only, outside this batch's files.
- SonarCloud's quality gate cannot be confirmed green from here — it re-evaluates on the next
  analysis of the PR. Both reported issues are addressed at the exact reported lines.
