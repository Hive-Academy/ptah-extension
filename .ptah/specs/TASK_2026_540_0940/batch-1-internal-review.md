# Batch 1 Internal Code-Logic Review — TASK_2026_540_0940

**Verdict: ACCEPT**
**Score: 9/10**

## Scope examined

- `git diff -- libs/frontend/core/src/lib/services/app-state.service.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts` (242 + 454 diff lines), read in full alongside the current file contents (not diff hunks alone) for:
  - the constructor effect (`app-state.service.ts:481-503`)
  - `recordSettledSurface` (`:541-557`)
  - `openViewInActiveSlice` (`:759-769`)
  - `switchWorkspace` (`:789-865`)
  - `removeWorkspaceState` (`:873-892`)
  - `updateActiveViewSlice` / `activeViewSlice` / `DEFAULT_VIEW_SLICE` (`:263-336`, `:741-746`)
- `implementation-plan.md` Decision 1 (lines 101-286), Revision 3 overrides 1/5/6 (lines 3-36), Component 2 spec (:428-435), Data flow/Failure behaviour (:452-469), Extension points note to TASK_2026_533 (:505-510).
- `batches.md` Batch 1 (Tasks 1.1/1.2, lines 93-146), Plan validation risk RC and edge cases 1-5 (lines 30-92).
- `plan-review.md` "Instructions for implementers" and the Re-review section (R2-1 through R2-6) for the write-seam and stay-branch rules this batch must honour.
- `batch-1-report.md`, cross-checked line-for-line against the actual diff (no unverified claims found).
- `git show HEAD:...app-state.service.ts` compared against the working tree to confirm `setCurrentView` is byte-identical and no unrelated lines moved.
- `workspace-coordinator.service.ts` and `workspace-coordinator.service.spec.ts` (chat lib, out of this batch's file list) grepped and traced by hand for the two tests that switch workspace while `currentView()` is `'thoth'` (`:511-541`), to check whether the new stay-branch changes their outcome.
- Fresh, non-cached run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core --skip-nx-cache` → PASS (870 tests, 33 suites, 0 failures).
- `ptah_get_diagnostics` on both files: the 95 errors returned are all in unrelated files (`auth-state.service.spec.ts`, `electron-layout.service.spec.ts`, `message-router.service.spec.ts`, `mock-rpc-service.ts`, etc.) and pre-exist independently of this diff — likely a broader tsconfig used by the diagnostics provider than the Nx `typecheck` target, which passed cleanly. Zero diagnostics reference `app-state.service.ts` or `app-state.service.spec.ts`.

No files were edited; no git commands other than `diff`/`status`/`show` (read-only) were run.

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was found. The one candidate — the global `openSurface` write happening even when the ownership-gated slice write is refused — is the plan's explicit, documented design (Decision 1's rationale: "an owner-gated global write leaves `openSurface` stale exactly when the owner is null"), not an accidental swallow. A failed navigation (rejected `navigateByUrl`) leaves `openConfigurationSurface()` unchanged because `currentSurface()` never changes and the effect never re-runs — verified by the new "a failed navigation leaves openConfigurationSurface unchanged" test (`app-state.service.spec.ts:970-993`) and by tracing `surfaceNavigationLanded`/generation guards in `recordSettledSurface`.

### 2. What user action produces unexpected behaviour?

Traced two candidate races by hand rather than trusting the spec suite alone:

- **Finding 4 (in-flight navigation lands after a stay-branch switch).** Confirmed by trace: `setCurrentView('tasks')` started while `'settings'` is open, then `switchWorkspace('/ws/b')` runs before it lands — `staying` reads `true` (Router truth is still `'settings'` at that instant), the stay-branch transfers ownership to `/ws/b` synchronously, and when `'tasks'` later lands the constructor effect's ownership check now matches `/ws/b`, so `'tasks'` gets stamped onto B's slice. State and screen agree; this is accepted by the plan and pinned by the new "finding 4" test (`:1105-1123`). Not a regression.
- **Reverse race (config navigation superseded during a non-stay switch): investigated, not found to be real.** Hypothesis: a config-surface navigation started but not yet landed, then a workspace switch takes the non-stay branch and starts a new navigation via `requestSurface`, which increments `_navigationGeneration`. If the superseded config navigation's promise still resolved and fired `NavigationEnd`, the constructor effect would briefly write a stale `openSurface`. Checked whether Angular's Router fires `NavigationEnd` for a navigation superseded by a newer one: it does not — a superseded navigation resolves as cancelled/failed, so `currentSurface()` (which the effect tracks) never reflects the stale target. The existing generation guard in `recordSettledSurface` exists for a related but distinct purpose (a navigation that legitimately lands, but after the requesting workspace is no longer active). No test pins this scenario, but the mechanism precludes it structurally; no finding raised.

### 3. What input data produces a wrong answer?

None found. `isConfigurationSurface` is a straightforward `includes` over a 4-item literal list matching `ConfigurationSurfaceId`, and `ViewType` values reaching it are already normalized (`normalizeView` maps the one legacy value, `'orchestra-canvas'`, before any of this code runs). No malformed input can reach the refusal guard in a way that misclassifies a surface.

### 4. What happens when a dependency fails?

`SurfaceRouterService.navigateToSurface` is unmodified in this batch (its remount API lands in Batch 2). A rejected `navigateByUrl` is handled by the existing `surfaceNavigationLanded`/generation/ownership guards in `recordSettledSurface`, and the constructor effect naturally does not fire because `currentSurface()` does not change — pinned by the new "failed navigation" test. This batch introduces no new dependency.

### 5. What is missing that the requirements never mentioned?

Nothing material. The plan explicitly scopes Batch 1 to `app-state.service.ts`/`.spec.ts` only; the remount consumer (`SurfaceRouterService.remountActiveSurface`), the menu component, and the shell's three-branch gate are later batches by design, and nothing in this diff references them prematurely (grepped `openConfigurationSurface`, `configurationSurfaceRemountTick`, `ConfigurationSurfaceSlots`, `isConfigurationSurface`, `CONFIGURATION_SURFACE_IDS` across `libs` and `apps` — zero hits outside `app-state.service.ts` itself), so there is no partially-wired behaviour to flag at this stage.

## Failure modes

### Stale `openSurface` during an in-flight switch (finding 4 class)

- Trigger: a code-workspace navigation is requested, then a workspace switch lands on a configuration surface before that navigation settles.
- Symptom: the previous workspace's surface gets stamped onto the incoming workspace's slice once it lands.
- Evidence: `app-state.service.ts:481-503` (unconditional global write, ownership-gated slice write), `:789-821` (stay-branch sets `_settlementOwner = newPath` synchronously).
- Current handling: explicitly accepted by the plan (Decision 1 rationale, Failure behaviour section) and pinned by `app-state.service.spec.ts:1105-1123` ("finding 4").
- Recommendation: none — this is a documented, deliberate trade-off, not an oversight.

No other failure mode was found in the scope reviewed. The residual uncertainty is limited to Batch 2-4 integration (the remount consumer and the chat-lib spec at `workspace-coordinator.service.spec.ts:511-541`, both traced by hand below rather than run, since they are outside this batch's file list).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None found. Two things worth recording for the reviewers of later batches, not fixes for this one:

- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts:511-541` switches workspace while `appState.currentView()` is `'thoth'` (now a config surface, so `switchWorkspace` takes the stay-branch). Traced by hand: the assertions in both affected tests (`thothActiveTab()`, `marketplaceActiveProvider()`) read off `activeViewSlice()`, which is keyed by `_activeWorkspacePath()` — and `_activeWorkspacePath.set(newPath)` runs unconditionally before the `if (staying)` branch (`app-state.service.ts:822` vs. `:842`). So the per-workspace pointers still flip to the new workspace's slice regardless of the stay-branch, and both tests should keep passing. This matches `batches.md`'s own stated assumption (line 60-62) that this spec is unverified until Batch 3/4 run the chat project; my trace supports the assumption but does not replace running it.
- The diagnostics tool's 95 errors are all pre-existing, in files this batch does not touch, and the Nx `typecheck` target (the actual gate) passed clean — recorded here only so the next reviewer does not need to re-triage the same noise.

## Data flow

1. Router lands a navigation (any cause: menu click, `SWITCH_VIEW` message, `Location.back()`, a service-started restore) → `surfaceRouter.currentSurface()` changes → constructor effect fires. OK — matches Decision 1's single-writer design.
2. Inside `untracked`: `openSurface` is computed from the surface and written unconditionally (skipped if unchanged) to `_configurationSurfaces`. OK — this is the only writer of `openSurface` in the codebase (grep-confirmed).
3. Still inside the same `untracked` block: the ownership check (`_settlementOwner !== owner`) gates `openViewInActiveSlice(surface)`. OK — unchanged gating logic, only the call site's context comment updated.
4. `openViewInActiveSlice` refuses the four configuration ids before calling `updateActiveViewSlice`, so no slice is seeded or mutated for a configuration id. OK — verified the early return precedes the only call to `updateActiveViewSlice` inside this method.
5. `recordSettledSurface` (service-started navigations only) re-grants `_settlementOwner` and calls the same refusing funnel; it performs no global write, consistent with "the constructor effect is the single writer" (all landed navigations also trip step 1-2 via the Router). OK.
6. `switchWorkspace`: reads `staying` from Router truth (`isConfigurationSurface(this.currentView())`) once, before the outgoing stamp; the outgoing stamp itself routes through the refusing funnel so a configuration surface is never stamped onto the outgoing slice; `_activeWorkspacePath` is updated unconditionally; the bootstrap-slice migration is untouched by the branch; the stay-branch bumps the tick exactly once and returns before `requestSurface`; the non-stay branch is byte-identical to the pre-existing restore-navigation path apart from `_settlementOwner`'s ternary. OK — traced against `git show HEAD` and confirmed no non-config-surface behaviour changed.
7. `removeWorkspaceState` is untouched; its owner-nulling interacts with the refusing funnel exactly as the plan (finding 5 / R2-6) describes — traced by hand through `DEFAULT_VIEW_SLICE` fallback in `activeViewSlice` to confirm the pinned assertions (`openViews` reverting to `['chat']` after a second delete) are logically correct, not just green by coincidence.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Global `openSurface` write in the constructor effect, first and unconditionally, before the ownership check | COMPLETE | none |
| `openViewInActiveSlice` refuses configuration ids as the single slice-write funnel (covers effect, `recordSettledSurface`, outgoing stamp) | COMPLETE | none |
| `recordSettledSurface` keeps its drop guards and owner re-grant, no global write | COMPLETE | none |
| `switchWorkspace` stay-branch keyed on `isConfigurationSurface(this.currentView())`, owner = `newPath`, bootstrap migration verbatim, tick bumped exactly once, no `requestSurface` | COMPLETE | none |
| `setCurrentView` byte-identical | COMPLETE | confirmed via diff (no hunk touches it) |
| Typed `ConfigurationSurfaceSlots` | COMPLETE | matches plan's interface exactly, each member `Readonly<Record<string, never>>` |
| No dead code (`recordSettledView`, `updateConfigurationSurfaceSlot`) | COMPLETE | grep-confirmed absent |
| Spec re-pins keep assertion meaning | COMPLETE | each re-pinned range checked against its original meaning; the in-surface-pointer test's re-pin (`'thoth'`/`'marketplace'` → `'tribunal'`/`'tasks'`) is correct because that test exercises slice-stamping generally, not thoth/marketplace specifically |
| Edge cases 1-5 (batches.md) | COMPLETE | each has a dedicated, correctly-reasoned spec case |
| Scoped verification passes | COMPLETE | reproduced fresh, non-cached |

Implicit requirements not addressed: none found within this batch's scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| External navigation while `_settlementOwner` is null | YES | Unconditional effect write; pinned by "owner null after removeWorkspaceState" test | none |
| Lazy-chunk / rejected navigation | YES | Effect never re-runs; pinned | none |
| Switch while on a configuration surface | YES | Stay-branch; pinned (no-navigation spy, tick count, outgoing slice) | none |
| Finding 4 in-flight stamp | YES | Accepted by design; pinned | none, by plan's own acceptance |
| Finding 5 / R2-6 (closed-workspace re-grant) | YES | Both halves (chat re-grant vs. configuration no-op) pinned in one test with a second `removeWorkspaceState` in between | Traced by hand to confirm the `openViews` assertion is not coincidentally correct — confirmed correct via `DEFAULT_VIEW_SLICE` fallback semantics |
| Reverse in-flight race (config nav superseded by a non-stay switch) | N/A | Not applicable — Angular Router does not fire `NavigationEnd` for a superseded navigation, so the effect cannot observe a stale target | none; documented here so a future reviewer does not need to re-derive this |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none within this batch's scope; the only residual risk is integration with later batches (the remount consumer and the chat-lib spec at `workspace-coordinator.service.spec.ts:511-541`), which is explicitly deferred by `batches.md` to Batch 3/4 and was traced (not run) here with a supporting result.
- What a robust implementation would add: nothing for this batch. If anything, a spec case for "reverse race" (config nav request immediately followed by a non-stay workspace switch) would make the Router-cancellation assumption executable rather than only traced by hand — worth a one-line addition in a future batch's spec pass, not a blocker here.
