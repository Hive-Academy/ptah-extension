# P1 code logic review — part A

Review family: codex; implementer family: Claude

Score: **4/10**. Verdict: **REVISE**.

Counts: 0 Blocking, 3 Serious, 1 Moderate, 0 Minor; 4 distinct failure modes.

The keep policy is implemented in planning, the renamed contract is connected, and propagation reports refresh failures. However, the Claude write path can still lose an edit, and repair can claim success without installing anything. These violate the central safety contract, placing this below the 5–6 band of localized gaps. The implemented lock, refusal and restoration mechanisms distinguish it from a 1–2 foundation-level failure.

## Findings

1. **Serious — Claude apply overwrites edits made after planning.**

   Evidence: `libs/backend/harness-sync/src/lib/targets/claude-target.ts:373`, `libs/backend/harness-sync/src/lib/targets/claude-target.ts:378`, `libs/backend/harness-sync/src/lib/targets/claude-target.ts:380`; supporting implementation: `libs/backend/harness-sync/src/lib/targets/copy-engine.ts:63` and `libs/backend/harness-sync/src/lib/targets/copy-engine.ts:243`.

   Scenario: a managed command or skill is unmodified when plan schedules a source update. The user saves an edit while the asynchronous pass proceeds. Claude apply calls `copyDirectory`, which recursively removes the destination, or `copySingleFile` without exclusive mode, which replaces the file. There is no apply-time ownership/hash check, detach or restoration here. The workspace lock does not serialize editor saves. The late edit is lost and the write is reported as successful. The same create path can replace a user file created after the planner observed absence.

   Fix: give Claude writes the guarded publication used for workspace targets: detach and verify updates, restore/report a late edit, and exclusively create new destinations. Preserve the old ownership hash when keeping an edit. Add deterministic plan/apply interleaving cases for both files and directories, including a newly occupied create path.

2. **Serious — Repair treats missing failure evidence as successful installation.**

   Evidence: `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:302`, `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:304`, `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:312`; failure producer: `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:698`; empty health: `libs/backend/harness-sync/src/lib/health/harness-health.ts:39`.

   Scenario: verify accepts an edited path and repair quarantines it. During the subsequent propagation, that target's detection or planning fails. Reconcile catches the failure and returns target health with `missing: []` and a `(target)` write failure. `settle` checks only that the path is not in `missing`, so it reports `repaired` and skips restoration although nothing was installed. A target becoming undetected has the same result. A concurrent new edited occupant kept by the pass also is not in `missing` (`health/harness-health.ts:125`), so this predicate is not proof of installation even for an otherwise successful target.

   Fix: require positive evidence that this path has the intended managed artifact, from an explicit successful/verified path result or a fresh destination/manifest check under the lock. A missing target, target-wide failure, or kept replacement must not count as repaired. Restore the original through the existing non-destructive restoration mechanism when installation cannot be established, and report the actual outcome.

3. **Serious — Approval probing accepts incomplete directory hashes.**

   Evidence: `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts:108`, `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts:113`, `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts:119`; dependency behavior: `libs/backend/harness-sync/src/lib/hash/content-hash.ts:169`, `libs/backend/harness-sync/src/lib/hash/content-hash.ts:174`, `libs/backend/harness-sync/src/lib/hash/content-hash.ts:184`, `libs/backend/harness-sync/src/lib/hash/content-hash.ts:316`; mutation gate: `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:229`.

   Scenario: the approved skill contains an empty descendant directory. Before repair that descendant becomes unreadable while the root remains readable. The root-only `readdir` succeeds; the recursive hash silently treats the unreadable descendant as empty. The digest still matches and repair moves the directory instead of returning `changed-since-approval` untouched. More generally, unreadable child files produce a sentinel rather than an unreadable probe, and ignored/depth-excluded entries are not covered by approval at all.

   Fix: use a strict approval probe that reports incomplete traversal or any unreadable descendant as `digest: null`. Bind approval to all content the move affects, or explicitly refuse unsupported entries. Keep the permissive synchronization hash separate from the consent proof. The existing exhaustive safety walk in `targets/artifact-retirement.ts:278` demonstrates why hash equality alone is insufficient.

4. **Moderate — Delete/recreate with identical bytes bypasses the promised change check.**

   Evidence: `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts:121`, `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:228`, `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:461`; promised behavior: `libs/shared/src/lib/types/harness-sync.types.ts:535`.

   Scenario: the user approves replacing an edited command, then deletes it and recreates a new file containing the same bytes before repair. Fresh verify still sees a kept edit; the content hash equals `expectedDigest`. Repair therefore quarantines and replaces the recreated file rather than reporting `changed-since-approval`. The request carries no object identity with which to distinguish the two files.

   Fix: retain a server-side approval fingerprint that includes file identity/generation and type alongside content, and validate it under the mutation lock. Define the supported identity guarantees across platforms. If content equivalence is intended instead, explicitly revise the recreated-path requirement; the present implementation does not meet it.

## Five logic questions

1. **How does failure look like success?** Finding 2: an empty `missing` list on failed-target health becomes `repaired` at `repair/blocked-repair.service.ts:304`.
2. **What user action is unexpected?** Saving during a Claude sync loses the save (finding 1, `targets/claude-target.ts:378`); recreating approved content still permits replacement (finding 4, `repair/blocked-repair.service.ts:229`).
3. **What data produces a wrong answer?** A partially unreadable tree can receive a comparable approval digest (finding 3, `health/harness-destination-scanner.ts:119`).
4. **What happens when dependencies fail?** Refresher rejection becomes `failed` at `propagation/harness-propagation.service.ts:219`; reconcile rejection yields null health while preserving user-layer status at line 165. Target-level failures instead expose finding 2. No timeout guarantee was established for a refresher that never settles.
5. **What is missing from the requirements?** The precise identity guarantee for same-content recreation and the treatment of content omitted by synchronization hashes need explicit contracts (findings 3–4). A workspace lock coordinates Ptah writers, not arbitrary filesystem writers; guarded publication is still necessary (finding 1).

## Contract and data-flow checks

- **D11/D16:** the shared field is `keptLocalEdit` (`libs/shared/src/lib/types/harness-sync.types.ts:151`), health produces it (`health/harness-health.ts:125`), and the CLI formatter reads that key (`apps/ptah-cli/src/cli/output/formatter.ts:521`). The schema constant is `1.0` (`apps/ptah-cli/src/cli/jsonrpc/types.ts:32`); wire typing remains `2.0`. A text search of `libs` and `apps` found no production-code `overwrittenLocalEdit` consumer; remaining non-spec matches were migration documentation.
- **D8 planning:** workspace targets preserve the old ownership entry on a kept result (`targets/workspace-target.ts:228`); verify and apply health expose kept paths (`health/harness-health.ts:78`, `:125`). The Claude apply boundary remains unsafe as finding 1 describes.
- **Workspace late-edit guard:** `targets/workspace-target.ts:945` detaches an update and line 958 restores a detected edit. File restoration uses an exclusive hard link at line 1133; restoration failure reports the snapshot location at line 1139. Directory restoration uses rename at line 1131. These branches preserve the snapshot when the destination is occupied; they do not establish a universal guarantee against external writers holding open handles across hashing/deletion.
- **Consent flow:** kept paths without an internal digest are refused (`repair/blocked-repair.service.ts:460`). Accepted digests are re-read after lock acquisition (`:219`, `:229`). Client `expectedDigest` is explicitly accepted only to be stripped, with strict unknown-key rejection retained (`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts:198`, `:200`, `:201`, `:205`). The Marketplace has text for the new outcome (`libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.component.ts:49`). Findings 2–4 qualify repair correctness.
- **Refresh reporting:** rejection is caught and mapped to `failed` (`propagation/harness-propagation.service.ts:209`); absent workspace reports skipped (`:134`); null health retains the refresh result (`:165`). DI supplies the default refresher and registers the scanner (`di/register.ts:196`, `:220`).

## Scope and verification limits

Static review of the named current-worktree paths, concentrated on planning, apply, hashing, repair, reporting and contract consumers, with supporting reads of copy-engine, artifact-retirement and content hashing. This is a revision verdict based on concrete paths, not certification of every line of every named file. No source was changed. No tests, builds, package scripts or git commands were run.

The role's explicit prohibition on git operations prevented the requested per-file commit diffs. Therefore these findings describe the inspected worktree and are not claimed to be newly introduced by `38d9cc427..a96d12d50`. Large source reads were supplemented by targeted line reads where output was truncated. The symbol index returned zero hits, so the renamed-field check used one native text-search fallback.

Scoped `ptah_get_diagnostics` for `targets/workspace-target.ts` returned **Unavailable**: its TypeScript check was still running after 45 seconds, with one file unchecked. This is not passing validation; the tool reported that it had not cancelled its background check. No runtime interleaving was executed, and host refresher implementations outside part A were not audited.

## Decisions

- **Apply D16 over the older A34 plan wording.** Options: retain 0.2 or accept the instructed 1.0 bump. Evidence: `decisions.md:19` explicitly overrides A34. Decision: 1.0 is correct. Reversible: yes, but reverting would undo the approved compatibility signal.
- **Treat same-content recreation as a requirement gap.** Options: content equality alone or object-sensitive approval. Evidence: `libs/shared/src/lib/types/harness-sync.types.ts:535` and the review request explicitly include recreated paths. Decision: report finding 4 rather than silently weaken that promise. Reversible: yes, through an explicit contract decision.
- **Report current-code defects without assigning regression provenance.** Options: invent a diff attribution or qualify the evidence. Evidence: role prohibition on git operations. Decision: retain concrete findings and state the commit-comparison limitation. Reversible: yes, a coordinator can establish provenance from the requested diff.
