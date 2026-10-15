# R9d — Rail lane ownership

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`: filter CLI rows by exact `parentSessionId === sessionId`. The same filtered rows drive counts and overflow.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`: source card agents from `agentsOwnedBySession` instead of tolerant `agentsForSession`. Existing CLI permission callouts already used strict ownership.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts`: cover unresolved and foreign owners across rows, counts, overflow, and the other session.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`: cover Rail card rows, counts, `+N`, the Now line, and visibility on the owning card.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`: assert an owned CLI lane appears once while unresolved and foreign lanes remain absent.

`canvas-lane-tabs.component.ts` already filters CLI, subagent, and background tabs through strict `ownedBySession`; no production change was needed there. The card's Now text comes from its own session summary (`summary().content.text`), independently of CLI rows; the regression case checks that binding while foreign and unresolved lanes are present.

## Named cases and checks

- Unowned CLI agent absent from other cards (rows, counts, `+N`, Now): covered in `compact-lane-rows.spec.ts` and `compact-session-card.component.spec.ts`. `R9d-1`: `Test Suites: 1 passed, 1 total`; `Tests: 7 passed, 7 total`. `R9d-2`: `Test Suites: 1 passed, 1 total`; `Tests: 44 passed, 44 total`.
- Owned agent appears once: covered on the card and in tabs; both card and tab spec passed.
- Strict lane tabs remain: covered in `canvas-lane-tabs.component.spec.ts`. `R9d-3`: `Test Suites: 1 passed, 1 total`; `Tests: 6 passed, 6 total`.

Commands (all through `.ptah/tmp/check-run.mjs`, one at a time):

```text
node .ptah/tmp/check-run.mjs R9d-1 -- npx nx test @ptah-extension/chat --testFile=compact-lane-rows.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs R9d-2 -- npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs R9d-3 -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
```

Scoped `ptah_get_diagnostics` was attempted after edits, but its TypeScript compiler check timed out twice after 45 seconds and reported all five checked files as unchecked. Team-leader owns typecheck/lint per batch rules.

## Decisions

- Strict equality is applied in the scoped card lane data. The main chat panel's tolerant monitor path remains as designed.
- `knownSessionId` in `chat-streaming/src/lib/session-scope.ts` converts empty, null, and undefined owner IDs to undefined. `AgentMonitorStore.onAgentSpawned` applies it to the spawn owner and the completion path can fill the owner later. A CLI agent whose events never provide an owner remains unowned; diagnosing those backend events belongs to `TASK_2026_633_21fa`.

## Not done

- No backend event changes or out-of-scope files were edited.
- Full suites, typecheck, and lint are reserved for the team-leader checks.

## Fix round

- **Scope finding → change:** The first implementation made every compact card strict. The canvas Rail card supplies `SESSION_CARD_ACTIONS` but no `SESSION_CONTEXT`; canvas tile cards can supply both. The card now uses strict `agentsOwnedBySession` and strict lane filtering when either scoped host token is present. An unscoped main-panel card uses tolerant `agentsForSession` and tolerant lane filtering. `buildLaneSummary` keeps its original four-argument behavior by default and documents the optional strict flag. No host file needed an edit.
- **Mock finding → change:** `agentsForSession` in the card spec now mirrors `agentVisibleInSession`. A scoped Rail case supplies `SESSION_CARD_ACTIONS` and requires unresolved/foreign agents to be absent; an unscoped main-panel case requires an unresolved agent to remain visible. Reverting the card's strict branch now fails the scoped case.
- **Now-line finding → change:** Removed the self-comparing Now binding assertion. Unresolved and foreign test agents now have distinct rendered `displayName` values, and the scoped card asserts both names are absent from rendered text. The Now line is session-summary text and has no agent input.
- **Result:** `R9d-fix-1` card spec: `Test Suites: 1 passed, 1 total`; `Tests: 45 passed, 45 total`. `R9d-fix-2` row spec: `Test Suites: 1 passed, 1 total`; `Tests: 8 passed, 8 total`. `R9d-fix-3` canvas tab spec: `Test Suites: 1 passed, 1 total`; `Tests: 6 passed, 6 total`. Each ran through `.ptah/tmp/check-run.mjs`, one at a time.

The earlier Decisions sentence describing all card lane data as strict is superseded by this fix round: strictness is limited to scoped canvas hosts.
