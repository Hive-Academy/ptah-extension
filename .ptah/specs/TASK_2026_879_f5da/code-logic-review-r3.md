# Code logic review, pass 3 — PR #943 (`a4cd74c47`)

**Score: 6/10. Verdict: REVISE.** File authorization now fails closed and detached focus is preserved. A common visual request still routes to compact guidance. This is above pass 2's 5/10 because the security gap is closed, and below 7–8 because a major routing requirement remains unmet.

## Requested checks

1. **File identity — fixed.** Both RPC methods verify before reading the opened handle (`libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:131-145,212-235`). The helper requires safe, positive `ino` and usable `dev` on both sides, then compares both (`:363-376`); unavailable, zero or mismatched identity never reaches a read. Each inner `finally` closes the handle on early refusal; exceptions, including close failure, return fixed `unreadable` output (`:143-150,233-240,283-313`). The new matrix covers both methods and zero/unavailable identity (`file-view-rpc.handlers.spec.ts:167-213`), though it does not directly assert close. On Windows, a symlink swap may produce `unreadable` rather than `outside-roots` because `realpath` or `stat` throws (`file-view-rpc.handlers.ts:364-368`). This is acceptable for authorization: the file is refused, and the fixed error leaks no path. The reason code is less specific, not an access defect.
2. **Report routing — partly fixed.** The added chart-component/source and graph-bug negatives classify as compact (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts:126-133`), and listed positive examples remain reports (`:113-124,157-168`). The Electron-only call-site gate is unchanged by this diff; `routeSurfaceRequest` still selects HTML artifact guidance for reports and compact guidance otherwise (`ptah-ui-hint.ts:71-84,95-102`). A major false negative remains below.
3. **Detached focus — fixed.** The reverse loop returns the last bound source with a live tab, skipping the excluded one (`libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:182-190`). Focus still moves a source to the end and selects it; tab loss and unbind still choose the fallback (`:148-175`). Selection order matches the former `findLast` behavior.
4. **Other changed lines.** Binary caps use the greater of policy-checked and open-handle size before MIME checks (`file-view-rpc.handlers.ts:219-232`). The Command Center spec adds `config` to its Electron mock (`libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:1424-1433`). No separate defect found there.

## Finding

### Major — Visual requests about code work are suppressed

`hasCodeNearVisualNoun` treats `module`, `test`, `file`, and `source` within four tokens of a chart or diagram noun as a code request (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:55-63`). “Make a diagram of module dependencies,” “plot a chart of test results,” and “show a graph of files changed” match the visual regex (`:46-47`) but are cleared by that filter (`:99-102`). None matches `REPORT_REQUEST`; each gets compact guidance and no HTML artifact/skill instruction (`:71-84,90-93`). These are visual representations of work under `context.md` item 6. The new positives omit code-domain nouns (`ptah-ui-hint.spec.ts:113-124`). Narrow the exclusion to requests for code or source inspection, and add these positives beside the component/source negatives.

## Five logic questions

1. **Silent failure:** “make a diagram of module dependencies” returns compact without an error (`ptah-ui-hint.ts:58-63,95-102`).
2. **Unexpected action:** a work-visual request gets ptah-ui guidance rather than HTML guidance (`ptah-ui-hint.ts:40-44,71-84`).
3. **Wrong input answer:** “plot a chart of test results” is suppressed by nearby `test` (`ptah-ui-hint.ts:55-63,99-102`).
4. **Dependency failure:** verification or close exceptions return generic `unreadable` after a close attempt (`file-view-rpc.handlers.ts:143-150,233-240`); no bytes escape.
5. **Unspecified case:** a codebase architecture diagram is visual under context item 6, but the classifier treats `module` as a code-output signal (`ptah-ui-hint.ts:55-63`).

## Verification and decisions

Reviewed `git diff 1c1c851c9..HEAD`, task context/plan, both prior reviews, fix report, changed logic and pertinent specs. `ptah_get_diagnostics` timed out after 45 seconds with three files unchecked. No npm, nx, Jest, Node or e2e was run as instructed; classifier examples are source-level evaluation. No skill-loading tool was available to this lane. **Decision:** the Windows `unreadable` swap outcome is acceptable because it denies access with a fixed message; a more specific reason is optional and reversible. **Decision:** visualizations *of* code work are reports under context item 6; this interpretation is reversible.
