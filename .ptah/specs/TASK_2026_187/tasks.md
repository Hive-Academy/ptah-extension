# Development Tasks — TASK_2026_187

**Goal**: `ptah-extension-webview` initial production bundle **3.63 MB → under 2.50 MB** (`maximumWarning`), then restore `maximumError` to `3.5mb`.

**Total Tasks**: 19 | **Batches**: 5 | **Status**: 4/5 complete

**⚠️ THE TARGET IS NOT YET MET.** After Batch 4 the initial total is **2,536,716 B** — **36,716 B above** the 2,500,000 B warning threshold. Batch 5 has been **re-planned around a new lever (Unit 9, the daisyUI theme split)**; Unit 6 was **removed**, not deferred. See the Batch 5 section.

**Source of truth**: `.ptah/specs/TASK_2026_187/implementation-plan.md` (user-APPROVED). This file is the executable projection of its §10 work breakdown and §13 handoff. **Do not redesign the plan.** Where this file and the plan disagree, the plan wins and the discrepancy is a bug in this file.

**Executor policy**: `frontend-developer` for every batch. `cli_delegation: disabled` (`context.md:114`) — CLI executors are **not** an option for any batch in this task.

**Execution policy**: **sequential**, every batch, no exceptions. Each batch's expected delta is measured against the _previous_ batch's build output, and Batches 3 and 4 include a measure-then-decide step whose outcome changes the work. Parallel execution is structurally impossible here.

---

## Plan Validation Summary

**Validation Status**: **PASSED WITH RISKS** — no blockers. Every load-bearing anchor in the plan was re-verified against the working tree before this decomposition was written.

### Assumptions verified against source (not taken on trust)

| #   | Assumption                                                                                                  | Result                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `app.config.ts:43-47` statically imports the **wide** barrel `@ptah-extension/editor` for exactly 3 symbols | ✅ Confirmed — `provideEditorInternalState`, `EditorService`, `GitStatusService`                               |
| 2   | All 3 symbols exist in the narrow barrel                                                                    | ✅ Confirmed — `libs/frontend/editor/src/services.ts:15,21,22`                                                 |
| 3   | `@ptah-extension/editor/services` tsconfig path exists                                                      | ✅ Confirmed — `tsconfig.base.json:81`                                                                         |
| 4   | The 7 tokens are declared `InjectionToken<Type<unknown>>` in one file                                       | ✅ Confirmed — `lazy-view-components.token.ts:26,35,43,51,59,63,72`                                            |
| 5   | All 7 providers are `useValue` with a component class                                                       | ✅ Confirmed — `app.config.ts:116,117,118-121,122,123,124,125`                                                 |
| 6   | `AppShellComponent` is the sole consumer, 7 fields, all `inject(TOKEN, {optional:true}) ?? null`            | ✅ Confirmed — `app-shell.component.ts:156-203`                                                                |
| 7   | Every token outlet already has an `@else` spinner **except** canvas                                         | ✅ Confirmed — spinners at html 22-28, 49-55, 62-68, 82-88, 95-101, 108-114; canvas at ~657 has **no** `@else` |
| 8   | Canvas outlet sits under `[class.hidden]="layoutMode() !== 'grid'"` (hidden, not destroyed)                 | ✅ Confirmed — `app-shell.component.html:656`                                                                  |
| 9   | `ptah-dashboard-grid` (42), `ptah-thoth-shell` (75), `ptah-settings` (35) each used exactly once            | ✅ Confirmed                                                                                                   |
| 10  | 7 service imports entangle 6 libs with `app.config.ts` (§8.5 table)                                         | ✅ Confirmed — lines 38-42, 49, 50, 51, 52-56, 59, 60                                                          |
| 11  | canvas (48), marketplace (57), tribunal-panel (58) import **only** a component — no service                 | ✅ Confirmed — these three are pure token work                                                                 |
| 12  | `maximumError` currently `"4mb"`                                                                            | ✅ Confirmed — `apps/ptah-extension-webview/project.json:61`                                                   |
| 13  | Monaco is type-only / asset-copied, contributes **zero** bundled bytes                                      | ✅ Accepted from plan §2 source-map attribution; not re-measured                                               |

### Risks identified

| #            | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Sev                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owning task              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| R1           | Monaco diff add/remove highlighting dies **silently** after Unit 1 relocates `DiffViewComponent` into a new chunk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | HIGH                                      | Human must _see_ green/red highlighting, not infer it from "the diff renders"                                                                                                                                                                                                                                                                                                                                                                                                                                                          | T1.4                     |
| R2           | `useFactory` used instead of `useValue` → all 7 imports fire eagerly at bootstrap; the exact inverse of the goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | HIGH                                      | Code-review gate + the measurement itself (bundle will not move)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | T2.4, T4.2               |
| R3           | `LazyViewService.resolveWhen` implemented read-gated (bare `computed()`) → all 7 loaders fire on the first CD pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | HIGH                                      | Trigger-gated by construction; a unit test that asserts _no_ load before trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                       | T2.2, T2.3               |
| R4           | A narrow-barrel swap silently drops a `MESSAGE_HANDLERS` registration → push messages stop landing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | HIGH                                      | Per-lib assertion: view **never opened**, push message still handled                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | T3.4, T4.4               |
| R5           | `main.js` transfer grows → chat TTI regresses (violates an acceptance criterion)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | HIGH                                      | Recorded every batch against the 353.23 kB baseline; growth blocks the batch                                                                                                                                                                                                                                                                                                                                                                                                                                                           | every batch              |
| R6           | Narrow barrel yields **zero** delta because esbuild already tree-shook the wide barrel (`/*@__PURE__*/` on `ɵcmp`/`ɵfac`) — plan §8.5 states this honestly as unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MED                                       | **Measure per lib.** Drop the barrel half of the unit rather than carry dead scaffolding                                                                                                                                                                                                                                                                                                                                                                                                                                               | T3.2, T4.3               |
| R7           | A deferred surface gets a `modulepreload` link in `index.html` → not actually deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | MED                                       | `modulepreload` diff recorded every batch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | every batch              |
| R8           | **NEW (found during validation)** — the `no-restricted-imports` rule copied verbatim from `skill-synthesis-ui/eslint.config.mjs:56-65` includes a `patterns: ['@ptah-extension/editor/*']` group that would **also ban `@ptah-extension/editor/services`** — the exact import Unit 1 is introducing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MED                                       | Ban only the bare specifier in the webview config; do **not** copy the `patterns` group                                                                                                                                                                                                                                                                                                                                                                                                                                                | T1.3                     |
| R9           | **NEW (found during validation)** — `libs/frontend/editor` has **no** `package.json`. Adding one with an `exports` map (the `libs/frontend/core/package.json` shape) that omits `./services` can break subpath resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | MED                                       | Copy the **`libs/frontend/ui/package.json`** shape (name/version/peerDeps/`sideEffects`, **no** `main`/`types`/`exports`). `name` must equal the `project.json` name `@ptah-extension/editor`                                                                                                                                                                                                                                                                                                                                          | T1.2                     |
| R10          | `gridstack` (87.8 kB) only leaves the initial chunk if **both** canvas and tribunal leave — they are its only two consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MED                                       | Batch 2 must verify `gridstack` absence via the attribution script, not by arithmetic                                                                                                                                                                                                                                                                                                                                                                                                                                                  | T2.6                     |
| R11          | Field ordering in `app-shell.component.ts` — `lazyViews` must be declared **before** the seven fields that reference `this.lazyViews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MED                                       | Stated in the batch prompt; typecheck catches it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | T2.5, T4.5               |
| R12          | `nx reset` fails with `EPERM .nx/workspace-data` on Windows (daemon holds the dir)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ~~LOW~~ **MED — escalated after Batch 1** | ~~Retry — it succeeds on the second attempt~~ **SUPERSEDED, see R12a**                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | T5.4                     |
| R12a         | **REVISED (2026-08-09, observed during the Batch 1 commit)** — `npx nx reset` failed **twice** with `EPERM … .nx/workspace-data` and did **not** succeed on retry. R12's "retry and it works" guidance is **incomplete and must not be relied on**. Separately, the pre-commit hook crashed with `ENOENT: .nx\cache\terminalOutputs\…` because `.nx/cache` did not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MED                                       | Working sequence, proven during the Batch 1 commit: **(1)** stop the Nx daemon, **(2)** recreate `.nx/cache/terminalOutputs`, **(3)** re-run the command. **T5.4 mandates `nx reset` before the `project.json` budget check (I-6/R13) — that dependency is now known-fragile on this machine. Budget the time and do not treat a failing `nx reset` as a blocker to escalate; apply this sequence.** Do NOT work around it by skipping the reset — F-11 means the budget check would then read a stale project graph and silently pass | T5.4                     |
| R13          | `--skip-nx-cache` does not refresh the Nx project graph; a `project.json` edit reads stale (F-11, `TASK_2026_177/batch-12-report.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | LOW                                       | `npx nx reset` is **mandatory** before any `project.json` budget check                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | T5.4                     |
| R15          | **CLOSED (2026-08-09) — the launch surface must never be deferred.** Deferring the canvas cost **+100 ms** Electron startup TTI as R14 specified it, and **+70 ms** after being revised to load at bootstrap (306 → 406 → 376.5 ms median). Canvas reverted to eager; `gridstack` returned to the initial bundle with it. **Batches 3–5 must check, for every surface they defer, whether it can be the surface that opens at launch** — `dashboard`, `thoth-shell`, `tasks-ui`, `setup-wizard` and `harness-builder` are all reachable as a startup view, and `setup-wizard`/`settings` are the _first-run_ launch surface via the auth-redirect effect at `app-shell.component.ts:308-340`. **APPLIED IN BATCH 3 — first real outcome, and it changed the shipped work**: `dashboard` was **NOT deferred**, because `ptah.openDashboard` is a VS Code **activation event** (`apps/ptah-extension-vscode/package.json:42`, contributed command `:115`, menu entry `:153`) that calls `createPanel({ initialView: 'analytics' })` → `VALID_VIEWS` accepts `'analytics'` → `app-state.service.ts:324-354` sets `currentView` at service construction. A fresh webview therefore boots straight onto analytics with a user waiting on it. `thoth-shell` was deferred: `'thoth'` is absent from **both** `initialView` allow-lists, no producer requests it, and it is not persisted — reachable only by an explicit tab click. **The Batch 3 lesson that sharpens the check for Batch 4**: the disqualifying evidence was **invisible from inside the webview** — it lived in the extension-host manifest. The question is not "is this view navigable at startup" but "**is there an activation event, command, deep link or restored-state path that opens directly onto it**" | HIGH                                      | Defer only surfaces reached by explicit navigation. Where a surface can open at launch, measure `startup-tti.spec.ts` before and after — the initial-bundle budget will pass either way, so it is not a gate for this                                                                                                                                                                                                                                                                                                                  | Batches 3 ✅, 4 ✅, 5    |
| R15 outcomes | **THREE surfaces have now been caught, across three batches** — this row is the running tally, because the count is the argument. **(1) `canvas`, Batch 2** — deferred, measured at +70–100 ms Electron startup TTI, **reverted**. **(2) `dashboard`, Batch 3** — caught _before_ shipping; `ptah.openDashboard` is a VS Code activation event. **(3) `setup-wizard`, Batch 4** — caught before shipping; `ptah.setupAgents` is an activation event whose handler builds a **dedicated panel that hardcodes `initialView: 'setup-wizard'`**, a stronger case than the dashboard's generic `createPanel`. In all three the disqualifying evidence was **outside the webview** (extension-host manifest, or an Electron shell constructor), and in all three **the initial-bundle budget would have passed anyway**. Cumulative bytes deliberately left on the table: canvas ~118 kB + dashboard 35.7 kB + wizard 109.0 kB. That is not waste — it is the task declining to buy budget with latency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | HIGH                                      | Keep this tally current. A fourth candidate must be checked against all six paths in the Batch 4 header before anyone calls it a free win                                                                                                                                                                                                                                                                                                                                                                                              | Batches 2 ✅, 3 ✅, 4 ✅ |
| ~~R14~~      | ~~**NEW (2026-08-09)** — a bare `layoutMode() === 'grid'` canvas trigger is **true at bootstrap**~~ **SUPERSEDED by R15 — canvas is no longer deferred, so this trigger no longer exists** (`app-state.service.ts:171` defaults to `'grid'`, `:331-335` restores it from localStorage), so canvas + `gridstack` (~115 kB) would fetch on the chat launch path. The budget still passes, which is why it would go unnoticed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | HIGH                                      | Two-condition trigger: explicit intent → immediate; persisted grid → **after first paint**. Verify in **both** layout modes. A toggle-only trigger strands grid-persisted users on an empty grid                                                                                                                                                                                                                                                                                                                                       | T2.5, T2.6               |

### Edge cases to handle

- [ ] Canvas outlet has no `@else` spinner and is hidden-not-destroyed → gate the loader on `layoutMode() === 'grid'`, **not** on visibility; add the spinner → T2.5
- [ ] `SETUP_HUB_COMPONENT` and `HARNESS_BUILDER_COMPONENT` both resolve out of `harness-builder` → one lazy chunk serves both; do not expect two → T4.2
- [ ] `resolveWhen` must tolerate a **missing** (optional) provider by staying `null` forever, never throwing → T2.3
- [ ] `resolveWhen` must fire the loader **exactly once** even if the trigger flips true→false→true → T2.3
- [x] ~~First-run auth redirect navigates to `'settings'` at startup (`app-shell.component.ts:308-340`) — if Unit 6 is needed, settings **is** the launch surface for that user → T5.1~~ → **CONFIRMED in Batch 4 §1e and acted on: Unit 6 was REMOVED from the plan for exactly this reason.** The effect targets `'settings'` and **only** `'settings'` (`app-shell.component.ts:355-357`) — the "`setup-wizard`/`settings`" phrasing used elsewhere in this file was imprecise; the wizard is a launch surface by a different and independent path. Batch 5 replaces Unit 6 with **Unit 9 (the daisyUI theme split)**, which carries no launch-surface risk at all
- [x] ~~`cron-scheduler-ui` reaches the bundle _only_ through `ThothShellComponent` → one `@defer` sheds it~~ → **FALSIFIED in Batch 3 (T3.3).** There was a **third** edge the plan did not model: `ThothStatusService` (eager, in `dashboard`) imported `CronRpcService` — and the other three libs' RPC services — from the **wide** barrels. The `@defer` alone moved **+1.35 kB**. Both edges had to be cut. **Generalise this before Batch 4 estimates anything**: `grep -rn "from '@ptah-extension/<lib>'"` for **every** external importer of a wide barrel, not just the `app.config.ts` one

### Blockers found

**None.** Decomposition proceeds.

### Deviation from the plan's §13 batching

**None.** Batch 1 = Unit 1; Batch 2 = Units 2+3; Batch 3 = Unit 4; Batch 4 = Unit 5; Batch 5 = Units 6 (conditional) + 7 + 8 — exactly as §13 suggests. No ordering hazard was found that justifies deviating. R8 and R9 are refinements _inside_ Batch 1, not a re-ordering.

---

## GLOBAL INVARIANTS — restate these in EVERY batch prompt

These are the failure modes the plan identifies. **No batch ships without every one of them stated to the developer.**

**I-1 — `useValue` with an arrow function, NEVER `useFactory`.**

```ts
// CORRECT
{ provide: TASKS_VIEW_COMPONENT,
  useValue: () => import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent) }

// WRONG — useFactory runs the arrow at injection time and starts every import eagerly.
// This is the exact inverse of the goal and the bundle will not move.
{ provide: TASKS_VIEW_COMPONENT, useFactory: () => import(...) }
```

**I-2 — `LazyViewService.resolveWhen` must be trigger-gated, not read-gated.** A bare `computed()` that kicks off the import on first read fires **all seven loaders at the first change-detection pass** and undoes the entire split. Implementation shape: `inject(token, { optional: true })`, a `WritableSignal<Type<unknown> | null>(null)`, and an internal `effect()` that watches `trigger()` and fires the loader exactly once.

**I-3 — A narrow `/services` barrel swap must not drop a `MESSAGE_HANDLERS` registration.** Those services are constructed at bootstrap specifically to receive push messages. **The services stay eager; the components must not.** Every affected lib needs an explicit assertion that push messages still land **with the view never opened**.

**I-4 — `main.js` transfer size must never grow.** Baseline **353.23 kB transfer / 1.90 MB raw**. It is the proxy for chat's critical path, and "chat must not regress in time-to-interactive" is an acceptance criterion. Record it every batch. Growth blocks the batch.

**I-5 — Monaco: touch nothing.** No `MonacoEnvironment.getWorker` shim. No change to `provideMonacoEditor({ baseUrl: './assets/monaco/vs' })` at `app.config.ts:187-189`. No change to the asset globs at `project.json:17-32`. No converting `import type * as monaco from 'monaco-editor'` into a value import. Monaco contributes **zero bundled bytes** (verified by source-map attribution), so every Monaco change in this task is pure downside. After Batch 1 a human must **visually confirm add/remove diff highlighting** — the documented failure is silent (`apps/ptah-extension-webview/CLAUDE.md:47`).

**I-6 — `npx nx reset` is mandatory before any `project.json` budget check.** `--skip-nx-cache` does **not** refresh the Nx project graph (F-11, `TASK_2026_177/batch-12-report.md`). Observed on Windows: the first `nx reset` may fail with `EPERM … .nx/workspace-data` because the Nx daemon still holds the directory — **retry, it succeeds.** That EPERM is not a repo problem.

**I-7 — Do not chase the `@xterm/* is not ESM` warnings.** `Module '@xterm/xterm' … is not ESM` (+ `@xterm/addon-fit`, `@xterm/addon-webgl`) will still be emitted after Unit 1, regardless of chunk placement — it is emitted for CJS interop. **No `allowedCommonJsDependencies`. No ESM fork. No restructuring of `terminal.component.ts`.** Once the module lives in a lazy chunk, the tree-shaking limitation costs nothing on the initial bundle.

**I-8 — DO NOT TOUCH**:

- `libs/shared/src/index.ts` — `zod` is 304 kB and is deliberately **out of scope** (plan §7)
- `apps/ptah-extension-webview/src/app/app.html` shell selection — deferring the two shells is **explicitly rejected** (plan §5)
- `app.config.ts:187-189` (`provideMonacoEditor`)
- `apps/ptah-extension-webview/project.json:17-32` (asset globs)
- anything under `libs/frontend/editor/src/lib/{code-editor,diff-view}/`
- `libs/frontend/editor/src/lib/terminal/terminal.component.ts`

**I-9 — Unit 8 (restore `maximumError` to `3.5mb`) is the final change and is MANDATORY.** Leaving it at `4mb` means the task did not finish. The final build must be **green with zero budget warnings**.

---

## MEASUREMENT DISCIPLINE — required of every batch

### Build commands

```bash
# source-only edits (Batches 1-4, and Units 6/7 in Batch 5)
npx nx build ptah-extension-webview --configuration=production --skip-nx-cache

# after ANY project.json edit (Unit 8) — mandatory, I-6
npx nx reset
npx nx build ptah-extension-webview --configuration=production
```

### Attribution (for the after-table)

```bash
npx nx build ptah-extension-webview --configuration=production --source-map
cd dist/apps/ptah-extension-webview/browser
node ../../../../.ptah/specs/TASK_2026_187/attribute.js *.js.map
```

### Every batch report MUST record

1. **Full initial chunk table** — file, name, raw size, transfer size.
2. **Full lazy chunk table** — same columns.
3. **Initial total**, raw **and** transfer.
4. **`main.js` transfer size**, compared against the 353.23 kB baseline (I-4).
5. **The `modulepreload` diff** in `dist/apps/ptah-extension-webview/browser/index.html` versus the previous batch. _A deferred surface that gets preloaded is not deferred_ (R7). State explicitly: "no new `modulepreload` entries" or list them.
6. **Attribution delta** for the libs the batch targeted — did they actually leave the initial chunks?
7. **Actual vs expected delta**, with the expected value labelled MEASURED or ESTIMATED.

### Measure-then-decide (Batches 3 and 4 only)

Plan §8.5 states an honest uncertainty: Angular emits `/*@__PURE__*/` on `ɵcmp`/`ɵfac`, so esbuild **may** already tree-shake the unused components out of the wide barrels, in which case a narrow `services.ts` barrel yields **no delta**. It demonstrably did _not_ for `@ptah-extension/editor`, so assume it will not — but **measure per lib**.

**If a given lib's narrow barrel produces no measurable delta, delete that lib's `services.ts` and its `tsconfig.base.json` path and revert its `app.config.ts` import.** Do not carry dead scaffolding. Report which libs were kept and which were dropped, with the per-lib numbers that justified each call.

### Baseline (BEFORE — measured, clean tree, after `npx nx reset`)

| File                       |         Raw |      Transfer |
| -------------------------- | ----------: | ------------: |
| `main.js`                  |     1.90 MB |     353.23 kB |
| `chunk-HAMQW4KR.js`        |   685.72 kB |     136.22 kB |
| `chunk-GZKAFEM7.js`        |   677.31 kB |     143.75 kB |
| `styles.css`               |   276.07 kB |      34.60 kB |
| `scripts.js`               |    48.20 kB |      14.01 kB |
| `polyfills.js`             |    35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js`        |     1.38 kB |         601 B |
| **Initial total**          | **3.63 MB** | **694.00 kB** |
| _lazy_ `chunk-HG3P62SC.js` |     6.60 kB |       2.29 kB |
| _lazy_ `chunk-EVUY35PO.js` |     1.13 kB |         420 B |
| _lazy_ `chunk-FWCFY4EX.js` |       292 B |         292 B |

**Gap to close: 1,128,629 bytes.** Budgets are decimal MB (`2.5mb` = 2,500,000 bytes).

---

## Batch 1: Editor barrel → services barrel ✅ COMPLETE

**Status**: ✅ COMPLETE
**Commit**: `0be02e214` — `perf(webview): move the wide editor barrel off the initial bundle`
**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer` (re-invoked with the reviewer's issues)
**Execution Mode**: sequential
**Rationale**: One line moves 48% of the required reduction, and it is already measured. It ships alone so the Monaco/terminal manual gate is unambiguous — if diff highlighting breaks, exactly one line is suspect. Frontend-only; CLI delegation disabled by `context.md`.
**Unit**: Unit 1 (plan §10)
**Tasks**: 4 | **Dependencies**: None
**Expected delta**: **−540 kB initial, −99.81 kB transfer — MEASURED** (applied, built, recorded, reverted; tree verified clean). 3.63 MB → **3.09 MB**.
**ACTUAL delta**: **−538,782 B initial (−538.78 kB), −99.83 kB transfer**. 3.63 MB → **3.09 MB / 594.17 kB**. Target hit; the 20-byte transfer difference is gzip-estimate noise.

#### Batch 1 result — verified by team-leader

| Check              | Method                                                                 | Result                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial total      | summed byte sizes in `dist/apps/ptah-extension-webview/browser`        | **3,089,877 B** — matches the MEASURED target exactly                                                                                                      |
| I-4 `main.js`      | byte size                                                              | **1,904,251 B — byte-identical to baseline**; transfer 353.39 kB (+0.16 kB, noise)                                                                         |
| Genuine lazy chunk | `ls`                                                                   | 539,356 B present                                                                                                                                          |
| R7                 | grep `index.html`                                                      | the 539 kB lazy chunk is **not** `modulepreload`ed. Two new preload entries exist, both **initial** chunks; net preloaded bytes fell by 538,782 B          |
| xterm left initial | grep across built chunks                                               | `main.js` **0** hits. The one hit in the initial chunk is `_xtermWriters` inside `TerminalService` — an eager service by design (I-3), **not** the library |
| I-5 Monaco         | `git status` on `editor/src/`, `project.json`, `app.config.ts:187-189` | untouched                                                                                                                                                  |
| I-7                | grep `allowedCommonJsDependencies`; `terminal.component.ts` status     | none added; untouched. The three `@xterm/* is not ESM` warnings remain, unactioned as required                                                             |
| I-8                | `git status` on all five DO-NOT-TOUCH paths                            | all clean                                                                                                                                                  |
| Lint               | `npx nx lint ptah-extension-webview`                                   | green                                                                                                                                                      |
| Guard bites        | `eslint --stdin` probe importing the wide barrel                       | error raised with the correct message; `/services` subpath stays legal (R8 avoided)                                                                        |
| Spec               | `jest … editor-message-routing`                                        | 5 passed                                                                                                                                                   |

**R1 / I-5 — SATISFIED, human-verified.** The user ran `npm run electron:serve` and confirmed on direct inspection that the **Monaco diff view renders with add/remove highlighting present**. This is the "seen, not inferred" gate; it is closed.

**Two defects surfaced during that manual session — both PRE-EXISTING, Batch 1 exonerated.** Terminal vertical resize does not work, and diff content paints over the terminal panel. Root cause is commit `3a73a037d` (2026-08-04), which made `<ptah-diff-view>` / `<ptah-code-editor>` `position: absolute` with no `overflow-hidden` and no `z-index` (`editor-panel.component.ts:280-303`) — one cause, two symptoms. Filed as **TASK_2026_196**. Batch 1 was cleared on direct evidence, not argument: zero files under `libs/frontend/editor/src/**` modified, exactly one `EditorService` class definition in the built chunks, the editor lib still present in Tailwind's content globs with the new `package.json`, and no `ViewEncapsulation.None` anywhere in the webview. Full write-up in `batch-1-regression-investigation.md`. **Do not re-open this and do not fix TASK_2026_196 inside this task.**

**⚠️ OUTSTANDING BUT NON-BLOCKING — the DevTools Performance TTI baseline recording was NOT captured.** Task 1.4 asked for it here. It does not block Batch 1 and it does not have to be a _pre-Unit-1_ recording: `main.js` is byte-identical to baseline (1,904,251 B raw, +0.16 kB transfer), so Batch 1 cannot have moved chat TTI. A baseline recorded at any point before Batch 2 is therefore equally valid. **Task 5.3 must not assume a pre-Unit-1 recording exists** — see the note there.

**⚠️ BATCH 2 MUST RE-MEASURE ITS OWN BASELINE.** A concurrent session is modifying `libs/shared/src/lib/types/*` (among ~35 other files), and `libs/shared` sits in the **eager** bundle — attribution puts it at 86.4 kB in an initial chunk. Batch 1's 3.09 MB is therefore a snapshot of a moving tree, not a fixed starting point. Batch 2 must build and record its own before-number on the tree it actually starts from, and compute its delta against that, not against 3,089,877 B.

**Unplanned change reviewed and ENDORSED.** The new lint rule caught a second, pre-existing wide-barrel importer — `apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts:32`. The developer repointed it to the narrow barrel rather than adding an eslint `ignores` exemption. Correct call, for two reasons. First (the developer's): the spec's stated purpose is to mirror `app.config.ts`'s real `MESSAGE_HANDLERS` wiring, so an exemption would freeze it on an import path production no longer takes — the one failure a mirror test cannot survive. Second, and stronger: an exemption list **erodes**. The guard's value is that it is exceptionless, and Batches 3–5 add seven more narrow barrels that hit this exact rule — the first `ignores` entry is the one everyone copies. No coverage was lost (both symbols are genuinely exported from `services.ts:15,21`) and its 5 tests pass unchanged.

### Task 1.1: Repoint `app.config.ts` to the narrow editor barrel ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts`
**Line anchor**: line 47 **only**
**Spec Reference**: implementation-plan.md §10 Unit 1

```ts
// BEFORE (line 43-47)
import { provideEditorInternalState, EditorService, GitStatusService } from '@ptah-extension/editor';
// AFTER
import { provideEditorInternalState, EditorService, GitStatusService } from '@ptah-extension/editor/services';
```

**Verified**: all three symbols are exported from `libs/frontend/editor/src/services.ts` (lines 15, 21, 22). The tsconfig path exists at `tsconfig.base.json:81`. **No API change, no type change, no other line in the file changes.**

**Why this works** (plan §6): `@xterm/xterm` (281.5 kB) + `@xterm/addon-webgl` (99.0 kB) are value-imported by `terminal.component.ts:12-14`; `TerminalComponent` is re-exported from the wide barrel `editor/src/index.ts:47`; `app.config.ts:47` was the **sole** static importer of that barrel. That one edge made xterm + the whole editor lib statically reachable from the app entry, and **defeated** the three pre-existing `await import('@ptah-extension/editor')` sites (`electron-shell.component.ts:306`, `file-path-link.component.ts:91`, `lazy-diff-view.component.ts:166`) — they were emitting ~1 kB re-export facades over an already-eager chunk. That is the whole "under 8 kB of lazy chunks" finding.

**Validation notes**: I-5 (Monaco untouched), I-7 (do not chase the xterm CJS warnings).

---

### Task 1.2: Add `libs/frontend/editor/package.json` with `sideEffects: false` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\editor\package.json` (**CREATE**)
**Pattern to follow**: `libs/frontend/ui/package.json` — **NOT** `libs/frontend/core/package.json`

**Validation notes (R9 — found during validation, not in the plan)**: the editor lib currently has **no** `package.json`. Two shapes exist in this repo:

- `libs/frontend/ui/package.json` — `name`, `version`, `peerDependencies`, `sideEffects: false`. **No** `main`/`types`/`exports`. ← **copy this one.**
- `libs/frontend/core/package.json` — includes a full `exports` map. **Do not copy this one.** An `exports` map that omits `./services` can break `@ptah-extension/editor/services` subpath resolution, which is the import Task 1.1 just introduced.

The `name` field **must** equal the `project.json` name `@ptah-extension/editor` (`libs/frontend/editor/project.json:2`), or Nx project inference can conflict.

**Acceptance**: after this file exists, `npx nx show projects` still resolves and `@ptah-extension/editor` appears exactly once.

---

### Task 1.3: Add a `no-restricted-imports` guard to the webview eslint config ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\eslint.config.mjs` (**MODIFY**)
**Pattern to follow**: `libs/frontend/skill-synthesis-ui/eslint.config.mjs:56-65` — **adapted, not copied verbatim**

**Validation notes (R8 — found during validation, not in the plan)**: the `skill-synthesis-ui` rule bans **both** the bare specifier `@ptah-extension/editor` **and**, via `patterns: [{ group: ['@ptah-extension/editor/*'] }]`, every subpath — including `@ptah-extension/editor/services`. Copying it verbatim into the webview config would make **Task 1.1 fail lint immediately**.

In the webview config, ban **only** the bare specifier:

```js
'no-restricted-imports': ['error', {
  paths: [{
    name: '@ptah-extension/editor',
    message: 'Static import of the wide @ptah-extension/editor barrel pulls xterm (~380 kB) into the initial bundle. Use @ptah-extension/editor/services for services, or a runtime import() for components. See TASK_2026_187.',
  }],
}],
```

**Do NOT include the `patterns` group.** `@ptah-extension/editor/services` must remain legal here.

The webview `eslint.config.mjs` currently has **no** `no-restricted-imports` rule — add it inside the existing `files: ['**/*.ts']` rules block.

**Acceptance**: `npx nx lint ptah-extension-webview` passes **and** re-introducing the wide barrel import fails lint (prove the guard bites by trying it once, then reverting).

---

### Task 1.4: Verification — build table + the manual Monaco/terminal gate ✅ COMPLETE

**No file changes.** This task is the gate.

**Expected build output** (MEASURED — this table is a pass/fail target, not a guess):

| File                       |         Raw |      Transfer |
| -------------------------- | ----------: | ------------: |
| `main.js`                  |     1.90 MB |     353.41 kB |
| `chunk-GZKAFEM7.js`        |   677.31 kB |     143.75 kB |
| `styles.css`               |   276.07 kB |      34.60 kB |
| `chunk-ZKGFKAZW.js`        |   146.94 kB |      36.24 kB |
| `scripts.js`               |    48.20 kB |      14.01 kB |
| `polyfills.js`             |    35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js`        |     1.38 kB |         601 B |
| **Initial total**          | **3.09 MB** | **594.19 kB** |
| _lazy_ `chunk-RU65KRO4.js` |   539.36 kB |     101.34 kB |

Chunk hashes may differ; **the totals and the appearance of a ~539 kB genuine lazy chunk must not.** `main.js` transfer at 353.41 kB vs the 353.23 kB baseline is +0.18 kB — within noise and the known-good measured result (I-4 satisfied).

**Remaining gap to 2.50 MB after this batch: 589.88 kB.**

**MANUAL GATE — R1, blocking, cannot be inferred**:

- [x] **SEEN by a human.** Diff view opened in Electron (`npm run electron:serve`); **add/remove highlighting is present and rendering correctly**. R1 closed — not inferred from a green build.
- [x] Terminal opens and is interactive (xterm now constructs from a lazy chunk for the first time). _Vertical resize does not work — pre-existing, `3a73a037d`, filed as TASK_2026_196, not Batch 1._
- [x] `file-path-link` "open in editor" works — one of the three `await import('@ptah-extension/editor')` sites this unit finally activates for real.
- [x] Chat opens and accepts input. **⚠️ The DevTools Performance TTI baseline recording was NOT captured** — outstanding, but **non-blocking**: `main.js` is byte-identical to baseline, so Batch 1 cannot have moved chat TTI, and a recording taken any time before Batch 2 is equally valid. See the note in Task 5.3.

**Batch 1 Verification**:

- `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache` green
- Initial total **3.09 MB**, matching the table above
- Full chunk table + `main.js` transfer + `modulepreload` diff recorded
- `npx nx lint ptah-extension-webview` passes
- Manual gate above: all four boxes ticked, with the Monaco one explicitly confirmed as _seen_
- `@xterm/* is not ESM` warnings still present — **expected, do not act on them** (I-7)

**Rollback**: revert one line.
**Risk**: Low.

---

## Batch 2: `LazyViewService` scaffolding + marketplace / tribunal → lazy tokens (canvas reverted to eager) ✅ COMPLETE

**Status**: ✅ COMPLETE
**Commits** (two, deliberately split — the application change and the test infrastructure are separable):

- `9e8ef9af4` — `perf(webview): defer marketplace and tribunal behind a trigger-gated loader` (8 files)
- `05ec1ed50` — `test(electron): cover the deferred surfaces and anchor startup TTI in e2e` (5 files)

**ACTUAL delta**: **3,089,729 B → 2,996,828 B = −92,901 B (−92.90 kB)**. Initial transfer **597.46 kB**. **Remaining gap to 2,500,000 B: 496,828 B.**

**This is not what the batch plan said, and the difference is the batch's most valuable output.** Units 2 and 3 were implemented in full, then the canvas was **reverted to eager on measured evidence and a user decision**. Marketplace and tribunal kept the mechanism. See the RESOLVED block in Task 2.5 and risk row **R15** — those are the durable record and must not be edited.

**Final shipped state**:
| Item | State |
|---|---|
| `LazyViewService` + `LazyViewLoader` (`libs/frontend/core`) | **KEPT** — serves marketplace and tribunal, and is the mechanism Batches 4–5 reuse for the remaining four tokens |
| `MARKETPLACE_COMPONENT`, `TRIBUNAL_COMPONENT` | **LAZY** — `InjectionToken<LazyViewLoader>`, `useValue` arrows, resolved through trigger-gated `resolveWhen` |
| `ORCHESTRA_CANVAS_COMPONENT` | **EAGER, as it was before this task.** `gridstack` returned to the initial bundle with it (R10 in reverse — two consumers, it only leaves when both do) |
| `canvas-load-trigger.ts` + `.spec.ts` | **DELETED** (never committed; they existed only between the §12 hardening and the §14 revert) |
| Canvas `@else` spinner | **KEPT** — it was missing before this task and is an improvement independent of laziness |

#### Batch 2 result — verified independently by team-leader

| Check                                          | Method                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working tree contains only the intended change | `git status --porcelain`                                                                                                           | ✅ `canvas-load-trigger.ts`/`.spec.ts` absent; `lazy-view.service.ts`/`.spec.ts` present; zero dangling refs to `shouldLoadCanvas` / `canvasWanted` / `canvasPastFirstPaint` / `canvasBootstrapLayoutMode` / `CanvasRequestState` anywhere in `libs/` or `apps/`                                                                                 |
| **I-1 / R2**                                   | grep `app.config.ts`                                                                                                               | ✅ marketplace + tribunal are `useValue` with arrows. The **only** `useFactory` occurrence in the file is inside the warning comment at `:121`. Canvas is back to `useValue: OrchestraCanvasComponent` with a static import at `:48`                                                                                                             |
| **I-2 / R3**                                   | read `lazy-view.service.ts`                                                                                                        | ✅ trigger-gated: `injector.get(token, null, {optional:true})`, `WritableSignal<Type<unknown>\|null>(null)`, and an `effect()` that reads `trigger()` **inside** the effect with a `started` latch. Not a `computed()`                                                                                                                           |
| Initial total                                  | independent `npx nx build … --configuration=production --skip-nx-cache`, then summed filesystem byte sizes of the 12 initial files | ✅ **2,996,828 B** — reproduced the reported number exactly. Angular's own budget line agrees: _"Budget 2.50 MB was not met by 496.83 kB"_                                                                                                                                                                                                       |
| Attribution                                    | grep for library markers across the initial set (from `index.html`) vs the 5 lazy chunks                                           | ✅ `ptah-marketplace-hub` → lazy only. `ptah-tribunal-page` → lazy only. `ptah-orchestra-canvas` → `main.js` (initial). `GridStack` → initial. Exactly the intended shape                                                                                                                                                                        |
| **I-4**                                        | —                                                                                                                                  | ⚠️ **`main.js` is no longer a valid TTI proxy** (batch-2-report §11): the eager set was re-partitioned, so `main.js` moved 353.51 → 381.03 kB raw for partitioning reasons unrelated to download. **Use initial-total transfer as the signal**: 694.00 (task baseline) → 594.17 (Batch 1) → **597.46 kB**. Batches 3–5 track this, not `main.js` |
| R7 `modulepreload`                             | `index.html`                                                                                                                       | ✅ 8 entries, **all initial**; none of the 5 lazy chunks is preloaded                                                                                                                                                                                                                                                                            |
| **I-8** DO-NOT-TOUCH                           | `git status` on all five paths                                                                                                     | ✅ all clean                                                                                                                                                                                                                                                                                                                                     |
| **I-5** Monaco                                 | `provideMonacoEditor` block                                                                                                        | ✅ untouched at `app.config.ts:205-207`                                                                                                                                                                                                                                                                                                          |
| **I-7**                                        | build warnings                                                                                                                     | ✅ the three `@xterm/* is not ESM` warnings still emitted, unactioned as required                                                                                                                                                                                                                                                                |
| Tests                                          | `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat --skip-nx-cache`                                             | ✅ core 23 suites / 471 tests; chat 50 suites / 658 passed + 2 skipped                                                                                                                                                                                                                                                                           |
| Typecheck                                      | `run-many -t typecheck` on core, chat, webview                                                                                     | ✅ 3/3                                                                                                                                                                                                                                                                                                                                           |
| Lint                                           | `run-many -t lint` on the same three, `--skip-nx-cache`                                                                            | ✅ **0 errors**, 23 warnings, all pre-existing                                                                                                                                                                                                                                                                                                   |

**Startup-TTI evidence that drove the revert** (`apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`, reload → canvas interactive, same machine and session):

| Variant                                           |                         Median |
| ------------------------------------------------- | -----------------------------: |
| Eager canvas (pre-Batch-2)                        |                     **306 ms** |
| Deferred, load after first paint (R14 as written) |           **406 ms** (+100 ms) |
| Deferred, load at bootstrap (revision)            | **376.5 ms** (+70 ms residual) |
| **Reverted to eager (shipped)**                   |                     **215 ms** |

**Do not read the 215 ms as a speedup over the original baseline.** The paint-timing control drifted downward across the multi-hour session (404 → 342 → 344 → 258 ms median), so a material share of the gap between 306 and 215 is machine drift, not the product change. The claim the evidence supports is the binary one — canvas TTI returned to the pre-Batch-2 range, with zero overlap between the two sample sets — and nothing stronger.

**⚠️ Commit hygiene note.** A concurrent session's `git commit` briefly swept Batch 2's staged files into an unrelated commit (`4163b8ec2`); that session reset and re-committed correctly on its own, and Batch 2 was then committed cleanly with explicit pathspecs. Final history is correct. Batches 3–5 should stage with explicit pathspecs and re-verify `git diff --cached --name-only` immediately before committing — the index is shared and moves under you.

**⚠️ TTI baseline recording — superseded, not outstanding.** Task 1.4's missing DevTools recording no longer matters: `startup-tti.spec.ts` now exists as a re-runnable comparison anchor and is strictly better than a one-off recording. Task 5.3 should use it. See the note there.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Units 2 and 3 pair because Unit 2 is pure additive scaffolding with no behaviour change and no delta — shipping it alone would be a review round for zero measurable movement. Unit 3 is the first real DI work and is the cleanest possible proving ground: canvas, marketplace and tribunal are the **only three** of the seven tokens with no entangled service import, so they are pure token changes with zero barrel work. If `resolveWhen` is wrong (R3) or `useFactory` slipped in (R2), the bundle will not move and this batch catches it before the harder units depend on the mechanism.
**Units**: Unit 2 + Unit 3 (plan §10)
**Tasks**: 6 | **Dependencies**: Batch 1
**Expected delta**: **~115–204 kB — ESTIMATED** from source-map attribution (canvas 26.8 + marketplace 45.2 + tribunal 44.3, plus `gridstack` 87.8 **only if both** canvas and tribunal leave). Cumulative target ≈ **2.89–2.98 MB**.

### Task 2.1: Add the `LazyViewLoader` type ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts` (**MODIFY**)
**Spec Reference**: implementation-plan.md §8.1

```ts
export type LazyViewLoader = () => Promise<Type<unknown>>;
```

**Do not change any token generic in this task.** Unit 2 only adds. The generics change in Task 2.4 (three of them) and Batch 4 (the remaining four).

Export `LazyViewLoader` from `libs/frontend/core/src/index.ts` alongside the tokens (`index.ts:15-21`) → Task 2.2.

---

### Task 2.2: Create `LazyViewService` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\lazy-view.service.ts` (**CREATE**)
**Also modify**: `D:\projects\ptah-extension\libs\frontend\core\src\index.ts` (export `LazyViewService` + `LazyViewLoader`)
**Spec Reference**: implementation-plan.md §8.3

```ts
@Injectable({ providedIn: 'root' })
export class LazyViewService {
  /**
   * Returns a signal that stays null until `trigger()` first returns true,
   * then resolves to the loaded component. Loading starts on the first true
   * reading of the trigger and never repeats.
   */
  resolveWhen(token: InjectionToken<LazyViewLoader>, trigger: () => boolean): Signal<Type<unknown> | null>;
}
```

**Implementation shape** (mandatory): `inject(token, { optional: true })`, a `WritableSignal<Type<unknown> | null>(null)`, and an internal `effect()` that watches `trigger()` and fires the loader **exactly once**.

**Validation notes — I-2 / R3, the single most important line in this batch**: it must be **trigger-gated, not read-gated**. A bare `computed()` that starts the import on first read would fire **all seven loaders at the first change-detection pass** and undo the entire split. The unit tests in Task 2.3 exist specifically to prove this.

**Edge cases**: missing (optional) provider → stay `null` forever, never throw. Trigger flipping true→false→true → load exactly once.

**Conventions** (`libs/frontend/core/CLAUDE.md`): `@Injectable({ providedIn: 'root' })`, `inject()` exclusively, signal-first, `.asReadonly()` on public exposure. Coverage floor for this lib: statements 85%, branches 75%, functions 75%, lines 85%.

---

### Task 2.3: Unit tests for `resolveWhen` ✅ COMPLETE

**Shipped**: 6 assertions in `lazy-view.service.spec.ts`, covering all 5 required items plus the rejected-import failure path. Assertion 1 (_"does not invoke the loader before the trigger is true"_) reads the signal **and** runs `TestBed.tick()` before asserting — a read-gated `computed()` implementation fails it on the first `expect`. That is the R3 regression test and it is load-bearing for Batches 4–5.

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\lazy-view.service.spec.ts` (**CREATE**)
**Dependencies**: Task 2.2

Required assertions:

1. **Does not invoke the loader before the trigger is true** ← this is the R3 regression test; it is the reason this task exists
2. Loads once after the trigger goes true
3. Does **not** load again if the trigger flips true→false→true
4. Tolerates a missing (optional) provider by staying `null` and not throwing
5. The returned signal exposes the resolved `Type<unknown>` after the promise settles

---

### Task 2.4: Flip canvas / marketplace / tribunal to lazy token providers ✅ COMPLETE — **2 of 3 shipped lazy, canvas reverted**

**Outcome, not a failure.** All three were flipped as written. The canvas was then reverted to `useValue: OrchestraCanvasComponent` with its static import restored, on the startup-TTI evidence in the batch header and the RESOLVED block below. `ORCHESTRA_CANVAS_COMPONENT` keeps its `InjectionToken<Type<unknown>>` generic; `MARKETPLACE_COMPONENT` and `TRIBUNAL_COMPONENT` are `InjectionToken<LazyViewLoader>`. Both eager-canvas sites carry a comment recording _why_, so it is not re-deferred later as an obvious win.

**Files**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts` — change **3** generics: `ORCHESTRA_CANVAS_COMPONENT` (line 35), `MARKETPLACE_COMPONENT` (line 59), `TRIBUNAL_COMPONENT` (line 63) → `InjectionToken<LazyViewLoader>`
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts` — **delete** the static imports at lines 48 (`OrchestraCanvasComponent`), 57 (`MarketplaceHubComponent`), 58 (`TribunalPageComponent`); **rewrite** the providers at lines 117, 123, 124

**Verified**: these three libs import **only a component** into `app.config.ts` — no service. They are pure token work with no barrel work. That is exactly why they go first.

```ts
{ provide: ORCHESTRA_CANVAS_COMPONENT,
  useValue: () => import('@ptah-extension/canvas').then((m) => m.OrchestraCanvasComponent) },
{ provide: MARKETPLACE_COMPONENT,
  useValue: () => import('@ptah-extension/marketplace').then((m) => m.MarketplaceHubComponent) },
{ provide: TRIBUNAL_COMPONENT,
  useValue: () => import('@ptah-extension/tribunal-panel').then((m) => m.TribunalPageComponent) },
```

**Validation notes — I-1 / R2**: `useValue` with an arrow function. **Never `useFactory`.** `useFactory` runs the arrow at injection time and starts every import eagerly at bootstrap — the exact inverse of the goal. If this is wrong, the bundle will not move and the batch fails its own measurement.

---

### Task 2.5: Rewire the three `AppShellComponent` fields and their template sites ✅ COMPLETE — **2 of 3 rewired, canvas reverted**

**Outcome, not a failure.** `marketplaceComponent` and `tribunalComponent` are `this.lazyViews.resolveWhen(TOKEN, () => this.currentView() === '…')`, with the template sites taking the added signal call parentheses. `orchestraCanvasComponent` is back to `inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null`. R11 satisfied — `lazyViews` is declared above every field that references it. `[class.hidden]` preserved on the canvas container; the `@else` spinner it gained was kept.

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` — 3 fields, within the block at lines 156-203
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` — lines **82-88** (marketplace), **95-101** (tribunal), **~657** (canvas)

```ts
// BEFORE
readonly marketplaceComponent = inject(MARKETPLACE_COMPONENT, { optional: true }) ?? null;
// AFTER
private readonly lazyViews = inject(LazyViewService);
readonly marketplaceComponent = this.lazyViews.resolveWhen(
  MARKETPLACE_COMPONENT,
  () => this.currentView() === 'marketplace',
);
```

Triggers: marketplace → `currentView() === 'marketplace'`; tribunal → `currentView() === 'tribunal'`; **canvas → see the AMENDMENT below, NOT a bare `layoutMode() === 'grid'`**.

**Validation notes — R11**: `lazyViews` must be declared **before** the seven fields, because they reference `this.lazyViews`. Angular initialises class fields top-to-bottom.

**Validation notes — canvas edge case**: the canvas outlet at html ~657 sits under `[class.hidden]="layoutMode() !== 'grid'"` (line 656) — it is **hidden, not destroyed**. Gate its loader on layout mode, **not** on visibility. It is also the **only** one of the seven with **no `@else` spinner** — add the same spinner the other six already use.

> ### ❌ RESOLVED — canvas is NOT deferred. Read this before the amendment below.
>
> **Outcome (2026-08-09, user decision on measured evidence): the canvas was
> reverted to eager. Marketplace and tribunal remain lazy.** The amendment below
> is kept as the reasoning trail, not as instructions — **do not implement it.**
>
> **Why.** `ElectronShellComponent`'s constructor calls `setLayoutMode('grid')`
> unconditionally on every launch (`electron-shell.component.ts:296-299`,
> _"Electron uses the canvas as its sole chat surface"_), and it constructs before
> the `AppShellComponent` it embeds. **In Electron the canvas is unconditionally
> the launch surface.** Deferring it is the exact anti-pattern `context.md:91-93`
> names: _"A deferred surface that the user opens immediately is a loss, not a
> win."_
>
> **Measured**, `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`,
> reload → canvas interactive, same machine and session:
>
> | Variant                                                    |                         Median |
> | ---------------------------------------------------------- | -----------------------------: |
> | Eager canvas (pre-Batch-2)                                 |                     **306 ms** |
> | Lazy, load after first paint + idle (amendment as written) |           **406 ms** (+100 ms) |
> | Lazy, load immediately at bootstrap (revision)             | **376.5 ms** (+70 ms residual) |
>
> Both lazy variants regressed. The second attempt recovered only ~30% of the gap;
> a real chunk fetch is not free. Trade rejected: ~118 kB of initial bundle
> (canvas 28 + `gridstack` 90) was not worth 50–70 ms on the surface the user is
> actually waiting for. `gridstack` returns to the initial bundle with it — it has
> exactly two consumers, canvas and tribunal, and only leaves when both do.
>
> **The transferable rule, which is the real finding: never defer the launch
> surface.** Deferral moves bytes off the _initial-bundle budget_ but not off the
> _critical path_ when the deferred surface is what opens. The budget check passes
> either way, which is what makes this failure mode silent — it is invisible to
> every gate in this task except a startup-timing measurement.
>
> Full evidence: `e2e-validation-report.md` §3.3, §6, §7.
>
> ---
>
> ### ⚠️ AMENDMENT — canvas trigger (added 2026-08-09, user-approved) — SUPERSEDED, see above
>
> **R14 — a bare `layoutMode() === 'grid'` trigger fires at bootstrap.**
> `AppStateManager._layoutMode` is `signal<LayoutMode>('grid')`
> (`libs/frontend/core/src/lib/services/app-state.service.ts:171`) and is restored
> from `localStorage` at `:331-335`. For default and grid-persisted users the
> trigger is therefore **true at the first change-detection pass**, so canvas +
> `gridstack` (~115 kB) would be fetched on the launch path.
>
> The initial-bundle budget would still pass — they do leave the initial chunks —
> which is exactly why this would slip through unnoticed. But it breaks this
> batch's own gate (_"none of the three new lazy chunks is fetched on the chat
> launch path"_) and puts a fetch on chat's critical path, which `context.md:91-93`
> makes an acceptance criterion.
>
> **Required trigger shape** — two conditions, OR'd:
>
> 1. **Explicit intent, immediate**: the user toggles into grid mode, or an
>    explicit canvas request arrives (`canvasSessionRequest` / the new-tile
>    request signal, `app-state.service.ts:173,243-244`). Load at once — the user
>    is looking at it.
> 2. **Persisted grid mode, deferred past first paint**: `layoutMode() === 'grid'`
>    at bootstrap still loads canvas, but **off the critical path** — after first
>    render (`afterNextRender`, or an idle callback). It must NOT be part of the
>    initial render pass.
>
> **Condition 2 is not optional.** A trigger that only fires on an explicit toggle
> **strands every grid-persisted user on an empty grid forever**, because they
> never toggle — grid is already their mode. If the implementation cannot load
> canvas for those users without a toggle, it is wrong.
>
> For a grid-persisted user canvas **is** the launch surface, so deferring it
> cannot make _them_ faster; the goal for that path is only that it not be worse.
> Measure it: record time-to-interactive-canvas for a grid-persisted profile
> alongside the chat TTI number.
>
> **Verification for this batch must be run in BOTH layout modes**, not just the
> default:
>
> - `layoutMode = 'single'` (localStorage `ptah-layout-mode`) → the canvas chunk
>   must **not** be fetched on the chat launch path. This is the real R7/launch-path
>   gate.
> - `layoutMode = 'grid'` → canvas loads without a toggle, and the fetch is after
>   first paint, not during it.
>
> **Second-order behaviour change to state in the batch report**: `CanvasStore` is
> `@Injectable()` scoped **per `OrchestraCanvasComponent` instance**
> (`libs/frontend/canvas/src/lib/canvas.store.ts:41,53`), and the component is
> currently mounted at shell init and merely hidden via `[class.hidden]` —
> deliberately, so tile state survives layout toggles
> (`app-shell.component.html:652-654`). Deferring the component moves
> `CanvasStore`'s construction from shell-init to first canvas activation, which
> changes its construction order relative to `TabManagerService` and to a
> workspace switch. Keep `[class.hidden]` — do **not** convert it to `@if` on
> `layoutMode`, or tile state is destroyed on every toggle. Related follow-up
> filed as **TASK_2026_195**.

**Template change is smaller than it looks.** Marketplace and tribunal already have the correct `@else` spinner (verified at html 82-88 and 95-101) — that spinner **is** the loading state for an in-flight dynamic import. No new UI. Each site becomes:

```html
@if (marketplaceComponent(); as cmp) {
<ng-container *ngComponentOutlet="cmp" />
} @else {
<div class="flex items-center justify-center h-full">
  <span class="loading loading-spinner loading-md"></span>
</div>
}
```

Note the added call parentheses — the field is now a `Signal`, not a value.

---

### Task 2.6: Verification — build, attribution, `gridstack` check ✅ COMPLETE

**No file changes.** Results in the batch header table above; the developer's full chunk tables are in `batch-2-report.md` §14 and the TTI method is in `e2e-validation-report.md` §6–§8.

- [x] Build green; initial total **2,996,828 B (3.00 MB / 597.46 kB)** — **above** the planned 2.89–2.98 MB band, because the canvas revert returned canvas + `gridstack` to the initial set. Accepted: the band assumed a deferral that measurement rejected
- [x] Full initial + lazy chunk table recorded (5 lazy chunks, down from 7 pre-revert)
- [x] `main.js` recorded — **and retired as the I-4 signal**; initial-total transfer replaces it
- [x] `modulepreload` recorded — 8 entries, all initial, no lazy chunk preloaded (R7 holds)
- [x] **`gridstack` is BACK in the initial chunks — expected and accepted.** R10 in reverse: two consumers, and tribunal alone cannot shed it
- [x] Marketplace and tribunal absent from every initial chunk, verified by marker grep across the initial set vs the lazy chunks
- [x] Automated coverage replaced the manual gate: `marketplace.spec.ts`, `tribunal.spec.ts`, `canvas.spec.ts`, `startup-tti.spec.ts` (commit `05ec1ed50`)

**Original checklist, retained for the record:**

- [x] `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache` green
- [x] Full initial + lazy chunk table recorded; initial total in the **~2.89–2.98 MB** band → **superseded, see above**
- [x] `main.js` transfer recorded, **not grown** vs Batch 1 (I-4) → **superseded, see above**
- [x] `modulepreload` diff recorded — no new entries (R7)
- [ ] ~~**`gridstack` no longer appears in ANY initial chunk**~~ — **reversed by the canvas revert** — verify via the attribution script, **not** by arithmetic. It has exactly two consumers (`canvas-workspace-grid.component.ts:11,16`, `tribunal-page.component.ts:9,14`) and only leaves if **both** left (R10). If `gridstack` is still initial, say so with the numbers — the delta lands at the bottom of the band and that is a fact for Batch 3 to plan around, not a failure.
- [x] Manual: canvas grid, marketplace, tribunal each render — **automated instead**, `marketplace.spec.ts` / `tribunal.spec.ts` / `canvas.spec.ts`. The specs assert the settled state, not the transient spinner frame; catching a sub-100 ms local-disk spinner reliably would need artificial throttling
- [x] Manual, **`layoutMode = 'single'`** — **structurally inapplicable to Electron.** `ElectronShellComponent` forces grid unconditionally, so single mode is unreachable there. The retained test in `canvas.spec.ts` proves that and fails loudly if it ever changes. If this gate is still wanted it must run against the VS Code webview (`ptah-extension-vscode-e2e`), which this batch did not touch
- [ ] ~~Manual, **`layoutMode = 'grid'`** (R14): canvas chunk fetched **after** first paint~~ — **MOOT.** There is no canvas chunk; the property this asked about no longer exists in the product. §6/§7/§8 of `e2e-validation-report.md` are the record of why
- [x] `npx nx test core` passes with the new `lazy-view.service.spec.ts` — 23 suites / 471 tests, re-run independently by team-leader

**Risk**: Low-Med — `gridstack/dist/angular` under a dynamic import is the one thing to watch.
**Rollback**: revert to `useValue: Component` per token, independently. Unit 2's files can stay (harmless additions).

---

## Batch 3: `@defer` thoth-shell (dashboard NOT deferred — R15), with narrow service barrels ✅ COMPLETE

**Status**: ✅ COMPLETE
**Commits** (two, deliberately split — the application change and the e2e coverage are separable):

- `9fd167b4f` — `perf(webview): defer the Thoth shell and cut the eager edge into its four tab libs` (9 files)
- `4508df433` — `test(electron): prove the Thoth MESSAGE_HANDLERS stay eager with Thoth never opened` (1 file)

**ACTUAL delta**: **2,996,828 B → 2,702,149 B = −294,679 B (−294.68 kB)**. Initial transfer **597.46 → 552.76 kB**. **Remaining gap to 2,500,000 B: 202,149 B.** Angular's own budget line agrees: _"Budget 2.50 MB was not met by 202.15 kB"_, down from _"496.83 kB"_.

**One `@defer` shipped, not two.** `ThothShellComponent` is behind `@defer (on immediate)` inside the existing `'thoth'` `@case`; `ptah-dashboard-grid` stays **eager** on the R15 finding below. Both `imports:` entries in `app-shell.component.ts:112-113` are retained — `@defer` requires them.

#### The R15 outcome — dashboard NOT deferred, and why it was nearly missed

`ptah.openDashboard` is a **VS Code activation event** (`apps/ptah-extension-vscode/package.json:42`), with a contributed command (`:115`) and a menu entry (`:153`). It calls `createPanel({ initialView: 'analytics' })` (`ptah-extension.ts:125-138`); `'analytics'` is in `webview-html-generator.ts:106-113` `VALID_VIEWS` and is emitted as `window.ptahConfig.initialView`; `app-state.service.ts:324-354` sets `currentView` from it **at service construction, before first render**; `app-shell.component.html:40-44` renders `<ptah-dashboard-grid />` for that case. That is a from-scratch bootstrap onto analytics with a user waiting on it — the same shape that made deferring the canvas a measured loss in Batch 2. **Deferring it would have put a chunk fetch in front of the surface the user explicitly asked for, and the initial-bundle budget would have passed either way.** −35.7 kB was left on the table deliberately.

**The transferable half of this finding**: the disqualifying evidence was **not visible from inside the webview**. It lived in the extension-host manifest. `thoth-shell` by contrast is genuinely safe — `'thoth'` is absent from both `initialView` allow-lists (`app.ts:100-109`, `webview-html-generator.ts:106-113`), no `createPanel` call site requests it, `currentView` is not persisted (`localStorage` holds only `ptah-layout-mode` and the Thoth first-run flag), and `ElectronShellComponent` never sets it. Reachable only by an explicit tab click, so deferring it cannot regress startup TTI. Since nothing launch-reachable was deferred, `startup-tti.spec.ts` was not a required gate; the tester ran it anyway (§9.5) and found no Thoth-attributable movement.

#### The third import edge — the batch's most valuable output

The plan modelled **two** edges into the four Thoth tab libs (the `ThothShellComponent` template edge, and four service imports in `app.config.ts`). There is a **third**: `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:16-19` imported `MemoryRpcService` / `SkillSynthesisRpcService` / `CronRpcService` / `GatewayRpcService` through the **wide** barrels. `ThothStatusService` is an eager `MESSAGE_HANDLERS` entry living in `dashboard`, which R15 forbids deferring — so that one file pinned **all four** libs into the initial bundle regardless of the `@defer` or of anything in `app.config.ts`.

Measured, not assumed: **`@defer` alone moved +1.35 kB — i.e. WORSE than nothing.** Repointing `thoth-status.service.ts` onto the `/services` subpaths is what actually moved the bytes. This required a **fifth** barrel the plan did not list, `cron-scheduler-ui/src/services.ts`, because `CronRpcService` had no narrow entry point. **It also falsifies a stated assumption in this file** (edge-case list, and Task 3.3): _"`cron-scheduler-ui` reaches the bundle only through `ThothShellComponent`"_ is **false** — it also reached it through `ThothStatusService` → `CronRpcService`. **Batch 4 must apply this lesson before estimating**: grep for **every** external importer of a wide barrel, not just the `app.config.ts` one.

#### R6 keep/drop record — every kept barrel has a measured delta behind it

| Lib                    | BEFORE (initial) | AFTER (initial) |          Δ | Call                             |
| ---------------------- | ---------------: | --------------: | ---------: | -------------------------------- |
| `skill-synthesis-ui`   |         137.8 kB |         19.8 kB | **−118.0** | **KEEP**                         |
| `memory-curator-ui`    |         108.9 kB |          9.0 kB |  **−99.9** | **KEEP**                         |
| `messaging-gateway-ui` |          43.9 kB |          9.7 kB |  **−34.2** | **KEEP**                         |
| `cron-scheduler-ui`    |          33.0 kB |      **absent** |  **−33.0** | **KEEP** (unplanned, see above)  |
| `dashboard`            |          35.7 kB |         35.8 kB |   **+0.1** | **DROP**                         |
| `thoth-shell`          |           5.3 kB |      **absent** |       −5.3 | via `@defer`                     |
| `ui` (bonus)           |          25.0 kB |         18.1 kB |       −6.9 | follows the Thoth components out |
| `@angular/core`        |         142.5 kB |        148.3 kB |       +5.8 | `@defer` runtime                 |

**No dead scaffolding was carried.** The `dashboard` narrow barrel was built, wired and measured at **zero benefit** — structural, not tree-shaking: `DashboardGridComponent` stays a static template dependency via `AppShellComponent.imports` no matter which specifier `app.config.ts` uses, precisely _because_ R15 forbids deferring it. `libs/frontend/dashboard/src/services.ts` was **deleted**, its `tsconfig.base.json` path **removed**, and the `app.config.ts` import **reverted to the wide barrel with the measurement recorded in a comment** so nobody re-derives it. Team-leader confirmed the file is absent and no `@ptah-extension/dashboard/services` path exists. The four kept barrels are each demonstrably load-bearing — not the `/*@__PURE__*/` no-op case R6 warned might occur — and every export in them has a real consumer.

**Actual vs expected**: expected **~365 kB ESTIMATED**; actual **−294.68 kB**. The ~70 kB shortfall is fully accounted for, and is a deliberate evidence-backed choice rather than a miss: **−35.7 kB** never available (dashboard not deferred, R15); **~−38.5 kB** deliberately retained as the eager `MESSAGE_HANDLERS` + RPC residue that **I-3 requires** stay in the initial bundle (skill 19.8 + gateway 9.7 + memory 9.0); **+5.8 kB** `@angular/core` growth for the `@defer` runtime.

#### Batch 3 result — verified independently by team-leader

| Check                                             | Method                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build reproduces                                  | independent `npx nx build … --configuration=production --skip-nx-cache`              | ✅ **2,702,149 B / 552.76 kB**, identical chunk hashes **and** byte sizes to the report. Summed 14 `index.html`-referenced files = 2,700,771 B, **+ 1,378 B** for `chunk-6F4HVVOU.js` (an initial chunk that is no longer preloaded) = **2,702,149 B exactly**                                                                                                                                  |
| `@defer` scope                                    | read `app-shell.component.html` + `.ts`                                              | ✅ `@defer` wraps `<ptah-thoth-shell />` **only**. `<ptah-dashboard-grid />` at html:42 is bare/eager. `DashboardGridComponent` and `ThothShellComponent` both still in `imports:` at `:112-113`                                                                                                                                                                                                |
| Attribution — the four libs left                  | marker grep across the 14 initial files vs the 6 lazy chunks                         | ✅ `skill-synthesis-ui`, `memory-curator-ui`, `messaging-gateway-ui`, **`cron-scheduler-ui`** → **ABSENT from every initial chunk**, present only in the new 302,515 B `chunk-EFFTIVBS.js`. `cron-scheduler-ui` is the clean single indicator the edge was cut, and it is clean                                                                                                                 |
| Attribution — `@defer` shape proven, not inferred | byte-level inspection of both chunks                                                 | ✅ the initial `chunk-XOTFZ7YS.js` holds only the deferred-block template stub (`function cC(i,t){i&1&&h(0,"ptah-thoth-shell")}`); the actual `ɵcmp` with `selectors:[["ptah-thoth-shell"]]` is in the **lazy** chunk. That is exactly the `@defer` split                                                                                                                                       |
| Attribution — dashboard still eager               | same grep                                                                            | ✅ `ptah-dashboard-grid` present in **initial** `chunk-XOTFZ7YS.js` + `chunk-5H5O23XF.js`, absent from every lazy chunk                                                                                                                                                                                                                                                                         |
| No wide-barrel importer left                      | `grep -rn` for the four bare specifiers across `apps/` + `libs/`                     | ✅ only `*.spec.ts` files (not bundled) and `thoth-shell.component.ts` itself, which is **inside** the deferred chunk                                                                                                                                                                                                                                                                           |
| **I-4** initial-total transfer                    | build table                                                                          | ✅ **597.46 → 552.76 kB**. `main.js` +99 B recorded, **not** interpreted — it is no longer a valid proxy (Batch 2 §11)                                                                                                                                                                                                                                                                          |
| **R7** `modulepreload`                            | parsed `index.html`                                                                  | ✅ 10 entries, **all initial**. **None of the 6 lazy chunks is preloaded** — in particular the 302,515 B Thoth chunk is not. Three new entries exist and the report states so plainly rather than claiming "no new entries"; all three are re-partitioned pieces of the pre-existing eager set and are already inside the 2,702,149 B total. Total preloaded bytes fell 2,255,796 → 1,959,640 B |
| **I-8** DO-NOT-TOUCH                              | `git status --porcelain` on all five paths                                           | ✅ all clean                                                                                                                                                                                                                                                                                                                                                                                    |
| **I-5** Monaco                                    | `provideMonacoEditor` block + asset globs + `editor/src/lib/{code-editor,diff-view}` | ✅ untouched at `app.config.ts:211-213`                                                                                                                                                                                                                                                                                                                                                         |
| **I-7**                                           | build warnings                                                                       | ✅ all three `@xterm/* is not ESM` warnings still emitted, unactioned as required; no `allowedCommonJsDependencies`                                                                                                                                                                                                                                                                             |
| **I-6**                                           | —                                                                                    | N/A — no `project.json` edit in this batch. Unit 8 (Batch 5) still needs `npx nx reset`, and R12a's Windows sequence still stands                                                                                                                                                                                                                                                               |
| Tests                                             | `nx run-many -t test -p core,chat,ptah-extension-webview --skip-nx-cache`            | ✅ core **23 suites / 471**; chat **50 suites / 658 passed + 2 skipped**; webview **3 suites / 14** — the webview count includes the new `thoth-message-routing.spec.ts` and it passes                                                                                                                                                                                                          |
| Typecheck                                         | `run-many -t typecheck` over 9 projects                                              | ✅ **9/9**                                                                                                                                                                                                                                                                                                                                                                                      |
| Lint                                              | `run-many -t lint` over 8 projects incl. `ptah-electron-e2e`, `--skip-nx-cache`      | ✅ **8/8, 0 errors**; 41 warnings, all pre-existing (`explicit-member-accessibility`, non-null assertions)                                                                                                                                                                                                                                                                                      |

**R4 — independently confirmed, at two levels.** `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts` (Jest, 14 tests) wires the **real** `MessageRouterService` to the **real** services through the **same `useExisting` `MESSAGE_HANDLERS` registrations `app.config.ts` uses**, importing each through the **narrow-barrel specifier production now takes**, then dispatches genuine `window` `MessageEvent`s with hard-coded literal wire strings and asserts an observable state change — never instantiating any Thoth component. Two structural properties make it a real gate: a barrel that stops exporting one of the four **fails to compile**, and a dropped registration **throws at `TestBed.inject`** because `MessageRouterService` builds its handler map from `handledMessageTypes` in its constructor. The `gateway:statusChanged` fan-out is asserted from **both** of its independent subscribers, so a half-dropped registration cannot hide.

The e2e half (`message-handlers-eager.spec.ts`, 4 tests) closes the gap the Jest spec cannot reach. **The five pre-existing Thoth specs proved nothing about the R4 condition** — `cron`/`gateway`/`memory`/`skills` all call `ui.openTab(...)` _before_ any push is dispatched, including `gateway.spec.ts`'s own "push transitions a tile" test, so they demonstrate delivery **while mounted**, which was never in question. The new spec proves delivery with Thoth's DOM **never created**, and each of its four tests is built on a source-verified mechanism that stops a mount-time RPC refresh from laundering a dropped push (three of the four services refresh themselves on mount). Every assertion was checked against what it would read had the push never been sent.

| Service                      | Method                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SkillSynthesisLiveService`  | push `curator-pass` → asserts the `skillSynthesis:stats` RPC fires as a direct side effect of `handleMessage`, **zero UI mounted**                                         |
| `GatewayStateService`        | `gateway:status` mocked without `adapters` → mount-time `refreshStatus()` throws internally and leaves `platforms` untouched, so the pre-mount push survives to first open |
| `VecEmbedderRecoveryService` | `db:health` mocked without `vecDiagnostic` → `primeVecDiagnostic()` guards before overwriting (documented product behaviour)                                               |
| `ThothStatusService`         | open (baseline) → close → push → **reopen**; `refreshIfNeeded()` is first-call-only, so the second mount cannot clobber                                                    |

**Tester validation** (`e2e-validation-report.md` §9): **14/14 pass, 0 failures** across `thoth/{cron,gateway,memory,skills}`, `dashboard/dashboard` and the new `message-handlers-eager.spec.ts`, run against a rebuilt Batch 3 tree. `dashboard.spec.ts` is the regression guard for the `thoth-status.service.ts` repoint — its pillar-tile assertion drives all four RPC services through the new subpaths end-to-end. Startup TTI moved up in absolute terms but **paint timing moved proportionally with it** (wall-clock ×1.47, paint ×1.30) and nothing in a deferred Thoth chunk can affect paint at all — the same corroborating-control that §8 used. **Verdict: no Thoth-attributable TTI movement.**

**⚠️ Still open, needs a GUI (non-blocking, carry into Task 5.3)**: (1) visual check of the new `@placeholder` spinner on the Thoth tab — the e2e specs assert settled state, and a sub-100 ms local-disk spinner needs artificial throttling to catch reliably (same limitation Batch 2 recorded); (2) DevTools Network confirmation that the 302,515 B Thoth chunk is **not** fetched on the chat launch path. Static analysis says it cannot be — not preloaded, `@defer` inside an inactive `@case`, and team-leader verified both — but R7 and R15 exist precisely because inference is what fails silently here.

**⚠️ Commit hygiene.** Both commits used explicit pathspecs (`git commit -- <paths>`), never `git add -A`, because the git index is shared with a concurrent session that swept Batch 2's staged files into an unrelated commit once already (`4163b8ec2`). `git show --numstat` verified after each: commit 1 = exactly the 9 intended files, commit 2 = exactly 1. Nothing under `libs/api/**`, `libs/backend/**`, `apps/ptah-cli/**`, `CLAUDE.md` or `marketing/**` came along. **One side effect worth knowing for Batch 4**: the pre-commit hook's formatter rewrote one line of `thoth-message-routing.spec.ts` _in the index_, but a pathspec commit builds its tree from the **worktree**, so the committed content was the pre-format version and the path was left `MM` afterwards. Resolved with `git checkout HEAD -- <path>`; the difference was a single line wrap and both forms are lint-clean. Expect this whenever pathspec-committing a file the hook reformats.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Biggest single estimated win, and the first batch where the `@defer` mechanism and the narrow-barrel mechanism are exercised together. It ships alone because R6 (barrel may yield nothing) and R4 (dropped `MESSAGE_HANDLERS`) both bite here, and both need an isolated measurement to diagnose.
**⚠️ R15 — CHECK THE LAUNCH SURFACE BEFORE DEFERRING ANYTHING.** Batch 2 deferred the canvas, measured a +100 ms Electron startup-TTI regression, and reverted it. **Before deferring any surface, establish whether it can be the surface that opens at launch.** `dashboard`, `thoth-shell` and `tasks-ui` are all reachable as a startup view. For any surface that can open at launch, run `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` **before and after** and compare medians in the same session. **The initial-bundle budget passes either way, so it is not a gate for this** — that is precisely what makes the failure mode silent. Batch 3's targets are reached by explicit navigation and are probably safe, but confirm it rather than assume it.
**Unit**: Unit 4 (plan §10)
**Tasks**: 4 | **Dependencies**: Batch 2 (`9e8ef9af4`, `05ec1ed50`)
**Starting number**: **2,996,828 B / 597.46 kB initial.** Gap to 2,500,000 B: **496,828 B**. Track **initial-total transfer**, not `main.js` — the eager set was re-partitioned in Batch 2 and `main.js` is no longer a valid TTI proxy.
**Expected delta**: **~365 kB — ESTIMATED** (thoth group 329 = skill-synthesis 137.8 + memory-curator 108.8 + gateway 43.9 + cron 33.0 + shell 5.3; dashboard 36) **if the narrow barrels do their job**. Cumulative target ≈ **2.52–2.62 MB**.

### Task 3.1: `@defer` the two single-use components ✅ COMPLETE — **1 of 2 deferred, dashboard excluded by R15**

**Outcome, not a failure.** `ThothShellComponent` is behind `@defer (on immediate)` with the spinner `@placeholder`, inside the existing `'thoth'` `@case`. **`ptah-dashboard-grid` was deliberately left eager** — `ptah.openDashboard` is a VS Code activation event, so analytics is a startup-reachable surface (see the R15 outcome in the batch header). Both `imports:` entries at `:112-113` retained. The template carries a comment recording _why_ the Thoth one is safe and the dashboard one is not, so it is not "fixed" later as an obvious win.

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` — lines **40-44** (`ptah-dashboard-grid` at 42), **72-77** (`ptah-thoth-shell` at 75)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` — **leave the `imports:` entries at lines 111-112 in place.** `@defer` requires them; removing them breaks the mechanism.

**Verified**: `ptah-dashboard-grid` is used exactly once (html:42) and `ptah-thoth-shell` exactly once (html:75) in that template and nowhere else.

```html
@case ('thoth') {
<div class="h-full w-full">
  @defer (on immediate) {
  <ptah-thoth-shell />
  } @placeholder {
  <div class="flex items-center justify-center h-full">
    <span class="loading loading-spinner loading-md"></span>
  </div>
  }
</div>
}
```

The `@defer` sits **inside** the existing `@case`, so it instantiates only when the view activates.

**Why this is `@defer` and not a token** (plan §3): these two components are static template dependencies of `AppShellComponent`, so Angular can see and cut the edge. The seven token surfaces are **not** — they render through `*ngComponentOutlet` with a class obtained from DI, and the static edge lives in `app.config.ts`, a different file in a different library. Wrapping a token outlet in `@defer` moves exactly **0 bytes**.

`ThothShellComponent` pulls all four Thoth tab libs in its own `imports:` array (`thoth-shell.component.ts:52-59`), so **one** `@defer` sheds `memory-curator-ui`, `skill-synthesis-ui`, `cron-scheduler-ui` and `messaging-gateway-ui` at once. `cron-scheduler-ui` reaches the bundle _only_ through this path.

---

### Task 3.2: Narrow `/services` barrels for the four entangled libs ✅ COMPLETE — **4 shipped, but not the four listed here**

**The shipped set differs from the plan, on measurement.** `dashboard` was built, measured at **+0.1 kB** and **dropped** per R6 (barrel deleted, tsconfig path removed, import reverted to the wide barrel with the measurement in a comment). A **fifth** lib the plan did not list, `cron-scheduler-ui`, needed a barrel — `CronRpcService` had no narrow entry point and `ThothStatusService` imported it from the wide one. Final shipped set: `messaging-gateway-ui`, `skill-synthesis-ui`, `memory-curator-ui`, `cron-scheduler-ui`. All four RPC services were verified component-free first (each imports only `@angular/core`, `@ptah-extension/core`, and type-only `@ptah-extension/shared`). The application site the plan missed — `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:16-19` — is documented in the batch header; without it the `@defer` moved **+1.35 kB**, i.e. nothing. Per-lib keep/drop numbers are in the batch header's R6 table.

**CREATE** (one per lib):

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\services.ts` → `ThothStatusService`
- `D:\projects\ptah-extension\libs\frontend\messaging-gateway-ui\src\services.ts` → `GatewayStateService`
- `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\services.ts` → `SkillSynthesisLiveService`
- `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\services.ts` → `VecEmbedderRecoveryService`

**MODIFY**:

- `D:\projects\ptah-extension\tsconfig.base.json` — add four `@ptah-extension/<lib>/services` paths
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts` — repoint lines **49** (gateway), **50** (skill-synthesis), **51** (dashboard), **60** (memory-curator)

**Template to copy verbatim**: `libs/frontend/editor/src/services.ts` + `tsconfig.base.json:81-83`.

**Why this is needed** (plan §8.5): flipping a token or adding a `@defer` does **nothing** if `app.config.ts` still statically imports a _service_ from the same wide barrel. These four services are `MESSAGE_HANDLERS` entries and **must stay eager** — they are constructed at bootstrap to receive push messages. **The components must not.**

**MEASURE-THEN-DECIDE (R6)**: measure **per lib**. If a lib's narrow barrel produces no measurable delta — because esbuild already tree-shook the wide barrel via `/*@__PURE__*/` — **delete that lib's `services.ts` + tsconfig path and revert its `app.config.ts` import.** Do not carry dead scaffolding. Report the per-lib numbers behind each keep/drop call.

---

### Task 3.3: Verify the four Thoth libs and `cron-scheduler-ui` left the initial chunks ✅ COMPLETE

**Confirmed by the developer's source-map attribution and re-confirmed independently by team-leader** with a marker grep across the 14 initial files vs the 6 lazy chunks: `skill-synthesis-ui`, `memory-curator-ui`, `messaging-gateway-ui` and `cron-scheduler-ui` are **absent from every initial chunk** and appear only in the new 302,515 B `chunk-EFFTIVBS.js`. `thoth-shell` likewise — and the split was verified at byte level, not inferred: the initial chunk holds only the deferred-block template stub, while the `ɵcmp` with `selectors:[["ptah-thoth-shell"]]` is in the lazy chunk.

**`dashboard` is NOT absent, and that is the correct outcome** — it was excluded from deferral by R15 (batch header). The `ptah-dashboard-grid` marker is present in two initial chunks and no lazy chunk.

**⚠️ This task's own premise was falsified.** _"`cron-scheduler-ui` … reaches the bundle only through `ThothShellComponent`"_ is **false**: it also reached it through `ThothStatusService` → `CronRpcService` in the eager `dashboard` lib. It is still the cleanest single indicator — but only _after_ both edges were cut. The `@defer` alone left it in the initial set.

**No file changes.** Run the attribution script and confirm, per lib:

- `skill-synthesis-ui`, `memory-curator-ui`, `messaging-gateway-ui`, `cron-scheduler-ui`, ~~`dashboard`~~ → **absent from every initial chunk**
- `cron-scheduler-ui` in particular reaches the bundle _only_ through `ThothShellComponent` — **see the correction above**

Report the actual per-lib bytes moved against the estimates in the table above.

---

### Task 3.4: The `MESSAGE_HANDLERS` assertion (R4 — blocking) ✅ COMPLETE — **closed at two levels, with two new spec files**

**This task shipped files, contrary to its "no file changes" note** — the gate could not be closed by inspection. `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts` (Jest, 14 tests, in commit `9fd167b4f`) and `apps/ptah-electron-e2e/src/specs/thoth/message-handlers-eager.spec.ts` (Playwright, 4 tests, in commit `4508df433`). Methods per service are in the batch header. All four assert by **dispatch-and-observe**, never by provider-list inspection.

**The five pre-existing Thoth e2e specs did not cover this and could not have.** Every one of them opens the tab _before_ pushing, so they prove delivery while mounted — never the "never opened" condition R4 is about. The new e2e spec is what closes it, and it also had to defeat a subtler trap: three of the four services refresh themselves via RPC on mount, so a naive "push, then open and look" test would pass even with the push entirely dropped.

With the app sitting on the **chat view and Thoth NEVER opened**, assert that push messages still land for **all four** services:

- [x] `GatewayStateService` (messaging-gateway-ui) — `gateway:bindingsChanged` → `bindings()` `[]` → 1 entry (Jest); `gateway:status` mocked without `adapters` so the mount refresh cannot overwrite (e2e)
- [x] `SkillSynthesisLiveService` (skill-synthesis-ui) — `skillSynthesis:event` → `activity()` `null` → `'Curator analyzing candidates…'` (Jest); RPC side effect of `handleMessage` with zero UI mounted (e2e)
- [x] `VecEmbedderRecoveryService` (memory-curator-ui) — `db:vecStatusChanged` → `vecDiagnostic()`/`vecAvailable()`, and `embedder:statusChanged` → `embedderReady()` (Jest); `db:health` mocked without `vecDiagnostic` (e2e)
- [x] `ThothStatusService` (dashboard) — `gateway:statusChanged` → `summary().gateway.available` `false` → `true` (Jest); open→close→push→reopen against the first-call-only `refreshIfNeeded()` guard (e2e)
- [x] **fan-out**: one `gateway:statusChanged` reaches **both** subscribers in a single dispatch — the case where a half-dropped registration would still look fine from one side

State **how** each was asserted (which push message was triggered, what observable effect confirmed it landed). "The service is still in the providers array" is **not** an assertion — the failure mode is that the narrow barrel dropped the registration, so the provider list is exactly what you cannot trust.

**Batch 3 Verification**:

- [x] Build green; initial total **2,702,149 B (2.70 MB / 552.76 kB)** — **above** the planned 2.52–2.62 MB band, because R15 removed the dashboard's ~35.7 kB from the available reduction and I-3 requires ~38.5 kB of service residue stay eager. Accepted: the band assumed a deferral the launch-surface check rejected. Full initial + lazy chunk tables in `batch-3-report.md` §4; reproduced independently by team-leader with identical hashes and byte sizes
- [x] `main.js` recorded (+99 B, noise) — **not interpreted**; initial-total transfer 597.46 → 552.76 kB is the I-4 signal and it fell
- [x] `modulepreload` diff recorded — ~~no new entries~~ **three new entries, stated plainly rather than glossed.** All three are initial chunks already inside the 2,702,149 B total, re-partitioned from the pre-existing eager set. **The property R7 protects holds: none of the 6 lazy chunks is preloaded**, in particular not the 302,515 B Thoth chunk. Total preloaded bytes fell −296,156 B
- [x] Per-lib attribution deltas recorded; keep/drop stated with numbers for **five** barrels (R6) — four KEEP, `dashboard` DROP and deleted
- [x] Automated instead of manual: Thoth tab opens with all four sub-tabs functional — `thoth/{cron,gateway,memory,skills}.spec.ts`, 12 tests, all pass against the Batch 3 build. Each opens Thoth via the path that now resolves the `@defer` block, so a chunk that failed to resolve or a `@placeholder` that never cleared would time out every one of them
- [x] analytics view renders — `dashboard.spec.ts` passes; it also drives all four repointed RPC services end-to-end through the pillar tiles, which is the sharper regression guard for the `thoth-status.service.ts` change
- [ ] **Manual: no Thoth chunk fetched on the chat launch path (DevTools Network)** — **still open, non-blocking, carry into Task 5.3.** Static analysis is unambiguous (not preloaded, `@defer` inside an inactive `@case`, verified independently) but R7/R15 exist because inference is what fails silently
- [ ] **Manual: visual check of the new `@placeholder` spinner** — still open, same throttling limitation Batch 2 recorded
- [x] Task 3.4 assertions: all four ticked plus the fan-out case, each with its method stated

**Risk**: Med.
**Rollback**: revert the two `@defer` blocks; **keep** the narrow barrels — they are harmless on their own.

---

## Batch 4: tasks-ui + harness-builder → lazy tokens + narrow barrels (setup-wizard NOT deferred — R15) ✅ COMPLETE

**Status**: ✅ COMPLETE
**Commits** (two, deliberately split — the application change and the e2e coverage are separable):

- `b24ccf52a` — `perf(webview): defer the tasks board and harness builder behind lazy loaders` (9 files)
- `5fd739b03` — `test(electron): cover the tasks board and harness builder as deferred surfaces` (4 files)

**ACTUAL delta**: **2,702,149 B → 2,536,716 B = −165,433 B (−165.43 kB)**. Initial transfer **552.76 → 523.59 kB**. `main.js` **381,133 → 186,827 B (−194,306 B)** — a decrease, so I-4 is satisfied with room to spare rather than merely "not grown".

### 🚨 THE TARGET IS NOT MET — shortfall **36,716 B**

|                                 |         Bytes |
| ------------------------------- | ------------: |
| Initial total after Batch 4     | **2,536,716** |
| Budget (`maximumWarning` 2.5mb) |     2,500,000 |
| **REMAINING GAP**               |  **36,716 B** |

Angular's own budget line agrees to the byte: _"Budget 2.50 MB was not met by 36.72 kB with a total of 2.54 MB."_ **Do not read this batch as having cleared the target.** It moved the number a long way and it is the largest reduction batch after Batch 1, but Batch 5 still has to close 36,716 B before Unit 8 can be honest.

**The shortfall has exactly one cause, and it was a deliberate choice, not a miss.** The `~298 kB` estimate for this batch included `setup-wizard` at 108.9 kB. R15 disqualified it. Remove that line and the adjusted expectation is ~189 kB against ~155 kB of genuinely movable component code; the measured −165.43 kB sits between the two. The estimate's ~96 kB of margin over the 202,149 B gap **was** `setup-wizard`. The developer did not improvise replacement deferrals to reach the number, did not touch `libs/shared`/`zod` (plan §7), and did not raise a budget — all three are the right calls.

#### The R15 outcome — `setup-wizard` NOT deferred, and it is the THIRD such catch

`ptah.setupAgents` is a VS Code **activation event** (`apps/ptah-extension-vscode/package.json:41`) with a contributed, palette- and menu-visible command (`:91-92`, `:141`). Its handler (`apps/ptah-extension-vscode/src/commands/setup-agents-command.ts:31-51`) calls `launchWizard(...)`, which creates a **brand-new webview panel** (`libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts:79-96`) whose HTML **hardcodes `initialView: 'setup-wizard'`** (`.../wizard/webview-lifecycle.service.ts:149-156`). `'setup-wizard'` is in **both** allow-lists (`webview-html-generator.ts:106-113`, `app.ts:100-109`), so `AppStateManager` sets `currentView` from it **at service construction, before first render** (`app-state.service.ts:324-327`, `:352-354`), and `app-shell.component.html:20-29` renders the `WIZARD_VIEW_COMPONENT` outlet for that case.

**This is a stronger case than the dashboard's.** The dashboard rode a generic `createPanel({ initialView: 'analytics' })`; the wizard has a **purpose-built panel factory whose entire reason to exist is this one component**, with a user who just clicked "Setup Ptah Agents" waiting on a from-scratch Angular bootstrap. `WIZARD_VIEW_COMPONENT` keeps its `InjectionToken<Type<unknown>>` generic; both the import site and the provider carry comments recording _why_, so it is not "finished off" later as an obvious win.

**Third R15 outcome in three batches** — canvas (Batch 2, reverted on measurement), dashboard (Batch 3, caught before shipping), setup-wizard (Batch 4, caught before shipping). See the R15 outcomes row in the risk table for the running tally. **The pattern is now established well enough to state as a rule: on this codebase, the launch-surface check has disqualified a candidate in every single batch that ran it.** Batch 5 should expect the same and budget for it — which is part of why Unit 9 was chosen (CSS carries no launch-surface risk).

#### A stated assumption in this file was WRONG, and the correction matters for Batch 5

`tasks.md` predicted the wizard would be caught by the **auth-redirect effect**. It is not. That effect (`app-shell.component.ts:328-360`) returns early unless `currentView() === 'chat'`, latches on `authCheckDone`, and on `!hasAnyAuth` calls **`setCurrentView('settings')`** — there is **no branch to `'setup-wizard'`**. The wizard is disqualified by a completely independent and stronger path. The prediction was right about the conclusion and wrong about the mechanism, which is the kind of error that would have mattered if the mechanism had been the thing relied on.

**This correction is what removed Unit 6 from Batch 5**: `settings` — not the wizard — is the first-run launch surface, so deferring it was the one place the plan proposed to defer a launch surface on purpose. See the Batch 5 section.

#### R6 keep/drop record — every kept barrel has a measured delta behind it

Each barrel was probed by **reverting it to the wide specifier and rebuilding**, not assumed load-bearing.

| Barrel                                     | Probe (wide) initial total | Shipped (narrow) initial total |          **Worth** | Call            |
| ------------------------------------------ | -------------------------: | -----------------------------: | -----------------: | --------------- |
| `@ptah-extension/tasks-ui/services`        |                2,663,550 B |                    2,536,716 B |      **126,834 B** | **KEEP**        |
| `@ptah-extension/harness-builder/services` |                2,577,410 B |                    2,536,716 B |       **40,694 B** | **KEEP**        |
| `@ptah-extension/setup-wizard/services`    |                          — |                              — | **0 (structural)** | **NOT CREATED** |

Both kept barrels are decisively load-bearing — **not** the `/*@__PURE__*/` no-op case R6 warned might occur. Without them the eager `MESSAGE_HANDLERS` import re-pins the whole lib and the `import()` collapses back into the initial chunk, exactly as plan §8.5 predicted.

**The `setup-wizard` barrel was correctly NOT built.** Because R15 forces `WizardViewComponent` to stay eagerly imported in `app.config.ts`, the wide barrel stays in the eager graph _no matter which specifier the two services use_ — the barrel could not move a byte. This is the same structural no-op Batch 3 measured and dropped for `dashboard` (35.7 → 35.8 kB). **No dead scaffolding was carried in this batch, and none was built and thrown away either** — the developer reasoned to the no-op from the structure before spending the build cycle, which is the cheaper form of the same R6 discipline. The reasoning is recorded in a comment at the import site. `provideWizardInternalState()` continues to resolve from the wide barrel and is still spread at `app.config.ts:178`.

#### Per-lib attribution

| Lib               | Initial BEFORE | Initial AFTER |  Δ initial | Where it went                                                                            |
| ----------------- | -------------: | ------------: | ---------: | ---------------------------------------------------------------------------------------- |
| `tasks-ui`        |       135.6 kB |   **16.8 kB** | **−118.8** | 118.8 kB → lazy chunk; 16.8 kB residue = `TasksStore` (I-3 **requires** this stay eager) |
| `harness-builder` |        55.1 kB |   **15.8 kB** |  **−39.3** | 39.4 kB → lazy chunk; 15.8 kB residue = the four eager services (I-3)                    |
| `setup-wizard`    |       109.0 kB |  **109.0 kB** |      **0** | stays in `main.js` — not deferred (R15)                                                  |

#### Batch 4 result — verified independently by team-leader

| Check                                                           | Method                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build reproduces                                                | independent `npx nx build … --configuration=production --skip-nx-cache`                       | ✅ **2,536,716 B / 523.59 kB**, identical chunk names **and** byte sizes to the report's §4b. Angular's budget line: _"not met by 36.72 kB"_ — 2,500,000 + 36,716 matches exactly                                                                                                                                                                                                                                                                                                     |
| **I-1 / R2**                                                    | read `app.config.ts`                                                                          | ✅ all three new providers are `useValue` with arrow functions (`:143-156`, `:171-175`). The **only** `useFactory` occurrence in the file is inside the warning comment at `:138`. `WIZARD_VIEW_COMPONENT` remains `useValue: WizardViewComponent`                                                                                                                                                                                                                                    |
| **I-3 / R11**                                                   | `grep -n lazyViews app-shell.component.ts`                                                    | ✅ `lazyViews` declared at **:159**, above all five consumers (**:188, :201, :211, :221, :231**). Field-initialisation order safe                                                                                                                                                                                                                                                                                                                                                     |
| **Attribution from the BUILT OUTPUT, not the source**           | marker grep for compiled `selectors:[["…"]]` across the 19 initial files vs the 9 lazy chunks | ✅ `ptah-tasks-view`, `ptah-task-board`, `ptah-task-column`, `ptah-task-detail` → **lazy `chunk-VEOBSVJC.js` only**. `ptah-harness-builder-view`, `ptah-setup-hub`, `ptah-harness-config-preview` → **lazy `chunk-PGYZHVXX.js` only** — one chunk serving both views, confirmed. `ptah-wizard-view` → **`main.js` (initial)**, still eager as intended                                                                                                                                |
| **No wide-barrel leak** (the Batch 3 `ThothStatusService` trap) | `grep -rn "from '@ptah-extension/{tasks-ui,harness-builder}'"` across `apps/` + `libs/`       | ✅ **zero hits repo-wide** — not even in spec files. Every consumer is either the `/services` subpath or a dynamic `import()`. The eager residue in the initial chunks is **exactly and only** the I-3 services: `tasks:board`/`tasks:changed` resolve to initial `chunk-LJZR7JKA.js` (the `TasksStore` residue) and `harness:open-workflow` to initial `chunk-3AJTUKQV.js`, with **no component code alongside them**                                                                |
| One apparent initial-chunk hit, run to ground                   | `grep -oE '.{120}ptah-task-card.{120}'`                                                       | ✅ **false positive, not a leak.** `ptah-task-card` resolves in initial `chunk-GSXVN24C.js` — but it is a **selector collision**: `libs/frontend/chat/.../execution/task-card.component.ts:26` declares the same selector. The initial copy has `inputs:{node}` (chat's execution-tree card, eager by design); the lazy copy has `inputs:{task,selected,checked,pending,bulkOutcome,focused,graph}` (tasks-ui's board card). Two components, one selector, correct placement for both |
| **R7** `modulepreload`                                          | parsed `index.html`                                                                           | ✅ 10 entries, **all initial**. **None of the 9 lazy chunks is preloaded** — in particular not the 122,867 B tasks chunk nor the 41,190 B harness chunk. The report states plainly that there ARE four new entries rather than claiming "no new entries"; all four are re-partitioned pieces of the pre-existing eager set, already inside the 2,536,716 B total. Total preloaded bytes fell 1,959,640 → 1,148,645 B                                                                  |
| **I-4**                                                         | build table                                                                                   | ✅ initial-total transfer 552.76 → **523.59 kB**; `main.js` −194,306 B                                                                                                                                                                                                                                                                                                                                                                                                                |
| **I-5** Monaco                                                  | `provideMonacoEditor` block + asset globs + `editor/src/lib/{code-editor,diff-view}`          | ✅ untouched at `app.config.ts:237-239`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **I-7**                                                         | build warnings                                                                                | ✅ all three `@xterm/* is not ESM` warnings still emitted, unactioned as required; no `allowedCommonJsDependencies`                                                                                                                                                                                                                                                                                                                                                                   |
| **I-8** DO-NOT-TOUCH                                            | `git status --porcelain` on all six paths                                                     | ✅ all clean; TASK_2026_196 not touched                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **I-6**                                                         | —                                                                                             | N/A — no `project.json` edit this batch. **Unit 8 still needs `npx nx reset`, and so does Unit 9** (see Batch 5)                                                                                                                                                                                                                                                                                                                                                                      |
| Tests                                                           | `nx run-many -t test -p core,chat,ptah-extension-webview --skip-nx-cache`                     | ✅ core **23 suites / 471**; chat **50 suites / 658 passed + 2 skipped**; webview **4 suites / 20** — the webview count includes the new `unit5-message-routing.spec.ts`. Re-run again after the formatter reconciliation below: still 4/20                                                                                                                                                                                                                                           |
| Typecheck                                                       | `run-many -t typecheck` over webview, core, chat, tasks-ui, harness-builder, setup-wizard     | ✅ **6/6**                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Lint                                                            | `run-many -t lint` over the same six plus `ptah-electron-e2e`, `--skip-nx-cache`              | ✅ **7/7, 0 errors** (pre-existing warnings only)                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**R4 — independently confirmed, and confirmed for the right condition.** `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts` (Jest, 6 tests) wires the **real** `MessageRouterService` to the **real** services through the **same `useExisting` `MESSAGE_HANDLERS` registrations `app.config.ts` uses**, imports each through the **same specifier production now takes**, and dispatches genuine `window` `MessageEvent`s with hard-coded literal wire strings — never instantiating `TasksViewComponent`, `HarnessBuilderViewComponent`, `SetupHubComponent` or `WizardViewComponent`. Two structural properties make it a gate rather than a restatement of the provider list: a barrel that stops exporting one of them **fails to compile**, and a dropped registration **throws at `TestBed.inject`** because `MessageRouterService` builds its handler map from `handledMessageTypes` in its constructor.

| Service                         | Imported from                                    | Push                                 | Observable effect asserted                                                                                                                                |
| ------------------------------- | ------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TasksStore`                    | `@ptah-extension/tasks-ui/services`              | `tasks:changed` (no `workspaceRoot`) | a **`tasks:board`** RPC is issued on the stubbed `ClaudeRpcService` — filtered by method, because other root services fire unrelated RPCs at construction |
| `HarnessWorkflowMessageHandler` | `@ptah-extension/harness-builder/services`       | `harness:open-workflow`              | `appState.harnessWorkflowRequest()` `null` → `{mode:'new-project', seedPrompt:'delivered'}`                                                               |
| `SetupWizardStateService`       | `@ptah-extension/setup-wizard` (wide, by design) | `setup-wizard:scan-progress`         | `wizard.scanProgress()` `null` → `{filesScanned:7, totalFiles:42, detections:['angular']}`                                                                |

The tester's e2e half (`specs/tasks/message-handlers-eager.spec.ts`, 2 tests) closes it against the real renderer. Both cases are **structurally simpler to prove than Batch 3's** and neither needs the mount-race workaround: `tasks:changed` fires an RPC directly from inside `handleMessage`, and `harness:open-workflow` makes the app **navigate itself** to a view no line of the test asks for. Both non-vacuous by construction — without the push, the RPC wait times out and `ptah-harness-builder-view` stays absent (asserted explicitly as the negative half).

**The single most valuable regression check in this batch was the one that did nothing.** All **6 pre-existing `setup-wizard` specs pass unmodified**. `provideWizardInternalState()` is spread directly into the providers array at `app.config.ts:178`; had that resolution broken, `app.config.ts`'s provider list would fail to construct and **the whole app would fail to bootstrap**, not merely render the wizard wrong. A clean run of those 6 is direct evidence that bootstrap itself survived the batch — a much broader property than "the wizard still looks right".

**Startup TTI — not required, and measured anyway.** §1f correctly argued no TTI hypothesis existed (nothing deferred is startup-reachable: all three are rejected by the host generator, fall back to `'chat'` in the webview, are not persisted, are not forced by Electron, and are reached only by click or by a push that presupposes a running webview). The tester ran it regardless: **218 ms median wall-clock vs the 215 ms clean post-revert baseline (§8), and paint 240 vs 258 ms**. That is a tighter match to the clean baseline than Batch 3's own numbers were, and it is stronger confirmation than the "didn't run it" call would have been on its own.

#### Unplanned change — an Nx module-boundary exception, REVIEWED AND ENDORSED

`eslint.config.mjs` gains `checkDynamicDependenciesExceptions` listing **only** the two `/services` subpath specifiers. Batch 4 is the first time a single library is **both** dynamically and statically imported from the _same_ project — which is precisely what I-3 mandates. Nx's `@nx/enforce-module-boundaries` is project-granular and cannot see that `/services` is a separate entry point, so it raised four `Static imports of lazy-loaded libraries are forbidden` errors. Batch 2 never collided (marketplace/tribunal had no service import); Batch 3 never collided (its dynamic edge was a template `@defer` in a _different_ project).

Endorsed for three reasons. **(1) It is factually correct** — the exemption asserts "these subpaths do not defeat the split", and that is _measured_ at 126,834 B and 40,694 B, not assumed. **(2) The bare specifiers stay banned**, and the developer proved the guard still bites by repointing to the wide barrel, watching lint error, and reverting. That delivers for these two libs exactly the guard Batch 3's closing note wanted, and it respects R8 (subpath stays legal). **(3) It is load-bearing, verified by team-leader**: reverting `eslint.config.mjs` to `HEAD` and re-running `nx lint ptah-extension-webview` reproduces **4 errors** at `app.config.ts:69,:70` and `unit5-message-routing.spec.ts:53,:54`.

**⚠️ This file was MISSING from the commit plan handed to team-leader** and was added on that evidence. Had it been committed separately or omitted, `b24ccf52a` would have been a lint-broken commit. **Rule for Batch 5, and it is a general one: an invariant-driven change is not "the application files" plus some config — the config that makes the application files legal is part of the same atomic change.** If Batch 5 defers a new lib that also has an eager service, expect the same collision and extend `checkDynamicDependenciesExceptions` with that lib's `/services` specifier **only**.

**Recommended follow-up, out of scope here** (recorded for the backlog, not attempted): split the eager services into their own Nx libs — the shape the repo already uses for `memory-contracts`, `voice-contracts`, `auth-providers-tokens` — which removes the static/dynamic tension entirely and makes the eslint exemption unnecessary.

**⚠️ Commit hygiene.** Both commits used explicit pathspecs (`git commit -F <msg> -- <paths>`), never `git add -A`. Untracked files were introduced with `git add -N` (intent-to-add) so the pathspec could match them while leaving the shared index otherwise untouched. `git show --numstat` verified after each: commit 1 = exactly 9 files, commit 2 = exactly 4. **Nothing from `libs/api/**`, `libs/backend/**`, `apps/ptah-cli/**`, `CLAUDE.md`or`marketing/**` came along** — all four remain dirty in the working tree and belong to the concurrent session. That session also landed `a13b12cac` (commitlint scopes) between Batch 3 and this batch; HEAD moving mid-verification is expected here and was not a problem.

**The `MM` formatter artefact appeared twice, exactly as Batch 3 predicted — but in the opposite direction, which is worth recording.** Batch 3 saw the hook format the file _in the index_ while the pathspec commit took the _worktree_ (unformatted) content. Here the hook formatted **both** the worktree and the commit, leaving only a **stale unformatted index entry**. Net effect for a reader: the committed content is the prettier-correct version in both files (`unit5-message-routing.spec.ts`, `harness-builder.spec.ts`), and the differences are pure line-wrapping. Reconciled the same way Batch 3 did, `git checkout HEAD -- <path>`, which here only rewrites the index because the worktree already matched. **Webview tests re-run after reconciliation: still 4 suites / 20 tests. `nx lint ptah-electron-e2e`: 0 errors.** Working tree left clean of all Batch 4 paths.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: The hardest batch — it combines both mechanisms (lazy token **and** narrow barrel) on the three libs with the widest barrels, and it is the batch that clears the target with margin. It runs last among the reduction batches so that both mechanisms are already proven by Batches 2 and 3 before being combined.
**🚨 R15 — THIS BATCH CONTAINS A LAUNCH SURFACE. READ BEFORE STARTING.** Batch 2 deferred the canvas, measured a +100 ms Electron startup-TTI regression, and reverted it. **`setup-wizard` is the first-run launch surface**: the auth-redirect effect at `app-shell.component.ts:308-340` navigates there at startup when no auth is configured, so for a first-run user the wizard is what opens — exactly the shape that made deferring the canvas a loss. Deferring `WIZARD_VIEW_COMPONENT` is therefore **not** the free win the byte table makes it look like. Run `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` **before and after**, on a first-run (unconfigured-auth) profile, and compare medians in the same session. **The initial-bundle budget passes either way, so it is not a gate for this.** If the wizard has to stay eager, say so with the numbers and re-plan the remaining gap around it — Batch 5's Unit 6 reserve exists for exactly this.

**🔎 R15 — SHARPENED BY BATCH 3. The check is wider than "is this view navigable at startup".** Batch 3 found that `dashboard` is a launch surface, and the disqualifying evidence **was not visible from anywhere inside the webview** — `ptah.openDashboard` is an `activationEvent` in the **extension-host manifest** (`apps/ptah-extension-vscode/package.json:42`), with a contributed command (`:115`) and a menu entry (`:153`), which creates a **new panel** with `initialView: 'analytics'` already set. Reading `app.ts`, `app-state.service.ts` and `app-shell.component.*` alone would have cleared the dashboard for deferral, and the regression would then have been invisible to every gate in this task.

The real question is: **is there an activation event, command, deep link, or restored-state path that opens directly onto this surface?** For each of `setup-wizard`, `harness-builder`, `setup-hub` and `tasks-ui`, check **all** of:

1. `apps/ptah-extension-vscode/package.json` → **`activationEvents`** and **`contributes.commands`** (and `contributes.menus`) — the host-side entry points. This is the one Batch 3 nearly missed
2. Every `createPanel({ initialView: … })` call site in `apps/ptah-extension-vscode/src/` — what views are actually requested
3. Both `initialView` allow-lists, which are **not identical**: `apps/ptah-extension-webview/src/app/app.ts:100-109` and `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:106-113`. **`'setup-wizard'` is in BOTH.** `'tasks'` and `'harness-builder'` are in neither. Check the one that matters for the path you care about
4. Any **`onUri` / deep-link** handling that can carry a view into a fresh window
5. Restored state — `localStorage` / `window.ptahPreviousState` / `ElectronShellComponent`'s constructor. (Batch 3 established `currentView` is **not** persisted today; re-confirm rather than assume, since Batch 4 is a later tree)
6. **Plus the already-known one**: the first-run auth-redirect effect at `app-shell.component.ts:308-340`, which makes `setup-wizard`/`settings` a launch surface for an unconfigured user

**If a surface fails any of the six, do not defer it** — leave it eager, record the finding with its source anchors the way Batch 3's R15 outcome does, and re-plan the gap around it. Batch 3 left 35.7 kB on the table this way, deliberately, and it was the right call.
**Unit**: Unit 5 (plan §10)
**Tasks**: 5 | **Dependencies**: Batch 3 (`9fd167b4f`, `4508df433`)
**Starting number**: **2,702,149 B / 552.76 kB initial.** Gap to 2,500,000 B: **202,149 B**. Track **initial-total transfer**, not `main.js` — **except** that Batch 4's three targets _are_ still in `main.js`, so a `main.js` delta will be meaningful here; record both. **Re-measure your own baseline** — a concurrent session is still committing to this repo.
**Expected delta**: **~298 kB — ESTIMATED** (tasks-ui 134.4 + setup-wizard 108.9 + harness-builder 55.0), which clears the 202,149 B gap with ~96 kB of margin. Cumulative target ≈ **2.40–2.50 MB** — **at or under the 2.50 MB warning threshold**. Note the margin is thinner than the original ≈2.22–2.32 MB projection, because Batch 3 shipped −294.68 kB rather than the estimated −365 kB (R15 + I-3, both accounted for in the Batch 3 header). Apply the Batch 3 §2 lesson **before** trusting these three estimates: grep for every external importer of each wide barrel, not just the `app.config.ts` one.
**ACTUAL delta**: **−165,433 B (−165.43 kB)** → **2,536,716 B / 523.59 kB**. **Did NOT reach the ~2.40–2.50 MB band and did NOT clear the target — 36,716 B short.** The whole of the ~133 kB gap between estimate and actual is accounted for: `setup-wizard` never available (−109.0 kB, R15), eager `TasksStore` residue (−16.8 kB, I-3), eager harness service residue (−15.8 kB, I-3), shared deps following the components out (+8.6 kB, net favourable). The Batch 3 §2 wide-barrel grep **was** applied and came back clean — zero external wide-barrel importers for either lib, which is why this batch had no Batch-3-style third-edge surprise.

### Task 4.1: Change the four remaining token generics ✅ COMPLETE — **3 of 4 changed, `WIZARD_VIEW_COMPONENT` deliberately not**

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts`
`WIZARD_VIEW_COMPONENT` (line 26), `HARNESS_BUILDER_COMPONENT` (43), `SETUP_HUB_COMPONENT` (51), `TASKS_VIEW_COMPONENT` (72) → `InjectionToken<LazyViewLoader>`.

After this task **all seven** tokens are `LazyViewLoader`. Update the file's doc comment block (lines 3-25), which currently documents the old `useValue: Component` usage.

**Outcome, not a failure.** `HARNESS_BUILDER_COMPONENT`, `SETUP_HUB_COMPONENT` and `TASKS_VIEW_COMPONENT` are now `InjectionToken<LazyViewLoader>`. **`WIZARD_VIEW_COMPONENT` keeps `InjectionToken<Type<unknown>>`** on the R15 finding in the batch header, and carries a doc comment naming the activation event, the panel factory and the hardcoded `initialView` so it is not converted later.

**The premise "after this task all seven tokens are `LazyViewLoader`" is therefore FALSE and must not be restored.** The settled end state is **five deferred** (`MARKETPLACE`, `TRIBUNAL`, `HARNESS_BUILDER`, `SETUP_HUB`, `TASKS_VIEW`) and **two deliberately eager on measured/structural R15 grounds** (`ORCHESTRA_CANVAS`, `WIZARD_VIEW`). Both eager tokens carry doc comments explaining why. **Do not "finish the job" by deferring them.** The shared doc-comment block documents both binding forms side by side, which is correct now that both are live.

---

### Task 4.2: Rewrite the four providers in `app.config.ts` ✅ COMPLETE — **3 of 4 rewritten**

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts`

- **Delete** the component names from the static imports at lines **38-42** (`WizardViewComponent`), **52-56** (`HarnessBuilderViewComponent`, `SetupHubComponent`), **59** (`TasksViewComponent`) — keeping the service names, which move to the narrow barrels in Task 4.3
- **Rewrite** the providers at lines **116**, **119-122**, **125**

```ts
{ provide: WIZARD_VIEW_COMPONENT,
  useValue: () => import('@ptah-extension/setup-wizard').then((m) => m.WizardViewComponent) },
{ provide: HARNESS_BUILDER_COMPONENT,
  useValue: () => import('@ptah-extension/harness-builder').then((m) => m.HarnessBuilderViewComponent) },
{ provide: SETUP_HUB_COMPONENT,
  useValue: () => import('@ptah-extension/harness-builder').then((m) => m.SetupHubComponent) },
{ provide: TASKS_VIEW_COMPONENT,
  useValue: () => import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent) },
```

**Validation notes — I-1 / R2**: `useValue` with an arrow function, **never `useFactory`**.
**Edge case**: `HARNESS_BUILDER_COMPONENT` and `SETUP_HUB_COMPONENT` both resolve out of `harness-builder` — **one** lazy chunk serves both. Do not expect two, and do not restructure to force two.

**Shipped**: the harness-builder, setup-hub and tasks providers became `useValue` arrows exactly as written above (`app.config.ts:143-156`, `:171-175`), all three verified `useValue` and not `useFactory` by team-leader. **The `WIZARD_VIEW_COMPONENT` snippet above was NOT applied** — it stays `useValue: WizardViewComponent` with its static import retained, and both sites carry the R15 reason. The shared-chunk edge case held: the built output confirms `ptah-harness-builder-view` and `ptah-setup-hub` in the **same** lazy chunk, and nothing was restructured to force two.

---

### Task 4.3: Narrow `/services` barrels for the three entangled libs ✅ COMPLETE — **2 created, the third correctly refused**

**CREATE**:

- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\services.ts` → `TasksStore`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\services.ts` → `SetupWizardStateService`, **`provideWizardInternalState`**
- `D:\projects\ptah-extension\libs\frontend\harness-builder\src\services.ts` → `HarnessWorkflowMessageHandler`

**MODIFY**:

- `D:\projects\ptah-extension\tsconfig.base.json` — three new `/services` paths
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts` — repoint lines **38-42**, **52-56**, **59**

**Do not miss `provideWizardInternalState`** — it is called at `app.config.ts:128` (`...provideWizardInternalState()`) and must resolve from the narrow barrel, exactly as `provideEditorInternalState` already does from `@ptah-extension/editor/services`.

**MEASURE-THEN-DECIDE (R6)**: same rule as Batch 3 — measure **per lib**, and if a narrow barrel yields no delta, delete it and its tsconfig path rather than carrying dead scaffolding. `tasks-ui` has the widest barrel (14 components + 3 services) and is the most likely to show a real delta; the other two are less certain.

**Shipped**: `libs/frontend/tasks-ui/src/services.ts` (`TasksStore` + its types) and `libs/frontend/harness-builder/src/services.ts` (`HarnessWorkflowMessageHandler`, `HarnessBuilderStateService`, `HarnessRpcService`, `HarnessWorkflowService`), with two new `tsconfig.base.json` paths and both `app.config.ts` imports repointed. R6 probe numbers — **126,834 B** and **40,694 B** — are in the batch header; both KEEP. This prediction was right: `tasks-ui` did show the largest delta.

**`libs/frontend/setup-wizard/src/services.ts` was correctly NOT created**, and this instruction is superseded rather than skipped. R15 keeps `WizardViewComponent` eagerly imported, which keeps the wide barrel in the eager graph whatever specifier the two services use — the barrel is a **structural** no-op, the same case Batch 3 measured and dropped for `dashboard`. **`provideWizardInternalState` therefore still resolves from the WIDE barrel** and is still spread at `app.config.ts:178`. The "do not miss `provideWizardInternalState`" warning above remains live in a different form: it is the symbol whose resolution the 6 unmodified `setup-wizard` specs prove, because a break there fails **bootstrap**, not just the wizard.

---

### Task 4.4: Rewire the four `AppShellComponent` fields and their template sites ✅ COMPLETE — **3 of 4 rewired**

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` — 4 fields (`wizardComponent` ~156, `harnessBuilderComponent` ~170, `setupHubComponent` ~176, `tasksComponent` ~201)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` — lines **22-28** (setup-wizard), **49-55** (harness-builder), **62-68** (setup-hub), **108-114** (tasks)

Triggers: `currentView() === 'setup-wizard' | 'harness-builder' | 'setup-hub' | 'tasks'`.

All four sites already have the correct `@else` spinner — no new UI, only the added signal call parentheses in the `@if`.

**Validation notes — R11**: `lazyViews` is already declared (Batch 2) and must remain **before** all seven fields.
**Validation notes — I-3 / R4**: `TasksStore` is registered as a `MESSAGE_HANDLERS` entry at `app.config.ts:126` (`{ provide: MESSAGE_HANDLERS, useExisting: TasksStore, multi: true }`). That registration **must survive** the barrel swap. Same for `SetupWizardStateService` and `HarnessWorkflowMessageHandler`.

**Shipped**: `harnessBuilderComponent`, `setupHubComponent` and `tasksComponent` are `this.lazyViews.resolveWhen(TOKEN, () => this.currentView() === '…')`, with their three template sites taking `@if (x(); as cmp)` and the added signal call parentheses. **`wizardComponent` stays `inject(WIZARD_VIEW_COMPONENT, { optional: true }) ?? null`** with its template site unchanged (R15). All three deferred sites already had the correct `@else` spinner — no new UI was added, as predicted. **R11 verified by team-leader**: `lazyViews` at `:159`, above all five consumers at `:188, :201, :211, :221, :231`. **R4 verified**: all three registrations survive, asserted by dispatch-and-observe at both the Jest and e2e levels — see the batch header.

---

### Task 4.5: Verification + the `MESSAGE_HANDLERS` assertion (R4 — blocking) ✅ COMPLETE

**No file changes.** Full evidence in the batch header; e2e half in `e2e-validation-report.md` §10.

- [x] Build green — **but NOT in the ~2.22–2.32 MB band.** Initial total **2,536,716 B / 523.59 kB**, **36,716 B ABOVE the 2.50 MB target**. The band assumed a `setup-wizard` deferral that the launch-surface check rejected. Reproduced independently by team-leader with identical chunk names and byte sizes
- [x] Full chunk table + `main.js` (**fell** 381,133 → 186,827 B, I-4 satisfied) + `modulepreload` diff recorded — four new entries, **stated plainly rather than glossed**; all four are initial chunks already inside the total, and **none of the 9 lazy chunks is preloaded** (R7 holds). Total preloaded bytes fell −810,995 B
- [x] Per-lib attribution deltas + R6 keep/drop for **two** barrels (both KEEP, 126,834 B and 40,694 B) and the third **not built**, with the structural reason. Attribution independently re-derived by team-leader from the **built output**, not the source — the Batch 3 `ThothStatusService` failure mode was specifically looked for and is absent
- [x] Manual replaced by automated: tasks board loads **and the Kanban populates from real data** — `specs/tasks/tasks-board.spec.ts` asserts `task-column-count` reads 1, not merely that the shell rendered
- [x] Setup wizard runs end-to-end — **6 pre-existing specs pass unmodified**. This is the batch's strongest single check: a broken `provideWizardInternalState` resolution would fail **app bootstrap**, not just the wizard
- [x] Harness builder **and** setup hub both open — `specs/harness/harness-builder.spec.ts` opens each in a **separate** test, which is the point: one shared chunk means a dropped barrel symbol could leave one working and the other silently broken
- [ ] **Manual: no deferred chunk fetched on the chat launch path (DevTools Network)** — **still open, non-blocking, carried into Task 5.3.** Static analysis is unambiguous (not preloaded, trigger-gated `resolveWhen`, both verified independently) but R7/R15 exist because inference is what fails silently here. Same standing item as Batches 2 and 3
- [ ] **Manual: visual check of the `@else` spinner** on the three deferred views — still open, same sub-100 ms local-disk throttling limitation every prior batch recorded
- [x] **R4 assertion** — closed at two levels by dispatch-and-observe, never by provider-list inspection. Per-service methods in the batch header

**The initial total IS still above 2.50 MB — by 36,716 B.** Under the original plan that activated Unit 6 (the settings `@defer` reserve). **That is no longer what happens**: Unit 6 has been **removed** and Batch 5 re-planned around **Unit 9**, the daisyUI theme split. See the Batch 5 section for the reasoning.

**Risk**: Med — `tasks-ui` has the widest barrel and `TasksStore` is a `MESSAGE_HANDLERS` entry. **Realised risk: none.** The barrel swap held, R4 passed at both levels, and the one apparent attribution anomaly (`ptah-task-card` in an initial chunk) was a selector collision with chat's execution-tree card, not a leak.
**Rollback**: per-token, independently.

---

## Batch 5: Split the daisyUI themes out of `styles.css` + component CSS + restore the error budget ⏸️ PENDING

> ### 🔁 THIS BATCH WAS RE-PLANNED AFTER BATCH 4. Read this box before anything else.
>
> **It was**: Unit 6 (`@defer` the settings view, conditional) + Unit 7 + Unit 8.
> **It is now**: **Unit 9 (NEW — split the 32 prebuilt daisyUI themes out of `styles.css`)** + Unit 7 + Unit 8.
>
> **Unit 6 is REMOVED, not deferred and not "skipped".** It was the plan's reserve
> lever, and Batch 4 (§1e) confirmed the precise fact that disqualifies it:
> the auth-redirect effect at `app-shell.component.ts:355-357` navigates to
> `'settings'` — **and only `'settings'`** — at startup when no auth is
> configured. **For a first-run user, settings IS the launch surface.** The
> original plan accepted this and proposed `@defer (on immediate)` to buy the
> bytes for one module hop on first-run. **The user decided against it.** That is
> the right call and it is consistent with everything this task has measured:
> R15 has now caught a launch surface in **every** batch that applied it, and the
> one time a launch surface was actually deferred (canvas, Batch 2) it cost
> 70–100 ms and had to be reverted. Deliberately deferring the **first-run**
> launch surface — the one path where the user has the least patience and the
> least context — to buy 36,716 B is the same trade with worse odds.
>
> **The theme split was chosen instead because CSS deferral carries no
> launch-surface risk at all.** No view is deferred, no component moves, no
> `MESSAGE_HANDLERS` service is touched, and the mechanism is orthogonal to
> every risk row in this file. It also attacks the one large initial-bundle item
> the task has never touched: `styles.css` at **276,070 B**, which final
> deliverable item 7 already lists as an unaddressed follow-up.

**Status**: PENDING
**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: The closing batch. Unit 9 is now the **only** lever that closes the 36,716 B gap, so it is no longer optional or conditional — the task cannot finish without it. Unit 7 stays a cheap opportunistic fix in the same build output. Unit 8 **must be last, always** — it is the change that declares the task finished.
**Units**: **Unit 9 (NEW)** + Unit 7 + Unit 8. **Unit 6 REMOVED** — see the box above
**Tasks**: 4 | **Dependencies**: Batch 4 (`b24ccf52a`, `5fd739b03`)
**Starting number**: **2,536,716 B / 523.59 kB initial.** **Gap to 2,500,000 B: 36,716 B.** Re-measure your own baseline — the concurrent session is still committing (it landed `a13b12cac` during Batch 4), though it has not touched the webview graph.
**`modulepreload` baseline**: a **10-entry** list, by raw size — 636,224 / 223,137 / 109,959 / 89,863 / 39,700 / 17,463 / 16,400 / 15,737 / 162 / 0.
**Expected delta**: Unit 9 — **UNMEASURED, and say so.** `styles.css` is 276,070 B raw and 32 of its 34 themes are candidates to move, so the available headroom _looks_ far larger than 36,716 B. **Do not convert that into a number until you have built it.** daisyUI themes are CSS custom-property blocks and compress extremely well (`styles.css` is 276.07 kB raw but only 34.60 kB transfer), and **the budget counts RAW bytes**, which is what makes this lever work at all — but the raw-per-theme figure has never been measured on this repo. Units 7 and 8 move ~0 bytes of initial bundle.

**⚠️ TWO tasks in this batch now touch `project.json`, not one.** Unit 9 needs a second entry in the `styles` array (`apps/ptah-extension-webview/project.json:33-36`) to emit the deferred sheet as its own bundle. **I-6/R13 therefore applies to Unit 9 as well as Unit 8**: `--skip-nx-cache` does not refresh the Nx project graph, so `npx nx reset` is mandatory before trusting any build that follows a `project.json` edit. Budget for R12a's Windows sequence **twice**.

### ~~Task 5.1: RESERVE — `@defer` the settings view~~ ❌ REMOVED (Unit 6 cut from the plan)

**Do not implement this. Do not "restore" it later as an obvious win.**

Unit 6 was the plan's reserve lever and Batch 4 activated the condition for it — the initial total is 36,716 B over. It was **removed anyway, by user decision**, and the reasoning is worth keeping because it is the same reasoning R15 encodes.

`app-shell.component.ts:328-360` runs an auth-redirect effect at startup: it returns early unless `currentView() === 'chat'`, latches on `authCheckDone` so it fires once, calls `auth:getAuthStatus`, re-checks the view after the await, and on `!hasAnyAuth` calls **`setCurrentView('settings')`** (`:355-357`). Batch 4 §1e confirmed this is the **only** view that effect touches — the "`setup-wizard`/`settings`" phrasing used elsewhere in this file was imprecise.

So **settings is the first-run launch surface**, and Unit 6 was the one place in this task where the plan proposed deferring a launch surface _on purpose_, accepting one module hop in exchange for ~150 kB. Against the evidence this task has accumulated that trade is not worth taking: **R15 has disqualified a candidate in every batch that applied it** (canvas, dashboard, setup-wizard), and the single time a launch surface was actually shipped deferred it cost 70–100 ms and was reverted. A first-run user — no cached chunks, no warm profile, least context — is the worst population to spend a module hop on.

**Replaced by Unit 9 below**, which buys the same bytes with no launch-surface exposure at all.

---

### Task 5.1: ★ NEW (Unit 9) — split the 32 prebuilt daisyUI themes out of `styles.css` ⏸️ PENDING

**This is the task that closes the gap. It is not optional and it is not conditional.**

#### What is there now — verified against the working tree, not taken from the plan

| Fact                                                                                     | Anchor                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.css` is **276,070 B raw / 34.60 kB transfer** and is an **initial** bundle entry | Batch 4 build table; unchanged since the task baseline                                                                                                                            |
| **32 prebuilt daisyUI themes** are compiled in                                           | `apps/ptah-extension-webview/tailwind.config.js:158-189` — `light` … `sunset`, verified as exactly 32 entries                                                                     |
| **2 custom themes** are defined as objects immediately above them                        | `anubis`, `anubis-light`; `darkTheme: 'anubis'` at `tailwind.config.js:191`                                                                                                       |
| All **34** are a **shipped, user-facing feature** — a theme picker                       | `DAISYUI_THEMES` at `libs/frontend/core/src/lib/services/theme.service.ts:67`                                                                                                     |
| Default is `anubis`; `anubis-light` is chosen when the host reports a light theme        | `theme.service.ts:127`, `:171-174`                                                                                                                                                |
| Theme is applied by setting `data-theme` on `<html>` in an `effect()`                    | `theme.service.ts:143-153`                                                                                                                                                        |
| The persisted theme is read **synchronously at service construction**                    | `theme.service.ts:164-175` → `vscode.getState('theme')`                                                                                                                           |
| `getState` is synchronous in **both** hosts                                              | `vscode.service.ts:214` reads `window.vscode.getState()`; Electron's preload backs that with **`ipcRenderer.sendSync('get-state')`** (`apps/ptah-electron/src/preload.ts:8, :27`) |
| The build emits stylesheets from a `styles` array                                        | `apps/ptah-extension-webview/project.json:33-36`                                                                                                                                  |

**Keep `anubis` + `anubis-light` in `styles.css`. Move the other 32 into a separate stylesheet loaded on demand.**

#### 🚨 HARD REQUIREMENT — no flash of `anubis` for a user on a non-default theme

**A user whose persisted theme is, say, `dracula` must NOT see a frame of `anubis` before their theme applies.** The deferred sheet must be loaded **before first paint for those users only**. A user on `anubis` or `anubis-light` must **never** fetch it.

**Getting this wrong is the same class of error as deferring the launch surface**: a visible regression traded for bytes, invisible to the budget check, invisible to every automated gate in this task. Treat it with the same seriousness — the initial-bundle budget will pass whether or not the flash exists.

**The enabler, and why this is achievable rather than a hope**: the persisted theme is readable **synchronously**, before Angular bootstraps, in both hosts (see the table). So the decision "do I need the extra sheet?" can be made and acted on early enough to block first paint for exactly the users who need it. **Verify that synchronicity yourself before designing around it** — it is the single load-bearing fact in this task, and `getState` returns `undefined` when `window.vscode` is absent (`vscode.service.ts:214-217`), which is a path you must handle rather than assume away.

**Three properties to satisfy, and state in the report how each was met:**

1. **Non-default-theme user**: correct theme on the first painted frame. No `anubis` flash.
2. **Default-theme user** (`anubis` / `anubis-light`, which is the overwhelming majority): the extra sheet is **never requested**. Prove it from the network panel or an equivalent observation, not by reading the code.
3. **All 34 themes still work from the picker** at runtime. This is a **deferral, not a deletion** — a user switching to `nord` from the picker must get `nord`, including on a profile that has never loaded the sheet before.

#### Do not do these

- **Do not delete themes.** All 34 are exposed by `DAISYUI_THEMES` and are a shipped feature.
- **Do not "solve" it by trimming `DAISYUI_THEMES` to the two custom themes.** That is a deletion wearing a deferral's clothes, and it is a product change nobody asked for.
- **Do not raise any budget.** I-9 and `apps/ptah-extension-webview/CLAUDE.md:48` both stand.
- **Do not touch `libs/shared`/`zod`** (plan §7, I-8) to make up a shortfall.

#### Measurement

Same discipline as every other batch: full initial + lazy tables, initial total raw **and** transfer, the `modulepreload` diff against the 10-entry baseline above, and **actual vs expected labelled UNMEASURED→measured**. **`npx nx reset` before trusting the post-`project.json` build (I-6/R13).**

**If Unit 9 lands the initial total under 2,500,000 B, say so with the number and proceed to Unit 8.** **If it does not, STOP and report the remaining gap — do not improvise a fourth lever and do not defer a launch surface to close it.** Every remaining candidate of any size is either a launch surface or explicitly out of scope (`zod` 304 kB, plan §7; the two shells, plan §5). That is a decision for the user, not for the batch.

---

### Task 5.2: `message-bubble.component.css` — 10.98 kB vs the 10 kB warning ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.css`

977 bytes over the `anyComponentStyle` warning. Split the clearly separable block (e.g. the code-block / syntax-highlighting rules) into a sibling stylesheet added to the component's `styleUrls`, **or** move genuinely global rules to `apps/ptah-extension-webview/src/styles.css`.

**Low priority. If it is not trivially separable in 15 minutes, DROP IT** and mark the task `⏭️ SKIPPED (not trivially separable)`. Do not let it expand scope.

**Do NOT raise the `anyComponentStyle` budget.** Component styles stay at 10 kb warn / 20 kb error (`apps/ptah-extension-webview/CLAUDE.md:48`).

Note: if this task is skipped, the final build in Task 5.4 will still emit the component-style warning. That is acceptable and does **not** block Unit 8 — the "zero budget warnings" requirement in I-9 refers to the **initial-bundle** budget. State clearly in the report which warnings remain and why.

**Unchanged by the re-plan, and still the lowest priority in the batch.** Confirmed still warning on the Batch 4 build: _"message-bubble.component.css exceeded maximum budget. Budget 10.00 kB was not met by 977 bytes with a total of 10.98 kB."_ **It contributes nothing to the 36,716 B gap** — a component stylesheet is bundled either way; splitting it only silences a separate budget line. **Unit 9 comes first and Unit 8 comes last; if Unit 9 turns out to be more work than expected, drop this one without hesitation.** Dropping it does not block I-9.

---

### Task 5.3: Full regression gate ⏸️ PENDING

**No file changes.** Run before Task 5.4 so that the final build is the last thing that happens.

```bash
npx nx run-many -t typecheck -p ptah-extension-webview,core,chat,tasks-ui,setup-wizard,harness-builder,canvas,marketplace,tribunal-panel,dashboard,thoth-shell
npx nx run-many -t lint -p ptah-extension-webview,core,chat
npx nx run-many -t test -p core,chat,tasks-ui
npx nx build ptah-extension-vscode      # the webview artifact is copied in — it must still copy
npx nx build ptah-electron
```

Manual, **both hosts** (VS Code webview and `npm run electron:serve`):

- [ ] chat opens and accepts input — DevTools Performance TTI compared against the TTI baseline recording. **⚠️ CORRECTION: no pre-Unit-1 recording exists.** Task 1.4's manual gate closed without it. This does not invalidate the gate: `main.js` came out of Batch 1 byte-identical to baseline (1,904,251 B, +0.16 kB transfer), so Batch 1 provably did not move chat TTI, and any recording taken from the post-Batch-1 tree onward is an equally valid reference. **Whoever runs the next batch must capture the recording then** and name which tree it was taken on. Any regression above noise against _that_ reference **blocks**.
- [ ] **Monaco diff view shows add/remove highlighting** — seen, not inferred (I-5 / R1)
- [ ] terminal opens and is interactive
- [ ] every deferred surface opens: canvas grid, marketplace, tribunal, Thoth (4 sub-tabs), analytics, tasks, setup wizard, harness builder, setup hub
- [ ] no deferred chunk is fetched on the chat path (DevTools Network) — **this closes three batches' worth of carried-over items at once** (Batch 3's Thoth chunk, Batch 4's tasks and harness chunks). Each was left open because static analysis is inference and R7/R15 exist because inference fails silently here
- [ ] **visual check of the `@else` spinner / `@placeholder`** on every deferred surface — carried from Batches 2, 3 and 4. Needs artificial throttling to catch a sub-100 ms local-disk load
- [ ] **NEW, Unit 9 — theme correctness across a profile switch.** Launch on a persisted **non-default** theme (e.g. `dracula`) and confirm **no `anubis` flash on the first painted frame**; launch on `anubis` and confirm the deferred sheet is **never requested**; then switch themes from the picker on a profile that had never loaded it and confirm the new theme applies. These three are the Unit 9 acceptance gate and they cannot be inferred from a green build

---

### Task 5.4: ★ FINAL, MANDATORY — restore `maximumError` to `3.5mb` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\project.json`
**Line anchor**: **line 61** (verified — the `budgets[0]` block spans lines 58-62)

```jsonc
{ "type": "initial", "maximumWarning": "2.5mb", "maximumError": "3.5mb" }
```

Change `"maximumError": "4mb"` → `"3.5mb"`.

**Leaving it at `4mb` means this task did not finish** (I-9, `context.md:88-90`).

**MANDATORY procedure — I-6 / R13**: because this edits `project.json`, `--skip-nx-cache` is **not** sufficient; the Nx project graph will be read stale (F-11, `TASK_2026_177/batch-12-report.md`).

```bash
npx nx reset
npx nx build ptah-extension-webview --configuration=production
```

**~~R12~~ → R12a — READ THIS, THE R12 GUIDANCE ABOVE IS WRONG.** _"Re-run it — it succeeds on the second attempt"_ is **incomplete and must not be relied on.** Observed during the Batch 1 commit: `npx nx reset` failed **twice** with `EPERM … .nx/workspace-data` and did **not** succeed on retry. Separately, the pre-commit hook crashed with `ENOENT: .nx\cache\terminalOutputs\…` because `.nx/cache` did not exist.

**The working sequence, proven in Batch 1 and used again by team-leader in Batch 4:**

1. **stop the Nx daemon**
2. **recreate `.nx/cache/terminalOutputs`** (`mkdir -p .nx/cache/terminalOutputs` — team-leader did this pre-emptively before both Batch 4 commits and neither hook crashed)
3. **re-run the command**

Budget the time; do not escalate a failing `nx reset` as a blocker. **Do NOT work around it by skipping the reset** — F-11 means the budget check would then read a stale project graph and silently pass. **This applies to Unit 9 as well as Unit 8** — both edit `project.json`.

**Final acceptance**:

- [ ] Build **green** with **zero initial-bundle budget warnings** — initial total under **2.50 MB**. **This is the first time in the task that this box can honestly be ticked; Batch 4 finished 36,716 B above it.** If Unit 9 did not close the gap, do NOT tick this and do NOT change `maximumError` — report the shortfall instead
- [ ] No component-style warning **if Task 5.2 landed**; if 5.2 was skipped, the remaining warning is named and explained
- [ ] `maximumError` is `"3.5mb"`
- [ ] Final before/after chunk table recorded: **3.63 MB → final**, with `main.js` transfer against the 353.23 kB baseline and the full `modulepreload` diff

---

## Final deliverable — the report this task is judged on

The batch reports across all five batches must, together, produce:

1. **The before/after chunk table** — 3.63 MB baseline → final, initial **and** lazy chunks, raw **and** transfer (an explicit acceptance criterion in `context.md:96-97`).
2. **The per-unit delta ledger** — expected (MEASURED or ESTIMATED) vs actual, per batch.
3. **The keep/drop record for every narrow barrel**, with the numbers behind each call (R6).
4. **The `main.js` transfer trace** across all five batches against the 353.23 kB baseline (I-4).
5. **The `modulepreload` diff** across all five batches (R7).
6. **Confirmation that Monaco diff highlighting was visually verified** — by a human, after Batch 1 and again in Task 5.3 (I-5 / R1).
7. **Follow-ups recorded, not attempted**: `zod` at 304 kB (plan §7 — the largest remaining structural item, needs `libs/shared` split into type-only and schema entry points, ~149 import sites); deferring the two shells (plan §5 — rejected here, requires a measured TTI comparison before it can be accepted); ~~`styles.css` at 276 kB~~ → **no longer a follow-up: it became Unit 9 and is Batch 5's primary lever.** Report what the theme split actually moved. New follow-up from Batch 4 §7: split the eager `MESSAGE_HANDLERS` services into their own Nx libs (the `memory-contracts` / `voice-contracts` / `auth-providers-tokens` shape), which would remove the static-vs-dynamic import tension and make the `checkDynamicDependenciesExceptions` entries unnecessary.
8. **The R15 ledger** — three surfaces checked and left eager (canvas by measurement, dashboard and setup-wizard by static evidence), plus Unit 6 removed for the same reason, with the bytes each cost. On this codebase the launch-surface check disqualified a candidate in **every** batch that applied it; that rate is itself a finding, and it is the most transferable thing this task produced.

---

## Status legend

| Icon           | Meaning                               | Set by                                  |
| -------------- | ------------------------------------- | --------------------------------------- |
| ⏸️ PENDING     | Not started                           | team-leader (initial)                   |
| 🔄 IN PROGRESS | Assigned to developer                 | team-leader                             |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | frontend-developer                      |
| ✅ COMPLETE    | Verified, reviewed and committed      | team-leader                             |
| ⏭️ SKIPPED     | Conditional task, condition not met   | frontend-developer (with justification) |
| ❌ FAILED      | Verification failed                   | team-leader                             |
