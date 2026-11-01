# PR #879 migration follow-up logic review — `4e1d36f44`

## Verdict

**REVISE — 6/10.** The commit fixes the six new defects in the `d990147cc` review, but only narrows partial finding 3. A concurrent global reinstall can still be deleted after the migration's last registry read. This remaining data-loss path warrants another pass; the six resolved failure paths put the change above the 3–4 band, while that path keeps it below the 7–8 band.

Review scope: commit `4e1d36f44`, the prior review, decision #85, the migration service and its specs, and the global install boundary. No tests, builds, or verify were run, as requested. Scoped `ptah_get_diagnostics` returned unavailable after its TypeScript check exceeded 45 seconds; both changed TypeScript files remain unchecked by that tool.

## Status of prior findings

| Prior item | Status | Evidence |
| --- | --- | --- |
| Partial 3 — deletion after a root becomes global | **PARTIAL** | `libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.service.ts:838-850` re-reads the registry after proof, closing the earlier whole-pass window. The registry check and `fs.rm` remain separate operations. The installer writes files and global metadata before it clears the mark (`libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts:324-357`). If the migration proves the old root, the installer writes its replacement, and the migration reads the still-retired mark before deleting, it can remove the new global install. The test at `install-scope-migration.service.spec.ts:897-938` clears the mark before the second root's final read; it does not cover this ordering. |
| New defect 1 — corrupt intent retires skills before failure | **FIXED** | `install-scope-migration.service.ts:546-549` reads retired MCP intents and discovers roots before writing the registry; a thrown intent read reaches `runOnce`'s failure return at `:487-495` without a registry or ledger write. The regression case is at `install-scope-migration.service.spec.ts:1195-1217`. |
| New defect 2 — unreadable metadata blocks unrelated roots | **FIXED** | `install-scope-migration.service.ts:611-631` logs a per-root metadata read failure and continues discovery. Decision #85 explicitly chooses to leave that unknown-scope root active and outside the ledger. The mixed-root case is at `install-scope-migration.service.spec.ts:940-969`. |
| New defect 3 — malformed live registry drops ledger work | **FIXED** | `install-scope-migration.service.ts:650-680` returns `null` for malformed, unreadable, or unexpectedly missing registry data; `:745-750` and `:895-907` hold root and clone work, and `:1220-1242` prevents completion. The malformed and missing cases are at `install-scope-migration.service.spec.ts:730-803`. |
| New defect 4 — failed clone row never resolves after unretire | **FIXED** | `install-scope-migration.service.ts:787-822` moves user-layer clone failures to `keptPaths` and clears them without touching the clone; `:751-758` persists the release. The case is at `install-scope-migration.service.spec.ts:805-845`. |
| New defect 5 — decided items still counted retired | **FIXED** | `install-scope-migration.service.ts:751-761` applies live-state correction before skipping removed or `onDisk` roots; `:804-815` preserves their recorded evidence and sets `retired: false`. The case is at `install-scope-migration.service.spec.ts:848-895`. |
| New defect 6 — deletion specs use an unexplained synthetic fixture | **FIXED** | `install-scope-migration.service.spec.ts:137-146,396-451,515-525` explicitly names the synthetic workspace-scoped v2 proof fixture and adds a realistic v1 legacy plus v2 global case. |

## New Major or higher defects introduced by this commit

None found. The remaining deletion race is the prior partial finding 3, not a new finding.

## Five logic questions

1. **Silent failure:** The new hold paths return `incomplete` when registry state is untrustworthy (`install-scope-migration.service.ts:748-750,906-907,1232-1242`); no new silent success was found in the changed paths.
2. **Unexpected user action:** A global reinstall concurrent with proof and deletion can still lose its newly written root (`install-scope-migration.service.ts:838-850`; `skills-sh-source-root.service.ts:324-357`).
3. **Wrong input answer:** A malformed or missing live registry now holds pending items instead of treating them as user opt-in (`install-scope-migration.service.ts:650-680`). No new wrong-answer input was found in this commit.
4. **Dependency failure:** MCP intent read failure stops before registry mutation (`install-scope-migration.service.ts:546-549`); one metadata read failure is isolated (`:611-623`). The scoped diagnostics check was unavailable, so CI remains the verification source.
5. **Missing requirement:** Migration deletion and global reinstall still need a shared per-root ownership or exclusion rule across proof, registry update, and removal (`install-scope-migration.service.ts:838-850`; `skills-sh-source-root.service.ts:324-357`).

## Decisions

- **Verdict on partial 3:** Options were to treat the final registry read as sufficient or require an atomic exclusion around the check and deletion. The second choice follows from the install order and the remaining await between read and removal; it is reversible by adding a shared per-root lock or equivalent ownership revalidation. Evidence: `install-scope-migration.service.ts:838-850`; `skills-sh-source-root.service.ts:324-357`.
- **Scope of disputed partial 1:** Per the handoff and decision #85, the v2 MCP bucket without config is excluded from this follow-up review because only Ptah writes the new unreleased v2 format and it always writes config. No status or finding here rests on that issue.
- **Verification:** Source review and scoped diagnostics only; no tests, builds, or verify were run under the stated CI gate. Skill discovery/loading tools were not listed for this lane, so no optional skill was applied.
