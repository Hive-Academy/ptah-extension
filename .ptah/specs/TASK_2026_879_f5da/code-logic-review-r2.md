# Code logic review, pass 2 — TASK_2026_879_f5da

**Score: 5/10. Verdict: REVISE.** Two prior findings are fixed; the classifier is partly fixed; file authorization remains incomplete when inode numbers are unusable. Normal flows now have concrete fixes, but a security boundary and prompt routing still fail. Confidence: medium; source and changed specs reviewed, no tests run.

## Prior findings

| Finding | Status | Evidence and impact |
| --- | --- | --- |
| Critical: replacement race | **Partly fixed** | Both viewers open once, verify and read through that handle (`libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:129-140,205-224`). `finally` attempts close on every path and errors remain fixed text (`:142-146,225-229,273-302`). But when either inode is zero, `verifyOpenedFile` equates size, mtime and birthtime with identity (`:348-359`). On Windows or another zero-inode filesystem, replacing an in-root path with an outside file of matching metadata between open and verification can pass the check and return outside content. The added test swaps before open, not during verification (`file-view-rpc.handlers.spec.ts:131-164`). Require trustworthy opened-file identity or refuse when unavailable. |
| Major: detached window focus | **Fixed** | ChatView increments focus on pointer/focus events (`libs/frontend/chat/src/lib/components/templates/display-sidebar-wiring.ts:60-71`); Command Center does likewise (`libs/frontend/command-center/src/lib/components/command-center-page.component.ts:38-43,51-55,416-424`). Sync selects either focused source and falls back on tab close or unbind (`libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:148-175`). The spec switches chat → Command Center → chat, then closes chat (`display-window-sync.service.spec.ts:393-418`). |
| Major: visual classification | **Partly fixed** | The regex recognizes the earlier chart/plot/diagram/infographic examples (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:46-47`; positives at `ptah-ui-hint.spec.ts:112-120`). Its verb + 60 characters + visual noun arm also misclassifies “show me the chart component source” and “create a chart component” as reports (`ptah-ui-hint.ts:46-47,85-91`). New negatives omit those cases (`ptah-ui-hint.spec.ts:122-128`). Report guidance then asks for HTML instead of the requested code answer (`ptah-ui-hint.ts:40-44,60-73`). Match visual output intent more narrowly and add negatives. |
| Minor: no root fallback | **Fixed** | Relative supported files require a workspace root or document base before Display (`libs/frontend/chat/src/lib/services/file-link-router.service.ts:104-124`). Otherwise existing review navigation receives the link (`:140-156`), covered by `file-link-router.service.spec.ts:123-131`. Absolute paths still use backend root authorization. |

## New findings

No separate new defect found in the skill description, Command Center spec mock, or Electron markdown-link e2e change. The classifier false positives above were introduced by the fix and are counted there. The e2e mock supplies markdown content (`apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts:100-118`); the new assertion checks the selected Display tab, rendered content and unchanged URL (`:245-264`).

## Five logic questions

1. **Silent failure:** zero-inode metadata matching can authorize a different handle (`file-view-rpc.handlers.ts:348-359`).
2. **Unexpected action:** “show me the chart component source” triggers HTML report guidance (`ptah-ui-hint.ts:46-47,85-91`).
3. **Wrong input answer:** matching size and timestamps can make either viewer return an outside target's bytes (`file-view-rpc.handlers.ts:133-138,210-221,354-359`).
4. **Dependency failure:** read or close rejection becomes fixed `unreadable` output (`file-view-rpc.handlers.ts:139-146,222-229`); unbind selects another source or no tab (`display-window-sync.service.ts:168-175`).
5. **Unspecified case:** define policy for filesystems whose `stat` cannot identify the opened object (`file-view-rpc.handlers.ts:354-359`).

## Verification and decisions

Reviewed `git diff e02299b88..HEAD`, task context, first review, fix reports, changed source and specs. `ptah_get_diagnostics` left four source files unchecked after a 45-second compiler timeout. Per instruction, no npm, nx, Jest, Node or e2e was run. The Windows scenario is source-level reasoning, not an executed reproduction. Decision: treat zero-inode metadata as insufficient identity for authorization; requiring stronger verification or refusing is reversible. The 5/10 score is above the 3–4 band because both focus and missing-root fixes cover their reported flows, and below 7–8 because the authorization boundary and classifier remain incomplete.
