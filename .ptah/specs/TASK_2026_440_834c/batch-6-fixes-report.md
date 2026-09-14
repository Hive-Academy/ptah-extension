# Batch 6 Fixes Report — `TASK_2026_440_834c`

Source review: `code-style-review-batch-6.md` (score 7/10, APPROVED WITH FIXES).
This report covers the four findings. Scope held to the files Batch 6 already touched
under `libs/frontend/memory-curator-ui/src/lib/`.

All paths below are relative to
`D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\`.

---

## Finding 1 (SERIOUS) — `now` input was never wired in production

The review found the panel's `now` input declared but not bound by the accordion, so
the panel stayed fresh only by accident of the 30 s poll giving `storage()` a new
object reference.

### Changes

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:294`
  — input reshaped to `public readonly now = input<number>(0);`, matching
  `EventFeedComponent.now` (`event-feed.component.ts:65`): non-nullable, default `0`.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:299`
  — the `vm` computed reads the clock with `const now = this.now() || Date.now();`
  (was `?? Date.now()` against a nullable input). Relative times in the panel now
  recompute when the accordion's shared clock ticks.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:289-293`
  — doc comment states the contract: the accordion's shared `now` computed binds this
  input, same contract as `EventFeedComponent.now`.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:176`
  — mount line now reads
  `<ptah-storage-health-panel [storage]="storage()" [now]="now()" />`, reusing the
  existing `now` computed at `:234-237` (the same clock already bound into the event
  feed at `:172`). No second timer was added.

### Specs

- `memory-diagnostics-accordion.component.spec.ts:181` — new test
  `binds the shared now clock into the storage panel`. It queries the panel by
  component type, checks the accordion's `now` value is greater than 0 (a real
  `Date.now()` reading), and asserts `panelInstance.now()` equals the accordion's
  `now()` (an unwired input would still hold its `0` default). This test fails if a
  future change removes the `[now]` binding.

### Result

The panel's relative times now depend on the explicit shared-clock contract, the same
as the event feed. The accidental freshness dependency on per-poll object identity is
gone.

---

## Finding 2 (SERIOUS) — `formatCount` used a locale-dependent `toLocaleString()`

The review found `value.toLocaleString()` resolved to the Node process default locale,
while the spec asserts `6,204`. A `de-DE` runner would group with `.` and fail the
assertion.

### Changes

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:46-49`
  — `formatCount` now calls `value.toLocaleString('en-US')`. The doc comment states
  the locale is pinned so the grouped output is identical on every machine and CI
  locale.

### Specs

- `storage-health-panel.component.spec.ts:242` — the existing assertion
  `expect(root.textContent ?? '').toContain('6,204')` now holds on any runner locale.

### Result

The rendered output and the spec assertion no longer depend on the executing
environment's default locale.

---

## Finding 3 (MINOR) — "seven panels" test title did not match its body

The review found the test title changed to "renders the seven panels" but the body
still asserted only the six original panels.

### Changes

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts:135-136`
  — inside `it('renders the seven panels when state is fully loaded', ...)`, two
  assertions were added:
  - `expect(root.textContent ?? '').toContain('Storage and Retention');`
  - `expect(root.querySelector('ptah-storage-health-panel')).not.toBeNull();`

### Result

The title and the body of that test agree. The storage panel is verified inside the
test that names it.

---

## Finding 4 (MINOR) — `formatBytes(NaN)` returned `"NaN undefined"`

The review found a `NaN` input slipped past the `bytes < 1024` guard and indexed
`units[-1]`, producing `"NaN undefined"`. The typed DTO makes this unreachable
through normal call sites, so the fix is a robustness guard.

### Changes

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:28`
  — the guard is now
  `if (bytes === null || !Number.isFinite(bytes)) return NULL_TEXT;`.
  A `NaN` or `Infinity` input renders `—`, the same as `null`.

### Specs

- `storage-health-panel.component.spec.ts:199` — the pure-formatter test gained
  `expect(formatBytes(Number.NaN)).toBe('—');`, pinning the guard.

### Result

Non-finite byte values render the null marker. The `"NaN undefined"` output is gone.

---

## Verification

Command:

```
npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator-ui
```

Header confirmed 1 project:
`Running targets typecheck, test, lint for project @ptah-extension/memory-curator-ui`.

Summary:

- Typecheck: passed.
- Test: `Test Suites: 17 passed, 17 total` / `Tests: 183 passed, 183 total`.
- Lint: `0 errors, 27 warnings` — all 27 warnings are pre-existing in
  `db-health-panel.component.ts` and `vec-embedder-recovery.service.ts`(+spec). None
  are in files this batch touched.
- Final line: `Successfully ran targets typecheck, test, lint for project @ptah-extension/memory-curator-ui`.

Per-file runs (`npx jest -c libs/frontend/memory-curator-ui/jest.config.ts <spec>`):

- `storage-health-panel.component.spec.ts` — `Tests: 10 passed, 10 total`, 0 skipped.
- `memory-diagnostics-accordion.component.spec.ts` — `Tests: 23 passed, 23 total`
  (22 prior tests plus the new clock-binding test), 0 skipped.

Test count moved from 182 to 183: one new accordion test. No test was skipped.