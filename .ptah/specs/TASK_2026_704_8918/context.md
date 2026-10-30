# Context - TASK_2026_704_8918

## User request (2026-10-19)

"while we were revewing the console kept showing this error can you file a task for it or if its
easy ask codex to fix in the current pr ?" (screenshot of the Electron DevTools console during the
TASK_2026_699_833e visual review).

## Observed

Repeated in the Electron renderer console (single-session layout, session inspector open,
Plan Limits cards visible):

```
NG0956: The configured tracking expression (track by identity) caused re-creation of the entire
collection of size 1. This is an expensive operation requiring destruction and subsequent creation
of DOM nodes, directives, components etc. Please review the "track expression" and make sure that
it uniquely identifies items in a collection. (_debug_node-chunk.mjs:14712)
```

## Triage so far (codex, read-only)

Full triage: `.claude-worktrees/inspector-side-dock/.ptah/specs/TASK_2026_699_833e/console-errors-triage.md`
section 1 (moves into the PR of TASK_2026_699_833e).

- No identity-tracked object loop found in the chat view, inspector, plan-limit tiles or ptah-ui
  blocks: the inspected `@for` loops track strings, numbers or stable keys.
- The emitter is unknown. A stackless console line does not name the template.

## Next step

1. Reproduce in the Electron dev app with DevTools open, expand the NG0956 warning and capture the
   stack (or set a breakpoint on `console.warn`) to name the emitting component/template.
2. Change its `track` to a stable key (id) and add a spec if the list is computed.
3. Confirm whether it reproduces on `main`.

The paired RPC timeout (`agent:getLanePlanLimits`) was fixed in the TASK_2026_699_833e PR
(LANE_PLAN_LIMITS_TIMEOUT_MS 10 s → 15 s).

## Triage 2026-10-30 (premise audit)

Verdict: UNSURE (lane grok; Claude agrees). No status change.

- The warning was observed in the single-session layout, which #777 (92c289d2e, 2026-10-20) removed the day after this report.
- The only NG0956 fix on main is 312b54f36 (2026-10-17, canvas lane view), before this report.
- Note: this folder also holds `code-logic-review.md` / `code-logic-rereview.md` for an unrelated RPC-timeout change.

Next step: check the Electron DevTools console on current main. If NG0956 no longer appears, cancel as obsolete.
