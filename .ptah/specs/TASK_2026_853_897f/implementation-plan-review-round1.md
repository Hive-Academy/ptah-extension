Verdict: REVISE

## Finding status

1. **RESOLVED.** External-plugin MCP defaults to workspace scope and offers explicit global scope (`implementation-plan.md:200-201,741-772`); installed rows use the planned `mcpDirectory:makeGlobal` RPC (`:745-748,769-771`), with the consent control in F-D4 (`:938-954`). The RPC is a planned addition, not an existing method (`mcp-directory-rpc.handlers.ts:312-362`). The service path is real (`libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:152-205`). The separate F-D4 completion defect is below.
2. **RESOLVED.** Exit 0 means tracked, exit 1 plus Git's no-match message means eligible untracked, and other failures keep/disown the copy (`implementation-plan.md:206,609-621`). An unchanged, manifest-owned untracked positive fixture must be removed (`:631-639`).
3. **RESOLVED.** V2 root metadata has an explicit Ptah owner marker and per-file hashes; `verifyOwnedRoot` rejects missing, edited, extra, or linked files (`implementation-plan.md:207,661-672`). D-6 retires rather than deletes unproven v1 roots, regardless of a matching clone sidecar (`:821-828,886-890`).
4. **RESOLVED.** Make global stages and validates the copy, writes metadata, renames and propagates before removing the workspace root (`implementation-plan.md:679-699`). Failure and retry rules cover metadata, propagation, rollback, and final removal, with corresponding fixtures (`:703-730`).
5. **RESOLVED.** Decisions #20/#21 are closed (`implementation-plan.md:211-220`); C-3 is a no-production-change, effective-set/frontmatter regression spec (`:531-555`), with a file-disjoint senior-tester owner (`:1077-1079,1102`). The revised targets appear in the inputs and risk section (`:36-45,1154`). The six rows and lookup exist at `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts:53-73,101-119`; the browser list contains 11 names (`:29-42`).
6. **RESOLVED.** D-2 names `workspace-target.ts` and `targets/mcp/mcp-facet-planner.ts` (`implementation-plan.md:642-647`), and D-4 names the real external-plugin service (`:795-800`). The handoff assigns shared contracts to D-4, the loader to D-3, and the inventory store to F-D1 (`:1085-1108`).
7. **RESOLVED.** D-6 persists per-path `removedPaths`/`keptPaths`/`failedPaths`, derives deduplicated counts from the ledger, and carries successful removals across retries (`implementation-plan.md:835-861`). It specifies the two-workspace notice-count and mixed-fragment fixtures (`:878-884`).

## New findings

- **Serious — settled F-D4 UI requirements remain optional.** `implementation-plan.md:956-969` calls the consent copy replacement “recommended” and “pending ... sign-off,” and specifies only a generic Electron visual check; the handoff repeats the approval gate (`:1124-1127`) and risk table (`:1161`). Decision #25 (`decisions.md:29`) already settles that the false copy is corrected and requires before/after Electron screenshots of the dialog in dark and light themes. The current false copy is in `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:289-294`; the backend does register declared servers (`libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:149-153,184-199`). **Fix:** make the copy correction an unconditional F-D4 task, require the four before/after dark/light Electron screenshots as completion evidence, and remove the new designer/orchestrator sign-off gate.

## Lane-introduced constraints

- F-D4's proposed extra designer/orchestrator sign-off (`implementation-plan.md:960,1124-1127`) conflicts with settled decision #25; see the Serious finding.
- Electron-only migration timing remains the accepted decision #23 and is now stated for VS Code/CLI (`implementation-plan.md:204-205,1128-1129`). The fixed four-PR order and no reverse conversion were outside this scoped re-review.
- No CLI review-skill discovery/invocation mechanism was exposed in this lane; the available Ptah harness skill search is a plugin inventory, not a CLI skill loader. This was a read-only plan review; no tests, builds, or Git writes were run.
