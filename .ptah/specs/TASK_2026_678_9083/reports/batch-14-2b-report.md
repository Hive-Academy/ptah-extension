# Batch 14.2b report

Status: **partial**. The page shell, ordinary questions, scene composition, voice controls, status ages, and lazy export are present. Tribunal launch and several required page-level cases remain unfinished.

## Items 1–7

| Item | Evidence | Limit |
| --- | --- | --- |
| 1. Page/lifecycle | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:63,93,111,119,123,130,135,155,160`; `command-center-page.controller.ts:151,179,208` | Page opens/resumes and exits voice on destroy. Canvas failure removes the scene. Text, list and safe failure notice remain. Only the latest settled assistant reply is shown. No page-level teardown test. |
| 2. Node card | `command-center-page.component.ts:79,85,88,130,180` | Hover flows to overlay, selection flows from work list, focus returns to matching row. The page has no `pinNode` handler, so it does not change selection on pin. Page-level unpin/focus tests remain. |
| 3. Scene | `command-center-page.component.ts:164` | Measured labels refresh on projection identity changes, and card anchor refreshes on active node change. No page-level scene test. |
| 4. Voice | `command-center-page.controller.ts:78,91,128,147,179,185,194,208`; `voice/command-voice-loop.ts:26,63,392,411` | Loop receives controls, projection, ordinary prompt, settled terminal pulse, full question key, retry, and exposes latency marks. Roster callbacks are absent. |
| 5. Tribunal | **Not done.** No `TribunalRunCoordinator` is instantiated, no availability/manifest/task transport is wired, and pending-card confirm/decline is not connected. | Paid launch is deliberately unavailable. |
| 6. Status ages | `command-center-page.controller.ts:102` | `computeAgesMs` feeds `buildStatusContext` through the existing coordinator seam. |
| 7. Lazy export | `libs/frontend/command-center/src/index.ts:1` | Only the page is exported, with the internal-model comment. Workspace import search found only `apps/ptah-extension-webview/src/app/app.routes.ts:201`, importing `CommandCenterPageComponent`; no removed-name importer. |

Projection data is incomplete at `command-center-page.controller.ts:55`: live direct child tabs are included, but provider IDs, persisted children, agents, and runs are not populated. Their producer integration remains required.

## Required spec cases

| Case | Spec/evidence | Status |
| --- | --- | --- |
| Controls start, mute, stop | `command-center-page.controller.spec.ts:66` | Pass, controller methods |
| Boundary reaches loop once | `command-center-page.controller.spec.ts:105` | Pass, terminal pulse correlation |
| Stale boundary not spoken | `voice/command-voice-loop.spec.ts:10`; `command-center-page.controller.spec.ts:105` | Pass for token mismatch and pre-send pulse |
| Roster open and resolve | — | Missing |
| Teardown exits, no capture/timer/card | `command-center-page.controller.spec.ts:78` | Exit call passes; capture/timer/card assertions missing |
| Scene hover reaches overlay input | — | Wiring present; spec missing |
| Work-list selection unpins pinned card | — | Wiring present; spec missing |
| List-only without Canvas 2D | — | Template branch present; spec missing |
| Record-write-failure notice | `command-center-page.controller.spec.ts:134` | Signal passes; DOM notice spec missing |
| Ordinary question uses full key | `command-center-page.controller.spec.ts:142` | Pass |
| Status age | `command-center-page.controller.spec.ts:84` | Pass |

## Turn-token decision

Chose option 4b. `CommandVoiceLoop` now emits a monotonically increasing voice-send token after a successful send (`voice/command-voice-loop.ts:392`) and accepts an optional token at `onTurnBoundary` (`:411`). A mismatch returns before speaking. The page records the token and the current terminal pulse sequence (`command-center-page.controller.ts:91`), then forwards only a later successful terminal pulse for the marked tab (`:130-147`). The two named specs above pin the older-token and pre-send-pulse cases. **Residual:** a delayed older terminal pulse emitted after the replacement send, with a fresh sequence, cannot be distinguished without a backend turn ID on the pulse. The page should correlate an explicit turn/message ID once available.

## Verification

- Scoped Jest: 2 suites passed, 17 tests passed; command-center controller and voice-loop specs only. Three of four permitted Jest runs used.
- ESLint on six changed files: exit 0, no output.
- Prettier `--check` on six changed files: “All matched files use Prettier code style!”
- Scoped `ptah_get_diagnostics`: no diagnostics in requested files. Seven existing sibling errors remain: five mock-signature errors in `tribunal-run-coordinator.spec.ts` and two BigInt target errors in `capability-id-codec.ts`.
- No Nx, git, build, serve, dev or e2e commands were run.

## Degradation audit

`command-center-page.controller.ts:170` catches provider-config read failure and sets voice readiness false; first catch-body line is `// degradation-audit: reported — voice remains unavailable; text and graph stay usable`. No other catch or `.catch` was added in non-spec files. Existing voice-loop catch sites were not changed.

## Needed changes outside the batch

- A trustworthy proposal nonce and a typed, page-accessible availability/task creation source are needed to validate and launch a Tribunal roster. The current persona asks the model to create a nonce; the page has no independently issued nonce or typed host transport to use as an authority.
- A backend turn or message ID on terminal turn pulses would remove the residual stale-boundary ambiguity. The page currently has only pulse sequence/revision and text.
- The page needs a source for root/child provider IDs and persisted child/agent/run projection inputs. Current tab state does not carry provider IDs.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Page-scoped controller holds transport and projection | Put all logic in component; page-scoped injectable | `command-center-page.controller.ts:12`, `command-center-page.component.ts:57`; keeps template handlers thin | Yes |
| Use terminal pulse and optional voice token for boundary | Uncorrelated text callback; pulse plus token | Terminal pulse exposes settled assistant text and sequence; loop test rejects older token | Yes |
| Keep Tribunal launch unavailable until authenticity/availability can be proven | Guess availability/nonce; defer launch | `parseRosterProposal` requires nonce and `ProposalAvailability`; no page-owned trusted values found | Yes |
| Keep graph optional after Canvas failure | Blank canvas; list-only branch | `command-center-page.component.ts:68` leaves the work list and text controls visible | Yes |

## Anything not done

Tribunal transport, roster card open/confirm/decline/timeout lifecycle, persisted projection inputs, provider labels, comprehensive page component specs, and a backend-backed turn identity are outstanding. The component should not be treated as complete for Task 14.2b.
