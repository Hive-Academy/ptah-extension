# Backend implementation: `TASK_2026_701_9e4b`, Batch 7

**Tasks completed:** Task 7.1. It adds `HarnessDestinationScanner`, the `expectedDigest`
repair and the `changed-since-approval` outcome. It also carries the marketplace kept-wording
items left over from Batch 6 / D8.

## Files

Worktree: `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment`. All paths
below are relative to it.

- MODIFIED `libs/shared/src/lib/types/harness-sync.types.ts`
  - Adds `HarnessRepairBlockedPath.expectedDigest?: string`, documented as internal and stripped
    at the RPC.
  - Adds `HarnessRepairOutcome` member `'changed-since-approval'` (TL4).
  - Updates the `not-blocked` doc.
- CREATED `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts`
  - `scan(harnessRoot, items)` returns one `{kind, slug, target, relPath, state, digest}` per
    item per detected target. It skips targets that do not carry the facet.
  - States: `absent | unowned | owned-unmodified | owned-edited | unreadable`.
  - `probeDestination(absolute)` returns the current content digest: `hashDir` for a
    directory, `hashFile` for a file. A link is reported but never followed, and an unlistable
    directory reads as unreadable. The repair re-check uses the same function.
  - The scan is read-only, takes no lock and never throws. A target whose detection fails is
    logged and skipped.
  - Slugs that are not a single path segment are ignored and logged.
- CREATED `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.spec.ts`
  - Uses real Claude, Cursor (rival CLI) and Codex (not installed) targets over `mkdtemp`
    roots. Nothing reaches the real home (D20/D22).
  - Cases:
    - owned-unmodified with the directory digest
    - an undetected rival is skipped
    - owned-edited carries the current digest, not the manifest hash
    - unowned and absent
    - command file digest at each target's layout
    - agent path comes from `harnessAgentRelPath`; Claude is skipped
    - unreadable file and unlistable directory, by switching `fs/promises` per path
    - a detection failure never throws
    - traversal slugs are ignored
    - a scan writes nothing
    - `probeDestination` tells absent from unreadable
- MODIFIED `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts`
  - The fresh verify now gives, per target, the blocked paths plus `keptLocalEdit`.
  - A kept local edit is accepted only with `expectedDigest`. Without one it is refused as
    `not-blocked`.
  - In `moveOccupants`, under the workspace lock and before `moveToQuarantine`, any request
    with `expectedDigest` is re-digested through `probeDestination`. A mismatch or `null` gives
    `changed-since-approval`, and the path is not moved.
  - An approved path that is no longer blocked or kept also gives `changed-since-approval`.
    This covers a path deleted since approval, or one that is now Ptah's own unmodified copy.
  - Results and log lines carry only `{target, relPath}` (`pathOf`), so the digest never
    leaves the service.
  - Quarantine and restore are unchanged.
- MODIFIED `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.spec.ts`
  - Adds the describe block "a replace approved against a content digest (A21)". Cases:
    - a kept local edit without a digest is refused and left byte-identical
    - a matching digest is repaired, with the edit kept in quarantine and the digest absent from
      results and logs
    - edit A, then edit B before the repair, gives `changed-since-approval` and moves nothing
    - an edit that lands after the verify and before the move is still caught (the re-digest
      runs under the lock)
    - deleted, recreated and now-unreadable paths each give `changed-since-approval`
    - a blocked path with a stale digest is kept; one with a matching digest is repaired
  - Adds a `readFile` per-path failure switch to the existing `fs/promises` mock.
- MODIFIED `libs/backend/harness-sync/src/lib/di/tokens.ts`: adds
  `DESTINATION_SCANNER: Symbol.for('HarnessSyncDestinationScanner')`.
- MODIFIED `libs/backend/harness-sync/src/lib/di/register.ts`: registers the scanner as a
  `useValue`, built from the logger, the targets and the manifest store already in use there.
- MODIFIED `libs/backend/harness-sync/src/index.ts`: exports `HarnessDestinationScanner` and
  its types.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts` (A30)
  - The path entry accepts `expectedDigest` only to drop it (`.transform` to
    `{target, relPath}`).
  - It stays `.strict()` for every other unknown key.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.spec.ts`: adds a case
  showing a client `expectedDigest` is stripped.
- MODIFIED `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.component.ts`
  - `OUTCOME_TEXT['changed-since-approval']` = "Kept: changed since approval. It no longer
    matches what you approved, so Ptah left it exactly as it is."
  - The record is exhaustive by type, so this was the A-outcome consumer the compiler forced.
- MODIFIED `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.spec.ts`
  - The real-literals reasons fixture gains a `changed-since-approval` row (the spec requires
    every reason in the DOM).
  - New case: the new outcome renders as kept, never as moved.
- MODIFIED `libs/frontend/marketplace/src/lib/data/attention.ts` (+ `attention.spec.ts`):
  "local edits replaced" becomes "local edits kept".
- MODIFIED `libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts`
  - Testid `harness-target-overwritten` becomes `harness-target-kept`.
  - Copy "replaced from the source…" becomes "N local edit(s) kept as you left it/them. Sync
    does not replace an edited copy until you choose to."
  - The Electron button and its aria-label are unchanged.
- MODIFIED `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
  - The only spec that reads the testid: its three cases now use `harness-target-kept` and the
    kept wording.
  - No e2e selector uses the testid (`git grep` showed none).
- MODIFIED, outside the listed files: `libs/shared/src/lib/types/harness-blocked-wording.ts`.
  See Plan deviations.

**Outside this batch (stage with Batch 8b, not 7):**
`libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts`. My
`npx prettier --write` over the dirty-file list reformatted its `logger.warn` calls by
mistake. The change is formatting only, nothing else. The audit-marker move in that file is
8b's own work. I told the team-leader. I made no other edit to that file.

## Stack observed

- harness-sync services are plain classes built in `di/register.ts` and registered as
  `useValue` under `HARNESS_SYNC_TOKENS` `Symbol.for` tokens, like `BLOCKED_REPAIR`.
- The logger is the vscode-core `Logger` type, as in `blocked-repair.service.ts`.
- RPC boundary validation uses zod 4.6.5 (`package.json`) in `harness-rpc.schema.ts`.
- User-facing repair prose is pinned two ways: the `HARNESS_REPAIR_REASONS` /
  `HARNESS_BLOCKED_APPROVED_PROSE` allowlist in `harness-blocked-wording.ts`, and an equality
  check in the service spec.

## Verification

Command:

`npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/marketplace,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-extension-webview`

Result: `NX 73 tasks: 72 succeeded, 2 cached, 1 failed` (17m 26s, exit 1).

- The only failure is `ptah-extension-webview:lint`, the accepted pre-existing D19 failure. Its
  log has one error: "Circular dependency between ptah-extension-webview and
  @ptah-extension/command-center". None of my files is involved.
- Every other target passed: lint, test and typecheck for shared, harness-sync, rpc-handlers,
  marketplace, cli-engine, ptah-electron, ptah-extension-vscode and ptah-cli, plus webview test
  and typecheck.
- `ptah_get_diagnostics` on the six backend files: 0 errors.
- Degradation audit
  (`node scripts/verify.mjs --exec --task degradation-audit-b7 -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`):
  exit 0.
  - harness-sync lists 6 sites, which equals its baseline of 6. None is in a Batch 7 file
    (`harness-manifest.builder.ts`, `plugin-config-source-resolver.ts`, the MCP facets,
    `workspace-target.ts:445`).
  - rpc-handlers: 1 site, equal to its baseline.
  - The only orphaned marker reported is `agent-sdk/.../session-importer.service.ts:993`, which
    is not mine (the team-leader already flagged it for 8b).
  - I added no suppression marker.
- Host guard specs (A33) are green. The scanner token is not listed in any
  expected-resolvable or rpc-surface list, and the container smoke specs passed in the run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Skill/command relPaths come from `target.preflightKeys()` over a one-item desired state; agent paths from `harnessAgentRelPath` | add a path method per target (edits `claude-target.ts`, `workspace-target.ts`, port: outside the batch); duplicate the layout strings (forbidden by A-paths) | `preflightKeys` maps slugs to paths without reading sources (`claude-target.ts:125-140`, `workspace-target.ts:153-159,357-386`); `agent-rel-path.guard.spec.ts` pins the shared agent rule | yes |
| Ownership = an entry for the relPath in any target's manifest | own manifest only | co-owners (Codex/Antigravity share `.agents/skills`) count each other's manifests (`workspace-target.ts` `OwnershipOracle`); entry `hash` compares against `hashDir`/`hashFile`, as `planEntry` does (`workspace-target.ts:513-544`) | yes |
| A kept local edit without a digest is refused as `not-blocked` (existing wording) | new outcome / new reason | it is literally not in the blocked set; TL4 adds only `changed-since-approval`; no new wording surface needed | yes |
| An approved path no longer blocked or kept gives `changed-since-approval`, not `not-blocked` | `not-blocked` | the plan's "deleted → changed-since-approval" case: a deleted kept path drops out of `keptLocalEdit` at the fresh verify, so it can only be reported this way | yes |
| Strip `expectedDigest` with `.transform`, still `.strict()` for other keys | plain strip of all keys | A30 says "stripped"; the existing spec requires unknown keys to be rejected (`harness-rpc.schema.spec.ts` "rejects an unknown key on an individual path entry") | yes |
| The re-check digest is taken from disk type (`probeDestination`), shared by scanner and repair | digest by item kind | an approval and its re-check can then differ only when the content differs | yes |

## Plan deviations

- **`libs/shared/src/lib/types/harness-blocked-wording.ts` edited (not in the Batch 7 list).**
  - Change: adds `HARNESS_REPAIR_REASONS.changedSinceApproval` ("this changed after you
    approved it, so it was kept exactly as it is and nothing was moved or written"). Adds the
    dialog's `changed-since-approval` outcome sentence to
    `HARNESS_BLOCKED_APPROVED_PROSE['repair-dialog']`.
  - Why: every `reason` the repair emits and every outcome sentence the repair dialog renders
    must be on this allowlist. The dialog spec renders every `HARNESS_REPAIR_REASONS` value and
    runs `harnessBlockedWordingViolations` over the result. Without the entries, the new outcome
    text is unapproved prose and the guard fails, or the new wording escapes the guard
    entirely.
  - Scope: same project (`@ptah-extension/shared`). Neither string contains a word on the
    destructive-verb list. The reviewer should confirm the wording, because this allowlist is
    the approval record.
- Batch 6 named an "attention.spec.ts" case `'overwritten local edits'`; it is renamed to
  `'kept local edits'`.

## Out-of-scope observations

- Through `harness:repairBlocked`, a `changed-since-approval` result can only come back from a
  future server-side caller (B12). Client digests are stripped, so the dialog shows it only if
  B12 routes approvals through the same dialog. The dialog text is ready either way.
- A comment in `harness-repair-dialog.spec.ts` cites line numbers in `blocked-repair.service.ts`
  (`:230, :318, :334, :399, :406`). They were already stale before this batch. I did not
  change them.
