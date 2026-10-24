# Code logic review — TASK_2026_718_15b7, round 2

Reviewer family: codex
Implementer family: codex (same family by user pin — weaker evidence)

Score: **8/10**
Verdict: **REVISE**

Round 1 found the missing IntersectionObserver `scrollMargin`; the current stub includes it.

## Findings

Both findings below are pre-existing hygiene gaps in touched specs, not regressions introduced by this diff. They are included because the requested review explicitly covers any broad console suppression and unasserted or failure-unsafe console spies. No confirmed newly introduced logic defect was found.

1. **Moderate — group-wide console suppression remains unasserted.** `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:770` (also line 771). The `compaction overlay and banner agree (real registries)` group's `beforeEach` replaces both `console.info` and `console.warn` with no-ops for every test. No test asserts either spy. Consequently unexpected warnings from the real compaction services disappear along with expected messages; a quiet run does not establish that this group is clean. The spies are restored in `afterEach`, so this is suppression rather than an ordinary successful-run leak. **Concrete fix:** remove these group-wide stubs. Where an individual case deliberately causes a diagnostic, install a local spy, assert its expected arguments and count, and restore it in `finally`.

2. **Moderate — warning spy can leak after a failed assertion and is never asserted.** `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts:429` and `:441`. The transport-failure test silences `console.warn`, then awaits `create()`/`settle()` and executes assertions before calling `mockRestore()`. Any rejection or assertion failure skips restoration; the suite's `afterEach` only destroys the fixture, and `jest.clearAllMocks()` clears call history without restoring the implementation. Subsequent tests in this file can therefore run with warnings hidden. Even on success the test never verifies that the intercepted warning is the expected diagnostic. **Concrete fix:** wrap the test body after spy creation in `try/finally`, restore in `finally`, and assert the warning's expected arguments and count before leaving `try`.

## Coverage

- Reviewed the supplied 25-file diff and decisions, with targeted current-source reads for the changed behavior. The supplied count/no-skip audit was treated as orchestrator evidence, not independently rerun.
- Checked assertion and setup changes across the timer conversions, markdown/RPC settling, model picker, confirmation dialog, mocks, and pricing seed. No changed matcher or expected value was found to weaken the existing assertions. The confirmation-dialog negative focus assertion still follows the cancel click; moving it before the asynchronous yield tests the pre-render boundary while the later assertions still check inert removal and restored focus.
- Checked console/global mutations in the touched specs. The newly added wizard error spy asserts both count and arguments and restores in `finally`. New fake-timer suites restore real timers in `afterEach`; the wizard also has real-timer cleanup. The branch group's `matchMedia` descriptor is restored in `afterAll`. The agent-card animation-frame spy restores in `finally`.
- Checked pricing utilities: `getPricingMap()` returns a copy; reset plus merging the saved map in `finally` restores the pricing entries, including removing the test-only entry. Reset also clears the warned-model tracker; this is broader cleanup, not a retained test seed.
- Compared added TabManager/AuthState/Logging methods against current signatures and the config RPC payloads against shared types. The three minimal CLI-session replies omit RpcResult helper methods, but their current consumer (`SessionLoaderService.restoreCliSessionsForSession`) reads `success` and `data`, so the supplied empty-success shape exercises a production-valid path. No demonstrated false-positive test caused by those additions was found.
- Checked the credential-popover destroy guard and its existing destroy-during-save case. The guard prevents registration of a render callback after destruction while preserving the intended page-level completion toast. Normal focus registration remains tied to the component injector.
- Checked model-picker focus, click, input and key handlers. Disabling open-on-focus preserves the drafted label after Use/refocus. ArrowDown and typing still open the list. The changed tests still exercise filtering, keyboard selection and two-stage Escape; their initial click no longer tests opening by focus. Keyboard-only opening is not directly exercised by these changed cases.
- Checked both session creation implementations: navbar `handleCreateSession()` closes its popover after requesting a session; canvas `handleCreateSession()` closes its popover even on a blocked creation. Both use a default for blank names. Waiting for the input to become hidden is compatible with those close paths and adds a retrying postcondition. No new close-path flake was identified statically. The existing test title claiming blank-name validation does not describe current default-name behavior; that mismatch predates this change.
- No Jest, Nx, build, serve, browser, e2e, git, or other heavy commands were run. Runtime console counts, browser locator resolution, timing stability and compilation are not independently verified by this review. Source/spec files were not modified.

## Decisions

- Request revision for the two console-hygiene gaps under the explicitly requested whole-touched-spec review scope; do not attribute them to the new diff.
- Accept the zoneless setup direction: production selects zoneless change detection by default, with an explicit fallback option.
- Accept both production changes on static logic review; no additional production edits are requested.
- Keep the strengthened e2e close assertions and the existing behavioral assertions. Fix the console scopes/restoration rather than muting additional output.
- Same-family review and absence of runtime verification limit the evidence; this is an independent inspection, not cross-family or execution evidence.
