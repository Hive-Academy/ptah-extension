# Code logic review — TASK_2026_711_3377

Combined verdict of two independent reviews. Full evidence: `code-logic-review-a.md` (Part A) and
`code-logic-review-b.md` (Part B + Batch C, with the security review).

| Part | Implementer family | Review family | Rounds | Final score | Final verdict |
| --- | --- | --- | --- | --- | --- |
| A — lane policy and per-CLI delivery | codex | grok | initial + 2 revise | 9/10 | APPROVED |
| B — browser `file://` (security) | grok | codex | initial + 2 revise + 1 bounded correction | 7/10 | APPROVED WITH FIXES |
| C — docs, parent prompt, sync spec | grok | codex | with Part B | — | covered by Part B verdict |

The bounded correction after the Part B revise cap (child-session `Fetch.requestPaused` routing,
`chrome-launcher-browser-capabilities.ts:733-778`) was made by the orchestrator (Claude family) and
reviewed by codex: RESOLVED.

## Resolved (summary)

- Part A: pi follow-up after file removal; codex argv fallback channel order; pi resume without a
  file; cursor resume preambles; file-store claim kept until delete succeeds; pi text fallback when
  both writes fail; codex delivered-policy bookkeeping after the argv strip.
- Part B: check/open race (served from an fd bound by dev/ino to the checked file, via
  `Fetch.fulfillRequest`); popup and webview denial; follow-on non-file schemes on every read path
  incl. status and network; roots reconfigure race; `..preview.html` false positive; `?`/`#`/`@`/`:`
  in the authority; FIFO/device rejected before `open`; attached frame/worker sessions guarded and
  resumed with `Runtime.runIfWaitingForDebugger`; child-session request routing; sync spec covers all
  twelve tool names and unconditional messaging claims.

## Open (reported, not fixed — revise cap reached)

1. Moderate, fails closed: `chrome-launcher-browser-capabilities.ts:848-851,871-883` does not catch a
   rejected `Runtime.runIfWaitingForDebugger`. The attached target then stays paused and is not
   closed. No file content escapes. Follow-up: catch the rejection and close the target.
2. Residual (documented in `batch-b-report.md` § Revise round 1): an in-place write to the same
   in-root inode between `fstat` and `read` changes bytes of an allowed file. Not a path escape.
3. Static review only for both parts; no live Chrome or Electron session exercised the guard.
