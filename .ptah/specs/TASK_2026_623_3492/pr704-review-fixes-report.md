# PR #704 CodeRabbit review fixes

## 4248389017 — valid

Evidence: `turnTestsOutcomeLabel` previously treated any outcome set with no passed or failed runs as the all-unknown case, so `running: 1, unknown: 1` rendered only `unknown` (`libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.ts:181-194`).

Change: the shorthand `unknown` now applies only when passed, failed, and running are all zero. A background run and unknown run render as `1 running in background, 1 unknown`.

Spec: `turn-summary.model.spec.ts:321`.

Reply: Fixed. The all-unknown shorthand now excludes background runs, so unknown counts remain visible alongside `running in background`.

## 4248389098 — valid

Evidence: ChatView provides `DisplayDockState` as `null` for Electron when `HIDE_AGENT_SIDEBAR` is true (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:243-256`), while the transcript feed had enabled the display surface for Electron alone (`chat-transcript.component.ts:624-633`). That left the summary chip path active and replaced the change-set card without a dock.

Change: `TranscriptDisplayFeed.enabled` now requires both Electron eligibility and a non-null dock (`transcript-display-feed.ts:70-98`). Electron with a dock still replaces the change-set card with the summary chip; without a dock, the existing card remains.

Spec: `chat-transcript.display.spec.ts:471`.

Reply: Fixed. The feed now activates only when a dock exists; Electron with the dock retains the summary-chip replacement, while hidden-sidebar Electron views keep their change-set card.

## 4248389123 — valid

Evidence: the collector previously considered only assistant message records with `streamingState` (`transcript-agent-facts.ts:44-74`), while the transcript holds live execution trees separately in `_executionTrees` (`chat-transcript.component.ts:401-459`). Presentation records can therefore omit the active tree.

Change: the transcript passes active trees through the display feed and host-source boundary (`chat-transcript.component.ts:624-634`, `transcript-display-feed.ts:78-98`, `transcript-ptah-ui-host-sources.ts:16-61`). The collector adds live trees to the active turn only when their tree id is not already present on a record (`transcript-agent-facts.ts:44-79`).

Specs: `transcript-agent-facts.spec.ts:112` covers a missing live record and `:128` covers deduplication; `transcript-ptah-ui-host-sources.spec.ts:86` covers reactive host-source wiring.

Reply: Fixed. `$agents` now includes the active execution tree before finalization and avoids double-counting when the tree is already present on an assistant record.

## 4248389136 — valid

Evidence: the published grammar defines `SPS = SP { SP }` (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/ptah-ui.md:47-64,88`), but `headerText` rejected two spaces after its keyword (`ptah-ui-lexical.ts:39-43`).

Change: removed only the double-space rejection; a header still requires at least one space and retains the existing trim/decode behavior (`ptah-ui-lexical.ts:39-42`).

Spec: `ptah-ui-parser.spec.ts:31-39` covers title, card, section, accordion, table source, and list source with multiple spaces. Existing parser corpus coverage continues to pin all currently-valid blocks.

Reply: Fixed. Header parsing now follows the published `SPS` production and accepts one or more spaces without changing parsing of existing valid blocks.

## 4248389162 — valid

Evidence: the update error previously derived parent kinds from the `/4` layout list, including accordion (`surface-patch.ts:50-54`), although `ptah_surface_update` accepts dashboard-catalog/3 only. The `/4` type guard remains necessary for renderer-side `/4` operations.

Change: the `/3` error text now lists only `section, stack, grid and card` (`surface-patch.ts:49-50,168`).

Spec: `surface-patch.spec.ts:160-186` asserts the corrected message; its separate accordion-parent test remains intact for `/4` behavior.

Reply: Fixed. The `/3` update error now advertises only `/3` layout kinds; accordion support remains in the `/4` type guard and its existing test.

## Verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.spec.ts --coverage=false --maxWorkers=2` — 1 suite passed, 36 tests passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.spec.ts --coverage=false --maxWorkers=2` — 3 suites passed, 39 tests passed.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts --coverage=false --maxWorkers=2` — 2 suites passed, 223 tests passed. Jest emitted its existing ES-module configuration warning before passing.

`ptah_get_diagnostics` was requested after edits but its TypeScript compiler check remained unavailable after 45 seconds; it was not used as a passing result.

## Changed files

- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.ts`
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-feed.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.spec.ts`
- `libs/shared/src/mcp-apps-contracts/ptah-ui-lexical.ts`
- `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.spec.ts`
- `libs/shared/src/mcp-apps-contracts/surface-patch.ts`
- `libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts`
- `.ptah/specs/TASK_2026_623_3492/pr704-review-fixes-report.md`
