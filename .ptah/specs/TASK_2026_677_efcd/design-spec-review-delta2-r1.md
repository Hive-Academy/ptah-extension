# Gate 1.7 delta 2 — revise round 1 review

**Verdict: APPROVED — 8/10.** The two round 0 findings are fixed. The additive slot and workflow rules are implementable subject to the architect checks below. Two Moderate ambiguities should be resolved in the implementation plan; neither blocks Gate 1.7.

## Earlier findings

1. **Serious unknown-provider fallback — fixed.** `design-spec.md:616`, `:626-631`, `:1092`, and `:1319-1321` now require a neutral lucide `Workflow` glyph whenever no authoritative session provider ID exists, with no guessed Claude mark or monogram. The mock declares `sessionProvider: 'claude-cli'` and has a neutral `?prov=unknown` path (`prototype/assets/app.js:24-39`, `:330-334`). This agrees with PM-14 and requirement 18.5 (`task-description.md:64`, `:703-704`). The real provider field remains an architect data-source check, not a claim that one exists today.
2. **Moderate status words — fixed.** `design-spec.md:617-623`, `:665-669`, `:1305-1310`, and `:1322-1323` now display `waiting` and `failed` in the tile, dock, card, menu, and accessible names; `needs you` is reserved for request urgency, while `error` is a data-state synonym. The prototype follows that split (`prototype/assets/app.js:328-355`, `:390-420`). This matches the existing status vocabulary of §3.5 (`design-spec.md:246-253`).

## New findings

1. **Moderate — the header toggle has two competing dots.** `design-spec.md:705-706` places the pending-request `bg-state-need` dot and the workflow `--sel` dot at the same top-right position when a workflow tab at overlay width also has pending requests. D43 (`design-spec.md:1098`) does not settle their precedence. **Fix:** specify one visible dot and its precedence (pending-request urgency first is consistent with the existing `N needs you` chip); keep the workflow chip as the persistent workflow cue, and keep the toggle's accessible name independent of either decorative dot.
2. **Moderate — per-tab open preference and overlay session-switch rule conflict.** `design-spec.md:292-300` says a manual inspector choice survives tab switches and a workflow tab defaults open in every mode, while §8.3 says the overlay sheet is closed on *every* session switch (`design-spec.md:951-956`). Reopening a remembered overlay choice automatically would also violate D43's no focus move/trap rule (`design-spec.md:1098`). **Fix:** state that overlay tab switches always close the modal sheet without reopening it; preserve the per-tab manual choice for the docked aside, and define how that choice is restored on a return to docked width. Make §3.8, §8.3, and the initial-open input contract say the same thing.

## Architect checks

1. Find an authoritative session engine provider ID across Electron, Rail, and VS Code; if absent, use the neutral glyph. Do not use the model-stat `ContextCapacity.providerId` as a proxy (`design-spec.md:1319-1321`; `chat-types.ts:603-650`).
2. Define a typed mapping from monitored agent state, pending requests, and focused `TabState.status` to the six displayed status words, duration, and activity; omit fields unavailable for sub-agents (`design-spec.md:1322-1323`; `chat-types.ts:649-650`).
3. Identify the sub-agent role-type field and keep the fallback icon rule (`design-spec.md:1324`).
4. Retain `AgentMonitorStore`, `BackgroundAgentStore`, `ownedBySession`, `laneKey`, legacy `sub:`/`bg:` keys, and selected-item reachability when priority overflow replaces scrolling (`design-spec.md:1325-1327`; `parity-inventory.md:127-135`).
5. Own one `cliId -> providerId` map, including hand-authored `pi` and `ptah-cli` marks (`design-spec.md:1328`).
6. Verify projection through `session-embed` -> `ChatViewComponent` -> deferred inspector; use the specified workflow-kind registry fallback if `ng-content` reprojection fails. Preserve the §4.8 empty-slot, section order, focus, and target contract and §5 header slot order (`design-spec.md:681-714`, `:1329`). Coordinate with TASK_2026_648's preceding chat-view/header changes (`decisions.md:38-39`).
7. Resolve the typed workflow source and per-tab initial-open input after TASK_2026_648 lands: current `TabState` has no `workflow` property (`libs/frontend/chat-types/src/lib/chat-types.ts:603-650`, `:650-712`). Define initialization, mode reset, manual override, and docked/overlay transitions together so D42/D43 and §8.3 agree (`design-spec.md:297-301`, `:1097-1098`, `:1330`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept the neutral unknown-provider fallback and existing status words as fixed. | Neutral/actual mark vs guessed mark; `waiting`/`failed` vs new words. | `design-spec.md:626-631`, `:617-623`; `prototype/assets/app.js:24-39`, `:328-355`. | Yes, if an authoritative provider source or product vocabulary changes. |
| Keep the additive inspector/header slots and the docked workflow initial-open rule. | Shared slots vs a second panel/header; workflow default open vs mode default. | `decisions.md:39-40`; `design-spec.md:681-714`, `:1096-1098`. | Yes. |
| Keep the overlay workflow sheet closed until the user opens it. | Closed with cues vs automatic modal opening. | `design-spec.md:297-300`, `:951-956`, `:1098`; avoids focus movement and trapping on a tab switch. | Yes. |

No new prototype check was run in this review. The designer's `170 PASS / 0 FAIL` report is recorded in `decisions.md:41`; it is not independently verified here.
