# Batch 5 — shared cost display

## Files changed

- `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:10,54,80` — one provider-neutral `costBasisLabel` helper, optional signal input, visible final meaning and badge tooltip. Finite numeric cost is required for a label.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:225` and `session-stats-summary.component.html:103,315` — pass the snapshot's optional basis to the existing cost badge in compact and expanded layouts. The live `provisional` marker remains separate.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:7,95,144` — reuse the same helper for the cost tooltip and compact/inspector text. A null total never acquires a final basis label; the existing explicitly marked known subtotal remains available when present.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:115,192` — R1 guard: claim `receipt.turnId` before pricing, recording, persistence or stats callback. A second publication for that turn returns without adding its price again. This covers both normal and interrupted paths sharing `publishStats`.
- `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.spec.ts:43`, `molecules/session/session-stats-summary.component.spec.ts:500`, and `molecules/session/session-stats-view.spec.ts:82` — cases for final estimate, subscription coverage, legacy display, provisional marker, null/unavailable and compact/inspector wording.
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts:551` — verifies the existing aggregator forwards final basis snapshots unchanged, including an old Claude snapshot with no field. No production aggregator edit was required: it already installs the authoritative `sessionStats` object as-is and forwards the typed result event.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:227` — calls the publication guard twice with the same turn ID and a real `CodexSessionUsageOwner`; verifies the lifetime known price is added once, then a different turn ID adds a second price.
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch5-report.md` — this report.

## Design decisions and scope

The shared helper maps only `estimated` and `covered-by-subscription` to visible labels. `reported`, `unknown` and absent basis keep the existing badge. The cost badge and session tooltip show the final meaning; the compact/inspector formatter uses the same text. A null or non-finite cost always renders unavailable in the badge and receives no final meaning. Existing budget lower-bound text remains explicitly a known subtotal when a total is unavailable. There is no provider check or separate Codex presentation path.

The batch 5 row permits at most six production files plus specs. Five production files were changed: three chat-ui TypeScript files, one chat-ui template and the R1 backend stream file. Shared type and stats callback plumbing already came from batches 3–4. The existing aggregator is a pass-through; its spec now guards that behavior.

The design reference checked was `implementation-plan.md` section 2 and its batch 5 row: final estimate versus live provisional, subscription wording, null cost, old snapshots, and shared compact/inspector presentation. No standalone rendered Angular preview was available without the prohibited build/serve/dev commands, so no screenshot or visual-quality claim is made.

## Coordinator verification scope

Changed Nx projects: `@ptah-extension/chat-ui`, `@ptah-extension/chat`, `@ptah-extension/agent-sdk`. Relevant downstream compilation targets are `ptah-electron`, `ptah-extension-webview`, `ptah-extension-vscode`, `ptah-cli` and `ptah-tui` because the native stream and shared UI contracts cross hosts. Focused spec names: `cost-badge.component`, `session-stats-summary.component`, `session-stats-view`, `session-stats-aggregator.service`, and `codex-chat-turn-lifecycle`.

No test, lint, typecheck, build, nx, npm, verify, diagnostics or app launch command was run, as requested. I inspected the source and diff and checked that changed source/spec files use LF without BOM. Ptah's dependent index was incomplete for frontend files, so direct source references were the fallback. The unrelated `task-tracking/landing-live-demo/HANDOFF.md` change was not touched.

## Follow-ups

- Batch 3 review D4 mentioned adding `isOptional` validation for `costBasis`, `pricingCoverage` and `priceProvenance` in `isValidSessionStatsSnapshot`. Batch 3 already corrected the misleading validation comment. The validator lives in `chat-state`, outside the exact batch 5 file row and six-file production limit, so the additional runtime checks remain a separate follow-up.
- Batch 4 review R3 (a throwing stats callback can replace a result error), R4 (mixed billing modes across a lifetime), and R2 (scoped typecheck for nullable metadata cost) remain for coordinator review. R1 is addressed here.

## Revision 1

Review `code-logic-review-batch5.md` (APPROVE 8) prompted these changes:

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:115-125,163,194-234,293-300` — `recordTurnPriceOnce` marks a turn only after `recordTurnPrice` succeeds. `publishStats` no longer returns after a previous price write, so a later payload can refresh stats. Pricing waits for both the turn terminal and accepted usage, allowing an early publication to be followed by fuller terminal usage; missing-evidence coverage is marked only after that turn's terminal is observed. Evidence from other threads remains accepted. A failed price write leaves the turn retryable.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:27,226-287` — replaced the local publication clone with real adapter/`streamCodexChatTurn` integration cases for in-turn and detached terminal handling. Both assert one recorded price and the final lifetime total. A focused case calls the production `recordTurnPriceOnce` helper to prove throw, retry and duplicate-call behavior. In the current stream, the in-turn terminal sets `terminal` before detachment; that path and the detached drain are mutually exclusive, so a single invocation cannot naturally publish first in-turn and then in the drain.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:94-107,174` — tooltip explains that estimated cost is not a charge and that subscription coverage is a published-rate value, not a charge. The compact provisional estimated cost aria label says “estimated” once.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.spec.ts:79-95` — pins both tooltip sentences and the exact compact aria label.
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch5-report.md` — this revision record supersedes the original report's claim-before-work guard description.

Affected Nx projects remain `@ptah-extension/agent-sdk` and `@ptah-extension/chat-ui` for this revision. The coordinator reported typecheck and lint passing before this revision. No test, lint, typecheck, build, nx, npm, verify or diagnostics command was run here, per the explicit restriction. Angular rendering and screenshot inspection remain unavailable without the prohibited app commands. The `angular-frontend-patterns` skill was not invocable in this lane's skill inventory; the supplied Angular rules were followed directly.
