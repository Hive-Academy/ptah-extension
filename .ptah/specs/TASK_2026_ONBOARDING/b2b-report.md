# B2b report — presentational shared components

## Verdict

**Complete for this lane.** `ItemStatusCard`, `ItemStatusGrid`, and `DetailsLog` are presentational
OnPush signal components under `libs/frontend/onboarding/src/lib/shared/`, with specs covering the
seven C-B2 statuses, safe failure copy, hidden attempt line, grid rendering, and DetailsLog lazy
mount/unmount.

`npm run verify` lint and test for `@ptah-extension/onboarding` passed after the DetailsLog stub
fix. Typecheck still fails in **other-lane** file
`libs/frontend/onboarding/src/lib/shared/onboarding-stepper.component.ts` (TS2367). That file was
not edited here.

## Files

Created (this lane only):

- `libs/frontend/onboarding/src/lib/shared/item-status-card.component.ts`
- `libs/frontend/onboarding/src/lib/shared/item-status-card.component.spec.ts`
- `libs/frontend/onboarding/src/lib/shared/item-status-grid.component.ts`
- `libs/frontend/onboarding/src/lib/shared/item-status-grid.component.spec.ts`
- `libs/frontend/onboarding/src/lib/shared/details-log.component.ts`
- `libs/frontend/onboarding/src/lib/shared/details-log.component.spec.ts`

Not edited: onboarding/setup-wizard/harness-builder barrels; stepper, run-status-chip, run-panel,
step-meter, recovery-screen, owner-conflict-banner, resume-banner; routes/pages.

## Spec coverage

| Acceptance | Evidence |
| --- | --- |
| Presentational only (inputs/outputs) | card `:177-184`; grid `:48-50`; details `:85-95` |
| OnPush, standalone | card `:99-102`; grid `:22-26`; details `:32-40` |
| Signals (`input`/`computed`/`signal`) | card `:177-192`; details `:85-97` |
| `@if` / `@for` | card `:137-173`; grid `:35-44`; details `:54-79` |
| Status glyph always paired with text | card `:127-134` (`lucide-angular` `aria-hidden` + `presentation().label`) |
| Seven C-B2 labels as `Record<ResumableGenerationAgent['status'], string>` | card `:24-35`; spec `:51-63` |
| Raw `error` never rendered; `safeFailureCopy` from `@ptah-extension/setup-wizard` | card `:21`, `:37`, `:196-201`; spec `:65-77` |
| Missing `error` shows label only | card `:197-199`; spec `:79-83` |
| "Attempt a of b" hidden without a budget | card `:151-154`, `:192-194`; spec `:85-89` |
| ItemStatusGrid rendering | grid `:29-44`; spec `:34-56` |
| DetailsLog mounts embed only while open and releases on close | details `:62-78`, `:99-101`; spec `:94-110` |
| Analysis transcript also lazy | details `:64-65`; spec `:113-127` |
| `chrome='bare'`, `readOnly`, host `startGuard`/`stopHandler` | details `:72-77`; spec `:104-106` |
| Header uses `BuilderSessionSectionComponent` only via `@ptah-extension/harness-builder` | details `:13`, `:67-71` |
| Reduced-motion disables spinner | card `:130-131` |
| 32px minimum targets | card chip `:122`, retry `:160`; details summary `:50` (`min-h-8`) |
| §13 icons + glass | Lucide names from §13.2 (`bot`, `clock`, `loader`, `circle-check`, `circle-dashed`, `circle-x`, `pause`); `aria-hidden="true"`; `data-glass-surface="tile"` on card `:107`, chip `:123`, log `:45`; tile radius `rounded-[10px]` |
| Stream counts copy (spec §2 / prototype) | details `:54-59` |

## Verification

Command:

```
npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/harness-builder,@ptah-extension/setup-wizard 2>&1 | tail -40
```

First run (exit 1): `@ptah-extension/onboarding:test` failed in `details-log.component.spec.ts`
(`openLog` / `detectChanges`) because the session-section stub omitted bound inputs under
`errorOnUnknownProperties`. `@ptah-extension/onboarding:typecheck` failed in other-lane stepper.

After stub fix, focused Jest:

```
npx jest --config libs/frontend/onboarding/jest.config.ts --coverage=false --maxWorkers=2 --testPathPatterns='item-status-card.component.spec|item-status-grid.component.spec|details-log.component.spec'
```

→ 3 suites, 17 tests passed.

Second verify (exit 1), tail:

```
onboarding-stepper.component.ts:40 error TS2367
onboarding-stepper.component.ts:43 error TS2367
… NG8107 warnings in chat-ui / chat (not this lane)
Warning: command "npx ngc --noEmit --project libs/frontend/onboarding/tsconfig.lib.json" exited with non-zero status code
✔  nx run @ptah-extension/onboarding:test
✔  nx run @ptah-extension/onboarding:lint
NX Running targets lint, test, typecheck for 3 projects failed
Failed tasks:
- @ptah-extension/onboarding:typecheck
[verify 2026-10-30T02:59:29.930Z] lock released after 165.3s, exit code 1
```

`@ptah-extension/harness-builder` and `@ptah-extension/setup-wizard` succeeded (8 successful tasks,
cache 6/8). Typecheck failure is confined to the other lane's stepper.

`ptah_get_diagnostics` timed out twice (45s). Native fallback: `npx ngc --noEmit --project
libs/frontend/onboarding/tsconfig.lib.json` (same stepper TS2367). `ptah_code_search_symbols`
returned an empty index; `ptah_code_reindex` refused this worktree as not an opened folder. Fallback:
Grep.

Browser / Electron visual check was not run (task forbids serve/dev/e2e/package and launching
Electron or browsers). Markup was checked against design-spec §13 and `prototype/index.html`
agent cards / details log, not against a screenshot of the live app.

## Decisions

1. **C-B2 seven-status map over design-spec §3.2 five labels.**
   Options: (a) C-B2 addendum table; (b) design-spec pending/running/written/unchanged/failed.
   Evidence: addendum "the C-B2 table REPLACES the base plan's 5-status map";
   `implementation-plan.addendum-pr832.md:97-111`; outcome-summary labels `:15-21`.
   Reversible: yes (label Record only).

2. **Attempt line requires both `attempt` and `budget`.**
   Options: (a) show when `budget != null`; (b) show only when both are set.
   Evidence: copy is "Attempt a of b"; spec hides the line without a budget.
   Reversible: yes.

3. **Grid is a dumb list; terminal retryable-only filter stays with the page.**
   Options: (a) grid filters `failed`; (b) parent passes the list.
   Evidence: C-B3b says A3 lists retryable failures after terminal; B2 grid is presentational.
   Reversible: yes.

4. **DetailsLog mounts analysis transcript and tab embed only while `<details>` is open.**
   Options: (a) embed only lazy, transcript always; (b) both lazy.
   Evidence: B2 "mounts the embed only while open and releases it on close"; tests require lazy
   mount/unmount. Destroying the `@if` block runs `SessionEmbedComponent.ngOnDestroy`.
   Reversible: yes.

5. **State ink tokens `text-state-run` / `text-state-err`.**
   Options: (a) webview tokens in `tailwind.config.js:32-34`; (b) sibling-lane `text-state-running` /
   `text-state-error`.
   Evidence: `ready-claude-step.page.ts:72-83`; tailwind `state-run` / `state-err`.
   Reversible: yes (class names).

6. **Fixed failure fallback `"The write failed."`**
   Options: (a) reuse outcome-summary fallback; (b) new onboarding sentence.
   Evidence: `outcome-summary.component.ts:12`, C-B2 `safeFailureCopy(error, <fixed fallback>)`.
   Reversible: yes.

## Limitations

- `ui-ux-designer` is an agent role in this repo, not a host-catalogue skill; it was not loaded.
  `angular-frontend-patterns` and `impeccable` (product register) were loaded.
- Components are not exported from `libs/frontend/onboarding/src/index.ts` (out of scope).
- No route wiring; pages in later batches must pass agents, budgets, tab id, guards, and counts.
- Visual quality of glass/icons was not confirmed in Electron.
- Workspace verify remains red until the other lane's stepper typecheck is fixed.

## Skills / tools

Loaded: `angular-frontend-patterns`, `impeccable` (context.mjs + product register).
Optional miss: `ui-ux-designer` skill not in the host catalogue.

## Revision 1

Fixes for `code-logic-review.b2.md` items 6–8 (LOW, part B). Scope stayed
`libs/frontend/onboarding/src/lib/shared/{item-status-card,item-status-grid,details-log}*`.
No git writes. Codex-owned shared files were not touched.

### Edits

6. `item-status-card.component.ts` — spinner uses a static
   `class="size-3.5 motion-reduce:animate-none"` plus `[class.animate-spin]` while
   `running` (same pattern as `run-status-chip`).

7. `detailLine` — running copy is `Tailoring ${n} ${n === 1 ? 'section' : 'sections'}`;
   pending returns `null` so the chip keeps the C-B2 label `Waiting` with no `Queued`
   duplicate. Specs: "keeps the C-B2 Waiting label and omits a Queued detail line";
   "pluralizes the running tailoring line".

8. `details-log.component.ts` — `mountKeys()` plus `@for (key of mountKeys(); track key)`
   remounts analysis / embed / unavailable when `mode` or `tabId` changes while open.
   Tab mode with a null/empty `tabId` keeps the disclosure enabled and shows
   "Session is not available." Specs: unavailable copy, remount on `tabId` change
   (new stub `instanceId`), remount on `mode` change, embed replaced when `tabId`
   becomes null while open.

### Verification

Command:

```
npm run verify -- -p @ptah-extension/onboarding 2>&1 | tail -30
```

First revision run (exit 1): 1 failed / 268 passed — B2b spec
`pluralizes the running tailoring line` called `TestBed.configureTestingModule` twice
in one test. Codex-owned files were not the failure. Spec fixed to reuse the fixture
via `setInput`.

Focused Jest after the fix: 3 suites, 23 tests passed.

Second verify was a 3/3 nx cache hit (60ms). Third verify used `NX_SKIP_NX_CACHE=true`
so the cache did not mask the spec change. Tail:

```
✔  nx run @ptah-extension/onboarding:typecheck
✔  nx run @ptah-extension/onboarding:test
✔  nx run @ptah-extension/onboarding:lint

NX   Successfully ran targets lint, test, typecheck for project @ptah-extension/onboarding

  Run duration:      2m 59s
  Cache:             Skipped (--skip-nx-cache)
[verify 2026-10-30T03:27:59.849Z] lock released after 187.7s, exit code 0
```

Stepper TS2367 from the original report is gone (Codex-owned file; not edited here).

DetailsLog remount specs emit Angular NG0956 (`track` identity recreates a size-1
collection). That is the remount, not a test failure.

Browser/Electron still not run (task forbids serve/dev/e2e/package and browsers).
Item 6 checked against `run-status-chip` static `motion-reduce:animate-none`, not a
live screenshot.

### Decisions

7. Drop pending `Queued`; keep C-B2 `Waiting` only. Zero tailored sections uses the
   plural (`Tailoring 0 sections`).
8. Keep the disclosure enabled when tab mode has no `tabId`; render
   "Session is not available." in the body (implementation-plan DetailsLog stays
   mount-on-open; empty body was the review defect).

Skills: `angular-frontend-patterns` and `impeccable` (SKILL.md) loaded this round.
`ui-ux-designer` is still an agent role, not a host-catalogue skill.
