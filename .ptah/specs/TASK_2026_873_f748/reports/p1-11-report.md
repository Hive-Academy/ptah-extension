# P1-11 Replay fixture and snapshot

## Files created

- `tools/review-eval/fixture-manifest.schema.ts`
- `tools/review-eval/fixture-manifest.json`
- `tools/review-eval/fixture-builder.ts`
- `tools/review-eval/snapshot-builder.ts`
- `tools/review-eval/fixture-manifest.spec.ts`
- `tools/review-eval/fixture-builder.spec.ts`
- `tools/review-eval/snapshot-builder.spec.ts`

## Design summary

The exported `FixtureManifest`, `FixturePr`, `parseFixtureManifest` and `requireReadyFixture` in `fixture-manifest.schema.ts` are the P1-12/P1-13 import contract. The manifest records all 15 PR numbers and 108 root slots from `research/coderabbit-analysis.md:7-24`; example discussion IDs found in that research are retained as pending IDs. Every missing head, base, root provenance, category, severity, evidence, and checksum is explicitly pending. A pending fixture cannot pass `requireReadyFixture` and therefore cannot be scored. Ready entries require SHA/checksum/source URL/timestamp; the source record and expected 108-root/31-Major denominators are validated with Zod.

The fixture builder validates an offline API export through injected JSON IO and checks that reference input/output paths are outside supplied lane roots. It does not fetch the live GitHub API. The snapshot builder accepts a local repository path and injected git/filesystem runners. It fetches only a recorded head into a fresh bare repository without tags or a fetch ref, creates one replay ref, checks for remotes and alternates, compares reachable commits and objects against the source head, fails on fsck output, and writes a hashed bundle beside the bare repo.

## Acceptance criteria

- AC-17.1: snapshot creation requires a ready 40-character pre-fix head SHA and imports that SHA only. Current 15 heads are pending.
- AC-17.2/17.4: schema fixes the 15/108/31 expected counts and adjudication version; ready fixture requires 31 Major roots. Deterministic hashes identify bundle and sorted reachable commits.
- AC-17.3/17.5: P1-13 owns matching and report output; this batch provides stable reference IDs and evidence fields for it.
- AC-17.6: snapshot builder rejects extra refs, remotes, alternates, and changed reachability. P1-12 owns lane network and tool isolation.
- AC-17.7: builder returns bundle and reachable-commit hashes. P1-12 owns isolation attestation and P1-13 owns report invalidation.

## Verification

`ptah_get_diagnostics` reported zero errors on changed TypeScript files. JSON inspection counted 15 PR entries and 108 root slots. Focused specs use injected ports; no real network or git. Nx verify was not run here under D26; orchestrator must run `npm run verify -- -p review-eval` and relay failures. No live replay was run.

## Decisions

- Keep missing fixture evidence as `status: pending`, rather than fabricate SHAs or root IDs. Evidence: research lists only PR numbers/counts and example discussion links. Reversible when API exports are obtained.
- Export schema and readiness gate from one file for P1-12/P1-13. Evidence: batches P1-11..13 require a shared manifest seam. Reversible before consumers import it.
- Use a local source repository and injected git/filesystem runners for snapshot construction. Evidence: plan lines 225-227 require orchestrator-only preparation and bounded history. Reversible.
- Keep reference data outside supplied lane roots; require the isolation launcher to mount only snapshot source. Evidence: AC-17.6 and plan line 225. Reversible.

## Gaps

The research lacks all 15 pre-fix head/base SHAs and the complete 108 root IDs with API timestamps, checksums, categories, severity and evidence. The checked manifest is therefore a 15-PR/108-slot pending inventory, not a usable scoring fixture. Only a handful of discussion IDs are supported by example links. The API export and bounded snapshots must be prepared on the designated Ubuntu machine with fixture access, followed by P1-12 isolation and P1-13 scoring. AC-17.1, 17.3, 17.5-17.7 are not fully met by this batch alone. Lexical path checks do not resolve symlinks; the launcher must enforce filesystem mounts. Skill loading was unavailable in this host (no skill-loading tool listed); work followed repository guidance directly.
