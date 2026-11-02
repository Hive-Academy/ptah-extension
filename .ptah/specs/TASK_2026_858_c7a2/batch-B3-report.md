# Batch B3 report

## Audit results

Searched all files under `apps/ptah-electron-e2e/src/**` and `libs/frontend/webview-e2e-harness/src/**` for `.chat-scroll-content`, `.children`, `:scope >`, `childNodes`, `.chat-msg-slot`, `data-ptah-transcript-message-id`, `chat-user-message`, and `assistant-message`. `childNodes` had no matches. The structural match and every message match are accounted for below. Paths are relative to the workspace root.

| Match | Result |
| --- | --- |
| `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts:158,160,162` | **Fixed.** `transcriptOrder` now flattens each active `.chat-msg-item` into its direct children before extracting tokens and skips wrappers with `data-ptah-leaving`. This preserves the prior slot, chip, artifact, and change-set order. |
| `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:8` | **Not needed.** `:scope > [data-pane-side]` reads canvas pane children, not transcript items. |
| `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts:154` | **Not needed.** The slot query anchors an older-history prepend; it does not remove messages. |
| `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:135,141,159,164,174,242,249,250` | **Not needed.** These read slot IDs and rects during tab navigation, not message removal. The active scroller excludes an inert old pane (line 132); the new message stagger is suppressed on a tab edge, so slot rect sampling remains valid. |
| `apps/ptah-electron-e2e/src/specs/task-382-late-post-turn-event.spec.ts:75` | **Not needed.** The user-bubble locator checks an appended follow-up message; this scenario does not clear, rewind, or replace transcript messages. |
| `apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts:14,164` | **Not needed.** `assistant-message` occurs only in comments naming a transformer file. |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/chat/streaming-response.e2e.spec.ts:22,27,64,81,125` | **Not needed.** The spec mounts a standalone fixture message and streams text into that same node; it has no transcript wrapper or message removal. |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/lock-popover-stacking.e2e.spec.ts:182` | **Not needed.** `.children` reads marketplace row order. |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts:223,999` | **Not needed.** `.children` walks settings layout elements. |

No message locator in these folders runs after a transcript clear, rewind, or replacement. The repeat audit found no other transcript direct-child reader.

## Files changed

- `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`: updated `transcriptOrder` for the wrapper structure and leaving-node exclusion.
- `.ptah/specs/TASK_2026_858_c7a2/batch-B3-report.md`: this report.

## Verification

- Scoped `ptah_get_diagnostics` for the changed spec: 0 errors, 0 warnings.
- Ran exactly once in the foreground: `npm run verify -- -t typecheck -p ptah-electron-e2e,@ptah-extension/webview-e2e-harness`. Exit code 0; Nx output: `2 tasks: 2 succeeded` (0 cache hits).
- The default Nx output did **not** emit the exact `Running target typecheck for 2 projects` header. The two-task success confirms both requested project targets ran, but the requested literal-header check could not be observed from this run. No second run was made because the instruction specified one run.
- No e2e, build, serve, or workspace-wide check was run. The approved plan reserves rendered motion verification for the subsequent Electron visual pass.

## Decisions

- **Flatten only active message wrappers.** Options: query descendants by selector or flatten direct wrapper children. The plan explicitly specifies flattening each `.chat-msg-item`; the current template places the slot and associated chip/artifact/change-set siblings inside it. The wrapper filter also excludes `data-ptah-leaving` without changing test intent. Reversible.
- **Keep unrelated locators unchanged.** Options: add leaving filters broadly or only where a removal can leave a stale match. The audit found no removal-following message locator; broad filters would alter unrelated fixture and tab-navigation tests. Reversible.
- **Skill availability.** This lane has no skill catalogue or skill-loading tool, so no optional skill could be loaded; the repository plan and instruction files guided this e2e-only edit.
