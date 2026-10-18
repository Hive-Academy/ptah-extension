# Batch 17 test report

## Work produced

Added six TestBed integration specs in `libs/frontend/command-center/src/lib/integration/` and one shared `integration-harness.ts`. The harness uses the real page, page controller, session coordinator, Tribunal run coordinator, and voice loop, with the scene stubbed and transport dependencies mocked. The six specs contain 18 cases: session identity and lock (4), voice loop (2), delegation and status (3), Tribunal confirm gate (4), failure and fallback (3), and accessibility list (2). Updated `test-report.md` with AC1–AC25 evidence and B18 manual items.

## Verification

- `npx jest -c libs/frontend/command-center/jest.config.ts libs/frontend/command-center/src/lib/integration --coverage=false --maxWorkers=2`: **Test Suites: 6 passed, 6 total; Tests: 18 passed, 18 total** (final run).
- `npx eslint libs/frontend/command-center/src/lib/integration`: passed.
- `npx prettier --write libs/frontend/command-center/src/lib/integration/*.ts`, then `npx prettier --check libs/frontend/command-center/src/lib/integration/*.ts`: passed.
- `ptah_get_diagnostics` after edits: zero errors in the seven requested files. It reports 15 errors in existing sibling files, including older mock tuple types in `command-center-page.controller.spec.ts` and `tribunal-run-coordinator.spec.ts`, and BigInt target errors in `libs/shared/src/lib/types/capability-id-codec.ts`.

## Defects found

No production defect was established by this suite. One attempted test that advanced Jest's clock through Angular's zone failed in the test harness; the final timeout case calls `page.timeoutProposal('p1')` and asserts the resulting Decline and card cleanup. It does not verify timer scheduling.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Use a shared TestBed harness with real page-scoped coordinators and mocked host seams. | The existing page/controller specs use TestBed and mocks; the new cases need a common root tab and transport. | Yes |
| Stub only the scene renderer. | jsdom cannot exercise Canvas 2D frame timing; the page still binds a canvas and text list, and B18 measures the real renderer. | Yes |
| Report partial AC evidence explicitly. | Several ACs require microphone, audio playback, real Electron navigation, or a richer integration assertion. Claiming them passed from neighboring checks would overstate evidence. | Yes |

## Not done

The 18 cases do not provide a distinct automated assertion for AC5, AC12, AC15, or AC24. AC20 and AC23 require the B18 Electron gate. Several other rows in `test-report.md` are partial. The task's requested complete AC1–AC25 assertion mapping is therefore not finished; the evidence table identifies each gap. No production files were edited.

## Correction round

Added four cases through the page, real controller, real voice loop, StatusNarrator, and projection path, with RPC mocked at ClaudeRpcService:

| AC | New case | Location |
| --- | --- | --- |
| AC5 | `ignores empty utterances and sends one non-empty transcript through the page` | `libs/frontend/command-center/src/lib/integration/voice-turn-loop.spec.ts:35` |
| AC12 | `narrates an owned CLI lane once when starting and once when completed` | `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts:72` |
| AC15 | `groups a manifest root and monitored lanes under one Tribunal node with a stage` | `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts:142` |
| AC24 | `speaks bounded prose at a turn boundary while keeping the full reply visible` | `libs/frontend/command-center/src/lib/integration/voice-turn-loop.spec.ts:66` |

The first scoped Jest run passed 20/22 cases; AC5's fixture left the voice state idle and AC15's manifest lane identifiers did not match the projection source's CLI family binding. The second run passed 21/22; AC15 still had the fixture mismatch. After correcting both fixtures and formatting, the final scoped run reported **Test Suites: 6 failed, 6 total; Tests: 22 failed, 22 total**. Its tailed output showed TestBed failures during `createHarness`/cleanup, but omitted the original error. The three-run limit prevents a diagnostic rerun. **The corrected suite is not verified as passing.**

`npx eslint libs/frontend/command-center/src/lib/integration` passed. `npx prettier --write` and `npx prettier --check` on the three changed integration files passed. `ptah_get_diagnostics` was unavailable because the TypeScript check exceeded 45 seconds. No production files were edited.

### Defects found in correction round

No production defect was established. The AC15 failure in the first two runs came from a test manifest whose lane identifiers did not match the production binding contract. The final TestBed setup failure remains unclassified because the full original error was outside the mandated 50-line tail.

### Decisions in correction round

| Decision | Evidence | Reversible |
| --- | --- | --- |
| Exercise the voice loop's clip handler on the page-owned instance. | The project voice-loop unit spec uses this handler for clip-path tests; browser microphone capture is covered by B18. | Yes |
| Use the real projection source only for AC15. | The existing source spec shows how monitored agents bind to manifest lanes; other integration tests use the harness projection input. | Yes |
| Mark final evidence as unverified. | The final scoped run reported 22 failures, despite preceding runs passing the newly added AC5, AC12, and AC24 cases. | Yes |
