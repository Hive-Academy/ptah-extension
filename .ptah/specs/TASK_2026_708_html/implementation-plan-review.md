# Implementation plan review — TASK_2026_708_html

Reviewer: orchestrator (in-process, Claude). Author: codex lane (CLI). Opposite-side review.

## Verdict: APPROVED with amendments

The plan keeps every user decision (scripts with no network, opaque origin, minimal Zod bridge,
Electron first, `ptah-ui` unchanged), has testable acceptance criteria, a preserve list, and
file-disjoint batches with scoped checks.

## Amendments (binding for the batches)

1. **Batch order.** Batch 1 (spike) needs the candidate protocol, which the plan puts in batch 4.
   Merge batch 4 (protocol + response CSP + shell `frame-src ptah-artifact:`) into batch 1, so
   the spike runs against the real protocol. Containment pure-logic checks (CSP string, id→file
   mapping, sandbox attribute constants) go in Jest specs.
2. **e2e run is user-gated.** Project rule: no `e2e` target unless the user asks. The Electron
   Playwright containment spec is written in batch 1; it runs only after the user permits one
   named-spec run.
3. **Contract location.** Confirm `libs/shared/src/mcp-apps-contracts/` exists and is exported;
   otherwise use `libs/shared/src/lib/types/artifact.types.ts` + a schema file next to it, and
   export through `libs/shared/src/index.ts`.
4. **Agent self-check (component 6).** The browser namespace admits only HTTP(S). Do not add a
   local HTTP preview server in this task. Guidance tells the agent to self-check only when a
   browser tool can reach the page, and otherwise to say no visual check ran. A private headless
   preview (t3code model) is a follow-up.
5. **Generated skill copy.** Before batch 10 edits
   `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/...`, check whether it is
   generated from `.claude/skills/`; edit only the source if it is.

## Lane-introduced constraints accepted

2 MiB cap, single `index.html`, immutable revisions, host-generated ids, 160–1600 px height
clamp, one live frame per active viewer, managed-copy storage, event + scoped list RPC. All are
reversible and match the security intent.
