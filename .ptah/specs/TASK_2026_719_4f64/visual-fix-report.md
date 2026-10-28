# Visual fix report: TASK_2026_719_4f64, D1 and D3

**Verdict**: D1 and D3 are fixed. Scoped tsc, eslint and the molecules Jest run pass. A visual re-check in Electron is still needed.

## Changes

All paths are under `libs/frontend/chat/src/lib/components/molecules/`.

- `agent-card/agent-card-header.component.ts:41-62`: moved the lane account resolution out of the component into an exported pure function, `laneAccountText(profileId, injector)`. It returns "Account: <label>", "Default", "Removed account", or `null`. `null` covers a non-Claude lane, a corrupt binding (`undefined`) and a list that has not loaded. The logic is unchanged. `:233-235`: the card header's `accountText` now calls this function, so the card badge works as before.
- `agent-card/agent-card.component.ts:15,26-30`: imports `Injector` and `laneAccountText`. `:79`: the flat `ptah-execution-header` now gets `[account]="laneAccount()"`. `:340-344`: `laneAccount` is a `computed` that uses the same function, so there is only one copy of the logic.
- `execution-header/execution-header.component.ts:110-111`: new input `account = input<string | null>(null)`. `:54-62`: when `account` is set, the header row shows a badge between the meta text and the Details toggle. The badge uses the same classes as the card badge (`badge badge-sm badge-ghost text-[9px] text-base-content-muted max-w-[10rem] min-w-0 flex-shrink-0`), has `data-testid="lane-account"` and `[title]` set to the full text, and puts the text in an inner `span.truncate`. When `account` is `null`, nothing renders. The text is bound with interpolation; there is no `[innerHTML]`.
- `session-list-row/session-list-row.component.ts:244`: the account label class changed from `min-w-0 truncate` to `min-w-0 max-w-[10rem] truncate`. The label is a flex item, so the cap applies. The title binding was already there.

## Specs

- `execution-header/execution-header.component.spec.ts`: the existing test now also checks that there is no badge when `account` is not set. A new describe block renders the real `AgentCardComponent` with `presentation="flat"`. It fakes the account state, `AgentMonitorStore` (`tick`) and `ClaudeRpcService`. It checks that:
  - a named account shows "Account: <long label>" with the same text in `title`, the `max-w-[10rem]` and `badge` classes and an inner `.truncate`; no `ptah-agent-card-header` renders; and the profile ID never appears
  - an ambient lane shows "Default"
  - "Removed account" shows when the profile is gone, and the profile ID never appears
  - nothing shows for a `codex` lane or for an `undefined` (corrupt) binding
- `session-list-row/session-list-row.component.spec.ts:574-584`: a long label has `max-w-[10rem]`, `truncate` and `min-w-0`, and `title="Account: <label>"`.

## Selectors for the visual re-check

- Flat lane (Electron canvas lane view and agents panel): `ptah-execution-header [data-test="execution-header-row"] [data-testid="lane-account"]`. The badge sits between `[data-test="execution-header-meta"]` and `[data-test="execution-header-details"]`. The full text is in its `title`; the visible text is in its child `span.truncate`.
- Card lane (unchanged): `ptah-agent-card-header [data-testid="lane-account"]`.
- Session row: `[data-testid="session-row-meta"] [data-testid="session-row-account"]`, now capped at 10rem.

## Checks

- `npx tsc --noEmit -p libs/frontend/chat/tsconfig.lib.json`: no errors, no output.
- `npx eslint` on the 6 files: 1 error and 3 warnings, none from this change.
  - The error is `session-list-row.component.spec.ts:17`, a static `@ptah-extension/shared` import that triggers module boundaries. This is the known D30 error.
  - The 3 warnings are non-null assertions at `execution-header.component.spec.ts:37-39`, in the existing test.
  - The new `import type` from `@ptah-extension/shared` in the execution-header spec is not flagged.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules --maxWorkers=2`: Test Suites 36 passed of 36; Tests 505 passed of 505.
- Not run, as the brief asked: verify, build, serve, and the Electron visual re-check.

## Decisions

- **How the flat header gets the account text.** Options: pass the resolved text as an input, or extract a shared badge component. I passed the text as an input. The logic lives once, in `laneAccountText`, which both the card header and the agent card call. The execution header stays presentational: it takes a string and never sees a profile ID. This is the smallest change and it is easy to reverse.
- **Badge position.** I put it in the always-visible header row, not in the collapsed Details list, so it can be seen without opening Details, which matches the lane badge in card presentation. This is easy to reverse.
- **Where the D1 tests live.** The flat-surface tests are in the execution-header spec and mount the real `AgentCardComponent`. The file limit allowed no new agent-card spec, and mounting the real card checks the whole path from the lane binding to the rendered badge.

## Notes

- I did not load the `angular-frontend-patterns` skill. The change follows the patterns already in these files: standalone components, OnPush, `input()`, `computed()`, and no `[innerHTML]`.
- "Claude lanes only" relies on the store, which sets `accountProfileId` only for Claude lanes (batch 10). The function itself returns `null` for `undefined`, so a non-Claude lane shows nothing.
- No git state was changed.
