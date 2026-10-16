## Changes

- S-1: `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:61,336,512` records whether the root tab was streaming at send time and skips its first subsequent terminal pulse before considering a no-proposal request complete.
- M-1: `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:586` says the Tribunal request was cancelled and asks the user to ask again after a successful automatic Decline.
- M-2: `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:83,225,483,568-611` retains the failed question id, blocks typed and voice sends, retries Decline with at most three automatic attempts, clears the block on success or question disappearance, and cancels retry on destroy or exit. Voice `sendTranscript` already calls `sendCommand` at line 218.

## Specs added

- `keeps a Tribunal request through the terminal pulse of a turn already running at send` (`command-center-page.controller.spec.ts:675`).
- `blocks text and voice sends after a failed Decline until an explicit retry succeeds` (`command-center-page.controller.spec.ts:745`; replaces the prior signal-re-read retry spec).
- `clears a failed Decline and its retry timer on exit` (`command-center-page.controller.spec.ts:778`).
- Existing `restores ordinary Confirm after a request turn ends without a proposal` remains passing.

## Checks

- `npx jest -c libs/frontend/command-center/jest.config.ts libs/frontend/command-center/src/lib/components --coverage=false --maxWorkers=2 2>&1 | tail -40`: PASS, 7 suites and 71 tests.
- `npx nx test command-center --parallel=1 2>&1 | tail -30`: PASS, 32 suites and 229 tests.
- `npx nx typecheck command-center --parallel=1 2>&1 | tail -20`: PASS, target completed (no test count).
- `npx nx lint command-center --parallel=1 2>&1 | tail -20`: PASS, all files pass linting (no test count).
- `ptah_get_diagnostics` after edits: no diagnostics in the two edited files; it lists 17 sibling diagnostics outside this assignment.
- On this PowerShell worktree, the requested output tails were implemented with `Select-Object -Last N`; exit codes were captured separately.

## Decisions

- S-1: Detect an in-flight turn using the marked root tab's `status === 'streaming'`, then skip the next root-tab pulse. Options were `lastSeq + 1`, `streamingTabIds()`, or tab status plus a one-pulse skip. `TabManagerService` sets status to streaming on send (`markStreaming` and `applyNewConversationStreaming`) and emits a globally numbered pulse on turn completion; the one-pulse skip works even when another tab's pulse interleaves. The integration harness exposes tab status but not `streamingTabIds()`. Reversible: yes.
- M-2: Use two delayed automatic retries (three attempts total), plus a public immediate `retryInvalidDecline()` method. The old effect depended on a signal change or a new request object to retry. A timer provides bounded progress without another signal emission; destroy and exit cancel it. Reversible: yes.

## Not done

- No page retry button was added; automatic retries provide the requested retry path, and the public retry method is available to the page. A question still undeclined after all three attempts blocks sends until retry is invoked or the question disappears or the page exits.
- Sibling diagnostics and other review findings outside S-1, M-1 and M-2 were not changed.
