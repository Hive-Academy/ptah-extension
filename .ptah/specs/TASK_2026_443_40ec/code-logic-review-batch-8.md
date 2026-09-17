# Code Logic Review — `TASK_2026_443_40ec` — Batch 8 (memory-curator-ui)

## Summary

| Metric              | Value   |
| ------------------- | ------- |
| Overall score       | 8/10    |
| Assessment          | APPROVED |
| Blocking issues     | 0       |
| Serious issues      | 0       |
| Moderate issues     | 1       |
| Failure modes found | 3       |

Scope reviewed: the uncommitted `git diff -- libs/frontend/memory-curator-ui` (9 files), read in full, against `batches.md` Batch 8 (Tasks 8.1-8.2, `batches.md:1177-1226`), `implementation-plan.md` Component 10 (`:709-731`), the committed wire DTO (`libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`), the lib `CLAUDE.md`, and `batch-8-report.md`. Backend uncommitted changes were ignored per instructions.

## Confirmation checklist (with evidence)

### 1. `Memories` row in "Last retention run" — CONFIRMED

`storage-health-panel.component.ts:226-229` adds the `Memories` dt/dd pair; `:322` builds
`memoriesText: "archived ${formatCount(...memoriesArchived)} · deleted ${...memoriesDeleted} · evicted ${...memoriesEvicted}"`.
`formatCount` (`:46-49`) renders `null` as `—`, never `0`. When `lastRun` is null the entire
`<dl>` is skipped (`:216 @if (v.lastRun; as run)` … `:241-245 @else` → "No retention run recorded
yet."), so no crash and no misleading zeros — the row does not render at all. `makeStorage()`
default carries counters 8/3/2 and the spec asserts the rendered row exactly
(`storage-health-panel.component.spec.ts:190-192`).

### 2. `Memory lifecycle` row and status precedence — CONFIRMED, one gap (finding 2)

Settings text: `storage-health-panel.component.ts:361` —
`archive after <N> d · delete after <M> d · cap <cap>`. Exactly one status via
`lifecycleStatusText` (`:371-380`), in order:

1. `!enabled` → `off (preview only)` (`:373`)
2. `lastNote === 'vec-unavailable'` → `deletes paused: vector extension unavailable` (`:374-376`)
3. `preview` null → `preview after the first run` (`:378`)
4. else the next-run preview text (`:379`)

Precedence when two conditions hold:

- **disabled AND vec-unavailable** → `off (preview only)`. Not misleading: disabled means no
  deletes happen at all, so "off" is the stronger and correct truth.
- **vec-unavailable AND populated preview** → `deletes paused: …` wins and the measured preview
  counts are silently dropped. Not misleading about deletes (paused is accurate — if anything it
  over-warns, never under-warns), but the user loses the archive/over-cap numbers. See finding 2.
- `lastNote === 'disabled'` with `enabled: true` (historical note from a run taken while
  disabled) is deliberately ignored; the panel shows the current-state preview. Correct.

### 3. Quality requirements — CONFIRMED

- `data-testid="storage-memory-lifecycle"` at `storage-health-panel.component.ts:260`.
- Every exceptional state is plain text (`:261-264`, two `<span>`s inside the `dd`); no colour
  class distinguishes the statuses.
- No settings write: the component has `storage` and `now` inputs only (`:301, :308`); the
  template adds no click handler or RPC call.
- `ChangeDetectionStrategy.OnPush` unchanged (`:116`); `vm` is a `computed` over `input()`
  signals (`:310-368`); no subscriptions anywhere in the diff.
- The accordion still wires `[storage]="storage()" [now]="now()"` (`memory-diagnostics-accordion.component.ts:170`).

### 4. Spec coverage — CONFIRMED, one gap (finding 3)

`storage-health-panel.component.spec.ts`:

- Populated preview: `:195-222` — asserts the **exact** normalized text via `toBe`, the
  strongest form; any wrong status text fails.
- Null preview: `:224-232` (`preview after the first run`).
- Disabled: `:234-251` (`off (preview only)`).
- vec-unavailable: `:253-269` (`deletes paused: vector extension unavailable`).

Each `toContain` carries the full status phrase, so a wrong status string fails. The
vec-unavailable case runs against the default fixture whose `preview` is null, so the
"vec-unavailable hides a populated preview" precedence branch has no coverage (finding 2/3).

### 5. Decay removal — CONFIRMED, one orphaned guard (finding 1)

- Tile, `lastDecay` binding and `lastDecayLabel` removed from
  `memory-diagnostics-accordion.component.ts` (diff: tile `:61-66` deleted, `lastDecay` field
  and `lastDecayLabel` computed deleted).
- `_lastDecay` signal, public `lastDecay`, and the `refresh` assignment removed from
  `memory-diagnostics-state.service.ts` (diff at `:30, :41, :68-70`); the service file now has
  no decay reference (verified by reading the full file).
- `'decay-run'` case removed from `toneFor` (`event-feed.component.ts` diff).
- Repo-wide `rg "lastDecay|decay-run|decayRun"` over `libs/frontend`, `libs/shared` and the
  webview app matches only the shared DTO (`rpc-curator-diagnostics.types.ts:4,192-193`, Batch
  9's scope) and the accordion spec's absence assertion. No non-spec frontend file reads them.
- Accordion spec asserts absence: `memory-diagnostics-accordion.component.spec.ts:125` —
  `expect(root.querySelector('[data-testid="last-decay-run"]')).toBeNull()`.

**Batch 9 compile safety — CONFIRMED.** Every frontend fixture that carried decay data was
cleaned in this batch: the state spec snapshot (`memory-diagnostics-state.service.spec.ts:66`,
untyped literal) and the rpc spec payloads (`memory-diagnostics-rpc.service.spec.ts:61-82,
96-119`, untyped literals) no longer contain `lastDecayAt`/`lastDecayStats`; the decay event
was replaced with `'manual-run'` (a union member that stays). Removing the DTO fields and the
`'decay-run'` union member in Batch 9 cannot fail a frontend typecheck.

### 6. The two first-run failures — fix did NOT weaken assertions

- **Concatenated accessible text**: fixed by splitting settings and status into two `<span>`s
  (`storage-health-panel.component.ts:261-264`) and pinned by an **exact** `toBe` on normalized
  text (`spec:215-221`). The fix strengthened the spec.
- **Inline `lastRun` fixture missing the three counters**: fixed by adding
  `memoriesArchived/Deleted/Evicted` to the backlog fixture (`spec:313-315` in the diff) —
  data added, nothing asserted less. The partial/failed tests were also refactored from
  mutating `storage.retention.lastRun` directly to immutable `makeStorage({...})` overrides
  (`spec:126-139, 151-165`); their assertions (badge text, badge class, detail label, detail
  text) are unchanged.

### 7. Accessibility — CONFIRMED

The lifecycle row keeps the `<dl class="grid grid-cols-[auto_1fr] …">` structure with
`<dt class="text-base-content-muted">Memory lifecycle</dt>` and one `<dd>`
(`storage-health-panel.component.ts:259-265`), same as the sibling rows. Both lines are text;
the second `<span class="block">` starts with `&nbsp;`, so a screen reader reads settings then
status as one continuous `dd` without the runs colliding. The `Memories` row follows the same
`dt`/`dd` pair as the rest of the run card (`:226-229`).

## Findings

1. **[MODERATE] Exhaustiveness guard `assertNever` removed with no scheduled restoration.**
   - File: `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts:164-165`
   - The pre-batch `default: return assertNever(ev.kind)` compile-time-checked that every
     `MemoryCuratorEventKind` had an reviewed tone. Batch 8 replaced it with
     `default: return 'info'` — unavoidable today, because the shared union still carries
     `'decay-run'` (`rpc-curator-diagnostics.types.ts:4`) and keeping `assertNever` without the
     `decay-run` case would not compile. But the removal is permanent unless Batch 9 restores
     it, and nothing schedules that: `implementation-plan.md:724` says only "delete the
     `'decay-run'` case", and the Batch 9 task list (`batches.md:1229-1246`) never mentions
     `event-feed.component.ts` or `assertNever`. `batch-8-report.md:35` calls the default
     "temporary" without an owner.
   - Failure scenario: Batch 9 removes `'decay-run'` from the union and closes the task; a
     later kind (say `'lifecycle-run'`) is added to `MemoryCuratorEventKind` — `toneFor`
     compiles without error and silently tones it `info`, where the old code would have failed
     the build until a human chose a tone. Silent-by-compile-design is the exact failure mode
     this repository's `assertNever` convention exists to prevent.
   - Fix: add "restore `default: return assertNever(ev.kind)` in `event-feed.component.ts`
     `toneFor`" to Batch 9's Task 9.1 file list (it already touches the shared union in the
     same commit, so the restore is type-safe there).

2. **[MINOR] `vec-unavailable` silently hides a populated preview, and the combination is untested.**
   - File: `storage-health-panel.component.ts:374-376`
   - When the backend measured a preview and then the vector extension became unavailable, the
     panel shows only "deletes paused: vector extension unavailable"; the
     `archiveEligible`/`overCap` counts the user could still act on are dropped. Not misleading
     about deletes (paused is accurate), but a data-loss-in-display case. The spec's
     vec-unavailable test (`spec:253-269`) uses `preview: null`, so this precedence branch has
     zero coverage.
   - Fix: one spec case with `lastNote: 'vec-unavailable'` AND a populated preview asserting the
     paused note wins; optionally append the note after the preview instead of replacing it.

3. **[MINOR] The three exceptional-status assertions use `toContain`.**
   - File: `storage-health-panel.component.spec.ts:227-232, 246-251, 264-269`
   - `toContain` fails on a wrong status string but passes if extra or duplicated status text
     renders. The populated case uses the exact `toBe` form (`:215-221`), which is the right
     pattern. Low risk — the strings are static — but a regression that concatenates two
     statuses would slip through.
   - Fix: promote the three to `toBe` on the full normalized `dd` text (settings + status),
     mirroring `:215-221`.

4. **[MINOR] No spec pins the null-run state against a phantom `Memories` row.**
   - File: `storage-health-panel.component.spec.ts:271-295`
   - The component is correct — `lastRun: null` skips the whole `<dl>`
     (`storage-health-panel.component.ts:241-245`) — but the only null-run render (the skip
     test) never asserts that `archived`/`Memories` is absent. A future template edit that
     renders the row with zeros outside the `@if` would pass the suite.
   - Fix: add `expect(root.textContent ?? '').not.toContain('archived')` to the skip test.

5. **[MINOR] rpc spec fixtures are untyped literals and already stale against the DTO.**
   - File: `memory-diagnostics-rpc.service.spec.ts:23-47`
   - `baseStorage` omits `memoryLifecycle` entirely, which the committed DTO requires
     (`rpc-curator-diagnostics.types.ts:153-160`). It passes only because the payload is never
     annotated. Pre-existing pattern, not a Batch 8 regression, and it is exactly why Batch 9's
     removal cannot break this spec. But the same looseness means this spec would not have
     caught a DTO drift either. Residual, recorded for Batch 9's author, not a required change.

## Five logic questions

1. **How does this fail silently?** A future `MemoryCuratorEventKind` renders with an unreviewed
   `info` tone and no compile error (finding 1) — the guard that turned this silent case into a
   build failure was removed and nobody owns its restoration.
2. **What user action produces unexpected behaviour?** A user who opens diagnostics while the
   vector extension is unavailable sees "deletes paused" but not the preview counts the backend
   already measured (finding 2). No other user action in the diff produces surprise: the rows
   are read-only.
3. **What input data produces a wrong answer?** None found. The status branches key off narrow
   DTO unions; an unknown `lastNote` value falls through to the preview branch, and
   `formatCount` degrades `null` to `—`. The `disabled` note with `enabled: true` is correctly
   treated as historical.
4. **What happens when a dependency fails?** Inherited, unchanged behaviour: an RPC failure
   lands in the state service's `catch` (`memory-diagnostics-state.service.ts:69-70`) and sets
   the `error` signal; the panel keeps the last rendered storage. Polling continues. If a
   version-skewed backend omitted `memoryLifecycle` the `vm` computed would throw and blank the
   panel — but the same trust already applies to `s.retention` and `s.observations`, producer
   and consumer ship in one package, and the repo rule is "trust internal types past the
   boundary". Not a Batch 8 defect; recorded as residual uncertainty.
5. **What is missing that the requirements never mentioned?** The restoration of `assertNever`
   after Batch 9 (finding 1), and combined-state coverage (vec-unavailable + preview,
   finding 2).

## Data flow

RPC `memory:diagnostics` → `MemoryDiagnosticsStateService.refresh` sets `_storage` signal
(`memory-diagnostics-state.service.ts:68`) → accordion `storage()` readonly signal
(`memory-diagnostics-accordion.component.ts:222`) → panel `[storage]` input (`:170`) →
`vm` computed formats both new rows (`storage-health-panel.component.ts:310-368`, `:371-380`).
Every step is a signal; no stale read, no duplication, no manual subscription. **OK** end to end.

## Requirements fulfilment

| Requirement (batches.md Task 8.1/8.2) | Status | Gap |
| --- | --- | --- |
| `Memories` row via `formatCount`, null-run safe | COMPLETE | null-run absence untested (finding 4) |
| `Memory lifecycle` row + settings text | COMPLETE | — |
| Exactly one status, four states | COMPLETE | vec+preview precedence untested (finding 2) |
| `data-testid="storage-memory-lifecycle"` | COMPLETE | — |
| Text, not colour; no settings writes; OnPush; signals | COMPLETE | — |
| Specs: populated, null preview, disabled, vec-unavailable | COMPLETE | three use `toContain` (finding 3) |
| Decay tile/state/event case removed; no non-spec reader | COMPLETE | — |
| Accordion spec asserts tile absent | COMPLETE | `accordion.spec.ts:125` |
| Batch 9 compile safety of fixtures | COMPLETE | all decay fixture data removed; payloads untyped |

Implicit requirements not addressed: `assertNever` restoration (finding 1) — nothing in
Batch 9's plan owns it.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `lastRun` null | YES | `@else` branch, no row rendered (component `:241-245`) | untested absence (finding 4) |
| Lifecycle disabled | YES | `off (preview only)` (`:373`) | — |
| disabled + vec-unavailable | YES | disabled wins — correct, no deletes happen anyway | — |
| vec-unavailable + populated preview | YES | note wins, preview dropped (`:374-376`) | untested; preview lost (finding 2) |
| vec-unavailable + null preview | YES | note wins | — |
| `lastNote: 'disabled'`, `enabled: true` | YES | historical note ignored, current state shown | — |
| Counters null (defensive) | YES | `formatCount` → `—` (`:46-49`) | — |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: `assertNever` is gone from `toneFor` and no batch is scheduled to restore it, so
  event-kind exhaustiveness silently stops being compile-checked after Batch 9.
- What a robust implementation would add: (1) Batch 9 task-list entry restoring
  `assertNever(ev.kind)` in `toneFor`; (2) a spec case for vec-unavailable with a populated
  preview; (3) `toBe` instead of `toContain` for the three exceptional statuses; (4) a
  null-run assertion that no `Memories` row renders.