# PR #784 CI and CodeRabbit follow-up

Workspace: `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles`. All source edits are uncommitted.

## CI degradation audit

`libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-usage.parsers.ts:45,91` now uses the audit's justified `optional-capability` suppression on two intentional fallbacks: unreadable optional JSON yields no usage, and malformed optional model groups do not discard valid request totals. The latter is Zod `.catch(undefined)`, not a Promise rejection handler. Verification tail: `libs/backend/auth-providers: 24 ok (baseline 24)`; `degradation-audit: TOTAL 291 unsuppressed site(s)`.

## CI webview e2e

`libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:221-239` asserts the existing tile root `provider-account-tile`, cooldown `tile-cooldown`, retained tile count after Refresh, and still captures both screenshots. A search of the e2e harness found the removed `provider-account-section` selector only in this scenario and no `provider-account-row` references.

Ran once: `npx playwright test --config=playwright.config.ts src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts --workers=1 --reporter=list` from the harness. Tail: `12 failed` (six session-inspector and six dashboard cases); dashboard failure at line 222: expected four tile roots, received zero. The failure snapshot renders the old row UI and says “One row per quota owner,” while current `provider-account-card.component.ts` says “One tile per quota owner.” `fixture-server.ts:27-29,87-110` serves the pre-existing `dist/apps/ptah-extension-webview` bundle; this local bundle is stale. The run therefore cannot validate the source update. Repository `CLAUDE.md` and task rules prohibit running a build here. CI must build the webview before this e2e target.

## CodeRabbit 4320598599 — Antigravity CLI identity

`libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts:77-84` permits CLI fallback only for `cli-store` and `unknown` owners, matching OAuth's identity rule. Verified account owners retain the local unavailable reading if the local server fails. `antigravity-plan-usage.reader.spec.ts:446` adds a regression test showing that a verified account never invokes the CLI. Unit tail: `Test Suites: 1 passed`; `Tests: 19 passed`.

Reply text: Applied the identity guard before the CLI fallback. CLI quota output has no email, so the reader now uses it only for `cli-store` and `unknown` owners; a verified account keeps its local unavailable result. Added a regression test for the mismatched-account path, and the focused reader suite passes (19 tests).

## CodeRabbit 4320598622 — duplicate status text

`libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:902-920` computes the pill once and omits the status notice when its text equals the pill. `plan-tile-view.model.spec.ts:563,575` verifies the absence of duplicate text for the typed Antigravity reason and the generic fallback. Unit tail: `Test Suites: 1 passed`; `Tests: 31 passed`.

Reply text: Updated the tile view model to compare the status notice with the status pill and suppress the notice only when they repeat the same text. The existing distinct notice behavior remains available. Both duplicate cases now have assertions, and the focused tile model suite passes (31 tests).

## CodeRabbit 4320598631 — evidence tracking

`libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:225,809,922` assigns an evidence notice key from source, observation time, and array index, so even duplicate evidence text has a unique key. `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html:156` tracks that key.

Reply text: Changed the evidence loop to track a key provided by the view model instead of display text. The key includes an index to keep it unique even when two evidence records have matching source and timestamp. The focused dashboard model suite passes (31 tests).

## CodeRabbit 4320598643 — UTF-8 comments

Replaced mis-encoded em-dashes in `libs/shared/src/lib/types/plan-limit.types.ts:6-181` and `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:6-15`. Raw-byte verification: shared file has 15 UTF-8 em-dash byte sequences and zero mojibake sequences; reader has five UTF-8 em-dash sequences and zero mojibake sequences.

Reply text: Restored the affected documentation punctuation as UTF-8 em-dashes in both files. A byte-level check found 15 and five valid em-dashes respectively and no remaining mis-encoded em-dash sequences in either file.

## Diagnostics and decisions

Scoped `ptah_get_diagnostics` found no errors in the requested changed files. It reported seven errors in unchanged sibling files (`mock-rpc-service.ts`, `skill-selection-card.spec.ts`, and `capability-id-codec.ts`); these are outside this assignment.

- Decision: retain the parser's optional-data fallbacks with exact audit suppressions. Alternative: propagate errors and change the reader's behavior. Evidence: parser comments and Zod schema explicitly treat malformed optional groups as non-fatal; audit returned to baseline. Reversible: yes.
- Decision: use existing tile test IDs in e2e. Alternative: add duplicate IDs. Evidence: `provider-account-tile.component.html:8,173`. Reversible: yes.
- Decision: stop at the requested single e2e run and report the stale-bundle limitation. Alternative: rebuild the webview and rerun. Evidence: failure snapshot and fixture-server build path; repository and task verification rules disallow a build. Reversible: yes.
