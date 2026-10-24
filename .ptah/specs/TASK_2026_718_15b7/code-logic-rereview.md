# Code logic re-review — TASK_2026_718_15b7

Reviewer family: codex
Implementer family: codex (same family by user pin — weaker evidence)

Verdict: **APPROVED**

## Round-2 findings

1. **Resolved: yes.** `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:764`: group-wide info/warn suppression is removed. The advisory test installs a local debug spy at line 842, asserts one call and the expected message/session payload at line 859, and restores in `finally` at line 865. The safety-timeout test similarly asserts one warning at line 878 and restores at line 883. These match the actual diagnostics in `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:690` and `:203`. Existing behavioral assertions remain intact.
2. **Resolved: yes.** `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts:429`: the transport-failure spy now encloses setup, settling, and assertions in `try/finally`, with restoration at line 448. Lines 442–445 assert exactly one warning with the expected message and timeout error, matching `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts:602` and the rejection configured at spec line 427. Both original UI assertions remain intact.

## New findings

None. No new defect identified within the fix-round scope.

## Other requested checks

- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts:569`: `input.click()` faithfully exercises the model search opening interaction. The popover supplies `[openOnFocus]="false"` at `main-agent-reassign-popover.component.ts:149`, while `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts:107` binds click to `openPanel()`. The driver RPC assertion at spec line 566 and catalogue-option assertion at line 571 are unchanged; this remains a catalogue integration test.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.ts:293`: `ngOnDestroy` sets the flag before the pending save resumes. The guard at line 334 consequently skips render-callback registration against the destroyed injector. Save completion still announces its result at line 310, preserving the toast that must outlive the popover. The existing spec at `cursor-credential-popover.component.spec.ts:177` destroys the fixture before resolving the save and checks that toast. No lifecycle regression identified in this simplification.
- `libs/frontend/chat/src/test-setup.ts:13`: the observer stub includes `scrollMargin`; no new defect identified in this addition.

Reviewed the supplied prior review and five-file diff, with targeted current-source reads. Earlier lane edits present in the HEAD-relative diff were not treated as new fix-round changes. No source/spec edits, git commands, test runs, or heavy commands were performed. The reported three passing suites / 190 tests with no console blocks are orchestrator evidence, not independently reproduced here.
