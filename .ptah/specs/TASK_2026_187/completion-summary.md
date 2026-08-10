# TASK_2026_187 — completion summary

**Webview initial bundle: 3,628,659 B / 694.00 kB → 2,200,514 B / 467.90 kB.**
**−1,428,145 B (−39.4 %) raw, −226.10 kB (−32.6 %) transfer.**
**`maximumError` restored from the `4mb` stopgap back to `3.5mb`.**

Status: **done**. Closed 2026-08-10. Five batches, ten units (one removed, one added
mid-flight, one a user-authorised scope expansion), five commits.

---

## 1. What the task was actually about

`context.md` opened with a number that was not the byte count:

> _"Under 8 kB of a 3.63 MB application is deferred. That is the finding."_

The webview had no Angular Router, so it had no lazy-loading seam at all. Every heavy
surface — Monaco, xterm, the editor lib, all seven inversion-token feature components —
was registered eagerly at the root in `app.config.ts`. The production build had already
crossed the `3.5mb` error budget and the ceiling had been raised to `4mb` on 2026-08-09 to
unblock it. That bought headroom and fixed nothing, and restoring it was the thing that
would declare the task finished.

**The deferred share of the app went from 0.22 % to 40.5 %.** That inversion is the result;
the byte count is how it was measured.

---

## 2. The ledger — per batch, delivered vs estimated

| Batch / Unit | What shipped                                                                                 |                                Estimated |                                          Actual | Verdict                                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------: | ----------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Batch 1**  | editor wide barrel → `@ptah-extension/editor/services`                                       |                           some reduction | **0 B**, `main.js` byte-identical (1,904,251 B) | **Estimate wrong.** esbuild had already tree-shaken the wide barrel. R6 anticipated exactly this and said "measure per lib, drop the barrel half rather than carry dead scaffolding" — which is why the batch was not a failure. It also made Batch 1 a clean control: it provably could not have moved TTI. |
| **Batch 2**  | `LazyViewService`; marketplace + tribunal → lazy tokens. **Canvas deferred, then reverted.** |                      ~118 kB from canvas |        canvas bytes **given back deliberately** | **The single most instructive batch.** See §3.                                                                                                                                                                                                                                                               |
| **Batch 3**  | `@defer` thoth-shell + narrow service barrels. **Dashboard NOT deferred.**                   |                        dashboard 35.7 kB |        35.7 kB **left on the table on purpose** | R15's first pre-ship catch.                                                                                                                                                                                                                                                                                  |
| **Batch 4**  | tasks-ui + harness-builder → lazy tokens. **`setup-wizard` NOT deferred.**                   |                          wizard 109.0 kB |       109.0 kB **left on the table on purpose** | Batch 4 close: **2,536,716 B** — 36,716 B _over_ the 2,500,000 B target.                                                                                                                                                                                                                                     |
| **Unit 6**   | `@defer` the settings view                                                                   |                                  ~150 kB |                    **REMOVED by user decision** | settings is the _first-run_ launch surface. §3.                                                                                                                                                                                                                                                              |
| **Unit 9**   | 32 prebuilt daisyUI themes → lazy `theme-extra.css`                                          | framed as attacking a **276,070 B** item |                                   **−24,153 B** | **Mis-sized ~3×, not mis-executed.** §5.                                                                                                                                                                                                                                                                     |
| **Unit 10**  | zod out of the eager bundle                                                                  |     scoped **out** of the plan (§7, I-8) |                                  **−312,052 B** | User-authorised expansion. §4.                                                                                                                                                                                                                                                                               |
| **Unit 7**   | `message-bubble.component.css` split                                                         |                                 ~0 bytes |                                        **+3 B** | Bought out a 977 B budget overage for 3 bytes.                                                                                                                                                                                                                                                               |
| **Unit 8**   | `maximumError` `4mb` → `3.5mb`                                                               |                                  0 bytes |                                         0 bytes | The change that declares the task finished.                                                                                                                                                                                                                                                                  |

**Endpoints and reconciliation.** 3,628,659 B, 2,536,716 B (Batch 4 close) and 2,200,514 B
are directly measured filesystem sums. The four Batch 5 unit deltas reconcile exactly against
them. The Batches 1–4 cumulative figure (−1,091,943 B) is derived by subtraction from those
endpoints rather than independently re-measured — stated here so the ledger is not read as
more precise than it is.

**`main.js` (I-4)**: 1,904,251 B / 353.23 kB → **186,883 B / 44.08 kB**, −87.5 % transfer.
The requirement was only that it never _grow_.

**`modulepreload` (R7)**: 10 entries at baseline, 10 entries at the end, every one resolving
to an initial-list file. **Zero of the 13 lazy chunks are preloaded.**

**Commits**: `bfc9641` (Unit 9) · `36775671e` (Unit 10) · `a91babff2` (Units 7 + 8), plus the
Batch 1–4 commits recorded in `tasks.md`.

---

## 3. R15 — never defer the launch surface

**This is the most transferable thing the task produced, and it is not a bundle finding.**

It changed the shipped outcome **three times**, and a fourth if you count Unit 6's removal:

1. **Canvas (Batch 2) — deferred, measured, reverted.** The only launch surface actually
   shipped deferred. Cost **+70–100 ms** Electron startup TTI (306 → 406 ms as first
   specified; 376.5 ms median even after being revised to load at bootstrap). Reverted;
   `gridstack` came back into the initial bundle with it. **~118 kB given back.**
2. **Dashboard (Batch 3) — caught before shipping.** `ptah.openDashboard` is a VS Code
   **activation event** (`apps/ptah-extension-vscode/package.json:42`) that calls
   `createPanel({ initialView: 'analytics' })`. A fresh webview boots straight onto analytics
   with a user waiting on it. **35.7 kB left on the table.**
3. **`setup-wizard` (Batch 4) — caught before shipping.** `ptah.setupAgents` is an activation
   event whose handler builds a **dedicated panel hardcoding `initialView: 'setup-wizard'`** —
   a stronger case than the dashboard's generic `createPanel`. **109.0 kB left on the table.**
4. **Settings / Unit 6 — removed by user decision.** `app-shell.component.ts:355-357` runs an
   auth-redirect effect at startup that calls `setCurrentView('settings')` when no auth is
   configured. **For a first-run user, settings IS the launch surface** — the worst population
   to spend a module hop on. This was the one place the plan proposed deferring a launch
   surface _on purpose_, accepting one module hop for ~150 kB. The user declined.

### The general rule

> **Moving bytes off the initial budget does not move them off the critical path when the
> deferred surface is the one that opens.**

**All four would have passed the bundle budget.** That is the entire point. The budget check
is not a proxy for startup latency, and on this codebase it never once caught the thing that
mattered. Every one of these was found by asking a different question.

### The question that actually works

Not _"is this view navigable at startup?"_ — that is answerable from inside the webview and
it gives the wrong answer. The question is:

> **Is there an activation event, contributed command, deep link, dedicated panel, or
> restored-state path that opens directly onto this surface?**

In all four cases **the disqualifying evidence lived outside the webview** — in the VS Code
extension-host manifest, or in an Electron shell constructor. A frontend-only reviewer, and
every automated gate in this task, would have shipped all four.

### The hit rate is itself the finding

**R15 disqualified a candidate in every single batch that applied it.** Cumulative bytes
deliberately declined: **~118 kB + 35.7 kB + 109.0 kB ≈ 263 kB**, plus Unit 6's ~150 kB.
That is not waste. It is the task refusing to buy budget with latency — and it still landed
−1.43 MB by taking bytes from surfaces that genuinely are reached only by explicit
navigation.

---

## 4. What made Unit 10 safe

Unit 10 removed `zod` (304 kB) from the eager bundle by replacing six `.safeParse` call sites
on the streaming hot path with hand-written parsers.

**It was scoped out of the plan.** Plan §7 and I-8 put `libs/shared`/`zod` explicitly out of
bounds; `tasks.md` said _"Do not touch `libs/shared`/`zod` to make up a shortfall"_ and told
the batch to STOP and escalate rather than improvise a fourth lever. **Unit 9 did stop and
escalate** at its 12,563 B shortfall, and the user then authorised the work explicitly. It was
only reached after every other lever was exhausted. This is the sanctioned path, not a batch
improvising around a constraint — recorded so no future reader mistakes it for one.

**Hand-writing a validator at a trust boundary is normally a bad idea. What made it
acceptable was differential equivalence testing, not review.**

`libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` runs both implementations over
**3,063 differential inputs**, asserting identical accept/reject, `toStrictEqual` output (so a
key present-but-`undefined` is not equated with an absent key), key order, and array
frozenness. A companion assertion per schema proves the corpus exercises **both** outcomes, so
it cannot pass by rejecting everything.

**The corpus caught four real divergences the author had gotten wrong.** Review had not.

- **`z.record` applies a far stricter plain-object test than `z.object`.** The first parser
  accepted a `Date` as `toolInput` where zod rejects it. Over structured-clone IPC (Electron)
  a `Date` or `Map` really can arrive — so this would have **quietly widened the trust
  boundary**, exactly the failure mode the whole constraint existed to prevent. The derived
  rule was then validated against zod over 26 exotic inputs, all 26 agreeing.
- `z.number()` is a finiteness check — it rejects `NaN` and `±Infinity`.
- `.int()` enforces the **safe**-integer range, not merely integrality.
- `z.string().uuid()` is version-agnostic while `UUID_REGEX` is v4-only — and
  `PermissionRequestSchema` uses **both**.

**It also removed a live crash path.** `z.array().readonly().safeParse()` **throws a
`TypeError`** on a non-empty typed array instead of returning `success: false` — zod freezes
before the array check rejects, and V8 refuses to freeze a non-empty ArrayBuffer view.
`handleSessionTurnEnded` has **no `try`/`catch`**, so today that propagates out of the message
handler. The parser rejects instead, and the spec asserts precisely that, so this side can
never silently become the weaker one.

**Net: the streaming trust boundary is unchanged in what it admits, and strictly improved in
one crash mode.**

Deferral was rejected for the six streaming sites — `session:turnEnded` / `chat:chunk` arrive
on the hot path with no queue, and dropping or reordering a streaming message is far worse
than 304 kB (this task's own record: a 118 kB win reverted over 70 ms). The one `tasks-ui`
site **does** defer, because it surfaces `error.issues[0].message` verbatim to users.

**Transferable rule**: replacing a validator at a trust boundary is defensible when
equivalence is _demonstrated over a differential corpus that provably exercises both
outcomes_, and indefensible when it is asserted by review. The corpus found four things four
eyes did not.

---

## 5. Estimates ran consistently optimistic

Worth recording as a caution, because it happened more than once and in the same direction.

**Unit 9 was mis-sized by roughly 3×.** The plan framed the daisyUI theme split as attacking
`styles.css` at **276,070 B**. The 32 prebuilt themes were only **25,164 B of it — 9.1 %**.
The rest is Tailwind base + utilities + the daisyUI _component_ layer, none of it per-theme.
Unit 9 moved **100 % of the available theme bytes** and still left a 12,563 B shortfall
against a 36,716 B gap. It was mis-sized, not mis-executed — and because it was the batch's
only remaining lever, the mis-sizing is what forced the Unit 10 escalation.

**Batch 1 was estimated to reduce bytes and reduced zero** — esbuild had already tree-shaken
the wide barrel (R6 called this as a live possibility and it was correct).

> **Measure the component, not the container.** "This file is 276 kB and contains the thing
> we want to move" is not the same claim as "the thing we want to move is 276 kB." On this
> task the difference was 10×, and it changed the scope of the whole final batch.

The corollary that actually saved the task: `tasks.md` labelled Unit 9's expected delta
**UNMEASURED, and say so** rather than inventing a number. That instruction was correct and
should be reused.

---

## 6. What is now permanent

The task leaves behind re-runnable infrastructure, not just a smaller bundle:

- **`startup-tti.spec.ts`** — the Electron startup TTI anchor. It is the instrument that
  caught the canvas regression and it is re-runnable by anyone proposing to defer another
  surface. **This is the guard against R15 being forgotten.**
- **E2E coverage of every deferred surface** — canvas grid, marketplace, tribunal, Thoth
  (4 sub-tabs), analytics, tasks, setup wizard, harness builder, setup hub. Each opens and
  renders behind its lazy chunk.
- **The two `message-handlers-eager` specs** (`specs/thoth/`, `specs/tasks/`) — these prove
  the load-bearing invariant of the whole narrow-barrel approach: **services stay eager while
  components go lazy**. A future barrel change that silently drops a `MESSAGE_HANDLERS`
  registration (R4) now fails a test instead of silently dropping push messages.
- **`wire-parsers.equivalence.spec.ts`** — the 3,063-input differential corpus. As long as
  `zod` remains a devDependency-reachable import in the spec, any drift between the
  hand-written parsers and zod's semantics fails CI.
- **`streaming-message-handlers.spec.ts`** — accept/reject of all six rewritten parsers
  against the real running Electron renderer, not just Jest.
- **`theme/theme.spec.ts`** — 5 tests including the highest-value one: `theme-extra.css` is
  **never fetched** for the default-theme majority.
- **The restored `3.5mb` ceiling itself** — a real gate again rather than a raised one.

---

## 7. Open items — carried out of this task, not resolved by it

| Item                                              | Status                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TASK_2026_196**                                 | Pre-existing Monaco overlay bug — terminal resize and diff overflow. Reproducible, unrelated to this task, deliberately not touched. One e2e failure (`editor.spec.ts:73`) is attributable to it.                                                                                                                                                                        |
| **TASK_2026_195**                                 | Workspace / view state scoping.                                                                                                                                                                                                                                                                                                                                          |
| **Human gate H1**                                 | _"No `anubis` flash on the first painted frame"_ for a non-default-theme user. **Proven not provable in the e2e harness** — three instruments tried and rejected (see §8). Needs a pair of eyes.                                                                                                                                                                         |
| **Paint-timing instrument anomaly**               | **Unresolved and unexplained.** See §8.                                                                                                                                                                                                                                                                                                                                  |
| **Remaining manual gates**                        | Monaco diff add/remove highlighting seen not inferred (I-5 / R1); `@else` spinner visual check under throttling; a human looking at a rendered message bubble (new from Unit 7).                                                                                                                                                                                         |
| **Structural follow-ups, recorded not attempted** | Deferring the two shells (plan §5 — requires a measured TTI comparison first, and R15 says expect it to fail). Splitting the eager `MESSAGE_HANDLERS` services into their own Nx libs (the `memory-contracts` / `voice-contracts` shape), which would remove the static-vs-dynamic import tension and make the `checkDynamicDependenciesExceptions` entries unnecessary. |

### The paint-timing anomaly, stated plainly

`first-paint` / `first-contentful-paint` came back as an **empty array in 8 of 8** runs
against the final build. Unit 10's own report independently saw it in **8 of 11** and could
not resolve it either. It is therefore a **confirmed, reproducible property of the current
build in this harness**, not a one-off flake.

**Why it matters**: §8/§9/§10 of `e2e-validation-report.md` used paint timing as a
_corroborating control_ — an independent signal to separate a real wall-clock TTI delta from
session-wide machine drift. **That control was unavailable for the final measurement round.**

The fallback signals both say no regression: wall-clock median **220 ms** (against §8's clean
post-revert baseline of 215 ms and Batch 4's 218 ms) and `domContentLoadedEventEnd` median
**152 ms**, which is _better_ than Unit 10's own after-condition figure of 170 ms.

**But the confidence is materially lower than earlier rounds, and that is recorded rather
than smoothed.** One untested theory: both Unit 9 and Unit 10 touch the pre-paint document
path, and `theme-extra.css`'s `<link>` insertion may change when the browser's paint-timing
hooks fire. **Not confirmed.** Anyone re-running TTI work here should expect to fix the
instrument first.

---

## 8. Honest notes

**Commit `36775671e` knowingly contains 6 added lines of a concurrent session's work.**
The `@ptah-extension/output-styles` path mappings in `tsconfig.base.json`,
`apps/ptah-cli/tsconfig.build.json` and `apps/ptah-electron/tsconfig.build.json` (3 lines
each) belong to TASK_2026_197, not to this task. They are **inert** — they point at
`libs/backend/output-styles/src/index.ts`, which was untracked and absent from HEAD, and
nothing committed imports it.

Hunk-splitting them was **mechanically impossible without a worse outcome**, for two
independent reasons:

1. This repo's `pre-commit` runs `lint-staged --no-stash`, which **implies
   `--no-hide-partially-staged`** — a partially-staged file is committed **in full**
   regardless of what was staged.
2. The mandatory `nx run ptah-electron:validate-deps` gate performs a real esbuild of the
   electron main bundle **from the working tree**. Removing the mapping from
   `apps/ptah-electron/tsconfig.build.json` would break it, because their
   `phase-2-libraries.ts` imports `@ptah-extension/output-styles`.

Omitting the mappings entirely was worse still: `@ptah-extension/shared/schemas` would not
resolve at HEAD and `ptah-electron:build-main` would fail. **No `--no-verify` was used
anywhere in this task; every hook ran and passed.** The concurrent session's staged index
entry was parked and restored byte-identically.

The same discipline was applied at the final commit (`a91babff2`): the concurrent session had
`session-query-executor.service.ts` staged in the shared index. It was attributed by reading
its diff (a pure prettier reformat in `agent-sdk`, unrelated to bundle work), **excluded** via
an explicit-pathspec `git commit -- <paths>`, and its index blob verified byte-identical
afterwards. `git show --numstat` confirms exactly 4 files.

---

**`npx nx reset` does not work on this machine.** It failed **4 for 4** across this task
(Batch 1 ×2, Unit 9, Unit 8), always with
`EPERM … \\?\D:\projects\ptah-extension\.nx\workspace-data`, and **it does not succeed on
retry** — the original R12 guidance saying it does is wrong and was superseded by R12a.

**The working substitute, 3 for 3:**

1. Stop the Nx daemon.
2. Delete the four graph artifacts inside `.nx/workspace-data` directly:
   `project-graph.json`, `file-map.json`, `source-maps.json`, `nx_files.nxt`.
3. `mkdir -p .nx/cache/terminalOutputs` — otherwise the pre-commit hook crashes with
   `ENOENT` on a fresh checkout.
4. Re-run the build.

This matters because of **F-11**: `--skip-nx-cache` does _not_ refresh the Nx project graph,
so a `project.json` budget edit is read **stale** and the budget check silently passes against
the old value. Do not skip the reset — apply the substitute. Both times it was used, the
refresh was **verified rather than assumed**, by reading the value back off the recomputed
graph via `npx nx show project ptah-extension-webview --json`.

This should be promoted from a risk-row footnote to the standing procedure for any
`project.json` edit in this repo.

---

## 9. One-line verdict

The bundle work delivered −1.43 MB and restored a real error ceiling. **The durable output is
R15** — a launch-surface check that disqualified a candidate in every batch that applied it,
found evidence the frontend could not see, and was never once triggered by the bundle budget
that the whole task was nominally optimising.
