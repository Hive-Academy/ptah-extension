# B3b Phase 1 — state and logic

## Changed files

- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:74` — optional expected run binding and `runMismatch` recovery signal; authoritative runless refresh and stale response guard at `:292`.
- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:37` — reload lifecycle, mismatched run, no state, and handoff rebind checks.
- `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:19` — `started` signal with the handoff run binding, set after accepted start at `:127`.
- `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.spec.ts:68` — started binding assertions.
- `libs/frontend/setup-wizard/src/lib/components/cards/enhanced-prompts-summary-card.component.ts:29` — removed fallback/token badges; section filtering and count at `:99`.
- `libs/frontend/setup-wizard/src/lib/components/cards/enhanced-prompts-summary-card.component.spec.ts:1` — four rows, counts, omitted legacy metadata.
- `libs/frontend/setup-wizard/src/index.ts:30` — exports for guidance store and result panel.
- `libs/frontend/onboarding/src/lib/analyze/guidance-section-counts.ts:1` — pure parser of the canonical guidance region and four ordered sections.
- `libs/frontend/onboarding/src/lib/analyze/guidance-section-counts.spec.ts:1` — required parser cases.
- `libs/frontend/onboarding/src/lib/analyze/generation-step.store.ts:28` — completion transition observation; tab binding at `:43`, runless bracketed capture at `:64`, local and timestamp checks at `:92`, visibility at `:102`.
- `libs/frontend/onboarding/src/lib/analyze/generation-step.store.spec.ts:1` — capture, recovery, transition, and reload cases.

## C6 case mapping

| Required case | Test name |
| --- | --- |
| B completes before first read | `rejects B completed before the first read` |
| B active during capture | `rejects B active before the capture`; `rejects B active during the capture` |
| Service lock held | `rejects a service lock held by unbound generation` |
| New run in same tab | `rejects a new run in the same tab` |
| `generatedAt` moves | `rejects generatedAt moving between status reads` |
| Guidance disabled during capture | `rejects guidance disabled during capture` |
| Content null | `returns unavailable for null content` |
| RPC throws | `returns unavailable when a run-state RPC throws` |
| Completed run bound late | `never captures a completed run bound late` |
| Happy path | `captures the happy path with two runless identity checks and four rows` |
| Result advances while local run remains A | `hides captured sections when the workspace result advances while run A stays local` |
| Binding changes during capture | `rejects a binding changed mid-capture` |
| Reload omits in-memory counts | `omits section counts after reload` |

## Summary card callers

The only caller is `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts:127`. No caller was changed: its full summary is assignable to the narrowed `Pick<EnhancedPromptsSummary, 'sections'>` input. The card filters its legacy Quality Guidance row.

## Verification

The first required command was started exactly as requested with `| tail -40`, but remained queued behind the machine-wide verify lock for over 15 minutes (shell PID 890452, npm PID 890453). Two earlier verify runs from other worktrees occupied both lock slots. No Nx summary lines were available at handoff, so failures and host compilation are **unverified**. The second required Electron lint/typecheck command was not started because the first was still active and the task requires one heavy check at a time. The parent session should collect the first command's exit/result, fix any nonaccepted failure, then run `npm run verify -- -t lint,typecheck -p ptah-electron | tail -40` and record both NX summaries. The `angular-frontend-patterns` skill was not available in host skill search. Ptah diagnostics timed out while its TypeScript check was still running.

## Decisions

- **Recovery signal:** Keep the existing `bind` return type (`void`) and expose a `runMismatch` signal when the runless authoritative lookup disagrees with `?run`. Options were a return value or a signal; async lookup requires a signal. Evidence: `GenerationWorkflowStore.refresh()` is async. Reversible: yes.
- **Summary card caller:** Keep the legacy caller's existing full summary binding because structural typing accepts the narrowed input. Filter Quality Guidance inside the card so the legacy surface receives the approved D9 reduction. Options were changing the caller or filtering at the card. Evidence: one caller at `prompt-enhancement.component.ts:127`. Reversible: yes.
- **Parser order:** Search canonical headings in plan order after the previous found heading; noncanonical headings count as text. Evidence: C6 rules and `buildCombinedPrompt`. Reversible: yes.

## Revision 1

### Findings and regression tests

| Finding | Change | Test name |
| --- | --- | --- |
| 1 — captured counts are not reactive | `libs/frontend/onboarding/src/lib/analyze/generation-step.store.ts:18,98,106` stores the captured entry in a signal and replaces it after capture. | `updates a computed from null when capture resolves without another signal change` |
| 2 — legitimate run B appears mismatched | `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:268-271,303-316` clears the expected run on acceptance and consumes the initial authoritative lookup once. | `adopts a started run B after binding run A without a mismatch on refresh` |
| 3 — missing expected run appears idle | `generation-workflow.store.ts:301-313` latches `runMismatch` for a null authoritative result until a new bind. | `flags recovery when the expected run has no authoritative owner` |
| 4 — same-run rebind churn | `generation-workflow.store.ts:74-82` skips reset and lookup when the held run already matches the new `?run`. | `keeps the held run and skips a lookup when rebinding its run id` |
| 6 — superseded handoff failure | `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:145-147` ignores a late rejected start from an older revision. | `ignores a late failure from a superseded guidance handoff` |
| 7 — unbounded captured map | `generation-step.store.ts:18,98` keeps one captured entry, replacing the previous run's entry. | `captures the happy path with two runless identity checks and four rows`; `updates a computed from null when capture resolves without another signal change` |
| 8 — test gaps | `libs/frontend/onboarding/src/lib/analyze/generation-step.store.spec.ts:62-92,98-101,119-129,139-144,151-158` uses a distinct lock-owner mock, asserts runless B lookups, single-flight, no count on stale, workspace and run changes, and no visible count after late bind. The last test also fixes a one-shot workspace mock consumed by the first lookup. | `rejects B completed before the first read`; `rejects B active before the capture`; `rejects B active during the capture`; `rejects a service lock held by unbound generation`; `single-flights two concurrent captures for the same run`; `rejects generatedAt moving between status reads`; `rejects a workspace changed mid-capture`; `rejects a run id changed mid-capture`; `never captures a completed run bound late`; `validates the tab and forwards an expected run for recovery` |

Finding 5 belongs to Phase 2 and was not changed.

### Verification

The first scoped verify run reached `NX   6 tasks: 5 succeeded, 1 failed`. Its sole failure was `@ptah-extension/onboarding:test`: the existing workspace-mismatch test used a one-shot mock that the first lookup consumed. After correcting that mock, the required rerun completed with `NX   6 tasks: 6 succeeded, 3 cached` and exit code 0. Ptah diagnostics was attempted after edits but returned `TypeScript check still running after 45s`; the scoped verify typecheck succeeded.

### Decisions

- **Mismatch lifetime:** Keep the first authoritative `?run` mismatch visible until a new bind or acceptance. Options were to clear it on the next refresh or latch it. Evidence: the review requires recovery instead of an idle auto-start state. Reversible: yes.
- **Captured storage:** Keep one signal-held `{ key, counts }` entry. Options were an immutable map or one entry. Evidence: only the current bound run can be shown and finding 7 requires eviction. Reversible: yes.
- **Service-lock test:** Simulate a different tab owning the service lock by making the runless lookup return no run for this tab; assert that capture stops before reading status. Evidence: `getBoundRunState(binding)` is the capture's lock-aware identity boundary. Reversible: yes.

## Revision 2

### Change and tests

- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:15,304-323,380-390`: use a failure sentinel for thrown RPC lookups. A failed expected-run lookup retains the expected id and schedules a bounded watchdog retry. Authoritative null still sets recovery; the legacy path normalizes failures back to null and keeps its existing failure count.
- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts:77-116`: `recovers the expected run after one failed lookup`; `schedules a retry without consuming the expected run after a failed lookup`. Existing `flags recovery when the expected run has no authoritative owner` and `retries a lost status read with a bounded watchdog` cover authoritative null and legacy counting.

### Verification

- ` NX   6 tasks: 6 succeeded`

### Decisions

- **Failure representation:** A private symbol distinguishes a thrown RPC from authoritative null without changing the store's public API. Reversible: yes.
- **Retry behavior:** Only failed lookups with an expected run take the new retry branch; legacy lookups still enter the existing null branch. Reversible: yes.
- **Duplicate refresh:** Leave the minor duplicate-result behavior unchanged because its repair is not a one-line change and lies outside the Serious defect. Reversible: yes.
