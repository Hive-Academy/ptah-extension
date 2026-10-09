# SonarCloud quality-gate remediation — PRs 675 and 676

Queried 2026-10-09 against SonarCloud public API project key `Hive-Academy_ptah-extension`.
No hotspots were returned for either pull request. Changes are deliberately uncommitted.

## PR #675 — `feat/chat-mermaid-diagrams`

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-chat-mermaid-diagrams-0624908d5480`

### Failing gate condition

| Condition           | Result before fix                        |
| ------------------- | ---------------------------------------- |
| New security rating | E (actual `5`; gate requires A / `<= 1`) |

Reliability, maintainability, duplication, and security-hotspot-review conditions were passing. New coverage was not reported as a gate condition.

### Findings and fixes

| Rule / severity                            | File:line                                                                         | Fix                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript:S8479` / MINOR vulnerability   | `libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-diagram.component.ts:10` | Removed the permissive `ADD_TAGS: ['style']` setting and explicitly forbade SVG `style` elements.                                                             |
| `typescript:S6268` / BLOCKER vulnerability | `libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-diagram.component.ts:65` | Removed `bypassSecurityTrustHtml`; the component now binds the DOMPurify-sanitized string, so Angular retains its normal `[innerHTML]` sanitization boundary. |

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\feat-chat-mermaid-diagrams-0624908d5480\libs\frontend\chat-ui\src\lib\organisms\mermaid\mermaid-diagram.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-chat-mermaid-diagrams-0624908d5480\libs\frontend\chat-ui\src\lib\organisms\mermaid\mermaid-message-text.component.spec.ts` — extended the existing sanitizer test to assert removal of both scripts and styles while retaining safe SVG text.

Checks:

- PASS — `npx nx typecheck @ptah-extension/chat-ui --parallel=1`
- PASS — `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-message-text.component.spec.ts --coverage=false --maxWorkers=2` (5 tests)

## PR #676 — `feat/streaming-p2-webview-scheduler`

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-streaming-p2-webview-scheduler`

### Failing gate condition

| Condition              | Result before fix                        |
| ---------------------- | ---------------------------------------- |
| New reliability rating | D (actual `4`; gate requires A / `<= 1`) |

Security, maintainability, duplication, and security-hotspot-review conditions were passing. New coverage was not reported as a gate condition.

### Finding and fix

| Rule / severity                   | File:line                                                                      | Fix                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript:S2871` / CRITICAL bug | `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts:67` | Replaced default `.sort()` with an explicit ordinal string comparator, making visible-tab ordering deterministic and removing reliance on default sort behavior. |

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\feat-streaming-p2-webview-scheduler\libs\frontend\chat\src\lib\services\stream-viewport-controller.service.ts`

Checks:

- PASS — `npx nx typecheck @ptah-extension/chat --parallel=1`
- PASS — `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/stream-viewport-controller.service.spec.ts --coverage=false --maxWorkers=2` (2 tests)

## Notes

- `git diff --check` passed in both worktrees.
- SonarCloud will recalculate gate status when each PR's new commit is analyzed; no SonarCloud issue or hotspot state was changed remotely.
