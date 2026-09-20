## Outcome

The compact canvas tile is now a fixed-height, summary-only status card. It renders exactly four zones: a total status line with stable session color and workspace identity, a bounded pulse strip of at most 24 semantic marks, one precedence-controlled content slot, and a non-scrolling metrics footer.

The card no longer renders a transcript, mini composer, collapse state, duplicate title chrome, or any internal scrollbar. Targeted questions and permissions are resolved from router metadata before the legacy session-id fallback, and an attached stale/surface target is never retargeted to the active tab. Blocking prompts render through a direct signal/computed chain and expose one `Open full view` action through the existing `expandToFull` output.

The pure live/finalized adapters coalesce semantic activity, bound their result, avoid duplicate agent-summary prose, and redact absolute paths before content reaches the view model.

## Files changed

| Path                                                                                                     | Change                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`      | Replaced transcript/input/footer composition with smart prompt targeting, workspace/session identity, conversation compaction reads, bounded summary projection, and `expandToFull` forwarding. |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` | Added router-first/fallback/stale-target/FIFO/one-rAF/compaction/identity/action/fixed-height tests.                                                                                            |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`          | Rewrote in place as the exact four-zone, input/output-only bounded renderer.                                                                                                                    |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts`     | Added four-zone, no-scroll, no-form/markdown/transcript, accessible-mark, reduced-motion, and action tests.                                                                                     |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`                     | Added pure live/finalized adapters, prompt/content precedence, total status mapping, path redaction, stable semantic identities, and the 24-mark bound.                                         |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts`                | Added live/finalized fixtures for bounds, coalescing, fallback verbs, path redaction, Unicode, prompt precedence, nested-agent summary dedupe, and terminal states.                             |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts`             | Replaced message/service-derived scrolling badges with a bounded metrics input and non-scrolling footer.                                                                                        |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.spec.ts`        | Added bounded metric formatting and no-horizontal-scroll assertions.                                                                                                                            |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-header.component.ts`            | Deleted after repository-wide usage clearance.                                                                                                                                                  |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-input.component.ts`             | Deleted after repository-wide usage clearance.                                                                                                                                                  |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-text.component.ts`              | Deleted after repository-wide usage clearance.                                                                                                                                                  |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-tool-row.component.ts`                  | Deleted after repository-wide usage clearance.                                                                                                                                                  |
| `libs/frontend/chat-ui/src/index.ts`                                                                     | Removed deleted exports and exported the retained components plus summary contracts/adapters.                                                                                                   |
| `libs/frontend/chat/src/lib/components/index.ts`                                                         | Removed deprecated re-exports of deleted compact children.                                                                                                                                      |

Every implementation path above is in the closed Implementer B manifest. No Implementer A file, canvas file, shell template, `TabManagerService`, `PermissionHandlerService`, or path alias was edited. This report is the separately requested deliverable.

## The A-lane seam

The seam is `ReactivePromptTargetReader` plus `readPromptRoutingRevision()` at `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:36`. It locally models A's not-yet-present readonly invalidation signal as optional `routingRevision?: Signal<number>`. Both targeted-prompt computeds read this value before consulting `targetTabsFor()` / `questionTargetTabsFor()`, so the typed test double can invalidate them after target attachment without editing A's service.

When A's real signature lands, the single integration change is the property access on line 42: replace `.routingRevision?.()` with A's published readonly signal name. No other compact-card code or A-owned file changes.

## Acceptance evidence

Track R acceptance criterion 2 is pinned by `CompactSessionCardComponent renders a newly routed blocking prompt within one animation frame`: the test enqueues a request with a mismatched session id, attaches router metadata, increments the local routing revision, advances exactly one `requestAnimationFrame`, and requires the blocking summary plus `Open full view` action.

`CompactSessionCardComponent emits expand and keeps the fixed-height summary-only contract` requires `h-full` and `overflow-hidden`, rejects `overflow-auto` and `<textarea>`, and verifies the deleted header/collapse UI is absent. `CompactSessionActivityComponent renders exactly four bounded zones without transcript, forms, markdown, or scroll classes` independently requires the exact `status → pulse → content → metrics` zone order and rejects transcript/form/markdown/scroll surface area.

The production roots are `h-full min-h-0 overflow-hidden`; the entire owned production surface contains no `overflow-auto`, `overflow-x-auto`, `overflow-y-auto`, `afterRenderEffect`, textarea, or `[innerHTML]`.

## Deletions

Before deletion I ran:

```text
rg -n "CompactSession(Header|Input|Text|ToolRow)|ptah-compact-session-(header|input|text)|ptah-compact-tool-row" --glob '!node_modules/**' --glob '!dist/**' .
```

The only consumers returned were the four component definitions, `libs/frontend/chat-ui/src/index.ts`, deprecated re-exports in `libs/frontend/chat/src/lib/components/index.ts`, imports/template usage in `compact-session-card.component.ts`, and `CompactToolRowComponent` usage inside the activity component being rewritten. There were no unrelated consumers.

- `compact-session-header.component.ts`: its only consumer was the old compact card; the canvas tile already owns title/mode chrome.
- `compact-session-input.component.ts`: its only consumer was the old compact card; compact mode is now summary-only.
- `compact-session-text.component.ts`: it had no consumer outside its barrel; the bounded content slot replaces it.
- `compact-tool-row.component.ts`: its only consumer was the old activity feed; semantic marks plus one content slot replace it.

The post-deletion repository search returns no production reference to any deleted class or selector.

## Verification

### Test

```text
 NX   Running target test for 2 projects:

- @ptah-extension/chat-ui
- @ptah-extension/chat

> nx run @ptah-extension/chat-ui:test

Test Suites: 29 passed, 29 total
Tests:       198 passed, 198 total
Snapshots:   0 total
Time:        18.084 s, estimated 41 s
Ran all test suites.

> nx run @ptah-extension/chat:test

Test Suites: 83 passed, 83 total
Tests:       2 skipped, 1318 passed, 1320 total
Snapshots:   0 total
Time:        35.837 s, estimated 44 s
Ran all test suites.

 NX   Successfully ran target test for 2 projects

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Typecheck

```text
 NX   Running target typecheck for 2 projects:

- @ptah-extension/chat-ui
- @ptah-extension/chat

> nx run @ptah-extension/chat-ui:typecheck

> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json

(node:20712) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:25584) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

(node:16488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15604) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 NX   Successfully ran target typecheck for 2 projects
```

### Lint

```text
 NX   Running target lint for 2 projects:

- @ptah-extension/chat-ui
- @ptah-extension/chat

> nx run @ptah-extension/chat-ui:lint

Linting "@ptah-extension/chat-ui"...

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts
  828:1  warning  File has too many lines (729). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\mcp-directory-browser.component.ts
  818:1  warning  File has too many lines (867). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-browser-modal.component.ts
  973:1  warning  File has too many lines (856). Maximum allowed is 700  max-lines

✖ 3 problems (0 errors, 3 warnings)

> nx run @ptah-extension/chat:lint

Linting "@ptah-extension/chat"...

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
  911:1  warning  File has too many lines (1063). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
  807:1   warning  File has too many lines (928). Maximum allowed is 700  max-lines
  932:37  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
   70:35   warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  370:22   warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  1229:5  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1065:1  warning  File has too many lines (923). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  200:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  212:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  213:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  221:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
   995:1   warning  File has too many lines (977). Maximum allowed is 700  max-lines
  1356:43  warning  Unexpected empty async method 'createNewSession'       @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (988). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\task-404-lane-b-compact\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function

✖ 17 problems (0 errors, 17 warnings)

 NX   Successfully ran target lint for 2 projects
```

## Gaps

- A's real reactive prompt-target signature is not present in this worktree. The local typed `routingRevision` test seam proves request-before-target invalidation; the one property access described above must be repointed after lane integration.
- Unit coverage proves the existing compact two-unit tile contract through fixed-height/no-scroll markup, but this lane deliberately did not edit or duplicate canvas geometry and did not add a browser-level pixel assertion.
- Lint is successful with zero errors. The 3 `chat-ui` and 17 `chat` warnings shown above are in pre-existing files outside the Implementer B manifest and were not edited.
- No commit was created because this frontend execution role prohibits staging or committing; the invoking workflow owns Git operations. The worktree is intentionally left dirty for that workflow.
